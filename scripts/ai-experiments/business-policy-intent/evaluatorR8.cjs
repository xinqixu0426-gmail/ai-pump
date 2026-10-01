'use strict';

const r5 = require('./evaluatorR5.cjs');
const { containsAny, normalize } = require('./contracts.cjs');

const INTENT_SCOPE_LANGUAGE = Object.freeze([
    '澄清', '语言缺口', '语言完整', '对象不明确', '正式身份', 'canonical',
    '候选', 'grounding', '具体方案', '数据库', '当前配置', '比较基准',
    '应该先确认', '后续绑定', 'preview', 'persist', 'planner', 'tool', 'api',
]);

function currentMessageEvidenceFailures(memo, item) {
    return r5.invalidMarkedEvidence(memo, { ...item, recentConversation: '' });
}

function onlyScopeExclusions(memo) {
    const lines = String(memo || '').split(/\n|。/).filter(line => /(?:api|工具|tool|数据库|database|sql|executor|http)/i.test(line));
    return lines.length > 0 && lines.every(line => /(?:不提供|未定义|不解释|不包含|不涉及|不能|不应)/.test(line));
}

function status(businessFailures, policyFailures, intentFailures, reviewRequired) {
    const business = businessFailures.length ? 'FAIL' : 'PASS';
    const policy = policyFailures.length ? 'FAIL' : 'PASS';
    const intent = intentFailures.length ? 'FAIL' : reviewRequired.length ? 'PARTIAL' : 'PASS';
    const overall = business === 'FAIL' || policy === 'FAIL' || intent === 'FAIL' ? 'FAIL' : intent === 'PARTIAL' ? 'PARTIAL' : 'PASS';
    return { business, policy, intent, evaluator: businessFailures.length || policyFailures.length || intentFailures.length ? 'FAIL' : reviewRequired.length ? 'REVIEW_REQUIRED' : 'PASS', overall };
}

function evaluateMemo(item, output) {
    const base = r5.evaluateMemo(item, output);
    const businessFailures = [...base.businessFailures];
    const policyFailures = [...base.policyFailures];
    const intentFailures = base.intentFailures.filter(value => !['CLARIFICATION_BOUNDARY_BREACH', 'GROUNDING_LEAK', 'POLICY_TO_INTENT_LEAK', 'INTENT_IMPLEMENTATION_OR_ID_LEAK', 'MEMO_CONTEXT_AS_EVIDENCE'].includes(value));
    const reviewRequired = base.reviewRequired.filter(value => !['CLARIFICATION_REVIEW_REQUIRED'].includes(value));
    const intentMemo = String(output.intentMemo || '');

    if (businessFailures.includes('BUSINESS_BOUNDARY_LEAK') && onlyScopeExclusions(output.businessMemo)) {
        businessFailures.splice(businessFailures.indexOf('BUSINESS_BOUNDARY_LEAK'), 1);
    }
    if (containsAny(intentMemo, INTENT_SCOPE_LANGUAGE) || /\b(?:recipe|coil|part|template)Id\b/i.test(intentMemo)) {
        intentFailures.push('INTENT_SCOPE_LEAK');
    }
    if (currentMessageEvidenceFailures(intentMemo, item).length) intentFailures.push('MEMO_CONTEXT_AS_EVIDENCE');
    for (const group of item.expected.requiredMentions || []) {
        if (!containsAny(intentMemo, group)) intentFailures.push('EXPLICIT_MENTION_OMITTED');
    }
    const compactIntent = normalize(intentMemo).replace(/[*#_-]/g, '');
    if ((item.expected.requiredChanges || []).length && /明确变化(?:无|没有明确变化|未表达)/.test(compactIntent)) {
        intentFailures.push('EXPLICIT_CHANGE_OMITTED');
    }
    if (item.expected.persistence === 'NOT_APPLICABLE' && !(item.expected.requiredChanges || []).length) {
        const index = reviewRequired.indexOf('PERSISTENCE_REVIEW_REQUIRED');
        if (index >= 0) reviewRequired.splice(index, 1);
    }
    if (item.expected.persistence === 'UNSPECIFIED' && /保存(?:表达|意图)?.{0,12}(?:未表达|没有表达|未说明)|(?:没有|未).{0,12}(?:表达|说明).{0,8}保存/.test(normalize(intentMemo))) {
        const index = reviewRequired.indexOf('PERSISTENCE_REVIEW_REQUIRED');
        if (index >= 0) reviewRequired.splice(index, 1);
    }
    if (item.expected.persistence === 'DO_NOT_SAVE' && /保存(?:表达|意图)?.{0,12}(?:明确)?不保存/.test(normalize(intentMemo))) {
        const index = reviewRequired.indexOf('PERSISTENCE_REVIEW_REQUIRED');
        if (index >= 0) reviewRequired.splice(index, 1);
    }
    if (item.expected.persistence === 'SAVE' && /(?:明确)?保存(?:信号|意图)?.{0,12}保存/.test(normalize(intentMemo))) {
        const index = reviewRequired.indexOf('PERSISTENCE_REVIEW_REQUIRED');
        if (index >= 0) reviewRequired.splice(index, 1);
    }
    return Object.freeze({
        ...status(businessFailures, policyFailures, intentFailures, reviewRequired),
        businessFailures: [...new Set(businessFailures)],
        policyFailures: [...new Set(policyFailures)],
        intentFailures: [...new Set(intentFailures)],
        reviewRequired: [...new Set(reviewRequired)],
    });
}

module.exports = { INTENT_SCOPE_LANGUAGE, currentMessageEvidenceFailures, evaluateMemo };
