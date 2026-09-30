'use strict';

// Agent-facing adapter over the existing formal Entity Lookup API.  This is
// intentionally a contract adapter: identity stays owned by the Ontology API,
// while cost, inventory and all other business facts stay outside this module.
const { createInternalFetch, lookupEntities } = require('../routes/ai/internalApiClient.cjs');

const AGENT_ENTITY_TYPES = Object.freeze(['recipe', 'coil', 'part', 'order', 'customer', 'template']);

class AgentIdentityError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AgentIdentityError';
        this.code = code;
    }
}

function validEntityType(value) {
    const entityType = String(value || '').trim();
    if (!AGENT_ENTITY_TYPES.includes(entityType)) {
        throw new AgentIdentityError('AGENT_ENTITY_TYPE_INVALID', '实体类型不在正式 Ontology 支持范围内。');
    }
    return entityType;
}

function validMention(value) {
    const mention = String(value || '').trim();
    if (!mention || [...mention].length > 160) {
        throw new AgentIdentityError('AGENT_ENTITY_MENTION_INVALID', '实体名称无效。');
    }
    return mention;
}

function candidateProjection(candidate) {
    return Object.freeze({
        entityType: String(candidate.entityType || ''),
        canonicalId: String(candidate.canonicalId || ''),
        canonicalName: String(candidate.canonicalName || '').trim() || null,
        matchKind: String(candidate.matchKind || 'EXACT'),
        ...(candidate.identityAttributes && typeof candidate.identityAttributes === 'object'
            ? { identityAttributes: candidate.identityAttributes } : {}),
    });
}

function resolutionProjection(entityType, mention, result) {
    const complete = result?.complete === true;
    const candidates = (Array.isArray(result?.candidates) ? result.candidates : [])
        .filter(candidate => candidate?.entityType === entityType)
        .map(candidateProjection);
    if (!complete) {
        return Object.freeze({ entityType, mention, status: 'INCOMPLETE', canonicalId: null,
            canonicalName: null, candidates: Object.freeze(candidates), source: 'formal', verified: false });
    }
    if (candidates.length === 0) {
        return Object.freeze({ entityType, mention, status: 'NOT_FOUND', canonicalId: null,
            canonicalName: null, candidates: Object.freeze([]), source: 'formal', verified: false });
    }
    if (candidates.length !== 1) {
        return Object.freeze({ entityType, mention, status: 'AMBIGUOUS', canonicalId: null,
            canonicalName: null, candidates: Object.freeze(candidates), source: 'formal', verified: false });
    }
    const candidate = candidates[0];
    return Object.freeze({ entityType, mention, status: 'RESOLVED', canonicalId: candidate.canonicalId,
        canonicalName: candidate.canonicalName, candidates: Object.freeze([]), source: 'formal', verified: true,
        matchKind: candidate.matchKind, ...(candidate.identityAttributes ? { identityAttributes: candidate.identityAttributes } : {}) });
}

async function resolveAgentEntity(input = {}, dependencies = {}) {
    const entityType = validEntityType(input.entityType);
    const mention = validMention(input.mention);
    const fetch = dependencies.internalFetch || createInternalFetch({ signal: input.signal });
    const lookup = dependencies.lookupEntities || lookupEntities;
    const result = await lookup(fetch, {
        version: 1,
        mention,
        entityTypes: [entityType],
        matchPolicy: 'EXACT_OR_APPROVED_ALIAS',
    });
    return resolutionProjection(entityType, mention, result);
}

// A page identifier is only a candidate supplied by UI state.  We verify it
// through the existing formal Executor before it becomes an Agent binding.
async function resolvePageContextEntity(input = {}, dependencies = {}) {
    const entityType = validEntityType(input.entityType);
    const pageContext = input.pageContext;
    const resourceId = Number(pageContext?.resourceId);
    if (!pageContext || String(pageContext.resourceType || '') !== entityType
        || !Number.isSafeInteger(resourceId) || resourceId < 1) {
        return Object.freeze({ entityType, mention: null, status: 'NOT_FOUND', canonicalId: null,
            canonicalName: null, candidates: Object.freeze([]), source: 'page_context_candidate', verified: false });
    }
    const execute = dependencies.executeToolCall;
    if (typeof execute !== 'function') throw new AgentIdentityError('AGENT_ENTITY_RESOLVER_UNAVAILABLE', '正式实体解析器不可用。');
    const verifier = {
        recipe: { toolName: 'get_recipe_detail', args: { recipeId: resourceId }, name: result => result?.recipe?.name },
        order: { toolName: 'get_order_detail', args: { orderId: resourceId }, name: result => result?.order?.contractNo || result?.order?.customerName },
        template: { toolName: 'get_template_detail', args: { templateId: resourceId }, name: result => result?.data?.shellModel || result?.shellModel },
    }[entityType];
    if (!verifier) return Object.freeze({ entityType, mention: null, status: 'INCOMPLETE', canonicalId: null,
        canonicalName: null, candidates: Object.freeze([]), source: 'page_context_candidate', verified: false });
    const result = await execute(verifier.toolName, verifier.args, { allowWrite: false, signal: input.signal });
    const canonicalName = String(verifier.name(result) || '').trim();
    if (result?.success === false || !canonicalName) return Object.freeze({ entityType, mention: null, status: 'NOT_FOUND', canonicalId: null,
        canonicalName: null, candidates: Object.freeze([]), source: 'page_context_candidate', verified: false });
    return Object.freeze({ entityType, mention: null, status: 'RESOLVED', canonicalId: String(resourceId),
        canonicalName, candidates: Object.freeze([]), source: 'page_context_candidate', verified: true, matchKind: 'FORMAL_PAGE_VERIFICATION' });
}

module.exports = {
    AGENT_ENTITY_TYPES,
    AgentIdentityError,
    candidateProjection,
    resolutionProjection,
    resolveAgentEntity,
    resolvePageContextEntity,
};
