const test = require('node:test');
const assert = require('node:assert/strict');
const { readAiProviderStream } = require('../api/services/aiProviderStream.cjs');

function streamResponse(text, splitPoints = []) {
    const bytes = new TextEncoder().encode(text);
    const chunks = [];
    let offset = 0;
    for (const point of splitPoints) {
        const end = Math.max(offset, Math.min(bytes.length, point));
        chunks.push(bytes.slice(offset, end));
        offset = end;
    }
    chunks.push(bytes.slice(offset));

    return new Response(new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
        },
    }));
}

test('AI provider stream：跨网络与中文字符分片后仍完整聚合文本', async () => {
    const body = [
        'data: {"choices":[{"delta":{"content":"正在"}}]}\n',
        'data: {"choices":[{"delta":{"content":"查询订单"}}]}\n',
        'data: [DONE]\n',
    ].join('');
    const received = [];

    const result = await readAiProviderStream(streamResponse(body, [7, 31, 58, 79]), {
        onContent: content => received.push(content),
    });

    assert.equal(result.content, '正在查询订单');
    assert.deepEqual(received, ['正在', '查询订单']);
    assert.deepEqual(result.toolCalls, []);
});

test('AI provider stream：按 index 合并碎片化工具调用并保持顺序', async () => {
    const body = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","type":"function","function":{"name":"search_","arguments":"{\\"query\\":\\"轴"}}]}}]}\r\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"get_","arguments":"{\\"limit\\":"}},{"index":1,"function":{"name":"parts","arguments":"承\\"}"}}]}}]}\r\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"recent_orders","arguments":"5}"}}]}}]}\r\n',
        'data: [DONE]\r\n',
    ].join('');

    const result = await readAiProviderStream(streamResponse(body, [1, 13, 67, 141, 263]));

    assert.deepEqual(result.toolCalls, [
        {
            id: 'call_a',
            type: 'function',
            function: { name: 'get_recent_orders', arguments: '{"limit":5}' },
        },
        {
            id: 'call_b',
            type: 'function',
            function: { name: 'search_parts', arguments: '{"query":"轴承"}' },
        },
    ]);
});

test('AI provider stream：忽略非 JSON 状态行并处理末尾无换行事件', async () => {
    const body = [
        'event: status\n',
        'data: provider warming up\n',
        'data: {"choices":[]}\n',
        'data: {"choices":[{"delta":{"content":"完成"}}]}',
    ].join('');

    const result = await readAiProviderStream(streamResponse(body, [20, 45]));

    assert.equal(result.content, '完成');
    assert.deepEqual(result.toolCalls, []);
});

test('AI provider stream：缺少可读 body 时返回明确协议错误', async () => {
    await assert.rejects(
        () => readAiProviderStream({ body: null }),
        /AI 提供商未返回可读取的数据流/
    );
});
