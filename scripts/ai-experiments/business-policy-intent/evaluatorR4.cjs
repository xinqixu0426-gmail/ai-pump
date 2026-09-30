'use strict';

const { containsAny, normalize } = require('./contracts.cjs');

const IMPLEMENTATION_LANGUAGE = Object.freeze(['/api/', 'http', 'get ', 'post ', 'tool', '工具', 'function calling', 'executor', 'database', '数据库', 'sql', 'internalapiclient']);
const ID_PATTERN = /\b(?:recipe|coil|part|template)-[\w-]+\b|\b(?:recipeId|coilId|partId|templateId)\b/i;
const GROUNDING_LANGUAGE = Object.freeze(['正式身份', 'canonical', 'candidate', '候选实体', '多个候选', '多候选', '身份绑定', '实体绑定', '身份解析', '实体解析', 'identity resolution', 'grounding', '数据库身份', '具体正式方案', '唯一正式方案', '唯一配方', '先确认具体方案']);

function hasImplementationLanguage(memo) { return containsAny(memo, IMPLEMENTATION_LANGUAGE); }
function hasCanonicalId(memo) { return ID_PATTERN.test(String(memo || '')); }
function countMissingGroups(memo, groups) { return groups.filter(group => !containsAny(memo, group)); }
function quotedEvidence(memo) {
    return [...String(memo || '').matchAll(/[“"「]([^”"」]{1,80})[”"」]/g)].map(match => match[1].trim()).filter(Boolean);
}
function invalidMarkedEvidence(memo, item) {
    const source = normalize(`${item.user || ''}\n${item.recentConversation || ''}`);
    const marked = [...String(memo || '').matchAll(/(?:证据|原话|用户明确)[^\n“"「]{0,16}[“"「]([^”"」]{1,80})[”"」]/g)].map(match => match[1].trim());
    return marked.filter(fragment => !source.includes(normalize(fragment)));
}
function persistenceSignals(memo) {
    const value = normalize(memo);
    const doNotSave = /(?:明确不保存|明确(?:表达|说).{0,4}不保存|先算一下不保存|只试算|临时看看)/.test(value);
    const explicitSave = /(?:明确要求保存|明确表示保存|明确要求正式修改|明确表示正式修改)/.test(value);
    const unspecified = !explicitSave && /(?:没有|未|并未).{0,12}(?:表达|说明|提及).{0,8}(?:保存|持久)|(?:保存|持久).{0,12}(?:未明确|没有说明|没有表达)/.test(value);
    return Object.freeze({
        save: !doNotSave && !unspecified && explicitSave,
        doNotSave,
        unspecified,
        notApplicable: /(?:纯|仅|只是).{0,6}(?:查询|解释)|不涉及.{0,8}(?:保存|持久)/.test(value),
        clarification: clarificationSignal(value),
    });
}
function clarificationSignal(value) {
    const explicitlyNo = /(?:不需要|无需|不必).{0,12}(?:澄清|说明)|(?:是否)?需要澄清.{0,4}(?:无|否|没有)|未发现.{0,12}需要澄清|没有.{0,12}(?:语言信息|语言上|语言层面).{0,8}(?:缺失|需要澄清)|没有明显缺少(?:的)?语言信息|未识别到.{0,12}(?:语言|缺对象|缺少)|未出现.{0,12}(?:必须)?澄清|(?:语言上|语言层面).{0,8}(?:无|没有).{0,8}(?:缺失|澄清)|无(?:明显)?(?:语言)?(?:信息)?缺失|已足够表达/.test(value);
    if (explicitlyNo) return false;
    return /(?:需要|应当|仍需).{0,8}(?:澄清|说明)|对象未知|指代对象未知|没有可恢复.{0,12}(?:指代|对象)|缺少.{0,16}(?:对象|配置|改成|变更|信息)/.test(value);
}
function classifyPersistence(expected, signals) {
    if (expected === 'SAVE' && signals.doNotSave) return 'PERSISTENCE_REVERSED';
    if (expected === 'DO_NOT_SAVE' && signals.save) return 'PERSISTENCE_REVERSED';
    if (expected === 'UNSPECIFIED' && signals.save) return 'PERSISTENCE_INVENTED';
    if (expected === 'NOT_APPLICABLE' && (signals.save || signals.doNotSave)) return 'PERSISTENCE_INVENTED';
    const matching = { SAVE: signals.save, DO_NOT_SAVE: signals.doNotSave, UNSPECIFIED: signals.unspecified, NOT_APPLICABLE: signals.notApplicable || signals.unspecified };
    return matching[expected] ? null : 'PERSISTENCE_REVIEW_REQUIRED';
}
function evaluateMemo(item, output) {
    const intentMemo = String(output.intentMemo || '');
    const deterministicFailures = [];
    const reviewRequired = [];
    const business = hasCanonicalId(output.businessMemo) ? 'FAIL' : 'PASS';
    const policy = hasImplementationLanguage(output.policyMemo) || hasCanonicalId(output.policyMemo) ? 'FAIL' : 'PASS';
    if (hasImplementationLanguage(intentMemo) || hasCanonicalId(intentMemo)) deterministicFailures.push('INTENT_IMPLEMENTATION_OR_ID_LEAK');
    if (containsAny(intentMemo, GROUNDING_LANGUAGE)) deterministicFailures.push('GROUNDING_LEAK');
    if (invalidMarkedEvidence(intentMemo, item).length) deterministicFailures.push('MEMO_CONTEXT_AS_EVIDENCE');
    for (const phrase of item.expected.forbiddenInferences || []) if (containsAny(intentMemo, [phrase])) deterministicFailures.push('UNSUPPORTED_INTENT_INFERENCE');
    if (countMissingGroups(intentMemo, item.expected.requiredChanges || []).length) deterministicFailures.push('EXPLICIT_CHANGE_OMITTED');
    if (countMissingGroups(intentMemo, item.expected.requiredInformation || []).length) deterministicFailures.push('EXPLICIT_INFORMATION_OMITTED');
    if (item.expected.noObjectInference && containsAny(intentMemo, item.expected.noObjectInference)) deterministicFailures.push('UNSUPPORTED_OBJECT_INFERENCE');
    const persistence = classifyPersistence(item.expected.persistence, persistenceSignals(intentMemo));
    if (persistence && persistence !== 'PERSISTENCE_REVIEW_REQUIRED') deterministicFailures.push(persistence);
    if (persistence === 'PERSISTENCE_REVIEW_REQUIRED') reviewRequired.push(persistence);
    const clarification = persistenceSignals(intentMemo).clarification;
    if (item.expected.needsClarification !== clarification) deterministicFailures.push('CLARIFICATION_BOUNDARY_BREACH');
    if (countMissingGroups(intentMemo, item.expected.objectGroups || []).length) reviewRequired.push('OBJECT_REVIEW_REQUIRED');
    if (!quotedEvidence(intentMemo).length) reviewRequired.push('EVIDENCE_REVIEW_REQUIRED');
    const intent = deterministicFailures.length ? 'FAIL' : reviewRequired.length ? 'PARTIAL' : 'PASS';
    const evaluator = deterministicFailures.length ? 'FAIL' : reviewRequired.length ? 'REVIEW_REQUIRED' : 'PASS';
    const overall = business === 'FAIL' || policy === 'FAIL' || intent === 'FAIL' ? 'FAIL' : intent === 'PARTIAL' ? 'PARTIAL' : 'PASS';
    return Object.freeze({ business, policy, intent, evaluator, overall, deterministicFailures: [...new Set(deterministicFailures)], reviewRequired: [...new Set(reviewRequired)] });
}

module.exports = { GROUNDING_LANGUAGE, evaluateMemo, invalidMarkedEvidence };
