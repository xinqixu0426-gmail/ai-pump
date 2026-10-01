'use strict';

const { containsAny, normalize } = require('./contracts.cjs');

const IMPLEMENTATION_LANGUAGE = Object.freeze(['/api/', 'http', 'get ', 'post ', 'tool', '工具', 'function calling', 'executor', 'sql', 'internalapiclient']);
const DATABASE_ACCESS_LANGUAGE = Object.freeze(['查询数据库', '读取数据库', '访问数据库', 'database query', 'query database']);
const ID_PATTERN = /\b(?:recipe|coil|part|template)-[\w-]+\b|\b(?:recipeId|coilId|partId|templateId)\b/i;
const GROUNDING_LANGUAGE = Object.freeze(['正式身份', 'canonical', 'candidate', '候选实体', '多个候选', '多候选', '身份绑定', '实体绑定', '身份解析', '实体解析', 'identity resolution', 'grounding', '数据库身份', '具体正式方案', '唯一正式方案', '唯一配方', '先确认具体方案']);
const POLICY_LANGUAGE = Object.freeze(['按规则', '按domain policy', '应当视为', '未授权写入', '需要owner确认', '受保护写入', '应走临时试算', '应走正式修改', '后续执行']);
const POLICY_BUSINESS_EXPLANATION = Object.freeze(['120mm', '750代表功率', 'template是', 'bom蓝图', '45#钢', '定子直径']);

