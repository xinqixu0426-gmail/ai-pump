const { Router } = require('express');
const dbAccessors = require('../db.cjs');
const { buildDataQualitySummary } = require('../services/qualitySummary.cjs');
const { buildBusinessAlerts } = require('../services/businessAlerts.cjs');
const { analyzeRecipeConfiguration } = require('../services/recipeIntelligence.cjs');
const {
    buildFactoryLearningHealth,
    buildFactoryRuleCompliance,
    buildFactoryRuleImpact,
    listFactoryRuleEvents,
    listFactoryRuleCandidates,
} = require('../services/factoryRuleCandidates.cjs');
const {
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');
const {
    REFRESH_RULE_CANDIDATES_CAPABILITY_ID,
    RESOLVE_RECIPE_FEEDBACK_CAPABILITY_ID,
    RESTORE_RULE_EVENT_CAPABILITY_ID,
    REVIEW_RULE_CANDIDATE_CAPABILITY_ID,
    SAVE_RECIPE_FEEDBACK_CAPABILITY_ID,
    executeRefreshFactoryRuleCandidates,
    executeResolveRecipeAnalysisFeedback,
    executeRestoreFactoryRuleEvent,
    executeReviewFactoryRuleCandidate,
    executeSaveRecipeAnalysisFeedback,
} = require('../services/qualityRuleCommands.cjs');

const router = Router();
const qualityCommandDependencies = {
    ...dbAccessors,
};

function legacyCommandResponse(receipt, entityKey) {
    return {
        ...receipt,
        operationStatus: receipt.status,
        ...receipt[entityKey],
    };
}

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
        const data = executeSaveRecipeAnalysisFeedback(
            qualityCommandDependencies,
            req.params.recipeId,
            req.body || {},
            commandContextFromRequest(
                req,
                SAVE_RECIPE_FEEDBACK_CAPABILITY_ID
            )
        );
        res.json({
            success: true,
            data: legacyCommandResponse(data, 'feedback'),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/recipe-feedback/:id/resolve', (req, res) => {
    try {
        const data = executeResolveRecipeAnalysisFeedback(
            qualityCommandDependencies,
            req.params.id,
            req.body || {},
            commandContextFromRequest(
                req,
                RESOLVE_RECIPE_FEEDBACK_CAPABILITY_ID
            )
        );
        res.json({
            success: true,
            data: legacyCommandResponse(data, 'feedback'),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.get('/rule-compliance', (req, res) => {
    try {
        res.json({ success: true, data: buildFactoryRuleCompliance() });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.get('/rule-learning-health', (req, res) => {
    try {
        res.json({
            success: true,
            data: buildFactoryLearningHealth({ limit: req.query.limit }),
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

router.get('/rule-events', (req, res) => {
    try {
        res.json({
            success: true,
            data: listFactoryRuleEvents({
                candidateId: req.query.candidateId,
                limit: req.query.limit,
            }),
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.post('/rule-events/:id/restore', (req, res) => {
    try {
        const data = executeRestoreFactoryRuleEvent(
            qualityCommandDependencies,
            req.params.id,
            req.body || {},
            commandContextFromRequest(
                req,
                RESTORE_RULE_EVENT_CAPABILITY_ID
            )
        );
        res.json({
            success: true,
            data: legacyCommandResponse(data, 'restoration'),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/rule-candidates/refresh', (req, res) => {
    try {
        const data = executeRefreshFactoryRuleCandidates(
            qualityCommandDependencies,
            req.body || {},
            commandContextFromRequest(
                req,
                REFRESH_RULE_CANDIDATES_CAPABILITY_ID
            )
        );
        res.json({
            success: true,
            data: legacyCommandResponse(data, 'learning'),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.get('/rule-candidates/:id/impact', (req, res) => {
    try {
        res.json({
            success: true,
            data: buildFactoryRuleImpact(req.params.id),
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.patch('/rule-candidates/:id', (req, res) => {
    try {
        const data = executeReviewFactoryRuleCandidate(
            qualityCommandDependencies,
            req.params.id,
            req.body || {},
            commandContextFromRequest(
                req,
                REVIEW_RULE_CANDIDATE_CAPABILITY_ID
            )
        );
        res.json({
            success: true,
            data: legacyCommandResponse(data, 'candidate'),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

module.exports = router;
