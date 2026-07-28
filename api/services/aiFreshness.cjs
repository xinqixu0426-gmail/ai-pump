const FACT_FIELD_RE = /价格|单价|成本|库存|铜价|铝价|汇率|状态|进度|金额|利润|报价|订单|供应商|客户|配方|零件|线圈|模板|质量问题|业务规则/;
const LOOKUP_INTENT_RE = /多少|几个|什么|是否|有没有|哪(?:个|些)?|查(?:一下|询)?|搜索|显示|列出|给我|告诉我|当前|现在|最新|情况|详情|数据|信息|汇总|总览|为何|为什么|怎么回事|怎么处理|如何处理|处理方案|解决方案|下一步|先做什么|怎么解决|如何解决|执行.*(?:步骤|方案)|处理第[一二三四五六七八九十\d]+步/;

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

function coilSpecSheetKey(text) {
    const match = String(text || '').match(/(?:^|[^\d])(\d+)\s*[-－]\s*(\d+)(?:[^\d]|$)/);
    return match ? `${match[1]}-${match[2]}` : '';
}

function buildFreshLookupToolCalls(messages = []) {
    if (!requiresFreshToolLookup(messages)) return [];

    const text = latestUserText(messages);
    const coilKey = /线圈/.test(text) ? coilSpecSheetKey(text) : '';
    const query = coilKey || freshLookupQuery(text);
    const calls = [{
        name: 'search_factory_knowledge',
        args: { query, ...(coilKey ? { entryType: 'coil' } : {}), limit: 10 },
    }];

    if (/(价格|单价|库存|供应商|零件)/.test(text) || (/(成本)/.test(text) && !/(配方|订单|报价)/.test(text))) {
        calls.push({ name: 'search_parts', args: { keyword: query } });
    }
    if (/铜价/.test(text)) calls.push({ name: 'get_copper_price', args: {} });

    const orderId = text.match(/订单\s*[#＃]?\s*(\d+)/)?.[1];
    if (/订单/.test(text)) {
        const readinessIntent = /能不能生产|是否能生产|可以生产|可否生产|不能生产|生产准备|是否齐料|齐料了吗|还缺什么|缺(?:哪|哪些)?料/.test(text);
        const readinessPlanIntent = /怎么处理|如何处理|处理方案|解决方案|下一步|先做什么|怎么解决|如何解决|执行.*(?:步骤|方案)|处理第[一二三四五六七八九十\d]+步/.test(text);
        const readinessOverviewIntent = /哪些订单|所有订单|全部订单|订单准备总览|订单生产准备总览|不能生产的订单|可以生产的订单|多少订单.*(?:缺料|能生产|不能生产)|订单.*(?:汇总|总览)/.test(text);
        calls.push(!orderId && readinessOverviewIntent
            ? { name: 'get_order_readiness_overview', args: {} }
            : orderId && readinessPlanIntent
            ? { name: 'plan_order_readiness_actions', args: { orderId: Number(orderId) } }
            : orderId && readinessIntent
                ? { name: 'check_order_readiness', args: { orderId: Number(orderId) } }
            : orderId
                ? { name: 'get_order_detail', args: { orderId: Number(orderId) } }
                : { name: 'get_recent_orders', args: { limit: 10 } });
    }

    return calls;
}

module.exports = { requiresFreshToolLookup, buildFreshLookupToolCalls, coilSpecSheetKey };
