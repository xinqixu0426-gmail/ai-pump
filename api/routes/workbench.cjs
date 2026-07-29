const { Router } = require('express');
const { buildBusinessSummary } = require('../services/businessSummary.cjs');
const { buildManagementActionCenter } = require('../services/managementActionCenter.cjs');
const { buildFactoryExecutionPlan } = require('../services/factoryExecutionPlan.cjs');
const {
    decorateFactoryExecutionPlanWithHistory,
    listFactoryWorkflowRuns,
    recordFactoryWorkflowRun,
} = require('../services/factoryWorkflowHistory.cjs');
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

router.post('/execution-plan', (req, res) => {
    try {
        const plan = buildFactoryExecutionPlan(req.body || {});
        res.json({
            success: true,
            data: decorateFactoryExecutionPlanWithHistory(plan),
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
});

router.get('/execution-runs', (req, res) => {
    try {
        res.json({
            success: true,
            data: listFactoryWorkflowRuns({
                workflowType: req.query.workflowType,
                subjectId: req.query.subjectId,
                actionId: req.query.actionId,
                status: req.query.status,
                limit: req.query.limit,
            }),
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/execution-runs', (req, res) => {
    try {
        res.status(201).json({
            success: true,
            data: recordFactoryWorkflowRun(req.body || {}),
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

module.exports = router;
