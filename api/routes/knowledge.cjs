const path = require('node:path');
const { Router } = require('express');
const multer = require('multer');
const { parsePositiveId } = require('../services/validation.cjs');
const {
    db,
    knowledgeDocumentRow,
    safeInsert,
    softDelete,
} = require('../db.cjs');
const {
    syncKnowledgeEntries,
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

const router = Router();
const documentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});
const DOCUMENT_TYPES = new Set([
    'technical_note',
    'pump_performance_test',
    'drawing',
    'spreadsheet',
    'other',
]);

function parseTags(value) {
    let items = [];
    if (Array.isArray(value)) {
        items = value;
    } else {
        try {
            const parsed = JSON.parse(value || '[]');
            items = Array.isArray(parsed) ? parsed : [];
        } catch {
            items = String(value || '').split(/[,，\n]/);
        }
    }
    return [...new Set(items.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 30);
}

function documentResponse(row) {
    const document = knowledgeDocumentRow(row);
    let tags = [];
    let metadata = {};
    try { tags = JSON.parse(document.tagsJson || '[]'); } catch { /* 保持空数组 */ }
    try { metadata = JSON.parse(document.metadataJson || '{}'); } catch { /* 保持空对象 */ }
    return {
        id: document.id,
        fileId: document.fileId,
        documentType: document.documentType,
        title: document.title,
        description: document.description,
        contentText: document.contentText,
        tags: Array.isArray(tags) ? tags : [],
        originalName: document.originalName,
        mimeType: document.mimeType,
        fileSize: document.fileSize,
        fileSha256: document.fileSha256,
        parserStatus: document.parserStatus,
        metadata,
        downloadPath: document.originalName ? `/api/knowledge/documents/${document.id}/download` : '',
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
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
        const rows = db.prepare(`
            SELECT id, file_id, document_type, title, description, tags_json,
                   original_name, mime_type, file_size, file_sha256, parser_status,
                   metadata_json, created_at, updated_at
            FROM knowledge_documents
            WHERE deleted_at IS NULL
            ORDER BY updated_at DESC, id DESC
        `).all();
        res.json({ success: true, data: rows.map(documentResponse) });
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
            const title = String(req.body?.title || '').trim();
            const description = String(req.body?.description || '').trim();
            const contentText = String(req.body?.contentText || '').trim();
            const documentType = String(req.body?.documentType || 'technical_note').trim();
            const tags = parseTags(req.body?.tags);
            if (!title) return res.status(400).json({ success: false, error: '资料标题不能为空' });
            if (title.length > 200) return res.status(400).json({ success: false, error: '资料标题不能超过 200 字' });
            if (description.length > 2000) return res.status(400).json({ success: false, error: '资料说明不能超过 2000 字' });
            if (contentText.length > 200_000) return res.status(400).json({ success: false, error: '技术内容不能超过 200000 字' });
            if (!DOCUMENT_TYPES.has(documentType)) {
                return res.status(400).json({ success: false, error: '资料类型不在允许范围内' });
            }
            if (!req.file?.buffer?.length && !contentText) {
                return res.status(400).json({ success: false, error: '请上传文件或填写技术内容' });
            }

            const inspectedFile = req.file ? inspectFactoryFile({
                buffer: req.file.buffer,
                originalName: req.file.originalname,
                mimeType: req.file.mimetype,
            }) : null;
            const originalName = inspectedFile?.originalName || '';
            if (originalName && !ALLOWED_DOCUMENT_EXTENSIONS.has(path.extname(originalName).toLowerCase())) {
                return res.status(400).json({ success: false, error: '只支持 .txt、.md、.csv、.xls、.xlsx 和 .pdf 文件' });
            }
            const parsed = parseKnowledgeDocumentFile({
                buffer: req.file?.buffer,
                originalName,
                documentType,
            });
            const now = new Date().toISOString();
            const saveDocument = db.transaction(() => {
                const stored = req.file ? storeFactoryFile({
                    buffer: req.file.buffer,
                    originalName,
                    mimeType: req.file.mimetype,
                    sourceType: 'knowledge_document',
                    parserStatus: ['parsed', 'metadata_only'].includes(parsed.parserStatus)
                        ? parsed.parserStatus
                        : 'pending',
                    now,
                }) : null;
                const info = safeInsert('knowledge_documents', {
                    file_id: stored?.file.id || null,
                    document_type: documentType,
                    title,
                    description,
                    content_text: contentText,
                    tags_json: JSON.stringify(tags),
                    original_name: originalName,
                    mime_type: stored?.file.mimeType || 'application/octet-stream',
                    file_size: stored?.file.fileSize || 0,
                    file_sha256: stored?.file.fileSha256 || '',
                    file_blob: null,
                    parser_status: parsed.parserStatus,
                    extracted_text: parsed.extractedText,
                    metadata_json: JSON.stringify(parsed.metadata),
                    created_at: now,
                    updated_at: now,
                });
                return db.prepare('SELECT * FROM knowledge_documents WHERE id = ?')
                    .get(info.lastInsertRowid);
            });
            const row = saveDocument();
            res.status(201).json({ success: true, data: documentResponse(row) });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });
});

router.get('/documents/:id/download', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法资料ID' });
        const row = db.prepare(`
            SELECT d.original_name,
                   COALESCE(f.mime_type, d.mime_type) AS mime_type,
                   COALESCE(f.file_blob, d.file_blob) AS file_blob
            FROM knowledge_documents d
            LEFT JOIN factory_files f ON f.id = d.file_id AND f.deleted_at IS NULL
            WHERE d.id = ? AND d.deleted_at IS NULL
        `).get(id);
        if (!row || !row.file_blob) return res.status(404).json({ success: false, error: '资料文件不存在' });
        res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
        res.setHeader('Content-Length', row.file_blob.length);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.original_name)}`);
        res.send(row.file_blob);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/documents/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法资料ID' });
        const row = db.prepare('SELECT id FROM knowledge_documents WHERE id = ? AND deleted_at IS NULL').get(id);
        if (!row) return res.status(404).json({ success: false, error: '资料不存在' });
        softDelete('knowledge_documents', id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/sync', (req, res) => {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    try {
        const data = syncKnowledgeEntries();
        recordKnowledgeSyncSuccess(data, 'manual', {
            startedAt,
            durationMs: Date.now() - startedMs,
        });
        res.json({ success: true, data });
    } catch (error) {
        recordKnowledgeSyncFailure(error, 'manual', {
            startedAt,
            durationMs: Date.now() - startedMs,
        });
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
