'use strict';
/**
 * E1-A — Structured Criticality Producer Contract（关键事实投影）
 *
 * ── 它解决什么 ──────────────────────────────────────────────────────
 * Phase D 已证明：真实 Legacy read surface 下 `structuredSourceEmpty = 23/23`，
 * 展示层只能退回去「从最终回答文字猜哪些信息重要」（TIER1/TIER2）。本模块把
 * 「这个事实必须展示」变成**正式结构化契约**：
 *
 *     正式 capability result
 *        ↓  本投影（只读正式字段）
 *     CriticalFact（entity + predicate + state + mustShow + reasonCode + sourcePointer）
 *        ↓
 *     Presentation（只排序 / 分组 / 折叠 neutral 行）
 *
 * ── 硬性约束 ────────────────────────────────────────────────────────
 * 1. `mustShow` 只能来自**正式结构化字段**，不得从最终自然语言
 *    （「缺」「还差」「待采购」「异常」）重新推断。
 * 2. 字段名必须来自真实 capability 输出契约（executor / service），不得猜。
 *    无法确认的 producer 一律记录 `PRODUCER_NOT_AVAILABLE`，不创造字段。
 * 3. 身份复用 E1-C 的 canonical identity（主键优先；名称不是 canonical）。
 * 4. 本模块不做业务计算、不调用模型、不读数据库、不新增事实系统。
 *
 * ── 已接入的正式 producer（字段来源）────────────────────────────────
 *   preview_virtual_readiness      api/services/virtualReadinessPreview.cjs
 *                                  → status / coverage / shortages / unresolvedRequirements / excludedRequirements / warnings
 *   preview_recipe_cost            api/routes/ai/executors/businessExecutors.cjs + currentRecipeCost
 *                                  → data.costComplete / data.missingParts / data.warnings
 *   build_recipe_bom_draft         → data.costPreview.pricingComplete / data.configurationBasis.configurationComplete / data.warnings
 *   get_order_readiness_overview   api/services/orderReadinessOverview.cjs
 *                                  → data.items[].verdict / shortages / blockers / warnings
 *   check_order_readiness          api/services/orderReadiness.cjs（单订单同源 readiness）
 *                                  → verdict / shortages / blockers / warnings
 *   get_purchase_overview          api/services/orderQueries.cjs
 *                                  → data.tasks[].pendingQty / model / supplierLabel
 */

const { createHash } = require('node:crypto');
const { inferEntityType, resolveEntityIdentity, entityIdentityKey, buildEntityBindingIndex } = require('./canonicalEntityIdentity.cjs');

const CRITICAL_FACT_PROJECTION_VERSION = 1;
const PRODUCER_STATE = Object.freeze({ ACTIVE: 'ACTIVE', PRODUCER_NOT_AVAILABLE: 'PRODUCER_NOT_AVAILABLE' });
const SEVERITY = Object.freeze({ CRITICAL: 'CRITICAL', SUPPORT: 'SUPPORT' });
// displayScope 决定「必须展示」该在哪里被核对：
//   ROW     —— 该 token 应出现在**清单行**里（缺料对象、缺失零件、待采购项、告警文本）；
//   SUBJECT —— 该 token 是**处于关键状态的主体本身**（某配方/某订单），只需出现在回答中，
//              不能要求它出现在清单行里。
const DISPLAY_SCOPE = Object.freeze({ ROW: 'ROW', SUBJECT: 'SUBJECT' });

// 正式状态枚举 → 关键级别。全部来自各 producer 的真实输出契约。
const READINESS_CRITICAL_VERDICTS = Object.freeze(['waiting_materials', 'needs_review', 'blocked']);
const READINESS_REASON_BY_VERDICT = Object.freeze({
    waiting_materials: 'READINESS_WAITING_MATERIALS',
    needs_review: 'READINESS_NEEDS_REVIEW',
    blocked: 'READINESS_BLOCKED',
});

