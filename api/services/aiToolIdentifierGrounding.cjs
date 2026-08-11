const ORDER_QUERY_TOOLS = new Set([
    'get_order_detail',
    'get_order_knowledge_package',
    'check_order_readiness',
    'plan_order_readiness_actions',
]);

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
    if (String(input.args?.orderQuery || '').trim()) return null;

    const orderId = Number(input.args?.orderId);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) return null;
    if (explicitOrderIds(input.messages, input.pageContext).has(orderId)) return null;

    return {
        code: 'UNGROUNDED_ORDER_ID',
        error: `订单ID ${orderId} 未出现在用户明确输入或当前订单页面上下文中，已阻止按猜测ID查询。`,
    };
}

module.exports = {
    explicitOrderIds,
    validateAiToolIdentifierGrounding,
};
