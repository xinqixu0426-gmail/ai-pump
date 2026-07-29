const { Router } = require('express');
const { buildBusinessSummary } = require('../services/businessSummary.cjs');
const { buildManagementActionCenter } = require('../services/managementActionCenter.cjs');
const {
    decorateManagementActionCenter,
    lifecycleOverview,
    listManagementActionLifecycles,
} = require('../services/managementActionLifecycle.cjs');

const router = Router();

router.get('/summary', (req, res) => {
    try {
        res.json({ success: true, data: buildBusinessSummary() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/action-center', (req, res) => {
    try {
        const center = buildManagementActionCenter();
        res.json({ success: true, data: decorateManagementActionCenter(center) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/action-history', (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                metrics: lifecycleOverview(),
                items: listManagementActionLifecycles({
                    status: req.query.status,
                    limit: req.query.limit,
                }),
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
