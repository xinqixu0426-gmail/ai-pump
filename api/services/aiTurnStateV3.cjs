const { hasAiKnowledgeCompanionProjection } = require('../capabilities/registry.cjs');

const MAX_RESOLVED_ENTITIES = 8;
const MAX_CAPABILITIES = 12;

function cleanText(value, maxLength = 160) {
    return String(value || '').trim().slice(0, maxLength);
}

function normalizeResolvedEntity(input = {}) {
    const id = Number(input.id);
    const entityType = cleanText(input.entityType, 40);
    const name = cleanText(input.name);
    if (!entityType || (!Number.isSafeInteger(id) && !name)) return null;
    return {
        entityType,
        id: Number.isSafeInteger(id) && id > 0 ? id : null,
        name,
        originalMention: cleanText(input.originalMention),
        confidence: Number.isFinite(Number(input.confidence))
            ? Math.max(0, Math.min(1, Number(input.confidence)))
            : null,
        resolutionStatus: cleanText(input.resolutionStatus, 40),
    };
}

function normalizeAiTurnStateV3(input = {}) {
    if (!input || input.version !== 3 || input.kind !== 'agent_turn_state') return null;
    const resolvedEntities = (Array.isArray(input.resolvedEntities) ? input.resolvedEntities : [])
        .slice(0, MAX_RESOLVED_ENTITIES)
        .map(normalizeResolvedEntity)
        .filter(Boolean);
    const capabilities = (Array.isArray(input.capabilities) ? input.capabilities : [])
        .slice(0, MAX_CAPABILITIES)
        .map(value => cleanText(value, 80))
        .filter(Boolean);
    if (resolvedEntities.length === 0 && capabilities.length === 0) return null;
    return {
        version: 3,
        kind: 'agent_turn_state',
        resolvedEntities,
        capabilities: [...new Set(capabilities)],
    };
}

function aiTurnStatePrompt(input) {
    const state = normalizeAiTurnStateV3(input);
    if (!state || state.resolvedEntities.length === 0) return '';
    return [
        '上一轮已经通过正式 Query 解析出以下业务对象，仅在当前问题明确属于紧邻追问时使用：',
        ...state.resolvedEntities.map(entity => (
            `- ${entity.entityType}: ${entity.name || '-'}`
        )),
        '新业务问题不得继承这些对象；紧邻追问可以继续原目标，但仍需调用正式能力获取本轮实时事实。',
    ].join('\n');
}

function resolvedEntityIds(input, entityType) {
    const state = normalizeAiTurnStateV3(input);
    return new Set((state?.resolvedEntities || [])
        .filter(entity => entity.entityType === entityType && entity.id)
        .map(entity => entity.id));
}

function buildAiTurnStateV3(toolResults = [], previousState = null) {
    const previous = normalizeAiTurnStateV3(previousState);
    const entities = new Map();
    for (const entity of previous?.resolvedEntities || []) {
        entities.set(`${entity.entityType}\u0000${entity.id || entity.name}`, entity);
    }
    for (const tool of Array.isArray(toolResults) ? toolResults : []) {
        const receipt = tool?.result?.resolutionReceipt;
        if (
            receipt?.version === 3
            && receipt?.kind === 'entity_resolution'
            && receipt.entityType
            && receipt.selected
        ) {
            const entity = normalizeResolvedEntity({
                entityType: receipt.entityType,
                id: receipt.selected.id,
                name: receipt.selected.name,
                originalMention: receipt.originalMention,
                confidence: receipt.selected.score,
                resolutionStatus: receipt.status,
            });
            if (entity) entities.set(`${entity.entityType}\u0000${entity.id || entity.name}`, entity);
        }

        const knowledgeOrder = tool?.result?.success !== false
            && tool?.result?.executionEvidence?.verified === true
            && hasAiKnowledgeCompanionProjection(tool?.name, 'order_target')
            ? tool?.result?.data?.order
            : null;
        const orderEntity = normalizeResolvedEntity({
            entityType: 'order',
            id: knowledgeOrder?.id,
            name: knowledgeOrder?.contractNo || knowledgeOrder?.customerName,
            originalMention: knowledgeOrder?.contractNo || knowledgeOrder?.customerName,
            confidence: 1,
            resolutionStatus: 'verified_tool_result',
        });
        if (orderEntity) {
            entities.set(`${orderEntity.entityType}\u0000${orderEntity.id || orderEntity.name}`, orderEntity);
        }
    }
    return normalizeAiTurnStateV3({
        version: 3,
        kind: 'agent_turn_state',
        resolvedEntities: [...entities.values()].slice(-MAX_RESOLVED_ENTITIES),
        capabilities: [
            ...(previous?.capabilities || []),
            ...(Array.isArray(toolResults) ? toolResults.map(item => item?.name) : []),
        ].filter(Boolean),
    });
}

module.exports = {
    aiTurnStatePrompt,
    buildAiTurnStateV3,
    normalizeAiTurnStateV3,
    resolvedEntityIds,
};
