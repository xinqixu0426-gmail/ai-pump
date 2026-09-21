'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBusinessImpactFixture } = require('./helpers/businessImpactFixture.cjs');
const { buildProjectionCases, trigger } = require('./helpers/businessImpactProjectionCases.cjs');
const { createBusinessImpactProjection } = require('../api/business-impact/projection.cjs');
const { validateImpactResult } = require('../api/business-impact/validator.cjs');
const C = require('../api/business-impact/contract.cjs');
const { observeBusinessImpactShadow } = require('../api/business-impact/shadowObserver.cjs');
const { buildImpactEvidenceBundle } = require('../api/business-impact/evidenceBundle.cjs');
const { MAX_IMPACT_EVIDENCE_BUNDLE_BYTES } = require('../api/business-impact/enforcementContract.cjs');

function setup(t) {
    const fixture = createBusinessImpactFixture(); t.after(() => fixture.close());
    const projection = createBusinessImpactProjection({ db: fixture.db,
        readinessForOrder: order => ({ orderId: order.id, verdict: 'shortage', authority: 'activeOrderReadiness' }) });
    return { fixture, projection, cases: buildProjectionCases(fixture.ids) };
}

test('BusinessImpactProjectionV1 对 12 个冻结案例给出确定性边界', t => {
    const { projection, cases } = setup(t);
    const results = Object.fromEntries(Object.entries(cases).map(([key, value]) => [key, projection.project(value)]));
    assert.equal(Object.keys(results).length, 12);
    assert.ok(results['IMP-01'].impacts.some(item => item.impactType === 'CURRENT_RECIPE_COST_RECALCULATION_REQUIRED'));
    assert.ok(results['IMP-01'].impacts.every(item => item.effect !== 'CHANGED'));
    assert.equal(results['IMP-02'].completeness, 'UNSUPPORTED');
    assert.ok(results['IMP-03'].impacts.some(item => item.target.entityType === 'order'
        && item.temporal === 'SAVED_SNAPSHOT' && item.effect !== 'CHANGED'));
    assert.ok(results['IMP-04'].impacts.every(item => item.effect === 'RECALCULATION_REQUIRED'));
    assert.equal(results['IMP-05'].completeness, 'UNSUPPORTED');
    assert.ok(results['IMP-06'].impacts.some(item => item.effect === 'READINESS_RECOMPUTE_REQUIRED'
        && item.verifiedReadiness?.authority === 'activeOrderReadiness'));
    assert.equal(results['IMP-07'].impacts.length, 0);
    assert.equal(results['IMP-07'].completeness, 'COMPLETE');
    assert.equal(results['IMP-08'].impacts.length, 2);
    assert.ok(results['IMP-08'].impacts.every(item => item.impactType === 'CURRENT_RECIPE_CONFIGURATION_AFFECTED'));
    assert.equal(results['IMP-09'].completeness, 'NEEDS_CANONICAL_IDENTITY');
    assert.equal(results['IMP-10'].completeness, 'UNSUPPORTED');
    assert.ok(results['IMP-11'].impacts.every(item => item.effect === 'DIFFERENCE_VERIFIED'));
    assert.ok(results['IMP-12'].impacts.every(item => item.target.entityType === 'recipe'));
    assert.ok(Object.values(results).every(item => item.bounds.readCalls <= C.MAX_IMPACT_READ_CALLS));
});

test('两次相同证据的 trigger、target、effect、authority、temporal 和 completeness 稳定', t => {
    const { projection, cases } = setup(t);
    for (const [key, input] of Object.entries(cases)) {
        const project = result => ({ trigger: result.trigger,
            impacts: result.impacts.map(({ impactType, target, effect, authority, temporal }) =>
                ({ impactType, target, effect, authority, temporal })), completeness: result.completeness });
        assert.deepEqual(project(projection.project(input)), project(projection.project(input)), key);
    }
});

