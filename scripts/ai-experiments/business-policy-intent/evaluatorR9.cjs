'use strict';

const r5 = require('./evaluatorR5.cjs');
const { containsAny, normalize } = require('./contracts.cjs');

const UTTERANCE_SCOPE_LANGUAGE = Object.freeze([
    '澄清', '需要确认', '正式身份', 'canonical', '候选', 'grounding', '具体方案',
    '数据库', '当前配置', '比较基准', '后续绑定', 'planner', 'tool', 'api',
    'preview', 'persist', 'mutation', '写入授权', '业务动作',
]);

function currentMessageEvidenceFailures(memo, item) {
    return r5.invalidMarkedEvidence(memo, { ...item, recentConversation: '' });
}

function onlyScopeExclusions(memo) {
    const lines = String(memo || '').split(/\n|。/).filter(line => /(?:api|工具|tool|数据库|database|sql|executor|http)/i.test(line));
    return lines.length > 0 && lines.every(line => /(?:不提供|未定义|不解释|不包含|不涉及|不能|不应|不判断|不会)/.test(line));
}

function status(businessFailures, policyFailures, utteranceFailures, reviewRequired) {
    const business = businessFailures.length ? 'FAIL' : 'PASS';
    const policy = policyFailures.length ? 'FAIL' : 'PASS';
    const utterance = utteranceFailures.length ? 'FAIL' : reviewRequired.length ? 'PARTIAL' : 'PASS';
    const overall = business === 'FAIL' || policy === 'FAIL' || utterance === 'FAIL' ? 'FAIL' : utterance === 'PARTIAL' ? 'PARTIAL' : 'PASS';
    return { business, policy, utterance, evaluator: businessFailures.length || policyFailures.length || utteranceFailures.length ? 'FAIL' : reviewRequired.length ? 'REVIEW_REQUIRED' : 'PASS', overall };
}

function persistenceReviewIsSatisfied(memo, expected) {
    const compact = normalize(memo);
    if (expected === 'SAVE') return /(?:明确)?保存/.test(compact) && !/不保存/.test(compact);
    if (expected === 'DO_NOT_SAVE') return /不保存|先算一下|只试算/.test(compact);
    if (expected === 'UNSPECIFIED') return /(?:没有|未).{0,12}(?:表达|说明).{0,8}保存|保存.{0,12}(?:未明确|未表达|没有说明|没有表达)/.test(compact);
    return /不涉及.{0,8}保存|(?:没有|未).{0,12}(?:表达|说明).{0,8}保存/.test(compact);
}

function explicitlySaysNoCondition(memo) {
    return /(?:条件\s*\/\s*描述|条件|描述)\s*[：:]\s*(?:无|没有|未表达)/.test(String(memo || ''));
}

function sectionContent(memo, label) {
    const lines = String(memo || '').split('\n');
    const start = lines.findIndex(line => new RegExp(`(?:^|[#*\\-\\s])${label}\\s*[：:]?`, 'i').test(line));
    if (start < 0) return null;
    const captured = [];
    for (const line of lines.slice(start)) {
        if (captured.length && /^(?:\s*#{1,6}|\s*[-*]\s*\*{0,2}(?:提到|条件\s*\/\s*描述|想知道|保存表达)\*{0,2}\s*[：:])/.test(line)) break;
        captured.push(line);
    }
    return captured.join('\n');
}

function evaluateMemo(item, output) {
    const base = r5.evaluateMemo(item, { ...output, intentMemo: output.utteranceMemo });
    const businessFailures = [...base.businessFailures];
    const policyFailures = [...base.policyFailures];
    const utteranceFailures = [];
    const reviewRequired = [];
    const utteranceMemo = String(output.utteranceMemo || '');

    if (businessFailures.includes('BUSINESS_BOUNDARY_LEAK') && onlyScopeExclusions(output.businessMemo)) {
        businessFailures.splice(businessFailures.indexOf('BUSINESS_BOUNDARY_LEAK'), 1);
    }

    if (containsAny(utteranceMemo, UTTERANCE_SCOPE_LANGUAGE) || /\b(?:recipe|coil|part|template)Id\b/i.test(utteranceMemo)) {
        utteranceFailures.push('UTTERANCE_SCOPE_LEAK');
    }
    if (currentMessageEvidenceFailures(utteranceMemo, item).length) utteranceFailures.push('MEMO_CONTEXT_AS_EVIDENCE');
    for (const phrase of item.expected.forbiddenInferences || []) {
        if (containsAny(utteranceMemo, [phrase])) utteranceFailures.push('UNSUPPORTED_INFERENCE');
    }
    if (item.expected.noObjectInference && containsAny(utteranceMemo, item.expected.noObjectInference)) {
        utteranceFailures.push('UNSUPPORTED_INFERENCE');
    }
    const mentionGroups = item.expected.requiredMentions?.length ? item.expected.requiredMentions : (item.expected.objectGroups || []);
    const mentions = sectionContent(utteranceMemo, '提到') || utteranceMemo;
    const conditions = sectionContent(utteranceMemo, '条件\\s*\\/\\s*描述|条件|描述') || utteranceMemo;
    const information = sectionContent(utteranceMemo, '想知道') || utteranceMemo;
    for (const group of mentionGroups) {
        if (!containsAny(mentions, group)) utteranceFailures.push('MENTION_OMITTED');
    }
    for (const group of item.expected.requiredConditions || []) {
        if (explicitlySaysNoCondition(utteranceMemo) || !containsAny(conditions, group)) utteranceFailures.push('CONDITION_DESCRIPTION_OMITTED');
    }
    for (const group of item.expected.requiredInformation || []) {
        if (!containsAny(information, group)) utteranceFailures.push('INFORMATION_REQUEST_OMITTED');
    }
    if (!persistenceReviewIsSatisfied(utteranceMemo, item.expected.persistence)) reviewRequired.push('PERSISTENCE_REVIEW_REQUIRED');

    return Object.freeze({
        ...status(businessFailures, policyFailures, utteranceFailures, reviewRequired),
        businessFailures: [...new Set(businessFailures)],
        policyFailures: [...new Set(policyFailures)],
        utteranceFailures: [...new Set(utteranceFailures)],
        reviewRequired: [...new Set(reviewRequired)],
    });
}

module.exports = { UTTERANCE_SCOPE_LANGUAGE, currentMessageEvidenceFailures, onlyScopeExclusions, evaluateMemo };
