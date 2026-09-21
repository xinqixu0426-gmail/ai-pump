'use strict';
// 同一「定子规格-片数」在正式目录里可能有多套方案（12-220 = 钢带/小眼 + 冷轧/国标眼）。
// 执行器已经把"还有别的正式方案"附在本轮结果里，但最终是否说出来仍取决于模型。
// 这里做确定性兜底：本轮结果里同一规格片数有多套正式方案，而回答只覆盖了其中一套时，
// 追加完整方案清单，保证用户一定看到"不止一种"。
const { officialCoilRows, variantLabel } = require('./coilVariantAmbiguity.cjs');

function schemeCodeOf(row) {
    return String(row?.schemeCode ?? row?.scheme_code ?? '').trim();
}

function costOf(row) {
    const value = Number(row?.cost ?? row?.totalCost ?? NaN);
    return Number.isFinite(value) ? value : null;
}

/** 从执行器结果里收集正式线圈方案行（含歧义提示里带出的其它方案）。 */
function officialVariantRows(toolResults = []) {
    const rows = [];
    const push = (row) => {
        const id = Number(row?.id ?? NaN);
        const schemeCode = schemeCodeOf(row);
        if (!Number.isSafeInteger(id) && !schemeCode) return;
        rows.push({
            id: Number.isSafeInteger(id) ? id : null,
            spec: String(row?.spec ?? '').trim(),
            sheets: Number(row?.sheets ?? NaN),
            schemeCode,
            material: String(row?.material ?? '').trim(),
            slotType: String(row?.slotType ?? row?.slot_type ?? '').trim(),
            cost: costOf(row),
            isDefault: Boolean(row?.isDefault ?? row?.is_default),
        });
    };
    for (const item of Array.isArray(toolResults) ? toolResults : []) {
        const result = item?.result;
        if (!result || result.success === false) continue;
        for (const row of officialCoilRows(Array.isArray(result?.data) ? result.data : [])) push(row);
        for (const row of officialCoilRows(result?.data?.sameSpecSheetsVariants || [])) push(row);
        if (result?.data && !Array.isArray(result.data) && result.data.coilId) {
            push({ ...result.data, id: result.data.coilId });
        }
    }
    return rows;
}

function answerMentions(answer, variant) {
    const text = String(answer || '');
    if (!text) return false;
    if (variant.schemeCode && text.includes(variant.schemeCode)) return true;
    if (variant.id && new RegExp(`(?:^|[^\\d])${variant.id}(?:[^\\d]|$)`, 'u').test(text) && /方案|COIL|ID|编号/u.test(text)) {
        return true;
    }
    // 金额是这一套方案的强指纹：166.9728 与 166.97 都算提到。
    if (variant.cost !== null) {
        const rounded = Number(variant.cost.toFixed(2));
        for (const candidate of [String(variant.cost), String(rounded)]) {
            const escaped = candidate.replace('.', '[.．]');
            if (new RegExp(`(?:^|[^\\d.])${escaped}(?![\\d])`, 'u').test(text)) return true;
        }
    }
    // 模型常用"钢带小眼"指代方案而不写编码。
    if (variant.material && variant.slotType
        && text.includes(variant.material) && text.includes(variant.slotType)) return true;
    return false;
}

/**
 * 回答只覆盖了同一规格片数的一部分正式方案时，追加完整清单。
 * 回答完全没有提到任何一套方案时不追加（那不是"漏了一部分"，而是本轮没在答这个问题）。
 */
function appendMissingCoilVariants(answer, toolResults = []) {
    const text = String(answer || '');
    if (!text.trim()) return answer;
    const rows = officialVariantRows(toolResults);
    if (rows.length === 0) return answer;
    const groups = new Map();
    for (const row of rows) {
        if (!row.spec || !Number.isFinite(row.sheets) || row.sheets <= 0) continue;
        const key = `${row.spec}-${row.sheets}`;
        const list = groups.get(key) || [];
        if (!list.some(item => (item.schemeCode && item.schemeCode === row.schemeCode)
            || (item.id && item.id === row.id))) list.push(row);
        groups.set(key, list);
    }
    const lines = [];
    for (const [key, list] of groups) {
        if (list.length < 2) continue;
        const mentioned = list.filter(row => answerMentions(text, row));
        if (mentioned.length === 0 || mentioned.length === list.length) continue;
        const listed = list.map(row => (
            `${variantLabel(row)}${row.cost === null ? '' : ` 成本 ${row.cost}`}`
        )).join('、');
        lines.push(`同一 ${key} 在正式目录中共有 ${list.length} 套方案：${listed}。`
            + '上面的结论只对应其中一套，请确认要采用哪一套（或让我分别列出）。');
    }
    if (lines.length === 0) return answer;
    return `${text}\n\n${lines.join('\n')}`;
}

module.exports = {
    answerMentions,
    appendMissingCoilVariants,
    officialVariantRows,
};
