const { Router } = require('express');
const multer = require('multer');
const { db, dbGetAllCoils, dbGetAllParts, dbGetAllRecipes, partRow, recipeRow, recipeTechnicalFileRow, safeInsert, safeUpdate, templateRow, modelVariantRow, invalidatePartsCache } = require('../db.cjs');
const { buildRecipeCostDraft } = require('../services/costEngine.cjs');
const { parsePumpTestReport } = require('../services/pumpTestReport.cjs');
const { parsePositiveId } = require('../services/validation.cjs');
const { refreshFactoryRuleCandidates } = require('../services/factoryRuleCandidates.cjs');
const { inspectFactoryFile, storeFactoryFile } = require('../services/factoryFileStore.cjs');
const {
    DELETE_CAPABILITY_ID: TECHNICAL_FILE_DELETE_CAPABILITY_ID,
    UPLOAD_CAPABILITY_ID: TECHNICAL_FILE_UPLOAD_CAPABILITY_ID,
    executeRecipeTechnicalFileDelete,
    executeRecipeTechnicalFileUpload,
    getRecipeTechnicalFileDownload,
    listRecipeTechnicalFiles,
} = require('../services/recipeTechnicalFiles.cjs');
const {
    CREATE_CAPABILITY_ID: RECIPE_CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID: RECIPE_DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID: RECIPE_UPDATE_CAPABILITY_ID,
    buildRecipeSavePayloadDraft,
    executeRecipeCreate,
    executeRecipeDelete,
    executeRecipeUpdate,
} = require('../services/recipeCommands.cjs');
const {
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');
const {
    createRecipeQueries,
} = require('../services/recipeQueries.cjs');
const router = Router();
const technicalFileUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});
const recipeQueries = createRecipeQueries({
    db,
    listCoils: dbGetAllCoils,
    listParts: dbGetAllParts,
    listRecipes: dbGetAllRecipes,
    modelVariantRow,
    recipeRow,
    templateRow,
});

function recipeCommandDependencies() {
    return {
        db,
        dbGetAllParts,
        partRow,
        recipeRow,
        safeInsert,
        safeUpdate,
        invalidatePartsCache,
        refreshFactoryRuleCandidates,
    };
}

function recipeTechnicalFileDependencies() {
    return {
        db,
        inspectFactoryFile,
        parsePumpTestReport,
        recipeTechnicalFileRow,
        safeInsert,
        safeUpdate,
        storeFactoryFile,
    };
}

function legacyRecipeCommandResponse(result) {
    return {
        ...result,
        operationStatus: result.status,
        ...result.recipe,
    };
}

function legacyTechnicalFileCommandResponse(result) {
    return {
        ...result,
        operationStatus: result.status,
        ...result.technicalFile,
    };
}

function sendRecipeQueryError(res, error) {
    res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
    });
}

