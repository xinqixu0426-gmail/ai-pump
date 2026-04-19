const { Router } = require('express');
const { db, dbGetAllCoils, coilRow } = require('../db.cjs');
const router = Router();

// ── CRUD ──

router.get('/', async (req, res) => {
    try { res.json({ success: true, data: dbGetAllCoils() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', async (req, res) => {
    try {
        const b = req.body;
        const spec = b.spec || b.规格;
        const sheetsRaw = b.sheets || b.片数;
        if (!spec || !sheetsRaw) return res.status(400).json({ success: false, error: '规格和片数为必填项' });
        const unitPrice = parseFloat(b.unitPrice || b.单价 || 0), sheets = parseInt(sheetsRaw);
        const wireWeight = parseFloat(b.wireWeight || b.默认线重 || 0), copperBase = parseFloat(b.copperBase || b.铜价基数 || 0);
        const coilFee = parseFloat(b.coilFee || b.线圈加工费 || 0), rotorFee = parseFloat(b.rotorFee || b.转子加工费 || 0);
        const cost = unitPrice * sheets + wireWeight * copperBase + coilFee + rotorFee;
        const defaultGauge = b.defaultWireGauge || b.默认线径 || null;
        const defaultCap = b.defaultCapacitor || b.默认电容_uf || null;
        
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO coils (spec, sheets, unit_price, wire_weight, copper_base, coil_fee, rotor_fee, cost, default_wire_gauge, default_capacitor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            spec, sheets, unitPrice, wireWeight, copperBase, coilFee, rotorFee, cost.toFixed(5), defaultGauge, defaultCap, now, now
        );
        res.json({ success: true, data: coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const updates = { ...req.body, Id: id };
        if (updates.unitPrice !== undefined || updates.sheets !== undefined || updates.wireWeight !== undefined || updates.copperBase !== undefined || updates.coilFee !== undefined || updates.rotorFee !== undefined) {
            const current = coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(id));
            if (current) {
                const m = { ...current, ...updates };
                updates.cost = (parseFloat(m.unitPrice || 0) * parseInt(m.sheets || 0) + parseFloat(m.wireWeight || 0) * parseFloat(m.copperBase || 0) + parseFloat(m.coilFee || 0) + parseFloat(m.rotorFee || 0)).toFixed(5);
            }
        }
        const now = new Date().toISOString();
        const sets = [], vals = [];
        if (updates.unitPrice !== undefined) { sets.push('unit_price = ?'); vals.push(updates.unitPrice); }
        if (updates.sheets !== undefined) { sets.push('sheets = ?'); vals.push(updates.sheets); }
        if (updates.wireWeight !== undefined) { sets.push('wire_weight = ?'); vals.push(updates.wireWeight); }
        if (updates.copperBase !== undefined) { sets.push('copper_base = ?'); vals.push(updates.copperBase); }
        if (updates.coilFee !== undefined) { sets.push('coil_fee = ?'); vals.push(updates.coilFee); }
        if (updates.rotorFee !== undefined) { sets.push('rotor_fee = ?'); vals.push(updates.rotorFee); }
        if (updates.cost !== undefined) { sets.push('cost = ?'); vals.push(updates.cost); }
        if (updates.默认线径 !== undefined) { sets.push('default_wire_gauge = ?'); vals.push(updates.默认线径); }
        if (updates.默认电容_uf !== undefined) { sets.push('default_capacitor = ?'); vals.push(updates.默认电容_uf); }
        sets.push('updated_at = ?'); vals.push(now); vals.push(id);
        db.prepare(`UPDATE coils SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        res.json({ success: true, data: coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(id)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        db.prepare('DELETE FROM coils WHERE id = ?').run(parseInt(req.params.id));
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ── 成本计算（支持插值）──

router.post('/calculate', async (req, res) => {
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
                capacitor = null;
                source = `插值(${lS}片↔${uS}片, ratio=${ratio.toFixed(3)})`;
            } else if (lower) {
                unitPrice = parseFloat(lower.unitPrice || 0);
                wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(lower.wireWeight || 0);
                copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(lower.copperBase || 0);
                coilFee = parseFloat(lower.coilFee || 0); rotorFee = parseFloat(lower.rotorFee || 0);
                wireGauge = lower.defaultWireGauge || null; capacitor = null;
                source = `外推(基于${parseInt(lower.sheets)}片)`;
            } else if (upper) {
                unitPrice = parseFloat(upper.unitPrice || 0);
                wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(upper.wireWeight || 0);
                copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(upper.copperBase || 0);
                coilFee = parseFloat(upper.coilFee || 0); rotorFee = parseFloat(upper.rotorFee || 0);
                wireGauge = upper.defaultWireGauge || null; capacitor = null;
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

router.get('/specs', async (req, res) => {
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
