const { Router } = require('express');
const { db, dbGetAllCoils, coilRow, safeUpdate, hardDelete, getSetting, setSetting } = require('../db.cjs');
const {
    DEFAULT_COIL_MATERIAL,
    MATERIAL_UNIT_PRICE_DEFAULTS,
    getMaterialPriceMap,
    calculateCoilCost,
} = require('../services/coilCost.cjs');
const router = Router();

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
            const value = Number(price);
            if (key && Number.isFinite(value) && value >= 0) materialPrices[key] = value;
        }
        if (!materialPrices[DEFAULT_COIL_MATERIAL]) materialPrices[DEFAULT_COIL_MATERIAL] = MATERIAL_UNIT_PRICE_DEFAULTS[DEFAULT_COIL_MATERIAL];
        setSetting('coil_material_prices', JSON.stringify(materialPrices));
        res.json({ success: true, data: { materialPrices } });
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
        const unitPrice = parseFloat(b.unitPrice || materialPrices[material] || 0), sheets = parseInt(sheetsRaw);
        const wireWeight = parseFloat(b.wireWeight || 0), copperBase = parseFloat(b.copperBase || 0);
        const coilFee = parseFloat(b.coilFee || 0), rotorFee = parseFloat(b.rotorFee || 0);
        const cost = unitPrice * sheets + wireWeight * copperBase + coilFee + rotorFee;
        const defaultGauge = b.defaultWireGauge || null;
        const defaultCap = b.defaultCapacitor || null;
        
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO coils (spec, material, sheets, unit_price, wire_weight, copper_base, coil_fee, rotor_fee, cost, default_wire_gauge, default_capacitor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            spec, material, sheets, unitPrice, wireWeight, copperBase, coilFee, rotorFee, cost.toFixed(5), defaultGauge, defaultCap, now, now
        );
        res.json({ success: true, data: coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
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
        const materialPrices = getMaterialPriceMap(getSetting);
        if (updates.material !== undefined && updates.unit_price === undefined && materialPrices[updates.material] !== undefined) {
            updates.unit_price = materialPrices[updates.material];
        }
        // 自动重算 cost
        if (updates.unit_price !== undefined || updates.sheets !== undefined || updates.wire_weight !== undefined || updates.copper_base !== undefined || updates.coil_fee !== undefined || updates.rotor_fee !== undefined) {
            const current = coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(id));
            if (current) {
                const up = parseFloat(updates.unit_price ?? current.unitPrice ?? 0);
                const sh = parseInt(updates.sheets ?? current.sheets ?? 0);
                const ww = parseFloat(updates.wire_weight ?? current.wireWeight ?? 0);
                const cb = parseFloat(updates.copper_base ?? current.copperBase ?? 0);
                const cf = parseFloat(updates.coil_fee ?? current.coilFee ?? 0);
                const rf = parseFloat(updates.rotor_fee ?? current.rotorFee ?? 0);
                updates.cost = (up * sh + ww * cb + cf + rf).toFixed(5);
            }
        }
        safeUpdate('coils', id, updates);
        res.json({ success: true, data: coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(id)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/:id', (req, res) => {
    try {
        hardDelete('coils', parseInt(req.params.id));
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
        const up = parseFloat(unitPrice);
        if (!Number.isFinite(up) || up < 0) return res.status(400).json({ success: false, error: 'unitPrice 必须是非负数字' });

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
