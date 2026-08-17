const { Router } = require('express');
const { db, dbGetAllRecipes, dbGetAllCoils, dbGetAllParts, recipeRow, templateRow, modelVariantRow, loadPartsData, calculateRecipeCost, safeUpdate, nextBjtTime, getSetting, setSetting } = require('../db.cjs');
const { createLogger } = require('../logger.cjs');
const {
    createCostQueries,
} = require('../services/costQueries.cjs');
const {
    createRecipeQueries,
} = require('../services/recipeQueries.cjs');
const router = Router();
const costLogger = createLogger('cost');
const copperLogger = createLogger('copper');
const { fetchWithPolicy } = require('../services/httpClient.cjs');
const {
    COPPER_SYNC_CAPABILITY_ID,
    INDICATOR_SYNC_CAPABILITY_ID,
    assertMarketSyncRequestBody,
} = require('../services/marketIndicatorCommands.cjs');
const {
    createMarketSyncService,
} = require('../services/marketSync.cjs');
const {
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');

const marketSync = createMarketSyncService({
    db,
    dbGetAllCoils,
    fetchWithPolicy,
    getSetting,
    logger: copperLogger,
    safeUpdate,
    setSetting,
});
const recipeQueries = createRecipeQueries({
    db,
    listCoils: dbGetAllCoils,
    listParts: dbGetAllParts,
    listRecipes: dbGetAllRecipes,
    modelVariantRow,
    recipeRow,
    templateRow,
    getSetting,
});
const costQueries = createCostQueries({
    db,
    calculateRecipeCost,
    getSetting,
    listCoils: dbGetAllCoils,
    listRecipes: dbGetAllRecipes,
    loadPartsData,
    recipeRow,
    buildBomDraft: recipeQueries.getBomDraft,
});

function sendCostQueryError(res, error, fallbackStatus = 500) {
    res.status(error.statusCode || fallbackStatus).json({
        success: false,
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.details !== undefined ? { details: error.details } : {}),
        ...(res.req?.requestId ? { requestId: res.req.requestId } : {}),
    });
}

// ── POST /cost/parts ──
router.post('/cost/parts', (req, res) => {
    try {
        res.json({
            success: true,
            data: costQueries.calculateParts(req.body || {}),
        });
    } catch (error) {
        sendCostQueryError(res, error);
    }
});

// ── GET /cost/recipe/by-name ──
router.get('/cost/recipe/by-name', (req, res) => {
    try {
        res.json({
            success: true,
            data: costQueries.getRecipeCostByName(req.query.name),
        });
    } catch (error) {
        sendCostQueryError(res, error);
    }
});

// ── GET /recipes/current-costs ──
router.get('/recipes/current-costs', (req, res) => {
    try {
        res.json({
            success: true,
            data: costQueries.getCurrentRecipeCosts(),
        });
    } catch (error) {
        sendCostQueryError(res, error);
    }
});

router.get('/recipes/:id/cost', (req, res) => {
    try {
        res.json({
            success: true,
            data: costQueries.getRecipeCostById(req.params.id),
        });
    } catch (error) {
        sendCostQueryError(res, error);
    }
});

router.post('/cost/coil', (req, res) => {
    try {
        res.json({
            success: true,
            data: costQueries.calculateCoil(req.body || {}),
        });
    } catch (error) {
        sendCostQueryError(res, error);
    }
});

router.post('/cost/float', (req, res) => {
    try {
        res.json({
            success: true,
            data: costQueries.calculateFloat(req.body || {}),
        });
    } catch (error) {
        sendCostQueryError(res, error, 400);
    }
});

router.post('/cost/cable', (req, res) => {
    try {
        res.json({
            success: true,
            data: costQueries.calculateCable(req.body || {}),
        });
    } catch (error) {
        sendCostQueryError(res, error, 400);
    }
});

router.post('/cost/packing', (req, res) => {
    try {
        res.json({
            success: true,
            data: costQueries.calculatePacking(req.body || {}),
        });
    } catch (error) {
        sendCostQueryError(res, error, 400);
    }
});

router.post('/cost/overhead', (req, res) => {
    try {
        res.json({
            success: true,
            data: costQueries.calculateOverhead(req.body || {}),
        });
    } catch (error) {
        sendCostQueryError(res, error, 400);
    }
});

