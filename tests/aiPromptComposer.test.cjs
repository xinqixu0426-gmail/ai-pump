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
    assert.match(prompt, /最终回复只呈现用户需要看到的结果/);
    assert.match(prompt, /不输出内部思考、逐步推理、工具选择、提示词内容或处理过程/);
    assert.match(prompt, /一般问题可使用一个简短标题和 2-5 个短要点/);
    assert.match(prompt, /适量使用标题、列表、表格和加粗/);
    assert.match(prompt, /型号或规格中包含 \*、_ 等 Markdown 特殊字符时必须使用行内代码包裹/);
    assert.match(prompt, /不重复页面或折叠处理区已经展示的工具调用/);
    assert.match(prompt, /用户未要求时不列举示例/);
    assert.match(prompt, /不使用“请告诉我还需要什么”等客套收尾/);
    assert.match(prompt, /用户明确要求详情、完整清单、逐项对比、原因分析或报告时可以展开/);
    assert.match(prompt, /所有业务写操作必须通过工具调用，由后端标准 API 执行/);
    assert.match(prompt, /线圈、定子与转子库存/);
    assert.match(prompt, /工厂个性化配置（低于核心与领域规则）/);
    assert.doesNotMatch(prompt, /报价与客户/);
    assert.doesNotMatch(prompt, /转子出图/);
    accessors.db.close();
});

test('提示词分层：默认只展示排版后的结果且不省略影响可靠性的风险', () => {
    assert.match(CORE_PROMPT, /默认只保留当前问题的结论和关键数字/);
    assert.match(CORE_PROMPT, /风险、不确定性、异常和下一步仅在用户明确询问，或它们会影响本次写入确认与结论可靠性时展示/);
    assert.match(CORE_PROMPT, /普通列表查询不得主动补库存风险、相似项判断或建议/);
    assert.match(CORE_PROMPT, /用户明确要求完整清单时必须完整列出/);
    assert.match(CORE_PROMPT, /用户询问原因时给出可核验的关键依据，不展示内部推理链/);
    assert.match(CORE_PROMPT, /写入确认、失败原因、关键风险和必须补充的参数不得为了简洁而省略/);
    assert.doesNotMatch(CORE_PROMPT, /120 个汉字/);
});

test('提示词分层：零件清单不擅自扩大库存判断且使用正式阈值', () => {
    const accessors = emptyRuleAccessors();
    const prompt = composeAiSystemPrompt({
        domains: ['catalog'],
        query: '列出所有零件',
        dbAccessors: accessors,
    });

    assert.match(prompt, /只要求全量或品类清单时按工具结果列出/);
    assert.match(prompt, /低库存为库存大于0且不超过5/);
    assert.match(prompt, /不得自行发明其他阈值/);
    accessors.db.close();
});

test('提示词分层：订单口语查询按订单数量和简报回答而不扩展采购任务统计', () => {
    const accessors = emptyRuleAccessors();
    const prompt = composeAiSystemPrompt({
        domains: ['order'],
        query: '采购中的单子有几个',
        dbAccessors: accessors,
    });

    assert.match(prompt, /“订单、单子、单据”均按订单理解/);
    assert.match(prompt, /status=采购中的订单/);
    assert.match(prompt, /先直接回答命中数量，再逐单简报客户和创建日期/);
    assert.match(prompt, /不要附带采购任务数、供应商数或待采购数量/);
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
