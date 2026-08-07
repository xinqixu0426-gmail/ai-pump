const test = require('node:test');
const assert = require('node:assert/strict');
const {
    AI_CONTEXT_MESSAGE_LIMIT,
    scopeAiContextForTurn,
    trimAiContext,
    prioritizeCurrentEvidence,
} = require('../api/services/aiContext.cjs');

test('AI 上下文只保留最近 10 条有效对话消息', () => {
    const messages = Array.from({ length: 14 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `message-${index + 1}`,
    }));
    messages.splice(5, 0, { role: 'system', content: '不接受前端系统消息' });

    const context = trimAiContext(messages);
    assert.equal(AI_CONTEXT_MESSAGE_LIMIT, 10);
    assert.equal(context.length, 10);
    assert.equal(context[0].content, 'message-5');
    assert.equal(context[9].content, 'message-14');
    assert.equal(context.some(message => message.role === 'system'), false);
});

test('AI 上下文兼容空值和无效消息', () => {
    assert.deepEqual(trimAiContext(null), []);
    assert.deepEqual(trimAiContext([
        null,
        { role: 'user', content: 123 },
        { role: 'tool', content: 'ignored' },
        { role: 'user', content: '保留' },
    ]), [{ role: 'user', content: '保留' }]);
});

test('AI 上下文：新的跨业务查询不携带历史库存写指令', () => {
    const context = scopeAiContextForTurn([
        { role: 'user', content: 'TEST-机筒-1100库存加100' },
        { role: 'assistant', content: '请核对库存调整确认卡片' },
        { role: 'user', content: '150-96的线圈库存+30' },
        { role: 'assistant', content: '请核对线圈库存确认卡片' },
        { role: 'user', content: '查一下模板V的明细' },
    ], {
        domains: ['recipe'],
        businessIntent: true,
        writeIntent: false,
        writeIntentSource: 'none',
    });

    assert.deepEqual(context, [
        { role: 'user', content: '查一下模板V的明细' },
    ]);
});

test('AI 上下文：缺参写入只继承紧邻的一轮而不是整段会话', () => {
    const context = scopeAiContextForTurn([
        { role: 'user', content: '查一下库存' },
        { role: 'assistant', content: '库存明细如下' },
        { role: 'user', content: '帮我录入零件' },
        { role: 'assistant', content: '请提供型号和单价' },
        { role: 'user', content: '14*28*39，单价0.5，类别油封' },
    ], {
        domains: ['catalog'],
        businessIntent: true,
        writeIntent: true,
        writeIntentSource: 'history',
    });

    assert.deepEqual(context.map(message => message.content), [
        '帮我录入零件',
        '请提供型号和单价',
        '14*28*39，单价0.5，类别油封',
    ]);
});

test('AI 获得本轮工具证据后移除历史助手结论但保留当前工具链', () => {
    const currentMessages = [
        { role: 'system', content: '系统规则' },
        { role: 'user', content: '切割杂草用哪个泵壳' },
        { role: 'assistant', content: '旧错误答案：SPA' },
        { role: 'user', content: '再查一次' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call-1' }] },
        { role: 'tool', tool_call_id: 'call-1', content: '800平刀切割泵壳' },
    ];

    const prioritized = prioritizeCurrentEvidence(currentMessages, 3);

    assert.deepEqual(prioritized.map(message => message.role), [
        'system', 'user', 'user', 'assistant', 'tool',
    ]);
    assert.equal(prioritized.some(message => message.content === '旧错误答案：SPA'), false);
    assert.equal(prioritized.at(-1).content, '800平刀切割泵壳');
});
