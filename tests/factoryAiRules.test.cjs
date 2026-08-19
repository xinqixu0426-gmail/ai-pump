const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    buildFactoryAiRulesPrompt,
    listFactoryAiRules,
    selectRelevantFactoryAiRules,
    updateFactoryAiRule,
} = require('../api/services/factoryAiRules.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE factory_ai_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_feedback_id INTEGER UNIQUE,
            title TEXT NOT NULL,
            trigger_text TEXT NOT NULL DEFAULT '',
            instruction TEXT NOT NULL,
            scope_type TEXT NOT NULL DEFAULT 'global',
            priority INTEGER NOT NULL DEFAULT 100,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE ai_evaluation_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_key TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            question TEXT NOT NULL,
            evaluator_type TEXT NOT NULL,
            config_json TEXT NOT NULL DEFAULT '{}',
            enabled INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 100,
            source_type TEXT NOT NULL DEFAULT 'manual',
            source_feedback_id INTEGER,
            review_status TEXT NOT NULL DEFAULT 'approved',
            confidence_score INTEGER NOT NULL DEFAULT 100,
            generation_note TEXT NOT NULL DEFAULT '',
            proposal_hash TEXT NOT NULL DEFAULT '',
            review_note TEXT NOT NULL DEFAULT '',
            reviewed_at TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        INSERT INTO factory_ai_rules (
            source_feedback_id, title, trigger_text, instruction,
            scope_type, priority, status, created_at, updated_at
        ) VALUES
            (1, '线圈俗称库存规则', '12-120各入库50套', '规格-片数表示线圈成品，必须调整线圈库存。', 'global', 100, 'active', '2026-08-02', '2026-08-02'),
            (2, '停用规则', '旧问题', '这条规则不应进入提示词。', 'global', 100, 'disabled', '2026-08-01', '2026-08-01'),
            (3, '报价顺序规则', '查询客户报价', '报价按第1份、第2份展示。', 'global', 90, 'active', '2026-08-01', '2026-08-01');
        INSERT INTO ai_evaluation_cases (
            case_key, title, category, question, evaluator_type, config_json,
            enabled, sort_order, source_type, source_feedback_id, review_status,
            confidence_score, generation_note, proposal_hash, review_note,
            reviewed_at, created_at, updated_at
        ) VALUES (
            'feedback-1', '纠错回归：12-120各入库50套', '线圈',
            '12-120各入库50套', 'rules',
            '{"requiredTerms":[["线圈成品"]],"correctionGuidance":"规格-片数表示线圈成品，必须调整线圈库存。","sourceFeedbackId":1}',
            1, 1001, 'feedback', 1, 'approved', 80, '测试夹具',
            'fixture-hash', '', '2026-08-02', '2026-08-02', '2026-08-02'
        );
    `);
    const safeUpdate = (table, id, values) => {
        assert.ok(['factory_ai_rules', 'ai_evaluation_cases'].includes(table));
        const entries = Object.entries(values);
        db.prepare(`UPDATE ${table} SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
            .run(...entries.map(([, value]) => value), '2026-08-03', id);
    };
    const aiEvaluationCaseRow = row => ({
        id: row.id,
        caseKey: row.case_key,
        title: row.title,
        category: row.category,
        question: row.question,
        evaluatorType: row.evaluator_type,
        configJson: row.config_json,
        enabled: Boolean(row.enabled),
        sourceType: row.source_type,
        sourceFeedbackId: row.source_feedback_id,
        reviewStatus: row.review_status,
        confidenceScore: row.confidence_score,
        generationNote: row.generation_note,
        proposalHash: row.proposal_hash,
        reviewNote: row.review_note,
        reviewedAt: row.reviewed_at,
    });
    return { db, accessors: { db, safeUpdate, aiEvaluationCaseRow } };
}

