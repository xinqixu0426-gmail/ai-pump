'use strict';
// 金额格式守卫：决定把正式金额表作为"附加明细"追加，还是整段替换正文。
//
// 背景（生产会话 58，msg 321/323/325/329/333）：守卫原先只要正文没写 `¥`/`元`，就把整段
// 回答替换成一张内部金额表，用户看到的回答没有一句人话结论。但守卫的安全意图必须保留：
// 正文不可用、或引用了本轮正式字段之外的金额时，仍然整段替换。
//
// 因此判据从"正文必须出现货币符号"放宽为"正文已经引用了本轮工具结果里的正式金额"：
// - 正文引用了正式金额，且没有任何正式字段之外的金额声明 → append（保留结论，追加明细）
// - 正文没引用任何正式金额、正文不可用、或存在无依据的金额声明 → replace（沿用原行为）
// 放宽的是格式，不是依据。
//
// ── LEGACY-AI-ANSWER-001（生产候选人工验收）────────────────────────────────
// 上述判据仍有一个漏洞：用户问的若是**非金额问题**（规格差异、配置对比、清单），
// 正确回答天然不含金额，于是被判为「没引用正式金额」而整段替换 —— 正确答案被删除。
// 已记录实例：用户问「这两项产品规格有什么不同」，已有证据足以给出「一个带浮球、
// 一个不带浮球」，最终回答却只剩一张核对表。
//
// 修正原则：**验证过的非金额语义内容不得被丢弃**。
// - 正文可用（非空、无泄漏指令、无无依据金额）时，绝不因为「没提金额」而替换正文；
//   核对表改为附加明细。
// - 仅在正文本身不可用时才替换：空正文、泄漏的内部指令、无依据金额声明。
// - 「没引用正式金额」仍然被识别并上报（citesFormalAmount=false），供调用方与测试使用，
//   但它不再是删除正文的理由。
const {
    formatMoneySummary,
    markdownTableRows,
    misattributedMoneyClaims,
    monetaryValues,
} = require('./aiAssistantAnswer.cjs');
const { hasVerifiedExecution } = require('./aiExecutionEvidence.cjs');
const { projectMoneyFacts } = require('./moneyFactProjection.cjs');
const {
    providesMonetaryFacts,
    requiredMoneyFacts,
} = require('../capabilities/monetaryPresentationContract.cjs');

// 泄漏的内部指令：这类正文本身就是"不能展示的文本"，必须整段替换。
const UNUSABLE_ANSWER_RE = /仅修正文案|请再修正|未受正式金额字段|不要再调用工具/u;

// 正文里的金额声明：紧跟在金额词后面的数字（"成本 285.8"、"：268"），以及带货币单位的数字。
// 货币符号可以在数字**后面**（"100元"、"100¥"）也可以在**前面**（"¥9999"、"￥1,268.23"）——
// 原实现只认后缀，于是「当前库存5套，价值 ¥9999。」这种前缀写法完全逃过安全校验
// （2026-09-23 由 _money-presentation-contract.cjs 场景 N 发现）。
// 排除型号/规格片段（"12-140"、"12-120片"），否则会把规格误判成金额声明。
const MONEY_WORD = '成本|价格|单价|金额|费|工资|报价|总计|合计|总价|差额|差价|利润|毛利|铜价';
const MONEY_CLAIM_RE = new RegExp(`(?:${MONEY_WORD})[^\\d\\n]{0,6}?(-?\\d[\\d,]*(?:\\.\\d+)?)(?![\\d\\-/片寸])`, 'gu');
const UNIT_CLAIM_RE = /(?:(?:¥|￥)\s*(-?\d[\d,]*(?:\.\d+)?))|(?:(-?\d[\d,]*(?:\.\d+)?)\s*(?:元|¥|￥))/gu;

