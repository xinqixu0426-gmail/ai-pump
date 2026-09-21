'use strict';

const { classifyQuestion } = require('../business-semantics/questionSemantics.cjs');

const VERSION = 'L5OffCompatibilityV1';

function verified(item) {
    return item?.result?.success !== false && item?.result?.executionEvidence?.verified === true;
}

function completeRecipeList(item) {
    const receipt = item?.result?.queryReceipt;
    const rows = item?.result?.data;
    return item?.name === 'get_all_recipes' && verified(item) && Array.isArray(rows)
        && receipt?.authoritative === true && receipt.truncated !== true
        && receipt.possiblyTruncated !== true
        && Number(receipt.returnedCount) === Number(receipt.totalCount)
        && rows.length === Number(receipt.returnedCount);
}

function buildCompatibilityRead(userText) {
    const semantics = classifyQuestion(userText);
    const keyword = String(semantics?.requestedIdentity?.token || '').trim();
    if (semantics?.kind !== 'COST_QUERY' || semantics?.requestedType !== 'recipe' || !keyword) return null;
    const source = String(userText || '');
    const tokenAt = source.indexOf(keyword);
    const descriptor = tokenAt < 0 ? '' : source.slice(tokenAt + keyword.length)
        .replace(/(?:当前)?(?:完整)?(?:整机)?成本(?:是|为|有)?多少.*$/u, '')
        .replace(/(?:配方|型号|产品|水泵)/gu, '')
        .replace(/[\s的，,。？?：:]/gu, '');
    // A bare structured key such as "V750" keeps the pre-existing model/tool path. This repair is
    // only for a complete current-name span whose additional descriptor was present in user text.
    if ([...descriptor].length < 2) return null;
    return Object.freeze({ capability: 'get_all_recipes', arguments: Object.freeze({ keyword }) });
}

function exactCanonicalRecipeEvidence(userText, toolResults = []) {
    const source = String(userText || '');
    const byId = new Map();
    for (const item of toolResults.filter(completeRecipeList)) {
        for (const row of item.result.data) {
            const id = Number(row?.id ?? row?.Id);
            const name = String(row?.name || '').trim();
            if (!Number.isSafeInteger(id) || id <= 0 || !name || !source.includes(name)) continue;
            byId.set(id, { ...row, id, name });
        }
    }
    const candidates = [...byId.values()];
    if (candidates.length !== 1) return Object.freeze({ status: candidates.length ? 'AMBIGUOUS' : 'NOT_FOUND', candidates });
    return Object.freeze({ status: 'EXACT_CANONICAL_NAME', canonical: Object.freeze(candidates[0]), candidates });
}

function currentCostValue(toolResults = []) {
    for (const item of toolResults.filter(verified)) {
        const values = item.name === 'get_recipe_detail'
            ? [item.result?.currentCost?.currentTotalCost, item.result?.recipe?.currentCost?.currentTotalCost]
            : item.name === 'preview_recipe_cost'
                ? [item.result?.data?.currentTotalCost, item.result?.data?.costPreview?.currentTotalCost, item.result?.data?.unitCost]
                : [];
        const value = values.find(item => Number.isFinite(Number(item)));
        if (value != null) return Number(value);
    }
    return null;
}

function historicalLabelPresent(answer) {
    return /(?:保存|历史|快照|非当前|不是当前|不能作为.*当前)/u.test(String(answer || ''));
}

function falseNotFoundClaim(answer) {
    return /(?:未找到|找不到|不存在|没有找到)[^\n。！？]{0,48}(?:配方|型号)|(?:配方|型号)[^\n。！？]{0,48}(?:未找到|找不到|不存在|没有找到)/u.test(String(answer || ''));
}

function enforceCompatibilityAnswer({ userText, toolResults = [], answer = '' } = {}) {
    const evidence = exactCanonicalRecipeEvidence(userText, toolResults);
    if (evidence.status !== 'EXACT_CANONICAL_NAME') {
        return Object.freeze({ answer: String(answer || ''), replaced: false, evidence });
    }
    const canonical = evidence.canonical;
    const saved = Number(canonical.savedTotalCost ?? canonical.saved_total_cost);
    const current = currentCostValue(toolResults);
    const savedMentioned = Number.isFinite(saved) && String(answer || '').includes(String(saved));
    const unsafe = falseNotFoundClaim(answer)
        || (current == null && savedMentioned && !historicalLabelPresent(answer));
    if (!unsafe) return Object.freeze({ answer: String(answer || ''), replaced: false, evidence });
    if (current != null) return Object.freeze({
        answer: `正式目录已确认配方“${canonical.name}”存在（ID ${canonical.id}），正式当前完整成本为 ¥${current.toFixed(2)}。`,
        replaced: true,
        evidence,
    });
    const historical = Number.isFinite(saved)
        ? `档案中的 ¥${saved.toFixed(2)} 是保存的历史成本快照，不能作为本轮实时重算结果。`
        : '本轮也不能把任何保存值表述为当前实时重算结果。';
    return Object.freeze({
        answer: `正式目录已确认配方“${canonical.name}”存在（ID ${canonical.id}）。本轮未取得正式当前完整成本；${historical}`,
        replaced: true,
        evidence,
    });
}

module.exports = {
    VERSION,
    buildCompatibilityRead,
    exactCanonicalRecipeEvidence,
    enforceCompatibilityAnswer,
    falseNotFoundClaim,
};
