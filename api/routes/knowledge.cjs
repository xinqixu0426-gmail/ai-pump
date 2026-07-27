const { Router } = require('express');
const { parsePositiveId } = require('../services/validation.cjs');
const {
    syncKnowledgeEntries,
    searchKnowledgeEntries,
    getKnowledgeEntryDetail,
    inspectKnowledgeOverview,
} = require('../services/knowledge.cjs');

const router = Router();

router.get('/overview', (req, res) => {
    try {
        const data = inspectKnowledgeOverview();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/', (req, res) => {
    try {
        const data = searchKnowledgeEntries({
            query: req.query.query,
            keyword: req.query.keyword,
            entryType: req.query.entryType,
            type: req.query.type,
            sourceTable: req.query.sourceTable,
            limit: req.query.limit,
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/sync', (req, res) => {
    try {
        const data = syncKnowledgeEntries();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法知识条目ID' });
        const data = getKnowledgeEntryDetail(id);
        if (!data) return res.status(404).json({ success: false, error: '知识条目不存在' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
