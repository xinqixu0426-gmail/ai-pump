const { hasVerifiedExecution } = require('./aiExecutionEvidence.cjs');
const { getAiCapability } = require('../capabilities/registry.cjs');
const { COST_OVERRIDE_SCHEMA } = require('../routes/ai/tools.cjs');

const ORDER_QUERY_TOOLS = new Set([
    'get_order_detail',
    'get_order_knowledge_package',
    'check_order_readiness',
    'plan_order_readiness_actions',
]);
const QUOTATION_QUERY_TOOLS = new Set(['get_quotation_detail']);
const BUSINESS_NUMBER_ALIASES = Object.freeze({
    surfaceTreatmentCost: Object.freeze(['表面处理费', '喷漆费', '处理费用', 'surfaceTreatmentCost']),
    cableLength: Object.freeze(['电缆长度', '电缆', '线长', 'cableLength']),
    coilSheets: Object.freeze(['片数', '硅钢片数', '定子片数', 'coilSheets']),
    customBarrelLength: Object.freeze(['机筒长度', '机筒高', '机筒', '筒长', 'barrel length', 'customBarrelLength']),
    sheets: Object.freeze(['片数', '硅钢片数', '定子片数', 'sheets']),
    wireWeight: Object.freeze(['线重', '绕组线重', 'wireWeight']),
    coilWireWeight: Object.freeze(['线圈线重', '客户线重', 'coilWireWeight']),
    longScrewExtraLength: Object.freeze(['长螺丝补偿', '螺丝加长', '补偿长度', 'longScrewExtraLength']),
});
const COST_OVERRIDE_NUMBER_FIELDS = new Set(Object.entries(
    COST_OVERRIDE_SCHEMA.properties || {}
).filter(([, schema]) => schema?.type === 'number').map(([field]) => field));
const GROUNDED_BUSINESS_NUMBER_FIELDS = new Set([
    ...COST_OVERRIDE_NUMBER_FIELDS,
    'sheets',
    'wireWeight',
    'coilWireWeight',
    'longScrewExtraLength',
]);

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function userTextContainsGroundedNumber(messages = [], value, aliases = []) {
    const numberText = String(Number(value));
    if (!numberText || numberText === 'NaN') return false;
    const numberPattern = escapeRegExp(numberText).replace('\\.', '[.．]');
    const aliasPattern = aliases.map(escapeRegExp).join('|');
    if (!aliasPattern) return false;
    const patterns = [
        new RegExp(`(?:${aliasPattern})[^\\d]{0,12}${numberPattern}(?!\\d)`, 'iu'),
        new RegExp(`${numberPattern}(?!\\d)[^\\d]{0,8}(?:mm|毫米|片)?[^\\d]{0,8}(?:${aliasPattern})`, 'iu'),
    ];
    return (messages || []).some(message => (
        message?.role === 'user'
        && typeof message.content === 'string'
        && patterns.some(pattern => pattern.test(message.content))
    ));
}

function verifiedResultContainsFieldValue(toolResults = [], field, value) {
    const expected = Number(value);
    const visit = candidate => {
        if (!candidate || typeof candidate !== 'object') return false;
        if (Array.isArray(candidate)) return candidate.some(visit);
        for (const [key, nested] of Object.entries(candidate)) {
            if (key === field && Number(nested) === expected) return true;
            if (visit(nested)) return true;
        }
        return false;
    };
    return (toolResults || []).some(item => (
        hasVerifiedExecution(item?.result) && visit(item.result)
    ));
}

function businessNumberEntries(value, path = []) {
    if (!value || typeof value !== 'object') return [];
    const entries = [];
    for (const [key, nested] of Object.entries(value)) {
        const nextPath = [...path, key];
        if (GROUNDED_BUSINESS_NUMBER_FIELDS.has(key) && Number.isFinite(Number(nested))) {
            entries.push({ field: key, path: nextPath.join('.'), value: Number(nested) });
        }
        if (nested && typeof nested === 'object') {
            entries.push(...businessNumberEntries(nested, nextPath));
        }
    }
    return entries;
}

