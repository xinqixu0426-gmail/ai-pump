'use strict';

const { validateTaskProposalV1 } = require('./aiTaskValidationV2.cjs');
// E2-R1：配方成本比较的语义**只有一个权威**：E1-B 已建立的业务语义层
// （`classifyQuestion` → COST_COMPARISON + `comparisonSubjects`）。Task V2 不另造比较语义，
// 只把它正式接入 Goal Contract（RECIPE_COST_COMPARISON + 双主体）。
const { classifyQuestion } = require('../business-semantics/questionSemantics.cjs');

const EXTRACTION_TOOL = Object.freeze({ type: 'function', function: { name: 'submit_ai_task_proposal_candidate_v1', description: 'Return only a TaskProposalV1 candidate; this is not an executable business tool.', parameters: { type: 'object', additionalProperties: false, properties: { proposal: { type: 'object' } }, required: ['proposal'] } } });
const CRITICAL = /(?:\d+(?:\.\d+)?\s*(?:米|m|cm|毫米|mm|台|pcs|件|元\/公斤|元\/千克|元\/吨)|铜价\s*\d+(?:\.\d+)?|线重\s*\d+(?:\.\d+)?|(?:去掉|不要|删除)(?:珍珠棉|泡沫|外包装箱)|(?:全部包装不要|清空全部包装|不要任何包装)|先不要保存|不要保存|不要修改|别改|只看|只查|只试算|暂时不落库|其他不变|其它不变|不带(?:浮球|电缆)|不要(?:浮球|电缆)|改成[^，。；,;！!？?]*|换成[^，。；,;！!？?]*|用[^，。；,;！!？?]*)/giu;
const WRITE = /(?:保存|更新|修改配方|正式配方|确认后帮我改|调整库存|创建订单|删除|入库|出库|转订单)/gu;
const FORBID = /(?:先不要保存|不要保存|不要修改|别改|只看|只查|只试算|先算一下|暂时不落库)/gu;
const PROFIT_INTENT = /(?:利润|毛利|毛利率|加价率|赚多少|亏多少|盈利)/gu;
// FAMILY-03：线圈可用量的口语说法同样是库存意图（作为 INVENTORY_QUERY 的 grounding 证据）。
const INVENTORY_INTENT = /(?:库存|有货|够不够|缺多少料|还差什么|齐料|还有多少|还剩|剩多少|余量|有库存|还有货|(?:再)?(?:做|生产)\s*\d+\s*(?:台|pcs|件))/gu;
const VIRTUAL_READINESS_INTENT = /(?:再(?:做|生产)|(?:库存|物料).{0,12}够不够|够不够|缺多少料|还差什么|齐料|(?:再)?(?:做|生产)\s*\d+\s*(?:台|pcs|件))/u;
function span(messageRef, text, quote, startHint = null) { const first = startHint != null && text.slice(startHint, startHint + quote.length) === quote ? startHint : text.indexOf(quote); if (first < 0 || text.indexOf(quote, first + 1) >= 0) return null; return { messageRef, start: first, end: first + quote.length, text: quote }; }
function scanCriticalUserSpansV2({ messageRef, text }) { const values = []; for (const match of text.matchAll(CRITICAL)) { const value = span(messageRef, text, match[0], match.index); if (value) values.push(value); } return values; }
function subjectMentions(messageRef, text) {
    const result = []; const seen = new Set();
    const add = (mention, typeHints, index) => {
        const key = `${typeHints.join(',')}:${mention}`;
        if (!mention || seen.has(key)) return;
        const source = span(messageRef, text, mention, index);
        if (!source) return;
        seen.add(key);
        result.push({ subjectKey: `subject_${result.length + 1}`, mention, typeHints, sources: [source] });
    };
    // These are candidate mentions only.  Formal identity remains the Task V2
    // controller's responsibility and is always obtained through a capability.
    for (const match of text.matchAll(/(?:\bV\d+|\b\d{1,2}-\d{2,3}\b)/giu)) add(match[0], /^V\d+/iu.test(match[0]) ? ['recipe'] : ['coil'], match.index);
    for (const match of text.matchAll(/(?:订单\s*#?\d+|订单号\s*#?\d+)/giu)) add(match[0], ['order'], match.index);
    for (const match of text.matchAll(/([A-Za-z][A-Za-z0-9_-]{1,48})\s*客户/gu)) add(match[1], ['customer'], match.index);
    for (const match of text.matchAll(/(?:报价\s*#?\d+|报价单\s*#?\d+)/giu)) add(match[0], ['quotation'], match.index);
    return result;
}
function serverDirectives(messageRef, text) { const forbidden = [...text.matchAll(FORBID)].map(match => span(messageRef, text, match[0], match.index)).filter(Boolean); const write = [...text.matchAll(WRITE)].map(match => span(messageRef, text, match[0], match.index)).filter(Boolean); const policy = forbidden.length || !write.length ? 'FORBIDDEN' : 'CONFIRMATION_REQUIRED'; return { businessWritePolicy: policy, businessWritePolicySources: policy === 'FORBIDDEN' ? forbidden : write, scenarioInheritance: [] }; }

// ── E2-R1 FAMILY-01：配方成本比较（唯一权威 = E1-B 业务语义层）──────────────
// 比较意图 + 金额口径 + 两个配方主体 → 两个**正式双主体**目标。
// 语义判定完全复用 `classifyQuestion`（COST_COMPARISON），Task V2 不另造比较语义；
// 这里只把它的 `comparisonSubjects` 落到当前用户文本的精确 span 上。
// 定位不到（或两个主体同名）时返回 null —— fail-closed，绝不猜主体。
const COIL_COMPARISON_INTENT = /(?:差(?:多少|价|额|了)?|贵多少|便宜多少|高多少|低多少|哪个[^，。？?]{0,12}(?:高|低|贵|便宜)|比较|对比)/u;
// 句子本身还包含「配置变更 / 其它目标」时，业务语义层的 COST_COMPARISON 只是粗粒度拆词的产物
// （例如「V550电缆改成5米，和当前成本比较，卖340元…」），这些句子必须保留原有目标，
// 不能被单主体成本比较覆盖。
const COMPARISON_COMPETING_INTENT = /(?:改成|换成|改为|换电缆|换线|换线圈|替换|去掉|不要|不带|毛利|利润|毛利率|赚|够不够|齐料|缺多少|保存|修改|试算)/u;
// 比较主体必须是**可解析的实体标识**，不能是拆词残留（「当前」「V550电缆改成5米」）。
const COMPARISON_SUBJECT_REJECT = /(?:改成|换成|改为|换|替换|卖|赚|做|生产|库存|成本|价格|单价|比较|对比|当前|现在|毛利|利润|多少|台|米|元)/u;

function comparisonIsPrimary(text) { return !COMPARISON_COMPETING_INTENT.test(String(text || '')); }
function isComparisonSubjectMention(mention) {
    const value = String(mention || '').trim();
    return value.length >= 2 && value.length <= 40 && /[A-Za-z0-9]/u.test(value) && !COMPARISON_SUBJECT_REJECT.test(value);
}
/**
 * 语义层的拆词可能留下尾部语气/程度残留（例如「PHASED-浮球-有 高一点」）。
 * 这里按空白逐个去掉**不在用户文本中连续出现**的尾部片段，直到剩下的部分真的能定位，
 * 从而既能接住口语问法，又不会凭空造主体。
 */
function locateComparisonSubject(messageRef, text, mention) {
    const direct = span(messageRef, text, mention);
    if (direct) return direct;
    const tokens = String(mention).trim().split(/\s+/u);
    for (let end = tokens.length - 1; end >= 1; end -= 1) {
        const candidate = tokens.slice(0, end).join(' ');
        const located = span(messageRef, text, candidate);
        if (located && isComparisonSubjectMention(candidate)) return located;
    }
    return null;
}
/** 语义层判定为成本比较（且不是被其它意图污染的句子）时返回 'COMPARISON'，否则 null。 */
function recipeCostComparisonIntent(text) {
    if (!comparisonIsPrimary(text)) return null;
    return classifyQuestion(text).kind === 'COST_COMPARISON' ? 'COMPARISON' : null;
}
/**
 * 两个**可解析**的配方比较主体。语义判定来自 E1-B 业务语义层；
 * 但只要有一个主体无法在当前文本中唯一定位（或被判为拆词残留），就返回 null（fail-closed）。
 */
function recipeCostComparisonSubjects(messageRef, text) {
    if (recipeCostComparisonIntent(text) === null) return null;
    const semantics = classifyQuestion(text);
    if (!Array.isArray(semantics.comparisonSubjects) || semantics.comparisonSubjects.length !== 2) return null;
    const subjects = [];
    for (const mention of semantics.comparisonSubjects) {
        const located = locateComparisonSubject(messageRef, text, String(mention));
        if (!located) return null;
        subjects.push({ mention: located.text, source: located });
    }
    return subjects[0].mention === subjects[1].mention ? null : subjects;
}

/** 保证提案里存在该 mention 的主体（用于把服务器解析出的比较主体写进候选提案）。 */
function ensureComparisonSubject(subjects, messageRef, text, mention, source) {
    const existing = subjects.find(item => item.mention === mention);
    if (existing) { if (!existing.typeHints.includes('recipe')) existing.typeHints = [...existing.typeHints, 'recipe']; return existing; }
    const subject = { subjectKey: `subject_${subjects.length + 1}`, mention, typeHints: ['recipe'], sources: [span(messageRef, text, mention) || source] };
    subjects.push(subject);
    return subject;
}

function nextGoalKey(goals) {
    let index = 1;
    const keys = new Set((goals || []).map(goal => goal.goalKey));
    while (keys.has(`goal_${index}`)) index += 1;
    return `goal_${index}`;
}

/**
 * 服务器权威地写入比较目标。模型对这个比较句给出的「单主体当前成本」解读是**错误范围**，
 * 必须删除；比较目标的两个主体由服务器从用户文本解析，模型没有选择主体的权力。
 */
function enforceRecipeCostComparison(proposal, { messageRef, text }) {
    const detected = recipeCostComparisonSubjects(messageRef, text);
    if (!detected) {
        // 语义层判定为比较、但服务器无法定位两个主体：fail-closed，删掉单主体成本解读，
        // 绝不用「其中一个配方的当前成本」冒充比较结果。
        if (recipeCostComparisonIntent(text) === 'COMPARISON') {
            proposal.goals = (proposal.goals || []).filter(goal => !['CURRENT_COST', 'CONFIGURATION_COMPARE'].includes(goal.kind));
        }
        return proposal;
    }
    const subjects = Array.isArray(proposal.subjects) ? proposal.subjects : [];
    const subjectKeys = detected.map(item => ensureComparisonSubject(subjects, messageRef, text, item.mention, item.source).subjectKey);
    if (subjectKeys[0] === subjectKeys[1]) return proposal;
    proposal.subjects = subjects;
    // 主体兼容性：模型的单主体成本目标往往绑定在 `V550` 这类**简写**主体上，
    // 而比较主体是完整名称（`v550-tokoy`）；按 mention 兼容性删除错误范围的单主体成本目标。
    const comparisonMentions = detected.map(item => item.mention.toLowerCase());
    const subjectByKey = new Map(subjects.map(subject => [subject.subjectKey, subject]));
    const compatible = mention => {
        const value = String(mention || '').toLowerCase();
        return Boolean(value) && comparisonMentions.some(item => item.includes(value) || value.includes(item));
    };
    proposal.goals = (proposal.goals || []).filter(goal => {
        if (!['CURRENT_COST', 'CONFIGURATION_COMPARE'].includes(goal.kind)) return true;
        const keys = Array.isArray(goal.subjectKeys) ? goal.subjectKeys : [];
        return !keys.length ? false : !keys.every(key => compatible(subjectByKey.get(key)?.mention));
    });
    const existing = proposal.goals.find(goal => goal.kind === 'RECIPE_COST_COMPARISON');
    if (existing) existing.subjectKeys = subjectKeys;
    else proposal.goals.push({
        goalKey: nextGoalKey(proposal.goals), kind: 'RECIPE_COST_COMPARISON',
        description: '比较两个正式配方的当前完整成本', subjectKeys, scenarioKeys: [],
        dependsOn: [], requestedBasis: 'CURRENT', sources: [detected[0].source], quantity: null, unitPrice: null,
    });
    return proposal;
}

function overrideFor(messageRef, text) { const values = []; const cable = /(?:电缆|线缆)[^，。；,;！!？?]{0,8}?(\d+(?:\.\d+)?)\s*(米|m|cm)/iu.exec(text); if (cable) { const quote = cable[0]; const source = span(messageRef, text, quote, cable.index); let value = Number(cable[1]); if (/cm/iu.test(cable[2])) value /= 100; values.push({ field: 'cableLength', value, unit: 'm', sources: [source] }); }
    // The prefix may contain verbs such as “换成”, but must never consume a digit from
    // the shorthand itself ("线圈换成12-220" previously became "2-220").
    const coil = /(?:线圈[^\d，。；,;！!？?]{0,8})?(\d{1,2}-\d{2,3})/iu.exec(text); if (coil && /(?:换|改|用)/u.test(text)) { const source = span(messageRef, text, coil[1], coil.index + coil[0].lastIndexOf(coil[1])); values.push({ field: 'coilSelection', value: coil[1], unit: null, sources: [source] }); }
    for (const [pattern, field, value] of [[/不要电缆|不带电缆/u, 'hasCable', false], [/不要浮球|不带浮球/u, 'hasFloat', false]]) { const match = pattern.exec(text); if (match) values.push({ field, value, unit: null, sources: [span(messageRef, text, match[0], match.index)] }); }
    const clearPacking = /(?:全部包装不要|清空全部包装|不要任何包装)/u.exec(text); if (clearPacking) values.push({ field: 'packingClearAll', value: true, unit: null, sources: [span(messageRef, text, clearPacking[0], clearPacking.index)] }); const packingRemoval = /(?:去掉|不要|删除)\s*(珍珠棉|泡沫|外包装箱)/u.exec(text); if (packingRemoval) values.push({ field: 'packingRemoval', value: packingRemoval[1], unit: null, sources: [span(messageRef, text, packingRemoval[0], packingRemoval.index)] }); const packing = /(?:包装改成|换成|改成|用)\s*(木箱|彩印箱|[^，。；,;！!？?]{1,20}箱)/u.exec(text); if (packing) values.push({ field: 'packingSelection', value: packing[1], unit: null, sources: [span(messageRef, text, packing[0], packing.index)] });
    const surfaceOptions = [
        [/电泳\s*\+\s*(?:喷粉|粉末喷涂)/u, 'electrophoresis_powder_coating'], [/电泳/u, 'electrophoresis'],
        [/(?:喷粉|粉末喷涂)/u, 'powder_coating'], [/(?:喷漆|喷涂)/u, 'painting'],
        [/(?:不做|不要|取消)表面处理/u, 'none'], [/自定义表面处理/u, 'custom'],
    ];
    for (const [pattern, value] of surfaceOptions) { const match = pattern.exec(text); if (match) { values.push({ field: 'surfaceTreatmentMode', value, unit: null, sources: [span(messageRef, text, match[0], match.index)] }); break; } }
    const surfaceCost = /(?:表面处理|喷漆|电泳|喷粉)[^，。；,;！!？?]{0,10}?(?:费用|费|成本)?\s*(\d+(?:\.\d+)?)\s*元/u.exec(text);
    if (surfaceCost) values.push({ field: 'surfaceTreatmentCost', value: Number(surfaceCost[1]), unit: 'CNY', sources: [span(messageRef, text, surfaceCost[0], surfaceCost.index)] });
    return values;
}
function deterministicProposal(messageRef, text) { const subjects = subjectMentions(messageRef, text); const source = span(messageRef, text, subjects[0]?.mention || text) || { messageRef, start: 0, end: text.length, text }; const overrides = overrideFor(messageRef, text); const recipeSubject = subjects.find(item => item.typeHints.includes('recipe')) || null; const customerSubject = subjects.find(item => item.typeHints.includes('customer')); const orderSubject = subjects.find(item => item.typeHints.includes('order')); const coilSubject = subjects.find(item => item.typeHints.includes('coil')); const sourceScenarioRequest = /按(?:报告|资料|文件)[^，。；,;！!？?]{0,24}(?:电缆长度|电缆)[^，。；,;！!？?]{0,24}试算/u.test(text); const scenarios = (overrides.length || sourceScenarioRequest) ? [{ scenarioKey: 'candidate_1', label: sourceScenarioRequest ? '按资料候选配置试算' : '用户候选配置', baseSubjectKey: recipeSubject?.subjectKey || 'subject_1', overrides, sources: sourceScenarioRequest ? [source] : overrides.flatMap(item => item.sources) }] : []; const goals = []; const add = (kind, description, scenarioKeys = [], subject = recipeSubject) => goals.push({ goalKey: `goal_${goals.length + 1}`, kind, description, subjectKeys: subject ? [subject.subjectKey] : [], scenarioKeys, dependsOn: [], requestedBasis: scenarioKeys.length ? 'HYPOTHETICAL' : 'CURRENT', sources: [source], quantity: null, unitPrice: null });
    // FAMILY-01：配方成本比较走正式的 RECIPE_COST_COMPARISON 双主体目标
    // （语义判定来自 E1-B 业务语义层，见 recipeCostComparisonSubjects）。
    const comparisonDetected = recipeCostComparisonSubjects(messageRef, text);
    const comparisonSemantics = recipeCostComparisonIntent(text) === 'COMPARISON';
    if (!comparisonSemantics && /成本|多少钱|价格|试算/u.test(text) && recipeSubject) {
        // A request can explicitly ask for both the current cost and a changed
        // configuration.  Preserve the two goals instead of letting the
        // candidate comparison consume the current-cost question.
        if (scenarios.length && /(?:现在|当前)[^，。；,;！!？?]{0,12}成本|成本[^，。；,;！!？?]{0,12}(?:现在|当前)/u.test(text)) add('CURRENT_COST', '查询当前成本', [], recipeSubject);
        add(scenarios.length ? 'CONFIGURATION_COMPARE' : 'CURRENT_COST', scenarios.length ? '比较候选配置与当前成本' : '查询当前成本', scenarios.map(item => item.scenarioKey), recipeSubject);
    }
    if (/客户|以前(?:报过|买过)|历史(?:报价|订单)?/u.test(text) && customerSubject) add('CUSTOMER_HISTORY', '查询客户正式历史', [], customerSubject);
    if (/报价(?:单)?|当前报价/u.test(text) && !/以前|历史/u.test(text)) add('QUOTATION_QUERY', '查询正式报价', [], subjects.find(item => item.typeHints.includes('quotation')) || customerSubject || recipeSubject);
    if (/订单.*(?:不能生产|缺什么|下一步|齐料|准备|怎么样)|(?:不能生产|缺什么|下一步|齐料|准备).*订单/u.test(text) && orderSubject) add('ORDER_READINESS', '调查订单当前生产准备状态与正式处理方案', [], orderSubject);
    if (/管理|待办|优先处理|风险/u.test(text)) add('MANAGEMENT_OVERVIEW', '读取管理行动中心', [], null);
    if (/改了什么|变更|变化记录/u.test(text)) add('BUSINESS_CHANGES', '查询正式业务变更记录', [], null);
    if (/影响哪些|影响范围|需要重算|需要复核/u.test(text)) add('IMPACT_INVESTIGATION', '查询正式影响投影', [], recipeSubject || coilSubject || null);
    const virtualReadiness = Boolean(recipeSubject && VIRTUAL_READINESS_INTENT.test(text) && !orderSubject);
    if (virtualReadiness) {
        if (scenarios.length && !goals.some(item => item.kind === 'CONFIGURATION_COMPARE')) add('CONFIGURATION_COMPARE', '建立候选配置的正式成本基础', scenarios.map(item => item.scenarioKey), recipeSubject);
        add('INVENTORY_QUERY', '按当前库存和活动订单占用预览虚拟数量齐料', scenarios.map(item => item.scenarioKey), recipeSubject);
    } else if (/库存|有货|够不够/u.test(text)
        // FAMILY-03：线圈的「还有多少/剩多少/余量」是库存问法，只在存在线圈主体时生效。
        || (Boolean(coilSubject) && /还剩|剩多少|还有多少|有多少|余量|存了/u.test(text))) add('INVENTORY_QUERY', '查询库存', scenarios.map(item => item.scenarioKey), coilSubject || recipeSubject);
    // FAMILY-02：线圈主体的成本问法。Recipe 主体走既有 CURRENT_COST 规则；
    // 线圈主体在既有规则里不会被采纳，因此单独给出 COIL_COST 目标（复用同一套线圈绑定与澄清）。
    // 线圈成本比较在本阶段未落地：两个及以上线圈主体 + 比较意图时 fail-closed，
    // 不得用「其中一个线圈的成本」冒充比较结果。
    const coilCostComparison = comparisonIsPrimary(text) && subjects.filter(item => item.typeHints.includes('coil')).length >= 2 && COIL_COMPARISON_INTENT.test(text);
    if (!goals.length && !recipeSubject && coilSubject && !coilCostComparison && /成本|多少钱|价格|单价|试算/u.test(text)) add('COIL_COST', '查询线圈方案当前成本', [], coilSubject);
    if (/正式方案|线圈方案|有哪些方案/u.test(text)) add('COIL_QUERY', '查询线圈方案', [], coilSubject);
    // File and knowledge are candidate investigations only.  No document title
    // is treated as an identity, and no content is evaluated here.
    if (/(?:技术档案|性能测试报告|测试报告|资料里|文件里|附件里)/u.test(text) && recipeSubject) add('FILE_INSPECT', '读取已关联配方的正式技术档案', [], recipeSubject);
    if (/(?:知识库|知识资料|规则里|经验库)/u.test(text)) add('KNOWLEDGE_QUERY', '查询工厂知识快照', [], null);
    // Reading a source and drawing an engineering conclusion are different
    // goals. The latter remains unsupported until a formal engineering
    // capability exists; source text never supplies that authority.
    if (/(?:设计安全|是否安全|曲线是否合理|能不能降(?:低)?线重|工程(?:判断|结论)|性能是否合格)/u.test(text)) add('OTHER', '需要正式工程分析能力的推断请求', [], recipeSubject);
    if (/(?:利润|毛利|毛利率|加价率|赚多少|亏多少|盈利)/u.test(text)) {
        // A candidate profitability request necessarily needs the formal scenario
        // basis too. Keep the comparison goal explicit so it cannot silently
        // become a model-side subtraction.
        if (scenarios.length && !goals.some(item => item.kind === 'CONFIGURATION_COMPARE')) add('CONFIGURATION_COMPARE', '建立候选配置的正式成本基础', scenarios.map(item => item.scenarioKey), recipeSubject);
        add('PROFITABILITY', '评估售价毛利', scenarios.map(item => item.scenarioKey), recipeSubject);
    }
    const quantity = /(?:做|生产|够做)\s*(\d+)\s*(台|pcs|件)|(?:\b)(\d+)\s*台(?=[，,。；;！!？?\s]|$)/iu.exec(text);
    const quantityValue = quantity ? Number(quantity[1] || quantity[3]) : null;
    const quantityQuote = quantity ? quantity[0] : null;
    if (quantityValue && quantityQuote) goals.filter(item => item.kind === 'INVENTORY_QUERY' || item.kind === 'PROFITABILITY').forEach(item => { item.quantity = { value: quantityValue, unit: 'pump', sources: [span(messageRef, text, quantityQuote, quantity.index)] }; });
    const price = /(?:卖|售价|每台|报价|按)\s*(\d+(?:\.\d+)?)(?:\s*元(?:一台|\/台)?)?/iu.exec(text);
    if (price) goals.filter(item => item.kind === 'PROFITABILITY').forEach(item => { item.unitPrice = { value: Number(price[1]), unit: 'CNY', sources: [span(messageRef, text, price[0], price.index)] }; });
    if (comparisonDetected) {
        const comparisonKeys = comparisonDetected.map(item => ensureComparisonSubject(subjects, messageRef, text, item.mention, item.source).subjectKey);
        goals.push({ goalKey: nextGoalKey(goals), kind: 'RECIPE_COST_COMPARISON', description: '比较两个正式配方的当前完整成本', subjectKeys: comparisonKeys, scenarioKeys: [], dependsOn: [], requestedBasis: 'CURRENT', sources: [comparisonDetected[0].source], quantity: null, unitPrice: null });
    }
    if (!goals.length) add('OTHER', '用户请求需要进一步理解'); const proposal = { version: 1, goalSummary: text.slice(0, 2000), subjects, scenarios, goals, unparsedSpans: [] }; return { proposal, overrides };
}
function isSimple(text, built) { return built.proposal.goals.length === 1 && ['CURRENT_COST', 'COIL_QUERY', 'INVENTORY_QUERY'].includes(built.proposal.goals[0].kind) && built.proposal.scenarios.length === 0 && built.proposal.subjects.length === 1 && !/(?:改|换|用|做\d|卖\d|利润|其他不变|其它不变|不要|不带)/u.test(text); }
function unwrapProviderCandidate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PROVIDER_NON_OBJECT');
    // Some function-calling providers serialize repaired arguments as
    // { parameters: { proposal } }. This is transport wrapping only; accept it
    // before schema validation, without broad recursive guessing.
    return value.parameters && typeof value.parameters === 'object' && !Array.isArray(value.parameters)
        ? value.parameters
        : value;
}
function parseProviderCandidate(response) { const message = response?.choices?.[0]?.message || response; const tool = message?.tool_calls?.[0]?.function; if (tool) { if (tool.name !== EXTRACTION_TOOL.function.name) throw new Error('PROVIDER_TOOL_NAME'); return unwrapProviderCandidate(JSON.parse(tool.arguments)); } let content = message?.content; if (typeof content !== 'string') throw new Error('PROVIDER_EMPTY'); content = content.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, ''); if (!content) throw new Error('PROVIDER_EMPTY'); return unwrapProviderCandidate(JSON.parse(content)); }
function rebindCandidate(candidate, messageRef, text) { const proposal = candidate.proposal || candidate; const walk = value => { if (Array.isArray(value)) return value.map(walk); if (!value || typeof value !== 'object') return value; const next = {}; for (const [key, child] of Object.entries(value)) { if (key === 'sourceQuote') continue; if (key === 'sources' && Array.isArray(child)) next.sources = child.map(item => item?.text ? item : span(messageRef, text, item?.sourceQuote || item)).filter(Boolean); else next[key] = walk(child); } return next; }; return walk(proposal); }
function normalizeCandidateSyntax(proposal, text) { if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return proposal; const typeHints = new Set(['part', 'coil', 'template', 'recipe', 'customer', 'quotation', 'order', 'file', 'knowledge', 'business_record']); const bases = new Set(['CURRENT', 'SAVED', 'HYPOTHETICAL', 'UNKNOWN']); const next = structuredClone(proposal); if (Array.isArray(next.subjects)) for (const subject of next.subjects) if (Array.isArray(subject?.typeHints)) { subject.typeHints = subject.typeHints.filter(item => typeHints.has(item)); if (subject.typeHints.includes('customer') && typeof subject.mention === 'string') subject.mention = subject.mention.replace(/\s*客户$/u, '').trim() || subject.mention; const model = typeof subject.mention === 'string' ? /V\d+/iu.exec(subject.mention) : null; if (model && (subject.typeHints.includes('recipe') || subject.typeHints.length === 0)) { subject.mention = model[0]; if (!subject.typeHints.length) subject.typeHints = ['recipe']; } } if (Array.isArray(next.scenarios)) for (const scenario of next.scenarios) if (Array.isArray(scenario?.overrides)) { scenario.overrides = scenario.overrides.filter(item => item && item.value !== null && item.value !== undefined); for (const override of scenario.overrides) if (override.field === 'cableLength' && override.unit === '米') override.unit = 'm'; }
    if (Array.isArray(next.goals)) { for (const goal of next.goals) { if (!bases.has(goal?.requestedBasis)) goal.requestedBasis = goal?.scenarioKeys?.length ? 'HYPOTHETICAL' : 'CURRENT'; if (goal.kind === 'CURRENT_COST' && goal.scenarioKeys?.length && /比较|比一下|对比/u.test(text)) goal.kind = 'CONFIGURATION_COMPARE'; if (goal.quantity?.unit && ['台', 'pcs'].includes(goal.quantity.unit)) goal.quantity.unit = 'pump'; if (goal.unitPrice?.unit && ['元', '元/台', 'CNY/台'].includes(goal.unitPrice.unit)) goal.unitPrice.unit = 'CNY'; }
        next.goals = next.goals.filter(goal => goal.kind !== 'OTHER' || !(Array.isArray(goal.sources) && goal.sources.length && goal.sources.every(source => /先不要保存|不要保存|只试算|其他不变|其它不变/u.test(source.text || ''))));
    }
    return next; }
function collectSourceSpans(value, output = []) { if (Array.isArray(value)) value.forEach(item => collectSourceSpans(item, output)); else if (value && typeof value === 'object') { if (typeof value.messageRef === 'string' && Number.isInteger(value.start) && Number.isInteger(value.end) && typeof value.text === 'string') output.push(value); Object.values(value).forEach(item => collectSourceSpans(item, output)); } return output; }
function coverage(result, critical) { const sources = collectSourceSpans({ proposal: result.proposal, serverDirectives: result.serverDirectives }); const missing = critical.filter(item => !sources.some(source => source.messageRef === item.messageRef && source.start <= item.start && source.end >= item.end)); if (missing.length) { result.proposal.unparsedSpans = [...(Array.isArray(result.proposal.unparsedSpans) ? result.proposal.unparsedSpans : []), ...missing]; result.status = 'PARTIAL'; result.blockers.push({ code: 'CRITICAL_SPAN_UNPARSED', message: '存在未归类的重要用户条件。', sources: missing }); } else if (result.status === 'COMPLETE') result.status = 'COMPLETE'; }
function admitGoalsV1(proposal, { messageRef, text, fallbackProposal }) {
    // Provider goals remain candidate interpretations until the server can tie
    // each privileged business intent to exact user text.  Admission is not an
    // execution prerequisite: a valid profit goal may still need a price.
    const evidence = [...text.matchAll(PROFIT_INTENT)].map(match => span(messageRef, text, match[0], match.index)).filter(Boolean);
    const inventoryEvidence = [...text.matchAll(INVENTORY_INTENT)].map(match => span(messageRef, text, match[0], match.index)).filter(Boolean);
    const fallbackReadiness = (fallbackProposal?.goals || []).filter(goal => goal.kind === 'INVENTORY_QUERY' && goal.description === '按当前库存和活动订单占用预览虚拟数量齐料');
    const admissions = []; const rejected = new Set();
    for (const goal of proposal.goals || []) {
        if (goal.kind === 'INVENTORY_QUERY') {
            if (!inventoryEvidence.length) { admissions.push({ candidateGoalKey: goal.goalKey, admitted: false, admissionCode: 'REJECTED_UNGROUNDED_MODEL_EXTRA', groundingEvidence: [] }); rejected.add(goal.goalKey); continue; }
            goal.sources = [...(goal.sources || []), ...inventoryEvidence.filter(item => !(goal.sources || []).some(source => source.messageRef === item.messageRef && source.start === item.start && source.end === item.end))];
            admissions.push({ candidateGoalKey: goal.goalKey, admitted: true, admissionCode: 'ADMITTED_EXPLICIT_USER_INTENT', groundingEvidence: inventoryEvidence }); continue;
        }
        if (goal.kind !== 'PROFITABILITY') { admissions.push({ candidateGoalKey: goal.goalKey, admitted: true, admissionCode: 'ADMITTED_DETERMINISTIC_INTENT', groundingEvidence: goal.sources || [] }); continue; }
        if (!evidence.length) { admissions.push({ candidateGoalKey: goal.goalKey, admitted: false, admissionCode: 'REJECTED_UNGROUNDED_MODEL_EXTRA', groundingEvidence: [] }); rejected.add(goal.goalKey); continue; }
        goal.sources = [...(goal.sources || []), ...evidence.filter(item => !(goal.sources || []).some(source => source.messageRef === item.messageRef && source.start === item.start && source.end === item.end))];
        admissions.push({ candidateGoalKey: goal.goalKey, admitted: true, admissionCode: 'ADMITTED_EXPLICIT_USER_INTENT', groundingEvidence: evidence });
    }
    proposal.goals = (proposal.goals || []).filter(goal => !rejected.has(goal.goalKey));
    for (const expected of fallbackReadiness) {
        const actual = proposal.goals.find(goal => goal.kind === 'INVENTORY_QUERY');
        if (!actual) {
            proposal.goals.push(structuredClone(expected));
            admissions.push({ candidateGoalKey: expected.goalKey, admitted: true, admissionCode: 'RESTORED_DETERMINISTIC_READINESS_INTENT', groundingEvidence: expected.sources || [] });
        } else if (!actual.quantity && expected.quantity) actual.quantity = structuredClone(expected.quantity);
    }
    // A candidate whose only admitted work was an ungrounded hallucinated goal
    // still needs a safe, non-executable task result instead of a malformed
    // zero-goal Proposal.
    if (!proposal.goals.length) proposal.goals = (fallbackProposal?.goals || []).filter(goal => goal.kind === 'OTHER').map(item => structuredClone(item));
    return admissions;
}
function addCopperPriceBlocker(result, messageRef, text) { const match = /铜价\s*\d+(?:\.\d+)?/iu.exec(text); if (!match || /铜价\s*\d+(?:\.\d+)?\s*(?:元\/(?:公斤|千克|吨)|CNY\/(?:KG|TON))/iu.test(text)) return; const source = span(messageRef, text, match[0], match.index); if (!source) return; result.proposal.unparsedSpans = [...result.proposal.unparsedSpans, source]; result.blockers.push({ code: 'COPPER_PRICE_UNIT_AMBIGUOUS', message: '铜价缺少单位，当前不能判断价格口径。', sources: [source] }); result.status = 'PARTIAL'; }
async function extractTaskSemanticsV2({ messageRef, text, provider = null }) { if (typeof messageRef !== 'string' || !messageRef || typeof text !== 'string' || !text) throw new Error('TASK_SEMANTICS_INPUT'); const built = deterministicProposal(messageRef, text); const directives = serverDirectives(messageRef, text); if (built.proposal.scenarios.length && /其他不变|其它不变/u.test(text)) directives.scenarioInheritance.push({ scenarioKey: 'candidate_1', policy: 'PRESERVE_UNMENTIONED_BASE_CONFIGURATION', sources: [span(messageRef, text, /其他不变|其它不变/u.exec(text)[0])] }); const critical = scanCriticalUserSpansV2({ messageRef, text }); const result = { version: 2, status: 'COMPLETE', extractionMode: 'DETERMINISTIC', proposal: built.proposal, serverDirectives: directives, blockers: [], telemetry: { modelCalls: 0, formatRepairCalls: 0, provider: null, model: null } };
    let normalOutputError = null;
    if (!isSimple(text, built) && provider) { result.extractionMode = 'MODEL_ASSISTED'; try { const response = await provider({ messages: [{ role: 'user', content: text }], tools: [EXTRACTION_TOOL], toolChoice: 'required' }); result.telemetry.modelCalls = 1; result.telemetry.provider = response?.provider || null; result.telemetry.model = response?.model || null; try { result.proposal = normalizeCandidateSyntax(rebindCandidate(parseProviderCandidate(response), messageRef, text), text); } catch (error) { normalOutputError = error; } } catch (error) { result.status = 'PARTIAL'; result.blockers.push({ code: 'PROVIDER_EXTRACTION_FAILED', message: error.message, sources: [] }); } }
    // 服务器权威：比较句必须带正式双主体比较目标（模型无权决定比较主体或降级为单主体成本）。
    result.proposal = enforceRecipeCostComparison(result.proposal, { messageRef, text });
    result.goalAdmissions = admitGoalsV1(result.proposal, { messageRef, text, fallbackProposal: built.proposal });
    let validationError = null;
    try { validateTaskProposalV1(result.proposal, { sourceMessages: new Map([[messageRef, text]]) }); } catch (error) { validationError = error; }
    if ((validationError || normalOutputError) && result.extractionMode === 'MODEL_ASSISTED' && result.telemetry.modelCalls === 1) try {
        const response = await provider({ messages: [{ role: 'system', content: 'FORMAT_REPAIR_ONLY: keep the same user goals, subject mentions, scenarios, numbers and source text. Return the supplied TaskProposalV1 corrected only to its exact schema. If the supplied candidate is absent, return a schema-valid candidate directly from the unchanged original user text. Allowed typeHints: part, coil, template, recipe, customer, quotation, order, file, knowledge, business_record. requestedBasis: CURRENT, SAVED, HYPOTHETICAL, UNKNOWN. Proposed override values must be boolean, finite number or string; omit absent overrides. Do not add IDs, authorization, verification, completeness, receipts or write policy.' }, { role: 'user', content: JSON.stringify({ originalUserText: text, proposal: normalOutputError ? null : result.proposal }) }], tools: [EXTRACTION_TOOL], toolChoice: 'required', formatRepair: true });
        result.telemetry.formatRepairCalls = 1; result.telemetry.provider = response?.provider || result.telemetry.provider; result.telemetry.model = response?.model || result.telemetry.model; result.proposal = normalizeCandidateSyntax(rebindCandidate(parseProviderCandidate(response), messageRef, text), text); validateTaskProposalV1(result.proposal, { sourceMessages: new Map([[messageRef, text]]) }); validationError = null; normalOutputError = null;
    } catch (error) { validationError = error; }
    if (validationError || normalOutputError) { const error = validationError || normalOutputError; result.status = 'PARTIAL'; result.blockers.push({ code: 'PROPOSAL_VALIDATION_FAILED', message: error.code || error.message, sources: [] });
        // A failed provider candidate must never escape as a malformed object
        // that a later controller might treat as an executable task.  The
        // conservative deterministic proposal remains the only fallback.
        result.proposal = built.proposal;
        result.goalAdmissions = admitGoalsV1(result.proposal, { messageRef, text, fallbackProposal: built.proposal });
        result.proposal.unparsedSpans = [...(Array.isArray(result.proposal.unparsedSpans) ? result.proposal.unparsedSpans : []), ...critical]; }
    addCopperPriceBlocker(result, messageRef, text); coverage(result, critical); return result;
}
module.exports = { EXTRACTION_TOOL, enforceRecipeCostComparison, recipeCostComparisonIntent, recipeCostComparisonSubjects, extractTaskSemanticsV2, normalizeCandidateSyntax, parseProviderCandidate, rebindCandidate, scanCriticalUserSpansV2, admitGoalsV1 };
