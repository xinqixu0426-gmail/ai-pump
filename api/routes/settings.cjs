const { Router } = require('express');
const { getSetting, setSetting } = require('../db.cjs');
const router = Router();

// GET /api/settings/:key
router.get('/:key', (req, res) => {
    const value = getSetting(req.params.key);
    if (value === null) return res.status(404).json({ success: false, error: `设置项 "${req.params.key}" 不存在` });
    res.json({ success: true, data: { key: req.params.key, value } });
});

// PUT /api/settings/:key
router.put('/:key', (req, res) => {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ success: false, error: 'value 为必填项' });
    setSetting(req.params.key, value);
    res.json({ success: true, data: { key: req.params.key, value: String(value) } });
});

// GET /api/settings — 获取所有设置
router.get('/', (req, res) => {
    const { db } = require('../db.cjs');
    const rows = db.prepare('SELECT key, value, updated_at FROM system_settings').all();
    const data = {};
    rows.forEach(r => { data[r.key] = r.value; });
    res.json({ success: true, data });
});

module.exports = router;
