'use strict';

const r5 = require('./evaluatorR5.cjs');
const { normalize } = require('./contracts.cjs');

function clarificationSignalR6(memo) {
    const lines = String(memo || '').split(/\n/);
    const anchor = lines.map(line => /澄清|缺少语言|语言信息是否缺失/.test(line)).lastIndexOf(true);
    const subject = normalize(anchor >= 0 ? lines.slice(anchor, anchor + 3).join(' ') : memo);
    if (/对象未知|指代对象未知|无最近可恢复.{0,12}(?:指代|对象)|(?:指代|对象).{0,6}(?:未知|不明)|指代什么/.test(subject)) return true;
    if (/(?:未发现|未出现).{0,12}(?:必须)?澄清|没有发现语言.{0,12}(?:缺失|缺少)|(?:需要|需)澄清.{0,60}(?:不缺少|不需要|无需|无|否)|是否(?:缺少语言信息)?(?:需要|需)澄清.{0,60}(?:不缺少|不需要|无需|无|否)|语言(?:上)?(?:信息)?缺失.{0,12}(?:无|否|没有)|语言上均已明确/.test(subject)) return false;
    if (/(?:需要|应当|仍需).{0,8}(?:澄清|说明)|缺少.{0,16}(?:对象|配置|改成|变更|信息)|语言.{0,12}(?:缺少|缺失|不明确)/.test(subject)) return true;
    return null;
}

function onlyScopeExclusions(memo) {
    const value = String(memo || '');
    const lines = value.split(/\n|。/).filter(line => /(?:api|工具|tool|数据库|database|sql|executor|http)/i.test(line));
    return lines.length > 0 && lines.every(line => /(?:不提供|未定义|不解释|不包含|不涉及|不能)/.test(line));
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
    const clarification = clarificationSignalR6(output.intentMemo);
    if (clarification === null) reviewRequired.push('CLARIFICATION_REVIEW_REQUIRED');
    else if (clarification !== item.expected.needsClarification) intentFailures.push('CLARIFICATION_BOUNDARY_BREACH');
    if (item.expected.persistence === 'NOT_APPLICABLE' && !(item.expected.requiredChanges || []).length && /(?:没有|未).{0,12}(?:表达|说明).{0,8}保存/.test(normalize(output.intentMemo))) {
        const index = reviewRequired.indexOf('PERSISTENCE_REVIEW_REQUIRED');
        if (index >= 0) reviewRequired.splice(index, 1);
    }
    if (item.expected.persistence === 'SAVE' && /(?:明确)?保存信号.{0,12}保存/.test(normalize(output.intentMemo))) {
        const index = reviewRequired.indexOf('PERSISTENCE_REVIEW_REQUIRED');
        if (index >= 0) reviewRequired.splice(index, 1);
    }
    return Object.freeze({ ...status(businessFailures, policyFailures, intentFailures, reviewRequired), businessFailures: [...new Set(businessFailures)], policyFailures: [...new Set(policyFailures)], intentFailures: [...new Set(intentFailures)], reviewRequired: [...new Set(reviewRequired)] });
}

module.exports = { ...r5, clarificationSignalR6, evaluateMemo };
