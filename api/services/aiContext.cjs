const AI_CONTEXT_MESSAGE_LIMIT = 10;
const CONTEXT_DEPENDENT_TURN_RE = /^(?:(?:再|重新|继续|接着|然后)(?:查|看|试|执行|处理)?(?:一下|一次)?|(?:这个|那个|这些|那些|它)(?:呢|怎么样|是什么|有多少)?|(?:上面|上述|刚才|前面)(?:的|那个|结果)?|确认|是|好|可以|同意|执行|提交|为什么|怎么处理|下一步)[？?。！!\s]*$/;

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
 * The 10-message window is conversational memory, not executable business state.
 * A new explicit business turn starts with clean model context. Only a genuine
 * follow-up may inherit the immediately preceding turn.
 */
function scopeAiContextForTurn(messages, route = {}) {
    const context = trimAiContext(messages);
    if (context.length <= 1) return context;

    const latestUser = [...context].reverse().find(message => message.role === 'user');
    if (!latestUser) return context;
    const isBusinessTurn = (
        route.businessIntent
        || route.writeIntent
        || (Array.isArray(route.domains) && route.domains.length > 0)
    );
    if (!isBusinessTurn) return context;

    if (
        route.writeIntentSource === 'history'
        || CONTEXT_DEPENDENT_TURN_RE.test(latestUser.content.trim())
    ) {
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
    scopeAiContextForTurn,
    prioritizeCurrentEvidence,
};
