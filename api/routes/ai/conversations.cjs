const { Router } = require('express');
const authMiddleware = require('../../authMiddleware.cjs');
const {
    aiConversationMessageRow,
    aiConversationRow,
    db,
    safeInsert,
    safeUpdate,
} = require('../../db.cjs');
const { parsePositiveId } = require('../../services/validation.cjs');
const {
    commandContextFromRequest,
    sendCommandError,
} = require('../../services/commandRequest.cjs');
const {
    listAiConversations,
    getAiConversation,
} = require('../../services/aiConversations.cjs');
const {
    APPEND_MESSAGE_CAPABILITY_ID,
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    UPDATE_MESSAGE_CAPABILITY_ID,
    executeAppendAiConversationMessage,
    executeCreateAiConversation,
    executeDeleteAiConversation,
    executeUpdateAiConversationMessage,
} = require('../../services/aiConversationCommands.cjs');

const router = Router();
const aiConversationDependencies = {
    aiConversationMessageRow,
    aiConversationRow,
    db,
    safeInsert,
    safeUpdate,
};

function conversationAuth(req, res, next) {
    if (process.env.INTERNAL_SECRET && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET) {
        req.aiConversationOwner = 'internal';
        return next();
    }
    return authMiddleware(req, res, () => {
        req.aiConversationOwner = req.user?.role || 'admin';
        next();
    });
}

router.use('/api/ai/conversations', conversationAuth);

router.get('/api/ai/conversations', (req, res) => {
    try {
        const data = listAiConversations(req.aiConversationOwner, { limit: req.query.limit });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/api/ai/conversations', (req, res) => {
    try {
        const data = executeCreateAiConversation(
            aiConversationDependencies,
            req.aiConversationOwner,
            req.body || {},
            commandContextFromRequest(req, CREATE_CAPABILITY_ID)
        );
        res.status(data.idempotentReplay ? 200 : 201).json({ success: true, data });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.get('/api/ai/conversations/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法会话ID' });
        const data = getAiConversation(req.aiConversationOwner, id);
        if (!data) return res.status(404).json({ success: false, error: '会话不存在' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/api/ai/conversations/:id/messages', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法会话ID' });
        const data = executeAppendAiConversationMessage(
            aiConversationDependencies,
            req.aiConversationOwner,
            id,
            req.body || {},
            commandContextFromRequest(req, APPEND_MESSAGE_CAPABILITY_ID)
        );
        res.status(data.idempotentReplay ? 200 : 201).json({ success: true, data });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.patch('/api/ai/conversations/:id/messages/:messageId', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        const messageId = parsePositiveId(req.params.messageId);
        if (!id || !messageId) return res.status(400).json({ success: false, error: '非法会话或消息ID' });
        const data = executeUpdateAiConversationMessage(
            aiConversationDependencies,
            req.aiConversationOwner,
            id,
            messageId,
            req.body || {},
            commandContextFromRequest(req, UPDATE_MESSAGE_CAPABILITY_ID)
        );
        res.json({ success: true, data });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.delete('/api/ai/conversations/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法会话ID' });
        const data = executeDeleteAiConversation(
            aiConversationDependencies,
            req.aiConversationOwner,
            id,
            req.body || {},
            commandContextFromRequest(req, DELETE_CAPABILITY_ID)
        );
        res.json({ success: true, data });
    } catch (error) {
        sendCommandError(res, error);
    }
});

module.exports = router;
