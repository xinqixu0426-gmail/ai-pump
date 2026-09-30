'use strict';

const { containsAny, normalize } = require('./contracts.cjs');

const IMPLEMENTATION_LANGUAGE = Object.freeze(['/api/', 'http', 'get ', 'post ', 'tool', '工具', 'function calling', 'executor', 'database', '数据库', 'sql', 'internalapiclient']);
const ID_PATTERN = /\b(?:recipe|coil|part|template)-[\w-]+\b|\b(?:recipeId|coilId|partId|templateId)\b/i;

function hasImplementationLanguage(memo) { return containsAny(memo, IMPLEMENTATION_LANGUAGE); }
function hasCanonicalId(memo) { return ID_PATTERN.test(String(memo || '')); }
function countMissingGroups(memo, groups) { return groups.filter(group => !containsAny(memo, group)); }
function persistenceSignals(memo) {
    const normalized = normalize(memo);
    const mentionsNoSave = /(?:不保存|先算一下|只试算|临时看看)/.test(normalized);
    const negatesNoSave = /(?:没有|未|并未).{0,12}(?:表达|说明|提及)?.{0,8}不保存/.test(normalized);
    const doNotSave = mentionsNoSave && !negatesNoSave;
    const unspecified = /(?:没有|未|并未).{0,10}(?:表达|说明|提出)?.{0,5}(?:保存|持久)|(?:保存|持久).{0,8}(?:未明确|没有说明)/.test(normalized);
    return Object.freeze({
        save: !doNotSave && !unspecified && /(?:明确要求保存|明确表示保存|明确要求正式修改|明确表示正式修改|应当正式修改)/.test(normalized),
        doNotSave,
        unspecified,
        notApplicable: /(?:纯|仅|只是).{0,6}(?:查询|解释)|不涉及.{0,8}(?:保存|持久)/.test(normalized),
        clarification: !/(?:不需要|无需|不必|需要澄清否)/.test(normalized) && /(?:需要|应当|仍需).{0,8}(?:澄清|说明)|(?:缺少|没有|未说明|不清楚).{0,16}(?:对象|配置|改成|变更|信息)/.test(normalized),
    });
}
function classifyPersistence(expected, signals) {
    if (expected === 'SAVE' && signals.doNotSave) return 'PERSISTENCE_REVERSED';
    if (expected === 'DO_NOT_SAVE' && signals.save) return 'PERSISTENCE_REVERSED';
    if (expected === 'UNSPECIFIED' && signals.save) return 'PERSISTENCE_INVENTED';
    if (expected === 'NOT_APPLICABLE' && (signals.save || signals.doNotSave)) return 'PERSISTENCE_INVENTED';
    const matching = { SAVE: signals.save, DO_NOT_SAVE: signals.doNotSave, UNSPECIFIED: signals.unspecified, NOT_APPLICABLE: signals.notApplicable };
    return matching[expected] ? null : 'PERSISTENCE_REVIEW_REQUIRED';
}
function evaluateMemo(item, output) {
    const intentMemo = String(output.intentMemo || '');
    const deterministicFailures = [];
    const reviewRequired = [];
    const business = hasCanonicalId(output.businessMemo) ? 'FAIL' : 'PASS';
    const policy = hasImplementationLanguage(output.policyMemo) || hasCanonicalId(output.policyMemo) ? 'FAIL' : 'PASS';
    if (hasImplementationLanguage(intentMemo) || hasCanonicalId(intentMemo)) deterministicFailures.push('INTENT_IMPLEMENTATION_OR_ID_LEAK');
    for (const phrase of item.expected.forbiddenInferences || []) if (containsAny(intentMemo, [phrase])) deterministicFailures.push('UNSUPPORTED_INTENT_INFERENCE');
    if (countMissingGroups(intentMemo, item.expected.requiredChanges || []).length) deterministicFailures.push('EXPLICIT_CHANGE_OMITTED');
    if (countMissingGroups(intentMemo, item.expected.requiredInformation || []).length) deterministicFailures.push('EXPLICIT_INFORMATION_OMITTED');
    const persistence = classifyPersistence(item.expected.persistence, persistenceSignals(intentMemo));
    if (persistence && persistence !== 'PERSISTENCE_REVIEW_REQUIRED') deterministicFailures.push(persistence);
    if (persistence === 'PERSISTENCE_REVIEW_REQUIRED') reviewRequired.push(persistence);
    const clarification = persistenceSignals(intentMemo).clarification;
    if (item.expected.needsClarification && !clarification) reviewRequired.push('CLARIFICATION_REVIEW_REQUIRED');
    if (!item.expected.needsClarification && clarification) reviewRequired.push('CLARIFICATION_REVIEW_REQUIRED');
    if (item.expected.noObjectInference && containsAny(intentMemo, item.expected.noObjectInference)) deterministicFailures.push('UNSUPPORTED_OBJECT_INFERENCE');
    if (countMissingGroups(intentMemo, item.expected.objectGroups || []).length) reviewRequired.push('OBJECT_REVIEW_REQUIRED');
    const intent = deterministicFailures.length ? 'FAIL' : reviewRequired.length ? 'PARTIAL' : 'PASS';
    const evaluator = deterministicFailures.length ? 'FAIL' : reviewRequired.length ? 'REVIEW_REQUIRED' : 'PASS';
    const overall = business === 'FAIL' || policy === 'FAIL' || intent === 'FAIL' ? 'FAIL' : intent === 'PARTIAL' ? 'PARTIAL' : 'PASS';
    return Object.freeze({ business, policy, intent, evaluator, overall, deterministicFailures, reviewRequired });
}

module.exports = { IMPLEMENTATION_LANGUAGE, evaluateMemo };
