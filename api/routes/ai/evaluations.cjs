const { Router } = require('express');
const authMiddleware = require('../../authMiddleware.cjs');
const { parsePositiveId } = require('../../services/validation.cjs');
const {
    getAiEvaluationOverview,
    createAiEvaluationRun,
    recordAiEvaluationResult,
    completeAiEvaluationRun,
} = require('../../services/aiEvaluations.cjs');

const router = Router();

function evaluationAuth(req, res, next) {
    if (process.env.INTERNAL_SECRET && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET) {
        req.aiEvaluationOwner = 'internal';
        return next();
    }
    return authMiddleware(req, res, () => {
        req.aiEvaluationOwner = req.user?.role || 'admin';
        next();
    });
}

router.use('/api/ai/evaluations', evaluationAuth);

router.get('/api/ai/evaluations/overview', (req, res) => {
    try {
        res.json({ success: true, data: getAiEvaluationOverview(req.aiEvaluationOwner) });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/api/ai/evaluations/runs', (req, res) => {
    try {
        res.status(201).json({ success: true, data: createAiEvaluationRun(req.aiEvaluationOwner) });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/api/ai/evaluations/runs/:id/results', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法运行ID' });
        const data = recordAiEvaluationResult(req.aiEvaluationOwner, id, req.body || {});
        if (!data) return res.status(404).json({ success: false, error: '检查运行不存在' });
        res.status(201).json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/api/ai/evaluations/runs/:id/complete', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法运行ID' });
        const data = completeAiEvaluationRun(req.aiEvaluationOwner, id);
        if (!data) return res.status(404).json({ success: false, error: '检查运行不存在' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

module.exports = router;
