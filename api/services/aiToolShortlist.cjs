const { AI_TOOLS } = require('../routes/ai/tools.cjs');
const { getAiCapability } = require('../capabilities/registry.cjs');
const { ENTITY_DESCRIPTORS, TOOL_TARGETS } = require('./aiCapabilityGraphV3.cjs');

const DEFAULT_LOCAL_TOOL_LIMIT = 6;
const CROSS_DOMAIN_TOOL_LIMIT = 8;

const DOMAIN_SIGNALS = Object.freeze({
    business_history: ['修改记录', '变更记录', '操作记录', '审计', '谁改', '什么时候改'],
    management: ['看板', '经营', '概况', '待办', '异常', '预警', '工作流', '生产准备'],
    knowledge: ['知识', '用途', '专用', '用于', '用的', '适配', '兼容', '经验', '规则', 'business_rule', '为什么'],
    quality: ['数据质量', '完整性', '合规', '规则候选', '学习', '影响范围', '配置检查'],
    order: ['订单', '合同', '采购', '交付', '生产准备', '客户要求'],
    quotation: ['报价', '报价单', '询价', '客户', '成交'],
    file: ['文件', '附件', '归档', '资料关联'],
    recipe: ['配方', 'bom', '物料清单', '泵壳模板', '模板', '测试报告', '技术档案', '测试曲线'],
    cost: ['成本', '成本价', '差价', '价差', '试算', '估算', '铜价', '多少钱'],
    coil: ['线圈', '绕组', '铜线', '线径', '匝数', '片数', '槽眼'],
    catalog: ['零件', '配件', '库存', '缺货', '单价', '供应商', '物料'],
    drawing: ['转子图', '出图', '图纸', 'freecad', 'pdf'],
});

const TOOL_SIGNALS = Object.freeze({
    compare_recipes: ['对比', '比较', '差异', '差价', '价差'],
    get_recipe_technical_files: ['测试报告', '技术档案', '测试曲线', '附件'],
    preview_recipe_cost: ['配方成本', '产品成本', '成本是多少', '成本价', '试算'],
    preview_pump_shell_cost: ['泵壳成本', '模板成本', '套件成本'],
    calculate_coil_cost: ['线圈成本'],
    get_copper_price: ['铜价'],
    search_parts: ['零件', '配件', '库存', '缺货', '单价', '供应商'],
    get_purchase_overview: ['采购', '待采购'],
    search_quotations: ['报价', '报价单'],
    search_customer_history: ['客户历史', '历史报价', '现有报价', '全部报价'],
    search_customers: ['客户'],
    get_recent_orders: ['订单', '合同', '最近订单'],
    get_order_detail: ['订单详情', '订单明细'],
    search_coils: ['线圈', '绕组', '线径', '匝数', '片数'],
    search_templates: ['泵壳模板', '模板'],
    build_recipe_bom_draft: ['bom', '物料清单', '组装', '配置成本'],
    get_dashboard_summary: ['看板', '经营概况', '运营概况'],
    get_rotor_drawing_history: ['出图历史', '图纸历史'],
    search_factory_knowledge: ['知识', '用途', '专用', '适配', '兼容', '规则', 'business_rule'],
});

function enabled(env = process.env) {
    const value = String(env.AI_LOCAL_TOOL_SHORTLIST_ENABLED ?? 'true').trim().toLowerCase();
    return !['0', 'false', 'no', 'off'].includes(value);
}

