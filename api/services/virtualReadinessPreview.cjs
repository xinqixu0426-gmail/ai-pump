'use strict';

// Read-only virtual demand projection.  This service deliberately delegates
// inventory identity, unit conversion and active-order allocation to
// orderPlanning; it never creates an order or mutates a reservation.
const crypto = require('node:crypto');
const { buildCurrentRecipeBomInput } = require('./currentRecipeCost.cjs');
const { normalizeScenarioCompareInput } = require('./recipeScenarioComparison.cjs');
const { buildBalancedOrderPlanningProjection, buildOrderPlan } = require('./orderPlanning.cjs');
const { hydrateCatalogRows } = require('./catalogLiveReferences.cjs');
const { ACTIVE_ORDERS_SQL } = require('./activeOrderReadiness.cjs');
const { isPackagingEstimatePart } = require('./packagingEstimate.cjs');
const { isRotorProcessPart } = require('./rotorShaftJoint.cjs');
const { stableHash } = require('./stableJson.cjs');

const VERSION = 1;
const MAX_QUANTITY = 100000;
const MAX_SOURCE_VERSIONS = 128;
const MAX_REQUIREMENTS = 200;
const REQUEST_KEYS = new Set(['version', 'basisRef', 'quantity']);
const BASIS_KEYS = new Set(['kind', 'recipeId', 'comparisonInput', 'scenarioKey']);

class VirtualReadinessPreviewError extends Error {
    constructor(code, message, statusCode = 400, details) {
        super(message || code);
        this.name = 'VirtualReadinessPreviewError';
        this.code = code;
        this.statusCode = statusCode;
        if (details !== undefined) this.details = details;
    }
}

function fail(code, message, statusCode = 400, details) {
    throw new VirtualReadinessPreviewError(code, message, statusCode, details);
}
function exact(value, keys, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, '请求必须是对象');
    const unknown = Object.keys(value).filter(key => !keys.has(key));
    if (unknown.length) fail(code, `请求含未知字段：${unknown.join('、')}`, 422);
}
function positiveInteger(value, field, max = Number.MAX_SAFE_INTEGER) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
        fail('VIRTUAL_READINESS_INVALID_INPUT', `${field} 必须是 1 到 ${max} 的整数`);
    }
    return value;
}
function sourceVersion(entityType, row) {
    return {
        entityType,
        entityId: String(row?.id ?? row?.key ?? ''),
        updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : (typeof row?.updatedAt === 'string' ? row.updatedAt : null),
        contentHash: stableHash(row),
    };
}
function inventoryUnit(row) {
    if (row.inventoryType === 'coil' || row.coilId != null) return 'set';
    if (Number(row.stockQtyPerUnit || 1) !== 1 || row.cableLength != null) return 'meter';
    return 'piece';
}
function canonicalRecipe(recipe, rawRecipe) {
    return {
        entityType: 'recipe', entityId: String(recipe.id), displayName: String(recipe.name || '').trim(),
        updatedAt: recipe.updatedAt || rawRecipe.updated_at || null, recordHash: stableHash(rawRecipe), schemeCode: null,
    };
}

function normalizeVirtualReadinessRequest(raw) {
    exact(raw, REQUEST_KEYS, 'VIRTUAL_READINESS_INVALID_INPUT');
    if (raw.version !== VERSION) fail('VIRTUAL_READINESS_VERSION_UNSUPPORTED', 'version 必须为 1');
    exact(raw.basisRef, BASIS_KEYS, 'VIRTUAL_READINESS_BASIS_INVALID');
    if (raw.basisRef.kind !== 'RECIPE_SCENARIO') fail('VIRTUAL_READINESS_BASIS_UNSUPPORTED', 'basisRef.kind 仅支持 RECIPE_SCENARIO');
    const recipeId = positiveInteger(raw.basisRef.recipeId, 'basisRef.recipeId');
    const comparisonInput = normalizeScenarioCompareInput(raw.basisRef.comparisonInput);
    const scenarioKey = typeof raw.basisRef.scenarioKey === 'string' ? raw.basisRef.scenarioKey : '';
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/u.test(scenarioKey)) fail('VIRTUAL_READINESS_SCENARIO_INVALID', 'scenarioKey 不合法');
    if (scenarioKey !== 'base' && !comparisonInput.scenarios.some(item => item.scenarioKey === scenarioKey)) {
        fail('VIRTUAL_READINESS_SCENARIO_NOT_FOUND', 'scenarioKey 不在本次正式情景基础中', 422);
    }
    return Object.freeze({
        version: VERSION,
        basisRef: Object.freeze({ kind: 'RECIPE_SCENARIO', recipeId, comparisonInput, scenarioKey }),
        quantity: positiveInteger(raw.quantity, 'quantity', MAX_QUANTITY),
    });
}

