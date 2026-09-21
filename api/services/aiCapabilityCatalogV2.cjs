const { AI_TOOLS } = require('../routes/ai/tools.cjs');
const {
    getAiCapability,
    listAiCapabilities,
} = require('../capabilities/registry.cjs');

const DEFAULT_MAX_OFFERED_TOOLS = 18;
const DEFAULT_MAX_PLANNER_CAPABILITIES = 64;
const TOOL_BY_NAME = new Map(AI_TOOLS.map(tool => [tool.function.name, tool]));
const DOMAIN_DIRECTORY = Object.freeze({
    business_history: '跨业务修改记录、修改时间、原因和关联对象',
    management: '经营总览、管理待办、跨业务风险和流程规划',
    knowledge: '工厂经验、用途、兼容性、规则依据和独立资料',
    quality: '跨记录的数据质量、配置完整性、规则学习、合规和影响分析；不读取某个具体配方的附件',
    order: '真实客户订单、合同、采购、生产准备、订单需求/执行知识包和订单状态；不读取成品型号对应的配方技术附件或性能测试报告',
    quotation: '真实客户、报价单、报价文件以及可按报价或订单选择范围的客户历史；不用于解释一般计费概念或业务规则',
    file: '独立工厂文件、附件归档目标和文件内容核对；不代替配方技术档案',
    recipe: '成品配方、BOM、泵壳模板、配方详情以及指定配方的技术附件、性能测试报告、测试曲线和逐条测试点',
    cost: '正式数值成本、铜价、成本差异和成本预览；不代替零件库当前单价，也不用于只解释计费业务规则',
    coil: '线圈档案、规格、绕组数据和线圈成本',
    catalog: '独立零件、零件库当前单价、库存、目录对象和模板目录；单个零件价格不是配方成本试算',
    drawing: '转子 PDF 图纸及出图任务历史；不读取配方性能测试报告、测试曲线或测试点',
});

function getAiToolDefinition(name) {
    return TOOL_BY_NAME.get(String(name || '')) || null;
}

function requiredInputSummary(parameters = {}) {
    const direct = Array.isArray(parameters.required) ? parameters.required : [];
    const alternatives = [...(parameters.oneOf || []), ...(parameters.anyOf || [])]
        .map(option => Array.isArray(option?.required) ? option.required : [])
        .filter(fields => fields.length > 0);
    const parts = [];
    if (direct.length > 0) parts.push(direct.join('+'));
    if (alternatives.length > 0) {
        parts.push(alternatives.map(fields => fields.join('+')).join('|'));
    }
    return parts.length > 0 ? parts.join(';') : 'none';
}

function plannerCapabilityDirectory() {
    return listAiCapabilities()
        .map(capability => {
            const tool = getAiToolDefinition(capability.toolName);
            const description = String(tool?.function?.description || capability.displayName)
                .replace(/\s+/g, ' ')
                .trim();
            return {
                name: capability.toolName,
                label: capability.displayName,
                domains: capability.domains,
                entityScopes: capability.entityScopes,
                operation: capability.operation,
                access: capability.access,
                description,
                requiredInputs: requiredInputSummary(tool?.function?.parameters),
            };
        });
}

function buildDomainDirectoryPrompt() {
    return Object.entries(DOMAIN_DIRECTORY)
        .map(([domain, description]) => `- ${domain}: ${description}`)
        .join('\n');
}

function orderedPlannerCapabilities(options = {}) {
    const selectedDomains = new Set(options.domains || []);
    const mode = options.mode || 'query';
    const entityScope = options.entityScope || 'none';
    const intent = { mode, entityScope };
    const inSelectedDomain = capability => (
        capability.domains.some(domain => selectedDomains.has(domain))
    );
    return plannerCapabilityDirectory()
        .map(item => ({ item, capability: getAiCapability(item.name) }))
        .filter(({ capability }) => capabilityAllowedForIntent(capability, intent))
        .filter(({ capability }) => (
            mode !== 'command' || selectedDomains.size === 0 || inSelectedDomain(capability)
        ))
        .sort((left, right) => (
            Number(inSelectedDomain(right.capability)) - Number(inSelectedDomain(left.capability))
        ))
        .map(({ item }) => item);
}

function buildPlannerDirectoryPrompt(options = {}) {
    const maxCapabilities = Math.max(
        1,
        Math.min(Number(options.maxCapabilities) || DEFAULT_MAX_PLANNER_CAPABILITIES, AI_TOOLS.length)
    );
    const groups = new Map();
    const directory = orderedPlannerCapabilities(options).slice(0, maxCapabilities);
    for (const item of directory) {
        const domain = item.domains[0] || 'general';
        if (!groups.has(domain)) groups.set(domain, []);
        groups.get(domain).push(item);
    }
    return [...groups.entries()].map(([domain, items]) => [
        `[${domain}]`,
        ...items.map(item => (
            `- ${item.name} | ${item.operation} | scope=${item.entityScopes.join('/')} | requires=${item.requiredInputs} | ${item.description}`
        )),
    ].join('\n')).join('\n');
}

function plannedCapabilityNames(intent = {}) {
    return [...new Set((intent.steps || [])
        .map(step => String(step?.capabilityName || '').trim())
        .filter(name => TOOL_BY_NAME.has(name)))];
}

function capabilityAllowedForIntent(capability, intent = {}) {
    if (!capability || intent.mode === 'conversation') return false;
    if (intent.mode !== 'command' && capability.access === 'write') return false;
    if (
        intent.entityScope
        && intent.entityScope !== 'none'
        && !capability.entityScopes.includes(intent.entityScope)
    ) return false;
    return true;
}

function selectToolsForIntent(intent = {}, options = {}) {
    const maxTools = Math.min(
        Math.max(Number(options.maxTools) || DEFAULT_MAX_OFFERED_TOOLS, 1),
        AI_TOOLS.length
    );
    const selectedDomains = new Set(intent.domains || []);
    const plannedNames = plannedCapabilityNames(intent);
    const names = [];
    const add = name => {
        if (names.includes(name)) return;
        const capability = getAiCapability(name);
        if (!capabilityAllowedForIntent(capability, intent)) return;
        names.push(name);
    };

    plannedNames.forEach(add);
    for (const capability of listAiCapabilities()) {
        if (names.length >= maxTools) break;
        if (!capability.domains.some(domain => selectedDomains.has(domain))) continue;
        add(capability.toolName);
    }

    return names.slice(0, maxTools).map(name => TOOL_BY_NAME.get(name));
}

module.exports = {
    DEFAULT_MAX_OFFERED_TOOLS,
    DEFAULT_MAX_PLANNER_CAPABILITIES,
    buildDomainDirectoryPrompt,
    buildPlannerDirectoryPrompt,
    getAiToolDefinition,
    plannedCapabilityNames,
    plannerCapabilityDirectory,
    orderedPlannerCapabilities,
    requiredInputSummary,
    selectToolsForIntent,
};
