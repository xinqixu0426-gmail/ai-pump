const { Router } = require('express');
const { db, dbGetAllCoils, coilRow, safeInsert, safeUpdate, hardDelete, getSetting, setSetting } = require('../db.cjs');
const {
    DEFAULT_COIL_MATERIAL,
    MATERIAL_UNIT_PRICE_DEFAULTS,
    getMaterialPriceMap,
    getMaterialUnitPrice,
    calculateCoilCost,
    buildCoilSpecDraft,
} = require('../services/coilCost.cjs');
const { parsePositiveId, parseNonNegativeNumber } = require('../services/validation.cjs');
const router = Router();

function coilCostFromValues(values) {
    const unitPrice = parseNonNegativeNumber(values.unitPrice, 'unitPrice');
    const sheets = parseNonNegativeNumber(values.sheets, 'sheets', { required: true });
    const wireWeight = parseNonNegativeNumber(values.wireWeight, 'wireWeight');
    const copperBase = parseNonNegativeNumber(values.copperBase, 'copperBase');
    const coilFee = parseNonNegativeNumber(values.coilFee, 'coilFee');
    const rotorFee = parseNonNegativeNumber(values.rotorFee, 'rotorFee');
    return {
        unitPrice,
        sheets,
        wireWeight,
        copperBase,
        coilFee,
        rotorFee,
        cost: (unitPrice * sheets + wireWeight * copperBase + coilFee + rotorFee).toFixed(5),
    };
}

// ── CRUD ──

