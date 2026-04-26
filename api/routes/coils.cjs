const { Router } = require('express');
const { db, dbGetAllCoils, coilRow, safeUpdate } = require('../db.cjs');
const router = Router();

// ── CRUD ──

router.get('/', (req, res) => {
    try { res.json({ success: true, data: dbGetAllCoils() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', (req, res) => {
    try {
        const b = req.body;
        const spec = b.spec;
        const sheetsRaw = b.sheets;
        if (!spec || !sheetsRaw) return res.status(400).json({ success: false, error: '规格和片数为必填项' });
        const unitPrice = parseFloat(b.unitPrice || 0), sheets = parseInt(sheetsRaw);
        const wireWeight = parseFloat(b.wireWeight || 0), copperBase = parseFloat(b.copperBase || 0);
        const coilFee = parseFloat(b.coilFee || 0), rotorFee = parseFloat(b.rotorFee || 0);
        const cost = unitPrice * sheets + wireWeight * copperBase + coilFee + rotorFee;
        const defaultGauge = b.defaultWireGauge || null;
        const defaultCap = b.defaultCapacitor || null;
        
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO coils (spec, sheets, unit_price, wire_weight, copper_base, coil_fee, rotor_fee, cost, default_wire_gauge, default_capacitor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            spec, sheets, unitPrice, wireWeight, copperBase, coilFee, rotorFee, cost.toFixed(5), defaultGauge, defaultCap, now, now
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
            unitPrice: 'unit_price', sheets: 'sheets', wireWeight: 'wire_weight',
            copperBase: 'copper_base', coilFee: 'coil_fee', rotorFee: 'rotor_fee',
            defaultWireGauge: 'default_wire_gauge', defaultCapacitor: 'default_capacitor',
        };
        const updates = {};
        for (const [bodyKey, col] of Object.entries(COIL_MAP)) {
            if (b[bodyKey] !== undefined) updates[col] = b[bodyKey];
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
        db.prepare('DELETE FROM coils WHERE id = ?').run(parseInt(req.params.id));
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ── 成本计算（支持插值）──

router.post('/calculate', (req, res) => {
    try {
        const { spec, sheets, wireWeight: customerWireWeight, copperPrice: customCopperPrice } = req.body;
        if (!spec || !sheets) return res.status(400).json({ success: false, error: '规格和片数为必填项' });
        const targetSheets = parseInt(sheets);
        const specCoils = dbGetAllCoils()
            .filter(c => String(c.spec).trim() === String(spec).trim())
            .sort((a, b) => parseInt(a.sheets) - parseInt(b.sheets));
        if (specCoils.length === 0) return res.status(404).json({ success: false, error: `未找到规格 "${spec}" 的线圈数据` });

        const exactMatch = specCoils.find(c => parseInt(c.sheets) === targetSheets);
        let unitPrice, wireWeight, copperBase, coilFee, rotorFee, wireGauge, capacitor, source;

        if (exactMatch) {
            unitPrice = parseFloat(exactMatch.unitPrice || 0);
            wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(exactMatch.wireWeight || 0);
            copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(exactMatch.copperBase || 0);
            coilFee = parseFloat(exactMatch.coilFee || 0);
            rotorFee = parseFloat(exactMatch.rotorFee || 0);
            wireGauge = exactMatch.defaultWireGauge || null;
            capacitor = exactMatch.defaultCapacitor || null;
            source = '精确匹配';
        } else {
            let lower = null, upper = null;
            for (let i = 0; i < specCoils.length; i++) {
                const s = parseInt(specCoils[i].sheets);
                if (s < targetSheets) lower = specCoils[i];
                if (s > targetSheets && !upper) upper = specCoils[i];
            }
            if (lower && upper) {
                const lS = parseInt(lower.sheets), uS = parseInt(upper.sheets);
                const ratio = (targetSheets - lS) / (uS - lS);
                unitPrice = parseFloat(lower.unitPrice || 0);
                const iWW = parseFloat(lower.wireWeight || 0) + (parseFloat(upper.wireWeight || 0) - parseFloat(lower.wireWeight || 0)) * ratio;
                wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(iWW.toFixed(4));
                copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(lower.copperBase || 0);
                coilFee = parseFloat(lower.coilFee || 0) + (parseFloat(upper.coilFee || 0) - parseFloat(lower.coilFee || 0)) * ratio;
                rotorFee = parseFloat(lower.rotorFee || 0) + (parseFloat(upper.rotorFee || 0) - parseFloat(lower.rotorFee || 0)) * ratio;
                wireGauge = lower.defaultWireGauge || upper.defaultWireGauge || null;
                capacitor = lower.defaultCapacitor || upper.defaultCapacitor || null;
                source = `插值(${lS}片↔${uS}片, ratio=${ratio.toFixed(3)})`;
            } else if (lower) {
                unitPrice = parseFloat(lower.unitPrice || 0);
                wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(lower.wireWeight || 0);
                copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(lower.copperBase || 0);
                coilFee = parseFloat(lower.coilFee || 0); rotorFee = parseFloat(lower.rotorFee || 0);
                wireGauge = lower.defaultWireGauge || null; capacitor = lower.defaultCapacitor || null;
                source = `外推(基于${parseInt(lower.sheets)}片)`;
            } else if (upper) {
                unitPrice = parseFloat(upper.unitPrice || 0);
                wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(upper.wireWeight || 0);
                copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(upper.copperBase || 0);
                coilFee = parseFloat(upper.coilFee || 0); rotorFee = parseFloat(upper.rotorFee || 0);
                wireGauge = upper.defaultWireGauge || null; capacitor = upper.defaultCapacitor || null;
                source = `外推(基于${parseInt(upper.sheets)}片)`;
            }
        }

        const totalCost = unitPrice * targetSheets + wireWeight * copperBase + coilFee + rotorFee;
        res.json({
            success: true,
            data: {
                spec, sheets: targetSheets, unitPrice, wireWeight, copperBase,
                coilFee: parseFloat(coilFee.toFixed(2)), rotorFee: parseFloat(rotorFee.toFixed(2)),
                wireGauge, capacitor, totalCost: parseFloat(totalCost.toFixed(2)),
                formula: `${unitPrice}×${targetSheets} + ${wireWeight}×${copperBase} + ${coilFee.toFixed(2)} + ${rotorFee.toFixed(2)}`,
                source, isCustomWireWeight: customerWireWeight != null
            }
        });
    } catch (error) { console.error('Coil Calculate Error:', error); res.status(500).json({ success: false, error: error.message }); }
});

// ── 规格列表 ──

router.get('/specs', (req, res) => {
    try {
        const allCoils = dbGetAllCoils();
        const specsMap = {};
        allCoils.forEach(c => {
            const spec = c.spec;
            if (!specsMap[spec]) specsMap[spec] = { spec, unitPrice: c.unitPrice, sheets: [], count: 0 };
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
