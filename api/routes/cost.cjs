const { Router } = require('express');
const { db, dbGetAllRecipes, dbGetAllCoils, recipeRow, loadPartsData, calculateRecipeCost, safeUpdate, nextBjtTime, getSetting, setSetting } = require('../db.cjs');
const { createLogger } = require('../logger.cjs');
const { calculateCoilCostHandler } = require('./coils.cjs');
const {
    calculatePackingEstimate,
    calculateOverheadEstimate,
} = require('../services/costEngine.cjs');
const { calculateRecipeCostPreview } = require('../services/dynamicCostPreview.cjs');
const {
    calculateDynamicConfigCost,
    calculateFloatEstimate,
    calculateCableEstimate,
} = require('../services/dynamicConfigCost.cjs');
const {
    DEFAULT_COIL_MATERIAL,
    parseStatorInput,
    resolveWireFromCoils,
    resolveWire,
    calculateFullEstimateCoilCost,
    buildFullEstimateResult,
} = require('../services/fullCostEstimate.cjs');
const { getMaterialPriceMap } = require('../services/coilCost.cjs');
const { calculateCurrentRecipeCost } = require('../services/currentRecipeCost.cjs');
const router = Router();
const costLogger = createLogger('cost');
const copperLogger = createLogger('copper');

// ── 健康检查 ──
router.get('/health', (req, res) => {
    res.json({ status: 'ok', message: '水泵BOM成本查询API运行中', timestamp: new Date().toISOString() });
});