function normalized(value) {
    return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

function occurrences(text, phrase) {
    if (!phrase || !text.includes(phrase)) return 0;
    return phrase.length >= 4 ? 3 : phrase.length >= 2 ? 2 : 1;
}

function inferredDomains(userText) {
    const text = normalized(userText);
    const scores = Object.entries(DOMAIN_SIGNALS).map(([domain, signals]) => ({
        domain,
        score: signals.reduce((total, signal) => total + occurrences(text, normalized(signal)), 0),
    })).filter(item => item.score > 0).sort((left, right) => right.score - left.score);
    if (!scores.length) return [];
    const strongest = scores[0].score;
    return scores.filter(item => item.score >= Math.max(2, strongest - 2)).map(item => item.domain);
}

function toolSearchText(tool) {
    const properties = Object.values(tool.function.parameters?.properties || {});
    return normalized([
        tool.function.name,
        tool.function.description,
        ...properties.map(item => item?.description),
    ].filter(Boolean).join(' '));
}

function textFragments(value) {
    const text = normalized(value);
    const fragments = new Set(text.match(/[a-z][a-z0-9_.-]{1,}|\d{2,}/giu) || []);
    for (const match of text.matchAll(/[\p{Script=Han}]{2,}/gu)) {
        const word = match[0];
        for (let index = 0; index < word.length - 1; index += 1) {
            fragments.add(word.slice(index, index + 2));
        }
    }
    return [...fragments];
}

function toolScore(tool, domains, userText) {
    const capability = getAiCapability(tool.function.name);
    const userFragments = textFragments(userText);
    const searchText = toolSearchText(tool);
    let score = capability.domains.reduce((total, domain) => (
        total + (domains.includes(domain) ? 12 : 0)
    ), 0);
    score += userFragments.reduce((total, fragment) => (
        total + (searchText.includes(fragment) ? 1 : 0)
    ), 0);
    score += (TOOL_SIGNALS[tool.function.name] || []).reduce((total, signal) => (
        total + occurrences(normalized(userText), normalized(signal)) * 6
    ), 0);
    if (/对比|比较|差异/u.test(userText) && tool.function.name === 'compare_recipes') score += 30;
    if (/报价/u.test(userText) && tool.function.name === 'search_quotations') score += 20;
    if (/客户.+(?:现有|全部|历史|最近).{0,6}报价/u.test(userText) && tool.function.name === 'search_customer_history') score += 45;
    if (
        (/(?:的壳|泵壳)/u.test(userText) || (/模板/u.test(userText) && !/(?:测试报告|技术档案|测试曲线)/u.test(userText)))
        && /(?:线圈|\d+\s*[-—~]\s*\d+|浮球|电缆|木箱|珍珠棉|包装)/u.test(userText)
        && tool.function.name === 'build_recipe_bom_draft'
    ) score += 40;
    if (capability.operation === 'preview' && /成本|试算|估算|差价|价差/u.test(userText)) score += 5;
    return score;
}

// ONT-P8R: relation reverse reads are offered on explicit demand only. They are planned by name by
// the ontology canary shortlist and remain in the full read catalogue used by cloud providers, but
// they must never enter the locally scored auto-shortlist: scoring is score-then-index ordered, so
// merely adding a new recipe-domain read tool silently displaces an existing entry under the
// `maxTools` cap and changes legacy local behaviour.
const EXPLICIT_ONLY_TOOL_NAMES = Object.freeze(new Set(['get_recipes_by_coil']));

function readTools() {
    return AI_TOOLS.filter(tool => {
        if (EXPLICIT_ONLY_TOOL_NAMES.has(tool.function.name)) return false;
        const capability = getAiCapability(tool.function.name);
        return capability?.access === 'read'
            && ['query', 'preview'].includes(capability.operation)
            && !capability.deprecated;
    });
}

function discoveryNameForTool(toolName) {
    const target = TOOL_TARGETS[toolName];
    return target?.outputIdField
        ? ENTITY_DESCRIPTORS[target.entityType]?.discoveryCapability
        : null;
}

function hasExplicitIdentifier(userText) {
    return /[a-z]+\d[\w.-]*|\d+[a-z][\w.-]*|\d{3,}/iu.test(userText);
}

function isCoilRecipeRelationQuery(userText) {
    return /(?:线圈|绕组).{0,16}(?:配方|产品)|(?:配方|产品).{0,16}(?:线圈|绕组)/u.test(userText);
}

function coilCostComparisonPairs(userText) {
    const text = String(userText || '');
    if (!/(?:成本|成本价|多少钱)/u.test(text) || !/(?:对比|比较|差价|价差|差异|与|和|跟|vs)/iu.test(text)) return [];
    if (/(?:配方|成品|产品|泵壳|模板)/u.test(text) && !/(?:线圈|绕组|定子)/u.test(text)) return [];
    const pairs = new Map();
    for (const match of text.matchAll(/(?:^|[^\d])(\d{1,3})\s*[-—~]\s*(\d{2,4})(?:\s*片)?(?!\d)/gu)) {
        const spec = String(Number(match[1]));
        const sheets = Number(match[2]);
        if (Number(spec) <= 0 || sheets <= 0) continue;
        pairs.set(`${spec}-${sheets}`, { spec, sheets });
    }
    return pairs.size === 2 ? [...pairs.values()] : [];
}

function selectLocalAssistantTools(userText, options = {}) {
    const allTools = options.tools || readTools();
    if (!enabled(options.env)) return allTools;
    if (coilCostComparisonPairs(userText).length === 2) {
        return ['calculate_coil_cost']
            .map(name => allTools.find(tool => tool.function.name === name))
            .filter(Boolean);
    }
    if (isCoilRecipeRelationQuery(userText)) {
        return ['get_all_recipes', 'search_coils']
            .map(name => allTools.find(tool => tool.function.name === name))
            .filter(Boolean);
    }
    const domains = inferredDomains(userText);
    if (!domains.length) {
        if (!hasExplicitIdentifier(userText)) return [];
        return ['get_all_recipes', 'search_parts', 'search_coils', 'search_templates']
            .map(name => allTools.find(tool => tool.function.name === name))
            .filter(Boolean);
    }
    const maxTools = Math.min(
        Number(options.maxTools) || (domains.length > 2 ? CROSS_DOMAIN_TOOL_LIMIT : DEFAULT_LOCAL_TOOL_LIMIT),
        allTools.length
    );
    const candidates = allTools
        .filter(tool => !EXPLICIT_ONLY_TOOL_NAMES.has(tool.function.name))
        .map((tool, index) => ({ tool, index, score: toolScore(tool, domains, userText) }))
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index);
    const minimumScore = Math.max(1, (candidates[0]?.score || 0) - 5);
    const selected = [];
    const add = tool => {
        if (tool && !selected.includes(tool)) selected.push(tool);
    };
    for (const candidate of candidates) {
        if (selected.length >= maxTools) break;
        if (candidate.score < minimumScore) break;
        add(candidate.tool);
        const discoveryName = discoveryNameForTool(candidate.tool.function.name);
        if (selected.length < maxTools && discoveryName && !hasExplicitIdentifier(userText)) {
            add(allTools.find(tool => tool.function.name === discoveryName));
        }
    }
    return selected.slice(0, maxTools);
}

function shouldUseLocalToolShortlist(env = process.env) {
    return enabled(env) && isLocalAssistantMode(env);
}

function isLocalAssistantMode(env = process.env) {
    return ['local', 'local-first'].includes(normalized(env.AI_PROVIDER));
}

module.exports = {
    CROSS_DOMAIN_TOOL_LIMIT,
    DEFAULT_LOCAL_TOOL_LIMIT,
    DOMAIN_SIGNALS,
    TOOL_SIGNALS,
    coilCostComparisonPairs,
    inferredDomains,
    isCoilRecipeRelationQuery,
    isLocalAssistantMode,
    selectLocalAssistantTools,
    shouldUseLocalToolShortlist,
};
