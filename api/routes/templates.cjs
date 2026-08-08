const { Router } = require('express');
const {
    db,
    dbGetAllTemplates,
    templateRow,
    recipeRow,
    loadPartsData,
    calculateRecipeCost,
    safeInsert,
    safeUpdate,
    hardDelete,
} = require('../db.cjs');
const { parsePositiveId } = require('../services/validation.cjs');
const {
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');
const {
    CREATE_CAPABILITY_ID: TEMPLATE_CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID: TEMPLATE_DELETE_CAPABILITY_ID,
    SHELL_COMPONENT_CATEGORY,
    UPDATE_CAPABILITY_ID: TEMPLATE_UPDATE_CAPABILITY_ID,
    executeTemplateCreate,
    executeTemplateDelete,
    executeTemplateUpdate,
    normalizeSurfaceTreatmentMode,
} = require('../services/templateCommands.cjs');
const {
    createTemplateQueries,
} = require('../services/templateQueries.cjs');
const router = Router();

const templateQueries = createTemplateQueries({
    db,
    calculateRecipeCost,
    listTemplates: dbGetAllTemplates,
    loadPartsData,
    normalizeSurfaceTreatmentMode,
    recipeRow,
    shellComponentCategory: SHELL_COMPONENT_CATEGORY,
    templateRow,
});

function sendTemplateQueryError(res, error) {
    res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
    });
}

function templateCommandDependencies() {
    return {
        db,
        hardDelete,
        safeInsert,
        safeUpdate,
        templateRow,
    };
}

function legacyTemplateCommandResponse(result) {
    return {
        ...result,
        operationStatus: result.status,
        ...result.template,
    };
}

router.get('/', (req, res) => {
    try {
        res.json({
            success: true,
            data: templateQueries.getAllTemplates({
                shellModel: req.query.shellModel,
                description: req.query.description,
                limit: req.query.limit,
            }),
        });
    } catch (error) {
        sendTemplateQueryError(res, error);
    }
});

router.get('/:id', (req, res) => {
    try {
        res.json({
            success: true,
            data: templateQueries.getTemplate(req.params.id),
        });
    } catch (error) {
        sendTemplateQueryError(res, error);
    }
});

router.get('/:id/cost', (req, res) => {
    try {
        res.json({
            success: true,
            data: templateQueries.getTemplateCost(req.params.id),
        });
    } catch (error) {
        sendTemplateQueryError(res, error);
    }
});

router.get('/:id/default-recipe', (req, res) => {
    try {
        res.json({
            success: true,
            data: templateQueries.getDefaultRecipe(req.params.id),
        });
    } catch (error) {
        sendTemplateQueryError(res, error);
    }
});

router.post('/:id/apply', (req, res) => {
    try {
        res.json({
            success: true,
            data: templateQueries.applyTemplate(
                req.params.id,
                req.body?.recipe || {}
            ),
        });
    } catch (error) {
        sendTemplateQueryError(res, error);
    }
});

router.get('/:id/recipes', (req, res) => {
    try {
        res.json({
            success: true,
            data: templateQueries.getTemplateRecipes(req.params.id),
        });
    } catch (error) {
        sendTemplateQueryError(res, error);
    }
});

router.post('/', (req, res) => {
    try {
        const result = executeTemplateCreate(
            templateCommandDependencies(),
            req.body || {},
            commandContextFromRequest(req, TEMPLATE_CREATE_CAPABILITY_ID)
        );
        res.json({
            success: true,
            data: legacyTemplateCommandResponse(result),
        });
    } catch (error) { sendCommandError(res, error); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法模板ID' });
        const result = executeTemplateUpdate(
            templateCommandDependencies(),
            id,
            req.body || {},
            commandContextFromRequest(req, TEMPLATE_UPDATE_CAPABILITY_ID)
        );
        res.json({
            success: true,
            data: legacyTemplateCommandResponse(result),
        });
    } catch (error) { sendCommandError(res, error); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法模板ID' });
        const result = executeTemplateDelete(
            templateCommandDependencies(),
            id,
            {
                expectedUpdatedAt: req.body?.expectedUpdatedAt
                    ?? req.query?.expectedUpdatedAt
                    ?? req.headers['if-unmodified-since'],
            },
            commandContextFromRequest(req, TEMPLATE_DELETE_CAPABILITY_ID)
        );
        res.json({ success: true, data: result });
    } catch (error) { sendCommandError(res, error); }
});

module.exports = router;
