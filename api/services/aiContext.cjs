const AI_CONTEXT_MESSAGE_LIMIT = 10;
const {
    estimateTextTokens,
    fitTextToTokenBudget,
    resolveAiTokenBudgets,
} = require('./aiTokenBudget.cjs');

function trimAiContext(messages, options = {}) {
    if (!Array.isArray(messages)) return [];
    const candidates = messages
        .filter(message => (
            message
            && (message.role === 'user' || message.role === 'assistant')
            && typeof message.content === 'string'
        ))
        .slice(-AI_CONTEXT_MESSAGE_LIMIT);
    const maxTokens = Math.max(
        512,
        Number(options.maxTokens) || resolveAiTokenBudgets(options.env).historyTokens
    );
    const selected = [];
    let usedTokens = 0;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const message = candidates[index];
        const remaining = Math.max(0, maxTokens - usedTokens);
        if (remaining === 0) break;
        const marker = '\n[消息内容已按上下文 token 预算截断]';
        const needsTruncation = estimateTextTokens(message.content) > remaining;
        const fitted = fitTextToTokenBudget(
            message.content,
            needsTruncation
                ? Math.max(0, remaining - estimateTextTokens(marker))
                : remaining
        );
        if (!fitted.text) continue;
        selected.push({
            role: message.role,
            content: needsTruncation
                ? `${fitted.text}${marker}`
                : fitted.text,
            ...(Array.isArray(message.attachments) && message.attachments.length > 0
                ? {
                    attachments: message.attachments
                        .map(attachment => ({ id: Number(attachment?.id ?? attachment?.fileId) }))
                        .filter(attachment => Number.isSafeInteger(attachment.id) && attachment.id > 0)
                        .slice(0, 4),
                }
                : {}),
        });
        usedTokens += estimateTextTokens(fitted.text) + (needsTruncation ? estimateTextTokens(marker) : 0);
    }
    return selected.reverse();
}

function immediateConversationThread(messages) {
    const latestUserIndex = messages.findLastIndex(message => message?.role === 'user');
    if (latestUserIndex <= 0) return messages.slice(Math.max(0, latestUserIndex), latestUserIndex + 1);

    let priorUserIndex = -1;
    for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'user') {
            priorUserIndex = index;
            break;
        }
    }
    if (priorUserIndex < 0) return [messages[latestUserIndex]];
    return messages.slice(priorUserIndex, latestUserIndex + 1);
}

/**
 * V3 只接受意图规划器给出的结构化 contextMode，不再用语义正则猜测
 * 当前轮是否依赖历史。历史消息始终只是语言上下文，不是执行授权或事实证据。
 */
function scopeAiContextForIntent(messages, intent = {}) {
    const context = trimAiContext(messages);
    if (context.length <= 1) return context;

    const latestUser = [...context].reverse().find(message => message.role === 'user');
    if (!latestUser) return context;
    if (intent.mode === 'conversation') return context;
    if (intent.contextMode === 'previous_turn') {
        return immediateConversationThread(context);
    }
    return [latestUser];
}

function prioritizeCurrentEvidence(currentMessages, historyMessageCount) {
    if (!Array.isArray(currentMessages) || currentMessages.length === 0) return [];
    const historyCount = Math.max(0, Math.trunc(Number(historyMessageCount) || 0));
    const systemMessage = currentMessages[0];
    const history = currentMessages.slice(1, historyCount + 1);
    const currentRound = currentMessages.slice(historyCount + 1);
    return [
        systemMessage,
        ...history.filter(message => message?.role !== 'assistant'),
        ...currentRound,
    ].filter(Boolean);
}

module.exports = {
    AI_CONTEXT_MESSAGE_LIMIT,
    trimAiContext,
    scopeAiContextForIntent,
    prioritizeCurrentEvidence,
};
