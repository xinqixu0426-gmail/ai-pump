'use strict';
const { entityMetadata, relationMetadata, policy } = require('./bindingMetadata.cjs');
const { validateBinding, unbound } = require('./bindingContract.cjs');
const { canonicalId } = require('./resolverContract.cjs');
const { hasVerifiedExecution } = require('../services/aiExecutionEvidence.cjs');
const { getAiCapability } = require('../capabilities/registry.cjs');
const { TTL_MS } = require('../services/aiAssistantSession.cjs');
const { deepFreeze } = require('./sources.cjs');
const id = value => Number.isSafeInteger(value) && value > 0 ? String(value) : canonicalId(value) ? value : null;
const get = (object, field) => field.split('.').reduce((o, k) => o?.[k], object);
function verifiedRows(toolResults = []) {
    const rows = [];
    for (const [entityType, meta] of Object.entries(entityMetadata)) for (const resource of meta.resources) {
        for (const tool of toolResults.filter(t => t?.name === resource.tool)) {
            const r = tool.result;
            if (getAiCapability(tool.name)?.access !== 'read' || r?.success === false || !hasVerifiedExecution(r)
                || r.executionEvidence.kind !== 'formal_api_query'
                || !r.executionEvidence.calls?.some(c => c.method === 'GET' && new RegExp(`^/api/${resource.path}(?:/|\\?|$)`).test(c.path))) continue;
            const value = get(r, resource.field), records = Array.isArray(value) ? value : value ? [value] : [];
            if (records.length > 512 || rows.length + records.length > 512) continue;
            for (const row of records) {
                if (!row || row.deletedAt || row.deleted_at || !id(row.id)) continue;
                // Ownership is per RECORD. A collection read (`/api/recipes?keyword=…`) owns its array, and a
                // detail read (`/api/recipes/12`) owns exactly the record it names. The detail executor
                // performs BOTH calls (list to resolve the name, then the single resource), so keying the
                // check on the shape of the result discarded every detail receipt whose evidence also
                // contained the list call — which silently removed the recipe rows that the
                // `recipe -> coil` direction binds against (ONT-P8L-FINAL binding-recall gap).
                const collectionOwns = Array.isArray(value) && r.executionEvidence.calls.some(c => c.method === 'GET'
                    && new RegExp(`^/api/${resource.path}(?:\\?|$)`).test(c.path));
                const recordOwns = r.executionEvidence.calls.some(c => c.method === 'GET'
                    && new RegExp(`^/api/${resource.path}/${row.id}${resource.field === 'data.customer' ? '/context' : ''}(?:\\?|$)`).test(c.path));
                if (!collectionOwns && !recordOwns) continue;
                const partial = r.queryReceipt?.truncated === true || r.queryReceipt?.possiblyTruncated === true
                    || r.filters?.limit != null || r.count > records.length || records.some(record => !id(record?.id));
                const names = partial ? [] : meta.names.map(field => row[field]).filter(v => typeof v === 'string' && v.trim()).map(v => v.trim());
                if (!partial && meta.composite && meta.composite.every(k => row[k] !== undefined)) names.push(meta.composite.map(k => row[k]).join('-'));
                rows.push({ entityType, canonicalId: id(row.id), names, row, source: 'verified_formal_result', capability: tool.name });
            }
        }
    }
    return rows;
}
function mentionMatches(mention, candidate) {
    const meta = entityMetadata[candidate.entityType];
    const aliases = meta.aliases.join('|');
    const clean = mention.trim().replace(/^查询|^查一下/u, '').replace(/的$/u, '').trim();
    const explicit = clean.match(new RegExp(`^(?:${aliases})\\s*(?:ID|id|编号|#)?\\s*([1-9][0-9]*)$`));
    if (explicit) return explicit[1] === candidate.canonicalId;
    // Exact equality only, retaining punctuation. Labels may surround a formal display/business identifier.
    const stripped = clean.replace(new RegExp(`^(?:${aliases})`), '').replace(new RegExp(`(?:${aliases})$`), '').trim();
    return candidate.names.some(name => clean === name || stripped === name);
}
function receiptRows(receipts, source) {
    return (receipts || []).filter(r => r?.version === 3 && r.kind === 'entity_resolution'
        && r.status === 'exact' && r.selected?.matchKind === 'exact' && id(r.selected.id)
        && r.sourceEvidence?.some(e => e.executionEvidence?.verified && e.executionEvidence.kind === 'formal_api_query'
            && e.executionEvidence.calls?.some(c => c.method === 'GET')))
        .filter(r => entityMetadata[r.entityType]?.resources.some(resource => resource.tool === r.sourceCapability
            && r.sourceEvidence.some(e => e.executionEvidence?.calls?.some(c => c.method === 'GET'
                && new RegExp(`^/api/${resource.path}(?:/|\\?|$)`).test(c.path))))
            && (!r.selected.stableIdentity || (r.selected.stableIdentity.entityType === r.entityType
                && id(r.selected.stableIdentity.primaryStableId) === id(r.selected.id))))
        .map(r => ({ entityType: r.entityType, canonicalId: id(r.selected.id),
            names: [r.originalMention, r.selected.name].filter(v => typeof v === 'string'), source, capability: r.sourceCapability }));
}
/**
 * Structural relation intent: which relation the question names, and which root mention it carries.
 *
 * This is the SAME grammar the binder applies, exposed as a pure function of the question text plus the
 * already-verified session rows — no candidate rows are consulted, so it cannot change what binds. It
 * exists so callers that must run BEFORE binding (the deterministic root resolution in
 * `relationRootCanonical.cjs`) can know the relation's `fromType` without inventing a second grammar.
 */
