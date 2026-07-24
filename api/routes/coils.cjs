const { Router } = require('express');
const { db, dbGetAllCoils, dbGetAllStatorVariants, coilRow, safeInsert, safeUpdate, hardDelete } = require('../db.cjs');
const {
    DEFAULT_COIL_MATERIAL,
    DEFAULT_COIL_SLOT_TYPE,
    COIL_MATERIALS,
    COIL_SLOT_TYPES,
    COIL_SCHEME_STATUSES,
    normalizeCoilDimensions,
    calculateCoilCost,
    buildCoilSpecDraft,
    buildCoilSpecOptions,
} = require('../services/coilCost.cjs');
const { parsePositiveId, parseNonNegativeNumber } = require('../services/validation.cjs');
const router = Router();

function coilCostFromValues(values) {
    const unitPrice = parseNonNegativeNumber(values.unitPrice, 'unitPrice');
    const sheets = parsePositiveId(values.sheets);
    if (!sheets) throw new Error('sheets 必须是正整数');
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

function normalizeSchemeInput(body = {}) {
    const dimensions = normalizeCoilDimensions(body);
    if (!dimensions.commonName) throw new Error('规格俗称为必填项');
    if (!dimensions.diameterMm) throw new Error('定子直径必须是正整数');
    if (!COIL_MATERIALS.has(dimensions.material)) throw new Error('材质仅支持钢带或冷轧');
    if (!COIL_SLOT_TYPES.has(dimensions.slotType)) throw new Error('槽眼仅支持小眼或国标眼');
    const schemeStatus = String(body.schemeStatus || 'official').trim() || 'official';
    if (!COIL_SCHEME_STATUSES.has(schemeStatus)) throw new Error('方案状态无效');
    return {
        ...dimensions,
        schemeName: String(body.schemeName || (schemeStatus === 'testing' ? '测试方案' : '正式方案')).trim(),
        schemeStatus,
    };
}

function ensureStatorVariant(dimensions) {
    let variant = db.prepare(`
        SELECT * FROM stator_variants
        WHERE diameter_mm = ? AND material = ? AND slot_type = ?
    `).get(dimensions.diameterMm, dimensions.material, dimensions.slotType);
    if (variant) {
        if (!variant.common_name && dimensions.commonName) {
            safeUpdate('stator_variants', variant.id, { common_name: dimensions.commonName });
            variant = db.prepare('SELECT * FROM stator_variants WHERE id = ?').get(variant.id);
        }
        return variant;
    }
    const now = new Date().toISOString();
    const info = safeInsert('stator_variants', {
        diameter_mm: dimensions.diameterMm,
        common_name: dimensions.commonName,
        material: dimensions.material,
        slot_type: dimensions.slotType,
        created_at: now,
        updated_at: now,
    });
    return db.prepare('SELECT * FROM stator_variants WHERE id = ?').get(info.lastInsertRowid);
}

function demoteExistingOfficial(variantId, sheets, excludeId = null) {
    const rows = db.prepare(`
        SELECT id FROM coils
        WHERE stator_variant_id = ? AND sheets = ? AND scheme_status = 'official'
    `).all(variantId, sheets);
    for (const row of rows) {
        if (row.id !== excludeId) safeUpdate('coils', row.id, { scheme_status: 'testing' });
    }
}

// ── CRUD ──

router.get('/', (req, res) => {
    try { res.json({ success: true, data: dbGetAllCoils() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/variants', (req, res) => {
    try { res.json({ success: true, data: dbGetAllStatorVariants() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/spec-draft', (req, res) => {
    try {
        const spec = String(req.body?.spec || '').trim();
        if (!spec) return res.status(400).json({ success: false, error: 'spec 为必填' });
        const material = String(req.body?.material || DEFAULT_COIL_MATERIAL).trim() || DEFAULT_COIL_MATERIAL;
        const slotType = String(req.body?.slotType || DEFAULT_COIL_SLOT_TYPE).trim() || DEFAULT_COIL_SLOT_TYPE;
        const draft = buildCoilSpecDraft(dbGetAllCoils(), { ...req.body, spec, material, slotType });
        res.json({ success: true, data: draft });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', (req, res) => {
    try {
        const b = req.body;
        const scheme = normalizeSchemeInput(b);
        const sheetsRaw = b.sheets;
        if (!sheetsRaw || b.unitPrice === undefined || b.unitPrice === '') {
            return res.status(400).json({ success: false, error: '规格、定子直径、片数和单片价为必填项' });
        }
        const unitPriceInput = b.unitPrice;
        const normalized = coilCostFromValues({ ...b, unitPrice: unitPriceInput, sheets: sheetsRaw });
        const defaultGauge = b.defaultWireGauge || null;
        const defaultCap = b.defaultCapacitor || null;
        const mainWireGauge = String(b.mainWireGauge || '').trim();
        const mainWireData = String(b.mainWireData || '').trim();
        const auxWireGauge = String(b.auxWireGauge || '').trim();
        const auxWireData = String(b.auxWireData || '').trim();
        
        const saveScheme = db.transaction(() => {
            const variant = ensureStatorVariant(scheme);
            if (scheme.schemeStatus === 'official') demoteExistingOfficial(variant.id, normalized.sheets);
            const now = new Date().toISOString();
            return safeInsert('coils', {
                stator_variant_id: variant.id,
                spec: scheme.commonName,
                material: scheme.material,
                slot_type: scheme.slotType,
                sheets: normalized.sheets,
                scheme_name: scheme.schemeName,
                scheme_status: scheme.schemeStatus,
                unit_price: normalized.unitPrice,
                wire_weight: normalized.wireWeight,
                copper_base: normalized.copperBase,
                coil_fee: normalized.coilFee,
                rotor_fee: normalized.rotorFee,
                cost: normalized.cost,
                default_wire_gauge: defaultGauge,
                default_capacitor: defaultCap,
                main_wire_gauge: mainWireGauge,
                main_wire_data: mainWireData,
                aux_wire_gauge: auxWireGauge,
                aux_wire_data: auxWireData,
                created_at: now,
                updated_at: now,
            });
        });
        const info = saveScheme();
        res.json({ success: true, data: coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

// ── 按规格批量更新单价 ──
// Must be registered before /:id, otherwise "spec" is treated as an ID.
router.patch('/spec/:spec', (req, res) => {
    try {
        const spec = decodeURIComponent(req.params.spec);
        const { unitPrice } = req.body;
        const material = req.body.material ? String(req.body.material).trim() : '';
        const slotType = req.body.slotType ? String(req.body.slotType).trim() : '';
        if (unitPrice === undefined) return res.status(400).json({ success: false, error: 'unitPrice 为必填' });
        const up = parseNonNegativeNumber(unitPrice, 'unitPrice');

        const dimensions = normalizeCoilDimensions({ spec, material: material || DEFAULT_COIL_MATERIAL, slotType: slotType || DEFAULT_COIL_SLOT_TYPE });
        const rows = dbGetAllCoils().filter(coil => (
            coil.diameterMm === dimensions.diameterMm
            && (!material || coil.material === dimensions.material)
            && (!slotType || coil.slotType === dimensions.slotType)
        ));
        if (rows.length === 0) return res.status(404).json({ success: false, error: material ? `未找到规格 "${spec}"、材质 "${material}"` : `未找到规格 "${spec}"` });

        const updateAll = db.transaction(() => {
            for (const r of rows) {
                const cost = (up * r.sheets + r.wireWeight * r.copperBase + r.coilFee + r.rotorFee).toFixed(5);
                safeUpdate('coils', r.id, { unit_price: up, cost });
            }
        });
        updateAll();
        res.json({ success: true, updated: rows.length });
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
            slotType: 'slot_type', schemeName: 'scheme_name', schemeStatus: 'scheme_status',
            unitPrice: 'unit_price', sheets: 'sheets', wireWeight: 'wire_weight',
            copperBase: 'copper_base', coilFee: 'coil_fee', rotorFee: 'rotor_fee',
            defaultWireGauge: 'default_wire_gauge', defaultCapacitor: 'default_capacitor',
            mainWireGauge: 'main_wire_gauge', mainWireData: 'main_wire_data',
            auxWireGauge: 'aux_wire_gauge', auxWireData: 'aux_wire_data',
        };
        const optionalTextFields = new Set([
            'schemeName',
            'defaultWireGauge', 'defaultCapacitor',
            'mainWireGauge', 'mainWireData', 'auxWireGauge', 'auxWireData',
        ]);
        const updates = {};
        for (const [bodyKey, col] of Object.entries(COIL_MAP)) {
            if (b[bodyKey] !== undefined) {
                updates[col] = optionalTextFields.has(bodyKey) ? String(b[bodyKey] || '').trim() : b[bodyKey];
            }
        }
        const current = coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(id));
        if (!current) return res.status(404).json({ success: false, error: '线圈记录不存在' });
        let targetVariantId = current.statorVariantId;
        if (['spec', 'diameterMm', 'commonName', 'material', 'slotType'].some(key => b[key] !== undefined)) {
            const scheme = normalizeSchemeInput({
                ...current,
                ...b,
                spec: b.spec ?? b.commonName ?? current.commonName ?? current.spec,
                schemeStatus: b.schemeStatus ?? current.schemeStatus,
            });
            const variant = ensureStatorVariant(scheme);
            targetVariantId = variant.id;
            updates.stator_variant_id = variant.id;
            updates.spec = scheme.commonName;
            updates.material = scheme.material;
            updates.slot_type = scheme.slotType;
        }
        if (updates.scheme_status !== undefined && !COIL_SCHEME_STATUSES.has(String(updates.scheme_status))) {
            return res.status(400).json({ success: false, error: '方案状态无效' });
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
        const saveScheme = db.transaction(() => {
            const targetSheets = Number(updates.sheets ?? current.sheets);
            const targetStatus = String(updates.scheme_status ?? current.schemeStatus ?? 'official');
            if (targetStatus === 'official') demoteExistingOfficial(targetVariantId, targetSheets, id);
            safeUpdate('coils', id, updates);
        });
        saveScheme();
        res.json({ success: true, data: coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(id)) });
    } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法线圈ID' });
        hardDelete('coils', id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ── 成本计算（支持插值）──

function calculateCoilCostHandler(req, res) {
    try {
        const result = calculateCoilCost(dbGetAllCoils(), req.body);
        if (!result.success) return res.status(result.status || 400).json({ success: false, error: result.error });
        res.json({ success: true, data: result.data });
    } catch (error) { console.error('Coil Calculate Error:', error); res.status(500).json({ success: false, error: error.message }); }
}

router.post('/calculate', calculateCoilCostHandler);

// ── 规格列表 ──

router.get('/specs', (req, res) => {
    try {
        res.json({ success: true, data: buildCoilSpecOptions(dbGetAllCoils()) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
module.exports.calculateCoilCostHandler = calculateCoilCostHandler;
