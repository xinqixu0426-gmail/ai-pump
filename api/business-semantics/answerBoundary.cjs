'use strict';

const { classifyQuestion } = require('./questionSemantics.cjs');
const { enforcementDecision } = require('./completenessPolicy.cjs');
const { officialCoilRows, sameSpecSheetsRows } = require('../services/coilVariantAmbiguity.cjs');

function verified(item) { return item?.result?.success !== false && item?.result?.executionEvidence?.verified === true; }
function rows(toolResults, name) { return toolResults.filter(item => verified(item) && item.name === name).flatMap(item => {
    if (Array.isArray(item.result?.data)) return item.result.data;
    if (name === 'search_parts' && Array.isArray(item.result?.parts)) return item.result.parts;
    return [];
}); }
function money(value) { const amount = Number(value); return Number.isFinite(amount) ? amount.toFixed(2) : null; }
function recipe(toolResults) { return rows(toolResults, 'get_all_recipes')[0] || toolResults.find(item => verified(item) && item.name === 'get_recipe_detail')?.result?.recipe || null; }
function recipeIdentityResolution(toolResults) {
    return toolResults.filter(verified).filter(item => item.name === 'get_all_recipes')
        .map(item => item.result?.identityResolution).find(Boolean) || null;
}
function currentRecipeCost(toolResults) {
    for (const item of toolResults.filter(verified)) {
        if (item.name === 'get_recipe_detail') {
            const value = item.result?.currentCost?.currentTotalCost ?? item.result?.recipe?.currentCost?.currentTotalCost;
            if (money(value)) return money(value);
        }
        if (item.name === 'preview_recipe_cost') {
            const value = item.result?.data?.currentTotalCost ?? item.result?.data?.costPreview?.currentTotalCost ?? item.result?.data?.unitCost;
            if (money(value)) return money(value);
        }
        if (item.name === 'full_calculate') {
            const value = item.result?.data?.currentTotalCost ?? item.result?.data?.totalCost;
            if (money(value)) return money(value);
        }
    }
    return null;
}
function copperPrice(toolResults) {
    const data = toolResults.find(item => verified(item) && item.name === 'get_copper_price')?.result?.data;
    const direct = data?.pricePerKg ?? data?.copperPrice ?? data?.price;
    if (direct != null) return direct;
    const bases = [...new Set(rows(toolResults, 'search_coils').map(row => Number(row.copperBase)).filter(Number.isFinite))];
    return bases.length === 1 ? bases[0] : null;
}
function matchingCoils(toolResults, semantics) {
    return sameSpecSheetsRows(officialCoilRows(rows(toolResults, 'search_coils')),
        semantics.requestedIdentity.spec, semantics.requestedIdentity.sheets);
}
function variantLabel(row) { return [row.material, row.slotType, row.schemeCode].filter(Boolean).join('/') || `方案ID ${row.id ?? row.Id}`; }
function variantCost(row) { return money(row.cost ?? row.totalCost ?? row.kitPrice ?? row.unitCost); }