function incompleteResult({ recipe = null, scenarioKey, configurationHash = null, quantity, readSet = [], warnings = [], unresolvedRequirements = [] }) {
    const complete = false;
    const coverage = {
        requirementCount: 0, evaluatedCount: 0, shortageCount: 0,
        unresolvedCount: unresolvedRequirements.length, excludedCount: 0, complete,
    };
    return {
        version: VERSION, preview: true, readinessId: crypto.randomUUID(), recipe, scenarioKey,
        configurationHash, quantity, inventoryBasis: 'CURRENT_STOCK_AFTER_ACTIVE_ORDER_RESERVATIONS',
        status: 'INCOMPLETE', readSetId: crypto.randomUUID(), readSetHash: stableHash(readSet),
        sourceVersions: readSet.slice(0, MAX_SOURCE_VERSIONS), sourceVersionCount: readSet.length,
        sourceVersionsComplete: readSet.length <= MAX_SOURCE_VERSIONS, coverage,
        requirements: [], shortages: [], unresolvedRequirements, excludedRequirements: [],
        calculatedAt: new Date().toISOString(), warnings,
    };
}

function plannerRequirement(row, quantity, index) {
    const factor = Number(row.stockQtyPerUnit || 1);
    const required = Number(row.requiredStockQty);
    const available = Number(row.availableForPlanningQty);
    const shortage = Number(row.shortageStockQty);
    const onHand = Number(row.stockOnHandQty);
    const reserved = Number(row.reservedByActiveOrdersQty);
    if (![factor, required, available, shortage, onHand, reserved].every(Number.isFinite)) {
        fail('VIRTUAL_READINESS_PLANNER_INVALID', '正式订单规划器返回了非有限库存数量', 500);
    }
    return {
        requirementKey: String(row.identityKey || row.id || `requirement-${index + 1}`),
        resourceType: row.inventoryType === 'coil' || row.coilId != null ? 'COIL' : 'PART',
        partId: row.partId == null ? null : Number(row.partId),
        coilId: row.coilId == null ? null : Number(row.coilId),
        model: String(row.model || ''), supplier: String(row.supplier || ''), schemeCode: row.schemeCode || null,
        inventoryUnit: inventoryUnit(row), quantityPerPump: required / quantity,
        virtualRequiredQty: required, stockOnHandQty: onHand, reservedByActiveOrdersQty: reserved,
        availableForVirtualQty: available, shortageQty: shortage, complete: true,
        sourcePointers: [`/requirements/${index}`],
    };
}

