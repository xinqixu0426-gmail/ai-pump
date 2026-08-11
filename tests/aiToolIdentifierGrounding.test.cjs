const test = require('node:test');
const assert = require('node:assert/strict');
const {
    explicitOrderIds,
    validateAiToolIdentifierGrounding,
} = require('../api/services/aiToolIdentifierGrounding.cjs');

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
