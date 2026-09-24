'use strict';

const { classifyQuestion } = require('./questionSemantics.cjs');
const { enforcementDecision } = require('./completenessPolicy.cjs');
const { authoritativeCoilCandidateScope } = require('./authoritativeCandidateScope.cjs');
const { formalRelationEvidence } = require('./formalRelationEvidence.cjs');
const { readinessProfile } = require('./readinessSemantics.cjs');

function verified(item) { return item?.result?.success !== false && item?.result?.executionEvidence?.verified === true; }
function rows(toolResults, name) { return toolResults.filter(item => verified(item) && item.name === name).flatMap(item => {
    if (Array.isArray(item.result?.data)) return item.result.data;
    if (name === 'search_parts' && Array.isArray(item.result?.parts)) return item.result.parts;
    return [];
}); }
function money(value) {
    // 缺失值不是 0.00：null/'' 必须保持「没有金额」，否则会用 0.00 冒充当前成本（S2-R1 §A）。
    if (value === null || value === undefined || value === '') return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toFixed(2) : null;
}
function recipe(toolResults) { return rows(toolResults, 'get_all_recipes')[0] || toolResults.find(item => verified(item) && item.name === 'get_recipe_detail')?.result?.recipe || null; }
function recipeIdentityResolution(toolResults) {
    return toolResults.filter(verified).filter(item => item.name === 'get_all_recipes')
        .map(item => item.result?.identityResolution).find(Boolean) || null;
}
// S2-R1 §A：CURRENT 权威必须由**回执自己声明的、当前重算的口径**证明。
// 只有 costBasis=currentFullCost（或契约等价的当前重算口径）才允许被表述成「当前完整成本」；
// 保存快照 / BOM 草稿 / 覆盖试算一律不能冒充当前值。
const CURRENT_COST_BASES = new Set(['currentFullCost', 'currentTemplateAndRecipeParameters', 'CURRENT_REBUILT']);
function isCurrentCostReceipt(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.sourceOfTruth !== undefined && data.sourceOfTruth !== null && data.sourceOfTruth !== 'costEngine') return false;
    const basis = data.costBasis ?? data.basis;
    if (basis !== undefined && basis !== null && !CURRENT_COST_BASES.has(String(basis))) return false;
    return true;
}
function currentRecipeCost(toolResults, authority = null) {
    if (authority?.costBasis) {
        for (const item of toolResults.filter(verified)) {
            if (!['preview_recipe_cost', 'full_calculate'].includes(item.name)) continue;
            const data = item.result?.data || {};
            const recipeId = Number(data.recipeId ?? data.recipeCost?.recipeId ?? data.configurationBasis?.baseRecipeId ?? data.baseRecipeId);
            const appliedCoilId = Number(data.configurationSnapshot?.coilId);
            if (data.sourceOfTruth !== authority.sourceOfTruth || data.costBasis !== authority.costBasis
                || recipeId !== Number(authority.recipeId)
                || (authority.appliedCoilId && appliedCoilId !== Number(authority.appliedCoilId))) continue;
            const value = data.currentTotalCost ?? data.totalCost ?? data.unitCost ?? data.costPreview?.currentTotalCost;
            if (money(value)) return money(value);
        }
        return null;
    }
    for (const item of toolResults.filter(verified)) {
        if (item.name === 'get_recipe_detail') {
            const scoped = item.result?.currentCost ?? item.result?.recipe?.currentCost;
            if (!scoped || !isCurrentCostReceipt(scoped)) continue;
            const value = scoped.currentTotalCost;
            if (money(value)) return money(value);
        }
        if (item.name === 'preview_recipe_cost' || item.name === 'full_calculate') {
            const data = item.result?.data;
            if (!data || !isCurrentCostReceipt(data)) continue;
            const value = data.currentTotalCost ?? (data.costComplete === false ? null : data.totalCost);
            if (money(value)) return money(value);
        }
        if (item.name === 'compare_recipe_scenarios') {
            // 同一轮的路由回执（costBasis=CURRENT_REBUILT）就是当前重建权威；Native 用同一指针取事实。
            const data = item.result?.data;
            const scenario = Array.isArray(data?.scenarios) ? data.scenarios[0] : null;
            const scoped = scenario?.cost;
            if (!scoped || scoped.complete === false) continue;
            const value = scoped.currentTotalCost ?? scoped.totalCost;
            if (money(value)) return money(value);
        }
    }
    return null;
}

