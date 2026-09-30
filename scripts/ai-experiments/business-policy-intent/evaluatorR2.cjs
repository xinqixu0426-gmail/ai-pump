'use strict';

const { hasLeak, normalize, textContains } = require('./contracts.cjs');

function sourceFor(item) { return [item.user, item.recentConversation || ''].join('\n'); }
function values(items) { return items.map(item => item.value || '').join(' '); }
function changeValues(items) { return items.map(item => `${item.subject} ${item.from || ''} ${item.to || ''} ${item.delta || ''}`).join(' '); }
function matchesAny(value, options) {
    const normalized = normalize(value);
    return options.some(option => normalized.includes(normalize(option)));
}
function evidenceChecks(item, intent) {
    const source = sourceFor(item);
    const failures = [];
    for (const change of intent.requestedChanges) {
        if (!textContains(source, change.evidence)) failures.push('CHANGE_EVIDENCE_NOT_IN_USER_WORDING');
        if (change.from && !textContains(source, change.from)) failures.push('INVENTED_CHANGE_FROM');
    }
    for (const information of intent.requestedInformation) if (!textContains(source, information.evidence)) failures.push('INFORMATION_EVIDENCE_NOT_IN_USER_WORDING');
    return failures;
}
function expectedStructure(item, intent) {
    const failures = [];
    if (intent.persistence !== item.expected.persistence) failures.push('EXPLICIT_PERSISTENCE_SIGNAL_LOST_OR_INVENTED');
    if (intent.needsClarification !== item.expected.needsClarification) failures.push('CLARIFICATION_BOUNDARY_WRONG');
    if (item.expected.minimumChanges && intent.requestedChanges.length < item.expected.minimumChanges) failures.push('EXPLICIT_CHANGE_OMITTED');
    if (item.expected.minimumInformation && intent.requestedInformation.length < item.expected.minimumInformation) failures.push('EXPLICIT_INFORMATION_OMITTED');
    return failures;
}
function semanticReview(item, intent) {
    const review = [];
    const allMentions = intent.objectMentions.join(' ');
    const changes = changeValues(intent.requestedChanges);
    const information = values(intent.requestedInformation);
    for (const group of item.expected.mentionGroups || []) if (!matchesAny(allMentions, group)) review.push('MENTION_SEMANTIC_REVIEW_REQUIRED');
    for (const group of item.expected.changeGroups || []) if (!matchesAny(changes, group)) review.push('CHANGE_SEMANTIC_REVIEW_REQUIRED');
    for (const group of item.expected.informationGroups || []) if (!matchesAny(information, group)) review.push('INFORMATION_SEMANTIC_REVIEW_REQUIRED');
    return review;
}
function memoBoundaryFailures(memo, type) {
    if (hasLeak(memo)) return [`${type}_ID_OR_TOOL_LEAK`];
    if (/\b\d+(?:\.\d+)?\s*(?:元|cny|rmb)\b/i.test(memo)) return [`${type}_FORMAL_MONEY_LEAK`];
    return [];
}
function evaluateCase(item, output) {
    const businessFailures = memoBoundaryFailures(output.businessMemo, 'BUSINESS');
    const policyFailures = memoBoundaryFailures(output.policyMemo, 'POLICY');
    const deterministicFailures = [...evidenceChecks(item, output.intent), ...expectedStructure(item, output.intent), ...(hasLeak(output.intent) ? ['INTENT_ID_OR_TOOL_LEAK'] : [])];
    const review = semanticReview(item, output.intent);
    const business = businessFailures.length ? 'FAIL' : 'PASS';
    const policy = policyFailures.length ? 'FAIL' : 'PASS';
    const intent = deterministicFailures.length ? 'FAIL' : review.length ? 'PARTIAL' : 'PASS';
    const evaluator = deterministicFailures.length ? 'FAIL' : review.length ? 'REVIEW_REQUIRED' : 'PASS';
    const overall = business === 'FAIL' || policy === 'FAIL' || intent === 'FAIL' ? 'FAIL' : intent === 'PARTIAL' ? 'PARTIAL' : 'PASS';
    return Object.freeze({ business, policy, intent, evaluator, overall, deterministicFailures, semanticReview: review, businessFailures, policyFailures });
}

module.exports = { evaluateCase };
