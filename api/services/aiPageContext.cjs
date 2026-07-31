const ORDER_VIEWS = new Set(['requirements', 'readiness', 'execution', 'items', 'purchase', 'todos']);
const ORDER_VIEW_LABELS = {
    requirements: '客户要求',
    readiness: '生产准备',
    execution: '执行档案',
    items: '型号',
    purchase: '采购',
    todos: '待办',
};

const EXPLICIT_ORDER_ID_RE = /订单\s*[#＃]?\s*(\d+)/;
const MULTI_ORDER_RE = /哪些订单|所有订单|全部订单|订单准备总览|订单生产准备总览|不能生产的订单|可以生产的订单|多少订单|订单.*(?:汇总|总览)/;
const ORDER_CONTEXT_INTENT_RE = /这个订单|该订单|当前订单|这笔订单|本订单|它|这个|订单|客户要求|附件|文件|包装|标识|交期|生产|齐料|缺料|采购|到货|入库|成本|金额|状态|进度|处理|下一步|先做什么|怎么解决|型号|待办|供应商|调整|异常|质量|交付|追溯|历史/;
const OTHER_RESOURCE_RE = /配方|零件|客户|报价|线圈|模板|知识库|图纸|测试报告/;
const EXPLICIT_ORDER_INTENT_RE = /订单|客户要求|附件|文件|包装|标识|交期|生产|齐料|缺料|采购|到货|入库|待办/;

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

function resolveMessagesWithPageContext(messages = [], pageContext) {
    const context = normalizeAiPageContext(pageContext);
    if (!context || !Array.isArray(messages)) return messages;

    const latestUserIndex = messages.findLastIndex(
        message => message?.role === 'user' && typeof message.content === 'string'
    );
    if (latestUserIndex < 0) return messages;

    const text = messages[latestUserIndex].content.trim();
    if (
        !text
        || EXPLICIT_ORDER_ID_RE.test(text)
        || MULTI_ORDER_RE.test(text)
        || !ORDER_CONTEXT_INTENT_RE.test(text)
        || (OTHER_RESOURCE_RE.test(text) && !EXPLICIT_ORDER_INTENT_RE.test(text))
    ) {
        return messages;
    }

    const resolved = messages.map(message => ({ ...message }));
    resolved[latestUserIndex].content = `${text} 订单 #${context.resourceId}`;
    return resolved;
}

module.exports = {
    normalizeAiPageContext,
    buildAiPageContextNote,
    resolveMessagesWithPageContext,
};
