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
        INSERT INTO factory_ai_rules (
            source_feedback_id, title, trigger_text, instruction,
            scope_type, priority, status, created_at, updated_at
        ) VALUES
            (1, '线圈俗称库存规则', '12-120各入库50套', '规格-片数表示线圈成品，必须调整线圈库存。', 'global', 100, 'active', '2026-08-02', '2026-08-02'),
            (2, '停用规则', '旧问题', '这条规则不应进入提示词。', 'global', 100, 'disabled', '2026-08-01', '2026-08-01'),
            (3, '报价顺序规则', '查询客户报价', '报价按第1份、第2份展示。', 'global', 90, 'active', '2026-08-01', '2026-08-01');
    `);
    const safeUpdate = (table, id, values) => {
        assert.equal(table, 'factory_ai_rules');
        const entries = Object.entries(values);
        db.prepare(`UPDATE factory_ai_rules SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
            .run(...entries.map(([, value]) => value), '2026-08-03', id);
    };
    return { db, accessors: { db, safeUpdate } };
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
        instruction: '以后按用户确认的正确业务方式执行。',
    }, { dbAccessors: fixture.accessors });
    assert.equal(enabled.status, 'active');
    assert.match(buildFactoryAiRulesPrompt({
        dbAccessors: fixture.accessors,
        query: '12-120入库',
        domains: ['coil'],
    }), /正确业务方式/);
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