function relationIntentMatches(userText, sessionRows = []) {
    const text = String(userText || '').trim();
    if (!text || text.length > 2048) return [];
    const matches = [];
    const clauses = text.split(/[;；]/u);
    for (const relation of relationMetadata) for (const expression of relation.expressions) for (const clause of clauses) {
        const match = new RegExp(policy.prefix + expression + policy.suffix, 'u').exec(clause.trim());
        if (!match) continue;
        const mention = match.groups.root.trim();
        const typed = entityMetadata[relation.fromType].aliases.some(alias => mention.includes(alias));
        const pronoun = policy.pronouns.includes(mention);
        if (pronoun && !typed && Object.values(entityMetadata).some(meta => meta.aliases.some(alias => mention.includes(alias)))) continue;
        if (pronoun && !typed && sessionRows.length && !sessionRows.some(c => c.entityType === relation.fromType)) continue;
        if (pronoun && !typed && !sessionRows.length) continue;
        matches.push({ relationId: relation.relationId, fromType: relation.fromType, toType: relation.toType,
            mention, typed, pronoun });
    }
    return matches;
}
/**
 * Verified rows of a trusted same-session receipt set. Ownership (subject + conversationId) and the
 * session TTL are checked here, so a caller that must consult the session BEFORE binding (the
 * deterministic root resolution) applies exactly the same rules the binder does.
 */
