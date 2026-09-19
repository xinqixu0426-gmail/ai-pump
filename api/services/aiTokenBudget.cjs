const DEFAULT_CONTEXT_WINDOW_TOKENS = 32 * 1024;
const DEFAULT_RESERVED_OUTPUT_TOKENS = 4 * 1024;
const DEFAULT_ATTACHMENT_TOKENS = 8 * 1024;
const DEFAULT_HISTORY_TOKENS = 8 * 1024;
const DEFAULT_KNOWLEDGE_EXCERPT_TOKENS = 6 * 1024;
const DEFAULT_EVIDENCE_TOKENS = 16 * 1024;
const DEFAULT_IMAGE_INPUT_RESERVE_TOKENS = 2 * 1024;

function boundedInteger(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), minimum), maximum);
}

// Provider-neutral conservative estimate used only for local prompt budgeting.
// It must never be presented as provider billing or actual usage.
function estimateTextTokens(value) {
    const text = String(value || '');
    if (!text) return 0;
    let total = 0;
    let asciiRun = '';
    const flushAscii = () => {
        if (!asciiRun) return;
        total += Math.max(1, Math.ceil(asciiRun.length / 4));
        asciiRun = '';
    };
    for (const character of text) {
        if (/[A-Za-z0-9_]/.test(character)) {
            asciiRun += character;
            continue;
        }
        flushAscii();
        if (/\s/u.test(character)) continue;
        total += 1;
    }
    flushAscii();
    return total;
}

function resolveAiTokenBudgets(env = process.env) {
    const contextWindowTokens = boundedInteger(
        env.AI_CONTEXT_WINDOW_TOKENS,
        DEFAULT_CONTEXT_WINDOW_TOKENS,
        8 * 1024,
        1024 * 1024
    );
    const reservedOutputTokens = boundedInteger(
        env.AI_RESERVED_OUTPUT_TOKENS,
        DEFAULT_RESERVED_OUTPUT_TOKENS,
        512,
        Math.max(512, Math.floor(contextWindowTokens / 2))
    );
    const usableInputTokens = Math.max(1024, contextWindowTokens - reservedOutputTokens);
    return Object.freeze({
        contextWindowTokens,
        reservedOutputTokens,
        usableInputTokens,
        attachmentTokens: boundedInteger(
            env.AI_ATTACHMENT_CONTEXT_TOKENS,
            DEFAULT_ATTACHMENT_TOKENS,
            512,
            usableInputTokens
        ),
        historyTokens: boundedInteger(
            env.AI_HISTORY_CONTEXT_TOKENS,
            DEFAULT_HISTORY_TOKENS,
            512,
            usableInputTokens
        ),
        knowledgeExcerptTokens: boundedInteger(
            env.AI_KNOWLEDGE_EXCERPT_TOKENS,
            DEFAULT_KNOWLEDGE_EXCERPT_TOKENS,
            256,
            usableInputTokens
        ),
        evidenceTokens: boundedInteger(
            env.AI_EVIDENCE_CONTEXT_TOKENS,
            DEFAULT_EVIDENCE_TOKENS,
            1024,
            usableInputTokens
        ),
    });
}

function fitTextToTokenBudget(value, maxTokens) {
    const source = String(value || '');
    const limit = Math.max(0, Math.trunc(Number(maxTokens) || 0));
    const originalTokens = estimateTextTokens(source);
    if (originalTokens <= limit) {
        return { text: source, tokens: originalTokens, originalTokens, truncated: false };
    }
    if (limit === 0) return { text: '', tokens: 0, originalTokens, truncated: Boolean(source) };
    const characters = [...source];
    let low = 0;
    let high = characters.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (estimateTextTokens(characters.slice(0, middle).join('')) <= limit) low = middle;
        else high = middle - 1;
    }
    const text = characters.slice(0, low).join('');
    return {
        text,
        tokens: estimateTextTokens(text),
        originalTokens,
        truncated: true,
    };
}

function estimateMessageContentTokens(content) {
    if (typeof content === 'string') return estimateTextTokens(content);
    if (!Array.isArray(content)) return estimateTextTokens(JSON.stringify(content || ''));
    return content.reduce((total, part) => {
        if (part?.type === 'text') return total + estimateTextTokens(part.text);
        if (part?.type === 'image_url') return total + DEFAULT_IMAGE_INPUT_RESERVE_TOKENS;
        return total + estimateTextTokens(JSON.stringify(part || ''));
    }, 0);
}

function estimateAiMessagesTokens(messages = []) {
    return (Array.isArray(messages) ? messages : []).reduce((total, message) => {
        if (!message || typeof message !== 'object') return total;
        const structural = { ...message };
        delete structural.content;
        delete structural.attachments;
        return total
            + 4
            + estimateTextTokens(JSON.stringify(structural))
            + estimateMessageContentTokens(message.content);
    }, 0);
}

function allocateAiInputTokenBudget(input = {}) {
    const budgets = resolveAiTokenBudgets(input.env);
    const fixedTokens = estimateAiMessagesTokens(input.messages)
        + estimateTextTokens(JSON.stringify(input.tools || []))
        + estimateTextTokens(JSON.stringify(input.toolChoice || null));
    const availableTokens = Math.max(0, budgets.usableInputTokens - fixedTokens);
    const requestedTokens = Math.max(0, Math.trunc(Number(input.requestedTokens) || 0));
    const grantedTokens = Math.min(requestedTokens, availableTokens);
    return Object.freeze({
        ...budgets,
        fixedTokens,
        availableTokens,
        requestedTokens,
        grantedTokens,
        overflowTokens: Math.max(0, fixedTokens - budgets.usableInputTokens),
        inputFits: fixedTokens <= budgets.usableInputTokens,
    });
}

function normalizeProviderUsage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const integer = candidate => {
        const parsed = Number(candidate);
        return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
    };
    const promptTokens = integer(
        value.promptTokens ?? value.prompt_tokens ?? value.inputTokens ?? value.input_tokens
    );
    const completionTokens = integer(
        value.completionTokens
        ?? value.completion_tokens
        ?? value.outputTokens
        ?? value.output_tokens
    );
    let totalTokens = integer(value.totalTokens ?? value.total_tokens);
    if (totalTokens == null && promptTokens != null && completionTokens != null) {
        totalTokens = promptTokens + completionTokens;
    }
    if (promptTokens == null && completionTokens == null && totalTokens == null) return null;
    return Object.freeze({ promptTokens, completionTokens, totalTokens });
}

module.exports = {
    DEFAULT_ATTACHMENT_TOKENS,
    DEFAULT_CONTEXT_WINDOW_TOKENS,
    DEFAULT_EVIDENCE_TOKENS,
    DEFAULT_HISTORY_TOKENS,
    DEFAULT_IMAGE_INPUT_RESERVE_TOKENS,
    DEFAULT_KNOWLEDGE_EXCERPT_TOKENS,
    DEFAULT_RESERVED_OUTPUT_TOKENS,
    allocateAiInputTokenBudget,
    estimateAiMessagesTokens,
    estimateTextTokens,
    fitTextToTokenBudget,
    normalizeProviderUsage,
    resolveAiTokenBudgets,
};
