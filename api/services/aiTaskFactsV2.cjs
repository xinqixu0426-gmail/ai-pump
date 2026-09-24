'use strict';

// Server-owned fact construction.  Callers provide only a receipt that came
// from the V2 adapter's private trusted-receipt store; facts never infer trust
// from model output or a caller supplied receipt id.
const crypto = require('node:crypto');
const { readJsonPointer } = require('./aiTaskCapabilityAdapterV2.cjs');
const { stableHash } = require('./stableJson.cjs');

function nowIso(clock = Date) { return new clock().toISOString(); }

function makeFactKey({ entityType, entityId, predicate, temporalScope, scenarioKey = null, basis, unit = 'pump', currency = 'CNY', snapshotVersion = null, queryScopeHash = null }) {
    return { entityType, entityId, predicate, temporalScope, scenarioKey, qualifiers: { basis, unit, currency, snapshotVersion, queryScopeHash } };
}

function makeFactRecordV1({ receipt, pointer, key, evidenceState = 'VERIFIED_POSITIVE', complete = true, planRevision, clock = Date, supersedesFactId = null }) {
    if (!receipt || receipt.origin !== 'SERVER_EXECUTOR') throw new Error('TASK_V2_UNTRUSTED_RECEIPT');
    const value = readJsonPointer(receipt.result, pointer);
    return {
        version: 1,
        factId: crypto.randomUUID(),
        key,
        evidenceState,
        value,
        receiptId: receipt.receiptId,
        resultPointer: pointer,
        observedAt: nowIso(clock),
        sourceUpdatedAt: null,
        sourceHash: receipt.sourceHash,
        complete,
        supersedesFactId,
        planRevision,
        readSetId: receipt.readSetId || null,
    };
}

function recipeCurrentCostRequirement(subjectKey) {
    return { requirementKey: `current-cost:${subjectKey}`, predicate: 'recipe.current_cost', subjectKey, scenarioKey: null, temporalScope: 'CURRENT', basis: 'CURRENT_REBUILT', requireComplete: true, unit: 'pump', currency: 'CNY' };
}

function scenarioCompareRequirements(subjectKey, scenarioKey) {
    return [
        recipeCurrentCostRequirement(subjectKey),
        { requirementKey: `scenario-cost:${scenarioKey}`, predicate: 'scenario.cost', subjectKey, scenarioKey, temporalScope: 'SCENARIO', basis: 'CURRENT_REBUILT', requireComplete: true, unit: 'pump', currency: 'CNY' },
        { requirementKey: `scenario-override:${scenarioKey}`, predicate: 'scenario.override_application', subjectKey, scenarioKey, temporalScope: 'SCENARIO', basis: 'CURRENT_REBUILT', requireComplete: true, unit: 'pump', currency: 'CNY' },
        { requirementKey: `scenario-comparison:${scenarioKey}`, predicate: 'scenario.cost_comparison', subjectKey, scenarioKey, temporalScope: 'SCENARIO', basis: 'CURRENT_REBUILT', requireComplete: true, unit: 'pump', currency: 'CNY' },
        // S2-R3-P2：候选配置的**正式配置差异**（回执 `changes` 数组，已按 scenarioKey 归属）
        // 不是这里的需求项：需求未满足会让 goal 永远无法 VERIFIED，而 `changes` 只有在
        // 回执确实返回它时才存在。控制器在该事实可用时**额外**挂载
        // `scenario.configuration_changes`（见 aiTaskControllerV2 的场景比较分支），
        // 答案据此区分「配置没变（NO_OP）」与「配置变了」；判据是配置差异本身，
        // 不是成本差额是否为 0（不同配置可能碰巧同价）。
    ];
}

function profitabilityRequirement(subjectKey, scenarioKey = null) {
    return { requirementKey: `profitability:${subjectKey}:${scenarioKey || 'base'}`, predicate: 'profitability.preview', subjectKey, scenarioKey, temporalScope: scenarioKey === null ? 'CURRENT' : 'SCENARIO', basis: 'CURRENT_REBUILT', requireComplete: true, unit: 'pump', currency: 'CNY' };
}
function virtualReadinessRequirement(subjectKey, scenarioKey = null) {
    return {
        requirementKey: `virtual-readiness:${subjectKey}:${scenarioKey || 'base'}`,
        predicate: 'inventory.virtual_readiness', subjectKey, scenarioKey,
        temporalScope: scenarioKey === null ? 'CURRENT' : 'SCENARIO',
        basis: 'CURRENT_STOCK_AFTER_ACTIVE_ORDER_RESERVATIONS', requireComplete: true,
        unit: 'pump', currency: null,
    };
}
function recipeScopeHash(mention) { return stableHash({ catalogue: 'recipes', match: String(mention) }); }

module.exports = { makeFactKey, makeFactRecordV1, recipeCurrentCostRequirement, scenarioCompareRequirements, profitabilityRequirement, virtualReadinessRequirement, recipeScopeHash };