function present(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
}
function list(value) { return Array.isArray(value) ? value : []; }
function factIdentityOf(parts) {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

/**
 * 构造一条关键事实。
 * `displayToken` 是「清单行里应当出现的身份片段」，presentation 只用它做保守判定。
 */
function criticalFact({ identity = null, capability, pointer, predicate, state, severity = SEVERITY.CRITICAL, reasonCode, displayToken = null, detail = null, displayScope = DISPLAY_SCOPE.ROW }) {
    const entityId = entityIdentityKey(identity);
    return Object.freeze({
        factIdentity: factIdentityOf([capability, pointer, predicate, state, displayToken]),
        entityType: identity?.entityType ?? null,
        entityId,
        entityIdentityState: identity?.state ?? 'IDENTITY_INCOMPLETE',
        entityDisplayName: identity?.displayName ?? null,
        predicate,
        state,
        severity,
        mustShow: severity === SEVERITY.CRITICAL,
        reasonCode,
        sourceCapability: capability,
        sourcePointer: pointer,
        displayToken: present(displayToken),
        displayScope,
        detail: detail === null ? null : String(detail).slice(0, 200),
    });
}

/** 从正式回执中取「主体身份 + 令牌」：优先主键，其次规范名。 */
function subjectOf(result, index, domainHint, pointer) {
    const data = result?.data ?? result;
    const record = data?.recipe && typeof data.recipe === 'object' ? data.recipe : data;
    const entityType = inferEntityType(record, domainHint) || (data?.recipeId ? 'recipe' : null);
    const identity = resolveEntityIdentity({ entityType, record, domainHint, index });
    const token = present(data?.recipeName) || present(record?.name) || identity.displayName;
    return { identity, token, pointer };
}

function projectVirtualReadiness(item, index) {
    const data = item.result?.data ?? {};
    const facts = [];
    const subject = subjectOf(item.result, index, 'coil');
    const pointer = `/${item.name}/data`;
    if (present(data.status) === 'SHORTAGE' || present(data.status) === 'INCOMPLETE') {
        facts.push(criticalFact({
            identity: subject.identity, capability: item.name, pointer: `${pointer}/status`, predicate: 'inventory.readiness',
            state: present(data.status), reasonCode: `READINESS_${present(data.status)}`, displayToken: subject.token,
            displayScope: DISPLAY_SCOPE.SUBJECT,
            detail: `coverage.shortageCount=${Number(data.coverage?.shortageCount ?? 0)}`,
        }));
    }
    if (data.coverage && data.coverage.complete === false) {
        facts.push(criticalFact({
            identity: subject.identity, capability: item.name, pointer: `${pointer}/coverage/complete`, predicate: 'inventory.readiness',
            state: 'INCOMPLETE', reasonCode: 'READINESS_COVERAGE_INCOMPLETE', displayToken: subject.token,
            displayScope: DISPLAY_SCOPE.SUBJECT,
        }));
    }
    for (const [position, shortage] of list(data.shortages).entries()) {
        const entityType = String(shortage.resourceType || '').toUpperCase() === 'COIL' ? 'coil' : 'part';
        const resourceId = shortage.coilId ?? shortage.partId;
        const identity = resourceId
            ? resolveEntityIdentity({ entityType, record: { id: Number(resourceId) }, index })
            : resolveEntityIdentity({ entityType, record: { model: shortage.model }, index });
        facts.push(criticalFact({
            identity, capability: item.name, pointer: `${pointer}/shortages/${position}`, predicate: 'inventory.shortage',
            state: 'SHORTAGE', reasonCode: 'INVENTORY_SHORTAGE', displayToken: present(shortage.model),
            detail: `shortageQty=${Number(shortage.shortageQty ?? 0)}`,
        }));
    }
    for (const [position, unresolved] of list(data.unresolvedRequirements).entries()) {
        facts.push(criticalFact({
            identity: subject.identity, capability: item.name, pointer: `${pointer}/unresolvedRequirements/${position}`,
            predicate: 'inventory.readiness', state: 'UNRESOLVED',
            reasonCode: present(unresolved?.code) || 'UNRESOLVED_REQUIREMENT', displayToken: subject.token,
            displayScope: DISPLAY_SCOPE.SUBJECT,
        }));
    }
    for (const [position, excluded] of list(data.excludedRequirements).entries()) {
        facts.push(criticalFact({
            identity: subject.identity, capability: item.name, pointer: `${pointer}/excludedRequirements/${position}`,
            predicate: 'inventory.readiness', state: 'EXCLUDED',
            reasonCode: present(excluded?.code) || 'EXCLUDED_REQUIREMENT', displayToken: subject.token,
            displayScope: DISPLAY_SCOPE.SUBJECT,
        }));
    }
    for (const [position, warning] of list(data.warnings).entries()) {
        const text = present(typeof warning === 'string' ? warning : warning?.message);
        if (text) facts.push(criticalFact({
            identity: subject.identity, capability: item.name, pointer: `${pointer}/warnings/${position}`,
            predicate: 'result.warning', state: 'WARNING', reasonCode: 'RESULT_WARNING', displayToken: text,
        }));
    }
    return facts;
}

function projectRecipeCost(item, index) {
    const data = item.result?.data ?? {};
    const facts = [];
    const subject = subjectOf(item.result, index, 'recipe');
    const pointer = `/${item.name}/data`;
    if (data.costComplete === false) {
        facts.push(criticalFact({
            identity: subject.identity, capability: item.name, pointer: `${pointer}/costComplete`, predicate: 'cost.completeness',
            state: 'INCOMPLETE', reasonCode: 'COST_INCOMPLETE', displayToken: subject.token,
            displayScope: DISPLAY_SCOPE.SUBJECT,
        }));
    }
    for (const [position, missing] of list(data.missingParts).entries()) {
        const token = present(typeof missing === 'string' ? missing : missing?.model) || present(missing?.name);
        facts.push(criticalFact({
            identity: resolveEntityIdentity({ entityType: 'part', record: typeof missing === 'object' ? missing : {}, index }),
            capability: item.name, pointer: `${pointer}/missingParts/${position}`, predicate: 'cost.missing_price',
            state: 'MISSING', reasonCode: 'COST_MISSING_PART', displayToken: token,
        }));
    }
    for (const [position, warning] of list(data.warnings).entries()) {
        const text = present(typeof warning === 'string' ? warning : warning?.message);
        if (text) facts.push(criticalFact({
            identity: subject.identity, capability: item.name, pointer: `${pointer}/warnings/${position}`,
            predicate: 'result.warning', state: 'WARNING', reasonCode: 'RESULT_WARNING', displayToken: text,
        }));
    }
    return facts;
}

function projectBomDraft(item, index) {
    const data = item.result?.data ?? {};
    const facts = [];
    const subject = subjectOf(item.result, index, 'recipe');
    const pointer = `/${item.name}/data`;
    if (data.costPreview?.pricingComplete === false) {
        facts.push(criticalFact({
            identity: subject.identity, capability: item.name, pointer: `${pointer}/costPreview/pricingComplete`,
            predicate: 'cost.completeness', state: 'INCOMPLETE', reasonCode: 'PRICING_INCOMPLETE', displayToken: subject.token,
            displayScope: DISPLAY_SCOPE.SUBJECT,
        }));
    }
    if (data.configurationBasis?.configurationComplete === false) {
        facts.push(criticalFact({
            identity: subject.identity, capability: item.name, pointer: `${pointer}/configurationBasis/configurationComplete`,
            predicate: 'configuration.completeness', state: 'INCOMPLETE', reasonCode: 'CONFIGURATION_INCOMPLETE', displayToken: subject.token,
            displayScope: DISPLAY_SCOPE.SUBJECT,
        }));
    }
    for (const [position, warning] of list(data.warnings).entries()) {
        const text = present(typeof warning === 'string' ? warning : warning?.message);
        if (text) facts.push(criticalFact({
            identity: subject.identity, capability: item.name, pointer: `${pointer}/warnings/${position}`,
            predicate: 'result.warning', state: 'WARNING', reasonCode: 'RESULT_WARNING', displayToken: text,
        }));
    }
    return facts;
}

/** 单订单 readiness（check_order_readiness）与概览条目共用同一 readiness 契约。 */
function projectReadinessObject(readiness, { capability, pointerPrefix, index, orderToken }) {
    const facts = [];
    const order = readiness?.order || {};
    const orderIdentity = resolveEntityIdentity({ entityType: 'order', record: { id: Number(order.id || 0) || undefined, contractNo: order.contractNo }, index });
    const subjectToken = present(order.contractNo) || present(order.id) || orderToken;
    const verdict = present(readiness?.verdict);
    if (READINESS_CRITICAL_VERDICTS.includes(verdict)) {
        facts.push(criticalFact({
            identity: orderIdentity, capability, pointer: `${pointerPrefix}/verdict`, predicate: 'order.readiness',
            state: verdict.toUpperCase(), reasonCode: READINESS_REASON_BY_VERDICT[verdict] || 'READINESS_ATTENTION', displayToken: subjectToken,
            displayScope: DISPLAY_SCOPE.SUBJECT,
        }));
    }
    for (const [position, shortage] of list(readiness?.shortages).entries()) {
        facts.push(criticalFact({
            identity: resolveEntityIdentity({ entityType: 'part', record: {}, index }),
            capability, pointer: `${pointerPrefix}/shortages/${position}`, predicate: 'inventory.shortage',
            state: 'SHORTAGE', reasonCode: 'INVENTORY_SHORTAGE', displayToken: present(shortage?.model),
        }));
    }
    for (const [field, reasonCode] of [['blockers', 'ORDER_BLOCKER'], ['warnings', 'ORDER_WARNING']]) {
        for (const [position, entry] of list(readiness?.[field]).entries()) {
            const text = present(typeof entry === 'string' ? entry : entry?.title) || present(entry?.detail);
            if (text) facts.push(criticalFact({
                identity: orderIdentity, capability, pointer: `${pointerPrefix}/${field}/${position}`,
                predicate: 'order.readiness', state: field === 'blockers' ? 'BLOCKED' : 'WARNING',
                reasonCode: present(entry?.code) || reasonCode, displayToken: text,
            }));
        }
    }
    return facts;
}

function projectOrderReadinessOverview(item, index) {
    const data = item.result?.data ?? {};
    const facts = [];
    for (const [position, entry] of list(data.items).entries()) {
        facts.push(...projectReadinessObject(entry?.readiness ?? entry, {
            capability: item.name, pointerPrefix: `/${item.name}/data/items/${position}`, index, orderToken: entry?.order?.id,
        }));
    }
    return facts;
}

function projectPurchaseOverview(item, index) {
    const data = item.result?.data ?? {};
    const facts = [];
    if (!Array.isArray(data.tasks)) {
        // 正式 schema 不支持 tasks[] 时不猜字段：记录为不可用，由调用方决定。
        return { facts, state: PRODUCER_STATE.PRODUCER_NOT_AVAILABLE };
    }
    for (const [position, task] of data.tasks.entries()) {
        if (!(Number(task?.pendingQty) > 0)) continue;
        facts.push(criticalFact({
            identity: resolveEntityIdentity({ entityType: 'part', record: { model: task?.model }, index }),
            capability: item.name, pointer: `/${item.name}/data/tasks/${position}`, predicate: 'purchase.pending',
            state: 'PENDING', reasonCode: 'PURCHASE_PENDING', displayToken: present(task?.model),
            detail: `pendingQty=${Number(task.pendingQty)}; supplier=${present(task.supplierLabel) ?? ''}`,
        }));
    }
    return { facts, state: PRODUCER_STATE.ACTIVE };
}

const PRODUCERS = Object.freeze({
    preview_virtual_readiness: { project: projectVirtualReadiness, state: PRODUCER_STATE.ACTIVE },
    preview_recipe_cost: { project: projectRecipeCost, state: PRODUCER_STATE.ACTIVE },
    build_recipe_bom_draft: { project: projectBomDraft, state: PRODUCER_STATE.ACTIVE },
    get_order_readiness_overview: { project: projectOrderReadinessOverview, state: PRODUCER_STATE.ACTIVE },
    check_order_readiness: {
        project: (item, index) => projectReadinessObject(item.result?.data?.readiness ?? item.result?.data, {
            capability: item.name, pointerPrefix: `/${item.name}/data`, index,
        }),
        state: PRODUCER_STATE.ACTIVE,
    },
    get_purchase_overview: { project: null, state: PRODUCER_STATE.ACTIVE },
});

/** 已知**没有**结构化关键状态契约的能力：显式记录，避免以后靠猜字段接入。 */
const PRODUCER_NOT_AVAILABLE_CAPABILITIES = Object.freeze([
    'preview_profitability', 'get_data_quality_summary', 'get_business_alerts',
]);

/**
 * SUPPORT 事实：本轮**正式金额事实**的展示值（来自 moneyFactProjection，同一权威）。
 * 它们不是「关键状态」，但仍然必须比中性明细优先——用于 presentation 的 DIRECT_SUPPORT 层。
 */
function projectMoneySupportFacts(toolResults) {
    const { projectMoneyFacts } = require('./moneyFactProjection.cjs');
    return projectMoneyFacts(toolResults, { includeQueries: true }).map(fact => criticalFact({
        identity: { state: fact.identityStrength === 'canonical' ? 'CANONICAL' : 'IDENTITY_INCOMPLETE', entityType: fact.entityType, entityId: fact.entityId ? String(fact.entityId).split(':').at(-1) : null, displayName: fact.objectLabel },
        capability: fact.capability,
        pointer: fact.factPath,
        predicate: `money.${fact.predicate}`,
        state: 'PRESENTED',
        severity: SEVERITY.SUPPORT,
        reasonCode: 'FORMAL_MONEY_FACT',
        displayToken: fact.displayValue,
        detail: fact.label,
    }));
}

function verifiedReceipt(item) {
    const result = item?.result;
    return Boolean(result && result.success !== false && result.executionEvidence?.verified === true);
}

/**
 * @returns {{ version:number, facts:Array, mustShowTokens:string[], supportTokens:string[],
 *             producers:Record<string,string>, notAvailable:string[] }}
 */
function projectCriticalFacts(toolResults = []) {
    const index = buildEntityBindingIndex(toolResults);
    const facts = [];
    const producers = {};
    for (const item of toolResults) {
        if (!verifiedReceipt(item)) continue;
        const producer = PRODUCERS[item.name];
        if (!producer) continue;
        if (item.name === 'get_purchase_overview') {
            const projected = projectPurchaseOverview(item, index);
            producers[item.name] = projected.state;
            facts.push(...projected.facts);
            continue;
        }
        producers[item.name] = producer.state;
        facts.push(...producer.project(item, index));
    }
    const supportFacts = projectMoneySupportFacts(toolResults);
    facts.push(...supportFacts);
    const mustShowTokens = [...new Set(facts.filter(fact => fact.mustShow && fact.displayToken).map(fact => fact.displayToken))];
    const supportTokens = [...new Set(supportFacts.map(fact => fact.displayToken).filter(Boolean))];
    return {
        version: CRITICAL_FACT_PROJECTION_VERSION,
        facts,
        rowTokens: [...new Set(facts.filter(fact => fact.mustShow && fact.displayToken && fact.displayScope === DISPLAY_SCOPE.ROW).map(fact => fact.displayToken))],
        subjectTokens: [...new Set(facts.filter(fact => fact.mustShow && fact.displayToken && fact.displayScope === DISPLAY_SCOPE.SUBJECT).map(fact => fact.displayToken))],
        mustShowTokens,
        supportTokens,
        producers,
        notAvailable: [...PRODUCER_NOT_AVAILABLE_CAPABILITIES],
    };
}

module.exports = {
    CRITICAL_FACT_PROJECTION_VERSION,
    PRODUCER_STATE,
    SEVERITY,
    DISPLAY_SCOPE,
    READINESS_CRITICAL_VERDICTS,
    PRODUCER_NOT_AVAILABLE_CAPABILITIES,
    projectCriticalFacts,
};
