const { Router } = require('express');
const authMiddleware = require('../../authMiddleware.cjs');
const {
    aiEvaluationCaseRow,
    aiEvaluationResultRow,
    aiEvaluationRunRow,
    db,
    safeInsert,
    safeUpdate,
} = require('../../db.cjs');
const { parsePositiveId } = require('../../services/validation.cjs');
const {
    commandContextFromRequest,
    sendCommandError,
} = require('../../services/commandRequest.cjs');
const {
    getAiEvaluationOverview,
} = require('../../services/aiEvaluations.cjs');
const {
    COMPLETE_RUN_CAPABILITY_ID,
    CONFIGURE_SYSTEM_CASE_CAPABILITY_ID,
    RECORD_RESULT_CAPABILITY_ID,
    REVIEW_CASE_CAPABILITY_ID,
    START_RUN_CAPABILITY_ID,
    executeCompleteAiEvaluationRun,
    executeConfigureAiSystemEvaluationCase,
    executeRecordAiEvaluationResult,
    executeReviewAiEvaluationCase,
    executeStartAiEvaluationRun,
} = require('../../services/aiEvaluationCommands.cjs');

const router = Router();
const aiEvaluationDependencies = {
    aiEvaluationCaseRow,
    aiEvaluationResultRow,
    aiEvaluationRunRow,
    db,
    safeInsert,
    safeUpdate,
};

function legacyEvaluationEntityResponse(receipt, entityKey) {
    return {
        ...receipt,
        operationStatus: receipt.status,
        ...receipt[entityKey],
    };
}

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
        const data = executeStartAiEvaluationRun(
            aiEvaluationDependencies,
            req.aiEvaluationOwner,
            req.body || {},
            commandContextFromRequest(req, START_RUN_CAPABILITY_ID)
        );
        res.status(data.idempotentReplay ? 200 : 201).json({ success: true, data });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/api/ai/evaluations/runs/:id/results', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法运行ID' });
        const data = executeRecordAiEvaluationResult(
            aiEvaluationDependencies,
            req.aiEvaluationOwner,
            id,
            req.body || {},
            commandContextFromRequest(req, RECORD_RESULT_CAPABILITY_ID)
        );
        res.status(data.idempotentReplay ? 200 : 201).json({
            success: true,
            data: legacyEvaluationEntityResponse(data, 'result'),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/api/ai/evaluations/runs/:id/complete', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法运行ID' });
        const data = executeCompleteAiEvaluationRun(
            aiEvaluationDependencies,
            req.aiEvaluationOwner,
            id,
            req.body || {},
            commandContextFromRequest(req, COMPLETE_RUN_CAPABILITY_ID)
        );
        res.json({
            success: true,
            data: legacyEvaluationEntityResponse(data, 'run'),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.patch('/api/ai/evaluations/cases/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法回归用例ID' });
        const data = executeReviewAiEvaluationCase(
            aiEvaluationDependencies,
            id,
            req.body || {},
            commandContextFromRequest(req, REVIEW_CASE_CAPABILITY_ID)
        );
        res.json({ success: true, data });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.patch('/api/ai/evaluations/system-cases/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法系统检查项ID' });
        const data = executeConfigureAiSystemEvaluationCase(
            aiEvaluationDependencies,
            id,
            req.body || {},
            commandContextFromRequest(req, CONFIGURE_SYSTEM_CASE_CAPABILITY_ID)
        );
        res.json({ success: true, data });
    } catch (error) {
        sendCommandError(res, error);
    }
});

module.exports = router;