function createVirtualReadinessPreview(dependencies = {}) {
    const { db, recipeRow, listCoils, listParts, getBomDraft, scenarioComparison } = dependencies;
    for (const [name, dependency] of Object.entries({ db, recipeRow, listCoils, listParts, getBomDraft, scenarioComparison })) {
        if (!dependency) throw new Error(`virtualReadinessPreview 缺少 ${name}`);
    }
    if (typeof scenarioComparison.compare !== 'function') throw new Error('virtualReadinessPreview 缺少 scenarioComparison.compare');

    function preview(raw) {
        const request = normalizeVirtualReadinessRequest(raw);
        return db.transaction(() => {
            const rawRecipe = db.prepare('SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL').get(request.basisRef.recipeId);
            if (!rawRecipe) fail('RECIPE_NOT_FOUND', `配方 #${request.basisRef.recipeId} 不存在`, 404);
            const recipe = recipeRow(rawRecipe);
            // The recipe carries the template binding, but its JSON alone does
            // not capture a changed template BOM.  Keep the actual template
            // row in the snapshot whenever it exists.
            const rawTemplate = rawRecipe.template_id
                ? db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(rawRecipe.template_id)
                : null;
            const baseVersions = [
                sourceVersion('recipe', rawRecipe),
                ...(rawTemplate ? [sourceVersion('template', rawTemplate)] : []),
            ];
            let comparison;
            try {
                comparison = scenarioComparison.compare(request.basisRef.recipeId, request.basisRef.comparisonInput);
            } catch (error) {
                // Scenario construction contains formal identity and policy
                // validation.  A failure is never permission to treat the
                // failed material as zero stock or absent: this read-only
                // inventory conclusion must remain incomplete.
                return incompleteResult({ recipe: canonicalRecipe(recipe, rawRecipe), scenarioKey: request.basisRef.scenarioKey,
                    quantity: request.quantity, readSet: baseVersions,
                    warnings: ['FORMAL_SCENARIO_PREVIEW_FAILED'], unresolvedRequirements: [{
                        code: error.code || 'FORMAL_SCENARIO_PREVIEW_FAILED',
                        message: error.message || '正式情景基础未能完整建立',
                    }], });
            }
            const scenario = comparison.scenarios.find(item => item.scenarioKey === request.basisRef.scenarioKey);
            if (!scenario) fail('VIRTUAL_READINESS_SCENARIO_NOT_FOUND', '正式情景未返回', 422);
            if (scenario.notApplied?.length) {
                return incompleteResult({ recipe: canonicalRecipe(recipe, rawRecipe), scenarioKey: scenario.scenarioKey,
                    configurationHash: scenario.configurationHash, quantity: request.quantity, readSet: baseVersions,
                    warnings: ['OVERRIDE_NOT_APPLIED'], unresolvedRequirements: scenario.notApplied.map(item => ({
                        code: item.reasonCode || 'OVERRIDE_NOT_APPLIED', message: item.message || '请求配置未被正式应用',
                    })), });
            }
            const coils = listCoils();
            // The current order planner consumes formal inventory rows.  The
            // cost cache intentionally omits stock, so it cannot be used here.
            const parts = listParts();
            let bom;
            try {
                const scenarioRecipe = { ...recipe, ...scenario.configuration };
                bom = getBomDraft({ ...buildCurrentRecipeBomInput(scenarioRecipe, parts), requireStablePartIdentity: true });
            } catch (error) {
                return incompleteResult({ recipe: canonicalRecipe(recipe, rawRecipe), scenarioKey: scenario.scenarioKey,
                    configurationHash: scenario.configurationHash, quantity: request.quantity, readSet: baseVersions,
                    warnings: ['INVENTORY_IDENTITY_UNRESOLVED'], unresolvedRequirements: [{
                        code: error.code || 'INVENTORY_IDENTITY_UNRESOLVED', message: error.message || '库存物料身份未能完整绑定',
                    }], });
            }
            const records = db.prepare(ACTIVE_ORDERS_SQL).all();
            let virtualPlan;
            try {
                const active = buildBalancedOrderPlanningProjection(
                    hydrateCatalogRows(db, 'order', records), parts, { coilsCatalog: coils }
                );
                virtualPlan = buildOrderPlan([{
                    recipeId: request.basisRef.recipeId, recipeName: recipe.name,
                    qty: request.quantity, partsJson: JSON.stringify(bom.parts),
                }], parts, { coilsCatalog: coils, reservedDemand: active.reservedDemand });
            } catch (error) {
                return incompleteResult({ recipe: canonicalRecipe(recipe, rawRecipe), scenarioKey: scenario.scenarioKey,
                    configurationHash: scenario.configurationHash, quantity: request.quantity, readSet: baseVersions,
                    warnings: ['INVENTORY_IDENTITY_UNRESOLVED'], unresolvedRequirements: [{
                        code: error.code || 'INVENTORY_IDENTITY_UNRESOLVED', message: error.message || '库存物料身份未能完整绑定',
                    }], });
            }
            // The persisted-order planner retains model-keyed legacy rows for
            // continuity.  A virtual readiness conclusion cannot use that
            // compatibility fallback: it must know the exact part or coil
            // whose stock is being inspected.  Otherwise a zero-stock
            // fallback would be falsely reported as a definite shortage.
            const unresolvedRows = virtualPlan.purchaseList.filter(row => {
                if (row.inventoryType === 'coil') return !Number.isSafeInteger(Number(row.coilId)) || Number(row.coilId) < 1;
                if (row.inventoryType === 'part') return !Number.isSafeInteger(Number(row.partId)) || Number(row.partId) < 1;
                return true;
            });
            if (unresolvedRows.length) {
                return incompleteResult({ recipe: canonicalRecipe(recipe, rawRecipe), scenarioKey: scenario.scenarioKey,
                    configurationHash: scenario.configurationHash, quantity: request.quantity,
                    readSet: [...baseVersions, ...records.map(item => sourceVersion('active_order_reservation', item))],
                    warnings: ['INVENTORY_IDENTITY_UNRESOLVED'], unresolvedRequirements: unresolvedRows.map(row => ({
                        code: row.inventoryType === 'coil' ? 'COIL_IDENTITY_UNRESOLVED' : 'PART_IDENTITY_UNRESOLVED',
                        message: `库存物料「${String(row.model || '')}」没有可核验的正式库存身份`,
                    })), });
            }
            if (virtualPlan.purchaseList.length > MAX_REQUIREMENTS) {
                return incompleteResult({ recipe: canonicalRecipe(recipe, rawRecipe), scenarioKey: scenario.scenarioKey,
                    configurationHash: scenario.configurationHash, quantity: request.quantity, readSet: baseVersions,
                    warnings: ['REQUIREMENT_LIMIT'], unresolvedRequirements: [{ code: 'REQUIREMENT_LIMIT', message: `正式需求项超过 ${MAX_REQUIREMENTS} 项安全上限` }], });
            }
            const requirements = virtualPlan.purchaseList.map((row, index) => plannerRequirement(row, request.quantity, index));
            const excludedRequirements = (bom.parts || []).filter(part => isPackagingEstimatePart(part) || isRotorProcessPart(part)).map(part => ({
                model: String(part.model || part.name || ''), reasonCode: isPackagingEstimatePart(part) ? 'NON_STOCK_PACKAGING_ESTIMATE' : 'NON_STOCK_PROCESS_ITEM',
            }));
            const shortages = requirements.filter(item => item.shortageQty > 0).map(item => ({
                requirementKey: item.requirementKey, resourceType: item.resourceType, partId: item.partId, coilId: item.coilId,
                model: item.model, supplier: item.supplier, inventoryUnit: item.inventoryUnit,
                virtualRequiredQty: item.virtualRequiredQty, availableForVirtualQty: item.availableForVirtualQty, shortageQty: item.shortageQty,
            }));
            const partIds = new Set(requirements.map(item => item.partId).filter(Number.isSafeInteger));
            const coilIds = new Set(requirements.map(item => item.coilId).filter(Number.isSafeInteger));
            const sourceVersions = [
                ...baseVersions,
                ...parts.filter(item => partIds.has(Number(item.id))).map(item => sourceVersion('part', item)),
                ...coils.filter(item => coilIds.has(Number(item.id))).map(item => sourceVersion('coil', item)),
                ...records.map(item => sourceVersion('active_order_reservation', item)),
            ].sort((left, right) => `${left.entityType}:${left.entityId}`.localeCompare(`${right.entityType}:${right.entityId}`));
            const coverage = {
                requirementCount: requirements.length, evaluatedCount: requirements.length, shortageCount: shortages.length,
                unresolvedCount: 0, excludedCount: excludedRequirements.length, complete: true,
            };
            const result = {
                version: VERSION, preview: true, readinessId: crypto.randomUUID(), recipe: canonicalRecipe(recipe, rawRecipe),
                scenarioKey: scenario.scenarioKey, configurationHash: scenario.configurationHash, quantity: request.quantity,
                inventoryBasis: 'CURRENT_STOCK_AFTER_ACTIVE_ORDER_RESERVATIONS',
                status: shortages.length ? 'SHORTAGE' : 'READY', readSetId: crypto.randomUUID(), readSetHash: stableHash(sourceVersions),
                sourceVersions: sourceVersions.slice(0, MAX_SOURCE_VERSIONS), sourceVersionCount: sourceVersions.length,
                sourceVersionsComplete: sourceVersions.length <= MAX_SOURCE_VERSIONS, coverage, requirements, shortages,
                unresolvedRequirements: [], excludedRequirements, calculatedAt: new Date().toISOString(),
                warnings: excludedRequirements.length ? ['EXCLUDED_NON_STOCK_REQUIREMENTS'] : [],
            };
            return result;
        })();
    }
    return Object.freeze({ preview });
}

module.exports = {
    MAX_QUANTITY, MAX_REQUIREMENTS, MAX_SOURCE_VERSIONS, VirtualReadinessPreviewError,
    createVirtualReadinessPreview, normalizeVirtualReadinessRequest,
};