function deterministicSemanticAnswer(frame, toolResults, userText) {
    const semantics = classifyQuestion(userText);
    const status = frame?.completeness?.status;
    const targetRecipe = recipe(toolResults);
    const coils = matchingCoils(toolResults, semantics);
    const identityResolution = recipeIdentityResolution(toolResults);
    if (identityResolution?.state === 'ALIAS_TARGET_UNAVAILABLE') {
        return `“${semantics.requestedIdentity.token || '该名称'}”存在正式历史别名记录，但其目标配方已不可用，不能绑定为当前规范对象。请提供仍有效的正式配方全名；本轮不能给出成本。`;
    }
    if (frame?.subject?.resolutionStatus === 'ALIAS_UNRESOLVED') {
        return `“${semantics.requestedIdentity.token || '该型号'}”包含历史别名含义，但当前没有正式别名映射可确认其规范对象。请提供正式配方全名或确认对应型号；本轮不能据此断言对象不存在，也不能给出成本。`;
    }
    if (identityResolution?.state === 'ALIAS_AMBIGUOUS') {
        return `“${semantics.requestedIdentity.token || '该名称'}”对应多个仍有效的正式配方，不能自动选择。请提供当前正式配方全名后再查询成本；本轮未选择任何目标。`;
    }
    if (status === 'NEEDS_CLARIFICATION' && coils.length > 1) {
        const base = recipe(toolResults);
        return `基准配方为${base?.name || semantics.requestedIdentity.token}。${semantics.requestedIdentity.spec}-${semantics.requestedIdentity.sheets} 对应 ${coils.length} 套正式线圈方案：${coils.map(variantLabel).join('；')}。请确认材质和槽眼后再重新计算；本轮未选择任何方案，也未执行成本试算。`;
    }
    const calculatedCoil = toolResults.find(item => verified(item) && item.name === 'calculate_coil_cost')?.result?.data;
    if (semantics.requestedType === 'coil' && semantics.wireWeight != null && calculatedCoil
        && (calculatedCoil.overrideStatus === 'UNSUPPORTED_FOR_PRICING_MODE' || calculatedCoil.isCustomWireWeight === false)) {
        return `${semantics.requestedIdentity.token} 的正式方案采用${calculatedCoil.pricingMode === 'kit' ? '供应商套件价' : '不可覆盖计价模式'}，用户指定线重 ${semantics.wireWeight} 未被正式能力应用；当前正式线圈成本为 ${money(calculatedCoil.totalCost ?? calculatedCoil.cost)} 元，不能把该金额表述为线重覆盖后的结果。`;
    }
    if (status === 'UNSUPPORTED_REQUEST') {
        const current = currentRecipeCost(toolResults), copper = copperPrice(toolResults);
        return `正式成本能力不支持按用户指定铜价 ${semantics.hypotheticalCopperPrice} 直接重算整机成本，因此未把该假设值当作正式结果。${copper == null ? '' : `当前正式铜价基准为 ${Number(copper)}。`}${current == null ? '' : `${targetRecipe?.name || semantics.requestedIdentity.token} 当前完整成本为 ${current} 元；这是当前正式口径，不是按铜价 ${semantics.hypotheticalCopperPrice} 计算。`}`;
    }
    if (status === 'NOT_FOUND_VERIFIED') {
        return `已核对配方、泵壳模板和零件三个正式目录，均未找到 ${semantics.requestedIdentity.token}，因此目前无法给出其成本。`;
    }
    if (status === 'NEEDS_EVIDENCE' || status === 'PARTIAL_VERIFIED') {
        const verifiedFacts = frame?.evidence?.verifiedFacts || [];
        return `${verifiedFacts.length ? `已核实：${verifiedFacts.join('、')}。` : ''}仍缺少正式证据：${(frame?.evidence?.missingFacts || frame?.completeness?.blockers || []).join('、') || '所需业务事实'}，本轮不能给出完整结论。`;
    }
    const partRows = rows(toolResults, 'search_parts');
    if (frame?.subject?.resolutionStatus === 'CROSS_CATALOG_CANDIDATE' && partRows.length) {
        const part = partRows[0];
        return `${semantics.requestedIdentity.token} 未匹配到成品配方，但零件目录找到候选“${part.model || part.name}”（零件 ID ${part.id ?? part.Id}）。这是零件候选，不是整机成本，不能据此给出成品总成本。`;
    }
    if (semantics.kind === 'INVENTORY_QUERY' && coils.length) {
        return `${semantics.requestedIdentity.token} 有 ${coils.length} 套正式方案：${coils.map(row => `${variantLabel(row)}，库存 ${Number(row.stock || 0) > 0 ? `有货 ${row.stock}` : '无货 0'}`).join('；')}。`;
    }
    if (semantics.requestedType === 'coil' && coils.length) {
        const calculated = calculatedCoil;
        if (calculated && semantics.wireWeight != null && calculated.isCustomWireWeight === true) return `${semantics.requestedIdentity.token} 已按用户指定线重 ${semantics.wireWeight} 应用覆盖，正式线圈成本为 ${money(calculated.totalCost ?? calculated.cost)} 元。`;
        if (calculated && semantics.wireWeight != null) return `${semantics.requestedIdentity.token} 的正式方案采用供应商套件价，用户指定线重 ${semantics.wireWeight} 未被正式能力应用；当前正式线圈成本为 ${money(calculated.totalCost ?? calculated.cost)} 元，不能把该金额表述为线重覆盖后的结果。`;
        return `${semantics.requestedIdentity.token} 有 ${coils.length} 套正式方案：${coils.map(row => `${variantLabel(row)}，成本 ${variantCost(row)} 元`).join('；')}。`;
    }
    if (semantics.kind === 'CONFIGURATION_OVERRIDE' && targetRecipe) {
        const current = currentRecipeCost(toolResults);
        return `以${targetRecipe.name || semantics.requestedIdentity.token}为基准配方，线圈覆盖为 ${semantics.requestedIdentity.spec}-${semantics.requestedIdentity.sheets}；未提到的电缆、包装/纸箱、其他零件和人工工资均保留并继承原配置。${current ? `正式试算的当前完整成本为 ${current} 元。` : ''}`;
    }
    const current = currentRecipeCost(toolResults);
    if (targetRecipe && current) return `${targetRecipe.name || semantics.requestedIdentity.token} 当前完整成本为 ${current} 元（正式当前完整成本口径）。`;
    return '';
}

function enforceSemanticAnswerBoundary({ frame, answer, toolResults = [], userText = '' } = {}) {
    const decision = enforcementDecision(frame, answer);
    const fallback = deterministicSemanticAnswer(frame, toolResults, userText);
    // Supported semantic turns use one deterministic paragraph. Replacing instead of appending prevents
    // legacy postprocessors and the boundary from emitting duplicate or contradictory conclusions.
    const shouldNormalize = Boolean(fallback) && frame?.question?.kind !== 'OUT_OF_SCOPE';
    return { answer: shouldNormalize ? fallback : String(answer || ''), replaced: shouldNormalize || decision.replace,
        fallbackType: decision.fallback, status: decision.status, violations: decision.violations };
}

module.exports = { deterministicSemanticAnswer, enforceSemanticAnswerBoundary };
