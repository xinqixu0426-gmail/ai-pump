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
const {
    formatMoneySummary,
    monetaryValues,
} = require('./aiAssistantAnswer.cjs');

// 泄漏的内部指令：这类正文本身就是"不能展示的文本"，必须整段替换。
const UNUSABLE_ANSWER_RE = /仅修正文案|请再修正|未受正式金额字段|不要再调用工具/u;

// 正文里的金额声明：紧跟在金额词后面的数字（"成本 285.8"、"：268"），以及带货币单位的数字。
// 排除型号/规格片段（"12-140"、"12-120片"），否则会把规格误判成金额声明。
const MONEY_WORD = '成本|价格|单价|金额|费|工资|报价|总计|合计|总价|差额|差价|利润|毛利|铜价';
const MONEY_CLAIM_RE = new RegExp(`(?:${MONEY_WORD})[^\\d\\n]{0,6}?(-?\\d[\\d,]*(?:\\.\\d+)?)(?![\\d\\-/片寸])`, 'gu');
const UNIT_CLAIM_RE = /(-?\d[\d,]*(?:\.\d+)?)\s*(?:元|¥|￥)/gu;

function answerNumbers(answer) {
    const numbers = new Set();
    for (const match of String(answer ?? '').matchAll(/-?\d[\d,]*(?:\.\d+)?/gu)) {
        const value = Number(String(match[0]).replaceAll(',', ''));
        if (Number.isFinite(value)) numbers.add(value);
    }
    return numbers;
}

/** 正文中自称是金额的数字：这些数字必须有本轮正式字段支持。 */
function moneyClaimValues(answer) {
    const text = String(answer ?? '');
    const values = [];
    const push = (raw) => {
        const value = Number(String(raw).replaceAll(',', ''));
        if (Number.isFinite(value) && !values.includes(value)) values.push(value);
    };
    for (const match of text.matchAll(MONEY_CLAIM_RE)) push(match[1]);
    for (const match of text.matchAll(UNIT_CLAIM_RE)) push(match[1]);
    return values;
}

/**
 * 守卫判定。`action` 为空时调用方必须保持正文原样。
 * @returns {{ action: 'none'|'append'|'replace', summary: string, unsupportedClaims: number[] }}
 */
function moneyGuardDecision(answer, toolResults = []) {
    const text = String(answer ?? '');
    const summary = formatMoneySummary(toolResults);
    if (!summary) return { action: 'none', summary: '', unsupportedClaims: [] };
    if (text.includes(summary)) return { action: 'none', summary, unsupportedClaims: [] };

    const formal = new Set([...monetaryValues(toolResults)].map(Number).filter(Number.isFinite));
    const numbers = answerNumbers(text);
    const citesFormalAmount = [...numbers].some(value => formal.has(value));
    const unsupportedClaims = moneyClaimValues(text).filter(value => !formal.has(value));
    const unusable = UNUSABLE_ANSWER_RE.test(text)
        || toolResults.some(item => item.result?.data?.configurationBasis?.configurationComplete === false);

    const append = text.trim() !== '' && !unusable && unsupportedClaims.length === 0 && citesFormalAmount;
    return {
        action: append ? 'append' : 'replace',
        summary,
        unsupportedClaims,
    };
}

module.exports = {
    MONEY_CLAIM_RE,
    UNUSABLE_ANSWER_RE,
    answerNumbers,
    moneyClaimValues,
    moneyGuardDecision,
};
