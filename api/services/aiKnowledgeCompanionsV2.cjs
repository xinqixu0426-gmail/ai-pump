const {
    getAiCapability,
    hasAiKnowledgeCompanionProjection,
} = require('../capabilities/registry.cjs');
const { normalizeAiTurnStateV3 } = require('./aiTurnStateV3.cjs');

function projectKnowledgeCompanionArgs(companion, args = {}, result = {}) {
    if (!companion) return null;
    switch (companion.argumentProjection) {
        case 'order_target':
            if (args.orderId !== undefined) return { orderId: args.orderId };
            if (args.orderQuery !== undefined) return { orderQuery: args.orderQuery };
            return null;
        case 'single_order_result': {
            const hasNamedFilter = String(args.customerName || '').trim()
                || String(args.contractNo || '').trim();
            const rows = Array.isArray(result.data) ? result.data : [];
            const orderId = Number(rows[0]?.id);
            if (
                !hasNamedFilter
                || Number(result.count) !== 1
                || rows.length !== 1
                || !Number.isInteger(orderId)
                || orderId <= 0
            ) return null;
            return { orderId };
        }
        default:
            return null;
    }
}

function getKnowledgeCompanionCall(toolName, args = {}, result = {}) {
    const sourceCapability = getAiCapability(toolName);
    const companion = sourceCapability?.knowledgeCompanion;
    if (!companion) return null;
    const targetCapability = getAiCapability(companion.capabilityName);
    if (!targetCapability || targetCapability.access !== 'read') return null;
    const projectedArgs = projectKnowledgeCompanionArgs(companion, args, result);
    if (!projectedArgs) return null;
    return Object.freeze({
        sourceCapabilityName: sourceCapability.toolName,
        capabilityName: targetCapability.toolName,
        args: Object.freeze(projectedArgs),
    });
}

function uniqueText(values = []) {
    const candidates = [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
    return candidates.length === 1 ? candidates[0] : '';
}

function resolvedOrderQueryCandidate(turnState) {
    const state = normalizeAiTurnStateV3(turnState);
    const orderQuery = uniqueText((state?.resolvedEntities || [])
        .filter(entity => entity.entityType === 'order')
        .map(entity => entity.name));
    if (orderQuery) return orderQuery;

    const hasVerifiedOrderKnowledgeReference = (state?.capabilities || []).some(name => (
        hasAiKnowledgeCompanionProjection(name, 'order_target')
    ));
    if (!hasVerifiedOrderKnowledgeReference) return '';
    return uniqueText((state?.resolvedEntities || [])
        .filter(entity => entity.entityType === 'customer')
        .map(entity => entity.name));
}

function resolvedOrderQueryForId(turnState, orderId) {
    const expectedId = Number(orderId);
    if (!Number.isSafeInteger(expectedId) || expectedId <= 0) return '';
    const state = normalizeAiTurnStateV3(turnState);
    return uniqueText((state?.resolvedEntities || [])
        .filter(entity => entity.entityType === 'order' && entity.id === expectedId)
        .map(entity => entity.name));
}

function normalizeKnowledgeCompanionToolCalls(toolCalls = [], options = {}) {
    const plannedCapabilityName = String(options.plannedCapabilityName || '').trim();
    const plannedCapability = getAiCapability(plannedCapabilityName);
    const plannedCompanion = plannedCapability?.knowledgeCompanion;
    const companionCanSubstitute = plannedCompanion?.argumentProjection === 'order_target';
    const previousOrderQuery = resolvedOrderQueryCandidate(options.turnState);

    return (Array.isArray(toolCalls) ? toolCalls : []).map(toolCall => {
        const calledName = String(toolCall?.function?.name || '').trim();
        const isRegisteredCompanionAlias = companionCanSubstitute
            && plannedCompanion.capabilityName === calledName;
        const effectiveName = isRegisteredCompanionAlias
            ? plannedCapabilityName
            : calledName;
        const acceptsOrderTarget = hasAiKnowledgeCompanionProjection(effectiveName, 'order_target')
            || getAiCapability(effectiveName)?.knowledgeCompanion?.argumentProjection === 'order_target';
        if (effectiveName !== plannedCapabilityName || !acceptsOrderTarget) return toolCall;

        let args;
        try {
            args = JSON.parse(toolCall?.function?.arguments || '{}');
        } catch {
            return toolCall;
        }
        const explicitOrderQuery = String(args?.orderQuery || '').trim();
        const previousQueryForExplicitId = resolvedOrderQueryForId(
            options.turnState,
            args?.orderId
        );
        let nextArgs = args;
        if (!explicitOrderQuery && previousQueryForExplicitId) {
            nextArgs = { ...args, orderQuery: previousQueryForExplicitId };
            delete nextArgs.orderId;
        } else if (!explicitOrderQuery && args?.orderId === undefined && previousOrderQuery) {
            nextArgs = { ...args, orderQuery: previousOrderQuery };
        }
        return {
            ...toolCall,
            function: {
                ...toolCall.function,
                name: effectiveName,
                arguments: JSON.stringify(nextArgs),
            },
        };
    });
}

module.exports = {
    getKnowledgeCompanionCall,
    normalizeKnowledgeCompanionToolCalls,
    projectKnowledgeCompanionArgs,
    resolvedOrderQueryForId,
    resolvedOrderQueryCandidate,
};
