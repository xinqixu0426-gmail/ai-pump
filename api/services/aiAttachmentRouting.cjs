const {
    getFactoryFile,
    getFactoryFileContent,
} = require('./factoryFileStore.cjs');

const MAX_CHAT_ATTACHMENTS = 4;
const KIMI_EXTRACT_TYPES = new Set(['pdf', 'spreadsheet', 'text']);

function normalizeAttachmentIds(attachments) {
    if (!Array.isArray(attachments)) return [];
    const unique = [];
    for (const attachment of attachments) {
        const id = Number(attachment?.id ?? attachment?.fileId);
        if (!Number.isSafeInteger(id) || id <= 0 || unique.includes(id)) continue;
        unique.push(id);
        if (unique.length >= MAX_CHAT_ATTACHMENTS) break;
    }
    return unique;
}

function messageAttachmentIds(messages) {
    const ids = [];
    for (const message of Array.isArray(messages) ? messages : []) {
        if (message?.role !== 'user') continue;
        for (const id of normalizeAttachmentIds(message.attachments)) {
            if (!ids.includes(id)) ids.push(id);
        }
    }
    return ids;
}

function hasItems(value) {
    return Array.isArray(value) ? value.length > 0 : Number(value || 0) > 0;
}

function requiresExternalPdfUnderstanding(content) {
    const parsed = content?.parsed || {};
    return Boolean(
        parsed.requiresOcr
        || parsed.ocrApplied
        || parsed.truncated
        || Number(parsed.drawingCandidateCount || 0) > 0
        || hasItems(parsed.unresolvedPages)
        || (Array.isArray(parsed.pages) && parsed.pages.some(page => page?.source === 'ocr'))
    );
}

function classifyAttachment(file, content) {
    if (!file) {
        return { handling: 'missing', requiresKimi: false, requiresVision: false };
    }
    if (file.detectedType === 'image') {
        return { handling: 'vision', requiresKimi: true, requiresVision: true };
    }
    if (!KIMI_EXTRACT_TYPES.has(file.detectedType)) {
        return { handling: 'unsupported', requiresKimi: false, requiresVision: false };
    }
    if (file.detectedType === 'text' && !['.doc', '.docx'].includes(file.extension)) {
        // TXT 上传时已完成 UTF-8 校验且不进入异步 parser，原始正文就是权威本地内容。
        return { handling: 'local_text', requiresKimi: false, requiresVision: false };
    }
    const hasParsedText = content?.parserStatus === 'parsed'
        && Boolean(String(content.parsedText || '').trim());
    const complexPdf = file.detectedType === 'pdf'
        && requiresExternalPdfUnderstanding(content);
    const truncated = Boolean(content?.parsed?.truncated);
    if (hasParsedText && !complexPdf && !truncated) {
        return { handling: 'local_parsed', requiresKimi: false, requiresVision: false };
    }
    return {
        handling: 'external_file',
        requiresKimi: true,
        requiresVision: false,
        parserStatus: content?.parserStatus || file.parserStatus || 'pending',
    };
}

function resolveAttachmentRouting(messages, options = {}) {
    const decisions = new Map();
    if (options.attachmentMode === 'metadata') {
        return {
            decisions,
            needsKimi: false,
            needsVision: false,
            needsFileExtraction: false,
            routeReason: 'default',
        };
    }
    for (const id of messageAttachmentIds(messages)) {
        const file = getFactoryFile(id, { dbAccessors: options.dbAccessors });
        const content = file && KIMI_EXTRACT_TYPES.has(file.detectedType)
            ? getFactoryFileContent(id, { dbAccessors: options.dbAccessors })
            : null;
        decisions.set(id, classifyAttachment(file, content));
    }
    const values = [...decisions.values()];
    const needsVision = values.some(item => item.requiresVision);
    const needsFileExtraction = values.some(item => item.handling === 'external_file');
    return {
        decisions,
        needsKimi: needsVision || needsFileExtraction,
        needsVision,
        needsFileExtraction,
        routeReason: needsVision ? 'image' : (needsFileExtraction ? 'file' : 'default'),
    };
}

module.exports = {
    KIMI_EXTRACT_TYPES,
    MAX_CHAT_ATTACHMENTS,
    classifyAttachment,
    messageAttachmentIds,
    normalizeAttachmentIds,
    requiresExternalPdfUnderstanding,
    resolveAttachmentRouting,
};
