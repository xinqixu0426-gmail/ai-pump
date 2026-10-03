'use strict';

const SAFE_VALIDATION_ANSWER = '本轮正式查询已完成，但无法验证回答中的业务事实；请根据正式查询结果重新查询。';
const BUSINESS_MODES = new Set(['READ', 'ANALYZE', 'PERSIST_MUTATION']);
const STATUSES = new Set(['COMPLETED', 'PARTIAL', 'UNAVAILABLE', 'CLARIFICATION']);

function validationFailure(code, detail = null) { return { valid: false, code, detail, answer: SAFE_VALIDATION_ANSWER }; }
function parseEnvelope(content) {
    const raw = String(content || '').trim();
    // Finalization asks for bare JSON, but provider formatting may wrap an
    // otherwise exact envelope in a single Markdown JSON fence.  Accept only
    // that whole-message form; do not search prose for an embedded envelope.
    const fenced = raw.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
    try { return JSON.parse(fenced ? fenced[1].trim() : raw); } catch { return null; }
}
function moneyMentions(answer) {
    const matches = [];
    const expression = /(?:¥|￥)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|CNY)|(?:毛利率|利润率|利润|毛利|成本|售价)[^。；，,]{0,18}?(\d+(?:\.\d+)?)\s*%/gi;
    let match;
    while ((match = expression.exec(answer))) matches.push(Number(match[1] || match[2] || match[3]));
    return matches.filter(Number.isFinite);
}
function moneyMentionDetails(answer) {
    const matches = [];
    const expression = /(?:¥|￥)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|CNY)|(?:毛利率|利润率|利润|毛利|成本|售价)[^。；，,]{0,18}?(\d+(?:\.\d+)?)\s*%/gi;
    let match;
    while ((match = expression.exec(answer))) {
        const rawValue = match[1] || match[2] || match[3];
        const value = Number(rawValue);
        if (!Number.isFinite(value)) continue;
        matches.push({ value, index: match.index + match[0].indexOf(rawValue), length: rawValue.length });
    }
    return matches;
}
function roundedMatch(value, facts) {
    return facts.some(fact => fact.unit === 'CNY' && Math.abs(Number(fact.value) - value) <= Math.max(0.02, Math.abs(value) * 0.001))
        || facts.some(fact => fact.unit === 'PERCENT' && (Math.abs(Number(fact.value) - value) <= 0.03
            || Math.abs(Number(fact.value) * 100 - value) <= 0.03));
}
function moneyRole(fact) {
    if (fact?.qualifiers?.moneyRole) return fact.qualifiers.moneyRole;
    const basis = String(fact?.basis || '');
    if (fact?.predicate === 'recipe_cost_difference') return 'RECIPE_DIFFERENCE';
    if (fact?.predicate === 'scenario_cost_difference') return 'SCENARIO_DIFFERENCE';
    if (fact?.predicate === 'scenario_cost') return fact?.qualifiers?.role === 'BASE' ? 'CURRENT_BASE' : 'SCENARIO_CANDIDATE';
    // Existing production facts predate moneyRole.  Preserve their formally
    // declared basis instead of treating all legacy scalar amounts as an
    // untyped generic number.
    if (/(?:SCENARIO|PREVIEW)/i.test(basis)) return 'SCENARIO_CANDIDATE';
    if (/(?:CURRENT|BASE)/i.test(basis)) return 'CURRENT_FORMAL';
    if (/^current_/i.test(String(fact?.predicate || ''))) return 'CURRENT_FORMAL';
    return 'GENERIC_MONEY';
}
function clauseClaimType(clause, mention = null) {
    if (mention) {
        const before = clause.slice(Math.max(0, mention.index - 64), mention.index);
        const around = clause.slice(Math.max(0, mention.index - 32), Math.min(clause.length, mention.index + mention.length + 16));
        const negatedCurrent = /(?:不是|并非|非|不代表|不属于).{0,10}(?:当前|现在|现有|基线|current).{0,10}(?:成本|报价|价格)?/i.test(clause);
        // A transition sentence can contain current, candidate, and delta
        // amounts.  Classify each amount from its own business assertion,
        // instead of applying one broad label to every number in the clause.
        if (/(?:差额|相差|增加|减少|高出|低于|成本差|贵|便宜)|(?:高|低)(?:出|于|了)?\s*$/.test(before)) return 'DIFFERENCE_AMOUNT';
        if (/(?:由|从)\s*$/.test(before)) return 'CURRENT_AMOUNT';
        if (/(?:变为|变成|至|到)\s*$/.test(before)) return 'SCENARIO_AMOUNT';
        if (/(?:改为|改用|调整|变更|启用|加入).{0,24}(?:后).{0,24}(?:成本|报价|价格).{0,8}$/i.test(before)) return 'SCENARIO_AMOUNT';
        if (!negatedCurrent && /(?:当前|现在|现有|基线|current).{0,16}(?:成本|报价|价格)?.{0,8}$/i.test(before)) return 'CURRENT_AMOUNT';
        if (/(?:差额|相差|增加|减少|高出|低于|成本差|贵|便宜)/.test(around)) return 'DIFFERENCE_AMOUNT';
        if (!negatedCurrent && /(?:当前|现在|现有|基线|current).{0,10}(?:成本|报价|价格)?/i.test(around)) return 'CURRENT_AMOUNT';
        if (/(?:场景|情景|调整后|变更后|试算|预览|加.{0,8}后|做.{0,8}后|scenario)/i.test(around)) return 'SCENARIO_AMOUNT';
    }
    const negativeCurrent = /(?:不是|并非|非|不代表|不属于).{0,10}(?:当前|现在|现有|基线|current).{0,10}(?:成本|报价|价格)?/i.test(clause);
    const difference = /(?:差额|相差|增加|减少|高出|低于|成本差|贵|便宜)|(?:高|低)(?:出|于|了)?\s*\d+(?:\.\d+)?\s*(?:元|CNY)/i.test(clause);
    const scenario = /(?:场景|情景|调整后|变更后|试算|预览|加.{0,8}后|做.{0,8}后)/i.test(clause);
    const current = !negativeCurrent && /(?:当前|现在|现有|基线|current).{0,10}(?:成本|报价|价格)?/i.test(clause);
    if (difference) return 'DIFFERENCE_AMOUNT';
    if (current) return 'CURRENT_AMOUNT';
    if (scenario) return 'SCENARIO_AMOUNT';
    return 'UNSPECIFIED_AMOUNT';
}
function participantsFor(fact) {
    const participants = fact?.qualifiers?.participants;
    return participants ? [participants.left?.canonicalName, participants.right?.canonicalName].filter(Boolean) : [];
}
function compatibilityFor(type, fact) {
    const role = moneyRole(fact);
    if (type === 'CURRENT_AMOUNT') return ['CURRENT_FORMAL', 'CURRENT_BASE'].includes(role);
    if (type === 'SCENARIO_AMOUNT') return role === 'SCENARIO_CANDIDATE';
    if (type === 'DIFFERENCE_AMOUNT') return ['SCENARIO_DIFFERENCE', 'RECIPE_DIFFERENCE'].includes(role);
    return role !== 'RECIPE_DIFFERENCE' && role !== 'SCENARIO_DIFFERENCE';
}
function bindingDetail({ claim, value, type, cited, allFacts, reason }) {
    const compatibleFactIds = allFacts.filter(fact => roundedMatch(value, [fact]) && compatibilityFor(type, fact)).map(fact => fact.factId);
    return { claimText: claim.text, amount: value, detectedClaimType: type, citedFactIds: cited.map(fact => fact.factId), compatibleFactIds, reason };
}
function claimMoneyBinding(claim, verified, allFacts) {
    const cited = claim.factIds.map(id => verified.get(id)).filter(Boolean);
    const clauses = claim.text.split(/[；;。]/).filter(Boolean);
    for (const clause of clauses) {
        for (const mention of moneyMentionDetails(clause)) {
            const { value } = mention;
            const namedEntities = [...new Set(allFacts.flatMap(fact => [fact?.entity?.canonicalName, ...participantsFor(fact)]).filter(Boolean))];
            const mentioned = namedEntities.filter(name => clause.includes(name));
            const type = clauseClaimType(clause, mention);
            // Pair participant validation is meaningful for a recipe-vs-
            // recipe difference.  Scenario deltas are bound to one entity and
            // their base/candidate scenario keys, not two entity participants.
            if (type === 'DIFFERENCE_AMOUNT' && mentioned.length >= 2 && cited.some(fact => moneyRole(fact) === 'RECIPE_DIFFERENCE')
                && !cited.some(fact => {
                    const pair = participantsFor(fact); return mentioned.every(name => pair.includes(name));
                })) return { valid: false, detail: bindingDetail({ claim, value, type, cited, allFacts, reason: 'WRONG_COMPARISON_PARTICIPANTS' }) };
            if (mentioned.length && !cited.some(fact => mentioned.includes(fact?.entity?.canonicalName) || participantsFor(fact).some(name => mentioned.includes(name)))) {
                return { valid: false, detail: bindingDetail({ claim, value, type, cited, allFacts, reason: 'WRONG_ENTITY' }) };
            }
            // An unknown named subject is not licensed merely because an equal
            // number belongs to a different cited entity.
            const subject = clause.match(/(?:^|[,，])\s*([A-Za-z][A-Za-z0-9_ -]{0,40})\s+(?:current|scenario\s+)?cost\s*(?:=|is|:)/i)
                || clause.match(/(?:^|[,，])\s*([\p{L}\p{N}-]{2,40})\s*(?:的)?(?:当前|场景|情景)?成本\s*(?:为|是|[:：])/u);
            if (!mentioned.length && subject && cited.some(fact => fact?.entity?.canonicalName)
                && !cited.some(fact => subject[1].trim() === fact?.entity?.canonicalName)) {
                return { valid: false, detail: bindingDetail({ claim, value, type, cited, allFacts, reason: 'WRONG_ENTITY' }) };
            }
            const matching = cited.filter(fact => roundedMatch(value, [fact]));
            if (!matching.length) {
                if (roundedMatch(value, allFacts)) return { valid: false, detail: bindingDetail({ claim, value, type, cited, allFacts, reason: type === 'DIFFERENCE_AMOUNT' ? 'MISSING_DIFFERENCE_FACT' : 'NO_MATCHING_AMOUNT_FACT' }) };
                continue; // The existing global parity check reports the unknown amount.
            }
            const compatible = matching.filter(fact => compatibilityFor(type, fact));
            if (!compatible.length) return { valid: false, detail: bindingDetail({ claim, value, type, cited, allFacts, reason: 'WRONG_MONEY_ROLE' }) };
            if (type === 'DIFFERENCE_AMOUNT' && mentioned.length >= 2 && compatible.some(fact => moneyRole(fact) === 'RECIPE_DIFFERENCE') && !compatible.some(fact => {
                const pair = participantsFor(fact); return mentioned.every(name => pair.includes(name));
            })) return { valid: false, detail: bindingDetail({ claim, value, type, cited, allFacts, reason: 'WRONG_COMPARISON_PARTICIPANTS' }) };
        }
    }
    return { valid: true, detail: null };
}
function expectedGoalIndexes(judge = {}) {
    const questions = Array.isArray(judge.questions) ? judge.questions : [];
    return questions.map((_, index) => index);
}

