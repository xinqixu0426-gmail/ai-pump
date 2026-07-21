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

module.exports = { AI_CONTEXT_MESSAGE_LIMIT, trimAiContext };
