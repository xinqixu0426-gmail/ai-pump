'use strict';

const SAFE_VALIDATION_ANSWER = '本轮正式查询已完成，但无法验证回答中的业务事实；请根据正式查询结果重新查询。';
const BUSINESS_MODES = new Set(['READ', 'ANALYZE', 'PERSIST_MUTATION']);
const STATUSES = new Set(['COMPLETED', 'PARTIAL', 'UNAVAILABLE', 'CLARIFICATION']);

function validationFailure(code, detail = null) { return { valid: false, code, detail, answer: SAFE_VALIDATION_ANSWER }; }
function parseEnvelope(content) {
    try { return JSON.parse(String(content || '')); } catch { return null; }
}
function moneyMentions(answer) {
    const matches = [];
    const expression = /(?:¥|￥)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|CNY)|(?:毛利率|利润率|利润|毛利|成本|售价)[^。；，,]{0,18}?(\d+(?:\.\d+)?)\s*%/gi;
    let match;
    while ((match = expression.exec(answer))) matches.push(Number(match[1] || match[2] || match[3]));
    return matches.filter(Number.isFinite);
}
function roundedMatch(value, facts) {
    return facts.some(fact => fact.unit === 'CNY' && Math.abs(Number(fact.value) - value) <= Math.max(0.02, Math.abs(value) * 0.001))
        || facts.some(fact => fact.unit === 'PERCENT' && (Math.abs(Number(fact.value) - value) <= 0.03
            || Math.abs(Number(fact.value) * 100 - value) <= 0.03));
}
function expectedGoalIndexes(judge = {}) {
    const questions = Array.isArray(judge.questions) ? judge.questions : [];
    return questions.map((_, index) => index);
}

function validateAnswer(content, { ledger, judge = {}, mode = 'READ' } = {}) {
    const parsed = parseEnvelope(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return validationFailure('ANSWER_ENVELOPE_INVALID');
    const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
    const claims = Array.isArray(parsed.claims) ? parsed.claims : null;
    const goals = Array.isArray(parsed.goals) ? parsed.goals : null;
    if (!answer || !claims || !goals) return validationFailure('ANSWER_ENVELOPE_INVALID');
    const facts = Array.isArray(ledger?.facts) ? ledger.facts : [];
    const verified = new Map(facts.filter(fact => fact?.verified === true).map(fact => [fact.factId, fact]));
    for (const claim of claims) {
        if (!claim || typeof claim.text !== 'string' || !answer.includes(claim.text) || !Array.isArray(claim.factIds) || claim.factIds.length === 0) return validationFailure('CLAIM_UNGROUNDED');
        if (claim.factIds.some(id => !verified.has(id))) return validationFailure('CLAIM_FACT_UNVERIFIED');
    }
    const expected = expectedGoalIndexes(judge);
    if (goals.length !== expected.length || new Set(goals.map(goal => goal?.questionIndex)).size !== expected.length
        || expected.some(index => !goals.some(goal => goal?.questionIndex === index))) return validationFailure('GOAL_STATUS_MISSING');
    for (const goal of goals) {
        if (!STATUSES.has(goal?.status) || !Array.isArray(goal.factIds) || goal.factIds.some(id => !verified.has(id))) return validationFailure('GOAL_STATUS_INVALID');
        if (goal.status === 'COMPLETED' && BUSINESS_MODES.has(mode) && goal.factIds.length === 0) return validationFailure('GOAL_COMPLETION_UNGROUNDED');
        if (goal.status === 'COMPLETED' && BUSINESS_MODES.has(mode)
            && !goal.factIds.some(id => !['identity_resolved', 'identity_ambiguous', 'identity_not_found'].includes(verified.get(id)?.predicate))) {
            return validationFailure('GOAL_COMPLETION_NO_BUSINESS_FACT');
        }
    }
    if (/\b(?:partId|recipeId|coilId|canonicalId|confirmationToken|operationId|idempotencyKey|argsHash|F-\d+)\b|(?:零件|配方|线圈|订单|客户)\s*(?:ID|编号)\s*[:：#]?\s*\d+/i.test(answer)) return validationFailure('ANSWER_INTERNAL_IDENTIFIER');
    const mentions = moneyMentions(answer);
    if (mentions.some(value => !roundedMatch(value, facts))) return validationFailure('MONEY_CLAIM_UNGROUNDED');
    if (/(?:未找到|不存在|没有(?:订单|报价|记录|结果))/.test(answer)
        && !facts.some(fact => ['identity_not_found', 'query_no_results'].includes(fact.predicate))) return validationFailure('NEGATIVE_CLAIM_UNGROUNDED');
    return Object.freeze({ valid: true, answer, claims, goals, code: 'ANSWER_VERIFIED' });
}

module.exports = { SAFE_VALIDATION_ANSWER, validateAnswer };
