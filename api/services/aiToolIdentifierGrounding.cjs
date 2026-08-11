const { hasVerifiedExecution } = require('./aiExecutionEvidence.cjs');

const ORDER_QUERY_TOOLS = new Set([
    'get_order_detail',
    'get_order_knowledge_package',
    'check_order_readiness',
    'plan_order_readiness_actions',
]);

function addPositiveOrderId(ids, value) {
    const orderId = Number(value);
    if (Number.isSafeInteger(orderId) && orderId > 0) ids.add(orderId);
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

function validateAiToolIdentifierGrounding(input = {}) {
    if (!ORDER_QUERY_TOOLS.has(input.toolName)) return null;
    const orderQuery = String(input.args?.orderQuery || '').trim();
    // orderQuery only drives a read-only formal lookup. The model may expand a
    // user alias to a canonical candidate; the order service remains
    // authoritative and stops on zero or multiple matches.
    if (orderQuery) return null;

    const orderId = Number(input.args?.orderId);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) return null;
    if (explicitOrderIds(input.messages, input.pageContext).has(orderId)) return null;
    if (verifiedResolvedOrderIds(input.toolResults).has(orderId)) return null;

    return {
        code: 'UNGROUNDED_ORDER_ID',
        error: `订单ID ${orderId} 未出现在用户明确输入或当前订单页面上下文中，已阻止按猜测ID查询。`,
    };
}

module.exports = {
    explicitOrderIds,
    verifiedResolvedOrderIds,
    validateAiToolIdentifierGrounding,
};
