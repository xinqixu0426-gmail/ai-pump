const { Router } = require('express');
const { getNamingRules, previewCatalogName } = require('../services/catalogNaming.cjs');
const { resolveCatalogReferences } = require('../services/catalogReferences.cjs');
const { db } = require('../db.cjs');
const router = Router();

router.get('/naming-rules', (req, res) => {
    res.json({ success: true, data: getNamingRules() });
});

router.post('/name-preview', (req, res) => {
    try {
        res.json({ success: true, data: previewCatalogName(req.body) });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message,
            code: error.code || 'NAMING_PREVIEW_FAILED', requestId: req.requestId,
            ...(error.details ? { details: error.details } : {}) });
    }
});

router.post('/references/resolve', (req, res) => {
    try {
        res.json({ success: true, data: resolveCatalogReferences(db, req.body) });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message,
            code: error.code || 'CATALOG_REFERENCES_FAILED', requestId: req.requestId,
            ...(error.details ? { details: error.details } : {}) });
    }
});

module.exports = router;
