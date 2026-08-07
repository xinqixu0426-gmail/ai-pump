const { AI_TOOLS, WRITE_TOOLS } = require('./tools.cjs');
const {
    DOMAIN_CAPABILITY_NAMES,
    getAiCapability,
} = require('../../capabilities/registry.cjs');
const {
    hasInventoryWriteIntent,
} = require('../../services/aiFreshness.cjs');

const DEFAULT_MAX_TOOLS = 18;

const DOMAIN_TOOL_NAMES = DOMAIN_CAPABILITY_NAMES;

const GENERAL_TOOL_NAMES = Object.freeze([
    'search_factory_knowledge',
    'search_parts',
    'preview_recipe_cost',
    'get_recent_orders',
    'get_management_action_center',
    'get_dashboard_summary',
    'get_factory_knowledge_health',
    'get_data_quality_summary',
]);

const DOMAIN_RULES = Object.freeze([
    ['management', /管理待办|待办中心|今日待办|今天.*(?:先做|处理)|优先事项|处理进展|执行计划|工作流|工厂.*(?:风险|异常)/],
    ['drawing', /转子.*(?:出图|图纸|打印)|出图|打印.*图|上一张图|出图记录/],
    ['file', /上传|附件|PDF|Excel|CSV|表格|图片|OCR|文件|归档|报价单|测试报告|技术档案/],
    ['knowledge', /知识库|知识条目|知识检索|同步知识|知识健康|回答依据|业务规则|工厂经验|术语|俗称|用途|适用|专用|切割|用的.*(?:泵壳|配件|零件|型号)/],
    ['quality', /智能检查|数据质量|质量问题|配置.*(?:合理|错误)|漏项|相似配方|异常价格|候选规则|经验规则|学习规则|规则.*(?:审核|批准|驳回|影响|合规|历史)|置信度/],
    ['quotation', /报价|客户|利润率|转订单/],
    ['order', /订单|生产准备|齐料|缺料|采购|到货|交付|执行档案|客户要求|合同/],
    ['coil', /线圈|定子|漆包线|片数|铜价|转子成本|\d+\s*[-－×xX*]\s*\d+/],
    ['cost', /成本|价格|单价|金额|利润|铜价|试算|估算|多少钱|涨价|降价/],
    ['recipe', /配方|泵壳模板|模板|泵壳|BOM|机筒|桶长|配置/],
    ['catalog', /零件|配件|供应商|库存|调价|电缆|电源线|轴承|油封|密封|叶轮|电容|泵体|泵盖|机筒/],
]);

const WRITE_INTENT_RE = /新增|新建|创建|录入|写入|提交|导入|修改(?!记录|历史|日志|时间|人|情况)|更新(?!记录|历史|日志|时间|情况)|调整(?!记录|历史|日志|时间|情况)|改为|改成|设为|设置为|变更为|删除|保存|归档|同步|入库|出库|增加|减少|调价|生成采购|生成.{0,12}图纸|出图|下单|转(?:成|为)?订单|确认|忽略|特殊情况|批准|驳回|恢复|执行|打印/;
const NEGATED_WRITE_PREFIX_RE = /(?:不要|无需|不用|不需要|禁止|不能|不得|避免|请勿|尚未|还没|没有).{0,10}$/;
const BUSINESS_INTENT_RE = /成本|价格|零件|配件|配方|模板|泵壳|线圈|定子|转子|订单|报价|客户|采购|库存|知识|规则|文件|附件|图纸|质量|工厂|管理|供应商|铜价|电缆|电源线|轴承|油封|密封|叶轮|电容|BOM/i;
const READ_INTENT_RE = /查(?:一下|询)?|查看|读取|搜索|列出|显示|明细|详情|多少|什么|哪些|是否|有没有|现有|现在|当前|为什么|怎么|分析|对比|检查/;
const WRITE_FOLLOW_UP_RE = /^(?:是|好|好的|确定|确认(?:录入|执行|提交)?|全部\s*(?:ok|OK|正确|没问题)|可以|同意|按(?:这个|上面|清单|这些).*(?:执行|录入|提交)?|就这样|继续(?:执行|录入)?|执行|提交)[。！!\s]*$/;
const WRITE_DETAILS_RE = /型号|规格|单价|价格|类别|供应商|数量|备注|材质|片数|槽眼|客户|交期/;

