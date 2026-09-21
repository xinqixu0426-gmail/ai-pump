const TASK_ENVELOPE_VERSION = 1;

const PRESENTATION_PRIORITY = Object.freeze({
    conversation: 0,
    generic_query: 1,
    cost_summary: 2,
    knowledge_rule: 3,
    configured_bom_cost: 4,
});

function text(value) {
    return String(value ?? '').trim();
}

function appendUnique(items, value, identity) {
    const key = identity(value);
    if (!key || items.some(item => identity(item) === key)) return items;
    return [...items, value];
}

function presentationForTool(toolName, capability = {}) {
    if (toolName === 'build_recipe_bom_draft') return 'configured_bom_cost';
    if (toolName === 'search_factory_knowledge') return 'knowledge_rule';
    if (capability.operation === 'preview' || /cost|price|quotation/i.test(toolName)) return 'cost_summary';
    return 'generic_query';
}

function higherPriorityPresentation(current, candidate) {
    return (PRESENTATION_PRIORITY[candidate] || 0) > (PRESENTATION_PRIORITY[current] || 0)
        ? candidate
        : current;
}

function createTaskEnvelope(userText) {
    return {
        version: TASK_ENVELOPE_VERSION,
        mode: 'conversation',
        userGoal: text(userText).slice(0, 2000),
        steps: [],
        requiredOutputs: [],
        missingInputs: [],
        presentation: 'conversation',
    };
}

function configuredBomRequirements(args = {}) {
    const requirements = [{ key: 'totalCost' }];
    if (text(args.shellModel)) requirements.push({ key: 'templateModel', value: text(args.shellModel) });
    if (text(args.coilSpec) && Number.isFinite(Number(args.coilSheets))) {
        requirements.push({ key: 'coilModel', value: `${text(args.coilSpec)}-${Number(args.coilSheets)}` });
    }
    if (args.hasFloat === true || args.hasFloat === false) {
        requirements.push({ key: 'hasFloat', value: Boolean(args.hasFloat) });
    }
    const packingParts = Array.isArray(args.packingParts) ? args.packingParts : [];
    for (const part of packingParts) {
        const model = text(part?.model);
        if (model) requirements.push({ key: 'packingModel', value: model });
    }
    return requirements;
}

function knowledgeRequirements(userText) {
    const requirements = [{ key: 'authoritativeRule' }];
    if (/成品电缆/u.test(userText)) requirements.push({ key: 'completeCable' });
    if (/拆|收费项目|计费项目/u.test(userText)) requirements.push({ key: 'splitConclusion' });
    return requirements;
}

function requirementsForStep(task, toolName, args) {
    if (toolName === 'build_recipe_bom_draft') return configuredBomRequirements(args);
    if (toolName === 'search_factory_knowledge') return knowledgeRequirements(task.userGoal);
    return [];
}

function addTaskStep(task, toolName, args = {}, capability = {}) {
    const step = {
        capability: text(capability.capabilityId) || toolName,
        toolName,
        domain: text(capability.domain) || 'unknown',
        operation: text(capability.operation) || 'query',
        arguments: args,
    };
    const steps = appendUnique(task.steps, step, item => `${item.toolName}:${JSON.stringify(item.arguments)}`);
    let requiredOutputs = task.requiredOutputs;
    for (const requirement of requirementsForStep(task, toolName, args)) {
        requiredOutputs = appendUnique(
            requiredOutputs,
            requirement,
            item => `${item.key}:${JSON.stringify(item.value ?? null)}`
        );
    }
    const presentation = presentationForTool(toolName, capability);
    return {
        ...task,
        mode: 'business',
        steps,
        requiredOutputs,
        presentation: higherPriorityPresentation(task.presentation, presentation),
    };
}

module.exports = {
    TASK_ENVELOPE_VERSION,
    addTaskStep,
    createTaskEnvelope,
    presentationForTool,
};
