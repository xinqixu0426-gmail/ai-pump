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

test('AI provider stream：记录首个可见字符耗时并读取供应商 usage', async () => {
    const body = [
        'data: {"choices":[{"delta":{"content":"完成"}}]}\n',
        'data: {"choices":[],"usage":{"prompt_tokens":80,"completion_tokens":10,"total_tokens":90},"timings":{"prompt_n":80,"prompt_ms":400,"predicted_n":10,"predicted_ms":275}}\n',
        'data: [DONE]\n',
    ].join('');
    const usageEvents = [];
    const firstContentEvents = [];
    const result = await readAiProviderStream(streamResponse(body), {
        onUsage: usage => usageEvents.push(usage),
        onFirstContent: event => firstContentEvents.push(event),
    });
    assert.deepEqual(result.usage, { promptTokens: 80, completionTokens: 10, totalTokens: 90 });
    assert.deepEqual(result.timings, {
        predictedTokens: 10,
        predictedMs: 275,
        tokensPerSecond: 36.4,
        promptTokens: 80,
        promptMs: 400,
        source: 'provider_timings',
    });
    assert.equal(result.ttftMs >= 0, true);
    assert.equal(usageEvents.length, 1);
    assert.equal(firstContentEvents.length, 1);
});

test('AI provider stream：无原生 timings 时只用足够长的内容分片估算生成速度', async () => {
    const response = new Response(new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"这是一段"}}]}\n'));
            await new Promise(resolve => setTimeout(resolve, 55));
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"足够长的回答"}}]}\n'));
            controller.enqueue(encoder.encode('data: {"choices":[],"usage":{"prompt_tokens":80,"completion_tokens":20,"total_tokens":100}}\n'));
            controller.enqueue(encoder.encode('data: [DONE]\n'));
            controller.close();
        },
    }));
    const result = await readAiProviderStream(response);
    assert.equal(result.timings.source, 'stream_observed');
    assert.equal(result.timings.predictedTokens, 20);
    assert.equal(result.timings.predictedMs >= 50, true);
    assert.equal(result.timings.tokensPerSecond > 0, true);
});

test('AI provider stream：短回复或单分片不伪造生成速度', async () => {
    const body = [
        'data: {"choices":[{"delta":{"content":"完成"}}]}\n',
        'data: {"choices":[],"usage":{"prompt_tokens":80,"completion_tokens":4,"total_tokens":84}}\n',
        'data: [DONE]\n',
    ].join('');
    const result = await readAiProviderStream(streamResponse(body));
    assert.equal(result.timings, null);
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

test('AI provider stream：保留 K3 reasoning_content 供后续工具轮原样回传', async () => {
    const body = [
        'data: {"choices":[{"delta":{"reasoning_content":"先核对附件"}}]}\n',
        'data: {"choices":[{"delta":{"content":"完成"}}]}\n',
        'data: [DONE]\n',
    ].join('');
    const result = await readAiProviderStream(streamResponse(body));
    assert.equal(result.reasoningContent, '先核对附件');
    assert.equal(result.content, '完成');
});

test('AI provider stream：响应体中断映射为前端可重试网络错误', async () => {
    const socketError = Object.assign(new Error('socket ended'), { code: 'UND_ERR_SOCKET' });
    const terminated = new TypeError('terminated', { cause: socketError });
    const response = new Response(new ReadableStream({
        start(controller) {
            controller.error(terminated);
        },
    }));

    await assert.rejects(
        () => readAiProviderStream(response),
        error => error.code === 'AI_PROVIDER_NETWORK_ERROR'
            && error.retryable === true
            && /UND_ERR_SOCKET/.test(error.message)
    );
});

test('AI provider stream：调用方取消时终止 reader 并保留取消错误码', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const response = new Response(new ReadableStream({
        start(streamController) {
            streamController.enqueue(new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"开始"}}]}\n'
            ));
        },
        cancel() {
            cancelled = true;
        },
    }));
    const pending = readAiProviderStream(response, { signal: controller.signal });
    controller.abort(Object.assign(new Error('用户取消'), {
        name: 'AbortError',
        code: 'AI_REQUEST_CANCELLED',
    }));
    await assert.rejects(pending, error => error.code === 'AI_REQUEST_CANCELLED');
    assert.equal(cancelled, true);
});
