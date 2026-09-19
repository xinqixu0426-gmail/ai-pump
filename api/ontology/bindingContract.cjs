'use strict';
const { ontology } = require('./contract.cjs');
const { canonicalId } = require('./resolverContract.cjs');
const { deepFreeze } = require('./sources.cjs');
const BindingContractVersion = 1;
const BindingShadowFlag = 'AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED';
const statuses = ['BOUND', 'AMBIGUOUS_RELATION', 'AMBIGUOUS_ROOT', 'ROOT_NOT_CANONICAL',
    'RELATION_NOT_SUPPORTED', 'NO_RELATION_INTENT', 'INSUFFICIENT_CONTEXT', 'NOT_ELIGIBLE'];
const OntologyRelationBindingV1 = deepFreeze({ version: 1, ontologyVersion: 1, statuses,
    shadowOnly: true, maxTextLength: 2048, maxFormalRows: 512 });
const fields = ['version', 'ontologyVersion', 'status', 'shadowEligible', 'relationId', 'root', 'targetEntityType',
    'bindingEvidence', 'bindingSource', 'confidenceClass'];
const sources = ['canonical_receipt', 'verified_formal_result', 'unique_exact_resolver_receipt', 'trusted_same_session_result'];
function validateBinding(result) {
    if (result?.version !== 1 || result.ontologyVersion !== 1 || !statuses.includes(result.status)
        || typeof result.shadowEligible !== 'boolean' || Object.keys(result).some(k => !fields.includes(k))
        || fields.some(k => !Object.hasOwn(result, k)) || !Array.isArray(result.bindingSource)
        || !Array.isArray(result.bindingEvidence) || result.bindingEvidence.length > 4 || result.bindingSource.length > 4
        || result.bindingSource.some(s => ![...sources, 'ontology_intent_metadata'].includes(s))
        || result.bindingEvidence.some(e => !e || Object.keys(e).some(k => !['kind', 'capability'].includes(k))
            || !sources.includes(e.kind) || !(e.capability === null || typeof e.capability === 'string' && /^[a-z0-9_]{1,64}$/.test(e.capability)))) throw Error('BINDING_RESULT_INVALID');
    if (result.status === 'BOUND') {
        const relation = ontology.relations.find(r => r.relationId === result.relationId);
        if (!relation || result.root?.entityType !== relation.fromType || !canonicalId(result.root.canonicalId)
            || Object.keys(result.root).some(k => !['entityType', 'canonicalId'].includes(k))
            || result.targetEntityType !== relation.toType || result.confidenceClass !== 'deterministic'
            || !result.shadowEligible || !result.bindingEvidence?.length || !result.bindingSource?.length) throw Error('BINDING_RESULT_INVALID');
    } else if (result.shadowEligible || result.root !== null || result.relationId !== null || result.targetEntityType !== null
        || result.confidenceClass !== null || result.bindingEvidence.length || result.bindingSource.length) throw Error('BINDING_RESULT_INVALID');
    return deepFreeze(result);
}
function unbound(status) { return validateBinding({ version: 1, ontologyVersion: 1, status, shadowEligible: false,
    relationId: null, root: null, targetEntityType: null, bindingEvidence: [], bindingSource: [], confidenceClass: null }); }
module.exports = { OntologyRelationBindingV1, BindingContractVersion, BindingShadowFlag, validateBinding, unbound };
