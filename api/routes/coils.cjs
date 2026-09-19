const { Router } = require('express');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { db, dbGetAllCoils, dbGetAllStatorVariants, coilRow, safeInsert, safeUpdate, hardDelete } = require('../db.cjs');
const {
    calculateCoilCost,
} = require('../services/coilCost.cjs');
const { parsePositiveId } = require('../services/validation.cjs');
const {
    assertCoilCanBeDeleted,
    assertCoilIdentityEditable,
    coilStockMovementRow,
} = require('../services/coilInventory.cjs');
const { createCoilQueries } = require('../services/coilQueries.cjs');
const {
    commandActorKey,
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');
const {
    buildCoilStockPreview,
    executeCoilStockBatch,
    executeConfirmedCoilStockBatch,
} = require('../services/inventoryCommands.cjs');
const {
    BATCH_UNIT_PRICE_CAPABILITY_ID,
    CREATE_CAPABILITY_ID: COIL_CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID: COIL_DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID: COIL_UPDATE_CAPABILITY_ID,
    buildCoilUnitPricePreview,
    executeCoilCreate,
    executeCoilDelete,
    executeCoilUnitPriceBatch,
    executeCoilUpdate,
} = require('../services/coilCommands.cjs');
const COIL_STOCK_CAPABILITY_ID = requireBusinessCapability(
    'inventory.coils.adjust_stock'
).capabilityId;
const router = Router();
const coilQueries = createCoilQueries({
    db,
    listCoils: dbGetAllCoils,
    listStatorVariants: dbGetAllStatorVariants,
    movementRow: coilStockMovementRow,
});

function sendCoilQueryError(res, error) {
    res.status(Number(error?.statusCode) || 500).json({
        success: false,
        error: error.message,
    });
}

function coilCommandDependencies() {
    return {
        db,
        coilRow,
        listCoils: dbGetAllCoils,
        safeInsert,
        safeUpdate,
        hardDelete,
        assertCoilCanBeDeleted,
        assertCoilIdentityEditable,
    };
}

function legacyCoilCommandResponse(result) {
    return {
        ...result,
        operationStatus: result.status,
        ...result.coil,
    };
}

// ── CRUD ──

router.get('/', (req, res) => {
    try { res.json({ success: true, data: coilQueries.getAllCoils(req.query) }); }
    catch (error) { sendCoilQueryError(res, error); }
});

router.get('/variants', (req, res) => {
    try { res.json({ success: true, data: coilQueries.getAllStatorVariants() }); }
    catch (error) { sendCoilQueryError(res, error); }
});

router.post('/spec-draft', (req, res) => {
    try {
        res.json({
            success: true,
            data: coilQueries.getSpecDraft(req.body || {}),
        });
    } catch (error) { sendCoilQueryError(res, error); }
});

router.post('/', (req, res) => {
    try {
        const result = executeCoilCreate(
            coilCommandDependencies(),
            req.body || {},
            commandContextFromRequest(req, COIL_CREATE_CAPABILITY_ID)
        );
        res.json({ success: true, data: legacyCoilCommandResponse(result) });
    } catch (error) { sendCommandError(res, error); }
});

router.post('/spec-price-preview', (req, res) => {
    try {
        res.json({
            success: true,
            data: buildCoilUnitPricePreview(
                coilCommandDependencies(),
                req.body || {}
            ),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

// ── 按规格批量更新单价 ──
// Must be registered before /:id, otherwise "spec" is treated as an ID.
router.patch('/spec/:spec', (req, res) => {
    try {
        const result = executeCoilUnitPriceBatch(
            coilCommandDependencies(),
            {
                ...(req.body || {}),
                spec: decodeURIComponent(req.params.spec),
            },
            commandContextFromRequest(req, BATCH_UNIT_PRICE_CAPABILITY_ID)
        );
        res.json({
            success: true,
            updated: result.updatedCount,
            data: result,
        });
    } catch (error) { sendCommandError(res, error); }
});

router.post('/stock-adjustments-preview', (req, res) => {
    try {
        const data = buildCoilStockPreview(
            { db },
            req.body || {},
            commandActorKey(req)
        );
        res.json({ success: true, data });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/stock-adjustments', (req, res) => {
    try {
        const result = executeConfirmedCoilStockBatch(
            { db, safeUpdate, safeInsert, coilRow },
            req.body || {},
            commandContextFromRequest(req, COIL_STOCK_CAPABILITY_ID),
            commandActorKey(req)
        );
        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.get('/:id/stock-movements', (req, res) => {
    try {
        res.json({
            success: true,
            data: coilQueries.getStockMovements(
                req.params.id,
                req.query.limit
            ),
        });
    } catch (error) { sendCoilQueryError(res, error); }
});

router.post('/:id/stock-adjustment', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法线圈ID' });
        const result = executeCoilStockBatch(
            { db, safeUpdate, safeInsert, coilRow },
            {
                adjustments: [{
                    coilId: id,
                    changeQty: req.body?.changeQty,
                    expectedUpdatedAt: req.body?.expectedUpdatedAt,
                }],
                note: req.body?.note,
            },
            commandContextFromRequest(req, COIL_STOCK_CAPABILITY_ID)
        );
        const [adjustmentResult] = result.adjustments || [];
        const receipt = Object.fromEntries(
            Object.entries(result).filter(([key]) => key !== 'adjustments' && key !== 'updatedCount')
        );
        res.json({
            success: true,
            data: {
                ...adjustmentResult,
                ...receipt,
            },
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法线圈ID' });
        const result = executeCoilUpdate(
            coilCommandDependencies(),
            id,
            req.body || {},
            commandContextFromRequest(req, COIL_UPDATE_CAPABILITY_ID)
        );
        res.json({ success: true, data: legacyCoilCommandResponse(result) });
    } catch (error) { sendCommandError(res, error); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法线圈ID' });
        const result = executeCoilDelete(
            coilCommandDependencies(),
            id,
            {
                expectedUpdatedAt: req.body?.expectedUpdatedAt
                    ?? req.query?.expectedUpdatedAt
                    ?? req.headers['if-unmodified-since'],
            },
            commandContextFromRequest(req, COIL_DELETE_CAPABILITY_ID)
        );
        res.json({ success: true, data: result });
    } catch (error) { sendCommandError(res, error); }
});

// ── 成本计算（支持插值）──

function calculateCoilCostHandler(req, res) {
    try {
        const result = calculateCoilCost(dbGetAllCoils(), req.body);
        if (!result.success) return res.status(result.status || 400).json({
            success: false,
            error: result.error,
            ...(result.code ? { code: result.code } : {}),
            ...(result.details ? { details: result.details } : {}),
            ...(req.requestId ? { requestId: req.requestId } : {}),
        });
        res.json({ success: true, data: result.data });
    } catch (error) { console.error('Coil Calculate Error:', error); res.status(500).json({ success: false, error: error.message }); }
}

router.post('/calculate', calculateCoilCostHandler);

// ── 规格列表 ──

router.get('/specs', (req, res) => {
    try {
        res.json({ success: true, data: coilQueries.getSpecOptions() });
    } catch (error) { sendCoilQueryError(res, error); }
});

module.exports = router;
module.exports.calculateCoilCostHandler = calculateCoilCostHandler;
