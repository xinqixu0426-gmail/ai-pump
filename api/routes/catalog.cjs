const { Router } = require('express');
const { getNamingRules, previewCatalogName } = require('../services/catalogNaming.cjs');
const { resolveCatalogReferences } = require('../services/catalogReferences.cjs');
const { db, safeInsert } = require('../db.cjs');
const { CAPABILITY_ID, previewCatalogBindings, executeCatalogBindings, readBoundCatalogNames } = require('../services/catalogBindings.cjs');
const { commandActorKey, commandContextFromRequest, sendCommandError } = require('../services/commandRequest.cjs');
const router = Router();

router.post('/reference-bindings-preview', (req, res) => {
    try {
        res.json({ success: true, data: previewCatalogBindings(db, req.body, commandActorKey(req)) });
    } catch (error) { sendCommandError(res, error); }
});

router.post('/reference-bindings', (req, res) => {
    try {
        const data = executeCatalogBindings({ db, safeInsert }, req.body,
            commandContextFromRequest(req, CAPABILITY_ID), commandActorKey(req));
        res.json({ success: true, data });
    } catch (error) { sendCommandError(res, error); }
});

router.post('/bound-names', (req, res) => {
    try {
        res.json({ success: true, data: readBoundCatalogNames(db, req.body) });
    } catch (error) { sendCommandError(res, error); }
});

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
