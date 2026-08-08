const { AI_TOOLS } = require('../routes/ai/tools.cjs');
const {
    getAiCapability,
    listAiCapabilities,
} = require('../capabilities/registry.cjs');

const DEFAULT_MAX_OFFERED_TOOLS = 18;
const TOOL_BY_NAME = new Map(AI_TOOLS.map(tool => [tool.function.name, tool]));

function getAiToolDefinition(name) {
    return TOOL_BY_NAME.get(String(name || '')) || null;
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
                operation: capability.operation,
                access: capability.access,
                description,
            };
        });
}

function buildPlannerDirectoryPrompt() {
    const groups = new Map();
    for (const item of plannerCapabilityDirectory()) {
        const domain = item.domains[0] || 'general';
        if (!groups.has(domain)) groups.set(domain, []);
        groups.get(domain).push(item);
    }
    return [...groups.entries()].map(([domain, items]) => [
        `[${domain}]`,
        ...items.map(item => (
            `- ${item.name} | ${item.operation} | ${item.description}`
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
    buildPlannerDirectoryPrompt,
    getAiToolDefinition,
    plannedCapabilityNames,
    plannerCapabilityDirectory,
    selectToolsForIntent,
};
