const { hasVerifiedExecution } = require('./aiExecutionEvidence.cjs');

const ORDER_QUERY_TOOLS = new Set([
    'get_order_detail',
    'get_order_knowledge_package',
    'check_order_readiness',
    'plan_order_readiness_actions',
]);
const QUOTATION_QUERY_TOOLS = new Set(['get_quotation_detail']);

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
            !ORDER_QUERY_TOOLS.has(item?.name)
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
    verifiedResolvedOrderIds,
    verifiedResolvedQuotationIds,
    validateAiToolIdentifierGrounding,
};