router.get('/', (req, res) => {
    try { res.json({ success: true, data: dbGetAllCoils() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/materials', (req, res) => {
    try {
        const materialPrices = getMaterialPriceMap(getSetting);
        const usedMaterials = dbGetAllCoils().map(c => c.material || DEFAULT_COIL_MATERIAL);
        const materials = Array.from(new Set([...Object.keys(materialPrices), ...usedMaterials])).filter(Boolean);
        res.json({ success: true, data: { defaultMaterial: DEFAULT_COIL_MATERIAL, materials, materialPrices } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.put('/materials', (req, res) => {
    try {
        const input = req.body?.materialPrices || {};
        const materialPrices = {};
        for (const [material, price] of Object.entries(input)) {
            const key = String(material || '').trim();
            if (key) materialPrices[key] = parseNonNegativeNumber(price, `materialPrices.${key}`);
        }
        if (!materialPrices[DEFAULT_COIL_MATERIAL]) materialPrices[DEFAULT_COIL_MATERIAL] = MATERIAL_UNIT_PRICE_DEFAULTS[DEFAULT_COIL_MATERIAL];
        setSetting('coil_material_prices', JSON.stringify(materialPrices));
        res.json({ success: true, data: { materialPrices } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/spec-draft', (req, res) => {
    try {
        const spec = String(req.body?.spec || '').trim();
        if (!spec) return res.status(400).json({ success: false, error: 'spec 为必填' });
        const material = String(req.body?.material || DEFAULT_COIL_MATERIAL).trim() || DEFAULT_COIL_MATERIAL;
        const draft = buildCoilSpecDraft(dbGetAllCoils(), { spec, material }, { materialPrices: getMaterialPriceMap(getSetting) });
        res.json({ success: true, data: draft });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', (req, res) => {
    try {
        const b = req.body;
        const spec = b.spec;
        const material = String(b.material || DEFAULT_COIL_MATERIAL).trim() || DEFAULT_COIL_MATERIAL;
        const sheetsRaw = b.sheets;
        if (!spec || !sheetsRaw) return res.status(400).json({ success: false, error: '规格和片数为必填项' });
        const materialPrices = getMaterialPriceMap(getSetting);
        const unitPriceInput = b.unitPrice !== undefined && b.unitPrice !== '' ? b.unitPrice : getMaterialUnitPrice(spec, material, materialPrices);
        const normalized = coilCostFromValues({ ...b, unitPrice: unitPriceInput, sheets: sheetsRaw });
        const defaultGauge = b.defaultWireGauge || null;
        const defaultCap = b.defaultCapacitor || null;
        
        const now = new Date().toISOString();
        const info = safeInsert('coils', {
            spec,
            material,
            sheets: normalized.sheets,
            unit_price: normalized.unitPrice,
            wire_weight: normalized.wireWeight,
            copper_base: normalized.copperBase,
            coil_fee: normalized.coilFee,
            rotor_fee: normalized.rotorFee,
            cost: normalized.cost,
            default_wire_gauge: defaultGauge,
            default_capacitor: defaultCap,
            created_at: now,
            updated_at: now,
        });
        res.json({ success: true, data: coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法线圈ID' });
        const b = req.body;
        // camelCase body → snake_case column 映射
        const COIL_MAP = {
            spec: 'spec', material: 'material',
            unitPrice: 'unit_price', sheets: 'sheets', wireWeight: 'wire_weight',
            copperBase: 'copper_base', coilFee: 'coil_fee', rotorFee: 'rotor_fee',
            defaultWireGauge: 'default_wire_gauge', defaultCapacitor: 'default_capacitor',
        };
        const updates = {};
        for (const [bodyKey, col] of Object.entries(COIL_MAP)) {
            if (b[bodyKey] !== undefined) updates[col] = b[bodyKey];
        }
        const current = coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(id));
        const materialPrices = getMaterialPriceMap(getSetting);
        if (updates.material !== undefined && updates.unit_price === undefined) {
            updates.unit_price = getMaterialUnitPrice(updates.spec ?? current?.spec, updates.material, materialPrices);
        }
        // 自动重算 cost
        if (updates.unit_price !== undefined || updates.sheets !== undefined || updates.wire_weight !== undefined || updates.copper_base !== undefined || updates.coil_fee !== undefined || updates.rotor_fee !== undefined) {
            if (current) {
                const normalized = coilCostFromValues({
                    unitPrice: updates.unit_price ?? current.unitPrice ?? 0,
                    sheets: updates.sheets ?? current.sheets ?? 0,
                    wireWeight: updates.wire_weight ?? current.wireWeight ?? 0,
                    copperBase: updates.copper_base ?? current.copperBase ?? 0,
                    coilFee: updates.coil_fee ?? current.coilFee ?? 0,
                    rotorFee: updates.rotor_fee ?? current.rotorFee ?? 0,
                });
                if (updates.unit_price !== undefined) updates.unit_price = normalized.unitPrice;
                if (updates.sheets !== undefined) updates.sheets = normalized.sheets;
                if (updates.wire_weight !== undefined) updates.wire_weight = normalized.wireWeight;
                if (updates.copper_base !== undefined) updates.copper_base = normalized.copperBase;
                if (updates.coil_fee !== undefined) updates.coil_fee = normalized.coilFee;
                if (updates.rotor_fee !== undefined) updates.rotor_fee = normalized.rotorFee;
                updates.cost = normalized.cost;
            }
        }
        safeUpdate('coils', id, updates);
        res.json({ success: true, data: coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(id)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法线圈ID' });
        hardDelete('coils', id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ── 按规格批量更新单价 ──

router.patch('/spec/:spec', (req, res) => {
    try {
        const spec = decodeURIComponent(req.params.spec);
        const { unitPrice } = req.body;
        const material = req.body.material ? String(req.body.material).trim() : '';
        if (unitPrice === undefined) return res.status(400).json({ success: false, error: 'unitPrice 为必填' });
        const up = parseNonNegativeNumber(unitPrice, 'unitPrice');

        const rows = material
            ? db.prepare('SELECT * FROM coils WHERE spec = ? AND material = ?').all(spec, material)
            : db.prepare('SELECT * FROM coils WHERE spec = ?').all(spec);
        if (rows.length === 0) return res.status(404).json({ success: false, error: material ? `未找到规格 "${spec}"、材质 "${material}"` : `未找到规格 "${spec}"` });

        const updateAll = db.transaction(() => {
            for (const r of rows) {
                const cost = (up * r.sheets + r.wire_weight * r.copper_base + r.coil_fee + r.rotor_fee).toFixed(5);
                safeUpdate('coils', r.id, { unit_price: up, cost });
            }
        });
        updateAll();
        res.json({ success: true, updated: rows.length });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ── 成本计算（支持插值）──

function calculateCoilCostHandler(req, res) {
    try {
        const result = calculateCoilCost(dbGetAllCoils(), req.body, { materialPrices: getMaterialPriceMap(getSetting) });
        if (!result.success) return res.status(result.status || 400).json({ success: false, error: result.error });
        res.json({ success: true, data: result.data });
    } catch (error) { console.error('Coil Calculate Error:', error); res.status(500).json({ success: false, error: error.message }); }
}

router.post('/calculate', calculateCoilCostHandler);

// ── 规格列表 ──

router.get('/specs', (req, res) => {
    try {
        const allCoils = dbGetAllCoils();
        const configuredMaterials = Object.keys(getMaterialPriceMap(getSetting)).filter(Boolean);
        const specsMap = {};
        allCoils.forEach(c => {
            const spec = c.spec;
            const material = c.material || DEFAULT_COIL_MATERIAL;
            if (!specsMap[spec]) specsMap[spec] = { spec, material, materials: [...configuredMaterials], unitPrice: c.unitPrice, sheets: [], count: 0 };
            if (!specsMap[spec].materials.includes(material)) specsMap[spec].materials.push(material);
            if (material === DEFAULT_COIL_MATERIAL) {
                specsMap[spec].material = material;
                specsMap[spec].unitPrice = c.unitPrice;
            }
            const sheets = typeof c.sheets === 'number' ? c.sheets : parseInt(c.sheets);
            if (!specsMap[spec].sheets.includes(sheets)) {
                specsMap[spec].sheets.push(sheets);
            }
            specsMap[spec].count++;
        });
        Object.values(specsMap).forEach(s => s.sheets.sort((a, b) => a - b));
        res.json({ success: true, data: Object.values(specsMap) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
module.exports.calculateCoilCostHandler = calculateCoilCostHandler;
