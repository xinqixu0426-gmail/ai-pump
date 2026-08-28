const { Router } = require('express');
const {
    db,
    dbGetAllModelVariants,
    invalidatePartsCache,
    modelVariantRow,
    partRow,
    safeInsert,
    safeUpdate,
} = require('../db.cjs');
const {
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');
const {
    CREATE_CAPABILITY_ID: MODEL_VARIANT_CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID: MODEL_VARIANT_DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID: MODEL_VARIANT_UPDATE_CAPABILITY_ID,
    executeModelVariantCreate,
    executeModelVariantDelete,
    executeModelVariantUpdate,
} = require('../services/modelVariantCommands.cjs');
const { parsePositiveId } = require('../services/validation.cjs');

const router = Router();

function modelVariantCommandDependencies() {
    return {
        db,
        invalidatePartsCache,
        modelVariantRow,
        partRow,
        safeInsert,
        safeUpdate,
    };
}

function legacyModelVariantCommandResponse(result) {
    return {
        ...result,
        operationStatus: result.status,
        ...result.variant,
    };
}

router.get('/', (req, res) => {
    try {
        res.json({ success: true, data: dbGetAllModelVariants() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/', (req, res) => {
    try {
        const result = executeModelVariantCreate(
            modelVariantCommandDependencies(),
            req.body || {},
            commandContextFromRequest(
                req,
                MODEL_VARIANT_CREATE_CAPABILITY_ID
            )
        );
        res.json({
            success: true,
            data: legacyModelVariantCommandResponse(result),
            createdLongScrewParts: result.createdLongScrewParts,
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) {
            return res.status(400).json({
                success: false,
                error: '非法常用配置预设编号',
            });
        }
        const result = executeModelVariantUpdate(
            modelVariantCommandDependencies(),
            id,
            req.body || {},
            commandContextFromRequest(
                req,
                MODEL_VARIANT_UPDATE_CAPABILITY_ID
            )
        );
        res.json({
            success: true,
            data: legacyModelVariantCommandResponse(result),
            createdLongScrewParts: result.createdLongScrewParts,
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) {
            return res.status(400).json({
                success: false,
                error: '非法常用配置预设编号',
            });
        }
        const result = executeModelVariantDelete(
            modelVariantCommandDependencies(),
            id,
            {
                expectedUpdatedAt: req.body?.expectedUpdatedAt
                    ?? req.query?.expectedUpdatedAt
                    ?? req.headers['if-unmodified-since'],
            },
            commandContextFromRequest(
                req,
                MODEL_VARIANT_DELETE_CAPABILITY_ID
            )
        );
        res.json({ success: true, data: result });
    } catch (error) {
        sendCommandError(res, error);
    }
});

module.exports = router;
