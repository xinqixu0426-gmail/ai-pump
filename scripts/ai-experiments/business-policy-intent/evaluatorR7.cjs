'use strict';

const r5 = require('./evaluatorR5.cjs');
const { normalize } = require('./contracts.cjs');

// The clarification oracle belongs to the frozen smoke-case definition.  This
// evaluator only recognizes how a memo expresses that predetermined decision;
// it never infers whether a case ought to be clarified from system capability.
const NO_CLARIFICATION = Object.freeze([
    /无需.{0,12}澄清/,
    /不需要.{0,12}澄清/,
    /没有语言缺口/,
    /语言(?:表达|信息).{0,16}(?:完整|明确|足够)/,
    /用户表达.{0,12}(?:完整|清楚|明确)/,
    /语言上(?:均已)?(?:明确|完整|清楚)/,
    /语言(?:上)?(?:信息)?(?:缺失|缺口)\s*(?:为|是)?\s*(?:无|没有|否|不需要|无需|不缺少)/,
    /没有发现语言(?:上)?(?:信息)?(?:缺失|缺口)/,
    /没有发现需要语言澄清/,
    /(?:是否)?(?:缺少)?语言(?:信息)?(?:需要)?澄清\s*(?:为|是)?\s*(?:没有|无|否|不需要|无需|不缺少)/,
    /是否需要语言澄清\s*(?:为|是)?\s*(?:没有|无|否|不需要|无需|不缺少)/,
    /需要澄清(?:的)?语言信息\s*(?:为|是)?\s*(?:没有|无|否|不需要|无需|不缺少)/,
    /需要澄清\s*(?:为|是)?\s*(?:否|不需要|无需|无|没有)/,
    /不缺少(?:语言)?(?:信息)?/,
]);

const POSITIVE_CLARIFICATION = /(?:需要|需|应当|仍需).{0,12}(?:澄清|确认|说明)|(?:对象|指代).{0,12}(?:未知|缺失|不明确)|(?:没有|未).{0,16}(?:改什么|改成什么|修改内容|指代对象|对象)/;

const REQUIRED_REASON = Object.freeze({
    CHANGE_DETAILS_MISSING: [
        /(?:没有|未).{0,16}(?:改什么|改成什么|修改内容|具体修改)/,
        /改什么.{0,20}改成什么/,
    ],
    TARGET_REFERENT_MISSING: [
        /(?:对象|目标|指代).{0,16}(?:未知|缺失|不明确|没有)/,
        /没有.{0,16}(?:对象|目标|指代)/,
    ],
    DEICTIC_REFERENT_MISSING: [
        /(?:这个|该对象).{0,20}(?:指代|对象).{0,16}(?:未知|缺失|不明确|没有)/,
        /没有.{0,20}(?:可恢复)?.{0,8}(?:指代|对象)/,
        /(?:指代|对象).{0,16}(?:未知|缺失|不明确)/,
    ],
});

function noClarificationSignal(memo) {
    const value = normalize(String(memo || '').replace(/[*#_]/g, ''));
    return NO_CLARIFICATION.some(pattern => pattern.test(value));
}

function clarificationSignalR7(item, memo) {
    const value = normalize(String(memo || '').replace(/[*#_]/g, ''));
    const expected = item.expected.clarificationExpectation;
    if (expected === 'NO_CLARIFICATION') {
        if (noClarificationSignal(value)) return 'NO_CLARIFICATION';
        if (POSITIVE_CLARIFICATION.test(value)) return 'CLARIFICATION_STATED';
        return 'REVIEW_REQUIRED';
    }
    if (expected === 'CLARIFICATION_REQUIRED') {
        const patterns = REQUIRED_REASON[item.expected.clarificationReason] || [];
        if (patterns.some(pattern => pattern.test(value)) && POSITIVE_CLARIFICATION.test(value)) return 'CLARIFICATION_REQUIRED';
        if (noClarificationSignal(value)) return 'NO_CLARIFICATION';
        return 'REVIEW_REQUIRED';
    }
    return 'REVIEW_REQUIRED';
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
    return { business, policy, intent, evaluator: intentFailures.length || businessFailures.length || policyFailures.length ? 'FAIL' : reviewRequired.length ? 'REVIEW_REQUIRED' : 'PASS', overall };
}

function evaluateMemo(item, output) {
    const base = r5.evaluateMemo(item, output);
    const businessFailures = [...base.businessFailures];
    const policyFailures = [...base.policyFailures];
    const intentFailures = base.intentFailures.filter(value => value !== 'CLARIFICATION_BOUNDARY_BREACH');
    const reviewRequired = base.reviewRequired.filter(value => value !== 'CLARIFICATION_REVIEW_REQUIRED');

    if (businessFailures.includes('BUSINESS_BOUNDARY_LEAK') && onlyScopeExclusions(output.businessMemo)) {
        businessFailures.splice(businessFailures.indexOf('BUSINESS_BOUNDARY_LEAK'), 1);
    }

    const clarification = clarificationSignalR7(item, output.intentMemo);
    if (item.expected.clarificationExpectation === 'NO_CLARIFICATION') {
        if (clarification === 'CLARIFICATION_STATED') intentFailures.push('CLARIFICATION_BOUNDARY_FAIL');
        if (clarification === 'REVIEW_REQUIRED') reviewRequired.push('CLARIFICATION_REVIEW_REQUIRED');
    } else if (item.expected.clarificationExpectation === 'CLARIFICATION_REQUIRED') {
        if (clarification === 'NO_CLARIFICATION') intentFailures.push('CLARIFICATION_BOUNDARY_FAIL');
        if (clarification === 'REVIEW_REQUIRED') reviewRequired.push('CLARIFICATION_REVIEW_REQUIRED');
    }

    if (item.expected.persistence === 'NOT_APPLICABLE' && !(item.expected.requiredChanges || []).length) {
        const index = reviewRequired.indexOf('PERSISTENCE_REVIEW_REQUIRED');
        if (index >= 0) reviewRequired.splice(index, 1);
    }
    if (item.expected.persistence === 'UNSPECIFIED' && /保存(?:表达|意图)?.{0,12}(?:未表达|没有表达|未说明)|(?:没有|未).{0,12}(?:表达|说明).{0,8}保存/.test(normalize(output.intentMemo))) {
        const index = reviewRequired.indexOf('PERSISTENCE_REVIEW_REQUIRED');
        if (index >= 0) reviewRequired.splice(index, 1);
    }
    if (item.expected.persistence === 'SAVE' && /(?:明确)?保存(?:信号|意图)?.{0,12}保存/.test(normalize(output.intentMemo))) {
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

module.exports = { ...r5, clarificationSignalR7, evaluateMemo };
