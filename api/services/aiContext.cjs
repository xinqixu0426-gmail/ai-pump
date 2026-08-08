const AI_CONTEXT_MESSAGE_LIMIT = 10;

function trimAiContext(messages) {
    if (!Array.isArray(messages)) return [];
    return messages
        .filter(message => (
            message
            && (message.role === 'user' || message.role === 'assistant')
            && typeof message.content === 'string'
        ))
        .slice(-AI_CONTEXT_MESSAGE_LIMIT)
        .map(message => ({
            role: message.role,
            content: message.content,
            ...(Array.isArray(message.attachments) && message.attachments.length > 0
                ? {
                    attachments: message.attachments
                        .map(attachment => ({ id: Number(attachment?.id ?? attachment?.fileId) }))
                        .filter(attachment => Number.isSafeInteger(attachment.id) && attachment.id > 0)
                        .slice(0, 4),
                }
                : {}),
        }));
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
 * V2 只接受意图规划器给出的结构化 contextMode，不再用语义正则猜测
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
