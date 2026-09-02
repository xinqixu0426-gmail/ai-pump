const test = require('node:test');
const assert = require('node:assert/strict');
const {
    explicitOrderIds,
    explicitQuotationIds,
    verifiedResolvedOrderIds,
    verifiedResolvedQuotationIds,
    validateAiToolIdentifierGrounding,
    normalizeExplicitCoilShorthandArgs,
} = require('../api/services/aiToolIdentifierGrounding.cjs');

function verifiedResult(result = {}) {
    return {
        success: true,
        ...result,
        executionEvidence: {
            verified: true,
            kind: 'formal_api_query',
            calls: [{ method: 'GET', path: '/api/orders/lookup?query=test' }],
        },
    };
}

test('AI 订单标识落地：只接受用户明确订单号或当前订单页面ID', () => {
    assert.deepEqual(
        [...explicitOrderIds([
            { role: 'user', content: '看订单 #12 和 8号订单' },
            { role: 'assistant', content: '错误猜测订单 99' },
        ], { resourceType: 'order', resourceId: 3 })].sort((a, b) => a - b),
        [3, 8, 12]
    );
});

test('AI 订单标识落地：具名追问时阻止模型猜测ID并允许名称查询', () => {
    const messages = [
        { role: 'user', content: '看一下订单' },
        { role: 'assistant', content: '邱焕，采购中' },
        { role: 'user', content: '邱焕的订单已经采购了什么' },
    ];
    const rejected = validateAiToolIdentifierGrounding({
        toolName: 'get_order_detail',
        args: { orderId: 5 },
        messages,
    });
    assert.equal(rejected.code, 'UNGROUNDED_ORDER_ID');
    assert.match(rejected.error, /猜测ID/);
    assert.equal(validateAiToolIdentifierGrounding({
        toolName: 'get_order_detail',
        args: { orderQuery: '邱焕' },
        messages,
    }), null);
});

test('AI 订单标识落地：客户端回传的上一轮状态不直接授权订单ID', () => {
    const rejected = validateAiToolIdentifierGrounding({
        toolName: 'get_order_detail',
        args: { orderId: 7 },
        messages: [{ role: 'user', content: '这笔订单的电缆是多少' }],
        turnState: {
            version: 3,
            kind: 'agent_turn_state',
            resolvedEntities: [{ entityType: 'order', id: 7, name: '邱焕' }],
            capabilities: ['get_order_detail', 'get_order_knowledge_package'],
        },
    });
    assert.equal(rejected.code, 'UNGROUNDED_ORDER_ID');
});

test('AI 订单标识落地：用户明确订单号时允许按ID读取', () => {
    assert.equal(validateAiToolIdentifierGrounding({
        toolName: 'get_order_detail',
        args: { orderId: 5 },
        messages: [{ role: 'user', content: '查看5号订单采购情况' }],
    }), null);
});

test('AI 订单标识落地：允许后续工具使用本轮正式查询唯一解析出的订单ID', () => {
    const toolResults = [{
        name: 'get_order_detail',
        result: verifiedResult({ order: { id: 2, customerName: '台州叶总' } }),
    }];
    assert.deepEqual([...verifiedResolvedOrderIds(toolResults)], [2]);
    assert.equal(validateAiToolIdentifierGrounding({
        toolName: 'check_order_readiness',
        args: { orderId: 2 },
        messages: [{ role: 'user', content: '叶总的订单有什么问题' }],
        toolResults,
    }), null);
});

test('AI 订单标识落地：不信任模型伪造或缺少正式执行证据的订单ID', () => {
    const messages = [{ role: 'user', content: '叶总的订单有什么问题' }];
    for (const result of [
        { success: true, order: { id: 2, customerName: '台州叶总' } },
        verifiedResult({ success: false, order: { id: 2, customerName: '台州叶总' } }),
    ]) {
        const rejected = validateAiToolIdentifierGrounding({
            toolName: 'check_order_readiness',
            args: { orderId: 2 },
            messages,
            toolResults: [{ name: 'get_order_detail', result }],
        });
        assert.equal(rejected.code, 'UNGROUNDED_ORDER_ID');
    }
});

test('AI 订单标识落地：只读名称查询允许把简称扩展为标准客户候选', () => {
    const messages = [{
        role: 'user',
        content: '台州叶总的订单泵壳送来了有什么问题吗',
    }];
    assert.equal(validateAiToolIdentifierGrounding({
        toolName: 'get_order_knowledge_package',
        args: { orderQuery: '叶总' },
        messages,
    }), null);
    assert.equal(validateAiToolIdentifierGrounding({
        toolName: 'get_order_knowledge_package',
        args: { orderQuery: '台州叶总' },
        messages,
    }), null);
    assert.equal(validateAiToolIdentifierGrounding({
        toolName: 'check_order_readiness',
        args: { orderQuery: '20260100' },
        messages,
    }), null);
});

