'use strict';
/**
 * PHASE D 判据工具。
 *
 * 全部判据都**从本轮正式回执推导**，不写死期望值 —— 这样 parity / 验收不会退化成
 * 「比对上一版硬编码 baseline」（本阶段明确禁止修改 expected baseline）。
 */
const { markdownTableRows, misattributedMoneyClaims, unsupportedMoneyInAnswer, formatMoneySummary } = require('../../api/services/aiAssistantAnswer.cjs');
const { projectMoneyFacts } = require('../../api/services/moneyFactProjection.cjs');
const { buildListCriticality, normalizeAnswerPresentation } = require('../../api/services/aiPresentationNormalizer.cjs');
const { citesResultFact, answerMentionsNonFormalNumber } = require('../../api/services/aiMoneyGuard.cjs');

/** 本轮正式金额事实（带身份、口径、来源能力）。 */
function formalMoneyFacts(toolResults = []) {
    return projectMoneyFacts(toolResults, { includeQueries: true }).map(fact => ({
        capability: fact.capability,
        entity: fact.objectLabel,
        entityType: fact.entityType,
        identity: fact.entityId || fact.factPath,
        identityStrength: fact.identityStrength,
        predicate: fact.predicate,
        label: fact.label,
        value: fact.value,
    }));
}

/** 本轮全部正式事实的稳定签名（用于 Legacy/Native 事实 parity 比较）。 */
function formalFactSignature(toolResults = []) {
    return formalMoneyFacts(toolResults)
        .map(fact => `${fact.capability}|${fact.entity}|${fact.predicate}|${fact.value}`)
        .sort();
}

/** 正文里的金额表行（对象/项目/金额）。 */
function moneyTableRows(answer) {
    return markdownTableRows(String(answer || ''))
        .filter(row => row.header.includes('金额'))
        // 金额用**原始单元格**：显示归一化（两位小数）不能参与数值判定（PHASE-D-DEFECT-04）。
        .map(row => ({
            object: String(row.cells[0] ?? '').trim(),
            label: String(row.cells[1] ?? '').trim(),
            value: Number(String(row.rawCells?.[2] ?? row.cells[2] ?? '').replaceAll(',', '')),
        }));
}

function countOccurrences(text, token) {
    if (!token) return 0;
    return String(text || '').split(token).length - 1;
}

/** 结构化关键性输入（来自正式结果，不来自文字）。 */
function structuredCriticality(toolResults = []) {
    return buildListCriticality(toolResults);
}

/**
 * 展示层差分：同一份正文分别走「结构化关键性」与「关键词兜底」，
 * 用来回答「TIER1/TIER2 兜底是否仍然是承重结构」。
 */
function presentationDifferential(answer, toolResults, userText = '') {
    const criticality = structuredCriticality(toolResults);
    const structured = normalizeAnswerPresentation(answer, userText, { criticality });
    const fallback = normalizeAnswerPresentation(answer, userText);
    const lines = String(answer || '').split('\n');
    const structuredLines = new Set(structured.split('\n'));
    const fallbackLines = new Set(fallback.split('\n'));
    return {
        mustShowTokens: criticality.mustShowTokens,
        supportTokens: criticality.supportTokens,
        structuredSourceInformed: criticality.mustShowTokens.length > 0,
        structuredChanged: structured !== answer,
        fallbackChanged: fallback !== answer,
        structuredEqualsFallback: structured === fallback,
        fallbackHidesStructuredCriticalRow: criticality.mustShowTokens.some(token => !fallback.includes(token) && structured.includes(token)),
        // 反向：结构化路径（在结构化来源为空时）丢掉了兜底路径会保留的行。
        structuredHidesFallbackKeptRow: lines.some(line => fallbackLines.has(line) && !structuredLines.has(line)),
        structuredClaimsPreserved: /已全部保留/u.test(structured),
        structuredReportsUnrepresented: /没有出现在清单里/u.test(structured),
        structuredClaimsNoStructuredState: /没有出现结构化的缺料/u.test(structured),
        fallbackClaimsPreserved: /已全部保留/u.test(fallback),
    };
}

