const test = require('node:test');
const assert = require('node:assert/strict');
const {
    allocateAiInputTokenBudget,
    estimateAiMessagesTokens,
    estimateTextTokens,
    fitTextToTokenBudget,
    normalizeProviderUsage,
    resolveAiTokenBudgets,
} = require('../api/services/aiTokenBudget.cjs');
const {
    chunkText,
    selectRelevantTextChunks,
} = require('../api/services/aiTextChunks.cjs');

test('AI token 预算：中英文、空文本和自定义环境边界保持确定性', () => {
    assert.equal(estimateTextTokens(''), 0);
    assert.equal(estimateTextTokens('水泵订单'), 4);
    assert.equal(estimateTextTokens('abcdefgh'), 2);
    const fitted = fitTextToTokenBudget('这是一个很长的中文句子', 5);
    assert.equal(fitted.tokens <= 5, true);
    assert.equal(fitted.truncated, true);
    const budgets = resolveAiTokenBudgets({
        AI_CONTEXT_WINDOW_TOKENS: '16384',
        AI_RESERVED_OUTPUT_TOKENS: '2048',
        AI_ATTACHMENT_CONTEXT_TOKENS: '4096',
    });
    assert.equal(budgets.usableInputTokens, 14336);
    assert.equal(budgets.attachmentTokens, 4096);
});

test('AI token 预算：只有供应商明确返回的 usage 才归一化为真实用量', () => {
    assert.deepEqual(normalizeProviderUsage({
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
    }), { promptTokens: 100, completionTokens: 20, totalTokens: 120 });
    assert.equal(normalizeProviderUsage({ estimated_tokens: 120 }), null);
    assert.equal(normalizeProviderUsage(null), null);
});

test('AI token 预算：系统提示、历史、工具 schema 与动态载荷共享同一输入窗口', () => {
    const messages = [
        { role: 'system', content: '系统规则'.repeat(900) },
        { role: 'user', content: '当前问题'.repeat(350) },
    ];
    const tools = [{ type: 'function', function: { name: 'query', description: '工具说明'.repeat(200) } }];
    const allocation = allocateAiInputTokenBudget({
        env: {
            AI_CONTEXT_WINDOW_TOKENS: '8192',
            AI_RESERVED_OUTPUT_TOKENS: '1024',
        },
        messages,
        tools,
        toolChoice: 'required',
        requestedTokens: 4096,
    });
    assert.equal(allocation.fixedTokens, estimateAiMessagesTokens(messages)
        + estimateTextTokens(JSON.stringify(tools))
        + estimateTextTokens(JSON.stringify('required')));
    assert.equal(allocation.fixedTokens + allocation.grantedTokens <= allocation.usableInputTokens, true);
    assert.equal(allocation.grantedTokens < 4096, true);
});

test('长文本分片：问题位于旧 100KB 截断点之后时仍选择后半段相关片段并保留位置', () => {
    const prefix = '普通说明。'.repeat(30000);
    const marker = '关键绕组数据：主绕组 168 匝，副绕组 212 匝。';
    const source = `${prefix}\n${marker}\n结尾说明。`;
    assert.equal(Buffer.byteLength(prefix, 'utf8') > 100 * 1024, true);
    const chunks = selectRelevantTextChunks(source, '主绕组是多少匝', {
        maxTokens: 900,
        maxChunks: 3,
        maxChunkTokens: 400,
    });
    assert.equal(chunks.some(chunk => chunk.content.includes('主绕组 168 匝')), true);
    assert.equal(chunks.some(chunk => chunk.charStart > 100 * 1024 / 3), true);
    assert.equal(chunks.every(chunk => chunk.estimatedTokens <= 400), true);
    assert.equal(chunkText(source, { maxChunkTokens: 400 }).length > 1, true);
});
