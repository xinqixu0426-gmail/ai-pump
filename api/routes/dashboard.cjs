const { Router } = require('express');
const { buildDashboardBrief, buildBriefText } = require('../services/dashboardBrief.cjs');

const router = Router();

router.get('/brief', (req, res) => {
    try {
        const brief = buildDashboardBrief({
            dateKey: req.query.date ? String(req.query.date) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
        });
        res.json({
            success: true,
            data: {
                ...brief,
                text: buildBriefText(brief),
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
