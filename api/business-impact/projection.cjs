'use strict';

const C = require('./contract.cjs');
const { validateImpactResult, validateTrigger } = require('./validator.cjs');
const { createRelationReadService } = require('../services/relationReadService.cjs');
const { createCanonicalRelationQueries } = require('../services/canonicalRelationQueries.cjs');

function parseArray(raw) { try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
function impact(impactType, entityType, canonicalId, effect, authority, temporal, evidence, extra = {}) {
    return { impactType, target: { entityType, canonicalId: canonicalId == null ? null : String(canonicalId) },
        effect, authority, temporal, status: 'VERIFIED', evidence, ...extra };
}
function unsupported(trigger, reason) {
    return C.deepFreeze(validateImpactResult({ version: 1, trigger, impacts: [], unresolved: [reason],
        completeness: 'UNSUPPORTED', bounds: { readCalls: 0, truncated: false,
            maxTargets: C.MAX_IMPACT_TARGETS, maxReadCalls: C.MAX_IMPACT_READ_CALLS,
            maxResultBytes: C.MAX_IMPACT_RESULT_BYTES } }));
}
function snapshotQuality(line) {
    const snapshot = line?.configurationSnapshot;
    if (!snapshot || typeof snapshot !== 'object') return 'NO_COMPARABLE_CONFIGURATION';
    if (Number.isSafeInteger(Number(snapshot.recipeId)) && Number.isSafeInteger(Number(snapshot.coilId))) {
        return 'COMPLETE_SAVED_CONFIGURATION';
    }
    return 'PARTIAL_LEGACY_SNAPSHOT';
}

function createBusinessImpactProjection({ db, readinessForOrder } = {}) {
    if (!db?.prepare) throw new Error('IMPACT_DB_REQUIRED');
    const relations = createRelationReadService({ db, canonicalOnly: true });
    const canonical = createCanonicalRelationQueries({ db });
    const project = input => db.transaction(() => {
        const trigger = validateTrigger(structuredClone(input));
        if (!trigger.canonicalId) return C.deepFreeze(validateImpactResult({ version: 1, trigger, impacts: [],
            unresolved: ['canonical identity required'], completeness: 'NEEDS_CANONICAL_IDENTITY',
            bounds: { readCalls: 0, truncated: false, maxTargets: C.MAX_IMPACT_TARGETS,
                maxReadCalls: C.MAX_IMPACT_READ_CALLS, maxResultBytes: C.MAX_IMPACT_RESULT_BYTES } }));
        let readCalls = 0; let truncated = false; let impacts = []; const unresolved = [];
        const id = Number(trigger.canonicalId);
        if (trigger.changeType === 'RECIPE_CONFIGURATION_CHANGE') {
            readCalls++;
            const recipe = db.prepare('SELECT id,name FROM recipes WHERE id=? AND deleted_at IS NULL').get(id);
            if (!recipe) return unsupported(trigger, 'canonical recipe unavailable');
            impacts.push(impact('CURRENT_RECIPE_CONFIGURATION_AFFECTED', 'recipe', id,
                trigger.mode === 'PROPOSED_CHANGE' ? 'AFFECTED' : 'CHANGED', 'CANONICAL_DIRECT_IMPACT',
                'CURRENT', ['recipes.id', ...trigger.source.evidence]));
            impacts.push(impact('CURRENT_RECIPE_COST_RECALCULATION_REQUIRED', 'recipeCost', id,
                'RECALCULATION_REQUIRED', 'DETERMINISTIC_DERIVED_IMPACT', 'CURRENT',
                ['canonical recipe configuration', 'costEngine authority'],
                trigger.verifiedCostEvidence ? { verifiedCostEvidence: trigger.verifiedCostEvidence } : {}));
            readCalls++;
            const orders = db.prepare(`SELECT id,items_json FROM orders WHERE deleted_at IS NULL
                AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(items_json) THEN items_json ELSE '[]' END)
                WHERE CAST(json_extract(value,'$.recipeId') AS INTEGER)=?) ORDER BY id DESC LIMIT ?`)
                .all(id, C.MAX_IMPACT_TARGETS + 1);
            truncated = orders.length > C.MAX_IMPACT_TARGETS;
            for (const order of orders.slice(0, C.MAX_IMPACT_TARGETS)) {
                const line = parseArray(order.items_json).find(item => Number(item.recipeId) === id);
                const quality = snapshotQuality(line);
                impacts.push(impact(quality === 'COMPLETE_SAVED_CONFIGURATION' ? 'SAVED_ORDER_DIFF_AVAILABLE' : 'SAVED_ORDER_CONFIGURATION_REVIEW_REQUIRED',
                    'order', order.id, quality === 'COMPLETE_SAVED_CONFIGURATION' ? 'DIFFERENCE_VERIFIED' : 'REVIEW_REQUIRED',
                    'DETERMINISTIC_DERIVED_IMPACT', 'SAVED_SNAPSHOT', ['orders.items_json.configurationSnapshot'],
                    { snapshotQuality: quality }));
            }
        } else if (trigger.changeType === 'ORDER_CONFIGURATION_COMPARE') {
            readCalls++;
            const order = db.prepare('SELECT id,items_json FROM orders WHERE id=? AND deleted_at IS NULL').get(id);
            if (!order) return unsupported(trigger, 'saved order unavailable');
            for (const line of parseArray(order.items_json).slice(0, C.MAX_IMPACT_TARGETS)) {
                const quality = snapshotQuality(line);
                if (quality === 'COMPLETE_SAVED_CONFIGURATION') impacts.push(impact('SAVED_ORDER_DIFF_AVAILABLE', 'recipe', line.recipeId,
                    'DIFFERENCE_VERIFIED', 'DETERMINISTIC_DERIVED_IMPACT', 'CURRENT_VS_SAVED',
                    ['orders.items_json.configurationSnapshot', 'recipes'], { snapshotQuality: quality }));
                else unresolved.push(`order line snapshot: ${quality}`);
            }
        } else if (trigger.changeType === 'PART_PRICE_CHANGE') {
            readCalls++;
            const page = relations.read({ version: 1, relation: 'part.recipes', rootId: id,
                pageSize: C.MAX_IMPACT_TARGETS });
            truncated = page.hasMore;
            impacts = page.items.map(item => impact('CURRENT_RECIPE_COST_RECALCULATION_REQUIRED', 'recipe', item.canonicalId,
                'RECALCULATION_REQUIRED', 'DETERMINISTIC_DERIVED_IMPACT', 'CURRENT',
                ['part.recipes canonical relation', 'costEngine authority']));
        } else if (trigger.changeType === 'PART_INVENTORY_CHANGE') {
            readCalls++;
            const rows = db.prepare(`SELECT id,items_json FROM orders WHERE deleted_at IS NULL
                AND status NOT IN ('已关闭','已取消') ORDER BY id DESC LIMIT ?`).all(C.MAX_IMPACT_TARGETS + 1);
            truncated = rows.length > C.MAX_IMPACT_TARGETS;
            for (const order of rows.slice(0, C.MAX_IMPACT_TARGETS)) {
                const contains = parseArray(order.items_json).some(line => parseArray(line.partsJson)
                    .some(part => Number(part.partId) === id));
                if (!contains) continue;
                let verifiedReadiness = null;
                if (typeof readinessForOrder === 'function' && readCalls < C.MAX_IMPACT_READ_CALLS) {
                    readCalls++; verifiedReadiness = readinessForOrder(order);
                } else if (typeof readinessForOrder === 'function') truncated = true;
                impacts.push(impact('ACTIVE_ORDER_READINESS_RECOMPUTE_REQUIRED', 'order', order.id,
                    'READINESS_RECOMPUTE_REQUIRED', 'DETERMINISTIC_DERIVED_IMPACT', 'CURRENT',
                    ['orders.items_json.partsJson', 'parts.stock', 'order readiness authority'],
                    verifiedReadiness ? { verifiedReadiness } : {}));
            }
        } else if (trigger.changeType === 'TEMPLATE_CHANGE') {
            readCalls++;
            const root = canonical.getEntity('template', id);
            if (!root) return unsupported(trigger, 'canonical template unavailable');
            const page = canonical.readSource({ sourceId: 'recipe_template', direction: 'INVERSE', toType: 'recipe' },
                root, { pageSize: C.MAX_IMPACT_TARGETS, afterId: undefined });
            truncated = page.rows.length > C.MAX_IMPACT_TARGETS || page.total > C.MAX_IMPACT_TARGETS;
            impacts = page.rows.slice(0, C.MAX_IMPACT_TARGETS).map(row => impact('CURRENT_RECIPE_CONFIGURATION_AFFECTED',
                'recipe', row.id, 'AFFECTED', 'CANONICAL_DIRECT_IMPACT', 'CURRENT', ['recipes.template_id']));
        } else if (trigger.changeType === 'QUOTATION_FRESHNESS') return unsupported(trigger, 'quotation freshness authority unavailable');
        else if (trigger.changeType === 'TEST_REPORT_VALIDITY') return unsupported(trigger, 'technical-file applicability not provable');
        else if (trigger.changeType === 'ENGINEERING_PREDICTION') return unsupported(trigger, 'factory-specific engineering evidence required');
        const completeness = truncated ? 'PARTIAL' : unresolved.length ? 'PARTIAL' : 'COMPLETE';
        return C.deepFreeze(validateImpactResult({ version: 1, trigger, impacts, unresolved, completeness,
            bounds: { readCalls, truncated, maxTargets: C.MAX_IMPACT_TARGETS,
                maxReadCalls: C.MAX_IMPACT_READ_CALLS, maxResultBytes: C.MAX_IMPACT_RESULT_BYTES } }));
    })();
    return { project };
}

module.exports = { createBusinessImpactProjection, snapshotQuality };
