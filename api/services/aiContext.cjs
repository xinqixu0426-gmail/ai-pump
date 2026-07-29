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
    prioritizeCurrentEvidence,
};