function trustedSessionRows(input = {}) {
    return verifiedSessionRows(input);
}
function verifiedSessionRows(input = {}) {
    const session = input.trustedSession;
    const validSession = session && input.subject && input.conversationId && session.subject === input.subject
        && session.conversationId === input.conversationId && Number.isFinite(session.observedAt)
        && Date.now() - session.observedAt >= 0 && Date.now() - session.observedAt < TTL_MS;
    return validSession ? verifiedRows(session.toolResults) : [];
}
function bindRelation(input = {}) {
    if (input.ontologyVersion !== 1 || typeof input.userText !== 'string' || input.userText.length > 2048) return unbound('NOT_ELIGIBLE');
    if (['verifiedToolResults', 'canonicalReceipts', 'resolverReceipts'].some(k => input[k] !== undefined
        && (!Array.isArray(input[k]) || input[k].length > 32))) return unbound('NOT_ELIGIBLE');
    const text = input.userText.trim();
    if (new RegExp(policy.excluded, 'u').test(text)) return unbound('NOT_ELIGIBLE');
    const currentRows = verifiedRows(input.verifiedToolResults);
    const canonical = receiptRows(input.canonicalReceipts, 'canonical_receipt');
    const resolver = receiptRows(input.resolverReceipts, 'unique_exact_resolver_receipt');
    const all = [...canonical, ...currentRows, ...resolver];
    const session = input.trustedSession;
    const validSession = session && input.subject && input.conversationId && session.subject === input.subject
        && session.conversationId === input.conversationId && Number.isFinite(session.observedAt)
        && Date.now() - session.observedAt >= 0 && Date.now() - session.observedAt < TTL_MS;
    const sessionRows = trustedSessionRows(input);
    // The grammar runs once, in `relationIntentMatches`, and the binder only attaches the candidate rows
    // each matched mention resolves to. Behaviour is identical to matching inline, but the structural
    // intent is now available to callers that must act before binding.
    const matches = [];
    for (const intent of relationIntentMatches(text, sessionRows)) {
        const { relationId, fromType, mention, typed, pronoun } = intent;
        // A context-free pronoun was already excluded by the grammar; this keeps the binder's original
        // fail-closed status for it instead of silently treating an unresolvable pronoun as no match.
        if (pronoun && !typed && !sessionRows.length) return unbound('INSUFFICIENT_CONTEXT');
        const possible = all.filter(c => c.entityType === fromType && mentionMatches(mention, c));
        if (typed || pronoun || possible.length) {
            matches.push({ relation: relationMetadata.find(r => r.relationId === relationId), mention, possible, pronoun });
        }
    }
    const directions = [...new Set(matches.map(m => m.relation.relationId))];
    if (matches.some(m => m.pronoun) && new Set(sessionRows.filter(c => matches.some(m => m.pronoun && m.relation.fromType === c.entityType))
        .map(c => `${c.entityType}:${c.canonicalId}`)).size > 1) return unbound('AMBIGUOUS_ROOT');
    if (directions.length > 1) return unbound('AMBIGUOUS_RELATION');
    if (new Set(matches.map(m => m.mention)).size > 1) return unbound('AMBIGUOUS_ROOT');
    if (!matches.length) {
        if (/[和与、]/u.test(text) && /(?:哪些|哪个|什么)/u.test(text)) return unbound('AMBIGUOUS_RELATION');
        return unbound(/(?:哪些|哪个|用在哪|属于|用了|使用|包含)/u.test(text) ? 'RELATION_NOT_SUPPORTED' : 'NO_RELATION_INTENT');
    }
    const match = matches[0], relation = match.relation;
    let candidates = match.possible;
    if (match.pronoun) {
        if (!validSession) return unbound('INSUFFICIENT_CONTEXT');
        candidates = sessionRows.filter(c => c.entityType === relation.fromType)
            .map(c => ({ ...c, source: 'trusted_same_session_result' }));
    }
    const unique = [...new Set(candidates.map(c => c.canonicalId))];
    if (unique.length > 1 || /(?:和|与|、)/u.test(match.mention)) return unbound('AMBIGUOUS_ROOT');
    if (!unique.length) return unbound(all.some(c => c.entityType === relation.fromType) ? 'ROOT_NOT_CANONICAL' : 'INSUFFICIENT_CONTEXT');
    const root = unique[0];
    // Lower-priority contradictory identities are never resolved by priority or recency.
    const order = ['canonical_receipt', 'verified_formal_result', 'unique_exact_resolver_receipt', 'trusted_same_session_result'];
    const selected = candidates.sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source))[0];
    return validateBinding({ version: 1, ontologyVersion: 1, status: 'BOUND', relationId: relation.relationId,
        root: { entityType: relation.fromType, canonicalId: root }, targetEntityType: relation.toType,
        bindingEvidence: [{ kind: selected.source, capability: /^[a-z0-9_]{1,64}$/.test(selected.capability) ? selected.capability : null }],
        bindingSource: [selected.source, 'ontology_intent_metadata'], confidenceClass: 'deterministic', shadowEligible: true });
}
module.exports = deepFreeze({ bindRelation, verifiedRows, mentionMatches, receiptRows, relationIntentMatches, trustedSessionRows, verifiedSessionRows });
