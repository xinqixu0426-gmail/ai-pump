const { Router } = require('express');
const authMiddleware = require('../../authMiddleware.cjs');
const dbAccessors = require('../../db.cjs');
const { parsePositiveId } = require('../../services/validation.cjs');
const {
    commandContextFromRequest,
    sendCommandError,
} = require('../../services/commandRequest.cjs');
const {
    listAiAnswerFeedback,
} = require('../../services/aiAnswerFeedback.cjs');
const {
    listFactoryAiRules,
} = require('../../services/factoryAiRules.cjs');
const {
    DIAGNOSE_FEEDBACK_CAPABILITY_ID,
    RETEST_FEEDBACK_CAPABILITY_ID,
    REVIEW_FEEDBACK_CAPABILITY_ID,
    SUBMIT_FEEDBACK_CAPABILITY_ID,
    UPDATE_LEARNING_RULE_CAPABILITY_ID,
    executeDiagnoseAiAnswerFeedback,
    executeRetestAiAnswerFeedback,
    executeReviewAiAnswerFeedback,
    executeSubmitAiAnswerFeedback,
    executeUpdateFactoryAiRule,
} = require('../../services/aiFeedbackCommands.cjs');

const router = Router();
const aiFeedbackDependencies = {
    ...dbAccessors,
};

function legacyFeedbackEntityResponse(receipt, entityKey) {
    return {
        ...receipt,
        operationStatus: receipt.status,
        ...receipt[entityKey],
    };
}

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
        const data = executeSubmitAiAnswerFeedback(
            aiFeedbackDependencies,
            req.aiFeedbackOwner,
            req.body || {},
            commandContextFromRequest(req, SUBMIT_FEEDBACK_CAPABILITY_ID)
        );
        res.status(data.idempotentReplay ? 200 : 201).json({
            success: true,
            data: legacyFeedbackEntityResponse(data, 'feedback'),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/api/ai/feedback/:id/diagnose', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法反馈ID' });
        const data = executeDiagnoseAiAnswerFeedback(
            aiFeedbackDependencies,
            req.aiFeedbackOwner,
            id,
            req.body || {},
            commandContextFromRequest(req, DIAGNOSE_FEEDBACK_CAPABILITY_ID)
        );
        res.json({
            success: true,
            data: legacyFeedbackEntityResponse(data, 'feedback'),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/api/ai/feedback/:id/retest', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法反馈ID' });
        const data = executeRetestAiAnswerFeedback(
            aiFeedbackDependencies,
            req.aiFeedbackOwner,
            id,
            req.body || {},
            commandContextFromRequest(req, RETEST_FEEDBACK_CAPABILITY_ID)
        );
        res.json({
            success: true,
            data: legacyFeedbackEntityResponse(data, 'feedback'),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.patch('/api/ai/feedback/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法反馈ID' });
        const data = executeReviewAiAnswerFeedback(
            aiFeedbackDependencies,
            req.aiFeedbackOwner,
            id,
            req.body || {},
            commandContextFromRequest(req, REVIEW_FEEDBACK_CAPABILITY_ID)
        );
        res.json({
            success: true,
            data: legacyFeedbackEntityResponse(data, 'feedback'),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.get('/api/ai/learning-rules', (req, res) => {
    try {
        const data = listFactoryAiRules({
            status: req.query.status,
            effectiveStatus: req.query.effectiveStatus,
            domain: req.query.domain,
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
        const data = executeUpdateFactoryAiRule(
            aiFeedbackDependencies,
            id,
            req.body || {},
            commandContextFromRequest(
                req,
                UPDATE_LEARNING_RULE_CAPABILITY_ID
            )
        );
        res.json({
            success: true,
            data: legacyFeedbackEntityResponse(data, 'rule'),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

module.exports = router;
