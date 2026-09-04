'use strict';

const { resolveFormalEntityResultV3 } = require('../aiEntityResolverV3.cjs');
const { getV5EntityType } = require('./businessOntology.cjs');
const { createV5EntityIdentity, validateV5EntityIdentity } = require('./entityIdentity.cjs');

const V5_RESOLVER_INPUT_POLICIES = Object.freeze(Object.fromEntries(
    ['customer', 'order', 'recipe', 'part', 'coil', 'template'].map(entityType => [entityType, Object.freeze({
        v5InputField: 'rawMention',
        existingV4InputSource: 'tool_argument',
        resolverPath: 'aiEntityResolverV3.resolveFormalEntityResultV3',
        mutationAllowed: false,
    })])
));

function canonicalBusinessKey(selected) {
    const entries = Object.entries(selected?.stableIdentity?.stableBusinessKeys || {});
    return entries.length > 0 ? { name: entries[0][0], value: String(entries[0][1]) } : null;
}

function mapResolverStatus(receipt) {
    if (!receipt) return { resolutionStatus: 'INVALID', matchType: 'NOT_RESOLVED' };
    if (receipt.status === 'exact') return { resolutionStatus: 'RESOLVED', matchType: 'EXACT' };
    if (receipt.status === 'unique_candidate') return { resolutionStatus: 'RESOLVED', matchType: 'FUZZY_UNIQUE' };
    if (receipt.status === 'ambiguous') return { resolutionStatus: 'AMBIGUOUS', matchType: 'AMBIGUOUS' };
    if (receipt.status === 'not_found') return { resolutionStatus: 'NOT_FOUND', matchType: 'NOT_FOUND' };
    return { resolutionStatus: 'INVALID', matchType: 'NOT_RESOLVED' };
}

function resolveV5EntityIdentity(identityInput, options = {}) {
    const identity = validateV5EntityIdentity(identityInput);
    const ontology = getV5EntityType(identity.entityType);
    const policy = V5_RESOLVER_INPUT_POLICIES[identity.entityType];
    if (!ontology || ontology.resolverAdapter !== 'V3_FORMAL_RESULT' || !policy) {
        return Object.freeze({
            status: 'UNSUPPORTED',
            code: 'V5_RESOLVER_ADAPTER_NOT_AVAILABLE',
            identity,
            policy: null,
        });
    }
    if (!Object.hasOwn(options, 'formalResult')) throw new TypeError('formalResult is required; adapter never queries or writes business data');
    const resolver = options.resolver || resolveFormalEntityResultV3;
    const receipt = resolver({
        entityType: identity.entityType,
        originalMention: identity.rawMention,
        result: options.formalResult,
        sourceCapability: options.sourceCapability || 'V5_SHADOW_FIXTURE',
        sourceEvidence: options.sourceEvidence || [],
    });
    const mapped = mapResolverStatus(receipt);
    const selected = mapped.resolutionStatus === 'RESOLVED' ? receipt.selected : null;
    const canonicalEntityId = selected
        ? (selected.id ?? selected.stableIdentity?.primaryStableId ?? null)
        : null;
    const projected = createV5EntityIdentity({
        ...identity,
        canonicalEntityId,
        canonicalBusinessKey: selected ? canonicalBusinessKey(selected) : null,
        resolutionStatus: mapped.resolutionStatus,
        matchType: mapped.matchType,
        source: mapped.resolutionStatus === 'RESOLVED' ? 'EXISTING_RESOLVER_V3' : 'TASK_BOUNDARY',
        resolverPath: policy.resolverPath,
        resolverInputField: policy.v5InputField,
    });
    return Object.freeze({
        status: 'PROJECTED',
        code: null,
        identity: projected,
        policy,
        receipt,
    });
}

module.exports = {
    V5_RESOLVER_INPUT_POLICIES,
    mapResolverStatus,
    resolveV5EntityIdentity,
};
