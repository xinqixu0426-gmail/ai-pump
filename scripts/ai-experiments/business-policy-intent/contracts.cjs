'use strict';

const INTENT_KEYS = Object.freeze(['objectMentions', 'requestedChanges', 'requestedInformation', 'persistence', 'needsClarification', 'clarificationReason']);
const PERSISTENCE = Object.freeze(['SAVE', 'DO_NOT_SAVE', 'UNSPECIFIED', 'NOT_APPLICABLE']);

function asObject(value, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
    return value;
}
function exactKeys(value, keys, code) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(code);
}
function strings(value, code) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(code);
    return Object.freeze(value.map(item => item.trim()).filter(Boolean));
}
function parseJson(value, code) {
    try { return asObject(JSON.parse(String(value || '')), code); } catch { throw new Error(code); }
}
function validateChange(change) {
    asObject(change, 'INTENT_RESULT_INVALID');
    exactKeys(change, ['subject', 'from', 'to', 'delta', 'evidence'], 'INTENT_RESULT_INVALID');
    if (typeof change.subject !== 'string' || typeof change.evidence !== 'string') throw new Error('INTENT_RESULT_INVALID');
    for (const key of ['from', 'to', 'delta']) if (change[key] !== null && typeof change[key] !== 'string') throw new Error('INTENT_RESULT_INVALID');
    return Object.freeze({ subject: change.subject.trim(), from: change.from, to: change.to, delta: change.delta, evidence: change.evidence.trim() });
}
function validateInformation(item) {
    asObject(item, 'INTENT_RESULT_INVALID');
    exactKeys(item, ['value', 'evidence'], 'INTENT_RESULT_INVALID');
    if (typeof item.value !== 'string' || typeof item.evidence !== 'string') throw new Error('INTENT_RESULT_INVALID');
    return Object.freeze({ value: item.value.trim(), evidence: item.evidence.trim() });
}
function validateIntentResult(value) {
    asObject(value, 'INTENT_RESULT_INVALID');
    exactKeys(value, INTENT_KEYS, 'INTENT_RESULT_INVALID');
    if (!PERSISTENCE.includes(value.persistence) || typeof value.needsClarification !== 'boolean') throw new Error('INTENT_RESULT_INVALID');
    if (value.clarificationReason !== null && typeof value.clarificationReason !== 'string') throw new Error('INTENT_RESULT_INVALID');
    if (!Array.isArray(value.requestedChanges) || !Array.isArray(value.requestedInformation)) throw new Error('INTENT_RESULT_INVALID');
    return Object.freeze({
        objectMentions: strings(value.objectMentions, 'INTENT_RESULT_INVALID'),
        requestedChanges: Object.freeze(value.requestedChanges.map(validateChange)),
        requestedInformation: Object.freeze(value.requestedInformation.map(validateInformation)),
        persistence: value.persistence,
        needsClarification: value.needsClarification,
        clarificationReason: value.clarificationReason?.trim() || null,
    });
}
function normalize(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s，。！？、:：；;,.!?()（）"'`]/g, '');
}
function textContains(source, evidence) {
    return normalize(source).includes(normalize(evidence));
}
function contextProfiles() {
    return Object.freeze({
        business: Object.freeze({ companyBusinessModelIncluded: true, domainPolicyIncluded: false, ontologyIncluded: false, toolsExposed: 0 }),
        policy: Object.freeze({ companyBusinessModelIncluded: false, domainPolicyIncluded: true, ontologyIncluded: false, toolsExposed: 0 }),
        intent: Object.freeze({ rawUserInputIncluded: true, businessMemoIncluded: true, policyMemoIncluded: true, rawCompanyBusinessModelIncluded: false, rawDomainPolicyIncluded: false, ontologyIncluded: false, toolsExposed: 0 }),
    });
}
function hasLeak(value) {
    const text = JSON.stringify(value);
    return /\b(?:recipe|coil|part|template)-[\w-]+\b|\b(?:tool|api|capability)\b|\/api\//i.test(text);
}

module.exports = { INTENT_KEYS, PERSISTENCE, parseJson, validateIntentResult, normalize, textContains, contextProfiles, hasLeak };
