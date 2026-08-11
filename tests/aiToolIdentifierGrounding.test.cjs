const test = require('node:test');
const assert = require('node:assert/strict');
const {
    explicitOrderIds,
    verifiedResolvedOrderIds,
    validateAiToolIdentifierGrounding,
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
