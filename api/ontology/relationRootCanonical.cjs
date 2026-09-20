'use strict';
/**
 * Deterministic canonical root resolution for an ontology relation (ONT-P8L-FINAL Gate B).
 *
 * The problem this closes: `recipe.uses_coil` used to bind its root ONLY from receipts produced by
 * whatever read tool the model happened to choose in the previous turn. The same question therefore
 * bound or did not bind depending on that choice, and a miss sent the turn back down the Legacy path,
 * which reads the whole recipe catalogue.
 *
 * The fix is a formal, bounded, EXACT-NAME resolution of the relation's `fromType` entity, executed
 * BEFORE binding as software work:
 *
 *   1. the relation type (already determined from the question grammar) fixes the entity type;
 *   2. one bounded formal API read resolves that NAME to at most one canonical identity;
 *   3. only a unique result whose FORMAL name equals the mention (after normalisation) becomes a
 *      pre-resolved canonical receipt, which the binder consumes through its existing
 *      `canonicalReceipts` channel — the highest-priority binding source.
 *
 * Deliberate limits:
 *  - substring / prefix hits never become an authoritative root; they stay at the clarification layer.
 *  - a miss, an ambiguity or a formal-name mismatch resolves to nothing, so the binder keeps its
 *    existing behaviour (ROOT_NOT_CANONICAL / INSUFFICIENT_CONTEXT -> not routed -> Legacy fallback).
 *  - every resolver failure fails open: the turn behaves exactly as it did before this step existed.
 *  - this module never touches the model-visible tool surface and never costs a provider round.
 */
const { relationMetadata, entityMetadata } = require('./bindingMetadata.cjs');
const { normalizeResourceText } = require('../services/aiResourceResolutionV3.cjs');

/** Only entity types with a registered, bounded identity read can be pre-resolved. */
const IDENTITY_READS = Object.freeze({
    recipe: Object.freeze({
        capability: 'resolve_recipe_identity',
        // The formal read whose execution evidence proves where this identity came from.
        path: name => `/api/recipes/identity?name=${encodeURIComponent(name)}`,
        // The path prefix that must appear in that read's execution evidence.
        evidencePath: '/api/recipes/identity',
    }),
});

/**
 * Relations whose root this runtime can pre-resolve. An identity read is necessary but not sufficient:
 * a relation is listed here only when its root name is the entity's OWN canonical name, so that the
 * pre-resolved identity IS the relation root. `recipe.uses_template` is deliberately absent — its root
 * is a recipe while the read that would resolve a template name is a different entity's catalogue.
 */
const RESOLVABLE_RELATIONS = Object.freeze(['recipe.uses_coil']);

function isResolvableRelation(relationId) {
    return RESOLVABLE_RELATIONS.includes(relationId);
}

/**
 * The mention is only a NAME candidate when it carries no entity label of its own. `配方ID 13` or
 * `配方 维纳斯` are typed references, and a multi-entity mention (`A和B`, handled by the binder as
 * AMBIGUOUS_ROOT) must not be resolved to either side.
 */
function mentionIsPlainName(mention) {
    const text = String(mention || '').trim();
    if (!text || text.length > 120) return false;
    if (/[和与、;；]/u.test(text)) return false;
    return !Object.values(entityMetadata).some(meta => meta.aliases.some(alias => text.includes(alias)));
}

/** The formal name and the mention are the same identity only when normalisation makes them equal. */
function exactFormalName(formalName, mention) {
    const formal = normalizeResourceText(formalName);
    if (!formal) return false;
    // The mention may carry trailing particles (`V550的`); the noise-stripped form is compared, but the
    // comparison itself stays exact — a prefix or substring never matches.
    return normalizeResourceText(mention) === formal
        || normalizeResourceText(String(mention || '').replace(/(?:[的了吧呢啊吗呀嘛哦喔噢哈哪啦嘞么]|[。，、；：？！,.;:?!~～\s])+$/u, '')) === formal;
}

/**
 * Resolve one relation intent to a pre-resolved canonical root.
 *
 * @returns a frozen `{ relationId, entityType, canonicalId, mention, receipt }` on an exact unique hit,
 *          otherwise a frozen `{ relationId, entityType, reason }` describing why nothing was resolved.
 */
async function resolveRelationRoot(intent, dependencies = {}) {
    const relationId = intent?.relationId || null;
    const relation = relationMetadata.find(item => item.relationId === relationId);
    const entityType = relation?.fromType || null;
    const mention = String(intent?.mention || '').trim();
    const read = entityType ? IDENTITY_READS[entityType] : null;
    const unresolved = reason => Object.freeze({ relationId, entityType, mention, resolved: false, reason });
    if (!relation || !read) return unresolved('RELATION_NOT_RESOLVABLE');
    if (!intent?.eligible) return unresolved('NOT_ELIGIBLE');
    if (!mentionIsPlainName(mention)) return unresolved('NOT_A_PLAIN_NAME');
    const resolve = dependencies.resolveIdentity;
    if (typeof resolve !== 'function') return unresolved('RESOLVER_UNAVAILABLE');
    let resolution;
    try {
        resolution = await resolve({ relationId, entityType, capability: read.capability, mention });
    } catch {
        // Resolution is an optimisation for recall. Any transport or contract failure must leave the
        // turn exactly as it was, so it is reported as unresolved and never propagated.
        return unresolved('RESOLVER_FAILED');
    }
    const calls = (Array.isArray(resolution?.calls) ? resolution.calls : [])
        .filter(call => call && String(call.method).toUpperCase() === 'GET' && typeof call.path === 'string');
    if (!resolution || resolution.status !== 'found' || !resolution.identity) {
        const reason = resolution?.status === 'ambiguous' ? 'AMBIGUOUS_NAME'
            : resolution?.status === 'not_found' ? 'NAME_NOT_FOUND' : 'RESOLVER_FAILED';
        return unresolved(reason);
    }
    const recipeId = Number(resolution.identity.recipeId ?? resolution.identity.canonicalId);
    const formalName = String(resolution.identity.recipeName ?? resolution.identity.name ?? '').trim();
    if (!Number.isSafeInteger(recipeId) || recipeId <= 0 || !formalName) return unresolved('IDENTITY_INVALID');
    // Strictness: a unique result is not enough — the formal name must BE the mention.
    if (!exactFormalName(formalName, mention)) return unresolved('NAME_NOT_EXACT');
    if (!calls.some(call => call.path.startsWith(read.evidencePath))) {
        return unresolved('READ_PROVENANCE_MISSING');
    }
    const canonicalId = String(recipeId);
    return Object.freeze({
        relationId, entityType, mention, resolved: true, reason: null,
        canonicalId,
        // Shaped as an entity-resolution receipt so the binder consumes it through the EXISTING
        // `canonicalReceipts` channel. `sourceCapability` is the formal read that produced it and
        // `sourceEvidence` carries that read's execution evidence, so this is a read provenance, not a
        // string comparison result.
        receipt: Object.freeze({
            version: 3, kind: 'entity_resolution', entityType, status: 'exact',
            originalMention: mention,
            selected: Object.freeze({ id: recipeId, name: formalName, matchKind: 'exact' }),
            sourceCapability: read.capability,
            sourceEvidence: Object.freeze([Object.freeze({ executionEvidence: Object.freeze({
                verified: true, kind: 'formal_api_query', calls,
            }) })]),
        }),
    });
}

module.exports = Object.freeze({
    IDENTITY_READS,
    RESOLVABLE_RELATIONS,
    exactFormalName,
    isResolvableRelation,
    mentionIsPlainName,
    resolveRelationRoot,
});
