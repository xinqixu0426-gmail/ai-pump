const { Router } = require('express');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    db,
    dbGetAllParts,
    partRow,
    extractPartFields,
    safeInsert,
    safeUpdate,
    setSetting,
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
const { listParts } = require('../services/partQueries.cjs');
const { queryPartRenameImpact } = require('../services/partRenameQuery.cjs');
const {
    BATCH_CREATE_CAPABILITY_ID: PART_BATCH_CREATE_CAPABILITY_ID,
    BATCH_DELETE_CAPABILITY_ID: PART_BATCH_DELETE_CAPABILITY_ID,
    BATCH_PRICE_CAPABILITY_ID,
    CREATE_CAPABILITY_ID: PART_CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID: PART_DELETE_CAPABILITY_ID,
    PROFILE_SAVE_CAPABILITY_ID: PART_PROFILE_SAVE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID: PART_UPDATE_CAPABILITY_ID,
    buildPartBatchCreatePreview,
    buildPartBatchDeletePreview,
    buildPartDeletePreview,
    buildPartPricePreview,
    buildPartProfileSavePreview,
    executeConfirmedPartBatchCreate,
    executeConfirmedPartBatchDelete,
    executeConfirmedPartProfileSave,
    executePartCreate,
    executePartDelete,
    executePartPriceBatch,
    executePartUpdate,
} = require('../services/partCommands.cjs');
const PART_STOCK_CAPABILITY_ID = requireBusinessCapability(
    'inventory.parts.batch_adjust_stock'
).capabilityId;
const router = Router();

router.post('/:id/rename-impact', (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, data: queryPartRenameImpact(db, parsePositiveId(req.params.id), req.body) });
    } catch (error) { sendCommandError(res, error); }
});

function partDependencies() {
    return {
        db,
        extractPartFields,
        partRow,
        safeInsert,
        safeUpdate,
        setSetting,
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
    try {
        const data = listParts(dbGetAllParts(), {
            keyword: req.query.keyword,
            category: req.query.category,
            supplier: req.query.supplier,
            stockStatus: req.query.stockStatus,
            limit: req.query.limit,
            minPrice: req.query.minPrice,
            maxPrice: req.query.maxPrice,
            priceBelow: req.query.priceBelow,
            priceAbove: req.query.priceAbove,
            minStock: req.query.minStock,
            maxStock: req.query.maxStock,
            stockBelow: req.query.stockBelow,
            stockAbove: req.query.stockAbove,
            sortBy: req.query.sortBy,
            sortOrder: req.query.sortOrder,
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message,
            ...(error.code ? { code: error.code } : {}),
            ...(req.requestId ? { requestId: req.requestId } : {}),
        });
    }
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

router.post('/batch-delete-preview', (req, res) => {
    try {
        const data = buildPartBatchDeletePreview(
            partDependencies(),
            req.body || {},
            commandActorKey(req)
        );
        res.json({ success: true, data });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/batch-delete', (req, res) => {
    try {
        const result = executeConfirmedPartBatchDelete(
            partDependencies(),
            req.body || {},
            commandContextFromRequest(req, PART_BATCH_DELETE_CAPABILITY_ID),
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

router.post('/:id/save-preview', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法零件ID' });
        const data = buildPartProfileSavePreview(
            partDependencies(),
            id,
            req.body || {},
            commandActorKey(req)
        );
        res.json({ success: true, data });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/:id/save', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法零件ID' });
        const result = executeConfirmedPartProfileSave(
            partDependencies(),
            id,
            req.body || {},
            commandContextFromRequest(req, PART_PROFILE_SAVE_CAPABILITY_ID),
            commandActorKey(req)
        );
        invalidatePartsCache();
        res.json({ success: true, data: legacyPartCommandResponse(result) });
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

router.post('/:id/delete-preview', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法零件ID' });
        const data = buildPartDeletePreview(
            partDependencies(),
            id,
            req.body || {}
        );
        res.json({ success: true, data });
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
                previewHash: req.body?.previewHash,
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
