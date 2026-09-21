const { Router } = require('express');
const multer = require('multer');
const { parsePositiveId } = require('../services/validation.cjs');
const dbAccessors = require('../db.cjs');
const {
    db,
    knowledgeDocumentRow,
    safeInsert,
    safeUpdate,
} = dbAccessors;
const {
    getKnowledgeEntryDetail,
    inspectKnowledgeOverview,
} = require('../services/knowledge.cjs');
const { searchFactoryKnowledge } = require('../services/knowledgeHybridSearch.cjs');
const {
    recordKnowledgeSyncFailure,
    recordKnowledgeSyncSuccess,
} = require('../services/knowledgeAutoSync.cjs');
const { listKnowledgeSyncRuns } = require('../services/knowledgeSyncHistory.cjs');
const { buildKnowledgeSyncHealth } = require('../services/knowledgeSyncHealth.cjs');
const { embeddingProvider } = require('../services/embeddingProvider.cjs');
const { buildKnowledgeVectorHealth } = require('../services/knowledgeVectorStore.cjs');
const { getKnowledgeVectorSyncStatus } = require('../services/knowledgeVectorAutoSync.cjs');
const { listKnowledgeVectorSyncRuns } = require('../services/knowledgeVectorSyncHistory.cjs');
const {
    runKnowledgeRetrievalEvaluation,
} = require('../services/knowledgeRetrievalEvaluation.cjs');
const {
    ALLOWED_DOCUMENT_EXTENSIONS,
    parseKnowledgeDocumentFile,
} = require('../services/knowledgeDocumentParser.cjs');
const {
    inspectFactoryFile,
    storeFactoryFile,
} = require('../services/factoryFileStore.cjs');
const {
    DELETE_CAPABILITY_ID: KNOWLEDGE_DOCUMENT_DELETE_CAPABILITY_ID,
    UPLOAD_CAPABILITY_ID: KNOWLEDGE_DOCUMENT_UPLOAD_CAPABILITY_ID,
    executeKnowledgeDocumentDelete,
    executeKnowledgeDocumentUpload,
    getKnowledgeDocumentDownload,
    listKnowledgeDocuments,
} = require('../services/knowledgeDocuments.cjs');
const {
    KNOWLEDGE_SYNC_CAPABILITY_ID,
    buildKnowledgeSyncPreview,
    executeKnowledgeSync,
} = require('../services/knowledgeSyncCommand.cjs');
const {
    commandActorKey,
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');

const router = Router();
const documentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

function knowledgeDocumentDependencies() {
    return {
        allowedDocumentExtensions: ALLOWED_DOCUMENT_EXTENSIONS,
        db,
        inspectFactoryFile,
        knowledgeDocumentRow,
        parseKnowledgeDocumentFile,
        safeInsert,
        safeUpdate,
        storeFactoryFile,
    };
}

function legacyKnowledgeDocumentCommandResponse(result) {
    return {
        ...result,
        operationStatus: result.status,
        ...result.document,
    };
}

router.get('/overview', (req, res) => {
    try {
        const data = inspectKnowledgeOverview();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/', async (req, res) => {
    try {
        const data = await searchFactoryKnowledge({
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

router.get('/sync-runs', (req, res) => {
    try {
        const data = listKnowledgeSyncRuns({
            limit: req.query.limit,
            status: req.query.status,
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/health', (req, res) => {
    try {
        const overview = inspectKnowledgeOverview();
        const history = listKnowledgeSyncRuns({ limit: 10 });
        const data = buildKnowledgeSyncHealth({
            autoSync: overview.autoSync,
            pendingTotal: overview.stats.pendingTotal,
            history,
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/vector-health', (req, res) => {
    try {
        const history = listKnowledgeVectorSyncRuns({ limit: 5 });
        const data = buildKnowledgeVectorHealth(db, embeddingProvider, {
            syncStatus: getKnowledgeVectorSyncStatus(),
            history,
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/vector-sync-runs', (req, res) => {
    try {
        const data = listKnowledgeVectorSyncRuns({
            limit: req.query.limit,
            status: req.query.status,
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/retrieval-evaluation', async (req, res) => {
    try {
        const data = await runKnowledgeRetrievalEvaluation();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/documents', (req, res) => {
    try {
        const data = listKnowledgeDocuments(knowledgeDocumentDependencies());
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/documents', (req, res) => {
    documentUpload.single('file')(req, res, uploadError => {
        if (uploadError) {
            const message = uploadError.code === 'LIMIT_FILE_SIZE'
                ? '资料文件不能超过 10MB'
                : uploadError.message;
            return res.status(400).json({ success: false, error: message });
        }
        try {
            const result = executeKnowledgeDocumentUpload(
                knowledgeDocumentDependencies(),
                {
                    ...(req.body || {}),
                    buffer: req.file?.buffer,
                    originalName: req.file?.originalname,
                    mimeType: req.file?.mimetype,
                },
                commandContextFromRequest(
                    req,
                    KNOWLEDGE_DOCUMENT_UPLOAD_CAPABILITY_ID
                )
            );
            res.status(201).json({
                success: true,
                data: legacyKnowledgeDocumentCommandResponse(result),
            });
        } catch (error) {
            if (error.statusCode) return sendCommandError(res, error);
            res.status(400).json({ success: false, error: error.message });
        }
    });
});

router.get('/documents/:id/download', (req, res) => {
    try {
        const file = getKnowledgeDocumentDownload(
            knowledgeDocumentDependencies(),
            req.params.id
        );
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Length', file.buffer.length);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
        res.send(file.buffer);
    } catch (error) {
        if (error.statusCode) return sendCommandError(res, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/documents/:id', (req, res) => {
    try {
        const data = executeKnowledgeDocumentDelete(
            knowledgeDocumentDependencies(),
            req.params.id,
            req.body || {},
            commandContextFromRequest(
                req,
                KNOWLEDGE_DOCUMENT_DELETE_CAPABILITY_ID
            )
        );
        res.json({ success: true, data });
    } catch (error) {
        if (error.statusCode) return sendCommandError(res, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/sync-preview', (req, res) => {
    try {
        const data = buildKnowledgeSyncPreview(
            dbAccessors,
            commandActorKey(req)
        );
        res.json({ success: true, data });
    } catch (error) {
        return sendCommandError(res, error);
    }
});

router.post('/sync', (req, res) => {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    try {
        const data = executeKnowledgeSync(
            dbAccessors,
            req.body || {},
            commandContextFromRequest(req, KNOWLEDGE_SYNC_CAPABILITY_ID),
            commandActorKey(req)
        );
        recordKnowledgeSyncSuccess(data, 'manual', {
            startedAt,
            durationMs: Date.now() - startedMs,
            skipRecord: true,
        });
        res.json({ success: true, data });
    } catch (error) {
        if (Number(error.statusCode || 500) >= 500) {
            recordKnowledgeSyncFailure(error, 'manual', {
                startedAt,
                durationMs: Date.now() - startedMs,
            });
        }
        return sendCommandError(res, error);
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