const TOOL_BY_NAME = new Map(AI_TOOLS.map(tool => [tool.function.name, tool]));
const TOOL_DOMAINS = new Map();

for (const [domain, names] of Object.entries(DOMAIN_TOOL_NAMES)) {
    names.forEach((name, index) => {
        const current = TOOL_DOMAINS.get(name) || [];
        current.push({ domain, rank: index });
        TOOL_DOMAINS.set(name, current);
    });
}

const AI_TOOL_METADATA = Object.freeze(Object.fromEntries(
    AI_TOOLS.map(tool => {
        const name = tool.function.name;
        const capability = getAiCapability(name);
        return [name, Object.freeze({
            name,
            capabilityId: capability.capabilityId,
            domains: capability.domains,
            access: capability.access,
            dataMode: capability.dataMode,
            riskLevel: capability.riskLevel,
            requiresConfirmation: capability.requiresConfirmation,
        })];
    })
));

function latestUserText(messages = []) {
    const latest = [...(Array.isArray(messages) ? messages : [])]
        .reverse()
        .find(message => message?.role === 'user' && typeof message.content === 'string');
    return latest?.content?.trim() || '';
}

function routingEnabled(env = process.env) {
    return !['0', 'false', 'off', 'no'].includes(
        String(env.AI_DYNAMIC_TOOL_ROUTING_ENABLED || '').trim().toLowerCase()
    );
}

function domainsForToolNames(names = []) {
    const domains = [];
    for (const name of names) {
        for (const item of TOOL_DOMAINS.get(name) || []) {
            if (!domains.includes(item.domain)) domains.push(item.domain);
        }
    }
    return domains;
}

function domainsForText(text = '') {
    const domains = [];
    for (const [domain, pattern] of DOMAIN_RULES) {
        if (pattern.test(text) && !domains.includes(domain)) domains.push(domain);
    }
    return domains;
}

function hasWriteIntent(text = '') {
    if (hasInventoryWriteIntent(text)) return true;
    const matches = String(text || '').matchAll(new RegExp(WRITE_INTENT_RE.source, 'g'));
    for (const match of matches) {
        const prefix = String(text || '').slice(Math.max(0, match.index - 16), match.index);
        if (!NEGATED_WRITE_PREFIX_RE.test(prefix)) return true;
    }
    return false;
}

function recentWriteContext(messages = [], currentText = '', currentDomains = []) {
    const userTexts = (Array.isArray(messages) ? messages : [])
        .filter(message => message?.role === 'user' && typeof message.content === 'string')
        .map(message => message.content.trim())
        .filter(Boolean);
    if (userTexts[userTexts.length - 1] === currentText) userTexts.pop();
    for (const text of userTexts.reverse().slice(0, 5)) {
        if (READ_INTENT_RE.test(text)) return null;
        if (!hasWriteIntent(text)) continue;
        const domains = domainsForText(text);
        if (domains.length === 0) continue;
        if (
            currentDomains.length === 0
            || domains.some(domain => currentDomains.includes(domain))
        ) {
            return { text, domains };
        }
    }
    return null;
}

