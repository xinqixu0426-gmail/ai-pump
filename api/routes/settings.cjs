const { Router } = require('express');
const { getSetting, setSetting } = require('../db.cjs');
const router = Router();

const ALLOWED_SETTINGS = new Set(['management_fee', 'coil_material_prices', 'cable_accessories']);

router.get('/:key', (req, res) => {
    if (!ALLOWED_SETTINGS.has(req.params.key)) return res.status(400).json({ success: false, error: '非法设置项' });
    const value = getSetting(req.params.key);
    if (value === null) return res.status(404).json({ success: false, error: `设置项 "${req.params.key}" 不存在` });
    res.json({ success: true, data: { key: req.params.key, value } });
});

router.put('/:key', (req, res) => {
    const { value } = req.body;
    if (!ALLOWED_SETTINGS.has(req.params.key)) return res.status(400).json({ success: false, error: '非法设置项' });
    if (value === undefined) return res.status(400).json({ success: false, error: 'value 为必填项' });
    if (req.params.key === 'management_fee') {
        const fee = Number(value);
        if (!Number.isFinite(fee) || fee < 0) return res.status(400).json({ success: false, error: 'management_fee 必须是非负数字' });
    }
    if (req.params.key === 'cable_accessories') {
        let config;
        try { config = typeof value === 'string' ? JSON.parse(value) : value; }
        catch { return res.status(400).json({ success: false, error: 'cable_accessories 必须是有效 JSON' }); }
        for (const type of ['standard', 'xinjie']) {
            const name = config?.[type]?.name;
            const fee = Number(config?.[type]?.fee);
            if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ success: false, error: `${type}.name 不能为空` });
            if (!Number.isFinite(fee) || fee < 0) return res.status(400).json({ success: false, error: `${type}.fee 必须是非负数字` });
        }
        req.body.value = JSON.stringify(config);
    }
    setSetting(req.params.key, req.body.value);
    res.json({ success: true, data: { key: req.params.key, value: String(req.body.value) } });
});

router.get('/', (req, res) => {
    const { db } = require('../db.cjs');
    const rows = db.prepare('SELECT key, value, updated_at FROM system_settings').all();
    const data = {};
    rows.forEach(r => { data[r.key] = r.value; });
    res.json({ success: true, data });
});

module.exports = router;
