const { getAiCapability } = require('../capabilities/registry.cjs');

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

module.exports = {
    getKnowledgeCompanionCall,
    projectKnowledgeCompanionArgs,
};
