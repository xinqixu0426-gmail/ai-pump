'use strict';

const { performance } = require('node:perf_hooks');
const { createBusinessImpactProjection } = require('./projection.cjs');
const { deepFreeze } = require('./contract.cjs');

const recent = [];
async function observeBusinessImpactShadow(context = {}, dependencies = {}) {
    const started = performance.now();
    let record;
    try {
        const trigger = typeof dependencies.buildTrigger === 'function'
            ? await dependencies.buildTrigger(context)
            : context.impactTrigger || null;
        const result = trigger
            ? createBusinessImpactProjection({ db: dependencies.db || require('../db.cjs').db,
                readinessForOrder: dependencies.readinessForOrder }).project(trigger)
            : null;
        record = deepFreeze({ version: 1, requestId: context.requestId || null,
            eligible: Boolean(trigger), trigger: trigger || null, result,
            impactCount: result?.impacts?.length || 0,
            completeness: result?.completeness || null,
            payloadBytes: result ? Buffer.byteLength(JSON.stringify(result)) : 0,
            additionalProviderCalls: 0, businessWrites: 0,
            durationMs: Math.max(0, performance.now() - started), exception: null });
    } catch (error) {
        record = deepFreeze({ version: 1, requestId: context.requestId || null,
            eligible: false, trigger: null, result: null, impactCount: 0, completeness: null,
            payloadBytes: 0, additionalProviderCalls: 0, businessWrites: 0,
            durationMs: Math.max(0, performance.now() - started),
            exception: String(error?.code || 'IMPACT_SHADOW_FAILURE').slice(0, 120) });
    }
    recent.push(record); if (recent.length > 100) recent.shift();
    try { await dependencies.observe?.(record); } catch { /* fail open */ }
    try { dependencies.record?.(record); } catch { /* fail open */ }
    return record;
}

function clearRecentBusinessImpactRecords() { recent.length = 0; }
module.exports = { observeBusinessImpactShadow, clearRecentBusinessImpactRecords,
    recentBusinessImpactRecords: () => recent.slice() };
