const { Router } = require('express');
const { db, dbGetAllRecipes, dbGetAllCoils, recipeRow, coilRow, loadPartsData, calculateRecipeCost, safeUpdate, nextBjtTime, getSetting } = require('../db.cjs');
const { createLogger } = require('../logger.cjs');
const { calculateCoilCostHandler } = require('./coils.cjs');
const router = Router();
const DEFAULT_COIL_MATERIAL = '钢带';
const costLogger = createLogger('cost');
const copperLogger = createLogger('copper');

// ── 健康检查 ──
router.get('/health', (req, res) => {
    res.json({ status: 'ok', message: '水泵BOM成本查询API运行中', timestamp: new Date().toISOString() });
});

// ── POST /cost/calculate ──
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

router.post(['/cost/parts', '/cost/calculate'], calculatePartsCostHandler);

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

// ── GET /cost/recipe/:id ──
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

router.get(['/recipes/:id/cost', '/cost/recipe/:id'], calculateRecipeByIdHandler);

// ── 辅助：从线圈表查线径 ──
function resolveWireFromStator(statorSpec, statorSheets, material = DEFAULT_COIL_MATERIAL) {
    if (!statorSpec || !statorSheets) return null;
    try {
        const record = db.prepare(`SELECT default_wire_gauge FROM coils WHERE spec = ? AND sheets = ? ORDER BY CASE WHEN material = ? THEN 0 WHEN material = ? THEN 1 ELSE 2 END LIMIT 1`).get(String(statorSpec), parseInt(statorSheets), material || DEFAULT_COIL_MATERIAL, DEFAULT_COIL_MATERIAL);
        return record?.default_wire_gauge || null;
    } catch { return null; }
}
function resolveWire(dbWire, explicitWire) {
    if (explicitWire) return explicitWire;
    if (dbWire) return dbWire;
    return '0.55';
}

