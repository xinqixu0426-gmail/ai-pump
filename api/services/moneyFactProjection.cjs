'use strict';
/**
 * 正式金额事实投影（Legacy 边界）—— Root Cause A「事实身份丢失」的结构性收口。
 *
 * ── 它是什么 ────────────────────────────────────────────────────────
 * 把**本轮已核验的工具结果**投影成「带身份的金额事实」，供 Legacy 末端
 * （金额表渲染 `formatMoneySummary`、金额守卫 `aiMoneyGuard`）使用。
 *
 * 它**不是**第二套事实系统：
 *   - 事实**存在性**来自已登记的能力金额契约
 *     （`api/capabilities/monetaryPresentationContract.cjs`，未登记能力 fail-closed）；
 *   - **实体身份**来自已有 canonical entity identity
 *     （`api/services/aiStableEntityIdentityV4.cjs`），不新造身份规则；
 *   - **事实键**沿用 Native Task V2 的 FactKey 形状
 *     （`api/services/aiTaskFactsV2.cjs::makeFactKey`），并以其稳定哈希做去重键。
 * 它不做业务计算、不调用模型、不读数据库、不改金额数值。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 * 原 Legacy 金额链把事实压扁成「对象显示名 + 项目文案 + 裸数字」：
 *   - 去重键 `[name, label]`（丢金额）或 `[label, value]`（丢实体）→ 同价不同实体被吞、
 *     同名不同实体被吞（A01）；
 *   - 守卫只校验「这个数字是否在正式金额集合里」→ A=200 / B=100 的错配无法发现（A02）；
 *   - 展示层再用全文替换 `档案成本 → 线圈档案成本` 决定成本口径（A06）。
 * 三者的共同根因是**金额声明没有绑定正式事实身份**。本投影提供该身份。
 *
 * ── 身份强度 ────────────────────────────────────────────────────────
 *   canonical  —— 记录自身带 canonical identity（id / schemeCode / name+spec …）；
 *   structural —— 记录无 canonical identity，退化为「能力 + 结果内 JSON 位置」。
 * 两种身份都**可区分同价的不同实体**；只有两者都是 structural 且 predicate、value
 * 都相同时，才按「同一事实的重复来源」合并（保持既有「两个能力报告同一件事只留一条」）。
 */

const { monetaryPresentationFor } = require('../capabilities/monetaryPresentationContract.cjs');

// ── predicate → 业务标签 ────────────────────────────────────────────
// 键是本轮正式结果里的**字段名**（predicate），值是默认业务标签。
// 这里是标签的**唯一权威**：展示层不得再对最终文本做口径替换。
const MONEY_PREDICATE_LABELS = Object.freeze({
    currentTotalCost: '当前总成本',
    totalCost: '总成本',
    totalRevenue: '总收入',
    totalProfit: '总利润',
    cost: '档案成本',
    price: '目录单价',
    costDiff: '成本差额（后者减前者）',
    totalDiff: '成本差额（后者减前者）',
    partsCost: '零件成本',
    laborCost: '人工成本',
});

// ── 实体类型限定的标签 ──────────────────────────────────────────────
// 只有**实体类型确定**时才把通用口径收窄到具体业务口径。
// 例：线圈档案的 cost 是「线圈档案成本」；整机/未知实体的 cost 仍是通用「档案成本」——
// 展示层不得把整机成本改写成线圈口径（A06）。
const ENTITY_SCOPED_LABELS = Object.freeze({
    coil: Object.freeze({ cost: '线圈档案成本' }),
    part: Object.freeze({ price: '零件目录单价' }),
});

// ── 实体类型 / 身份 ──────────────────────────────────────────────────
// E1-C：身份契约统一在 api/services/canonicalEntityIdentity.cjs（主键优先、名称不是 canonical、
// 缺主键可经正式回执唯一映射绑定、否则 fail-closed 标记 IDENTITY_INCOMPLETE）。
// 本模块不再自带一份实体类型判定，避免多个 capability 各自解释身份。
const {
    ENTITY_TYPE_MARKERS,
    DOMAIN_ENTITY_TYPE: CAPABILITY_DOMAIN_ENTITY_TYPE,
    inferEntityType: inferMoneyEntityType,
    businessKeyValues,
    canonicalIdentityFor,
    buildEntityBindingIndex,
    resolveEntityIdentity,
    entityIdentityKey,
} = require('./canonicalEntityIdentity.cjs');