function userTextContainsCoilShorthand(messages = [], field, value) {
    if (!['sheets', 'coilSheets'].includes(field)) return false;
    const numberPattern = escapeRegExp(String(Number(value)));
    const pattern = new RegExp(`\\d+\\s*[-—~]\\s*${numberPattern}(?!\\d)`, 'u');
    return (messages || []).some(message => (
        message?.role === 'user'
        && typeof message.content === 'string'
        && pattern.test(message.content)
    ));
}

function explicitCoilShorthand(messages = []) {
    const pairs = new Map();
    for (const message of messages || []) {
        if (message?.role !== 'user' || typeof message.content !== 'string') continue;
        for (const match of message.content.matchAll(/(?:^|[^\d])(\d{1,3})\s*[-—~]\s*(\d{2,4})(?:\s*片)?(?!\d)/gu)) {
            const spec = String(Number(match[1]));
            const sheets = Number(match[2]);
            if (Number(spec) <= 0 || sheets <= 0) continue;
            pairs.set(`${spec}-${sheets}`, { spec, sheets });
        }
    }
    return pairs.size === 1 ? [...pairs.values()][0] : null;
}

function normalizeExplicitCoilShorthandArgs(args = {}, messages = []) {
    const shorthand = explicitCoilShorthand(messages);
    if (!shorthand || !args || typeof args !== 'object') return args;
    const normalized = { ...args };
    const normalizePair = (target, specField, sheetsField) => {
        if (!target || typeof target !== 'object') return target;
        const hasSpec = Object.hasOwn(target, specField);
        const hasSheets = Object.hasOwn(target, sheetsField);
        if (!hasSpec && !hasSheets) return target;
        const suppliedSpec = String(target[specField] || '').trim();
        if (suppliedSpec && suppliedSpec !== shorthand.spec) return target;
        return {
            ...target,
            [specField]: shorthand.spec,
            [sheetsField]: shorthand.sheets,
        };
    };
    Object.assign(normalized, normalizePair(normalized, 'coilSpec', 'coilSheets'));
    Object.assign(normalized, normalizePair(normalized, 'spec', 'sheets'));
    if (normalized.overrides && typeof normalized.overrides === 'object') {
        normalized.overrides = normalizePair(normalized.overrides, 'coilSpec', 'coilSheets');
    }
    return normalized;
}

function validateGroundedBusinessNumbers(input = {}) {
    if (getAiCapability(input.toolName)?.access !== 'read') return null;
    for (const { field, path, value } of businessNumberEntries(input.args)) {
        const aliases = BUSINESS_NUMBER_ALIASES[field] || [field];
        if (userTextContainsGroundedNumber(input.messages, value, aliases)) continue;
        if (userTextContainsCoilShorthand(input.messages, field, value)) continue;
        if (verifiedResultContainsFieldValue(input.toolResults, field, value)) continue;
        return {
            code: 'UNGROUNDED_BUSINESS_NUMBER',
            error: `${path}=${value} 未出现在用户明确输入或本轮已验证的正式查询结果中，已阻止使用模型猜测数值。`,
        };
    }
    return null;
}

function addPositiveOrderId(ids, value) {
    const orderId = Number(value);
    if (Number.isSafeInteger(orderId) && orderId > 0) ids.add(orderId);
}

function addPositiveQuotationId(ids, value) {
    const quotationId = Number(value);
    if (Number.isSafeInteger(quotationId) && quotationId > 0) ids.add(quotationId);
}

function verifiedResolvedOrderIds(toolResults = []) {
    const ids = new Set();
    for (const item of toolResults || []) {
        if (
            !(ORDER_QUERY_TOOLS.has(item?.name) || item?.name === 'get_recent_orders')
            || item?.result?.success === false
            || !hasVerifiedExecution(item?.result)
        ) continue;

        const result = item.result;
        addPositiveOrderId(ids, result.order?.id);
        addPositiveOrderId(ids, result.readiness?.order?.id);
        addPositiveOrderId(ids, result.actionPlan?.order?.id);
        addPositiveOrderId(ids, result.data?.id);
        addPositiveOrderId(ids, result.data?.order?.id);
        addPositiveOrderId(ids, result.data?.readiness?.order?.id);
        addPositiveOrderId(ids, result.data?.actionPlan?.order?.id);
        if (Array.isArray(result.data)) {
            for (const row of result.data) addPositiveOrderId(ids, row?.id);
        }
    }
    return ids;
}