test('AI 报价标识落地：只接受用户明确报价号或本轮正式列表中的ID', () => {
    assert.deepEqual(
        [...explicitQuotationIds([
            { role: 'user', content: '看报价 #18 和 23号报价' },
            { role: 'assistant', content: '错误猜测报价 99' },
        ])].sort((a, b) => a - b),
        [18, 23]
    );
    assert.equal(validateAiToolIdentifierGrounding({
        toolName: 'get_quotation_detail',
        args: { quotationId: 18 },
        messages: [{ role: 'user', content: '查看报价ID 18的完整明细' }],
    }), null);

    const toolResults = [{
        name: 'search_quotations',
        result: verifiedResult({ data: [{ id: 27, customerName: '华东泵业' }] }),
    }];
    assert.deepEqual([...verifiedResolvedQuotationIds(toolResults)], [27]);
    assert.equal(validateAiToolIdentifierGrounding({
        toolName: 'get_quotation_detail',
        args: { quotationId: 27 },
        messages: [{ role: 'user', content: '查看华东泵业这份报价' }],
        toolResults,
    }), null);
});

test('AI 报价标识落地：阻止模型直接猜测存在的报价ID', () => {
    const rejected = validateAiToolIdentifierGrounding({
        toolName: 'get_quotation_detail',
        args: { quotationId: 27 },
        messages: [{ role: 'user', content: '查看华东泵业这份报价' }],
    });
    assert.equal(rejected.code, 'UNGROUNDED_QUOTATION_ID');
    assert.match(rejected.error, /猜测ID/);
});

test('AI 报价标识落地：报价数量不被误认为明确报价ID', () => {
    const ids = explicitQuotationIds([
        { role: 'user', content: '给客户做报价 18 份，再看看报价18个是否够用' },
    ]);
    assert.deepEqual([...ids], []);
    const rejected = validateAiToolIdentifierGrounding({
        toolName: 'get_quotation_detail',
        args: { quotationId: 18 },
        messages: [{ role: 'user', content: '给客户做报价 18 份' }],
    });
    assert.equal(rejected.code, 'UNGROUNDED_QUOTATION_ID');
});

test('AI 业务数值落地：阻止模型猜测机筒长度和线圈片数', () => {
    const shellIssue = validateAiToolIdentifierGrounding({
        toolName: 'preview_pump_shell_cost',
        args: { shellModel: 'V1600', customBarrelLength: 180 },
        messages: [{ role: 'user', content: 'V1600 泵壳价格是多少' }],
    });
    assert.equal(shellIssue.code, 'UNGROUNDED_BUSINESS_NUMBER');

    const coilIssue = validateAiToolIdentifierGrounding({
        toolName: 'calculate_coil_cost',
        args: { spec: '12-120', sheets: 120 },
        messages: [{ role: 'user', content: '查询规格 12 的线圈成本' }],
    });
    assert.equal(coilIssue.code, 'UNGROUNDED_BUSINESS_NUMBER');

    for (const sample of [
        ['preview_recipe_cost', { recipeName: 'V750', customBarrelLength: 180 }],
        ['preview_recipe_cost', { recipeName: 'V750', overrides: { coilSheets: 140 } }],
        ['full_calculate', { recipeName: 'V750', cableLength: 20 }],
        ['dynamic_config_cost', { cableLength: 20 }],
        ['build_recipe_bom_draft', { coilWireWeight: 0.8 }],
        ['calculate_coil_cost', { spec: '12', sheets: 120, wireWeight: 0.8 }],
    ]) {
        const rejected = validateAiToolIdentifierGrounding({
            toolName: sample[0],
            args: sample[1],
            messages: [{ role: 'user', content: '查询 V750 当前成本' }],
        });
        assert.equal(rejected.code, 'UNGROUNDED_BUSINESS_NUMBER', sample[0]);
    }
});

test('AI 业务数值落地：用户明确字段数值或正式结果可以授权计算参数', () => {
    assert.equal(validateAiToolIdentifierGrounding({
        toolName: 'preview_pump_shell_cost',
        args: { shellModel: 'V1500', customBarrelLength: 220 },
        messages: [{ role: 'user', content: 'V1500 使用 220mm 机筒时泵壳多少钱' }],
    }), null);
    assert.equal(validateAiToolIdentifierGrounding({
        toolName: 'calculate_coil_cost',
        args: { spec: '12', sheets: 120 },
        messages: [{ role: 'user', content: '按 12-120 方案计算线圈成本' }],
    }), null);
    assert.equal(validateAiToolIdentifierGrounding({
        toolName: 'calculate_coil_cost',
        args: { spec: '12', sheets: 120 },
        messages: [{ role: 'user', content: '按刚才查到的方案计算线圈成本' }],
        toolResults: [{
            name: 'search_coils',
            result: verifiedResult({ data: [{ spec: '12', sheets: 120 }] }),
        }],
    }), null);
});

test('AI 业务数值落地：12-120 简写纠正模型误填的片数并保留其他配置', () => {
    assert.deepEqual(normalizeExplicitCoilShorthandArgs({
        shellModel: 'V750-大脚板-2寸',
        coilSpec: '12',
        coilSheets: 12,
        hasFloat: true,
    }, [{
        role: 'user',
        content: 'V750-大脚板-2寸的壳，做12-120片，带浮球，木箱，需要珍珠棉',
    }]), {
        shellModel: 'V750-大脚板-2寸',
        coilSpec: '12',
        coilSheets: 120,
        hasFloat: true,
    });
    assert.deepEqual(normalizeExplicitCoilShorthandArgs({
        spec: '12',
        sheets: 12,
    }, [{ role: 'user', content: '比较 12-120 和 12-140' }]), {
        spec: '12',
        sheets: 12,
    });
});
