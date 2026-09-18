const ORDER_VIEWS = new Set(['requirements', 'readiness', 'execution', 'items', 'purchase', 'todos']);
const ORDER_VIEW_LABELS = {
    requirements: '客户要求',
    readiness: '生产准备',
    execution: '执行档案',
    items: '型号',
    purchase: '采购',
    todos: '待办',
};

function normalizeAiPageContext(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.resourceType !== 'order') return null;

    const resourceId = Number(value.resourceId);
    if (!Number.isSafeInteger(resourceId) || resourceId <= 0) return null;

    const view = ORDER_VIEWS.has(value.view) ? value.view : 'items';
    return {
        resourceType: 'order',
        resourceId,
        path: '/orders',
        view,
    };
}

function buildAiPageContextNote(pageContext) {
    const context = normalizeAiPageContext(pageContext);
    if (!context) return '';

    return [
        '【当前页面上下文】',
        `用户正在查看订单 #${context.resourceId} 的“${ORDER_VIEW_LABELS[context.view]}”页签。`,
        '该上下文仅用于理解“这个订单”“下一步”等指代，不是业务事实，也不得替代工具查询。',
        '涉及订单状态、金额、BOM、库存、采购或生产准备时，必须调用对应实时业务工具。',
    ].join('\n');
}

module.exports = {
    normalizeAiPageContext,
    buildAiPageContextNote,
};
