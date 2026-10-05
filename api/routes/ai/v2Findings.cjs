const { Router } = require('express');
const authMiddleware = require('../../authMiddleware.cjs');
const dbAccessors = require('../../db.cjs');
const {
    listV2Findings,
    getV2FindingDetail,
    saveV2Finding,
    updateV2Finding,
} = require('../../services/aiV2Findings.cjs');

const router = Router();

router.use('/api/ai/v2-findings', authMiddleware, (req, _res, next) => {
    req.v2FindingOwner = req.user?.role || 'admin';
    next();
});

router.get('/api/ai/v2-findings', (req, res) => {
    try {
        const data = listV2Findings(req.v2FindingOwner, {
            status: req.query.status,
            category: req.query.category,
            conversationId: req.query.conversationId,
            limit: req.query.limit,
        }, { dbAccessors });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.get('/api/ai/v2-findings/:id', (req, res) => {
    try {
        const data = getV2FindingDetail(req.v2FindingOwner, req.params.id, { dbAccessors });
        if (!data) return res.status(404).json({ success: false, error: 'V2 记录不存在' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/api/ai/v2-findings', (req, res) => {
    try {
        const data = saveV2Finding(req.v2FindingOwner, req.body || {}, { dbAccessors });
        if (!data) return res.status(404).json({ success: false, error: '回答不存在或不属于当前用户' });
        res.status(201).json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.patch('/api/ai/v2-findings/:id', (req, res) => {
    try {
        const data = updateV2Finding(req.v2FindingOwner, req.params.id, req.body || {}, { dbAccessors });
        if (!data) return res.status(404).json({ success: false, error: 'V2 记录不存在' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(error.code === 'VERSION_CONFLICT' ? 409 : 400)
            .json({ success: false, error: error.message, code: error.code || undefined });
    }
});

module.exports = router;
