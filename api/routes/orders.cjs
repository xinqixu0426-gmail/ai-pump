const { Router } = require('express');
const {
    db,
    dbGetAllCoils,
    dbGetAllParts,
    dbGetAllRecipes,
    invalidatePartsCache,
    orderRow,
    safeInsert,
    safeUpdate,
    softDelete,
} = require('../db.cjs');
const { buildOrderPlan } = require('../services/orderPlanning.cjs');
const {
    buildActiveOrdersReadinessOverview,
    buildOrderReadinessContext,
} = require('../services/activeOrderReadiness.cjs');
const {
    CREATE_CAPABILITY_ID: ORDER_CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID: ORDER_DELETE_CAPABILITY_ID,
    STATUS_CAPABILITY_ID: ORDER_STATUS_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID: ORDER_UPDATE_CAPABILITY_ID,
    buildOrderSavePayloadDraft,
    executeOrderCreate,
    executeOrderDelete,
    executeOrderStatus,
    executeOrderUpdate,
} = require('../services/orderCommands.cjs');
const {
    CAPABILITY_ID: ORDER_READINESS_ACTION_CAPABILITY_ID,
    buildOrderReadinessActionDraft,
    executeOrderReadinessAction,
} = require('../services/orderReadinessCommands.cjs');
const {
    CAPABILITY_ID: ORDER_TODO_TOGGLE_CAPABILITY_ID,
    executeOrderTodoToggle,
} = require('../services/orderTodoCommands.cjs');
const {
    CAPABILITY_ID: PURCHASE_PROGRESS_CAPABILITY_ID,
    buildLegacyPurchaseItemToggleInput,
    buildPurchaseItemProgressDraft,
    executePurchaseItemProgress,
} = require('../services/purchasingItemProgress.cjs');
const {
    CAPABILITY_ID: PURCHASE_BATCH_CAPABILITY_ID,
    buildPurchaseBatchDraft,
    executePurchaseBatch,
} = require('../services/purchasingBatchOrder.cjs');
const {
    CAPABILITY_ID: COMPLETE_PURCHASE_CAPABILITY_ID,
    buildCompletePurchaseDraft,
    executeCompletePurchase,
} = require('../services/purchasingInbound.cjs');
const { parsePositiveId } = require('../services/validation.cjs');
const {
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');
const {
    getOrderRequirementSummary,
} = require('../services/orderRequirements.cjs');
const {
    CONFIRM_CAPABILITY_ID: REQUIREMENT_CONFIRM_CAPABILITY_ID,
    REVOKE_CAPABILITY_ID: REQUIREMENT_REVOKE_CAPABILITY_ID,
    SAVE_CAPABILITY_ID: REQUIREMENT_SAVE_CAPABILITY_ID,
    executeConfirmRequirement,
    executeRevokeRequirement,
    executeSaveRequirementDraft,
} = require('../services/orderRequirementCommands.cjs');
const {
    getOrderExecutionRecords,
} = require('../services/orderExecutionRecords.cjs');
const {
    CONFIRM_CAPABILITY_ID: EXECUTION_CONFIRM_CAPABILITY_ID,
    CREATE_CAPABILITY_ID: EXECUTION_CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID: EXECUTION_DELETE_CAPABILITY_ID,
    REVOKE_CAPABILITY_ID: EXECUTION_REVOKE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID: EXECUTION_UPDATE_CAPABILITY_ID,
    executeConfirmExecutionRecord,
    executeCreateExecutionDraft,
    executeDeleteExecutionRecord,
    executeRevokeExecutionRecord,
    executeUpdateExecutionDraft,
} = require('../services/orderExecutionRecordCommands.cjs');
const { buildOrderKnowledgePackage } = require('../services/orderKnowledgePackage.cjs');
const {
    getOrderWithCurrentPurchasePlan,
    listOrdersWithCurrentPurchasePlans,
} = require('../services/orderPurchasePlanning.cjs');
const {
    createOrderQueries,
} = require('../services/orderQueries.cjs');
const router = Router();
const orderRequirementCommandDependencies = { db, safeInsert, safeUpdate };
const orderExecutionCommandDependencies = {
    db,
    safeInsert,
    safeUpdate,
    softDelete,
};
const orderQueries = createOrderQueries({
    db,
    listOrdersWithCurrentPurchasePlans,
    getOrderWithCurrentPurchasePlan,
    buildActiveOrdersReadinessOverview,
    buildOrderReadinessContext,
});

function legacyOrderCommandResponse(result) {
    return {
        ...result,
        operationStatus: result.status,
        ...result.order,
    };
}

function sendOrderQueryError(res, error) {
    res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
    });
}

