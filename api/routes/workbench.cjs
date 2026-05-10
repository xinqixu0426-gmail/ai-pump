const { Router } = require('express');
const { buildBusinessSummary } = require('../services/businessSummary.cjs');

const router = Router();

router.get('/summary', (req, res) => {
    try {
        res.json({ success: true, data: buildBusinessSummary() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
