'use strict';

const { getFactoryFile, getFactoryFileContent } = require('../factoryFileStore.cjs');

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_CHARS = 2_000;
const MAX_TOTAL_ATTACHMENT_CHARS = 6_000;
const PAGE_RESOURCE_TYPES = new Set(['recipe', 'part', 'coil', 'order', 'quotation', 'customer', 'template']);
function bounded(value, max) { return String(value || '').replace(/\u0000/g, '').trim().slice(0, max); }
function normalizePageContext(value) {
    if (!value || typeof value !== 'object') return null;
    const resourceType = bounded(value.resourceType, 40).toLowerCase(); const resourceId = Number(value.resourceId);
    if (!PAGE_RESOURCE_TYPES.has(resourceType) || !Number.isInteger(resourceId) || resourceId <= 0) return null;
    return Object.freeze({ resourceType, resourceId, path: bounded(value.path, 300), view: bounded(value.view, 80) });
}
function attachmentContext(attachments = [], options = {}) {
    const fileGetter = options.getFactoryFile || getFactoryFile; const contentGetter = options.getFactoryFileContent || getFactoryFileContent;
    const seen = new Set(); let remaining = MAX_TOTAL_ATTACHMENT_CHARS; const result = [];
    for (const attachment of Array.isArray(attachments) ? attachments : []) {
        if (result.length >= MAX_ATTACHMENTS || remaining <= 0) break;
        const id = Number(attachment?.id); if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue; seen.add(id);
        const file = fileGetter(id, options.fileOptions);
        if (!file) { result.push(Object.freeze({ fileId: id, filename: '未知附件', parserStatus: 'unavailable', availability: '附件不存在或当前不可访问。' })); continue; }
        const content = contentGetter(id, options.fileOptions); const parserStatus = content?.parserStatus || file.parserStatus || 'unavailable';
        const base = { fileId: id, filename: bounded(file.originalName, 255), detectedType: bounded(file.detectedType, 40), parserStatus, parserSummary: bounded(file.parserSummary, 600) };
        if (parserStatus !== 'parsed' || !content?.parsedText?.trim()) {
            result.push(Object.freeze({ ...base, availability: parserStatus === 'failed' ? `附件解析失败：${bounded(content?.parserError, 300) || '没有可用解析内容。'}` : '附件已上传，但当前没有可用解析内容。' })); continue;
        }
        const excerpt = bounded(content.parsedText, Math.min(MAX_ATTACHMENT_CHARS, remaining)); remaining -= excerpt.length;
        result.push(Object.freeze({ ...base, availability: 'parsed', contentExcerpt: excerpt }));
    }
    return Object.freeze(result);
}
function buildInvestigationContext(input = {}, options = {}) { return Object.freeze({ attachments: attachmentContext(input.attachments, options), pageContext: normalizePageContext(input.pageContext) }); }
function renderInvestigationContext(context = {}) {
    const blocks = ['调查上下文（仅帮助理解用户指代或附件内容；不是正式业务事实，成本、库存、价格和状态必须通过正式工具核验）：'];
    if (context.pageContext) blocks.push(`当前页面候选：${JSON.stringify(context.pageContext)}。页面上的展示金额不是正式事实。`);
    for (const item of context.attachments || []) blocks.push(`用户提供附件：${JSON.stringify(item)}。附件记录不能替代正式业务查询。`);
    if (!context.pageContext && !(context.attachments || []).length) blocks.push('无额外页面或附件上下文。'); return blocks.join('\n');
}
module.exports = { MAX_ATTACHMENTS, MAX_ATTACHMENT_CHARS, MAX_TOTAL_ATTACHMENT_CHARS, attachmentContext, buildInvestigationContext, normalizePageContext, renderInvestigationContext };
