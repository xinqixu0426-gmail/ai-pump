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

function operationalFactsForClaim(claim, verified) {
    return claim.factIds.map(id => verified.get(id)).filter(fact => fact?.qualifiers?.quantityRole);
}
function normalizeOperationalUnit(unit) {
    const normalized = String(unit || '').trim().toLowerCase();
    const aliases = {
        piece: 'piece', pieces: 'piece', '个': 'piece', '件': 'piece',
        set: 'set', sets: 'set', '套': 'set',
        count: 'count', '项': 'count', '条': 'count', '台': 'count',
        meter: 'meter', metres: 'meter', metre: 'meter', m: 'meter', '米': 'meter',
        kg: 'kg', kilogram: 'kg', kilograms: 'kg', '千克': 'kg', '公斤': 'kg',
    };
    return aliases[normalized] || normalized || null;
}
function operationalQuantityMentions(clause) {
    const matches = [];
    const expression = /(\d+(?:\.\d+)?)\s*(个|件|套|项|条|台|米|m\b|kg\b|千克|公斤|piece(?:s)?|set(?:s)?|count|meter(?:s)?|metre(?:s)?|kilogram(?:s)?)?/gi;
    let match;
    while ((match = expression.exec(clause))) {
        // Operational statements commonly contain several quantities.  A
        // role must come from this quantity's local phrase, not another
        // comma-separated quantity elsewhere in the sentence.
        const leftBoundary = Math.max(
            clause.lastIndexOf('，', match.index), clause.lastIndexOf(',', match.index),
            clause.lastIndexOf('；', match.index), clause.lastIndexOf(';', match.index),
            clause.lastIndexOf('。', match.index), clause.lastIndexOf('：', match.index),
            clause.lastIndexOf(':', match.index), clause.lastIndexOf('、', match.index),
            clause.lastIndexOf('\n', match.index),
        );
        const rightCandidates = ['，', ',', '；', ';', '。', '：', ':', '、', '\n']
            .map(separator => clause.indexOf(separator, match.index + match[0].length))
            .filter(index => index >= 0);
        const rightBoundary = rightCandidates.length ? Math.min(...rightCandidates) : clause.length;
        const context = clause.slice(leftBoundary + 1, rightBoundary).trim();
        const unit = normalizeOperationalUnit(match[2]);
        const contextOffset = match.index - (leftBoundary + 1);
        const before = context.slice(0, contextOffset);
        const after = context.slice(contextOffset + match[0].length);
        const previousCharacter = clause[match.index - 1] || '';
        const nextCharacter = clause[match.index + match[0].length] || '';
        // A number embedded in a code is not an operational quantity.  This
        // is lexical rather than a model-name blacklist: the guard covers
        // alphanumeric, underscore, dash and slash identifier segments.  A
        // recognized unit may follow a natural-language quantity, but never
        // rescues an identifier token such as PART-608个.
        const identifierAdjacent = /[A-Za-z0-9_\-/—–]/.test(previousCharacter)
            || /[A-Za-z0-9_\-/—–]/.test(nextCharacter);
        let role = null;
        if (!identifierAdjacent && unit === 'count'
            && (/(?:缺料|短缺)(?:清单)?(?:共(?:有)?|有)?\s*$/u.test(before)
                || /(?:有|共)\s*$/u.test(before) && /(?:缺料|短缺|库存不足)/u.test(after)
                || /(?:缺料|短缺|库存不足)/u.test(after))) role = 'SHORTAGE_LINE_COUNT';
        else if (!identifierAdjacent && /(?:缺|还差|短缺|不足)\s*$/u.test(before)) role = 'SHORTAGE';
        else if (!identifierAdjacent && /^(?:个|件|套|米|kg|千克|公斤)?\s*(?:缺口|短缺|不足)/iu.test(after)) role = 'SHORTAGE';
        else if (!identifierAdjacent && /(?:已入库|入库)\s*$/u.test(before)) role = 'STOCKED';
        else if (!identifierAdjacent && /(?:已到货|到货)\s*$/u.test(before)) role = 'RECEIVED';
        else if (!identifierAdjacent && /(?:已下单|下单)\s*$/u.test(before)) role = 'ORDERED';
        else if (!identifierAdjacent && /(?:待采购|待下单)\s*$/u.test(before)) role = 'PENDING_PURCHASE';
        else if (!identifierAdjacent && /(?:计划采购|计划)\s*$/u.test(before)) role = 'PLANNED_PURCHASE';
        else if (!identifierAdjacent && /(?:可用|库存)\s*$/u.test(before)) role = 'AVAILABLE';
        else if (!identifierAdjacent && /(?:需要|需用|需求)(?:数量)?\s*$/u.test(before)) role = 'REQUIRED';
        else if (!identifierAdjacent && /(?:订单数量|产品数量)\s*$/u.test(before)) role = 'ORDER_LINE';
        // A measured noun phrase such as "5米电缆" is a local quantity
        // expression. It is still rejected when embedded in an identifier
        // token above, and it retains a strict unit requirement.
        else if (!identifierAdjacent && unit && /^\s*[\u4e00-\u9fff]/u.test(after)) role = 'REQUIRED';
        if (role) matches.push({ value: Number(match[1]), unit, role, text: match[0], context });
    }
    return matches.filter(item => Number.isFinite(item.value));
}
function quantityFailure(reason, claim, mention, cited, allFacts) {
    return {
        valid: false,
        detail: {
            claimText: claim.text,
            amount: mention.value,
            detectedQuantityRole: mention.role,
            unit: mention.unit,
            citedFactIds: cited.map(fact => fact.factId),
            compatibleFactIds: allFacts.filter(fact => fact?.qualifiers?.quantityRole === mention.role
                && Number(fact.value) === mention.value).map(fact => fact.factId),
            reason,
        },
    };
}
function claimOperationalQuantityBinding(claim, verified, allFacts) {
    const cited = operationalFactsForClaim(claim, verified);
    if (!cited.length) return { valid: true, detail: null };
    const clauses = claim.text.split(/[；;。]/).filter(Boolean);
    for (const clause of clauses) {
        for (const mention of operationalQuantityMentions(clause)) {
            const matchingValue = cited.filter(fact => Math.abs(Number(fact.value) - mention.value) <= 0.000001);
            if (!matchingValue.length) return quantityFailure('NO_MATCHING_OPERATIONAL_QUANTITY_FACT', claim, mention, cited, allFacts);
            const matchingRole = matchingValue.filter(fact => fact.qualifiers.quantityRole === mention.role);
            if (!matchingRole.length) return quantityFailure('WRONG_QUANTITY_ROLE', claim, mention, cited, allFacts);
            if (!mention.unit) return quantityFailure('OPERATIONAL_UNIT_MISSING', claim, mention, cited, allFacts);
            if (!matchingRole.some(fact => normalizeOperationalUnit(fact.unit) === mention.unit)) {
                return quantityFailure('WRONG_OPERATIONAL_UNIT', claim, mention, cited, allFacts);
            }
            const names = [...new Set(allFacts.filter(fact => fact?.qualifiers?.quantityRole)
                .map(fact => fact?.entity?.canonicalName).filter(Boolean))];
            const mentioned = names.filter(name => mention.context.includes(name));
            if (mentioned.length && !matchingRole.some(fact => mentioned.includes(fact?.entity?.canonicalName))) {
                return quantityFailure('WRONG_OPERATIONAL_ENTITY', claim, mention, cited, allFacts);
            }
        }
    }
    return { valid: true, detail: null };
}
function claimCollectionCompletenessBinding(claim, verified) {
    if (!/(?:全部|所有|只有这些|仅有这些)/.test(claim.text)) return { valid: true, detail: null };
    const cited = claim.factIds.map(id => verified.get(id)).filter(Boolean);
    const operational = cited.some(fact => fact?.qualifiers?.quantityRole
        || ['readiness_status', 'unresolved_requirement', 'collection_completeness'].includes(fact?.predicate));
    if (!operational) return { valid: true, detail: null };
    const completeness = cited.filter(fact => fact?.predicate === 'collection_completeness');
    if (!completeness.some(fact => fact.value === 'COMPLETE' && fact.qualifiers?.complete === true)) {
        return { valid: false, detail: { claimText: claim.text, reason: 'PARTIAL_COLLECTION_CANNOT_CLAIM_ALL', citedFactIds: cited.map(fact => fact.factId) } };
    }
    return { valid: true, detail: null };
}
function claimNoShortageBinding(claim, verified) {
    if (!/(?:无|没有).{0,8}(?:缺料|短缺)|(?:未发现).{0,8}(?:缺料|短缺)/.test(claim.text)) return { valid: true, detail: null };
    const cited = claim.factIds.map(id => verified.get(id)).filter(Boolean);
    // Readiness is a formal producer verdict, not an English-only enum.  A
    // producer may render READY as 可生产 while retaining the authoritative
    // canProduce boolean.  Both are required to be formal facts; text alone
    // never proves an empty shortage set.
    const readinessReady = cited.some(fact => fact?.predicate === 'readiness_status'
        && (fact?.qualifiers?.unresolvedLineCount == null || Number(fact.qualifiers.unresolvedLineCount) === 0)
        && (['READY', 'ready'].includes(String(fact.value)) || fact?.qualifiers?.canProduce === true));
    const completeEmpty = cited.some(fact => fact?.predicate === 'collection_completeness'
        && fact.value === 'COMPLETE' && fact.qualifiers?.complete === true
        && Number(fact.qualifiers?.returnedCount) === 0 && Number(fact.qualifiers?.totalCount) === 0);
    return readinessReady && completeEmpty
        ? { valid: true, detail: null }
        : { valid: false, detail: { claimText: claim.text, reason: 'NO_SHORTAGE_REQUIRES_COMPLETE_FORMAL_RESULT', citedFactIds: cited.map(fact => fact.factId) } };
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
        const operationalBinding = claimOperationalQuantityBinding(claim, verified, facts);
        if (!operationalBinding.valid) return validationFailure('OPERATIONAL_QUANTITY_BINDING_MISMATCH', operationalBinding.detail);
        const completenessBinding = claimCollectionCompletenessBinding(claim, verified);
        if (!completenessBinding.valid) return validationFailure('COLLECTION_COMPLETENESS_MISMATCH', completenessBinding.detail);
        const noShortageBinding = claimNoShortageBinding(claim, verified);
        if (!noShortageBinding.valid) return validationFailure('COLLECTION_COMPLETENESS_MISMATCH', noShortageBinding.detail);
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

module.exports = { SAFE_VALIDATION_ANSWER, validateAnswer, operationalQuantityMentions };
