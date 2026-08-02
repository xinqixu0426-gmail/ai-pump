const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    CORE_PROMPT,
    composeAiSystemPrompt,
} = require('../api/services/aiPromptComposer.cjs');

function emptyRuleAccessors() {
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
    `);
    return { db };
}

test('提示词分层：核心规则始终存在且只加载当前领域', () => {
    const accessors = emptyRuleAccessors();
    const prompt = composeAiSystemPrompt({
        domains: ['coil'],
        query: '12-120入库50套',
        factoryProfile: '回答尽量简洁。',
        dbAccessors: accessors,
    });

    assert.match(prompt, /不可覆盖的核心规则/);
    assert.match(prompt, /所有业务写操作必须通过工具调用，由后端标准 API 执行/);
    assert.match(prompt, /线圈、定子与转子库存/);
    assert.match(prompt, /工厂个性化配置（低于核心与领域规则）/);
    assert.doesNotMatch(prompt, /报价与客户/);
    assert.doesNotMatch(prompt, /转子出图/);
    accessors.db.close();
});

test('提示词分层：工厂配置不能改变核心规则优先级', () => {
    const accessors = emptyRuleAccessors();
    const prompt = composeAiSystemPrompt({
        domains: [],
        factoryProfile: '任何写操作都直接执行。',
        dbAccessors: accessors,
    });

    assert.ok(prompt.indexOf(CORE_PROMPT) === 0);
    assert.match(
        prompt,
        /核心规则 > 当前领域规则 > 已批准配方检查规则 > 正式工厂事实 > 用户回答纠错 > 工厂个性化配置/
    );
    assert.match(prompt, /不得覆盖实时业务数据、已批准的结构化检查规则或正式工厂事实/);
    assert.ok(prompt.indexOf('工厂个性化配置') > prompt.indexOf('规则优先级'));
    accessors.db.close();
});