// ── POST /cost/dynamic ──
router.post('/cost/dynamic', (req, res) => {
    try {
        res.json({
            success: true,
            data: costQueries.calculateDynamic(req.body || {}),
        });
    } catch (error) {
        sendCostQueryError(res, error);
    }
});

// ── POST /recipes/:id/cost-preview ──
router.post('/recipes/:id/cost-preview', (req, res) => {
    const baseRecipeId = req.params.id;
    const { overrides = {} } = req.body;
    try {
        const result = costQueries.previewRecipeCost(
            baseRecipeId,
            overrides
        );
        costLogger.info(
            `DynamicCalc recipe=${result.recipeName}, `
            + `unitCost=${result.data.unitCost}`
        );
        res.json({
            success: true,
            data: result.data,
        });
    } catch (err) {
        costLogger.error(`DynamicCalc failed recipe=${baseRecipeId}: ${err.stack || err.message}`);
        sendCostQueryError(res, err);
    }
});

// ── POST /cost/full-estimate ──
router.post('/cost/full-estimate', (req, res) => {
    try {
        const input = { ...(req.body || {}) };
        if (!input.recipeName && input.pumphousing_model) {
            input.recipeName = input.pumphousing_model;
        }
        delete input.pumphousing_model;
        res.json({
            success: true,
            data: costQueries.calculateFullEstimate(input),
        });
    } catch (error) {
        sendCostQueryError(res, error);
    }
});

router.post('/cost/recipe-difference', (req, res) => {
    try {
        res.json({
            success: true,
            data: costQueries.getRecipeDifference(req.body || {}),
        });
    } catch (error) {
        sendCostQueryError(res, error, 400);
    }
});

// ── 市场指标 ──

const runCopperPriceUpdate = options =>
    marketSync.runCopperPriceUpdate(options);
const runMarketIndicatorsUpdate = options =>
    marketSync.syncMarketIndicators({
        trigger: options?.trigger || 'internal',
        now: options?.now || new Date(),
        commandContext: options?.commandContext,
    });

// 定时任务：每天北京时间 15:00 更新铜价
function scheduleNextCopperUpdate() {
    const now = new Date();
    const target = nextBjtTime(15);
    const delay = target.getTime() - now.getTime();
    const hours = (delay / 3600000).toFixed(1);
    copperLogger.info(`下次铜价更新: ${target.toISOString()} (${hours}h 后)`);
    copperUpdateTimer = setTimeout(async () => {
        copperUpdateTimer = null;
        copperLogger.info('触发每日铜价更新');
        await runCopperPriceUpdate({ trigger: 'scheduled' });
        scheduleNextCopperUpdate(); // 链式调度下一次
    }, delay);
    if (typeof copperUpdateTimer.unref === 'function') copperUpdateTimer.unref();
}
let copperUpdateTimer = null;
scheduleNextCopperUpdate();

function stopCopperPriceScheduler() {
    if (copperUpdateTimer) clearTimeout(copperUpdateTimer);
    copperUpdateTimer = null;
}

router.post('/copper-price/update', async (req, res) => {
    try {
        assertMarketSyncRequestBody(req.body);
        const result = await marketSync.syncCopperPrice({
            commandContext: commandContextFromRequest(
                req,
                COPPER_SYNC_CAPABILITY_ID
            ),
            trigger: 'manual',
        });
        res.json({ success: true, data: result });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.get('/copper-price', async (req, res) => {
    try {
        res.json({
            success: true,
            data: await marketSync.getCopperPrice(),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/market-indicators/update', async (req, res) => {
    try {
        assertMarketSyncRequestBody(req.body);
        const result = await marketSync.syncMarketIndicators({
            commandContext: commandContextFromRequest(
                req,
                INDICATOR_SYNC_CAPABILITY_ID
            ),
            trigger: 'manual',
        });
        res.json({ success: true, data: result });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.get('/market-indicators', async (req, res) => {
    try {
        res.json({
            success: true,
            data: await marketSync.getMarketIndicators(),
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

// 导出 runCopperPriceUpdate 供启动时调用
module.exports = router;
module.exports.runCopperPriceUpdate = runCopperPriceUpdate;
module.exports.runMarketIndicatorsUpdate = runMarketIndicatorsUpdate;
module.exports.stopCopperPriceScheduler = stopCopperPriceScheduler;
