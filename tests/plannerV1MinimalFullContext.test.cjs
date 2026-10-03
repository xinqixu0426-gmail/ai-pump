'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFrozenFixtureCatalog, buildPlannerCatalogSnapshot, snapshotFromRows } = require('../scripts/ai-experiments/planner-v1/fullContextCatalog.cjs');
const { resolveCatalogMentions } = require('../scripts/ai-experiments/planner-v1/catalogMentionResolver.cjs');
const { parseMinimalPlannerMemo, validateMinimalPlannerMemo } = require('../scripts/ai-experiments/planner-v1/minimalPlannerMemo.cjs');
const { normalizeRequestMode, semanticFact, compileMinimalPlanner } = require('../scripts/ai-experiments/planner-v1/minimalPlannerAdapter.cjs');
const { expectedResult } = require('../scripts/ai-experiments/planner-v1/minimalPlannerEvaluator.cjs');
const { createPlannerCapabilityCatalogSnapshot } = require('../scripts/ai-experiments/planner-v1/capabilityCatalogSnapshot.cjs');

const catalog = buildFrozenFixtureCatalog();
function memo(fields = {}) { return { requestedResult: 'VALUE', metric: 'COST', referenceMentions: [], relationRequest: null, scenarioChanges: [], writeRequired: 'NO', ...fields }; }
function resolve(...mentions) { return resolveCatalogMentions(mentions, catalog); }
function full(raw, overrides = []) { return parseMinimalPlannerMemo(`PLANNING_BRIEF: 简短业务摘要\nREQUESTED_RESULT: ${overrides.length ? 'DELTA' : 'VALUE'}\nMETRIC: COST\nREFERENCE_MENTION: V750通用款\nRELATION_REQUEST: NONE\n${overrides.length ? overrides.map(item => `SCENARIO_CHANGE: ${item}`).join('\n') : 'SCENARIO_CHANGE: NONE'}\nWRITE_REQUIRED: NO`); }