router.get('/', (req, res) => {
    try {
        res.json({ success: true, data: orderQueries.getAllOrders() });
    }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/history-price/:recipeName', (req, res) => {
    try {
        const recipeName = decodeURIComponent(req.params.recipeName);
        res.json({
            success: true,
            data: orderQueries.getLatestRecipePrice(recipeName),
        });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/purchase-plan', (req, res) => {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        res.json({
            success: true,
            data: buildOrderPlan(items, dbGetAllParts(), { coilsCatalog: dbGetAllCoils() }),
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.get('/lookup', (req, res) => {
    try {
        res.json({
            success: true,
            data: orderQueries.lookupOrders(req.query.query),
        });
    } catch (error) {
        sendOrderQueryError(res, error);
    }
});

router.get('/readiness-overview', (req, res) => {
    try {
        res.json({
            success: true,
            data: orderQueries.getReadinessOverview(),
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/:id/knowledge-package', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({ success: true, data: buildOrderKnowledgePackage(id) });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.get('/:id/readiness-plan', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({
            success: true,
            data: buildOrderReadinessActionDraft({
                db,
                dbGetAllCoils,
                dbGetAllParts,
                dbGetAllRecipes,
                orderRow,
                safeUpdate,
            }, id),
        });
    } catch (error) {
        const code = error.statusCode || 500;
        res.status(code).json({ success: false, error: error.message });
    }
});

router.post('/:id/readiness-actions/:actionId', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        const actionId = String(req.params.actionId || '').trim();
        if (!['confirm_order', 'generate_purchase_plan'].includes(actionId)) {
            return res.status(400).json({ success: false, error: '不支持的处理步骤' });
        }
        const result = executeOrderReadinessAction(
            {
                db,
                dbGetAllCoils,
                dbGetAllParts,
                dbGetAllRecipes,
                orderRow,
                safeUpdate,
            },
            id,
            actionId,
            req.body || {},
            commandContextFromRequest(req, ORDER_READINESS_ACTION_CAPABILITY_ID)
        );
        res.json({ success: true, data: result });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.get('/:id/readiness', (req, res) => {
    try {
        res.json({
            success: true,
            data: orderQueries.getOrderReadiness(req.params.id),
        });
    } catch (error) {
        sendOrderQueryError(res, error);
    }
});

router.get('/:id/requirements', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({ success: true, data: getOrderRequirementSummary(id) });
    } catch (error) {
        res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
});

router.put('/:id/requirements/draft', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({
            success: true,
            data: executeSaveRequirementDraft(
                orderRequirementCommandDependencies,
                id,
                req.body || {},
                commandContextFromRequest(req, REQUIREMENT_SAVE_CAPABILITY_ID)
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/:id/requirements/confirm', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({
            success: true,
            data: executeConfirmRequirement(
                orderRequirementCommandDependencies,
                id,
                req.body || {},
                commandContextFromRequest(req, REQUIREMENT_CONFIRM_CAPABILITY_ID)
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/:id/requirements/revoke', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({
            success: true,
            data: executeRevokeRequirement(
                orderRequirementCommandDependencies,
                id,
                req.body || {},
                commandContextFromRequest(req, REQUIREMENT_REVOKE_CAPABILITY_ID)
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.get('/:id/execution-records', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({ success: true, data: getOrderExecutionRecords(id) });
    } catch (error) {
        res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
});

router.post('/:id/execution-records', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({
            success: true,
            data: executeCreateExecutionDraft(
                orderExecutionCommandDependencies,
                id,
                req.body || {},
                commandContextFromRequest(req, EXECUTION_CREATE_CAPABILITY_ID)
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.put('/:id/execution-records/:recordId/draft', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        const recordId = parsePositiveId(req.params.recordId);
        if (!id || !recordId) return res.status(400).json({ success: false, error: '非法订单或执行档案ID' });
        res.json({
            success: true,
            data: executeUpdateExecutionDraft(
                orderExecutionCommandDependencies,
                id,
                recordId,
                req.body || {},
                commandContextFromRequest(req, EXECUTION_UPDATE_CAPABILITY_ID)
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/:id/execution-records/:recordId/confirm', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        const recordId = parsePositiveId(req.params.recordId);
        if (!id || !recordId) return res.status(400).json({ success: false, error: '非法订单或执行档案ID' });
        res.json({
            success: true,
            data: executeConfirmExecutionRecord(
                orderExecutionCommandDependencies,
                id,
                recordId,
                req.body || {},
                commandContextFromRequest(req, EXECUTION_CONFIRM_CAPABILITY_ID)
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/:id/execution-records/:recordId/revoke', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        const recordId = parsePositiveId(req.params.recordId);
        if (!id || !recordId) return res.status(400).json({ success: false, error: '非法订单或执行档案ID' });
        res.json({
            success: true,
            data: executeRevokeExecutionRecord(
                orderExecutionCommandDependencies,
                id,
                recordId,
                req.body || {},
                commandContextFromRequest(req, EXECUTION_REVOKE_CAPABILITY_ID)
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.delete('/:id/execution-records/:recordId', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        const recordId = parsePositiveId(req.params.recordId);
        if (!id || !recordId) return res.status(400).json({ success: false, error: '非法订单或执行档案ID' });
        res.json({
            success: true,
            data: executeDeleteExecutionRecord(
                orderExecutionCommandDependencies,
                id,
                recordId,
                req.body || {},
                commandContextFromRequest(req, EXECUTION_DELETE_CAPABILITY_ID)
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/save-payload-draft', (req, res) => {
    try {
        res.json({
            success: true,
            data: buildOrderSavePayloadDraft(
                { db, dbGetAllCoils, dbGetAllParts },
                req.body || {}
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/purchase-items/batch', (req, res) => {
    try {
        res.json({
            success: true,
            data: executePurchaseBatch(
                {
                    db,
                    dbGetAllCoils,
                    dbGetAllParts,
                    orderRow,
                    safeUpdate,
                },
                req.body || {},
                commandContextFromRequest(req, PURCHASE_BATCH_CAPABILITY_ID)
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/purchase-items/batch-draft', (req, res) => {
    try {
        res.json({
            success: true,
            data: buildPurchaseBatchDraft(
                { db, dbGetAllCoils, dbGetAllParts },
                req.body || {}
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/:id/status', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        const result = executeOrderStatus(
            {
                db,
                dbGetAllCoils,
                dbGetAllParts,
                orderRow,
                safeUpdate,
            },
            id,
            req.body || {},
            commandContextFromRequest(req, ORDER_STATUS_CAPABILITY_ID)
        );
        res.json({
            success: true,
            data: legacyOrderCommandResponse(result),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/:id/purchase-items/progress', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({
            success: true,
            data: executePurchaseItemProgress(
                {
                    db,
                    dbGetAllCoils,
                    dbGetAllParts,
                    invalidatePartsCache,
                    orderRow,
                    safeInsert,
                    safeUpdate,
                },
                {
                    ...(req.body || {}),
                    orderId: id,
                },
                commandContextFromRequest(req, PURCHASE_PROGRESS_CAPABILITY_ID)
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/:id/purchase-items/progress-draft', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({
            success: true,
            data: buildPurchaseItemProgressDraft(
                { db, dbGetAllCoils, dbGetAllParts },
                id,
                req.body || {}
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/:id/purchase-items/toggle', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        const result = executePurchaseItemProgress(
            {
                db,
                dbGetAllCoils,
                dbGetAllParts,
                invalidatePartsCache,
                orderRow,
                safeInsert,
                safeUpdate,
            },
            {
                ...buildLegacyPurchaseItemToggleInput(
                    { db },
                    id,
                    req.body || {}
                ),
                orderId: id,
            },
            commandContextFromRequest(req, PURCHASE_PROGRESS_CAPABILITY_ID)
        );
        res.json({ success: true, data: result.order });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/:id/todos/toggle', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        const result = executeOrderTodoToggle(
            { db, orderRow, safeUpdate },
            id,
            req.body || {},
            commandContextFromRequest(req, ORDER_TODO_TOGGLE_CAPABILITY_ID)
        );
        res.json({ success: true, data: legacyOrderCommandResponse(result) });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/:id/complete-purchase-draft', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({
            success: true,
            data: buildCompletePurchaseDraft(
                { db, dbGetAllCoils, dbGetAllParts },
                id
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/:id/complete-purchase', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        const result = executeCompletePurchase(
            {
                db,
                dbGetAllCoils,
                dbGetAllParts,
                invalidatePartsCache,
                orderRow,
                safeInsert,
                safeUpdate,
            },
            {
                orderId: id,
                expectedUpdatedAt: req.body?.expectedUpdatedAt,
                previewHash: req.body?.previewHash,
            },
            commandContextFromRequest(req, COMPLETE_PURCHASE_CAPABILITY_ID)
        );
        res.json({ success: true, data: result });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.get('/:id', (req, res) => {
    try {
        res.json({
            success: true,
            data: orderQueries.getOrder(req.params.id),
        });
    } catch (error) {
        sendOrderQueryError(res, error);
    }
});

router.post('/', (req, res) => {
    try {
        const result = executeOrderCreate(
            {
                db,
                dbGetAllCoils,
                dbGetAllParts,
                orderRow,
                safeInsert,
            },
            req.body || {},
            commandContextFromRequest(req, ORDER_CREATE_CAPABILITY_ID)
        );
        res.json({
            success: true,
            data: legacyOrderCommandResponse(result),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        const result = executeOrderUpdate(
            {
                db,
                dbGetAllCoils,
                dbGetAllParts,
                orderRow,
                safeUpdate,
            },
            id,
            req.body || {},
            commandContextFromRequest(req, ORDER_UPDATE_CAPABILITY_ID)
        );
        res.json({
            success: true,
            data: legacyOrderCommandResponse(result),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        const result = executeOrderDelete(
            { db, safeUpdate },
            id,
            {
                ...(req.body || {}),
                expectedUpdatedAt: req.body?.expectedUpdatedAt
                    ?? req.query?.expectedUpdatedAt
                    ?? req.headers?.['if-unmodified-since'],
            },
            commandContextFromRequest(req, ORDER_DELETE_CAPABILITY_ID)
        );
        res.json({ success: true, data: result });
    } catch (error) {
        sendCommandError(res, error);
    }
});

module.exports = router;