function answerNumbers(answer) {
    const numbers = new Set();
    for (const match of String(answer ?? '').matchAll(/-?\d[\d,]*(?:\.\d+)?/gu)) {
        const value = Number(String(match[0]).replaceAll(',', ''));
        if (Number.isFinite(value)) numbers.add(value);
    }
    return numbers;
}

// ── 「数量 不是 金额」判定（LEGACY-AI-ANSWER-005 根因）──────────────────────
// 复现：用户问「线圈库存有多少」，工具结果 verified([{ stock: 5, cost: 123 }])，
// 模型正文「当前库存5套。」是**完全正确**的非金额结论 —— 但 MONEY_CLAIM_RE 的
// 金额词表里含「费」，而「库存5套」的定界符 `[^\d\n]{0,6}?` 允许正文里最近的
// 「库存」作为锚点，于是 5 被当成「声称的金额」；5 又不在正式金额字段里，
// 被判 unsupported_money_claim → 正确结论被整段替换成一张内部金额表。
//
// 根因不是金额词表，而是**数字与单位的绑定没有被识别**：5 的量词是「套」，
// 它从来就不是金额。因此金额声明必须同时满足「有货币符号」或「有金额词前缀」，
// 且**不得**被数量量词修饰。
//
// 反例（必须继续判为金额，不能被本规则放过）：
//   「成本285.8」「：268」「差额19.64元」「铜价109.91元」「999元」
const QUANTITY_UNIT = '套|个|台|件|只|条|根|支|张|块|组|批|次|天|人|片|寸|公斤|千克|吨|米|瓦|伏|安|转';
const QUANTITY_UNIT_RE = new RegExp(`^(?:${QUANTITY_UNIT})`, 'u');
const QUANTITY_PREFIX_RE = /(?:库存|数量|片数|套数|个数|天数)\s*[:：]?\s*$/u;

/**
 * 数字在正文中的语境是否确定为「数量」而非金额。
 * 只看数字紧跟其后的量词/紧跟其前的数量名词这一层确定性证据。
 */
function isQuantityNumber(text, start, end) {
    if (QUANTITY_UNIT_RE.test(text.slice(end, end + 4))) return true;
    if (QUANTITY_PREFIX_RE.test(text.slice(Math.max(0, start - 6), start))) return true;
    return false;
}

/**
 * 正文中自称是金额的数字（**按出现位置**）。
 *
 * 旧实现把声明收集成「去重后的数值数组」，于是同一个数值的两次出现被当成同一个对象：
 * 「当前库存999套，成本999。」里被正确处理的数量语境把**金额词锚定的那次出现**也一起撤回了
 * （A03b）。金额声明的粒度必须是 occurrence，不是 value。
 *
 * 依据类型：
 *   money_word —— 金额词锚定（「成本 285.8」「合计 1,268.23」）
 *   currency   —— 货币符号/单位锚定（「¥9999」「285.8 元」）
 * 只有「数量量词修饰**并且**该数值不是本轮正式金额」的**那一次出现**才是数量而非金额。
 *
 * @returns {{ value: number, raw: string, kind: 'money_word'|'currency', numberIndex: number, endIndex: number }[]}
 */
function moneyClaimOccurrences(answer) {
    const text = String(answer ?? '');
    const occurrences = [];
    const push = (raw, kind, match) => {
        const value = Number(String(raw).replaceAll(',', ''));
        if (!Number.isFinite(value)) return;
        const numberIndex = match.index + match[0].indexOf(String(raw));
        occurrences.push({ value, raw: String(raw), kind, numberIndex, endIndex: numberIndex + String(raw).length });
    };
    for (const match of text.matchAll(MONEY_CLAIM_RE)) push(match[1], 'money_word', match);
    // UNIT_CLAIM_RE 有两组捕获：前缀货币符号 / 后缀货币单位，只取命中的那一组。
    for (const match of text.matchAll(UNIT_CLAIM_RE)) push(match[1] ?? match[2], 'currency', match);
    return occurrences;
}