/** 保存成本快照（只在用户明确问保存/历史/上次成本时使用）。 */
function savedRecipeCost(toolResults) {
    for (const item of toolResults.filter(verified)) {
        const candidates = [item.result?.data, item.result?.costPreview, item.result?.recipe];
        for (const data of candidates) {
            if (!data || typeof data !== 'object') continue;
            const value = data.savedTotalCost ?? data.savedCost;
            if (money(value)) return { value: money(value), basis: 'SAVED_RECIPE_SNAPSHOT' };
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
    return authoritativeCoilCandidateScope(rows(toolResults, 'search_coils'), semantics).rows;
}
function variantLabel(row) { return [row.material, row.slotType, row.schemeCode].filter(Boolean).join('/') || `方案ID ${row.id ?? row.Id}`; }
function variantCost(row) { return money(row.cost ?? row.totalCost ?? row.kitPrice ?? row.unitCost); }
function relationAnswer(evidence, requestedToken) {
    if (!evidence) return '';
    if (evidence.rootNotFound) return `在正式线圈方案范围内未找到“${requestedToken}”，因此无法查询它被哪些配方使用。`;
    if (evidence.relationId === 'recipe.uses_coil') {
        const coil = evidence.items[0];
        const identity = [coil.material, coil.slotType].map(value => String(value || '').trim()).filter(Boolean);
        return `${evidence.rootName || requestedToken} 使用 ${coil.spec}-${coil.sheets} 线圈${identity.length ? `（${identity.join('/')}）` : ''}。`;
    }
    if (evidence.relationId === 'recipe.contains_part') {
        if (evidence.empty) return `${requestedToken} 的已保存规范零件关系为空（范围仅为 partsJson）。`;
        return `${requestedToken} 的已保存规范零件：${evidence.items.map(item => item.partName).join('、')}。范围仅为 partsJson。`;
    }
    if (evidence.relationId === 'part.contained_in_recipe' || evidence.relationId === 'coil.used_by_recipe') {
        const names = evidence.items.map(item => item.recipeName).filter(Boolean);
        if (!names.length) return `${requestedToken} 当前没有被任何有效配方正式引用。`;
        return `${requestedToken} 当前被以下配方正式引用：${names.join('、')}。`;
    }
    return '';
}

function deterministicSemanticAnswer(frame, toolResults, userText) {
    const semantics = classifyQuestion(userText, { admittedCatalogLookup: frame?.question?.kind === 'CATALOG_LOOKUP' });
    const readinessRequest = semantics.kind === 'INVENTORY_QUERY' && readinessProfile(userText).active;
    const requestedToken = frame?.subject?.requestedToken || semantics.requestedIdentity.token || '该目标';
    const status = frame?.completeness?.status;
    const targetRecipe = recipe(toolResults);
    const coils = matchingCoils(toolResults, semantics);
    const identityResolution = recipeIdentityResolution(toolResults);
    const relation = formalRelationEvidence(userText, toolResults);
    const formalRelationAnswer = relationAnswer(relation, requestedToken);
    if (formalRelationAnswer) return formalRelationAnswer;
    if (identityResolution?.state === 'ALIAS_TARGET_UNAVAILABLE') {
        return `“${requestedToken}”存在正式历史别名记录，但其目标配方已不可用，不能绑定为当前规范对象。请提供仍有效的正式配方全名；本轮不能给出成本。`;
    }
    if (frame?.subject?.resolutionStatus === 'ALIAS_UNRESOLVED') {
        return `“${requestedToken}”包含历史别名含义，但当前没有正式别名映射可确认其规范对象。请提供正式配方全名或确认对应型号；本轮不能据此断言对象不存在，也不能给出成本。`;
    }
    if (identityResolution?.state === 'ALIAS_AMBIGUOUS') {
        return `“${requestedToken}”对应多个仍有效的正式配方，不能自动选择。请提供当前正式配方全名后再查询成本；本轮未选择任何目标。`;
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
        return `已核对配方、泵壳模板和零件三个正式目录，均未找到“${requestedToken}”，因此目前无法给出其成本。`;
    }
    if (status === 'NEEDS_EVIDENCE' || status === 'PARTIAL_VERIFIED') {
        const verifiedFacts = frame?.evidence?.verifiedFacts || [];
        const missing = frame?.evidence?.missingFacts || frame?.completeness?.blockers || [];
        // S2-R3-P1 §F：内部证据码/正式需求键只进 trace，不进用户正文。
        const missingText = [...new Set(missing.map(businessFactText))].join('、');
        return `${verifiedFacts.length ? `已核实：${verifiedFacts.map(businessFactText).join('、')}。` : ''}仍缺少正式证据：${missingText || '所需业务事实'}，本轮不能给出完整结论。`;
    }
    const partRows = rows(toolResults, 'search_parts');
    if (semantics.operation === 'READ_COPPER_PRICE') {
        const copper = copperPrice(toolResults);
        if (copper != null) return `当前正式铜价基准为 ${Number(copper)}。`;
    }
    if (frame?.subject?.resolutionStatus === 'CROSS_CATALOG_CANDIDATE' && partRows.length) {
        const part = partRows[0];
        const unitCost = money(part.price);
        if (semantics.kind === 'COST_QUERY' && frame?.evidence?.verifiedFacts?.includes('PART_CATALOG_UNIT_COST') && unitCost != null) {
            return `${requestedToken} 未匹配到成品配方，但零件目录找到“${part.model || part.name}”（零件 ID ${part.id ?? part.Id}），零件目录单位成本为 ${unitCost} 元。这是零件目录单价，不是整机或配方成本。`;
        }
        return `${semantics.requestedIdentity.token} 未匹配到成品配方，但零件目录找到候选“${part.model || part.name}”（零件 ID ${part.id ?? part.Id}）。这是零件候选，不是整机成本，不能据此给出成品总成本。`;
    }
    if (semantics.kind === 'INVENTORY_QUERY' && coils.length) {
        const scopeLabel = semantics.requestedVariantScope === 'TESTING' ? '测试方案'
            : semantics.requestedVariantScope === 'ALL_ACTIVE' ? '在用方案' : '正式方案';
        return `${semantics.requestedIdentity.token} 有 ${coils.length} 套${scopeLabel}：${coils.map(row => `${variantLabel(row)}，库存 ${Number(row.stock || 0) > 0 ? `有货 ${row.stock}` : '无货 0'}`).join('；')}。`;
    }
    if (semantics.requestedType === 'coil' && coils.length) {
        const calculated = calculatedCoil;
        if (calculated && semantics.wireWeight != null && calculated.isCustomWireWeight === true) return `${semantics.requestedIdentity.token} 已按用户指定线重 ${semantics.wireWeight} 应用覆盖，正式线圈成本为 ${money(calculated.totalCost ?? calculated.cost)} 元。`;
        if (calculated && semantics.wireWeight != null) return `${semantics.requestedIdentity.token} 的正式方案采用供应商套件价，用户指定线重 ${semantics.wireWeight} 未被正式能力应用；当前正式线圈成本为 ${money(calculated.totalCost ?? calculated.cost)} 元，不能把该金额表述为线重覆盖后的结果。`;
        return `${semantics.requestedIdentity.token} 有 ${coils.length} 套正式方案：${coils.map(row => `${variantLabel(row)}，成本 ${variantCost(row)} 元`).join('；')}。`;
    }
    if (semantics.kind === 'CONFIGURATION_OVERRIDE' && targetRecipe) {
        const currentCostFact = frame?.evidence?.facts?.find(item => item.factType === 'RECIPE_CURRENT_FULL_COST'
            && item.state === 'VERIFIED');
        const current = currentRecipeCost(toolResults, currentCostFact?.costBasis ? {
            recipeId: frame?.subject?.canonicalId,
            costBasis: currentCostFact.costBasis,
            sourceOfTruth: currentCostFact.sourceOfTruth,
            appliedCoilId: currentCostFact.appliedCoilId,
        } : null);
        return `以${targetRecipe.name || semantics.requestedIdentity.token}为基准配方，线圈覆盖为 ${semantics.requestedIdentity.spec}-${semantics.requestedIdentity.sheets}；未提到的电缆、包装/纸箱、其他零件和人工工资均保留并继承原配置。${current ? `正式试算的当前完整成本为 ${current} 元。` : ''}`;
    }
    // S2-R3-P1 §C/§E/§F：齐料/缺料请求**永远**留在齐料域。
    // 身份/歧义/不支持等更具体的结论已经在上方优先返回；走到这里的齐料请求
    // 绝不允许落到下面「当前完整成本没有取得可用金额」的金额模板上 ——
    // 它从未问过金额，那样的回答既换了业务域，也与本轮正式回执相矛盾。
    if (readinessRequest) return readinessSemanticAnswer(toolResults, requestedToken);
    const saved = savedRecipeCost(toolResults);
    if (semantics.requestedCostTemporality === 'SAVED') {
        if (targetRecipe && saved) return `${targetRecipe.name || semantics.requestedIdentity.token} 的保存成本快照为 ${saved.value} 元（历史保存口径，不是当前重算结果）。`;
        if (targetRecipe) return `${targetRecipe.name || semantics.requestedIdentity.token} 没有可用的正式保存成本快照；本轮不给金额，也不会用当前重算值代替保存值。`;
    }
    const current = currentRecipeCost(toolResults);
    if (targetRecipe && current) return `${targetRecipe.name || semantics.requestedIdentity.token} 当前完整成本为 ${current} 元（正式当前完整成本口径）。`;
    if (targetRecipe) {
        return `${targetRecipe.name || semantics.requestedIdentity.token} 的本轮正式当前重算没有取得可用金额，因此不给当前完整成本；`
            + (saved ? `档案中的保存成本快照为 ${saved.value} 元，该金额是历史保存口径，不能当作当前完整成本。` : '本轮也没有可用的保存成本快照。');
    }
    if (semantics.kind === 'CATALOG_LOOKUP' && targetRecipe) return `“${requestedToken}”对应的当前正式配方名称为“${targetRecipe.name}”。`;
    return '';
}

// ── S2-R3-P1：齐料/缺料语义答案（Legacy 安全路径）─────────────────────────
// 事实来源只有正式的 `preview_virtual_readiness` 回执；没有回执时如实说明，
// 绝不改答成本、也绝不臆造齐料结论。返回的字符串只在齐料域内。
function readinessUnitLabel(unit) {
    if (unit === 'meter') return 'm';
    if (unit === 'set') return '套';
    return '件';
}
function readinessReceipt(toolResults) {
    for (const item of toolResults.filter(verified)) {
        if (item.name !== 'preview_virtual_readiness') continue;
        const data = item.result?.data;
        if (!data || data.preview !== true || !['READY', 'SHORTAGE'].includes(data.status) || data.coverage?.complete !== true) continue;
        return data;
    }
    return null;
}
function readinessSemanticAnswer(toolResults, requestedToken) {
    const data = readinessReceipt(toolResults);
    const name = data?.recipe?.name || requestedToken;
    if (!data) {
        return `本次没有取得${name}的正式齐料预览回执，因此不给出齐料或短缺结论；本轮也没有查询成本，不涉及任何金额。`
            + '当前正式齐料预览需要明确的台数，请说明按多少台计算。';
    }
    const quantity = Number.isSafeInteger(data.quantity) ? data.quantity : null;
    const prefix = quantity === null
        ? `${name}的库存管理物料`
        : `按当前库存并扣除现有活动订单占用，${quantity}台${name}的库存管理物料`;
    if (data.status === 'READY') return `${prefix}目前没有发现短缺。本结论只覆盖当前正式库存齐料口径，不代表产能或交期；本次没有创建订单或预留库存。`;
    const shortages = (Array.isArray(data.shortages) ? data.shortages : []).map(item => {
        const unit = readinessUnitLabel(item.inventoryUnit);
        return `${item.model || item.requirementKey}需要${item.virtualRequiredQty}${unit}，现可用于这批需求${item.availableForVirtualQty}${unit}，短缺${item.shortageQty}${unit}`;
    });
    if (!shortages.length) return `${prefix}的正式齐料预览没有返回可展示的短缺明细，因此本轮不给短缺清单。本次没有创建订单或预留库存。`;
    return `${prefix}存在短缺：${shortages.join('；')}。以上数值来自正式库存规划回执；本次没有创建订单或预留库存。`;
}

/**
 * 内部证据码只允许留在 trace / 日志 / 证据里（S2-R3-P1 §F）。
 * 用户可见正文一律使用业务语言；未知内部码退化为通用业务措辞。
 */
const MISSING_FACT_BUSINESS_TEXT = Object.freeze({
    CROSS_CATALOG_CANDIDATES: '跨目录候选核对结果',
    RECIPE_CANONICAL_IDENTITY: '正式配方身份',
    RECIPE_CURRENT_FULL_COST: '当前完整成本',
    RECIPE_BASE_CONFIGURATION: '配方基准配置',
    COIL_CANONICAL_IDENTITY: '正式线圈方案身份',
    COIL_OFFICIAL_VARIANT_SET: '正式线圈方案集合',
    COIL_SCHEME_COST: '正式线圈方案成本',
    COIL_VARIANT_INVENTORY: '正式线圈方案库存',
    COIL_OVERRIDE_APPLIED: '线圈覆盖应用结果',
    PART_CATALOG_IDENTITY: '零件目录身份',
    PART_CATALOG_UNIT_COST: '零件目录单位成本',
    CURRENT_COPPER_PRICE_BASIS: '当前正式铜价基准',
    FORMAL_RELATION_RESULT: '正式关系查询结果',
    RECIPE_COST_COMPARISON: '正式成本对比结果',
    VIRTUAL_READINESS_PREVIEW: '正式齐料预览结果',
    AI_RESOURCE_NOT_FOUND: '目标资料',
});
function businessFactText(value) {
    const key = String(value || '');
    return MISSING_FACT_BUSINESS_TEXT[key] || '所需业务事实';
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
