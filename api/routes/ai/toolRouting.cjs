const { AI_TOOLS, WRITE_TOOLS } = require('./tools.cjs');

const DEFAULT_MAX_TOOLS = 18;

const DOMAIN_TOOL_NAMES = Object.freeze({
    management: [
        'get_management_action_center',
        'plan_factory_workflow',
        'get_business_alerts',
        'get_dashboard_summary',
        'get_order_readiness_overview',
        'check_order_readiness',
        'plan_order_readiness_actions',
        'execute_order_readiness_action',
        'execute_factory_workflow_step',
    ],
    knowledge: [
        'search_factory_knowledge',
        'get_factory_knowledge_detail',
        'get_factory_knowledge_health',
        'sync_factory_knowledge',
        'get_order_knowledge_package',
    ],
    quality: [
        'get_data_quality_summary',
        'analyze_recipe_configuration',
        'get_factory_learning_health',
        'get_factory_rule_candidates',
        'get_factory_rule_impact',
        'get_factory_rule_compliance',
        'get_factory_rule_history',
        'set_recipe_analysis_feedback',
        'refresh_factory_rule_candidates',
        'review_factory_rule_candidate',
        'restore_factory_rule_event',
    ],
    order: [
        'get_order_detail',
        'get_recent_orders',
        'get_order_readiness_overview',
        'check_order_readiness',
        'plan_order_readiness_actions',
        'get_order_knowledge_package',
        'build_order_draft',
        'generate_purchase_list',
        'save_order_requirement_draft',
        'save_order_execution_draft',
        'create_order',
        'update_order_status',
        'add_recipe_to_order',
        'remove_recipe_from_order',
        'update_order_item',
        'delete_order',
        'execute_order_readiness_action',
    ],
    quotation: [
        'inspect_quotation_file',
        'build_quotation_draft',
        'search_customer_history',
        'preview_recipe_cost',
        'explain_cost_change',
        'build_order_draft',
        'plan_factory_workflow',
        'execute_factory_workflow_step',
    ],
    file: [
        'inspect_quotation_file',
        'search_factory_file_archive_targets',
        'archive_factory_file',
        'get_order_knowledge_package',
        'save_order_requirement_draft',
        'save_order_execution_draft',
    ],
    recipe: [
        'get_all_recipes',
        'build_recipe_bom_draft',
        'preview_recipe_cost',
        'preview_pump_shell_cost',
        'compare_recipes',
        'analyze_recipe_configuration',
        'create_recipe',
        'update_recipe',
        'delete_recipe',
    ],
    cost: [
        'preview_recipe_cost',
        'preview_pump_shell_cost',
        'full_calculate',
        'dynamic_config_cost',
        'calculate_coil_cost',
        'get_copper_price',
        'explain_cost_change',
        'compare_recipes',
        'build_recipe_bom_draft',
    ],
    coil: [
        'get_coil_specs',
        'calculate_coil_cost',
        'get_copper_price',
        'adjust_coil_stock',
        'search_factory_knowledge',
    ],
    catalog: [
        'search_parts',
        'create_part',
        'update_part',
        'delete_part',
        'batch_update_prices',
        'search_factory_knowledge',
    ],
    drawing: [
        'generate_rotor_drawing',
        'get_rotor_drawing_history',
        'print_rotor_drawing',
    ],
});

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
    ['catalog', /零件|配件|供应商|库存|调价/],
]);

const WRITE_INTENT_RE = /新增|新建|创建|录入|修改|更新|调整|删除|保存|归档|同步|入库|出库|增加|减少|调价|生成采购|下单|转(?:成|为)?订单|确认|忽略|特殊情况|批准|驳回|恢复|执行|打印/;
const BUSINESS_INTENT_RE = /成本|价格|零件|配件|配方|模板|泵壳|线圈|定子|转子|订单|报价|客户|采购|库存|知识|规则|文件|附件|图纸|质量|工厂|管理|供应商|铜价|BOM/i;

const LIVE_TOOL_NAMES = new Set([
    'full_calculate',
    'get_copper_price',
    'calculate_coil_cost',
    'get_coil_specs',
    'adjust_coil_stock',
    'get_all_recipes',
    'dynamic_config_cost',
    'get_recent_orders',
    'get_order_detail',
    'generate_purchase_list',
    'preview_recipe_cost',
    'preview_pump_shell_cost',
    'search_customer_history',
    'explain_cost_change',
    'get_data_quality_summary',
    'get_management_action_center',
    'get_business_alerts',
    'get_order_readiness_overview',
    'check_order_readiness',
    'get_dashboard_summary',
    'search_parts',
]);

const DERIVED_TOOL_NAMES = new Set([
    'build_recipe_bom_draft',
    'inspect_quotation_file',
    'build_quotation_draft',
    'build_order_draft',
    'analyze_recipe_configuration',
    'get_factory_learning_health',
    'get_factory_rule_candidates',
    'get_factory_rule_impact',
    'get_factory_rule_compliance',
    'get_factory_rule_history',
    'plan_factory_workflow',
    'plan_order_readiness_actions',
    'get_order_knowledge_package',
    'search_factory_knowledge',
    'get_factory_knowledge_detail',
    'get_factory_knowledge_health',
]);

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
        return [name, Object.freeze({
            name,
            domains: Object.freeze((TOOL_DOMAINS.get(name) || []).map(item => item.domain)),
            access: WRITE_TOOLS.has(name) ? 'write' : 'read',
            dataMode: LIVE_TOOL_NAMES.has(name)
                ? 'live'
                : DERIVED_TOOL_NAMES.has(name)
                    ? 'derived'
                    : 'stable',
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

function classifyAiToolDomains(messages = [], options = {}) {
    const text = latestUserText(messages);
    const domains = [];
    const add = domain => {
        if (DOMAIN_TOOL_NAMES[domain] && !domains.includes(domain)) domains.push(domain);
    };

    if (options.pageContext?.resourceType === 'order') add('order');
    for (const domain of domainsForToolNames([
        ...(options.requiredToolNames || []),
        ...(options.priorToolNames || []),
    ])) add(domain);
    for (const [domain, pattern] of DOMAIN_RULES) {
        if (pattern.test(text)) add(domain);
    }

    return {
        domains,
        text,
        writeIntent: WRITE_INTENT_RE.test(text),
        businessIntent: BUSINESS_INTENT_RE.test(text),
    };
}

function routeAiTools(messages = [], options = {}) {
    if (!routingEnabled(options.env)) {
        return {
            tools: AI_TOOLS,
            toolNames: AI_TOOLS.map(tool => tool.function.name),
            domains: ['all'],
            writeIntent: true,
            fallback: true,
            reason: 'routing_disabled',
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
