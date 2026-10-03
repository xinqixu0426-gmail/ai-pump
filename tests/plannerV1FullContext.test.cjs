'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildFrozenFixtureCatalog, buildPlannerCatalogSnapshot } = require('../scripts/ai-experiments/planner-v1/fullContextCatalog.cjs');
const { validatePlannerReference } = require('../scripts/ai-experiments/planner-v1/fullContextIdentityValidator.cjs');
const { messagesForFullContextPlanner } = require('../scripts/ai-experiments/planner-v1/fullContextPlannerAgent.cjs');
const { parseFullContextPlannerMemo, validateFullContextMemo } = require('../scripts/ai-experiments/planner-v1/fullContextPlannerMemo.cjs');
const { runFullContextPipeline } = require('../scripts/ai-experiments/planner-v1/fullContextPipeline.cjs');
const { createPlannerCapabilityCatalogSnapshot } = require('../scripts/ai-experiments/planner-v1/capabilityCatalogSnapshot.cjs');
const { buildPlannerAdmission } = require('../scripts/ai-experiments/planner-v1/plannerAdmissionGuard.cjs');

const catalog = buildFrozenFixtureCatalog(() => new Date('2026-10-03T00:00:00.000Z'));
const selected = (entityType, id, canonicalName) => ({ entityType, id, canonicalName });
function identity(query, refs, owner, result = 'VALUE') { return validatePlannerReference({ selectedReferences: refs, referenceQuery: query, requestedResult: result, rawOwnerInput: owner, catalog }); }

test('FC-01..05: only catalog-backed identities validate; ambiguous single selections are rejected', () => {
    assert.equal(identity('V750通用款', [selected('recipe', 11, 'V750-通用款')], 'V750通用款成本').status, 'VALID', 'FC-01');
    assert.equal(identity('V750通用款', [selected('recipe', 999, 'V999')], 'V750通用款成本').status, 'NOT_FOUND', 'FC-02');
    assert.equal(identity('V750通用款', [selected('recipe', 11, 'V750-豪贝款')], 'V750通用款成本').status, 'MISMATCH', 'FC-03');
    const ambiguous = identity('12-120', [selected('coil', 1, '12-120 普通小眼')], '12-120多少钱');
    assert.equal(ambiguous.status, 'AMBIGUOUS', 'FC-04');
    assert.ok(ambiguous.violations.includes('SILENT_AMBIGUITY_SELECTION'), 'FC-04');
    const pair = identity(null, [selected('recipe', 11, 'V750-通用款'), selected('recipe', 14, 'V110-通用款')], 'V750通用款和V110成本差多少', 'DELTA');
    assert.equal(pair.status, 'VALID', 'FC-05');
    assert.equal(pair.validatedReferences.length, 2, 'FC-05');
    assert.ok(identity(null, [selected('recipe', 14, 'V110-通用款')], '只问V750通用款').violations.includes('REFERENCE_NOT_IN_OWNER_WORDING'));
});

test('FC-06..09: prompt retains full Business, Policy, raw owner and catalog identity', async () => {
    const rawOwnerInput = 'V750通用款做不锈钢接轴成本差多少？';
    const businessMemo = '不锈钢接轴属于 Rotor process configuration；这是完整 Business Memo 的末句。';
    const policyMemo = '这是临时 Preview，不保存；这是完整 Policy Memo 的末句。';
    const prompt = messagesForFullContextPlanner({ rawOwnerInput, businessMemo, policyMemo, catalogSnapshot: catalog })[0].content;
    assert.ok(prompt.includes(businessMemo), 'FC-06');
    assert.ok(prompt.includes(policyMemo), 'FC-07');
    assert.ok(prompt.includes(rawOwnerInput), 'FC-08');
    assert.ok(prompt.includes('"id":11'), 'FC-09');
    const paths = [];
    const api = await buildPlannerCatalogSnapshot({ getJson: async path => { paths.push(path); return { success: true, data: path === '/api/recipes' ? [{ id: 11, name: 'V750-通用款', spec: 'V750' }] : path === '/api/coils' ? [{ id: 1, schemeName: '12-120 普通小眼', spec: '12', sheets: 120 }] : path === '/api/templates' ? [{ id: 21, shellModel: '通用款模板' }] : [{ id: 9, model: '轴承', category: '固定件' }] }; }, clock: () => new Date('2026-10-03T00:00:00.000Z') });
    assert.deepEqual(paths, ['/api/recipes', '/api/coils', '/api/templates', '/api/parts']);
    assert.equal(api.domains.coils.records[0].commonDesignation, '12-120');
    assert.equal(api.sourceMode, 'OFFICIAL_GET');
});

test('FC-10..11: write-only planning safely blocks without execution', async () => {
    const rawOwnerInput = '把V750通用款包装改成木箱并保存。';
    const plannerMemo = 'PLANNING_BRIEF: 只准备正式写入计划，不执行。\nREQUEST_MODE: WRITE\nREQUESTED_RESULT: NONE\nMETRIC: NONE\nREFERENCE_QUERY: V750通用款\nSELECTED_REFERENCE: recipe | 11 | V750-通用款\nRELATION_REQUEST: NONE\nSCENARIO_CHANGE: 包装改成木箱 | PACKAGING\nWRITE_REQUIRED: YES';
    const output = await runFullContextPipeline({ rawOwnerInput, businessMemo: '包装属于配置。', policyMemo: '明确保存属于受保护写入，而非临时试算。', catalogSnapshot: catalog, capabilityCatalog: createPlannerCapabilityCatalogSnapshot() }, { runPlannerAgent: async () => plannerMemo });
    assert.equal(output.memoValidation.validationStatus, 'VALID', 'FC-10');
    assert.equal(output.adapted.rawPlan.status, 'BLOCKED_POLICY', 'FC-11');
    assert.equal(output.adapted.rawPlan.steps.length, 0, 'FC-11');
    assert.equal(output.validation.validationStatus, 'VALID', 'FC-11');
    assert.deepEqual(output.execution, { toolExecutions: 0, businessApiWrites: 0, dbWrites: 0, writeExecutions: 0 }, 'FC-10');
    assert.equal(buildPlannerAdmission({ rawOwnerInput, upstream: { finalGroundedTargets: [{ status: 'EXACT' }], groundingResult: 'EXACT', policyMemo: '而非临时试算' } }).explicitNoSave, false);
    assert.equal(buildPlannerAdmission({ rawOwnerInput: '先算一下，不保存', upstream: { finalGroundedTargets: [{ status: 'EXACT' }], groundingResult: 'EXACT', policyMemo: '' } }).explicitNoSave, true);
});

test('invalid planner memo never executes a plan', () => {
    const memo = parseFullContextPlannerMemo('PLANNING_BRIEF: 解释成本。\nREQUEST_MODE: EXPLAIN\nREQUESTED_RESULT: NONE\nMETRIC: COST\nREFERENCE_QUERY: NONE\nSELECTED_REFERENCE: NONE\nRELATION_REQUEST: NONE\nSCENARIO_CHANGE: NONE\nWRITE_REQUIRED: NO');
    assert.ok(validateFullContextMemo(memo, '这个多少钱').violations.includes('EXPLAIN_COST_CONTRADICTION'));
});
