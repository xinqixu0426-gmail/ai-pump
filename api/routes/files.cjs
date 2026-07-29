const { Router } = require('express');
const multer = require('multer');
const { parsePositiveId } = require('../services/validation.cjs');
const {
    MAX_FACTORY_FILE_SIZE,
    deleteFactoryFile,
    getFactoryFile,
    getFactoryFileBlob,
    getFactoryFileContent,
    listFactoryFiles,
    storeFactoryFile,
} = require('../services/factoryFileStore.cjs');
const {
    needsFactoryFileParsing,
    parseFactoryFile,
} = require('../services/factoryFileParser.cjs');
const { buildQuotationFileDraft } = require('../services/factoryQuotationDraft.cjs');
const {
    archiveFactoryFile,
    deleteFactoryFileLink,
    listFactoryFileLinks,
    searchFactoryFileArchiveTargets,
} = require('../services/factoryFileArchive.cjs');

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FACTORY_FILE_SIZE, files: 1 },
});

router.get('/', (req, res) => {
    try {
        res.json({
            success: true,
            data: listFactoryFiles({
                detectedType: req.query.detectedType,
                sourceType: req.query.sourceType,
                limit: req.query.limit,
            }),
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/', (req, res) => {
    upload.single('file')(req, res, async uploadError => {
        if (uploadError) {
            const message = uploadError.code === 'LIMIT_FILE_SIZE'
                ? '文件不能超过 10MB'
                : uploadError.message;
            return res.status(400).json({ success: false, error: message });
        }
        try {
            if (!req.file?.buffer?.length) {
                return res.status(400).json({ success: false, error: '请选择文件' });
            }
            const result = storeFactoryFile({
                buffer: req.file.buffer,
                originalName: req.file.originalname,
                mimeType: req.file.mimetype,
                sourceType: 'direct_upload',
            });
            let parseWarning = '';
            if (needsFactoryFileParsing(result.file)) {
                try {
                    await parseFactoryFile(result.file.id);
                } catch (error) {
                    parseWarning = error.message;
                }
            }
            res.status(result.deduplicated ? 200 : 201).json({
                success: true,
                data: getFactoryFile(result.file.id),
                deduplicated: result.deduplicated,
                parseWarning,
            });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });
});

router.get('/archive-targets', (req, res) => {
    try {
        res.json({
            success: true,
            data: searchFactoryFileArchiveTargets({
                targetType: req.query.targetType,
                query: req.query.query,
                limit: req.query.limit,
            }),
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
});

router.get('/links', (req, res) => {
    try {
        res.json({
            success: true,
            data: listFactoryFileLinks({
                targetType: req.query.targetType,
                targetId: req.query.targetId,
            }),
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
});

router.post('/:id/parse', async (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法文件ID' });
        await parseFactoryFile(id);
        res.json({ success: true, data: getFactoryFile(id) });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message,
            data: getFactoryFile(req.params.id),
        });
    }
});

router.post('/:id/quotation-draft', async (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法文件ID' });
        const file = getFactoryFile(id);
        if (!file) return res.status(404).json({ success: false, error: '文件不存在' });
        if (needsFactoryFileParsing(file)) {
            await parseFactoryFile(id);
        }
        res.json({
            success: true,
            data: buildQuotationFileDraft(id, {
                customerName: req.body?.customerName,
            }),
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.get('/:id/links', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法文件ID' });
        res.json({
            success: true,
            data: listFactoryFileLinks({ fileId: id }),
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
});

router.post('/:id/archive', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法文件ID' });
        const result = archiveFactoryFile(id, {
            targetType: req.body?.targetType,
            targetId: req.body?.targetId,
            relationRole: req.body?.relationRole,
            title: req.body?.title,
            note: req.body?.note,
            source: req.body?.source,
            documentType: req.body?.documentType,
            tags: req.body?.tags,
        });
        res.status(result.deduplicated ? 200 : 201).json({
            success: true,
            data: result,
            deduplicated: result.deduplicated,
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
});

router.delete('/:id/links/:linkId', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        const linkId = parsePositiveId(req.params.linkId);
        if (!id || !linkId) {
            return res.status(400).json({ success: false, error: '非法文件关联ID' });
        }
        deleteFactoryFileLink(id, linkId);
        res.json({ success: true });
    } catch (error) {
        res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
});

router.get('/:id/download', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法文件ID' });
        const file = getFactoryFileBlob(id);
        if (!file) return res.status(404).json({ success: false, error: '文件不存在' });
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        res.setHeader('Content-Length', file.file_size || file.file_blob.length);
        res.setHeader(
            'Content-Disposition',
            `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`
        );
        res.send(file.file_blob);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/:id/content', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法文件ID' });
        const content = getFactoryFileContent(id);
        if (!content) return res.status(404).json({ success: false, error: '文件不存在' });
        res.json({ success: true, data: content });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法文件ID' });
        const file = getFactoryFile(id);
        if (!file) return res.status(404).json({ success: false, error: '文件不存在' });
        res.json({ success: true, data: file });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法文件ID' });
        deleteFactoryFile(id);
        res.json({ success: true });
    } catch (error) {
        res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
});

module.exports = router;
