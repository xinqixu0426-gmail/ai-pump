'use strict';
const { TraversalPolicyV1 } = require('./traversalPolicy.cjs');
const { validateTraversalRequest } = require('./traversalContract.cjs');
const { entityMetadata, policy } = require('./bindingMetadata.cjs');
const { verifiedRows, mentionMatches, receiptRows } = require('./relationBinder.cjs');
const { ontology } = require('./contract.cjs');
const { deepFreeze } = require('./sources.cjs');
const { TTL_MS } = require('../services/aiAssistantSession.cjs');
const statuses = ['BOUND_2HOP', 'PATH_NOT_BOUND', 'AMBIGUOUS_PATH', 'ROOT_NOT_CANONICAL', 'RELATION_NOT_SUPPORTED', 'INSUFFICIENT_CONTEXT'];
const OntologyTraversalBindingV1 = deepFreeze({ version: 1, ontologyVersion: 1, statuses, shadowOnly: true });
function unbound(status) { return deepFreeze({ version: 1, ontologyVersion: 1, status, root: null, pathId: null,
    relationPath: [], bindingSource: [], shadowEligible: false }); }
function bindTraversal(input = {}) {
    if (input.ontologyVersion !== 1 || typeof input.userText !== 'string' || input.userText.length > 2048
        || ['verifiedToolResults', 'canonicalReceipts', 'resolverReceipts'].some(k => input[k] !== undefined && (!Array.isArray(input[k]) || input[k].length > 32))) return unbound('PATH_NOT_BOUND');
    const text = input.userText.trim();
    if (new RegExp(policy.excluded, 'u').test(text)) return unbound('PATH_NOT_BOUND');
    // Reject multiple investigation clauses independently of which roots current tools found.
    // A missing second root must not turn a two-path request into a single-path binding.
    const clauses = text.split(/[;；]/u).map(c => c.trim()).filter(Boolean);
    if (clauses.length > 1) return unbound('AMBIGUOUS_PATH');
    const rows = [...receiptRows(input.canonicalReceipts, 'canonical_receipt'), ...verifiedRows(input.verifiedToolResults),
        ...receiptRows(input.resolverReceipts, 'unique_exact_resolver_receipt')];
    const session = input.trustedSession, validSession = session && input.subject && input.conversationId
        && session.subject === input.subject && session.conversationId === input.conversationId
        && Number.isFinite(session.observedAt) && Date.now() - session.observedAt >= 0 && Date.now() - session.observedAt < TTL_MS;
    const sessionRows = validSession ? verifiedRows(session.toolResults) : [];
    const matches = [];
    for (const path of TraversalPolicyV1.paths) for (const expression of path.expressions) for (const clause of clauses) {
        const match = new RegExp(policy.prefix + expression + policy.suffix, 'u').exec(clause.trim()); if (!match) continue;
        const type = ontology.relations.find(r => r.relationId === path.relationPath[0]).fromType, mention = match.groups.root.trim();
        const pronoun = policy.pronouns.includes(mention), typed = entityMetadata[type].aliases.some(a => mention.includes(a));
        if (pronoun && !typed && Object.values(entityMetadata).some(meta => meta.aliases.some(a => mention.includes(a)))) continue;
        const candidates = pronoun ? sessionRows.filter(r => r.entityType === type).map(r => ({ ...r, source: 'trusted_same_session_result' }))
            : rows.filter(r => r.entityType === type && mentionMatches(mention, r));
        if (typed || candidates.length || pronoun && !sessionRows.length) matches.push({ path, mention, candidates, pronoun });
    }
    if (!matches.length) return unbound(/(?:所属客户|配方.*订单|订单.*配方|订.*产品)/u.test(text) ? 'RELATION_NOT_SUPPORTED' : 'PATH_NOT_BOUND');
    if (new Set(matches.map(m => m.path.pathId)).size > 1 || new Set(matches.map(m => m.mention)).size > 1) return unbound('AMBIGUOUS_PATH');
    const m = matches[0];
    if (m.pronoun && !validSession) return unbound('INSUFFICIENT_CONTEXT');
    const ids = [...new Set(m.candidates.map(r => r.canonicalId))];
    if (ids.length > 1 || /[和与、]/u.test(m.mention)) return unbound('AMBIGUOUS_PATH');
    if (!ids.length) return unbound(rows.length ? 'ROOT_NOT_CANONICAL' : 'INSUFFICIENT_CONTEXT');
    const root = { entityType: m.candidates[0].entityType, canonicalId: ids[0] };
    validateTraversalRequest({ ontologyVersion: 1, root, relationPath: m.path.relationPath });
    const rank = ['canonical_receipt', 'verified_formal_result', 'unique_exact_resolver_receipt', 'trusted_same_session_result'];
    const source = [...m.candidates].sort((a, b) => rank.indexOf(a.source) - rank.indexOf(b.source))[0].source;
    return deepFreeze({ version: 1, ontologyVersion: 1, status: 'BOUND_2HOP', root, pathId: m.path.pathId,
        relationPath: m.path.relationPath, bindingSource: [source, 'ontology_path_intent_metadata'], shadowEligible: true });
}
module.exports = { OntologyTraversalBindingV1, bindTraversal };