test('Impact validator 拦截八类权威提升 mutation', () => {
    const baseTrigger = trigger('VERIFIED_FACT_CHANGE', 'part', 1, 'PART_PRICE_CHANGE', 5, 6);
    const base = { version: 1, trigger: baseTrigger, impacts: [], unresolved: [], completeness: 'COMPLETE',
        bounds: { readCalls: 0, truncated: false, maxTargets: C.MAX_IMPACT_TARGETS,
            maxReadCalls: C.MAX_IMPACT_READ_CALLS, maxResultBytes: C.MAX_IMPACT_RESULT_BYTES } };
    const item = extra => ({ impactType: 'CURRENT_RECIPE_COST_RECALCULATION_REQUIRED',
        target: { entityType: 'recipe', canonicalId: '2' }, effect: 'RECALCULATION_REQUIRED',
        authority: 'DETERMINISTIC_DERIVED_IMPACT', temporal: 'CURRENT', status: 'VERIFIED',
        evidence: ['formal'], ...extra });
    const mutations = [
        { ...base, impacts: [item({ target: { entityType: 'recipe', canonicalId: '999' } })], completeness: 'COMPLETE', bounds: { ...base.bounds, truncated: true } },
        { ...base, impacts: [item({ target: { entityType: 'order', canonicalId: '2' }, effect: 'CHANGED', temporal: 'SAVED_SNAPSHOT' })] },
        { ...base, impacts: [item({ effect: 'DIFFERENCE_VERIFIED', snapshotQuality: 'PARTIAL_LEGACY_SNAPSHOT' })] },
        { ...base, completeness: 'COMPLETE', bounds: { ...base.bounds, truncated: true } },
        { ...base, impacts: [item({ impactType: 'QUOTATION_STALE' })] },
        { ...base, impacts: [item({ impactType: 'TEST_REPORT_INVALID' })] },
        { ...base, impacts: [item({ target: { entityType: 'engineeringPrediction', canonicalId: null }, temperatureDelta: 8 })] },
        { ...base, trigger: { ...baseTrigger, mode: 'PROPOSED_CHANGE', persisted: true } },
    ];
    for (const mutation of mutations) assert.throws(() => validateImpactResult(mutation));
});

test('Impact scale sentinel caps target count and marks PARTIAL', t => {
    const { fixture, projection } = setup(t);
    const templateId = fixture.ids['template.v550'];
    const base = fixture.db.prepare('SELECT * FROM recipes WHERE id=?').get(fixture.ids['activeRecipe.v550']);
    const insert = fixture.db.prepare(`INSERT INTO recipes(name,spec,template_id,coil_id,coil_spec,coil_sheets,
        coil_material,coil_slot_type,parts_json,assembly_wage,packing_wage,surface_treatment_cost,
        management_fee,saved_total_cost,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (let index = 0; index < 60; index++) insert.run(`Scale-${index}`, 'S', templateId, base.coil_id,
        base.coil_spec, base.coil_sheets, base.coil_material, base.coil_slot_type, base.parts_json,
        0, 0, 0, 0, 0, base.created_at, base.updated_at);
    const result = projection.project(trigger('VERIFIED_RECORDED_CHANGE', 'template', templateId,
        'TEMPLATE_CHANGE', 'a', 'b'));
    assert.equal(result.impacts.length, C.MAX_IMPACT_TARGETS);
    assert.equal(result.completeness, 'PARTIAL');
    assert.equal(result.bounds.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= C.MAX_IMPACT_RESULT_BYTES);
    const bundle = buildImpactEvidenceBundle({ db: fixture.db, impactResult: result,
        impactEligibility: { slice: 'IP-04_TEMPLATE_RECIPES' } });
    assert.equal(bundle.completeness, 'PARTIAL');
    assert.ok(bundle.answerObligations.includes('DISCLOSE_INCOMPLETE_IMPACT_SCOPE'));
    assert.ok(Buffer.byteLength(JSON.stringify(bundle)) <= MAX_IMPACT_EVIDENCE_BUNDLE_BYTES);
});

test('Shadow observer 只记录投影且 provider/write 增量为零', async t => {
    const { fixture, cases } = setup(t); let observed;
    const answer = '权威回答保持不变';
    const record = await observeBusinessImpactShadow({ requestId: 'impact-shadow-test', answer }, {
        db: fixture.db, buildTrigger: () => cases['IMP-04'], record: value => { observed = value; },
    });
    assert.equal(record.result.completeness, 'COMPLETE');
    assert.equal(record.additionalProviderCalls, 0);
    assert.equal(record.businessWrites, 0);
    assert.equal(observed, record);
    assert.equal(answer, '权威回答保持不变');
});
