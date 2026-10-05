const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { MIGRATIONS } = require('../api/database/migrations.cjs');
const { saveV2Finding, listV2Findings, getV2FindingDetail, updateV2Finding, sanitizeRuntimeSnapshot } = require('../api/services/aiV2Findings.cjs');
const { buildApiIndex } = require('../api/services/ai-assistant/apiIndex.cjs');
const { scanForSecrets } = require('../scripts/ai-experiments/api-native-agent/d1FinalAcceptanceEvidence.cjs');

function fixture() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE ai_conversations (
            id INTEGER PRIMARY KEY,
            owner_key TEXT NOT NULL,
            deleted_at TEXT
        );
        CREATE TABLE ai_conversation_messages (
            id INTEGER PRIMARY KEY,
            conversation_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata_json TEXT DEFAULT '{}'
        );
        CREATE TABLE ai_answer_feedback (id INTEGER PRIMARY KEY, message_id INTEGER UNIQUE);
        CREATE TABLE factory_ai_rules (id INTEGER PRIMARY KEY, source_feedback_id INTEGER);
        CREATE TABLE ai_evaluation_cases (id INTEGER PRIMARY KEY, source_feedback_id INTEGER);
        CREATE TABLE knowledge_entries (id INTEGER PRIMARY KEY);
    `);
    MIGRATIONS.find(migration => migration.version === 91).up(db);
    const safeInsert = (table, values) => {
        const cols = Object.keys(values);
        return db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
            .run(...cols.map(key => values[key]));
    };
    const safeUpdate = (table, id, values) => {
        const entries = Object.entries(values);
        return db.prepare(`UPDATE ${table} SET ${entries.map(([key]) => `${key} = ?`).join(',')} WHERE id = ?`)
            .run(...entries.map(([, value]) => value), id);
    };
    const dbAccessors = { db, safeInsert, safeUpdate };
    safeInsert('ai_conversations', { id: 1, owner_key: 'admin', deleted_at: null });
    safeInsert('ai_conversations', { id: 2, owner_key: 'other', deleted_at: null });
    safeInsert('ai_conversation_messages', { id: 10, conversation_id: 1, role: 'user', content: 'V750 成本是多少？', metadata_json: '{}' });
    safeInsert('ai_conversation_messages', {
        id: 11,
        conversation_id: 1,
        role: 'assistant',
        content: '当前正式成本为 224 元/台。',
        metadata_json: JSON.stringify({
            provider: { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'must-not-copy' },
            metrics: { durationMs: 1800, modelRequestCount: 2, toolCallCount: 3, validatorResult: 'valid', usage: { promptTokens: 20, completionTokens: 5 } },
            selectedDomains: ['recipe', 'cost'],
            selectedCapabilities: ['preview_recipe_cost'],
            toolPlan: { summary: '读取当前配方成本', steps: [{ capabilityId: 'recipes.current_costs', status: 'completed' }] },
            toolCalls: [{ name: 'preview_recipe_cost', args: { recipeId: 3, confirmationToken: 'never-copy' } }],
            toolResults: [{ name: 'preview_recipe_cost', result: { success: true, verified: true, capabilityId: 'recipes.current_costs', data: { totalCost: 224, recipeId: 3 }, provenance: { kind: 'live_business', label: '正式数据' } } }],
            referenceEntities: [{ entityType: 'recipe', canonicalName: 'V750' }],
            writeProposal: { confirmationToken: 'also-never-copy' },
        }),
    });
    safeInsert('ai_conversation_messages', { id: 20, conversation_id: 2, role: 'assistant', content: 'other answer', metadata_json: '{}' });
    safeInsert('ai_conversation_messages', { id: 19, conversation_id: 2, role: 'user', content: 'other question', metadata_json: '{}' });
    return { db, dbAccessors };
}

test('V2 finding snapshots resolve the preceding Owner question and persisted answer on the server', () => {
    const { db, dbAccessors } = fixture();
    try {
        const finding = saveV2Finding('admin', { assistantMessageId: 11 }, { dbAccessors });
        assert.equal(finding.questionText, 'V750 成本是多少？');
        assert.equal(finding.answerText, '当前正式成本为 224 元/台。');
        assert.equal(finding.status, 'open');
        assert.equal(finding.category, null);
        assert.equal(finding.note, '');
    } finally { db.close(); }
});

test('category and bounded Owner note are optional and editable without duplicating the finding', () => {
    const { db, dbAccessors } = fixture();
    try {
        const first = saveV2Finding('admin', {
            assistantMessageId: 11,
            category: 'over_investigation',
            note: '答案正确，但调用接口太多。',
        }, { dbAccessors });
        const second = saveV2Finding('admin', {
            assistantMessageId: 11,
            note: '保留同一条记录。',
        }, { dbAccessors });
        assert.equal(first.id, second.id);
        assert.equal(second.category, 'over_investigation');
        assert.equal(second.note, '保留同一条记录。');
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_v2_findings').get().n, 1);
        assert.throws(() => saveV2Finding('admin', { assistantMessageId: 11, note: 'x'.repeat(2001) }, { dbAccessors }), /不能超过/);
    } finally { db.close(); }
});

test('runtime snapshot retains bounded operational metadata and strips credentials and confirmation tokens', () => {
    const { db, dbAccessors } = fixture();
    try {
        const finding = saveV2Finding('admin', { assistantMessageId: 11 }, { dbAccessors });
        const json = JSON.stringify(finding.runtimeSnapshot);
        assert.match(json, /deepseek/);
        assert.match(json, /selectedCapabilities/);
        assert.match(json, /preview_recipe_cost/);
        assert.match(json, /live_business/);
        assert.doesNotMatch(json, /apiKey|confirmationToken|never-copy/i);
        assert.equal(scanForSecrets(finding.runtimeSnapshot).pass, true);
        assert.equal(finding.runtimeSnapshot.toolCalls[0].argumentNames.includes('confirmationToken'), false);
        assert.equal(finding.runtimeSnapshot.metrics.durationMs, 1800);
    } finally { db.close(); }
});

test('malformed runtime metadata fails closed before persistence', () => {
    const { db, dbAccessors } = fixture();
    try {
        db.prepare('UPDATE ai_conversation_messages SET metadata_json = ? WHERE id = 11').run('{broken');
        assert.throws(() => saveV2Finding('admin', { assistantMessageId: 11 }, { dbAccessors }), /元数据格式无效/);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_v2_findings').get().n, 0);
        assert.throws(() => sanitizeRuntimeSnapshot({ provider: { model: 'Bearer abcdefghijklmnop' } }), /疑似凭据/);
    } finally { db.close(); }
});

test('Owner isolation, filters, detail lookup and snapshot survival after conversation deletion', () => {
    const { db, dbAccessors } = fixture();
    try {
        const finding = saveV2Finding('admin', { assistantMessageId: 11, category: 'performance' }, { dbAccessors });
        assert.equal(saveV2Finding('other', { assistantMessageId: 11 }, { dbAccessors }), null);
        assert.equal(getV2FindingDetail('other', finding.id, { dbAccessors }), null);
        assert.equal(listV2Findings('admin', { category: 'performance', status: 'open' }, { dbAccessors }).items.length, 1);
        assert.equal(listV2Findings('other', {}, { dbAccessors }).items.length, 0);
        db.prepare('UPDATE ai_conversations SET deleted_at = ? WHERE id = 1').run(new Date().toISOString());
        const detail = getV2FindingDetail('admin', finding.id, { dbAccessors });
        assert.equal(detail.conversationDeleted, true);
        assert.equal(detail.questionText, 'V750 成本是多少？');
        assert.equal(detail.answerText, '当前正式成本为 224 元/台。');
    } finally { db.close(); }
});

test('V2 finding is independent from answer feedback, learning rules, regression cases and knowledge ingestion', () => {
    const { db, dbAccessors } = fixture();
    try {
        const finding = saveV2Finding('admin', { assistantMessageId: 11 }, { dbAccessors });
        db.prepare('INSERT INTO ai_answer_feedback (id, message_id) VALUES (1, 11)').run();
        updateV2Finding('admin', finding.id, { status: 'reviewed', note: '保留为研究样本。' }, { dbAccessors });
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_answer_feedback').get().n, 1);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM factory_ai_rules').get().n, 0);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_evaluation_cases').get().n, 0);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM knowledge_entries').get().n, 0);
    } finally { db.close(); }
});

test('V2 findings are not exposed as Main Agent/API Index capabilities', () => {
    const apiIndex = buildApiIndex();
    const serialized = JSON.stringify(apiIndex);
    assert.doesNotMatch(serialized, /v2_findings|v2-findings/);
});
