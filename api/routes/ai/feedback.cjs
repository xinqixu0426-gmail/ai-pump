const { Router } = require('express');
const authMiddleware = require('../../authMiddleware.cjs');
const { parsePositiveId } = require('../../services/validation.cjs');
const {
    submitAiAnswerFeedback,
    listAiAnswerFeedback,
    reviewAiAnswerFeedback,
    diagnoseAiAnswerFeedback,
    recordAiAnswerFeedbackRetest,
} = require('../../services/aiAnswerFeedback.cjs');
const {
    listFactoryAiRules,
    updateFactoryAiRule,
} = require('../../services/factoryAiRules.cjs');

const router = Router();

function feedbackAuth(req, res, next) {
    if (process.env.INTERNAL_SECRET && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET) {
        req.aiFeedbackOwner = 'internal';
        return next();
    }
    return authMiddleware(req, res, () => {
        req.aiFeedbackOwner = req.user?.role || 'admin';
        next();
    });
}

router.use('/api/ai/feedback', feedbackAuth);
router.use('/api/ai/learning-rules', feedbackAuth);

router.get('/api/ai/feedback', (req, res) => {
    try {
        const data = listAiAnswerFeedback(req.aiFeedbackOwner, {
            conversationId: req.query.conversationId,
            status: req.query.status,
            rating: req.query.rating,
            limit: req.query.limit,
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/api/ai/feedback', (req, res) => {
    try {
        const data = submitAiAnswerFeedback(req.aiFeedbackOwner, req.body || {});
        if (!data) return res.status(404).json({ success: false, error: 'AI 回复不存在' });
        res.status(201).json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/api/ai/feedback/:id/diagnose', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法反馈ID' });
        const data = diagnoseAiAnswerFeedback(req.aiFeedbackOwner, id);
        if (!data) return res.status(404).json({ success: false, error: '反馈不存在' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/api/ai/feedback/:id/retest', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法反馈ID' });
        const data = recordAiAnswerFeedbackRetest(req.aiFeedbackOwner, id, req.body || {});
        if (!data) return res.status(404).json({ success: false, error: '反馈不存在' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.patch('/api/ai/feedback/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法反馈ID' });
        const data = reviewAiAnswerFeedback(req.aiFeedbackOwner, id, req.body || {});
        if (!data) return res.status(404).json({ success: false, error: '反馈不存在' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.get('/api/ai/learning-rules', (req, res) => {
    try {
        const data = listFactoryAiRules({
            status: req.query.status,
            limit: req.query.limit,
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.patch('/api/ai/learning-rules/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法规则ID' });
        const data = updateFactoryAiRule(id, req.body || {});
        if (!data) return res.status(404).json({ success: false, error: '纠正规则不存在' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

module.exports = router;