/**
 * 正文中自称是金额的数字：这些数字必须有本轮正式字段支持。
 *
 * `formalValues` 是本轮正式金额集合（可选）。它只用来处理一个歧义：
 * 被数量量词修饰的**那一次**金额词锚定出现，是否其实是数量。
 *   从数字自身携带的量词看，5 没有货币单位，只能算「自称」；
 *   如果它同时出现在正式金额字段里，说明它确实是被展示的正式金额 → 保留；
 *   否则它就是「当前库存5套」里的数量，不是金额 → 撤回**该次出现**。
 * 不传 formalValues 时保持原行为（所有锚定命中都算声明）。
 */
function moneyClaimValues(answer, formalValues = null) {
    const text = String(answer ?? '');
    const formal = formalValues ? new Set([...formalValues].map(Number).filter(Number.isFinite)) : null;
    const values = [];
    for (const occurrence of moneyClaimOccurrences(text)) {
        if (formal && isQuantityNumber(text, occurrence.numberIndex, occurrence.endIndex) && !formal.has(occurrence.value)) continue;
        if (!values.includes(occurrence.value)) values.push(occurrence.value);
    }
    return values;
}

/**
 * 正文的金额安全性评估。守卫判定与回答组装都以此为准，
 * 避免调用方各自实现一份「什么算不可用正文」。
 * @returns {{ usable: boolean, citesFormalAmount: boolean, unsupportedClaims: number[] }}
 */
function evaluateAnswerMoney(answer, toolResults = []) {
    const text = String(answer ?? '');
    const formal = new Set([...monetaryValues(toolResults)].map(Number).filter(Number.isFinite));
    const numbers = answerNumbers(text);
    const citesFormalAmount = [...numbers].some(value => formal.has(value));
    const unsupportedClaims = moneyClaimValues(text, formal).filter(value => !formal.has(value));
    // 关联错误：数字本身合法，但被挂到了错误的正式对象/口径上（A02）。
    const misattributedClaims = misattributedMoneyClaims(text, toolResults);
    const unusable = text.trim() === ''
        || UNUSABLE_ANSWER_RE.test(text)
        || toolResults.some(item => item.result?.data?.configurationBasis?.configurationComplete === false);
    // 「有金额但没有任何货币标注」= 只是缺单位，不是非金额结论。
    // 这类正文仍应补一张正式核对表（沿用旧行为：正文没写 ¥/元 时补表），
    // 但它与非金额结论（正文根本不含金额）必须区分开 —— 后者绝不能触发替换。
    const hasAmountLikeNumber = moneyClaimValues(text).length > 0 || [...numbers].length > 0;
    const lacksCurrencyNotation = !/[¥￥]|\d\s*元/u.test(text);
    const needsCurrencyNotationRepair = hasAmountLikeNumber && lacksCurrencyNotation;
    return {
        usable: !unusable,
        citesFormalAmount,
        unsupportedClaims,
        misattributedClaims,
        needsCurrencyNotationRepair,
    };
}

/**
 * 结构化去重（LEGACY-AI-ANSWER-003）。
 *
 * 原实现用「整块文本是否被正文包含」判断金额表是否已出现，模型写出的
 * 表只要多一行、少一行或带一句旁注（例如「完整计算明细见本轮工具结果。」）
 * 就会判定失败，于是核对表被整块追加 —— 同一张表出现两次。
 *
 * 现在按语义身份判定：以表格的「对象 + 项目」（前两列）为键，
 * 数字按两位小数归一化。核对表里正文已经出现过的行不再重复追加；
 * 正文未包含的行仍然补上，因此不会因为去重而丢掉正式证据。
 */
function tableRowKey(row) {
    const cells = Array.isArray(row?.cells) ? row.cells : [];
    // 行的身份必须包含**金额**：只用「对象 + 项目」会让 A=200 / B=100 这种
    // 金额挂错对象但对象名和项目名都正确的行被判定为「已出现」（A02 根因）。
    return JSON.stringify(cells);
}

