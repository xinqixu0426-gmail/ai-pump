const { Router } = require('express');
const { buildDataQualitySummary } = require('../services/qualitySummary.cjs');
const { buildBusinessAlerts } = require('../services/businessAlerts.cjs');

const router = Router();

router.get('/summary', (req, res) => {
    try {
        res.json({ success: true, data: buildDataQualitySummary() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/business-alerts', (req, res) => {
    try {
        res.json({ success: true, data: buildBusinessAlerts() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