function classifyAiToolDomains(messages = [], options = {}) {
    const text = latestUserText(messages);
    const domains = [];
    const add = domain => {
        if (DOMAIN_TOOL_NAMES[domain] && !domains.includes(domain)) domains.push(domain);
    };

    if (options.pageContext?.resourceType === 'order') add('order');
    for (const domain of domainsForText(text)) add(domain);
    if (domains.length === 0) {
        for (const domain of domainsForToolNames([
            ...(options.requiredToolNames || []),
            ...(options.priorToolNames || []),
        ])) add(domain);
    }

    const currentWriteIntent = hasWriteIntent(text);
    let writeIntent = currentWriteIntent;
    let writeIntentSource = currentWriteIntent ? 'current' : 'none';
    const shouldInheritWriteContext = (
        WRITE_FOLLOW_UP_RE.test(text)
        || (!writeIntent && WRITE_DETAILS_RE.test(text) && !READ_INTENT_RE.test(text))
        || (writeIntent && domains.length === 0)
    );
    if (shouldInheritWriteContext) {
        const priorWrite = recentWriteContext(messages, text, domains);
        if (priorWrite) {
            writeIntent = true;
            writeIntentSource = 'history';
            if (domains.length === 0) priorWrite.domains.forEach(add);
        }
    }

    return {
        domains,
        text,
        writeIntent,
        writeIntentSource,
        businessIntent: BUSINESS_INTENT_RE.test(text),
    };
}

function routeAiTools(messages = [], options = {}) {
    if (!routingEnabled(options.env)) {
        const classified = classifyAiToolDomains(messages, options);
        const tools = AI_TOOLS.filter(tool => (
            !WRITE_TOOLS.has(tool.function.name) || classified.writeIntent
        ));
        return {
            tools,
            toolNames: tools.map(tool => tool.function.name),
            domains: classified.domains.length > 0 ? classified.domains : ['all'],
            writeIntent: classified.writeIntent,
            writeIntentSource: classified.writeIntentSource,
            businessIntent: classified.businessIntent,
            fallback: true,
            reason: 'routing_disabled_safe_allowlist',
        };
    }

    const requiredToolNames = [...new Set(options.requiredToolNames || [])]
        .filter(name => TOOL_BY_NAME.has(name));
    const priorToolNames = [...new Set(options.priorToolNames || [])]
        .filter(name => TOOL_BY_NAME.has(name));
    const classified = classifyAiToolDomains(messages, {
        ...options,
        requiredToolNames,
        priorToolNames,
    });
    const useGeneralFallback = classified.domains.length === 0 && classified.businessIntent;
    if (classified.domains.length === 0 && !useGeneralFallback && requiredToolNames.length === 0) {
        return {
            tools: [],
            toolNames: [],
            domains: [],
            writeIntent: false,
            writeIntentSource: 'none',
            businessIntent: false,
            fallback: false,
            reason: 'casual_conversation',
        };
    }

    const candidates = new Map();
    const addCandidate = (name, rank, required = false) => {
        if (!TOOL_BY_NAME.has(name)) return;
        if (WRITE_TOOLS.has(name) && !classified.writeIntent && !required) return;
        const current = candidates.get(name);
        if (current === undefined || rank < current) candidates.set(name, rank);
    };

    requiredToolNames.forEach((name, index) => addCandidate(name, -2000 + index, true));
    priorToolNames.forEach((name, index) => addCandidate(name, -1000 + index, true));

    classified.domains.forEach((domain, domainIndex) => {
        DOMAIN_TOOL_NAMES[domain].forEach((name, toolIndex) => {
            addCandidate(name, domainIndex * 100 + toolIndex);
        });
    });
    if (useGeneralFallback) {
        GENERAL_TOOL_NAMES.forEach((name, index) => addCandidate(name, 500 + index));
    }

    const maxTools = Math.min(
        Math.max(Number(options.maxTools) || DEFAULT_MAX_TOOLS, 1),
        AI_TOOLS.length
    );
    const toolNames = [...candidates.entries()]
        .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
        .slice(0, maxTools)
        .map(([name]) => name);

    return {
        tools: toolNames.map(name => TOOL_BY_NAME.get(name)),
        toolNames,
        domains: classified.domains,
        writeIntent: classified.writeIntent,
        writeIntentSource: classified.writeIntentSource,
        businessIntent: classified.businessIntent,
        fallback: useGeneralFallback,
        reason: useGeneralFallback ? 'general_business_fallback' : 'matched_domains',
    };
}

module.exports = {
    AI_TOOL_METADATA,
    DEFAULT_MAX_TOOLS,
    DOMAIN_TOOL_NAMES,
    GENERAL_TOOL_NAMES,
    classifyAiToolDomains,
    routeAiTools,
    routingEnabled,
};