function missingSummaryRows(answer, summary) {
    const present = new Set(markdownTableRows(answer).map(tableRowKey));
    return markdownTableRows(summary).filter(row => !present.has(tableRowKey(row)));
}

/**
 * 把核对表渲染为「正文尚未包含的正式行」。
 *
 * 注意渲染粒度：**一旦有缺行，就补整块 summary**，而不是只补缺的那几行。
 * 因为 summary 除表格行外还带「配置基准」「正式配置」等口径上下文，
 * 只补行会把这些上下文丢掉，等于用去重换来了证据缺失。
 * 相反，若所有行都已出现，则什么都不补 —— 这才是「同一张表只出现一次」的保证。
 */
/** summary 中除表格以外的口径上下文（配置基准、正式配置、收尾说明等）。 */
/**
 * 计算 append 时应补充的内容。两条约束必须同时满足：
 *   A. 同一张金额表只出现一次（不得重复渲染表头与已有行）
 *   B. 正式证据不得丢失（缺的行要补，口径上下文也要补）
 *
 * 做法：正文已有金额表但不完整时，不再「在其下方再补一张」（那会重复表头），
 * 而是判定为需要替换该表；调用方用 replaceTable 把正文里那张不完整的表换成
 * 完整的 canonical 核对表。正文完全没有该表时，直接追加。
 */
function renderMissingMoneyRows(answer, summary) {
    const missing = missingSummaryRows(answer, summary);
    if (missing.length === 0) return '';
    return summary;
}

/** 正文里是否已经出现「金额表」形状的 markdown 表格（用于决定替换还是追加）。 */
function hasRenderedMoneyTable(answer) {
    return markdownTableRows(answer).some(row => row.header.includes('金额') && row.header.includes('项目'));
}

/**
 * 把正文中已有的（不完整）金额表整体替换为 canonical 核对表。
 * 保留表格前后的结论文字，只替换表格本身及其后紧随的口径上下文。
 */