// ── P1-5: 动态配件成本共享计算函数 ──
function calculateDynamicCost({ hasFloat, floatWire, cableLength, cableWire, cableAccessoryType = 'standard', boxType, resolvedWire, getPrice, partsCache, partsByModel }) {
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
        const ap = getCableAccessoryFee(partsByModel, cableModel, '', getPrice, cableAccessoryType);
        const accessoryName = getCableAccessoryName(partsByModel, cableModel, '', cableAccessoryType);
        totalCost += ap;
        details.push({ name: accessoryName, model: '电缆配件费', price: ap.toFixed(2), qty: 1, subtotal: ap.toFixed(2) });
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

function toBool(v) {
    return v === true || v === 1 || v === '1';
}

function sameNumber(a, b) {
    return Number(a || 0) === Number(b || 0);
}

function sameText(a, b) {
    return String(a || '') === String(b || '');
}

function getOverride(overrides, camelKey, snakeKey, fallback) {
    if (overrides?.[camelKey] !== undefined) return overrides[camelKey];
    if (overrides?.[snakeKey] !== undefined) return overrides[snakeKey];
    return fallback;
}

function parseCableAccessoryFee(notes, accessoryType = 'standard') {
    if (!notes) return null;
    try {
        const meta = JSON.parse(notes);
        const typedFee = Number(meta?.cableAccessoryFees?.[accessoryType]);
        if (Number.isFinite(typedFee) && typedFee >= 0) return typedFee;
        const fee = Number(meta?.cableAccessoryFee);
        return Number.isFinite(fee) && fee >= 0 ? fee : null;
    } catch {
        return null;
    }
}

function parseCableAccessoryName(notes, accessoryType = 'standard') {
    if (!notes) return null;
    try {
        const name = JSON.parse(notes)?.cableAccessoryNames?.[accessoryType];
        return typeof name === 'string' && name.trim() ? name.trim() : null;
    } catch {
        return null;
    }
}

function getGlobalCableAccessory(accessoryType = 'standard') {
    try {
        const config = JSON.parse(getSetting('cable_accessories') || '{}')?.[accessoryType];
        const fee = Number(config?.fee);
        return {
            name: typeof config?.name === 'string' && config.name.trim()
                ? config.name.trim()
                : (accessoryType === 'xinjie' ? '新界式' : '普通铜套'),
            fee: Number.isFinite(fee) && fee >= 0 ? fee : null,
        };
    } catch {
        return { name: accessoryType === 'xinjie' ? '新界式' : '普通铜套', fee: null };
    }
}

function getCableAccessoryFee(partsByModel, cableModel, supplier, getPrice, accessoryType = 'standard') {
    const globalAccessory = getGlobalCableAccessory(accessoryType);
    if (globalAccessory.fee != null) return globalAccessory.fee;
    const suppliers = partsByModel[cableModel] || [];
    const normalizedSupplier = String(supplier || '').trim();
    const match = suppliers.find(s => String(s.supplier || '').trim() === normalizedSupplier);
    const matchedFee = parseCableAccessoryFee(match?.notes, accessoryType);
    if (match && normalizedSupplier && matchedFee != null) return matchedFee;
    if (suppliers.length > 0) {
        const fallback = suppliers.reduce((min, c) => c.price < min.price ? c : min, suppliers[0]);
        const fallbackFee = parseCableAccessoryFee(fallback?.notes, accessoryType);
        if (fallbackFee != null) return fallbackFee;
    }
    return getPrice('电缆配件费');
}

function getCableAccessoryName(partsByModel, cableModel, supplier, accessoryType = 'standard') {
    const globalAccessory = getGlobalCableAccessory(accessoryType);
    if (globalAccessory.name) return globalAccessory.name;
    const suppliers = partsByModel[cableModel] || [];
    const normalizedSupplier = String(supplier || '').trim();
    const match = suppliers.find(s => String(s.supplier || '').trim() === normalizedSupplier);
    const matchedName = parseCableAccessoryName(match?.notes, accessoryType);
    if (match && normalizedSupplier && matchedName) return matchedName;
    if (suppliers.length > 0) {
        const fallback = suppliers.reduce((min, c) => c.price < min.price ? c : min, suppliers[0]);
        const fallbackName = parseCableAccessoryName(fallback?.notes, accessoryType);
        if (fallbackName) return fallbackName;
    }
    return accessoryType === 'xinjie' ? '新界式' : '普通铜套';
}

function normalizePackingJsonText(value, boxType) {
    let list = [];
    try {
        list = JSON.parse(value || '[]');
    } catch {
        list = [];
    }
    if ((!Array.isArray(list) || list.length === 0) && boxType) {
        list = [{ model: boxType, supplier: '', qty: 1 }];
    }
    if (!Array.isArray(list)) list = [];
    return JSON.stringify(list
        .filter(part => part?.model)
        .map(part => ({
            model: part.model,
            supplier: part.supplier || '',
            qty: Number(part.qty || 1)
        })));
}

function managedPartType(part) {
    const name = String(part?.name || '');
    const model = String(part?.model || '');
    if (name.includes('cm)')) return 'barrelLength';
    if (name === '线圈转子') return 'coil';
    if (name.includes('浮球') || model.startsWith('浮球-')) return 'float';
    if (name.includes('电缆') || model.startsWith('电缆-') || model === '电缆配件费') return 'cable';
    if (name.includes('木箱') || name.includes('纸箱') || model.includes('木箱') || model.includes('纸箱')) return 'box';
    return null;
}

function partSnapshotSubtotal(part, partsCache, partsByModel) {
    if (part?.snapshotPrice !== undefined) return Number(part.snapshotPrice || 0) * Number(part.qty || 0);
    return Number(calculateRecipeCost([part], partsCache, partsByModel).totalCost || 0);
}

function lengthPricedPartSubtotal(part, customBarrelLength) {
    const price = Number(part?.snapshotPrice || 0);
    const savedQty = Number(part?.qty || 0);
    const nextQty = customBarrelLength && Number(customBarrelLength) > 0 ? Number(customBarrelLength) / 10 : savedQty;
    return price * nextQty;
}

function configuredModel(prefix, wireOrModel, resolvedWire) {
    const value = String(wireOrModel || '').trim();
    if (value.startsWith(prefix)) return value;
    const wire = value || resolvedWire;
    return wire ? `${prefix}-线径${wire}` : '';
}

function findBoxPrice(boxType, getPrice, partsCache) {
    if (!boxType) return 0;
    let price = getPrice(boxType);
    if (price !== 0) return price;
    const kw = String(boxType).trim();
    const cands = [];
    for (const [m, info] of Object.entries(partsCache)) {
        if (info.category === '包装' && m.includes(kw)) cands.push({ model: m, price: info.price });
    }
    return cands.length > 0 ? cands.reduce((min, c) => c.price < min.price ? c : min, cands[0]).price : 0;
}

function calculatePackingPartsCost(packingPartsJson, getPrice) {
    let packingParts = [];
    try { packingParts = JSON.parse(packingPartsJson || '[]'); } catch { packingParts = []; }
    return packingParts.reduce((sum, part) => {
        if (!part?.model) return sum;
        const price = part.snapshotPrice !== undefined ? Number(part.snapshotPrice || 0) : getPrice(part.model);
        return sum + price * Number(part.qty || 1);
    }, 0);
}

function calculateCoilCostValue(spec, sheets, material = DEFAULT_COIL_MATERIAL) {
    if (!spec || !sheets) return 0;
    const targetSheets = parseInt(sheets);
    const allSpecCoils = dbGetAllCoils()
        .filter(c => String(c.spec).trim() === String(spec).trim())
        .sort((a, b) => parseInt(a.sheets) - parseInt(b.sheets));
    const materialCoils = allSpecCoils.filter(c => String(c.material || DEFAULT_COIL_MATERIAL).trim() === String(material || DEFAULT_COIL_MATERIAL).trim());
    const steelCoils = allSpecCoils.filter(c => String(c.material || DEFAULT_COIL_MATERIAL).trim() === DEFAULT_COIL_MATERIAL);
    const specCoils = materialCoils.length > 0 ? materialCoils : (steelCoils.length > 0 ? steelCoils : allSpecCoils);
    if (specCoils.length === 0) return 0;

    const exact = specCoils.find(c => parseInt(c.sheets) === targetSheets);
    if (exact) return Number(exact.cost || 0);

    let lower = null, upper = null;
    for (const c of specCoils) {
        const s = parseInt(c.sheets);
        if (s < targetSheets) lower = c;
        if (s > targetSheets && !upper) upper = c;
    }
    const base = lower || upper;
    if (!base) return 0;
    let wireWeight = parseFloat(base.wireWeight || 0);
    let coilFee = parseFloat(base.coilFee || 0);
    let rotorFee = parseFloat(base.rotorFee || 0);
    if (lower && upper) {
        const lS = parseInt(lower.sheets), uS = parseInt(upper.sheets);
        const ratio = (targetSheets - lS) / (uS - lS);
        wireWeight = parseFloat(lower.wireWeight || 0) + (parseFloat(upper.wireWeight || 0) - parseFloat(lower.wireWeight || 0)) * ratio;
        coilFee = parseFloat(lower.coilFee || 0) + (parseFloat(upper.coilFee || 0) - parseFloat(lower.coilFee || 0)) * ratio;
        rotorFee = parseFloat(lower.rotorFee || 0) + (parseFloat(upper.rotorFee || 0) - parseFloat(lower.rotorFee || 0)) * ratio;
    }
    return parseFloat(base.unitPrice || 0) * targetSheets + wireWeight * parseFloat(base.copperBase || 0) + coilFee + rotorFee;
}

function createPartPriceGetter(partsByModel) {
    return (model, supplier = '') => {
        const candidates = partsByModel[model] || [];
        const normalizedSupplier = String(supplier || '').trim();
        const exact = candidates.find(part => String(part.supplier || '').trim() === normalizedSupplier);
        if (exact && normalizedSupplier) return Number(exact.price || 0);
        if (candidates.length === 0) return 0;
        return Number(candidates.reduce((min, part) => part.price < min.price ? part : min, candidates[0]).price || 0);
    };
}

function parseNonNegativeNumber(value, field, { required = false, defaultValue = 0 } = {}) {
    if ((value === undefined || value === null || value === '') && !required) return defaultValue;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${field} 必须是非负数字`);
    return number;
}

function normalizeCableAccessoryType(value) {
    const type = value || 'standard';
    if (!['standard', 'xinjie'].includes(type)) throw new Error('cableAccessoryType 必须是 standard 或 xinjie');
    return type;
}

function calculateFloatEstimate(body, partsByModel) {
    const wire = String(body.wire || body.floatWire || '0.55').trim();
    const model = String(body.model || `浮球-线径${wire}`).trim();
    const qty = parseNonNegativeNumber(body.qty, 'qty', { defaultValue: 1 });
    const getPrice = createPartPriceGetter(partsByModel);
    const unitPrice = getPrice(model, body.supplier);
    return { model, wire, supplier: body.supplier || '', qty, unitPrice, totalCost: Number((unitPrice * qty).toFixed(2)) };
}

function calculateCableEstimate(body, partsByModel) {
    const wire = String(body.wire || body.cableWire || '0.55').trim();
    const model = String(body.model || `电缆-线径${wire}`).trim();
    const supplier = String(body.supplier || '').trim();
    const length = parseNonNegativeNumber(body.length ?? body.cableLength, 'length', { required: true });
    const cableAccessoryType = normalizeCableAccessoryType(body.cableAccessoryType);
    const getPrice = createPartPriceGetter(partsByModel);
    const unitPrice = getPrice(model, supplier);
    const cableSubtotal = unitPrice * length;
    const accessoryFee = getCableAccessoryFee(partsByModel, model, supplier, getPrice, cableAccessoryType);
    const accessoryName = getCableAccessoryName(partsByModel, model, supplier, cableAccessoryType);
    return {
        model, wire, supplier, length, unitPrice,
        cableSubtotal: Number(cableSubtotal.toFixed(2)),
        cableAccessoryType, accessoryName, accessoryFee,
        totalCost: Number((cableSubtotal + accessoryFee).toFixed(2))
    };
}

function calculatePackingEstimate(body, partsByModel) {
    const getPrice = createPartPriceGetter(partsByModel);
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (parts.length === 0) throw new Error('parts 必须是非空数组');
    const details = parts.map(part => {
        if (!part?.model) throw new Error('每个包材必须包含 model');
        const qty = parseNonNegativeNumber(part.qty, 'qty', { defaultValue: 1 });
        const unitPrice = part.snapshotPrice !== undefined
            ? parseNonNegativeNumber(part.snapshotPrice, 'snapshotPrice')
            : getPrice(part.model, part.supplier);
        return {
            model: part.model,
            supplier: part.supplier || '',
            qty,
            unitPrice,
            subtotal: Number((unitPrice * qty).toFixed(2))
        };
    });
    return { details, totalCost: Number(details.reduce((sum, part) => sum + part.subtotal, 0).toFixed(2)) };
}

function calculateOverheadEstimate(body) {
    const assemblyWage = parseNonNegativeNumber(body.assemblyWage, 'assemblyWage');
    const packingWage = parseNonNegativeNumber(body.packingWage, 'packingWage');
    const surfaceTreatmentCost = parseNonNegativeNumber(body.surfaceTreatmentCost ?? body.paintingWage, 'surfaceTreatmentCost');
    const managementFee = parseNonNegativeNumber(body.managementFee, 'managementFee');
    const details = [
        { name: '安装工资', amount: assemblyWage },
        { name: '打包工资', amount: packingWage },
        { name: '表面处理', amount: surfaceTreatmentCost },
        { name: '管理费', amount: managementFee },
    ];
    return { details, totalCost: Number(details.reduce((sum, item) => sum + item.amount, 0).toFixed(2)) };
}

router.post('/cost/coil', calculateCoilCostHandler);

router.post('/cost/float', (req, res) => {
    try {
        const { partsByModel } = loadPartsData();
        res.json({ success: true, data: calculateFloatEstimate(req.body || {}, partsByModel) });
    } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/cost/cable', (req, res) => {
    try {
        const { partsByModel } = loadPartsData();
        res.json({ success: true, data: calculateCableEstimate(req.body || {}, partsByModel) });
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

// ── POST /cost/dynamic-config ──
router.post(['/cost/dynamic', '/cost/dynamic-config'], (req, res) => {
    try {
        const { stator, statorSpec: rawSpec, statorSheets: rawSheets, hasFloat, floatWire, hasCable, cableWire, cableLength, cableAccessoryType = 'standard', boxType } = req.body;
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
        const { totalCost, details } = calculateDynamicCost({ hasFloat, floatWire, cableLength: effectiveCableLength, cableWire, cableAccessoryType, boxType, resolvedWire, getPrice, partsCache, partsByModel });
        res.json({ success: true, data: { totalCost: totalCost.toFixed(2), itemCount: details.length, resolvedWire, details } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ── POST /cost/dynamic-calculate ──
router.post(['/recipes/:id/cost-preview', '/cost/dynamic-calculate'], (req, res) => {
    const baseRecipeId = req.params.id || req.body.baseRecipeId;
    const { overrides } = req.body;
    try {
        const row = db.prepare('SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL').get(baseRecipeId);
        if (!row) return res.status(404).json({ success: false, error: 'Recipe not found' });
        
        // Merge DB data with overrides
        const recipeData = {
            id: row.id,
            name: row.name,
            parts_json: row.parts_json,
            template_id: row.template_id,
            coil_spec: getOverride(overrides, 'coilSpec', 'coil_spec', row.coil_spec),
            coil_sheets: Number(getOverride(overrides, 'coilSheets', 'coil_sheets', row.coil_sheets)),
            coil_material: getOverride(overrides, 'coilMaterial', 'coil_material', row.coil_material || DEFAULT_COIL_MATERIAL),
            has_float: getOverride(overrides, 'hasFloat', 'has_float', row.has_float),
            float_wire: getOverride(overrides, 'floatWire', 'float_wire', row.float_wire),
            has_cable: getOverride(overrides, 'hasCable', 'has_cable', row.has_cable),
            cable_length: Number(getOverride(overrides, 'cableLength', 'cable_length', row.cable_length)),
            cable_wire: getOverride(overrides, 'cableWire', 'cable_wire', row.cable_wire),
            cable_accessory_type: getOverride(overrides, 'cableAccessoryType', 'cable_accessory_type', row.cable_accessory_type || 'standard'),
            box_type: getOverride(overrides, 'boxType', 'box_type', row.box_type),
            packing_parts_json: getOverride(overrides, 'packingPartsJson', 'packing_parts_json', row.packing_parts_json),
            custom_barrel_length: (() => {
                const value = getOverride(overrides, 'customBarrelLength', 'custom_barrel_length', row.custom_barrel_length);
                return value != null ? Number(value) : value;
            })(),
            extra_parts_json: getOverride(overrides, 'extraPartsJson', 'extra_parts_json', row.extra_parts_json),
            assembly_wage: row.assembly_wage,
            packing_wage: row.packing_wage,
            painting_wage: row.painting_wage,
            surface_treatment_mode: row.surface_treatment_mode || (row.painting_wage != null ? 'painting' : 'none'),
            surface_treatment_cost: row.surface_treatment_cost != null ? row.surface_treatment_cost : (row.painting_wage != null ? row.painting_wage : 0),
            management_fee: row.management_fee
        };

        const { partsCache, partsByModel } = loadPartsData();
        const parsedParts = JSON.parse(recipeData.parts_json || '[]');
        const getPrice = (model) => { const s = partsByModel[model] || []; if (s.length === 0) return 0; return s.reduce((min, c) => c.price < min.price ? c : min, s[0]).price; };

        const managedTotals = { coil: 0, float: 0, cable: 0, box: 0, barrelLength: 0 };
        const lengthPricedParts = [];
        for (const part of parsedParts) {
            const type = managedPartType(part);
            if (type === 'barrelLength') lengthPricedParts.push(part);
            if (type) managedTotals[type] += partSnapshotSubtotal(part, partsCache, partsByModel);
        }

        const savedBaseCost = Number(row.saved_total_cost || 0);
        const hasSavedBase = savedBaseCost > 0;
        const partsResult = calculateRecipeCost(parsedParts, partsCache, partsByModel);
        let totalCost = hasSavedBase ? savedBaseCost : Number(partsResult.totalCost || 0);
        totalCost -= managedTotals.coil + managedTotals.float + managedTotals.cable + managedTotals.box + managedTotals.barrelLength;

        const dbWire = resolveWireFromStator(recipeData.coil_spec, recipeData.coil_sheets, recipeData.coil_material);
        const resolvedWire = resolveWire(dbWire, recipeData.cable_wire || recipeData.float_wire);

        const coilChanged = !sameText(recipeData.coil_spec, row.coil_spec) || !sameNumber(recipeData.coil_sheets, row.coil_sheets) || !sameText(recipeData.coil_material, row.coil_material || DEFAULT_COIL_MATERIAL);
        const floatChanged = toBool(recipeData.has_float) !== toBool(row.has_float) || !sameText(recipeData.float_wire, row.float_wire);
        const cableChanged = toBool(recipeData.has_cable) !== toBool(row.has_cable) || !sameNumber(recipeData.cable_length, row.cable_length) || !sameText(recipeData.cable_wire, row.cable_wire) || !sameText(recipeData.cable_accessory_type, row.cable_accessory_type || 'standard');
        const packingJsonChanged = normalizePackingJsonText(recipeData.packing_parts_json, recipeData.box_type) !== normalizePackingJsonText(row.packing_parts_json, row.box_type);
        const boxChanged = !sameText(recipeData.box_type, row.box_type) || packingJsonChanged;

        totalCost += coilChanged ? calculateCoilCostValue(recipeData.coil_spec, recipeData.coil_sheets, recipeData.coil_material) : managedTotals.coil;

        if (!floatChanged) {
            totalCost += managedTotals.float;
        } else if (toBool(recipeData.has_float)) {
            totalCost += getPrice(configuredModel('浮球', recipeData.float_wire, resolvedWire));
        }

        if (!cableChanged) {
            totalCost += managedTotals.cable;
        } else if (toBool(recipeData.has_cable) && Number(recipeData.cable_length) > 0) {
            const cableModel = configuredModel('电缆', recipeData.cable_wire, resolvedWire);
            totalCost += getPrice(cableModel) * Number(recipeData.cable_length);
            totalCost += getCableAccessoryFee(partsByModel, cableModel, '', getPrice, recipeData.cable_accessory_type);
        }

        totalCost += boxChanged
            ? (calculatePackingPartsCost(recipeData.packing_parts_json, getPrice) || findBoxPrice(recipeData.box_type, getPrice, partsCache))
            : managedTotals.box;

        totalCost += lengthPricedParts.reduce((sum, part) => sum + lengthPricedPartSubtotal(part, recipeData.custom_barrel_length), 0);

        const getSetting = require('../db.cjs').getSetting;
        if (!hasSavedBase) {
            totalCost += (recipeData.assembly_wage || 0);
            totalCost += (recipeData.packing_wage || 0);
            totalCost += (recipeData.surface_treatment_cost || recipeData.painting_wage || 0);
            totalCost += (recipeData.management_fee || Number(getSetting('management_fee')) || 0);
        }

        costLogger.info(`DynamicCalc recipe=${recipeData.name}, has_float=${recipeData.has_float}, totalCost=${totalCost}`);
        const unitCost = Number(totalCost.toFixed(2));
        const response = { success: true, data: { unitCost } };
        if (req.path === '/cost/dynamic-calculate') response.unitCost = unitCost; // legacy
        res.json(response);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /cost/full-calculate ──
router.post(['/cost/full-estimate', '/cost/full-calculate'], (req, res) => {
    try {
        const { pumphousing_model, stator, cableLength = 0, cableAccessoryType = 'standard', boxType = '', hasFloat = false, floatWire, cableWire } = req.body;
        const statorMaterial = req.body.statorMaterial || req.body.material || DEFAULT_COIL_MATERIAL;
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
                    let parts = []; try { parts = JSON.parse(recipe.partsJson || '[]'); } catch { /* */ }
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
                const sr = coilRow(db.prepare(`SELECT * FROM coils WHERE spec = ? AND sheets = ? ORDER BY CASE WHEN material = ? THEN 0 WHEN material = ? THEN 1 ELSE 2 END LIMIT 1`).get(statorSpec, parseInt(statorSheets), statorMaterial, DEFAULT_COIL_MATERIAL));
                if (sr) {
                    const cost = parseFloat(sr.cost || 0);
                    result.statorCost = { spec: statorSpec, material: sr.material || statorMaterial, sheets: statorSheets, unitPrice: sr.unitPrice, cost: cost.toFixed(2), wireGauge: sr.defaultWireGauge || null, source: '精确匹配' };
                    grandTotal += cost;
                } else {
                    const bases = db.prepare(`SELECT * FROM coils WHERE spec = ? ORDER BY CASE WHEN material = ? THEN 0 WHEN material = ? THEN 1 ELSE 2 END, sheets LIMIT 10`).all(statorSpec, statorMaterial, DEFAULT_COIL_MATERIAL).map(coilRow);
                    if (bases.length > 0) {
                        const b = bases[0]; const up = parseFloat(b.unitPrice || 0); const ww = parseFloat(b.wireWeight || 0);
                        const cb = parseFloat(b.copperBase || 0); const cf = parseFloat(b.coilFee || 0); const rf = parseFloat(b.rotorFee || 0);
                        const sh = parseInt(statorSheets); const cc = up * sh + ww * cb + cf + rf;
                        result.statorCost = { spec: statorSpec, material: b.material || statorMaterial, sheets: statorSheets, unitPrice: up, cost: cc.toFixed(2), wireGauge: b.defaultWireGauge || null, source: '公式推算', formula: `${up}×${sh} + ${ww}×${cb} + ${cf} + ${rf}` };
                        grandTotal += cc;
                    } else { result.statorCost = { error: `未找到规格 ${statorSpec} 的线圈数据` }; }
                }
            } catch (e) { result.statorCost = { error: '查询线圈成本失败: ' + e.message }; }
        }

        // 步骤3: 动态配置成本（复用共享函数）
        const dbWire = statorSpec && statorSheets ? resolveWireFromStator(statorSpec, statorSheets, statorMaterial) : null;
        const resolvedWire = resolveWire(dbWire, cableWire || floatWire);
        const dynamic = calculateDynamicCost({ hasFloat, floatWire, cableLength, cableWire, cableAccessoryType, boxType, resolvedWire, getPrice, partsCache, partsByModel });
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

// 导出 runCopperPriceUpdate 供启动时调用
module.exports = router;
module.exports.runCopperPriceUpdate = runCopperPriceUpdate;