function hasImplementationLanguage(memo) { return containsAny(memo, IMPLEMENTATION_LANGUAGE) || containsAny(memo, DATABASE_ACCESS_LANGUAGE); }
function hasCanonicalId(memo) { return ID_PATTERN.test(String(memo || '')); }
function countMissingGroups(memo, groups) { return groups.filter(group => !containsAny(memo, group)); }
function quotedEvidence(memo) { return [...String(memo || '').matchAll(/[“"「]([^”"」]{1,80})[”"」]/g)].map(match => match[1].trim()).filter(Boolean); }
function invalidMarkedEvidence(memo, item) {
    const source = normalize(`${item.user || ''}\n${item.recentConversation || ''}`);
    const marked = [...String(memo || '').matchAll(/(?:证据|原话|用户明确)[^\n“"「]{0,16}[“"「]([^”"」]{1,80})[”"」]/g)]
        .filter(match => !/(?:没有|未|无).{0,20}(?:出现|表达|提及)/.test(String(memo || '').slice(Math.max(0, match.index - 80), match.index)))
        .map(match => match[1].trim());
    const soften = value => normalize(value).replace(/[成为了]/g, '');
    const softenedSource = soften(source);
    return marked.filter(fragment => !source.includes(normalize(fragment)) && !softenedSource.includes(soften(fragment)));
}
function persistenceSignals(memo) {
    const raw = String(memo || '');
    const value = normalize(raw);
    const doNotSave = /(?:明确不保存|明确(?:表达|说|表示).{0,4}不保存|先算一下不保存|只试算|临时看看)/.test(value);
    const explicitSave = /(?:明确要求保存|明确表示保存|明确要求正式修改|明确表示正式修改|用户(?:明确)?(?:说|表示).{0,4}保存)/.test(value);
    const unspecified = !explicitSave && /(?:没有|未|并未).{0,12}(?:表达|说明|提及).{0,8}(?:保存|持久)|(?:保存|持久).{0,12}(?:未明确|未表达|没有说明|没有表达)/.test(value);
    return Object.freeze({ save: !doNotSave && !unspecified && explicitSave, doNotSave, unspecified, notApplicable: /(?:纯|仅|只是).{0,6}(?:查询|解释)|不涉及.{0,8}(?:保存|持久)/.test(value), clarification: clarificationSignal(raw) });
}
function clarificationSignal(value) {
    const lines = String(value || '').split(/\n/);
    const anchor = lines.map(line => /澄清|缺少语言|语言信息是否缺失|语言上|语言层面/.test(line)).lastIndexOf(true);
    const relevant = anchor >= 0 ? lines.slice(anchor, anchor + 3).join(' ') : '';
    const subject = normalize(relevant || value);
    // A model sometimes phrases the section as an unresolved meta-question
    // ("whether clarification is needed was not expressed"). That is neither
    // an affirmative nor a negative answer and should be reviewed, not failed.
    if (/是否需要.{0,24}澄清[，,].{0,24}(?:用户)?(?:没有|未)表达/.test(subject)) return null;
    // An unknown referent is decisive even if the same memo also says that a
    // different element (for example the target "wood box") needs no further
    // clarification.
    if (/对象未知|指代对象未知|没有可恢复.{0,12}(?:指代|对象)/.test(subject)) return true;
    if (/是否需要澄清.{0,12}(?:需要|是)/.test(subject)) return true;
    const explicitlyNo = /(?:需要澄清|澄清|语言信息是否缺失|是否缺少语言信息).{0,20}(?:不缺少|不需要|无需|无|否|没有(?:缺少|语言|需要|发现)|未出现|未发现)|(?:不需要|无需|不必|不缺少).{0,18}(?:澄清|说明|语言信息)|没有明显缺少(?:的)?语言信息|未识别到.{0,12}(?:语言|缺对象|缺少)|(?:语言上|语言层面).{0,8}(?:无|没有).{0,8}(?:缺失|澄清)|无(?:明显)?(?:语言)?(?:信息)?缺失|已足够表达/.test(subject);
    if (explicitlyNo) return false;
    const explicitlyYes = /(?:需要|应当|仍需).{0,8}(?:澄清|说明)|对象未知|指代对象未知|没有可恢复.{0,12}(?:指代|对象)|(?:语言上|语言层面).{0,12}(?:缺少|缺失|不明确)|缺少.{0,16}(?:对象|配置|改成|变更|信息)/.test(subject);
    return explicitlyYes ? true : null;
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
    const businessMemo = String(output.businessMemo || '');
    const policyMemo = String(output.policyMemo || '');
    const intentMemo = String(output.intentMemo || '');
    const businessFailures = [];
    const policyFailures = [];
    const intentFailures = [];
    const reviewRequired = [];
    if (hasImplementationLanguage(businessMemo) || hasCanonicalId(businessMemo) || containsAny(businessMemo, POLICY_LANGUAGE)) businessFailures.push('BUSINESS_BOUNDARY_LEAK');
    if (hasImplementationLanguage(policyMemo) || hasCanonicalId(policyMemo) || containsAny(policyMemo, POLICY_BUSINESS_EXPLANATION)) policyFailures.push('POLICY_BOUNDARY_LEAK');
    if (item.expected.persistence === 'UNSPECIFIED' && containsAny(policyMemo, ['已经授权写入', '直接正式修改', '立即保存'])) policyFailures.push('POLICY_PERSISTENCE_ESCALATION');
    if (hasImplementationLanguage(intentMemo) || hasCanonicalId(intentMemo)) intentFailures.push('INTENT_IMPLEMENTATION_OR_ID_LEAK');
    if (containsAny(intentMemo, GROUNDING_LANGUAGE)) intentFailures.push('GROUNDING_LEAK');
    if (containsAny(intentMemo, POLICY_LANGUAGE)) intentFailures.push('POLICY_TO_INTENT_LEAK');
    if (invalidMarkedEvidence(intentMemo, item).length) intentFailures.push('MEMO_CONTEXT_AS_EVIDENCE');
    for (const phrase of item.expected.forbiddenInferences || []) if (containsAny(intentMemo, [phrase])) intentFailures.push('UNSUPPORTED_INTENT_INFERENCE');
    if (countMissingGroups(intentMemo, item.expected.requiredChanges || []).length) intentFailures.push('EXPLICIT_CHANGE_OMITTED');
    if (countMissingGroups(intentMemo, item.expected.requiredInformation || []).length) intentFailures.push('EXPLICIT_INFORMATION_OMITTED');
    if (item.expected.noObjectInference && containsAny(intentMemo, item.expected.noObjectInference)) intentFailures.push('UNSUPPORTED_OBJECT_INFERENCE');
    const persistence = classifyPersistence(item.expected.persistence, persistenceSignals(intentMemo));
    if (persistence && persistence !== 'PERSISTENCE_REVIEW_REQUIRED') intentFailures.push(persistence);
    if (persistence === 'PERSISTENCE_REVIEW_REQUIRED') reviewRequired.push(persistence);
    const clarification = persistenceSignals(intentMemo).clarification;
    if (clarification === null) reviewRequired.push('CLARIFICATION_REVIEW_REQUIRED');
    else if (item.expected.needsClarification !== clarification) intentFailures.push('CLARIFICATION_BOUNDARY_BREACH');
    if (countMissingGroups(intentMemo, item.expected.objectGroups || []).length) reviewRequired.push('OBJECT_REVIEW_REQUIRED');
    if (!quotedEvidence(intentMemo).length) reviewRequired.push('EVIDENCE_REVIEW_REQUIRED');
    const business = businessFailures.length ? 'FAIL' : 'PASS';
    const policy = policyFailures.length ? 'FAIL' : 'PASS';
    const intent = intentFailures.length ? 'FAIL' : reviewRequired.length ? 'PARTIAL' : 'PASS';
    const overall = business === 'FAIL' || policy === 'FAIL' || intent === 'FAIL' ? 'FAIL' : intent === 'PARTIAL' ? 'PARTIAL' : 'PASS';
    return Object.freeze({ business, policy, intent, evaluator: intentFailures.length || businessFailures.length || policyFailures.length ? 'FAIL' : reviewRequired.length ? 'REVIEW_REQUIRED' : 'PASS', overall, businessFailures: [...new Set(businessFailures)], policyFailures: [...new Set(policyFailures)], intentFailures: [...new Set(intentFailures)], reviewRequired: [...new Set(reviewRequired)] });
}

module.exports = { GROUNDING_LANGUAGE, POLICY_LANGUAGE, clarificationSignal, evaluateMemo, invalidMarkedEvidence };
