'use strict';
const { Router } = require('express');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { createEntitySpanCandidateService } = require('../services/entitySpanCandidates.cjs');
requireBusinessCapability('entities.coil_span_candidates');
function createEntitySpanCandidateRouter({ db }) {
    const router = Router(), service = createEntitySpanCandidateService({ db });
    router.post('/', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try { res.json({ success: true, data: service.supply(req.body) }); }
        catch (error) {
            const invalid = error.code === 'SPAN_REQUEST_INVALID';
            res.status(invalid ? 400 : 500).json({ success: false,
                code: invalid ? 'SPAN_REQUEST_INVALID' : 'SPAN_SUPPLY_INTERNAL_ERROR',
                error: invalid ? 'Invalid span candidate request' : 'Span candidate supply failed', requestId: req.requestId || null });
        }
    });
    return router;
}
module.exports = { createEntitySpanCandidateRouter };
