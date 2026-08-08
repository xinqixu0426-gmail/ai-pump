function appendToolCallDelta(toolCallsByIndex, delta) {
    const index = Number.isSafeInteger(delta?.index) ? delta.index : 0;
    const existing = toolCallsByIndex.get(index) || {
        id: '',
        type: delta?.type || 'function',
        function: {
            name: '',
            arguments: '',
        },
    };

    if (delta?.id) existing.id += delta.id;
    if (delta?.type) existing.type = delta.type;
    if (delta?.function?.name) existing.function.name += delta.function.name;
    if (delta?.function?.arguments) existing.function.arguments += delta.function.arguments;
    toolCallsByIndex.set(index, existing);
}

function consumeProviderEvent(line, state, onContent) {
    const trimmed = String(line || '').trim();
    if (!trimmed.startsWith('data:')) return;

    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;

    try {
        const data = JSON.parse(payload);
        const delta = data?.choices?.[0]?.delta;
        if (!delta) return;

        if (typeof delta.content === 'string' && delta.content) {
            state.content += delta.content;
            onContent(delta.content);
        }
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
            state.reasoningContent += delta.reasoning_content;
        }
        if (Array.isArray(delta.tool_calls)) {
            for (const toolCall of delta.tool_calls) {
                appendToolCallDelta(state.toolCallsByIndex, toolCall);
            }
        }
    } catch {
        // 第三方 OpenAI 兼容服务偶尔会混入非 JSON 状态行；忽略单行，不中断整轮对话。
    }
}

function providerStreamNetworkError(error) {
    const causeCode = String(error?.cause?.code || error?.code || '').trim();
    const detail = causeCode ? `（${causeCode}）` : '';
    const wrapped = new Error(`AI 提供商响应流中断${detail}，请重试`);
    wrapped.name = 'AiProviderNetworkError';
    wrapped.code = 'AI_PROVIDER_NETWORK_ERROR';
    wrapped.retryable = true;
    wrapped.details = { provider: null, action: '响应流', causeCode: causeCode || null };
    wrapped.cause = error;
    return wrapped;
}

async function readAiProviderStream(response, options = {}) {
    if (!response?.body || typeof response.body.getReader !== 'function') {
        throw new Error('AI 提供商未返回可读取的数据流');
    }

    const onContent = typeof options.onContent === 'function' ? options.onContent : () => {};
    const decoder = new TextDecoder('utf-8');
    const reader = response.body.getReader();
    const state = {
        content: '',
        reasoningContent: '',
        toolCallsByIndex: new Map(),
    };
    let buffer = '';

    while (true) {
        let chunk;
        try {
            chunk = await reader.read();
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            throw providerStreamNetworkError(error);
        }
        const { done, value } = chunk;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
            consumeProviderEvent(line, state, onContent);
        }
    }

    buffer += decoder.decode();
    for (const line of buffer.split(/\r?\n/)) {
        consumeProviderEvent(line, state, onContent);
    }

    return {
        content: state.content,
        reasoningContent: state.reasoningContent,
        toolCalls: [...state.toolCallsByIndex.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, toolCall]) => toolCall),
    };
}

module.exports = {
    providerStreamNetworkError,
    readAiProviderStream,
};