function validateAnswer(content, { ledger, judge = {}, mode = 'READ', proposalOnly = false } = {}) {
    const parsed = parseEnvelope(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return validationFailure('ANSWER_ENVELOPE_INVALID');
    const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
    const claims = Array.isArray(parsed.claims) ? parsed.claims : null;
    const goals = Array.isArray(parsed.goals) ? parsed.goals : null;
    if (!answer || !claims || !goals) return validationFailure('ANSWER_ENVELOPE_INVALID');
    // A preflight is intentionally not a successful business write.  Keep
    // this narrow semantic guard at the final-answer boundary so a model
    // cannot turn a proposal into an execution claim.
    if (proposalOnly && /(?:已经|已)(?:修改|保存|执行|完成)(?:成功)?/.test(answer)
        && !/(?:等待|仍需|请).{0,12}确认/.test(answer)) return validationFailure('PROPOSAL_SUCCESS_CLAIM');
    const facts = Array.isArray(ledger?.facts) ? ledger.facts : [];
    const verified = new Map(facts.filter(fact => fact?.verified === true).map(fact => [fact.factId, fact]));
    for (const claim of claims) {
        if (!claim || typeof claim.text !== 'string' || !Array.isArray(claim.factIds)) return validationFailure('CLAIM_UNGROUNDED', { reason: 'INVALID_CLAIM_SHAPE' });
        if (!answer.includes(claim.text)) return validationFailure('CLAIM_UNGROUNDED', { claimText: claim.text, reason: 'CLAIM_TEXT_NOT_IN_ANSWER' });
        if (claim.factIds.length === 0) return validationFailure('CLAIM_UNGROUNDED', { claimText: claim.text, reason: 'EMPTY_FACT_IDS' });
        if (claim.factIds.some(id => !verified.has(id))) return validationFailure('CLAIM_FACT_UNVERIFIED');
        const moneyBinding = claimMoneyBinding(claim, verified, facts);
        if (!moneyBinding.valid) return validationFailure('MONEY_CLAIM_BINDING_MISMATCH', moneyBinding.detail);
    }
    for (const clause of answer.split(/[；;。]/).map(item => item.trim()).filter(Boolean)) {
        if (moneyMentions(clause).length && !claims.some(claim => claim.text.includes(clause))) {
            return validationFailure('MONEY_CLAIM_UNCLAIMED', { claimText: clause, amounts: moneyMentions(clause), reason: 'MONEY_SENTENCE_NOT_CLAIMED' });
        }
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