// E2 §6：金额归属节点自身不携带任何身份字段的正式回执，允许用**同一回执内唯一**的
// 身份节点（业务键唯一、且能经正式回执唯一映射到主键）补齐身份。
// 只对这些已核实形状的能力开启：真实 BOM 草稿的金额挂在 `costPreview` 下，
// 主键/名称在兄弟节点 `configurationBasis.recipeName`，这是一个正式业务键，不是自由文本猜测。
const RECEIPT_IDENTITY_FALLBACK_CAPABILITIES = Object.freeze(new Set(['build_recipe_bom_draft']));

/**
 * 回执内唯一身份节点：金额节点无身份字段时用来补齐。
 * 只有恰好一个候选才返回（≥2 时无法判定金额属于谁 → 返回 null，保持 fail-closed）。
 */
function receiptIdentityFallback(result, domain) {
    const seen = new Set();
    const candidates = [];
    (function walk(value, depth = 0) {
        if (!value || typeof value !== 'object' || depth > 2 || seen.has(value)) return;
        seen.add(value);
        if (!Array.isArray(value)) {
            const entityType = inferMoneyEntityType(value, domain);
            if (entityType) {
                const canonical = canonicalIdentityFor({ entityType, record: value });
                if (canonical.state === 'CANONICAL' || businessKeyValues(entityType, value).length) {
                    candidates.push({ entityType, record: value });
                }
            }
        }
        for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, depth + 1);
    })(result?.data ?? result, 0);
    return candidates.length === 1 ? candidates[0] : null;
}

function present(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
}

/** predicate 的业务标签：实体类型限定优先，否则用通用标签。 */
function moneyPredicateLabel(predicate, entityType, declaredLabel) {
    if (declaredLabel) return declaredLabel;
    const scoped = entityType ? ENTITY_SCOPED_LABELS[entityType] : null;
    if (scoped && scoped[predicate]) return scoped[predicate];
    return MONEY_PREDICATE_LABELS[predicate] || null;
}

function isMoneyPredicate(predicate) {
    return Object.prototype.hasOwnProperty.call(MONEY_PREDICATE_LABELS, predicate);
}

// 业务标签 → predicate 族。词表来自上面的标签权威（declared label 与通用标签），
// 按**最长后缀**匹配，保证「零件成本」不会被当成通用「成本」。
// 用途：把答案里渲染出的金额表行反解成 predicate，从而校验「金额是否属于这一行」。
const PREDICATE_BY_LABEL_SUFFIX = Object.freeze([
    Object.freeze(['成本差额', 'costDiff']),
    Object.freeze(['零件成本', 'partsCost']),
    Object.freeze(['人工成本', 'laborCost']),
    Object.freeze(['总收入', 'totalRevenue']),
    Object.freeze(['总利润', 'totalProfit']),
    Object.freeze(['当前总成本', 'currentTotalCost']),
    Object.freeze(['总成本', 'totalCost']),
    Object.freeze(['成本', 'cost']),
    Object.freeze(['单价', 'price']),
]);

/** 从用户可见的业务标签反解 predicate 族；未知标签返回 null（不做推断）。 */
function moneyPredicateFamilyOfLabel(label) {
    const text = String(label ?? '').replace(/[（(].*$/u, '').trim();
    if (!text) return null;
    for (const [suffix, predicate] of PREDICATE_BY_LABEL_SUFFIX) if (text.endsWith(suffix)) return predicate;
    return null;
}

/** 金额展示值：保留来源有效精度，只清二进制浮点尾差（与展示层同一契约）。 */
function moneyDisplayValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return String(Number(numeric.toFixed(10)));
}

/**
 * 构造 V2 FactKey 形状的事实键并取其稳定哈希。
 * 惰性 require：`aiTaskFactsV2` 会加载执行器图谱，模块顶层 require 会引入环。
 */
function factIdentityHash({ entityType, entityId, predicate, basis, factPath, capability }) {
    const { makeFactKey } = require('./aiTaskFactsV2.cjs');
    const { stableHash } = require('./stableJson.cjs');
    return stableHash(makeFactKey({
        entityType: entityType || 'unknown',
        entityId: entityId || factPath,
        predicate,
        temporalScope: 'CURRENT',
        basis,
        unit: 'pump',
        currency: 'CNY',
        snapshotVersion: capability,
    }));
}