// ── POST /cost/parts ──
function calculatePartsCostHandler(req, res) {
    try {
        const { parts } = req.body;
        if (!parts || !Array.isArray(parts) || parts.length === 0) {
            return res.status(400).json({ success: false, error: '请求体必须包含 parts 数组' });
        }
        const { partsCache, partsByModel } = loadPartsData();
        res.json({ success: true, data: calculateRecipeCost(parts, partsCache, partsByModel) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
}

router.post('/cost/parts', calculatePartsCostHandler);

// ── GET /cost/recipe/by-name ──
router.get('/cost/recipe/by-name', (req, res) => {
    try {
        const recipeName = req.query.name;
        if (!recipeName) return res.status(400).json({ success: false, error: '请提供 name 查询参数' });
        let allRecipes;
        try { allRecipes = dbGetAllRecipes(); }
        catch (error) { return res.status(500).json({ success: false, error: '获取配方失败: ' + error.message }); }
        if (!allRecipes || allRecipes.length === 0) return res.status(404).json({ success: false, error: '数据库中没有配方' });
        const recipe = allRecipes.find(r => { const name = r.name || ''; return name.includes(recipeName); });
        if (!recipe) return res.status(404).json({ success: false, error: `未找到名称包含 "${recipeName}" 的配方` });
        const name = recipe.name;
        const spec = recipe.spec;
        const partsJson = recipe.partsJson || '[]';
        let parts = [];
        try { parts = JSON.parse(partsJson); } catch { return res.status(400).json({ success: false, error: '配方配件JSON格式错误' }); }
        const { partsCache, partsByModel } = loadPartsData();
        const result = calculateRecipeCost(parts, partsCache, partsByModel);
        res.json({ success: true, data: { recipeId: recipe.Id, recipeName: name, recipeSpec: spec, ...result } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ── GET /recipes/current-costs ──
router.get('/recipes/current-costs', (req, res) => {
    try {
        const { partsCache, partsByModel } = loadPartsData();
        const coils = dbGetAllCoils();
        const items = dbGetAllRecipes().map(recipe => calculateCurrentRecipeCost(recipe, {
            partsCache,
            partsByModel,
            calculateRecipeCost,
            coils,
            getSetting,
        }));
        res.json({ success: true, data: { asOf: new Date().toISOString(), items } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

function calculateRecipeByIdHandler(req, res) {
    try {
        const recipeId = req.params.id;
        const data = { list: [recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(parseInt(recipeId)))].filter(Boolean) };
        if (!data.list || data.list.length === 0) return res.status(404).json({ success: false, error: `配方ID ${recipeId} 不存在` });
        const recipe = data.list[0];
        const name = recipe.name;
        const spec = recipe.spec;
        let parts = [];
        try { parts = JSON.parse(recipe.partsJson || '[]'); } catch { return res.status(400).json({ success: false, error: '配方配件JSON格式错误' }); }
        const { partsCache, partsByModel } = loadPartsData();
        const result = calculateRecipeCost(parts, partsCache, partsByModel);
        res.json({ success: true, data: { recipeId, recipeName: name, recipeSpec: spec, ...result } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
}

router.get('/recipes/:id/cost', calculateRecipeByIdHandler);

router.post('/cost/coil', calculateCoilCostHandler);

router.post('/cost/float', (req, res) => {
    try {
        const { partsByModel } = loadPartsData();
        res.json({ success: true, data: calculateFloatEstimate(req.body || {}, partsByModel, getSetting) });
    } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/cost/cable', (req, res) => {
    try {
        const { partsByModel } = loadPartsData();
        res.json({ success: true, data: calculateCableEstimate(req.body || {}, partsByModel, getSetting) });
    } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/cost/packing', (req, res) => {
    try {
        const { partsByModel } = loadPartsData();
        res.json({ success: true, data: calculatePackingEstimate(req.body || {}, partsByModel) });
    } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/cost/overhead', (req, res) => {
    try {
        res.json({ success: true, data: calculateOverheadEstimate(req.body || {}) });
    } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

// ── POST /cost/dynamic ──
router.post('/cost/dynamic', (req, res) => {
    try {
        const { stator, statorSpec: rawSpec, statorSheets: rawSheets, hasFloat, floatWire, floatAccessoryType = 'standard', hasCable, cableWire, cableLength, cableAccessoryType = 'standard', boxType } = req.body;
        let statorSpec = rawSpec, statorSheets = rawSheets;
        if (stator && typeof stator === 'string' && stator.includes('-')) {
            const [s, sh] = stator.split('-');
            statorSpec = statorSpec || s.trim();
            statorSheets = statorSheets || sh.trim();
        }
        const { partsCache, partsByModel } = loadPartsData();
        const getPrice = (model) => { const s = partsByModel[model] || []; if (s.length === 0) return 0; return s.reduce((min, c) => c.price < min.price ? c : min, s[0]).price; };
        const dbWire = resolveWireFromCoils(dbGetAllCoils(), statorSpec, statorSheets);
        const resolvedWire = resolveWire(dbWire, cableWire || floatWire);

        const effectiveCableLength = (hasCable || (cableLength && Number(cableLength) > 0)) ? cableLength : 0;
        const { totalCost, details } = calculateDynamicConfigCost(
            { hasFloat, floatWire, floatAccessoryType, cableLength: effectiveCableLength, cableWire, cableAccessoryType, boxType, resolvedWire },
            { partsCache, partsByModel, getPrice, getSetting }
        );
        res.json({ success: true, data: { totalCost: totalCost.toFixed(2), itemCount: details.length, resolvedWire, details } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ── POST /recipes/:id/cost-preview ──
router.post('/recipes/:id/cost-preview', (req, res) => {
    const baseRecipeId = req.params.id;
    const { overrides = {} } = req.body;
    try {
        const row = db.prepare('SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL').get(baseRecipeId);
        if (!row) return res.status(404).json({ success: false, error: 'Recipe not found' });
        const { partsCache, partsByModel } = loadPartsData();
        const result = calculateRecipeCostPreview(row, overrides, {
            partsCache,
            partsByModel,
            partsCatalog: Object.values(partsByModel).flat(),
            calculateRecipeCost,
            getCoils: dbGetAllCoils,
            getSetting,
        });
        costLogger.info(`DynamicCalc recipe=${result.recipeName}, unitCost=${result.unitCost}`);
        res.json({ success: true, data: { unitCost: result.unitCost } });
    } catch (err) {
        costLogger.error(`DynamicCalc failed recipe=${baseRecipeId}: ${err.stack || err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /cost/full-estimate ──
router.post('/cost/full-estimate', (req, res) => {
    try {
        const { pumphousing_model, stator, cableLength = 0, floatAccessoryType = 'standard', cableAccessoryType = 'standard', boxType = '', hasFloat = false, floatWire, cableWire } = req.body;
        const statorMaterial = req.body.statorMaterial || req.body.material || DEFAULT_COIL_MATERIAL;
        const { partsCache, partsByModel } = loadPartsData();
        const getPrice = (model) => { const s = partsByModel[model] || []; if (s.length === 0) return 0; return s.reduce((min, c) => c.price < min.price ? c : min, s[0]).price; };
        let recipeCost = null;

        // 步骤1: 配方成本
        if (pumphousing_model) {
            try {
                const allRecipes = dbGetAllRecipes();
                const recipe = allRecipes.find(r => (r.name || '').includes(pumphousing_model));
                if (recipe) {
                    let parts = []; try { parts = JSON.parse(recipe.partsJson || '[]'); } catch { /* */ }
                    const rc = calculateRecipeCost(parts, partsCache, partsByModel);
                    recipeCost = { recipeName: recipe.name, recipeSpec: recipe.spec, ...rc };
                } else { recipeCost = { error: `未找到名称包含 "${pumphousing_model}" 的配方` }; }
            } catch (e) { recipeCost = { error: '查询配方失败: ' + e.message }; }
        }

        // 步骤2: 线圈成本
        const { statorSpec, statorSheets } = parseStatorInput(stator);
        const allCoils = dbGetAllCoils();
        const statorCost = calculateFullEstimateCoilCost(allCoils, statorSpec, statorSheets, statorMaterial, { materialPrices: getMaterialPriceMap(getSetting) });

        // 步骤3: 动态配置成本（复用共享函数）
        const dbWire = resolveWireFromCoils(allCoils, statorSpec, statorSheets, statorMaterial);
        const resolvedWire = resolveWire(dbWire, cableWire || floatWire);
        const dynamic = calculateDynamicConfigCost(
            { hasFloat, floatWire, floatAccessoryType, cableLength, cableWire, cableAccessoryType, boxType, resolvedWire },
            { partsCache, partsByModel, getPrice, getSetting }
        );
        const result = buildFullEstimateResult({
            recipeCost,
            statorCost,
            dynamicCost: { totalCost: dynamic.totalCost.toFixed(2), resolvedWire, details: dynamic.details },
        });
        res.json({ success: true, data: result });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ── 市场指标 ──

async function fetchSpotMetalPrice(varietyId, label) {
    const url = `https://m.quheqihuo.com/dz/ajax/js_data_history.html?id=${varietyId}&size=1`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://m.quheqihuo.com/dz/js-d746.html' } });
    const json = await response.json();
    if (json.code !== 0 || !json.data || json.data.length === 0) throw new Error(`${label}数据获取失败: ` + JSON.stringify(json));
    return Number(json.data[0].price);
}

async function fetchCopperPrice() {
    return fetchSpotMetalPrice(746, '铜价');
}

async function fetchAluminumPrice() {
    return fetchSpotMetalPrice(544, '铝价');
}

async function fetchUsdCnyRate() {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD', { headers: { 'User-Agent': 'pump-bom-manager/1.0' } });
    const json = await response.json();
    const rate = Number(json?.rates?.CNY);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('美元兑人民币汇率获取失败: ' + JSON.stringify(json));
    return { rate, date: json.date || null };
}

function settingValue(key) {
    const value = Number(getSetting(key));
    return Number.isFinite(value) && value > 0 ? value.toFixed(key === 'usd_cny_rate' ? 4 : 2) : '';
}

function settingUpdatedAt(key) {
    const row = db.prepare('SELECT updated_at FROM system_settings WHERE key = ?').get(key);
    return row?.updated_at || null;
}

async function getMarketIndicators() {
    const [copperPrice, aluminumPrice, exchangeRate] = await Promise.all([
        fetchCopperPrice(),
        fetchAluminumPrice(),
        fetchUsdCnyRate(),
    ]);
    const coils = dbGetAllCoils();
    const dbCopperPrice = coils.length > 0 ? coils[0].copperBase : null;
    return {
        copper: {
            livePrice: copperPrice,
            livePricePerKg: (copperPrice / 1000).toFixed(2),
            dbPrice: dbCopperPrice,
            lastUpdate: coils[0]?.UpdatedAt || null,
        },
        aluminum: {
            livePrice: aluminumPrice,
            livePricePerKg: (aluminumPrice / 1000).toFixed(2),
            dbPrice: settingValue('aluminum_wire_price_per_kg'),
            lastUpdate: settingUpdatedAt('aluminum_wire_price_per_kg'),
        },
        exchangeRate: {
            base: 'USD',
            quote: 'CNY',
            liveRate: exchangeRate.rate.toFixed(4),
            dbRate: settingValue('usd_cny_rate'),
            lastUpdate: settingUpdatedAt('usd_cny_rate'),
            sourceDate: exchangeRate.date,
        },
    };
}

async function updateAllCoilsCopperPrice(copperPricePerTon) {
    const copperPricePerKg = (copperPricePerTon / 1000).toFixed(2);
    copperLogger.info(`获取铜价: ${copperPricePerTon} 元/吨 -> ${copperPricePerKg} 元/千克`);
    const allCoils = db.prepare('SELECT * FROM coils').all();
    const batchUpdate = db.transaction((coils) => {
        for (const coil of coils) {
            const newCost = coil.unit_price * coil.sheets + coil.wire_weight * parseFloat(copperPricePerKg) + coil.coil_fee + coil.rotor_fee;
            safeUpdate('coils', coil.id, { copper_base: copperPricePerKg, cost: newCost.toFixed(5) });
        }
    });
    batchUpdate(allCoils);
    copperLogger.info(`已更新 ${allCoils.length} 条线圈记录的铜价基数为 ${copperPricePerKg}`);
    return { copperPricePerTon, copperPricePerKg, updatedCount: allCoils.length };
}

async function runCopperPriceUpdate() {
    try {
        const price = await fetchCopperPrice();
        const result = await updateAllCoilsCopperPrice(price);
        copperLogger.info('完成', result);
        return result;
    } catch (err) { copperLogger.error(`失败: ${err.message}`); return null; }
}

async function runMarketIndicatorsUpdate() {
    const [copperPrice, aluminumPrice, exchangeRate] = await Promise.all([
        fetchCopperPrice(),
        fetchAluminumPrice(),
        fetchUsdCnyRate(),
    ]);
    const copperResult = await updateAllCoilsCopperPrice(copperPrice);
    const aluminumPricePerKg = (aluminumPrice / 1000).toFixed(2);
    const usdCnyRate = exchangeRate.rate.toFixed(4);
    setSetting('aluminum_wire_price_per_kg', aluminumPricePerKg);
    setSetting('usd_cny_rate', usdCnyRate);
    copperLogger.info(`已同步铝线价格基数 ${aluminumPricePerKg} 元/千克，美元汇率 ${usdCnyRate}`);
    return {
        ...copperResult,
        aluminumPricePerTon: aluminumPrice,
        aluminumPricePerKg,
        usdCnyRate,
    };
}

// 定时任务：每天北京时间 15:00 更新铜价
function scheduleNextCopperUpdate() {
    const now = new Date();
    const target = nextBjtTime(15);
    const delay = target.getTime() - now.getTime();
    const hours = (delay / 3600000).toFixed(1);
    copperLogger.info(`下次铜价更新: ${target.toISOString()} (${hours}h 后)`);
    setTimeout(async () => {
        copperLogger.info('触发每日铜价更新');
        await runCopperPriceUpdate();
        scheduleNextCopperUpdate(); // 链式调度下一次
    }, delay);
}
scheduleNextCopperUpdate();

router.post('/copper-price/update', async (req, res) => {
    try {
        const result = await runCopperPriceUpdate();
        if (result) res.json({ success: true, data: result });
        else res.status(500).json({ success: false, error: '铜价更新失败' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/copper-price', async (req, res) => {
    try {
        const price = await fetchCopperPrice();
        const coils = dbGetAllCoils();
        const dbCopperPrice = coils.length > 0 ? coils[0].copperBase : null;
        res.json({ success: true, data: { livePrice: price, livePricePerKg: (price / 1000).toFixed(2), dbPrice: dbCopperPrice, lastUpdate: coils[0]?.UpdatedAt || null } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/market-indicators/update', async (req, res) => {
    try {
        const result = await runMarketIndicatorsUpdate();
        res.json({ success: true, data: result });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/market-indicators', async (req, res) => {
    try {
        res.json({ success: true, data: await getMarketIndicators() });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 导出 runCopperPriceUpdate 供启动时调用
module.exports = router;
module.exports.runCopperPriceUpdate = runCopperPriceUpdate;
module.exports.runMarketIndicatorsUpdate = runMarketIndicatorsUpdate;
