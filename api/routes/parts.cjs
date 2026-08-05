const { Router } = require('express');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    db,
    dbGetAllParts,
    partRow,
    extractPartFields,
    safeInsert,
    safeUpdate,
    invalidatePartsCache,
} = require('../db.cjs');
const { parsePositiveId } = require('../services/validation.cjs');
const {
    commandActorKey,
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');
const {
    buildPartStockPreview,
    executeConfirmedPartStockBatch,
} = require('../services/inventoryCommands.cjs');
const {
    BATCH_CREATE_CAPABILITY_ID: PART_BATCH_CREATE_CAPABILITY_ID,
    BATCH_PRICE_CAPABILITY_ID,
    CREATE_CAPABILITY_ID: PART_CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID: PART_DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID: PART_UPDATE_CAPABILITY_ID,
    buildPartBatchCreatePreview,
    buildPartPricePreview,
    executeConfirmedPartBatchCreate,
    executePartCreate,
    executePartDelete,
    executePartPriceBatch,
    executePartUpdate,
} = require('../services/partCommands.cjs');
const PART_STOCK_CAPABILITY_ID = requireBusinessCapability(
    'inventory.parts.batch_adjust_stock'
).capabilityId;
const router = Router();

function partDependencies() {
    return {
        db,
        extractPartFields,
        partRow,
        safeInsert,
        safeUpdate,
    };
}

function legacyPartCommandResponse(result) {
    return {
        ...result,
        operationStatus: result.status,
        ...result.part,
    };
}

router.get('/', (req, res) => {
    try { res.json({ success: true, data: dbGetAllParts() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', (req, res) => {
    try {
        const result = executePartCreate(
            partDependencies(),
            req.body || {},
            commandContextFromRequest(req, PART_CREATE_CAPABILITY_ID)
        );
        invalidatePartsCache();
        res.json({ success: true, data: legacyPartCommandResponse(result) });
    } catch (error) { sendCommandError(res, error); }
});

router.post('/batch-create-preview', (req, res) => {
    try {
        const data = buildPartBatchCreatePreview(
            partDependencies(),
            req.body || {},
            commandActorKey(req)
        );
        res.json({ success: true, data });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/batch-create', (req, res) => {
    try {
        const result = executeConfirmedPartBatchCreate(
            partDependencies(),
            req.body || {},
            commandContextFromRequest(req, PART_BATCH_CREATE_CAPABILITY_ID),
            commandActorKey(req)
        );
        invalidatePartsCache();
        res.json({ success: true, data: result });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/prices-preview', (req, res) => {
    try {
        res.json({
            success: true,
            data: buildPartPricePreview(partDependencies(), req.body || {}),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.patch('/prices', (req, res) => {
    try {
        const result = executePartPriceBatch(
            partDependencies(),
            req.body || {},
            commandContextFromRequest(req, BATCH_PRICE_CAPABILITY_ID)
        );
        invalidatePartsCache();
        res.json({ success: true, data: result });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法零件ID' });
        const result = executePartUpdate(
            partDependencies(),
            id,
            req.body || {},
            commandContextFromRequest(req, PART_UPDATE_CAPABILITY_ID)
        );
        invalidatePartsCache();
        res.json({ success: true, data: legacyPartCommandResponse(result) });
    } catch (error) { sendCommandError(res, error); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法零件ID' });
        const result = executePartDelete(
            partDependencies(),
            id,
            {
                expectedUpdatedAt: req.body?.expectedUpdatedAt
                    ?? req.query?.expectedUpdatedAt
                    ?? req.headers['if-unmodified-since'],
            },
            commandContextFromRequest(req, PART_DELETE_CAPABILITY_ID)
        );
        invalidatePartsCache();
        res.json({ success: true, data: result });
    } catch (error) { sendCommandError(res, error); }
});

router.post('/batch-stock-preview', (req, res) => {
    try {
        const data = buildPartStockPreview(
            { db },
            req.body || {},
            commandActorKey(req)
        );
        res.json({ success: true, data });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/batch-stock', (req, res) => {
    try {
        const result = executeConfirmedPartStockBatch(
            { db, safeUpdate, partRow },
            req.body || {},
            commandContextFromRequest(req, PART_STOCK_CAPABILITY_ID),
            commandActorKey(req)
        );
        invalidatePartsCache();
        res.json({ success: true, data: result });
    } catch (error) {
        sendCommandError(res, error);
    }
});

module.exports = router;
