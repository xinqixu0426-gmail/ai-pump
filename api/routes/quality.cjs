const { Router } = require('express');
const { buildDataQualitySummary } = require('../services/qualitySummary.cjs');
const { buildBusinessAlerts } = require('../services/businessAlerts.cjs');
const { analyzeRecipeConfiguration } = require('../services/recipeIntelligence.cjs');
const { saveRecipeAnalysisFeedback } = require('../services/recipeAnalysisFeedback.cjs');
const {
    listFactoryRuleCandidates,
    refreshFactoryRuleCandidates,
    reviewFactoryRuleCandidate,
} = require('../services/factoryRuleCandidates.cjs');

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

router.post('/recipe-analysis', (req, res) => {
    try {
        res.json({ success: true, data: analyzeRecipeConfiguration(req.body || {}) });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.post('/recipes/:recipeId/feedback', (req, res) => {
    try {
        res.json({
            success: true,
            data: saveRecipeAnalysisFeedback(req.params.recipeId, req.body || {}),
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.get('/rule-candidates', (req, res) => {
    try {
        res.json({
            success: true,
            data: listFactoryRuleCandidates({ status: req.query.status }),
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.post('/rule-candidates/refresh', (req, res) => {
    try {
        res.json({ success: true, data: refreshFactoryRuleCandidates() });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.patch('/rule-candidates/:id', (req, res) => {
    try {
        res.json({
            success: true,
            data: reviewFactoryRuleCandidate(req.params.id, req.body || {}),
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

module.exports = router;
