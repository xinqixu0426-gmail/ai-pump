const FACT_FIELD_RE = /价格|单价|成本|库存|铜价|铝价|汇率|状态|进度|金额|利润|报价|订单|供应商|客户|配方|零件|线圈|模板|质量问题|业务规则/;
const LOOKUP_INTENT_RE = /多少|几个|什么|是否|有没有|哪(?:个|些)?|查(?:一下|询)?|搜索|显示|列出|给我|告诉我|当前|现在|最新|情况|详情|数据|信息|为何|为什么|怎么回事/;

/**
 * Dynamic factory data may have changed since an earlier conversation turn.
 * Force the model to consult at least one tool before answering these queries.
 */
function requiresFreshToolLookup(messages = []) {
    const text = latestUserText(messages);

    return Boolean(text && FACT_FIELD_RE.test(text) && LOOKUP_INTENT_RE.test(text));
}

function latestUserText(messages = []) {
    const latestUserMessage = [...(Array.isArray(messages) ? messages : [])]
        .reverse()
        .find(message => message?.role === 'user' && typeof message.content === 'string');
    return latestUserMessage?.content?.trim() || '';
}

function freshLookupQuery(text) {
    const cleaned = String(text || '')
        .replace(/[？?！!。，,：:；;“”"']/g, ' ')
        .replace(/请|帮我|麻烦|查一下|查询|搜索|显示|列出|给我|告诉我|看一下|当前|现在|最新/g, ' ')
        .replace(/价格|单价|成本|库存|状态|进度|金额|利润|报价|供应商|详情|数据|信息/g, ' ')
        .replace(/是多少|有多少|多少|怎么样|什么情况|为何|为什么|怎么回事/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || String(text || '').trim();
}

function buildFreshLookupToolCalls(messages = []) {
    if (!requiresFreshToolLookup(messages)) return [];

    const text = latestUserText(messages);
    const query = freshLookupQuery(text);
    const calls = [{ name: 'search_factory_knowledge', args: { query, limit: 10 } }];

    if (/(价格|单价|库存|供应商|零件)/.test(text) || (/(成本)/.test(text) && !/(配方|订单|报价)/.test(text))) {
        calls.push({ name: 'search_parts', args: { keyword: query } });
    }
    if (/铜价/.test(text)) calls.push({ name: 'get_copper_price', args: {} });

    const orderId = text.match(/订单\s*[#＃]?\s*(\d+)/)?.[1];
    if (/订单/.test(text)) {
        calls.push(orderId
            ? { name: 'get_order_detail', args: { orderId: Number(orderId) } }
            : { name: 'get_recent_orders', args: { limit: 10 } });
    }

    return calls;
}

module.exports = { requiresFreshToolLookup, buildFreshLookupToolCalls };
