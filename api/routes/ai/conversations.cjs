const { Router } = require('express');
const authMiddleware = require('../../authMiddleware.cjs');
const { parsePositiveId } = require('../../services/validation.cjs');
const {
    listAiConversations,
    createAiConversation,
    getAiConversation,
    appendAiConversationMessage,
    updateAiConversationMessage,
    deleteAiConversation,
} = require('../../services/aiConversations.cjs');

const router = Router();

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
        const data = createAiConversation(req.aiConversationOwner, req.body?.title);
        res.status(201).json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
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
        const data = appendAiConversationMessage(req.aiConversationOwner, id, req.body || {});
        if (!data) return res.status(404).json({ success: false, error: '会话不存在' });
        res.status(201).json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.patch('/api/ai/conversations/:id/messages/:messageId', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        const messageId = parsePositiveId(req.params.messageId);
        if (!id || !messageId) return res.status(400).json({ success: false, error: '非法会话或消息ID' });
        const data = updateAiConversationMessage(req.aiConversationOwner, id, messageId, req.body?.metadata);
        if (!data) return res.status(404).json({ success: false, error: '会话消息不存在' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.delete('/api/ai/conversations/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法会话ID' });
        if (!deleteAiConversation(req.aiConversationOwner, id)) return res.status(404).json({ success: false, error: '会话不存在' });
        res.json({ success: true, data: { id } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
