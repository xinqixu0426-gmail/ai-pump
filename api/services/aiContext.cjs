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
        .map(message => ({ role: message.role, content: message.content }));
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
