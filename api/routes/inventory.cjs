'use strict';

const { Router } = require('express');
const {
    db, dbGetAllCoils, dbGetAllParts, dbGetAllRecipes, loadPartsData, recipeRow,
    modelVariantRow, templateRow, calculateRecipeCost, getSetting,
} = require('../db.cjs');
const { createRecipeQueries } = require('../services/recipeQueries.cjs');
const { createRecipeScenarioComparison } = require('../services/recipeScenarioComparison.cjs');
const { createVirtualReadinessPreview } = require('../services/virtualReadinessPreview.cjs');

const router = Router();
const recipeQueries = createRecipeQueries({
    db, listCoils: dbGetAllCoils, listParts: dbGetAllParts, listRecipes: dbGetAllRecipes,
    modelVariantRow, recipeRow, templateRow, getSetting,
});
const scenarioComparison = createRecipeScenarioComparison({
    db, recipeRow, listCoils: dbGetAllCoils, loadPartsData, calculateRecipeCost,
    getSetting, getBomDraft: recipeQueries.getBomDraft,
});
const virtualReadinessPreview = createVirtualReadinessPreview({
    db, recipeRow, listCoils: dbGetAllCoils, listParts: dbGetAllParts,
    getBomDraft: recipeQueries.getBomDraft, scenarioComparison,
});

router.post('/virtual-readiness-preview', (req, res) => {
    try {
        res.json({ success: true, data: virtualReadinessPreview.preview(req.body || {}) });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false, error: error.message,
            ...(error.code ? { code: error.code } : {}),
            ...(error.details !== undefined ? { details: error.details } : {}),
            ...(req.requestId ? { requestId: req.requestId } : {}),
        });
    }
});

module.exports = router;