/**
 * 本轮正式金额事实（带身份）。
 *
 * 只有「正式成功 + 有执行证据」的能力结果参与；访问级别与 operation 的取舍
 * 与既有金额表完全一致（preview 永远参与；query 需 includeQueries）。
 *
 * @returns {Array<object>}
 */
function projectMoneyFacts(toolResults = [], { includeQueries = false } = {}) {
    const { getAiCapability } = require('../capabilities/registry.cjs');
    const { hasVerifiedExecution } = require('./aiExecutionEvidence.cjs');
    const facts = [];
    const orderedResults = [...toolResults].sort((a, b) =>
        Number(getAiCapability(b.name)?.operation === 'preview') - Number(getAiCapability(a.name)?.operation === 'preview'));

    const bindingIndex = buildEntityBindingIndex(toolResults);
    function addFact({ capability, capabilityLabel, domain, record, pointer, predicate, value, declaredLabel, basis, objectLabel }) {
        const raw = present(value);
        if (raw === null || !/^-?\d+(?:\.\d+)?$/u.test(raw)) return;
        const numeric = Number(raw);
        if (!Number.isFinite(numeric)) return;
        const displayValue = moneyDisplayValue(numeric);
        if (displayValue === null) return;
        const entityType = inferMoneyEntityType(record, domain);
        const label = moneyPredicateLabel(predicate, entityType, declaredLabel);
        if (!label) return;
        let resolved = resolveEntityIdentity({ entityType, record, domainHint: domain, index: bindingIndex });
        // E2 §6：金额节点自身无身份字段时，用同一正式回执内唯一身份节点 + 正式回执唯一映射补齐。
        if (resolved.state !== 'CANONICAL' && current?.receiptIdentity) {
            const viaReceipt = resolveEntityIdentity({
                entityType: current.receiptIdentity.entityType || entityType,
                record: current.receiptIdentity.record,
                domainHint: domain,
                index: bindingIndex,
            });
            if (viaReceipt.state === 'CANONICAL') {
                resolved = Object.freeze({ ...resolved, ...viaReceipt, displayName: viaReceipt.displayName || resolved.displayName });
            } else if (viaReceipt.ambiguous) {
                // 回执级业务键命中多个主键：身份**可判为不可唯一确定**，如实标记歧义（仍然 fail-closed）。
                resolved = Object.freeze({ ...resolved, reasonCode: viaReceipt.reasonCode, ambiguous: true });
            }
        }
        const identity = entityIdentityKey(resolved);
        // 只有主键（含正式回执绑定）才算 canonical；名称/编码只是展示身份。
        const identityStrength = identity ? 'canonical' : 'incomplete';
        const identityKey = identity || pointer;
        facts.push({
            capability,
            capabilityLabel,
            domain,
            predicate,
            label,
            declared: Boolean(declaredLabel),
            basis,
            value: numeric,
            displayValue,
            objectLabel: objectLabel || capabilityLabel,
            entityType: resolved.entityType ?? entityType,
            entityId: identity,
            identityState: resolved.state,
            identityResolvedBy: resolved.resolvedBy,
            identityReasonCode: resolved.reasonCode,
            identityAmbiguous: resolved.ambiguous,
            identityStrength,
            identityKey,
            factPath: pointer,
            factKeyHash: factIdentityHash({ entityType, entityId: identityKey, predicate, basis, factPath: pointer, capability }),
        });
    }

    function visit(value, label, pointer, depth = 0) {
        if (!value || typeof value !== 'object' || depth > 3) return;
        const name = [value.name || value.recipeName || value.model || value.schemeCode, value.spec && value.sheets ? `${value.spec}-${value.sheets}` : '', value.material, value.slotType].filter(Boolean).join(' / ') || label;
        for (const [key, item] of Object.entries(value)) {
            if (isMoneyPredicate(key) && /^-?\d+(?:\.\d+)?$/u.test(String(item))) {
                const declaredLabel = current?.declaredByPredicate?.[key] || null;
                addFact({ ...current, record: value, pointer: `${pointer}/${key}`, predicate: key, value: item, declaredLabel, basis: declaredLabel ? 'CAPABILITY_CONTRACT' : 'RESULT_FIELD', objectLabel: name });
            } else if (key === 'value' && typeof item === 'number' && /成本|金额|单价|工资|费用/u.test(String(value.label || ''))) {
                addFact({ ...current, record: value, pointer: `${pointer}/value`, predicate: 'cost', value: item, basis: 'RESULT_FIELD', objectLabel: name });
            } else if (item && typeof item === 'object' && !['executionEvidence', 'provenance', 'comparison'].includes(key)) {
                visit(item, name, `${pointer}/${key}`, depth + 1);
            }
        }
    }

    let current = null;
    for (const item of orderedResults) {
        const capability = getAiCapability(item.name);
        if (!(item.result?.success !== false && hasVerifiedExecution(item.result) && !item.result?.data?.requiresVariantSelection && !item.result?.requiresVariantSelection && capability?.access === 'read' && (capability.operation === 'preview' || (includeQueries && capability.operation === 'query')))) continue;
        const contract = monetaryPresentationFor(item.name);
        // 契约登记的 predicate → 业务标签。标签以契约为准（这是「金额口径」的唯一权威），
        // 但事实的**读取路径仍是结果自身的结构**，因此不会因为契约路径写法不同而漏事实或重复事实。
        const declaredByPredicate = Object.fromEntries(
            (Array.isArray(contract.availableMoneyFacts) ? contract.availableMoneyFacts : [])
                .map(fact => [String(fact.path).split('.').pop(), fact.label])
        );
        current = { capability: item.name, capabilityLabel: capability.displayName, domain: capability.domain, declaredByPredicate };
        current.receiptIdentity = RECEIPT_IDENTITY_FALLBACK_CAPABILITIES.has(item.name)
            ? receiptIdentityFallback(item.result, capability.domain)
            : null;
        if (item.name === 'get_dashboard_summary') {
            const summary = item.result.summary || item.result.data?.summary || item.result.data;
            visit({ totalRevenue: summary?.financials?.totalRevenue, totalCost: summary?.financials?.totalCost, totalProfit: summary?.financials?.totalProfit }, '订单总盘', `/${item.name}/summary`, 1);
            if (Number(summary?.orders?.completed || 0) > 0) visit({ totalRevenue: summary?.financials?.completed?.totalRevenue, totalCost: summary?.financials?.completed?.totalCost, totalProfit: summary?.financials?.completed?.totalProfit }, '已完成订单', `/${item.name}/completed`, 1);
            continue;
        }
        visit(item.result, capability.displayName, `/${item.name}`, 1);
    }
    // 去重按事实身份，且**只在金额也相同时**才合并：
    //   1) 同一身份 + 同一 predicate + 同一金额 → 同一事实（同一个钱只出现一次）；
    //   2) 同一身份 + 同一 predicate + **不同**金额 → 来源冲突，两条都保留（不得先到先得）；
    //   3) 不同能力、双方都没有 canonical 身份、predicate 与金额都相同 → 同一事实的重复来源
    //      （既有约定：两个能力报告同一件事时只保留先出现的一条）。
    // 同一能力内部的不同位置永远是不同实体，不得因为金额相同而合并。
    const seen = new Set();
    const output = [];
    for (const fact of facts) {
        // 身份不完整时，键里必须带来源位置：不同位置的金额即使同名同值也不得合并
        // （否则「同名不同主键」会被吞掉，正是 A01 的根因）。
        const valueKey = fact.identityStrength === 'canonical'
            ? `${fact.factKeyHash}\u0000${fact.displayValue}`
            : `${fact.factKeyHash}\u0000${fact.factPath}\u0000${fact.displayValue}`;
        if (seen.has(valueKey)) continue;
        const duplicatedAcrossCapabilities = fact.identityStrength !== 'canonical'
            && output.some(existing => existing.capability !== fact.capability
                && existing.identityStrength !== 'canonical'
                && existing.predicate === fact.predicate && existing.value === fact.value);
        if (duplicatedAcrossCapabilities) continue;
        seen.add(valueKey);
        output.push(fact);
    }
    return output;
}

module.exports = {
    MONEY_PREDICATE_LABELS,
    ENTITY_SCOPED_LABELS,
    ENTITY_TYPE_MARKERS,
    CAPABILITY_DOMAIN_ENTITY_TYPE,
    inferMoneyEntityType,
    moneyPredicateLabel,
    moneyPredicateFamilyOfLabel,
    moneyDisplayValue,
    isMoneyPredicate,
    projectMoneyFacts,
};