test('ML-01..06: catalog mentions resolve independently without model IDs or silent selection', () => {
    assert.equal(resolve('V750通用款')[0].status, 'EXACT', 'ML-01');
    assert.deepEqual(resolve('12-120-A', '12-130-A').map(item => item.status), ['EXACT', 'EXACT'], 'ML-02');
    assert.equal(resolve('12-120')[0].status, 'MULTIPLE', 'ML-03');
    assert.equal(resolve('不存在')[0].status, 'NOT_FOUND', 'ML-04');
    const cross = snapshotFromRows({ recipes: [{ id: 1, name: '同名' }], coils: [{ id: 2, schemeName: '同名' }], templates: [], parts: [] }, { sourceMode: 'OFFICIAL_GET' });
    assert.equal(resolveCatalogMentions(['同名'], cross)[0].status, 'MULTIPLE_TYPE', 'ML-05');
    const parsed = parseMinimalPlannerMemo('PLANNING_BRIEF: 测试\nREQUESTED_RESULT: VALUE\nMETRIC: COST\nSELECTED_REFERENCE: recipe | 11 | V750-通用款\nRELATION_REQUEST: NONE\nSCENARIO_CHANGE: NONE\nWRITE_REQUIRED: NO');
    assert.ok(validateMinimalPlannerMemo(parsed, 'V750通用款成本').violations.includes('UNEXPECTED_PLANNER_FIELD'), 'ML-06');
});
test('ML-07..14: deterministic mode and fact semantics', () => {
    assert.equal(normalizeRequestMode(memo({ writeRequired: 'YES' })), 'WRITE', 'ML-07');
    assert.equal(normalizeRequestMode(memo({ scenarioChanges: [{ expression: '做电泳', scenarioClass: 'SURFACE_TREATMENT' }] })), 'PREVIEW', 'ML-08');
    assert.equal(normalizeRequestMode(memo()), 'READ', 'ML-09');
    assert.equal(semanticFact(memo({ requestedResult: 'DELTA' }), []), 'COST_DIFFERENCE', 'ML-10');
    assert.equal(semanticFact(memo(), []), 'CURRENT_COST', 'ML-11');
    assert.equal(semanticFact(memo({ scenarioChanges: [{ expression: '加浮球', scenarioClass: 'FLOAT' }] }), []), 'SCENARIO_COST', 'ML-12');
    assert.equal(semanticFact(memo({ metric: 'NONE', relationRequest: '线圈' }), []), 'RELATION', 'ML-13');
    assert.equal(semanticFact(memo({ requestedResult: 'COUNT', metric: 'NONE' }), resolve('12-120')), 'CANDIDATE_SET', 'ML-14');
});
test('ML-15..18: two-target, relation equivalence and write-only safety', () => {
    assert.deepEqual(resolve('V750通用款', 'V110').map(item => item.status), ['EXACT', 'EXACT'], 'ML-15');
    assert.deepEqual(resolve('12-120-A', '12-130-A').map(item => item.matches[0].canonicalId), [1, 3], 'ML-16');
    const relationCase = { id: 'P-08', goalSpec: { relationRequest: '线圈', resultShape: 'VALUE' } };
    assert.equal(expectedResult(relationCase, memo({ requestedResult: 'DETAIL', metric: 'NONE', relationRequest: '哪个线圈' })), true, 'ML-17');
    const writeMemo = memo({ requestedResult: 'NONE', metric: 'NONE', writeRequired: 'YES', referenceMentions: ['V750通用款'], scenarioChanges: [{ expression: '木箱', scenarioClass: 'PACKAGING' }] });
    const result = compileMinimalPlanner({ memo: writeMemo, resolutions: resolve('V750通用款'), input: { rawOwnerInput: '把V750通用款包装改成木箱并保存。', businessMemo: '包装配置', policyMemo: '正式保存禁止执行' }, capabilityCatalog: createPlannerCapabilityCatalogSnapshot() });
    assert.equal(result.requestMode, 'WRITE', 'ML-18');
    assert.equal(result.requirement.goalFacts.length, 0, 'ML-18');
    assert.equal(result.rawPlan.status, 'BLOCKED_POLICY', 'ML-18');
    assert.equal(result.rawPlan.steps.length, 0, 'ML-18');
});
test('minimal memo enforces exact owner provenance for mentions, relations and scenario changes', () => {
    const parsed = full('V750通用款做电泳成本差多少', ['做电泳 | SURFACE_TREATMENT']);
    assert.equal(validateMinimalPlannerMemo(parsed, 'V750通用款做电泳成本差多少').status, 'VALID');
    assert.ok(validateMinimalPlannerMemo(parsed, 'V750通用款成本差多少').violations.includes('SCENARIO_CHANGE_NOT_IN_OWNER_WORDING'));
});
test('formal read builder uses four existing GET routes and accepts internal-client unwrapped arrays', async () => {
    const routes = [];
    const snapshot = await buildPlannerCatalogSnapshot({ getJson: async route => { routes.push(route); return route === '/api/recipes' ? [{ id: 1, name: '正式配方' }] : []; } });
    assert.deepEqual(routes, ['/api/recipes', '/api/coils', '/api/templates', '/api/parts']);
    assert.equal(snapshot.sourceMode, 'OFFICIAL_GET');
    assert.equal(snapshot.domains.recipes.records[0].name, '正式配方');
});
test('line protocol accepts mechanical full-width colon without changing field meaning', () => {
    const parsed = parseMinimalPlannerMemo('PLANNING_BRIEF：查询\nREQUESTED_RESULT：VALUE\nMETRIC：COST\nREFERENCE_MENTION：V750通用款\nRELATION_REQUEST：NONE\nSCENARIO_CHANGE：NONE\nWRITE_REQUIRED：NO');
    assert.equal(validateMinimalPlannerMemo(parsed, 'V750通用款成本').status, 'VALID');
});
