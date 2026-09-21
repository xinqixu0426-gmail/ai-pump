'use strict';

const express = require('express');
const {
    ENTITY_LOOKUP_API_VERSION,
    EntityLookupError,
    createEntityLookupService,
} = require('../services/entityLookupService.cjs');

function errorData(status) {
    return {
        version: ENTITY_LOOKUP_API_VERSION,
        status,
        complete: false,
        attemptedEntityTypes: 0,
        candidateCount: 0,
        candidates: [],
        resolutions: [],
    };
}

function createEntityLookupRouter({ db, lookupEntities } = {}) {
    const lookup = lookupEntities || createEntityLookupService({ db }).lookupEntities;
    const router = express.Router();

    router.post('/', (req, res) => {
        try {
            res.json({ success: true, data: lookup(req.body) });
        } catch (error) {
            if (error instanceof EntityLookupError) {
                return res.status(error.statusCode).json({
                    success: false,
                    error: error.message,
                    code: error.code,
                    requestId: req.requestId || null,
                    data: errorData(error.lookupStatus),
                });
            }
            return res.status(500).json({
                success: false,
                error: '实体查询失败',
                code: 'ENTITY_LOOKUP_INTERNAL_ERROR',
                requestId: req.requestId || null,
                data: errorData('INTERNAL_ERROR'),
            });
        }
    });

    return router;
}

module.exports = { createEntityLookupRouter };
