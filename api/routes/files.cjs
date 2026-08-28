const { Router } = require('express');
const multer = require('multer');
const { db, safeInsert, safeUpdate, softDelete } = require('../db.cjs');
const { parsePositiveId } = require('../services/validation.cjs');
const {
    commandActorKey,
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');
const {
    MAX_FACTORY_FILE_SIZE,
    getFactoryFile,
    getFactoryFileBlob,
    getFactoryFileContent,
    listFactoryFiles,
} = require('../services/factoryFileStore.cjs');
const {
    needsFactoryFileParsing,
} = require('../services/factoryFileParser.cjs');
const { buildQuotationFileDraft } = require('../services/factoryQuotationDraft.cjs');
const {
    listFactoryFileLinks,
    searchFactoryFileArchiveTargets,
} = require('../services/factoryFileArchive.cjs');
const {
    ARCHIVE_CAPABILITY_ID,
    LINK_DELETE_CAPABILITY_ID,
    buildFactoryFileArchivePreview,
    executeConfirmedFactoryFileArchive,
    executeFactoryFileLinkDelete,
} = require('../services/factoryFileCommands.cjs');
const {
    BUSINESS_ATTACHMENT_UPLOAD_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    PARSE_CAPABILITY_ID,
    UPLOAD_CAPABILITY_ID,
    buildFactoryFileBusinessAttachmentPreview,
    executeConfirmedFactoryFileBusinessAttachmentUpload,
    executeFactoryFileDelete,
    executeFactoryFileParse,
    executeFactoryFileUpload,
} = require('../services/factoryFileLifecycleCommands.cjs');

const router = Router();
const fileCommandDependencies = {
    db,
    safeInsert,
    safeUpdate,
    softDelete,
};
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
            const commandContext = commandContextFromRequest(
                req,
                UPLOAD_CAPABILITY_ID
            );
            const result = executeFactoryFileUpload(
                fileCommandDependencies,
                {
                    buffer: req.file.buffer,
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    sourceType: 'direct_upload',
                },
                commandContext
            );
            let parseWarning = '';
            let parseOperationId = null;
            if (needsFactoryFileParsing(result)) {
                try {
                    const parsed = await executeFactoryFileParse(
                        fileCommandDependencies,
                        result.id,
                        { expectedUpdatedAt: result.updatedAt },
                        {
                            actorKey: commandContext.actorKey,
                            idempotencyKey: `upload-parse:${result.operationId}`,
                            operationId: `${result.operationId}:parse`,
                            requestId: commandContext.requestId,
                            warnings: [],
                        }
                    );
                    parseOperationId = parsed.operationId;
                } catch (error) {
                    parseWarning = error.message;
                    parseOperationId = error.receipt?.operationId || null;
                }
            }
            const currentFile = getFactoryFile(result.id);
            res.status(result.deduplicated ? 200 : 201).json({
                success: true,
                data: {
                    ...result,
                    ...currentFile,
                    parseOperationId,
                },
                deduplicated: result.deduplicated,
                parseWarning,
            });
        } catch (error) {
            sendCommandError(res, error);
        }
    });
});

router.post('/business-attachment-preview', (req, res) => {
    upload.single('file')(req, res, uploadError => {
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
            const data = buildFactoryFileBusinessAttachmentPreview(
                fileCommandDependencies,
                {
                    ...req.body,
                    buffer: req.file.buffer,
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                },
                commandActorKey(req)
            );
            res.json({ success: true, data });
        } catch (error) {
            sendCommandError(res, error);
        }
    });
});

