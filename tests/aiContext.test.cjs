const test = require('node:test');
const assert = require('node:assert/strict');
const { AI_CONTEXT_MESSAGE_LIMIT, trimAiContext } = require('../api/services/aiContext.cjs');

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