test('通用纠错学习：只把启用规则注入 AI 系统上下文', () => {
    const fixture = createFixture();
    const prompt = buildFactoryAiRulesPrompt({ dbAccessors: fixture.accessors });

    assert.match(prompt, /用户确认的长期操作习惯与纠正规则/);
    assert.match(prompt, /规格-片数表示线圈成品/);
    assert.doesNotMatch(prompt, /这条规则不应进入提示词/);
    fixture.db.close();
});

test('通用纠错学习：规则可以停用和重新启用', () => {
    const fixture = createFixture();
    const active = listFactoryAiRules({ status: 'active' }, { dbAccessors: fixture.accessors });
    assert.equal(active.stats.total, 3);
    assert.equal(active.stats.active, 2);
    assert.equal(active.items.length, 2);

    const disabled = updateFactoryAiRule(1, { status: 'disabled' }, { dbAccessors: fixture.accessors });
    assert.equal(disabled.status, 'disabled');
    assert.equal(buildFactoryAiRulesPrompt({
        dbAccessors: fixture.accessors,
        query: '12-120入库',
        domains: ['coil'],
    }), '');

    const enabled = updateFactoryAiRule(1, {
        status: 'active',
        instruction: '正确做法是按“线圈库存”执行。',
    }, { dbAccessors: fixture.accessors });
    assert.equal(enabled.status, 'active');
    assert.match(buildFactoryAiRulesPrompt({
        dbAccessors: fixture.accessors,
        query: '12-120入库',
        domains: ['coil'],
    }), /线圈库存/);
    const regression = fixture.db.prepare(
        'SELECT * FROM ai_evaluation_cases WHERE source_feedback_id = 1'
    ).get();
    assert.match(regression.config_json, /线圈库存/);
    assert.equal(regression.enabled, 1);
    fixture.db.close();
});

test('通用纠错学习：只向当前问题注入相关规则', () => {
    const fixture = createFixture();
    const coilPrompt = buildFactoryAiRulesPrompt({
        dbAccessors: fixture.accessors,
        query: '请把12-120入库50套',
        domains: ['coil'],
    });

    assert.match(coilPrompt, /规格-片数表示线圈成品/);
    assert.doesNotMatch(coilPrompt, /报价按第1份/);

    const quotationPrompt = buildFactoryAiRulesPrompt({
        dbAccessors: fixture.accessors,
        query: '查询这个客户的报价',
        domains: ['quotation'],
    });
    assert.match(quotationPrompt, /报价按第1份/);
    assert.doesNotMatch(quotationPrompt, /规格-片数表示线圈成品/);
    fixture.db.close();
});

test('通用纠错学习：原问题只是适用示例，换成同类业务问题仍遵守提炼规则', () => {
    const fixture = createFixture();
    const prompt = buildFactoryAiRulesPrompt({
        dbAccessors: fixture.accessors,
        query: '请把 18-160 的成品线圈增加 20 套',
        domains: ['coil'],
    });

    assert.match(prompt, /规格-片数表示线圈成品/);
    assert.match(prompt, /原问题只作为适用示例和来源追溯/);
    assert.match(prompt, /不依赖原对话继续存在/);
    fixture.db.close();
});

test('通用纠错学习：相同正确做法只注入优先级最高的一条', () => {
    const selected = selectRelevantFactoryAiRules([
        {
            id: 1,
            title: '旧规则',
            triggerText: '12-120 入库',
            instruction: '规格-片数表示线圈成品，必须调整线圈库存。',
            priority: 100,
            updatedAt: '2026-08-01',
        },
        {
            id: 2,
            title: '新规则',
            triggerText: '线圈简写入库',
            instruction: '规格 - 片数表示线圈成品；必须调整线圈库存',
            priority: 120,
            updatedAt: '2026-08-02',
        },
    ], {
        query: '12-120 入库',
        domains: ['coil'],
    });

    assert.equal(selected.length, 1);
    assert.equal(selected[0].id, 2);
});