router.post('/business-attachment', (req, res) => {
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
            const commandContext = commandContextFromRequest(
                req,
                BUSINESS_ATTACHMENT_UPLOAD_CAPABILITY_ID
            );
            const result = executeConfirmedFactoryFileBusinessAttachmentUpload(
                fileCommandDependencies,
                {
                    confirmationToken: req.body?.confirmationToken,
                    buffer: req.file.buffer,
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    sourceType: 'direct_upload',
                },
                commandContext,
                commandActorKey(req)
            );
            let parseWarning = '';
            let parseOperationId = null;
            if (needsFactoryFileParsing(result.file)) {
                try {
                    const parsed = await executeFactoryFileParse(
                        fileCommandDependencies,
                        result.file.id,
                        { expectedUpdatedAt: result.file.updatedAt },
                        {
                            actorKey: commandContext.actorKey,
                            idempotencyKey: `business-attachment-parse:${result.operationId}`,
                            operationId: `${result.operationId}:parse`,
                            requestId: commandContext.requestId,
                            warnings: [],
                        }
                    );
                    parseOperationId = parsed.operationId;
                } catch (error) {
                    parseWarning = error.message;
                    parseOperationId = error.receipt?.operationId || null;
                }
            }
            res.status(result.idempotentReplay || result.deduplicated ? 200 : 201).json({
                success: true,
                data: {
                    ...result,
                    file: getFactoryFile(result.file.id),
                    parseOperationId,
                },
                deduplicated: result.deduplicated,
                parseWarning,
            });
        } catch (error) {
            sendCommandError(res, error);
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
        const result = await executeFactoryFileParse(
            fileCommandDependencies,
            id,
            req.body || {},
            commandContextFromRequest(req, PARSE_CAPABILITY_ID)
        );
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(Number(error.statusCode) || 400).json({
            success: false,
            code: error.code || 'factory_file_parse_failed',
            error: error.message,
            requestId: req.requestId || null,
            data: error.receipt || getFactoryFile(req.params.id),
        });
    }
});

router.post('/:id/quotation-draft', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法文件ID' });
        const file = getFactoryFile(id);
        if (!file) return res.status(404).json({ success: false, error: '文件不存在' });
        if (
            needsFactoryFileParsing(file)
            || file.parserStatus === 'processing'
        ) {
            return res.status(409).json({
                success: false,
                code: 'factory_file_parse_required',
                error: file.parserStatus === 'processing'
                    ? '文件正在解析，请完成后再生成报价草稿'
                    : '文件需要先通过明确的解析命令处理，再生成报价草稿',
                requestId: req.requestId || null,
                data: {
                    file,
                    parsePath: `/api/files/${id}/parse`,
                },
            });
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

router.post('/:id/archive-preview', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法文件ID' });
        const result = buildFactoryFileArchivePreview(
            { db, safeInsert, safeUpdate },
            id,
            req.body || {},
            commandActorKey(req)
        );
        res.json({ success: true, data: result });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/:id/archive', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法文件ID' });
        let commandInput = req.body || {};
        const commandContext = commandContextFromRequest(
            req,
            ARCHIVE_CAPABILITY_ID
        );
        if (!commandInput.confirmationToken && commandInput.targetType) {
            const compatibilityPreview = buildFactoryFileArchivePreview(
                { db, safeInsert, safeUpdate },
                id,
                commandInput,
                commandActorKey(req)
            );
            commandInput = {
                confirmationToken: compatibilityPreview.confirmationToken,
            };
            commandContext.warnings = [
                ...(commandContext.warnings || []).filter(
                    warning => warning.code !== 'idempotency_key_missing_compatibility'
                ),
                {
                    code: 'legacy_archive_without_explicit_preview',
                    message: '兼容调用仍使用旧归档入参；请迁移到 archive-preview 后提交 confirmationToken',
                },
            ];
        }
        const result = executeConfirmedFactoryFileArchive(
            { db, safeInsert, safeUpdate },
            id,
            commandInput,
            commandContext,
            commandActorKey(req)
        );
        res.status(result.idempotentReplay || result.deduplicated ? 200 : 201).json({
            success: true,
            data: result,
            deduplicated: result.deduplicated,
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.delete('/:id/links/:linkId', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        const linkId = parsePositiveId(req.params.linkId);
        if (!id || !linkId) {
            return res.status(400).json({ success: false, error: '非法文件关联ID' });
        }
        const result = executeFactoryFileLinkDelete(
            { db, safeInsert, safeUpdate },
            id,
            linkId,
            req.body || {},
            commandContextFromRequest(req, LINK_DELETE_CAPABILITY_ID)
        );
        res.json({ success: true, data: result });
    } catch (error) {
        sendCommandError(res, error);
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
        const result = executeFactoryFileDelete(
            fileCommandDependencies,
            id,
            req.body || {},
            commandContextFromRequest(req, DELETE_CAPABILITY_ID)
        );
        res.json({ success: true, data: result });
    } catch (error) {
        sendCommandError(res, error);
    }
});

module.exports = router;