function replaceMoneyTableInAnswer(answer, summary) {
    const lines = String(answer ?? '').split(/\r?\n/);
    let start = -1;
    let end = -1;
    for (let i = 0; i < lines.length - 1; i += 1) {
        if (!lines[i].includes('|') || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
        const header = lines[i].replace(/^\|/, '').replace(/\|$/, '').split('|').map(part => part.replace(/[*_`]/g, '').trim());
        if (!header.includes('金额') || !header.includes('项目')) continue;
        start = i;
        end = i + 1;
        while (end + 1 < lines.length && lines[end + 1].includes('|')) end += 1;
        break;
    }
    if (start < 0) return null;
    const head = lines.slice(0, start).filter(line => line.trim() !== '');
    const tail = lines.slice(end + 1).filter(line => line.trim() !== '');
    // body 是权威的 canonical 内容（表格 + 口径上下文）。
    // tail 里若已出现在 body 中（例如口令行重复），必须剔除，否则同一句口径会出现两次。
    const body = summary.split(/\r?\n/).filter(line => line.trim() !== '' && !/^本轮正式查询金额如下/u.test(line.trim()));
    const bodySet = new Set(body.map(line => line.trim()));
    const uniqueTail = tail.filter(line => !bodySet.has(line.trim()));
    return [...head, '', ...body, ...(uniqueTail.length ? ['', ...uniqueTail] : [])].join('\n');
}

/**
 * 守卫判定。`action` 为 'none' 时调用方必须保持正文原样。
 * @returns {{
 *   action: 'none'|'append'|'replace',
 *   summary: string,
 *   appendable: string,
 *   unsupportedClaims: number[],
 *   citesFormalAmount: boolean,
 *   reason: string,
 * }}
 */
/**
 * 正文是否已经引用了本轮正式结果中的**非金额事实**。
 *
 * 用于区分两种「查询类」回答（LEGACY-AI-ANSWER-002 / 005 的边界）：
 * - 正文已经写出结果里的具体事实（「当前库存5套。」）→ 回答自身成立，附带的 cost 字段
 *   不是本轮问题的答案，不得被塞进回答。
 * - 正文只说客套话或空泛结论（「两套方案的成本已给出，供你参考。」）→ 正文没有承载
 *   任何本轮事实，附带的正式金额就是唯一可展示的事实，必须补上。
 *
 * 旧实现的注释声称「检查正文数字是否出现在非金额结果字段」，但代码只验证了
 * 「数字**不**在金额集合里」—— 于是任何正文里的数字（包括编造的库存 999）都会返回 true
 * （A03a）。现在按注释声明的语义实现：**真的**把正文数字与结果里的非金额字段值比对。
 */

// 结果里的非金额事实：字段名不是金额谓词者。
// 数值事实用于「正文写了这个数量/编号」，字符串身份事实（型号/方案编码/名称/状态）
// 用于「正文写出了这个被核实过的业务对象」。两者都只取**非金额**字段。
const MONEY_KEY_RE = /cost|price|amount|fee|wage|subtotal|diff|^copperBase$/i;
const NON_MONEY_IDENTITY_KEY_RE = /^(?:name|recipeName|partName|customerName|supplier|model|shellModel|schemeCode|scheme_code|schemeName|material|slotType|spec|sheets|category|status|contractNo|unit)$/iu;

/** 结果里的非金额事实（数值 + 业务身份字符串）。 */
function nonMonetaryResultFacts(toolResults = []) {
    const facts = { numbers: new Set(), tokens: new Set() };
    function walk(value, key = '') {
        if (value === null || value === undefined) return;
        if (typeof value !== 'object') {
            if (MONEY_KEY_RE.test(key)) return;
            if (typeof value === 'number' && Number.isFinite(value)) facts.numbers.add(value);
            else if (typeof value === 'string') {
                const text = value.trim();
                if (/^-?\d+(?:\.\d+)?$/u.test(text)) facts.numbers.add(Number(text));
                else if (NON_MONEY_IDENTITY_KEY_RE.test(key) && text.length >= 2) facts.tokens.add(text);
            }
            return;
        }
        if (Array.isArray(value)) { for (const item of value) walk(item, key); return; }
        for (const [childKey, child] of Object.entries(value)) {
            if (childKey === 'executionEvidence' || childKey === 'provenance') continue;
            walk(child, childKey);
        }
    }
    for (const item of toolResults) if (item?.result?.success !== false && hasVerifiedExecution(item.result)) walk(item.result);
    return facts;
}

function citesResultFact(answer, toolResults = []) {
    const text = String(answer ?? '');
    const numbers = answerNumbers(text);
    const { numbers: nonMoneyNumbers, tokens } = nonMonetaryResultFacts(toolResults);
    return [...numbers].some(value => nonMoneyNumbers.has(value)) || [...tokens].some(token => text.includes(token));
}

/**
 * Part 1-R1 的保守启发式：正文里是否出现了**本轮正式金额之外**的数字。
 *
 * 它区分的是「正文在讲型号/规格/数量」与「正文只讲客套话」，**不是**事实引用判定 ——
 * 旧代码把它当成 `citesResultFact` 的语义（A03a：注释说「检查数字是否出现在非金额结果字段」，
 * 实际只验证「数字不在金额集合里」，于是编造的库存 999 也会返回 true）。
 * 现在它被正名为启发式，并且只在**本轮金额要求无法解析**时才作为兜底使用；
 * 一旦调用方接线了本轮要求，补全就完全由结构化要求决定。
 */
function answerMentionsNonFormalNumber(answer, toolResults = []) {
    const numbers = answerNumbers(String(answer ?? ''));
    if (!numbers.size) return false;
    return toolResults.some(item => {
        const result = item?.result;
        if (result?.success === false || !hasVerifiedExecution(result)) return false;
        const monetary = new Set([...monetaryValues([item])].map(Number));
        return [...numbers].some(value => !monetary.has(value));
    });
}

/**
 * 本轮正式金额事实是否已经**完整呈现**在正文里。
 *
 * 这是「required canonical money facts fully presented → NONE」这条最高优先短路的实现。
 * 只看「正文是否已经写出本轮正式金额」这一层确定性证据：
 * 正文写了金额，就不必再补一张表；正文没写，才需要补。
 * 不涉及任何意图、语气或措辞判断。
 */
function presentedMoneyFacts(answer, toolResults = []) {
    // 正式金额事实以**金额事实投影**为准（与金额表渲染同一权威），不再各自深扫一遍。
    const formal = projectMoneyFacts(toolResults, { includeQueries: true }).map(fact => fact.value);
    if (!formal.length) return true;
    const cited = answerNumbers(String(answer ?? ''));
    return formal.every(value => cited.has(value));
}

/**
 * 本轮是否应当**补全**正式金额明细（MONETARY_COMPLETION）。
 *
 * 与 MONETARY_SAFETY 严格分离：
 * - SAFETY（正文自己写了金额 → 必须验证依据）永远运行，与 requiredFacts 是否为空无关，
 *   由上面 unusable / unsupported_money_claim 两个分支承担。
 * - COMPLETION（要不要主动补金额表）只看：本轮目标是否要求金额 ∧ 能力能否提供。
 *
 * 判据来源：
 *   - 本轮的金额要求来自已解析目标层（turnRequirement，由
 *     api/capabilities/monetaryPresentationContract.cjs 的 turnMonetaryPresentation 从
 *     既有业务语义 kind/operation 得出），不是关键词识别，也不是 operation=preview；
 *   - 能力能否提供来自能力显式声明的可用事实（未登记 fail-closed）。
 * turnRequirement 为 undefined 表示调用方未接线 —— 此时退回能力可用性，保持既有行为。
 */
function moneyDetailObligation(answer, toolResults = [], turnRequirement = undefined) {
    // 全部正式金额都已写出 → 补表只会让同一金额重复出现。
    // 这是最高优先短路，也是唯一决定「要不要补表」的金额判据。
    if (presentedMoneyFacts(answer, toolResults)) return false;
    if (toolResults.some(item => providesMonetaryFacts(item?.name)
        && item?.result?.success !== false && hasVerifiedExecution(item.result))
        && requiredMoneyFacts(toolResults, turnRequirement).length > 0) return true;
    // 本轮目标已解析：补全只由「要求金额 ∧ 能力可提供」决定（Part 1-R2 契约）。
    // 下面的正文启发式只为「本轮要求未知」（调用方未接线 / 目标未解析）保留。
    if (turnRequirement && turnRequirement.unknown !== true) return false;
    // 正文已经引用了本轮核实过的非金额事实 → 回答自身成立，不需要再补金额明细。
    if (citesResultFact(answer, toolResults)) return false;
    // 正文写了金额却没有任何货币标注（「成本 253.23」）：沿用原行为补一张正式核对表。
    // 这里的金额声明确认已排除数量量词（见 moneyClaimValues），因此「当前库存5套。」
    // 不会再被当成「缺货币标注的金额」。
    // 数量量词歧义需要正式金额集合才能裁决（见 moneyClaimValues），这里传本轮正式金额。
    if (moneyClaimValues(answer, monetaryValues(toolResults)).length > 0 && !/[¥￥]|\d\s*元/u.test(String(answer ?? ''))) return true;
    return !answerMentionsNonFormalNumber(answer, toolResults);
}

function moneyGuardDecision(answer, toolResults = [], turnRequirement = undefined) {
    const text = String(answer ?? '');
    // includeQueries：与 aiAssistantRuntime 的兜底路径保持一致，否则 compare_recipes 这类
    // query 能力产出的正式金额永远进不了追加/替换用的核对表（会导致正文与表都不含该金额）。
    const summary = formatMoneySummary(toolResults, { includeQueries: true });
    if (!summary) {
        return { action: 'none', summary: '', appendable: '', unsupportedClaims: [], citesFormalAmount: false, reason: 'no_formal_money_summary' };
    }
    const missingRows = renderMissingMoneyRows(text, summary);
    const renderedTableReplacement = missingRows === '' ? null : (hasRenderedMoneyTable(text) ? replaceMoneyTableInAnswer(text, summary) : null);
    // 注意：`missingRows === ''` 不能在这里直接返回 none —— 正文不可用或含无依据金额时，
    // 即使表格「看起来齐了」也必须先处理安全问题。安全性判定放前面。
    const { usable, citesFormalAmount, unsupportedClaims, misattributedClaims } = evaluateAnswerMoney(text, toolResults);

    // 正文本身不可用、或声称了无依据的金额 → 必须处理（沿用最高优先级的替换）。
    if (!usable) {
        return { action: 'replace', summary, appendable: summary, unsupportedClaims, misattributedClaims, citesFormalAmount, reason: 'answer_unusable' };
    }
    if (unsupportedClaims.length > 0) {
        return { action: 'replace', summary, appendable: summary, unsupportedClaims, misattributedClaims, citesFormalAmount, reason: 'unsupported_money_claim' };
    }
    // 数字合法但挂错了对象（A=200 / B=100）：正文里的金额表必须被 canonical 表替换，
    // 而不是被判定为「已经出现」。被纠正的金额一并上报，调用方与测试都能看到。
    if (misattributedClaims.length > 0) {
        const misattributedValues = misattributedClaims.map(claim => claim.value);
        const replacement = hasRenderedMoneyTable(text) ? replaceMoneyTableInAnswer(text, summary) : null;
        return replacement === null
            ? { action: 'replace', summary, appendable: summary, unsupportedClaims: misattributedValues, misattributedClaims, citesFormalAmount, reason: 'money_claim_misattributed' }
            : { action: 'replaceTable', summary, appendable: replacement, unsupportedClaims: misattributedValues, misattributedClaims, citesFormalAmount, reason: 'money_claim_misattributed' };
    }
    // 到这里正文可用、也没有无依据金额。剩下的唯一问题是「正式明细有没有展示全」。
    // 金额表已经完整时不能再追加 —— 同一张表只出现一次。
    if (missingRows === '') {
        return { action: 'none', summary, appendable: '', unsupportedClaims: [], misattributedClaims: [], citesFormalAmount, reason: 'money_table_already_present' };
    }
    if (renderedTableReplacement) {
        return { action: 'replaceTable', summary, appendable: renderedTableReplacement, unsupportedClaims: [], misattributedClaims: [], citesFormalAmount, reason: 'incomplete_money_table_replaced' };
    }
    // 本轮没有金额展示义务（纯查询事实、且正文已承载本轮事实）时到此结束：
    // 正文可用、无无依据金额、也没有需要补齐的正式明细 → 保持正文原样，不追加任何金额表。
    if (!moneyDetailObligation(text, toolResults, turnRequirement)) {
        return { action: 'none', summary, appendable: '', unsupportedClaims: [], misattributedClaims: [], citesFormalAmount, reason: 'no_money_detail_obligation' };
    }
    // 正文完全没有金额表时追加整块 canonical 核对表（含口径上下文），
    // 而不是只追加几行：调用方需要的是可直接展示的完整明细。
    return { action: 'append', summary, appendable: summary, unsupportedClaims: [], misattributedClaims: [], citesFormalAmount, reason: 'preserve_verified_semantic_body' };
}
module.exports = {
    MONEY_CLAIM_RE,
    UNUSABLE_ANSWER_RE,
    answerNumbers,
    moneyClaimValues,
    moneyClaimOccurrences,
    evaluateAnswerMoney,
    moneyGuardDecision,
    moneyDetailObligation,
    presentedMoneyFacts,
    citesResultFact,
    answerMentionsNonFormalNumber,
    nonMonetaryResultFacts,
    renderMissingMoneyRows,
    hasRenderedMoneyTable,
    replaceMoneyTableInAnswer,
};