function explicitOrderIds(messages = [], pageContext = null) {
    const ids = new Set();
    if (pageContext?.resourceType === 'order') {
        const pageId = Number(pageContext.resourceId);
        if (Number.isSafeInteger(pageId) && pageId > 0) ids.add(pageId);
    }

    const patterns = [
        /订单\s*(?:ID|编号|#|号)?\s*[:：#]?\s*(\d+)/giu,
        /(\d+)\s*号订单/gu,
    ];
    for (const message of messages || []) {
        if (message?.role !== 'user' || typeof message.content !== 'string') continue;
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            for (const match of message.content.matchAll(pattern)) {
                const orderId = Number(match[1]);
                if (Number.isSafeInteger(orderId) && orderId > 0) ids.add(orderId);
            }
        }
    }
    return ids;
}

function explicitQuotationIds(messages = [], pageContext = null) {
    const ids = new Set();
    if (pageContext?.resourceType === 'quotation') {
        addPositiveQuotationId(ids, pageContext.resourceId);
    }
    const patterns = [
        /报价\s*(?:ID|编号|#|号)\s*[:：#]?\s*(\d+)/giu,
        /(\d+)\s*号报价/gu,
    ];
    for (const message of messages || []) {
        if (message?.role !== 'user' || typeof message.content !== 'string') continue;
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            for (const match of message.content.matchAll(pattern)) {
                addPositiveQuotationId(ids, match[1]);
            }
        }
    }
    return ids;
}

function verifiedResolvedQuotationIds(toolResults = []) {
    const ids = new Set();
    for (const item of toolResults || []) {
        if (
            !['search_quotations', 'get_quotation_detail'].includes(item?.name)
            || item?.result?.success === false
            || !hasVerifiedExecution(item?.result)
        ) continue;
        addPositiveQuotationId(ids, item.result?.quotation?.id);
        if (Array.isArray(item.result?.data)) {
            for (const quotation of item.result.data) addPositiveQuotationId(ids, quotation?.id);
        }
    }
    return ids;
}

function validateAiToolIdentifierGrounding(input = {}) {
    const businessNumberIssue = validateGroundedBusinessNumbers(input);
    if (businessNumberIssue) return businessNumberIssue;
    if (QUOTATION_QUERY_TOOLS.has(input.toolName)) {
        const quotationId = Number(input.args?.quotationId);
        if (!Number.isSafeInteger(quotationId) || quotationId <= 0) return null;
        if (explicitQuotationIds(input.messages, input.pageContext).has(quotationId)) return null;
        if (verifiedResolvedQuotationIds(input.toolResults).has(quotationId)) return null;
        return {
            code: 'UNGROUNDED_QUOTATION_ID',
            error: `报价ID ${quotationId} 未出现在用户明确输入、当前报价页面或本轮正式报价查询中，已阻止按猜测ID查询。`,
        };
    }
    if (!ORDER_QUERY_TOOLS.has(input.toolName)) return null;
    const orderQuery = String(input.args?.orderQuery || '').trim();
    // orderQuery only drives a read-only formal lookup. The model may expand a
    // user alias to a canonical candidate; the order service remains
    // authoritative and stops on zero or multiple matches.
    if (orderQuery) return null;

    const orderId = Number(input.args?.orderId);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) return null;
    if (
        input.resolutionReceipt?.kind === 'entity_resolution'
        && input.resolutionReceipt?.entityType === 'order'
        && Number(input.resolutionReceipt?.selected?.id) === orderId
    ) return null;
    if (explicitOrderIds(input.messages, input.pageContext).has(orderId)) return null;
    if (verifiedResolvedOrderIds(input.toolResults).has(orderId)) return null;

    return {
        code: 'UNGROUNDED_ORDER_ID',
        error: `订单ID ${orderId} 未出现在用户明确输入或当前订单页面上下文中，已阻止按猜测ID查询。`,
    };
}

module.exports = {
    explicitOrderIds,
    explicitQuotationIds,
    businessNumberEntries,
    userTextContainsGroundedNumber,
    explicitCoilShorthand,
    normalizeExplicitCoilShorthandArgs,
    validateGroundedBusinessNumbers,
    verifiedResolvedOrderIds,
    verifiedResolvedQuotationIds,
    validateAiToolIdentifierGrounding,
};
