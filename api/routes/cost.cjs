const { Router } = require('express');
const { db, dbGetAllRecipes, dbGetAllCoils, recipeRow, coilRow, loadPartsData, calculateRecipeCost } = require('../db.cjs');
const router = Router();

// ── 健康检查 ──
router.get('/health', (req, res) => {
    res.json({ status: 'ok', message: '水泵BOM成本查询API运行中', timestamp: new Date().toISOString() });
});

// ── POST /cost/calculate ──
router.post('/cost/calculate', (req, res) => {
    try {
        const { parts } = req.body;
        if (!parts || !Array.isArray(parts) || parts.length === 0) {
            return res.status(400).json({ success: false, error: '请求体必须包含 parts 数组' });
        }
        const { partsCache, partsByModel } = loadPartsData();
        res.json({ success: true, data: calculateRecipeCost(parts, partsCache, partsByModel) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

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
        const partsJson = recipe.parts_json || '[]';
        let parts = [];
        try { parts = JSON.parse(partsJson); } catch { return res.status(400).json({ success: false, error: '配方配件JSON格式错误' }); }
        const { partsCache, partsByModel } = loadPartsData();
        const result = calculateRecipeCost(parts, partsCache, partsByModel);
        res.json({ success: true, data: { recipeId: recipe.Id, recipeName: name, recipeSpec: spec, ...result } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ── GET /cost/recipe/:id ──
router.get('/cost/recipe/:id', (req, res) => {
    try {
        const recipeId = req.params.id;
        const data = { list: [recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(parseInt(recipeId)))].filter(Boolean) };
        if (!data.list || data.list.length === 0) return res.status(404).json({ success: false, error: `配方ID ${recipeId} 不存在` });
        const recipe = data.list[0];
        const name = recipe.name;
        const spec = recipe.spec;
        let parts = [];
        try { parts = JSON.parse(recipe.parts_json || '[]'); } catch { return res.status(400).json({ success: false, error: '配方配件JSON格式错误' }); }
        const { partsCache, partsByModel } = loadPartsData();
        const result = calculateRecipeCost(parts, partsCache, partsByModel);
        res.json({ success: true, data: { recipeId, recipeName: name, recipeSpec: spec, ...result } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ── 辅助：从线圈表查线径 ──
function resolveWireFromStator(statorSpec, statorSheets) {
    if (!statorSpec || !statorSheets) return null;
    try {
        const record = db.prepare('SELECT default_wire_gauge FROM coils WHERE spec = ? AND sheets = ? LIMIT 1').get(String(statorSpec), parseInt(statorSheets));
        return record?.default_wire_gauge || null;
    } catch { return null; }
}
function resolveWire(dbWire, explicitWire) {
    if (explicitWire) return explicitWire;
    if (dbWire) return dbWire;
    return '0.55';
}

// ── P1-5: 动态配件成本共享计算函数 ──
function calculateDynamicCost({ hasFloat, floatWire, cableLength, cableWire, boxType, resolvedWire, getPrice, partsCache }) {
    let totalCost = 0;
    const details = [];

    if (hasFloat) {
        const wire = floatWire || resolvedWire;
        const model = `浮球-线径${wire}`;
        const price = getPrice(model);
        totalCost += price;
        details.push({ name: '浮球', model, price: price.toFixed(2), qty: 1, subtotal: price.toFixed(2) });
    }

    const needCable = cableLength && Number(cableLength) > 0;
    if (needCable) {
        const wire = cableWire || resolvedWire;
        const cableModel = `电缆-线径${wire}`;
        const cp = getPrice(cableModel);
        const len = Number(cableLength);
        totalCost += cp * len;
        details.push({ name: '电缆线', model: cableModel, price: cp.toFixed(2), qty: len, subtotal: (cp * len).toFixed(2) });
        const ap = getPrice('电缆配件费');
        totalCost += ap;
        details.push({ name: '电缆接头配件', model: '电缆配件费', price: ap.toFixed(2), qty: 1, subtotal: ap.toFixed(2) });
    }

    if (boxType) {
        let matchedModel = boxType, price = getPrice(boxType);
        if (price === 0) {
            const kw = boxType.trim();
            const cands = [];
            for (const [m, info] of Object.entries(partsCache)) {
                if (info.category === '包装' && m.includes(kw)) cands.push({ model: m, price: info.price });
            }
            if (cands.length > 0) {
                const best = cands.reduce((min, c) => c.price < min.price ? c : min, cands[0]);
                matchedModel = best.model;
                price = best.price;
            }
        }
        totalCost += price;
        details.push({ name: matchedModel.includes('木') ? '木箱' : '纸箱', model: matchedModel, price: price.toFixed(2), qty: 1, subtotal: price.toFixed(2) });
    }

    return { totalCost, details };
}

// ── POST /cost/dynamic-config ──
router.post('/cost/dynamic-config', (req, res) => {
    try {
        const { stator, statorSpec: rawSpec, statorSheets: rawSheets, hasFloat, floatWire, hasCable, cableWire, cableLength, boxType } = req.body;
        let statorSpec = rawSpec, statorSheets = rawSheets;
        if (stator && typeof stator === 'string' && stator.includes('-')) {
            const [s, sh] = stator.split('-');
            statorSpec = statorSpec || s.trim();
            statorSheets = statorSheets || sh.trim();
        }
        const { partsCache, partsByModel } = loadPartsData();
        const getPrice = (model) => { const s = partsByModel[model] || []; if (s.length === 0) return 0; return s.reduce((min, c) => c.price < min.price ? c : min, s[0]).price; };
        const dbWire = resolveWireFromStator(statorSpec, statorSheets);
        const resolvedWire = resolveWire(dbWire, cableWire || floatWire);

        const effectiveCableLength = (hasCable || (cableLength && Number(cableLength) > 0)) ? cableLength : 0;
        const { totalCost, details } = calculateDynamicCost({ hasFloat, floatWire, cableLength: effectiveCableLength, cableWire, boxType, resolvedWire, getPrice, partsCache });
        res.json({ success: true, data: { totalCost: totalCost.toFixed(2), itemCount: details.length, resolvedWire, details } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ── POST /cost/full-calculate ──
router.post('/cost/full-calculate', (req, res) => {
    try {
        const { pumphousing_model, stator, cableLength = 0, boxType = '', hasFloat = false, floatWire, cableWire } = req.body;
        const { partsCache, partsByModel } = loadPartsData();
        const getPrice = (model) => { const s = partsByModel[model] || []; if (s.length === 0) return 0; return s.reduce((min, c) => c.price < min.price ? c : min, s[0]).price; };
        const result = { recipeCost: null, statorCost: null, dynamicCost: null, totalCost: '0', breakdown: {} };
        let grandTotal = 0;

        // 步骤1: 配方成本
        if (pumphousing_model) {
            try {
                const allRecipes = dbGetAllRecipes();
                const recipe = allRecipes.find(r => (r.name || '').includes(pumphousing_model));
                if (recipe) {
                    let parts = []; try { parts = JSON.parse(recipe.parts_json || '[]'); } catch { /* */ }
                    const rc = calculateRecipeCost(parts, partsCache, partsByModel);
                    result.recipeCost = { recipeName: recipe.name, recipeSpec: recipe.spec, ...rc };
                    grandTotal += parseFloat(rc.totalCost);
                } else { result.recipeCost = { error: `未找到名称包含 "${pumphousing_model}" 的配方` }; }
            } catch (e) { result.recipeCost = { error: '查询配方失败: ' + e.message }; }
        }

        // 步骤2: 线圈成本
        let statorSpec, statorSheets;
        if (stator && typeof stator === 'string' && stator.includes('-')) { const [s, sh] = stator.split('-'); statorSpec = s.trim(); statorSheets = sh.trim(); }
        if (statorSpec && statorSheets) {
            try {
                const sr = coilRow(db.prepare('SELECT * FROM coils WHERE spec = ? AND sheets = ? LIMIT 1').get(statorSpec, parseInt(statorSheets)));
                if (sr) {
                    const cost = parseFloat(sr.cost || 0);
                    result.statorCost = { spec: statorSpec, sheets: statorSheets, cost: cost.toFixed(2), wireGauge: sr.defaultWireGauge || null, source: '精确匹配' };
                    grandTotal += cost;
                } else {
                    const bases = db.prepare('SELECT * FROM coils WHERE spec = ? LIMIT 10').all(statorSpec).map(coilRow);
                    if (bases.length > 0) {
                        const b = bases[0]; const up = parseFloat(b.unitPrice || 0); const ww = parseFloat(b.wireWeight || 0);
                        const cb = parseFloat(b.copperBase || 0); const cf = parseFloat(b.coilFee || 0); const rf = parseFloat(b.rotorFee || 0);
                        const sh = parseInt(statorSheets); const cc = up * sh + ww * cb + cf + rf;
                        result.statorCost = { spec: statorSpec, sheets: statorSheets, cost: cc.toFixed(2), wireGauge: b.defaultWireGauge || null, source: '公式推算', formula: `${up}×${sh} + ${ww}×${cb} + ${cf} + ${rf}` };
                        grandTotal += cc;
                    } else { result.statorCost = { error: `未找到规格 ${statorSpec} 的线圈数据` }; }
                }
            } catch (e) { result.statorCost = { error: '查询线圈成本失败: ' + e.message }; }
        }

        // 步骤3: 动态配置成本（复用共享函数）
        const dbWire = statorSpec && statorSheets ? resolveWireFromStator(statorSpec, statorSheets) : null;
        const resolvedWire = resolveWire(dbWire, cableWire || floatWire);
        const dynamic = calculateDynamicCost({ hasFloat, floatWire, cableLength, cableWire, boxType, resolvedWire, getPrice, partsCache });
        result.dynamicCost = { totalCost: dynamic.totalCost.toFixed(2), resolvedWire, details: dynamic.details };
        grandTotal += dynamic.totalCost;
        result.totalCost = grandTotal.toFixed(2);
        result.breakdown = { recipeCost: result.recipeCost?.totalCost || '0', statorCost: result.statorCost?.cost || '0', dynamicCost: dynamic.totalCost.toFixed(2) };
        res.json({ success: true, data: result });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ── 铜价 ──

async function fetchCopperPrice() {
    const url = 'https://m.quheqihuo.com/dz/ajax/js_data_history.html?id=746&size=1';
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://m.quheqihuo.com/dz/js-d746.html' } });
    const json = await response.json();
    if (json.code !== 0 || !json.data || json.data.length === 0) throw new Error('铜价数据获取失败: ' + JSON.stringify(json));
    return json.data[0].price;
}

async function updateAllCoilsCopperPrice(copperPricePerTon) {
    const copperPricePerKg = (copperPricePerTon / 1000).toFixed(2);
    console.log(`[铜价更新] 获取铜价: ${copperPricePerTon} 元/吨 → ${copperPricePerKg} 元/千克`);
    const allCoils = db.prepare('SELECT * FROM coils').all();
    const updateCoil = db.prepare('UPDATE coils SET copper_base = ?, cost = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    const batchUpdate = db.transaction((coils) => {
        for (const coil of coils) {
            const newCost = coil.unit_price * coil.sheets + coil.wire_weight * parseFloat(copperPricePerKg) + coil.coil_fee + coil.rotor_fee;
            updateCoil.run(copperPricePerKg, newCost.toFixed(5), now, coil.id);
        }
    });
    batchUpdate(allCoils);
    console.log(`[铜价更新] 已更新 ${allCoils.length} 条线圈记录的铜价基数为 ${copperPricePerKg}`);
    return { copperPricePerTon, copperPricePerKg, updatedCount: allCoils.length };
}

async function runCopperPriceUpdate() {
    try {
        const price = await fetchCopperPrice();
        const result = await updateAllCoilsCopperPrice(price);
        console.log('[铜价更新] 完成:', result);
        return result;
    } catch (err) { console.error('[铜价更新] 失败:', err.message); return null; }
}

// 定时任务：每天北京时间 15:00 更新铜价
function scheduleNextCopperUpdate() {
    const now = new Date();
    // 计算下一个北京时间 15:00 的 UTC 时间
    const bjNow = new Date(now.getTime() + 8 * 3600 * 1000);
    const target = new Date(bjNow);
    target.setUTCHours(7, 0, 0, 0); // 15:00 BJT = 07:00 UTC
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    const delay = target.getTime() - now.getTime();
    const hours = (delay / 3600000).toFixed(1);
    console.log(`[定时任务] 下次铜价更新: ${target.toISOString()} (${hours}h 后)`);
    setTimeout(async () => {
        console.log('[定时任务] 触发每日铜价更新...');
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

// 导出 runCopperPriceUpdate 供启动时调用
module.exports = router;
module.exports.runCopperPriceUpdate = runCopperPriceUpdate;