/** 金额安全面：未支撑金额 + 关联错误 + 是否交付了正式差额。 */
function moneySafety(answer, toolResults) {
    const facts = formalMoneyFacts(toolResults);
    const unsupported = unsupportedMoneyInAnswer(answer, toolResults);
    const misattributed = misattributedMoneyClaims(answer, toolResults).map(claim => ({ object: claim.object, label: claim.label, value: claim.value }));
    return {
        formalValues: [...new Set(facts.map(fact => fact.value))].sort((left, right) => left - right),
        unsupported,
        misattributed,
        moneyTableTitleCount: countOccurrences(answer, '本轮正式查询金额如下'),
        citesResultFact: citesResultFact(answer, toolResults),
        mentionsNonFormalNumber: answerMentionsNonFormalNumber(answer, toolResults),
    };
}

/** 用户可见的回答里是否泄漏内部语言 / 机器占位。 */
function internalLeakage(answer, toolNames = []) {
    const leaks = [];
    for (const name of toolNames) if (String(answer || '').includes(name)) leaks.push(`tool:${name}`);
    for (const token of ['undefined', 'null', '[object Object]', 'NaN']) {
        if (String(answer || '').includes(token)) leaks.push(`placeholder:${token}`);
    }
    return leaks;
}

/** Legacy 模型草稿被拒时用户会拿到的确定性兜底回答。 */
function deterministicFallback(toolResults) {
    return formatMoneySummary(toolResults, { includeQueries: true });
}

/** 归一化后用于答案级 parity（不要求逐字一致）。 */
function normalizeForParity(answer) {
    return String(answer || '')
        .replace(/[*_`#>\s]+/gu, '')
        .replace(/[，。；：、,.!?！？;:]/gu, '')
        .replace(/\d+(?:\.\d+)?/gu, match => String(Number(match)))
        .trim();
}

/**
 * 业务事实层面的分叉检测。
 *
 * 用户规则区分两件不同的事：
 *   - 允许：APPROVED_PRESENTATION_DELTA（措辞/布局）；
 *   - 禁止：UNEXPLAINED_BUSINESS_REGRESSION（同一 canonical 实体 + 同一口径给出**不同**金额或口径）。
 * 「一边读了、另一边没读」属于 completeness / missing data 观察项，必须如实报告，
 * 但它不是业务事实分叉 —— 把它算成 regression 会掩盖真正需要盯的 VALUE_CONFLICT。
 */
function keyOf(fact) {
    return `${fact.entity}@${fact.predicate}`;
}
function compareFacts(legacyFacts = [], nativeFacts = []) {
    const legacyByKey = new Map(legacyFacts.map(fact => [keyOf(fact), fact]));
    const nativeByKey = new Map(nativeFacts.map(fact => [keyOf(fact), fact]));
    const businessRegressions = [];
    const completenessDeltas = [];
    for (const [key, fact] of legacyByKey) {
        const other = nativeByKey.get(key);
        if (!other) { completenessDeltas.push({ kind: 'MISSING_IN_NATIVE', key, value: fact.value }); continue; }
        if (other.value !== fact.value) businessRegressions.push({ kind: 'VALUE_CONFLICT', key, legacy: fact.value, native: other.value });
        else if (other.label !== fact.label) businessRegressions.push({ kind: 'BASIS_CONFLICT', key, legacy: fact.label, native: other.label });
    }
    for (const [key, fact] of nativeByKey) if (!legacyByKey.has(key)) completenessDeltas.push({ kind: 'MISSING_IN_LEGACY', key, value: fact.value });
    return { businessRegressions, completenessDeltas };
}

/** 兼容旧名：等价于 compareFacts().businessRegressions。 */
function businessDeltas(legacyFacts, nativeFacts) {
    return compareFacts(legacyFacts, nativeFacts).businessRegressions;
}

module.exports = {
    formalMoneyFacts,
    formalFactSignature,
    moneyTableRows,
    countOccurrences,
    structuredCriticality,
    presentationDifferential,
    moneySafety,
    internalLeakage,
    deterministicFallback,
    normalizeForParity,
    businessDeltas,
    compareFacts,
};
