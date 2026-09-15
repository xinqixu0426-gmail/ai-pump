const { Router } = require('express');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { db } = require('../db.cjs');
const { listBusinessChanges } = require('../services/businessChanges.cjs');
const { searchFactoryKnowledge } = require('../services/knowledgeHybridSearch.cjs');

const router = Router();
const { readBusinessChangeRevision } = require('../services/businessChangeRevision.cjs');
router.get('/revision', (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, data: readBusinessChangeRevision(db) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message, code: 'business_change_revision_failed', requestId: req.requestId });
    }
});
const CAPABILITY_ID = requireBusinessCapability('business_changes.list').capabilityId;

router.get('/', async (req, res) => {
    try {
        const semanticQuery = String(req.query.semanticQuery || '').trim();
        let semanticMatches = [];
        if (semanticQuery) {
            semanticMatches = await searchFactoryKnowledge({
                query: semanticQuery,
                entryType: 'change_event',
                sourceTable: 'business_change_events',
                limit: 50,
            });
        }
        const candidateIds = semanticMatches
            .map(item => Number(item.sourceId))
            .filter(Number.isInteger);
        const data = listBusinessChanges(db, {
            period: req.query.period,
            from: req.query.from,
            to: req.query.to,
            domain: req.query.domain,
            entityType: req.query.entityType,
            entityId: req.query.entityId,
            eventType: req.query.eventType,
            keyword: req.query.keyword,
            beforeId: req.query.beforeId,
            limit: req.query.limit,
            ...(semanticQuery ? { candidateIds } : {}),
        });
        data.semanticSearch = semanticQuery ? {
            query: semanticQuery,
            matchedEventIds: candidateIds,
            fallbackToStructured: false,
            evidenceLevel: candidateIds.length === 0
                ? 'no_match'
                : candidateIds.some((_id, index) => semanticMatches[index]?.evidenceLevel === 'semantic_candidate')
                ? 'semantic_candidate'
                : 'text_match',
        } : null;
        res.json({ success: true, data, capabilityId: CAPABILITY_ID });
    } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
            success: false,
            error: error.message,
            code: error.code || 'business_change_query_failed',
        });
    }
});

module.exports = router;
