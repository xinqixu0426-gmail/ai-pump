'use strict';
const { parseAnswer, renderFact, LIMITATION } = require('./readAnswerContract.cjs');
const { numericMatches } = require('./readAnswerNumericValidator.cjs');
const { entityMatches } = require('./readAnswerEntityValidator.cjs');
function validateReadAnswer(content, view) {
    const out = { contractValid: false, evidenceRefsValid: false, groundingValid: false, requiredFactCoverage: false,
        numericValid: false, entityValid: false, claimCount: 0, groundedClaimCount: 0, unsupportedClaimCount: 0, internalLeakageCount: 0, reasonCodes: [] };
    let d;
    try { d = parseAnswer(content); } catch (e) { return { ...out, status: 'ANSWER_SHADOW_REJECTED', reasonCodes: [e.message] }; }
    out.contractValid = true; out.claimCount = d.claims.length;
    const seen = new Set(), text = [];
    let refs = true, numeric = true, entity = true, scope = true;
    for (const c of d.claims) {
        if (c.claimType === 'LIMITATION') { text.push(LIMITATION); continue; }
        const fact = view.facts.find(f => f.factKey === c.factKey);
        if (!fact || seen.has(c.factKey)) { scope = false; out.unsupportedClaimCount++; continue; }
        seen.add(c.factKey);
        const refOk = c.evidenceRefs.length === 1 && c.evidenceRefs[0] === fact.evidenceRef
            && fact.valid === true && fact.verified === true && fact.taskId === view.taskId;
        const n = numericMatches(c, fact), e = entityMatches(c, fact, view);
        refs &&= refOk; numeric &&= n; entity &&= e;
        if (refOk && n && e) out.groundedClaimCount++; else out.unsupportedClaimCount++;
        text.push(renderFact(view.entityLabel, c.factKey, fact.value));
    }
    // An exact approved realization makes EVERY byte outside the grounded claims rejectable,
    // including extra prose, wrong identity punctuation, rounding and semantic overstatement.
    const textMatch = d.answerText === text.join('\n');
    if (!textMatch) { out.unsupportedClaimCount++; out.reasonCodes.push('ANSWER_TEXT_UNSUPPORTED'); }
    const internal = /(?:search_parts|search_coils|preview_recipe_cost|canonicalId|databaseId|schemeCode|bindingRef|spanRef|traceId|capabilityId|\/api\/|VERIFIED|COMPOSING)/u;
    out.internalLeakageCount = Number(internal.test(d.answerText) || view.facts.some(f => d.answerText.includes(f.evidenceRef))
        || view.forbiddenValues.some(v => typeof v === 'string' && v.length > 0 && d.answerText.includes(v)));
    out.evidenceRefsValid = refs && scope; out.numericValid = numeric && scope && textMatch;
    out.entityValid = entity && scope && textMatch;
    out.requiredFactCoverage = view.facts.every(f => seen.has(f.factKey)) && textMatch;
    out.groundingValid = out.unsupportedClaimCount === 0 && out.requiredFactCoverage;
    const pass = out.evidenceRefsValid && out.numericValid && out.entityValid && out.groundingValid && out.internalLeakageCount === 0;
    if (!pass && !out.reasonCodes.length) out.reasonCodes.push('ANSWER_FACT_VALIDATION_FAILED');
    return { ...out, status: pass ? 'ANSWER_SHADOW_ACCEPTED' : 'ANSWER_SHADOW_REJECTED' };
}
module.exports = { validateReadAnswer };