router.get('/', (req, res) => {
    try {
        res.json({
            success: true,
            data: recipeQueries.getAllRecipes({ keyword: req.query.keyword }),
        });
    }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/cost-draft', (req, res) => {
    try {
        const data = buildRecipeCostDraft(req.body || {}, { partsCatalog: dbGetAllParts() });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/bom-draft', (req, res) => {
    try {
        const data = recipeQueries.getBomDraft(req.body || {});
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/model-variant-draft', (req, res) => {
    try {
        res.json({
            success: true,
            data: recipeQueries.getModelVariantDraft(
                req.body?.modelVariantId
            ),
        });
    } catch (error) {
        sendRecipeQueryError(res, error);
    }
});

router.post('/save-payload-draft', (req, res) => {
    try {
        const data = buildRecipeSavePayloadDraft(
            recipeCommandDependencies(),
            req.body || {}
        );
        res.json({ success: true, data });
    } catch (error) {
        if (error.statusCode) return sendCommandError(res, error);
        res.status(400).json({ success: false, error: error.message });
    }
});

router.get('/:id/inventory-status', (req, res) => {
    try {
        res.json({
            success: true,
            data: recipeQueries.getInventoryStatus(req.params.id),
        });
    } catch (error) {
        sendRecipeQueryError(res, error);
    }
});

router.get('/:id/technical-files', (req, res) => {
    try {
        const data = listRecipeTechnicalFiles(
            recipeTechnicalFileDependencies(),
            req.params.id
        );
        res.json({ success: true, data });
    } catch (error) {
        if (error.statusCode) return sendCommandError(res, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/:id/technical-files', (req, res) => {
    technicalFileUpload.single('file')(req, res, error => {
        if (error) {
            const message = error.code === 'LIMIT_FILE_SIZE' ? '测试报告不能超过 10MB' : error.message;
            return res.status(400).json({ success: false, error: message });
        }
        try {
            if (!req.file?.buffer?.length) return res.status(400).json({ success: false, error: '请选择测试报告文件' });
            const result = executeRecipeTechnicalFileUpload(
                recipeTechnicalFileDependencies(),
                req.params.id,
                {
                    buffer: req.file.buffer,
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    expectedUpdatedAt: req.body?.expectedUpdatedAt,
                },
                commandContextFromRequest(
                    req,
                    TECHNICAL_FILE_UPLOAD_CAPABILITY_ID
                )
            );
            res.json({
                success: true,
                data: legacyTechnicalFileCommandResponse(result),
            });
        } catch (parseError) {
            if (parseError.statusCode) return sendCommandError(res, parseError);
            res.status(400).json({ success: false, error: parseError.message });
        }
    });
});

router.get('/:id/technical-files/:fileId/download', (req, res) => {
    try {
        const file = getRecipeTechnicalFileDownload(
            recipeTechnicalFileDependencies(),
            req.params.id,
            req.params.fileId
        );
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Length', file.buffer.length);
        res.setHeader(
            'Content-Disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`
        );
        res.send(file.buffer);
    } catch (error) {
        if (error.statusCode) return sendCommandError(res, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/:id/technical-files/:fileId', (req, res) => {
    try {
        const result = executeRecipeTechnicalFileDelete(
            recipeTechnicalFileDependencies(),
            req.params.id,
            req.params.fileId,
            req.body || {},
            commandContextFromRequest(
                req,
                TECHNICAL_FILE_DELETE_CAPABILITY_ID
            )
        );
        res.json({ success: true, data: result });
    } catch (error) {
        if (error.statusCode) return sendCommandError(res, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/:id', (req, res) => {
    try {
        res.json({
            success: true,
            data: recipeQueries.getRecipe(req.params.id),
        });
    } catch (error) {
        sendRecipeQueryError(res, error);
    }
});

router.post('/', (req, res) => {
    try {
        const result = executeRecipeCreate(
            recipeCommandDependencies(),
            req.body || {},
            commandContextFromRequest(req, RECIPE_CREATE_CAPABILITY_ID)
        );
        res.json({
            success: true,
            data: legacyRecipeCommandResponse(result),
            createdLongScrewParts: result.createdLongScrewParts,
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法配方ID' });
        const result = executeRecipeDelete(
            recipeCommandDependencies(),
            id,
            {
                ...(req.body || {}),
                expectedUpdatedAt: req.body?.expectedUpdatedAt
                    ?? req.query?.expectedUpdatedAt
                    ?? req.headers?.['if-unmodified-since'],
            },
            commandContextFromRequest(req, RECIPE_DELETE_CAPABILITY_ID)
        );
        res.json({ success: true, data: result });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法配方ID' });
        const result = executeRecipeUpdate(
            recipeCommandDependencies(),
            id,
            req.body || {},
            commandContextFromRequest(req, RECIPE_UPDATE_CAPABILITY_ID)
        );
        res.json({
            success: true,
            data: legacyRecipeCommandResponse(result),
            createdLongScrewParts: result.createdLongScrewParts,
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

module.exports = router;
