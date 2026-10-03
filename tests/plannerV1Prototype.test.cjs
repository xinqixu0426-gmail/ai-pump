'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { createPlannerCapabilityCatalogSnapshot } = require('../scripts/ai-experiments/planner-v1/capabilityCatalogSnapshot.cjs');
const { parseRequirementMemo } = require('../scripts/ai-experiments/planner-v1/requirementMemo.cjs');
const { messagesForRequirementPlanner } = require('../scripts/ai-experiments/planner-v1/requirementPlannerAgent.cjs');
const { runPlannerPipeline } = require('../scripts/ai-experiments/planner-v1/plannerPipeline.cjs');
const { BASE_CASES, NEGATIVE_CASES } = require('../scripts/ai-experiments/planner-v1/cases.cjs');

const root = path.resolve(__dirname, '..');
const catalog = createPlannerCapabilityCatalogSnapshot();
const templateCase = BASE_CASES.find(item => item.id === 'P-03');
function contextFor(testCase, overriddenCatalog = catalog) { return { rawOwnerInput: testCase.user, upstream: testCase.upstream, capabilityCatalog: overriddenCatalog }; }

test('Planner capability snapshot remains derived from the authoritative registry and exposes no writes', () => {
    assert.equal(catalog.registryPath, 'api/capabilities/registry.cjs');
    // Phase A3 adds six non-write formal read/preview registrations. The
    // planner-visible projection remains unchanged and still exposes no write.
    assert.equal(catalog.totalCapabilities, 153);
    assert.equal(catalog.plannerWriteCapabilitiesVisible, 0);
    assert.equal(catalog.visibleReadCapabilities, 5);
    assert.equal(catalog.visiblePreviewCapabilities, 1);
    assert.ok(catalog.visibleCapabilities.every(capability => ['READ', 'PREVIEW'].includes(capability.mode)));
});

test('Requirement Planner sees frozen upstream but never a capability catalog or implementation layer', () => {
    const prompt = messagesForRequirementPlanner({ ...contextFor(templateCase), businessMemo: templateCase.upstream.businessMemo, policyMemo: templateCase.upstream.policyMemo, groundingResult: templateCase.upstream.groundingResult, finalGroundedTargets: templateCase.upstream.finalGroundedTargets, groundingAmbiguity: templateCase.upstream.groundingAmbiguity, candidateSetComplete: 'NO' })[0].content;
    assert.match(prompt, /RAW_OWNER_INPUT/);
    assert.match(prompt, /BUSINESS_MEMO/);
    assert.match(prompt, /POLICY_MEMO/);
    assert.match(prompt, /FINAL_GROUNDED_TARGETS/);
    assert.doesNotMatch(prompt, /CAPABILITY CATALOG|templates\.detail|recipes\.current_costs|internalApiClient|\/api\//i);
});

test('Requirement Memo parser is lightweight and preserves owner-language scenario expressions', () => {
    const memo = parseRequirementMemo(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 预览变化', 'TARGET: V750通用款', 'GOAL_FACT: SCENARIO_COMPARISON', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 电缆5米 | CABLE', 'SCENARIO_OVERRIDE: 木箱 | PACKAGING', 'WRITE_REQUIRED: NO'].join('\n'));
    assert.equal(memo.status, 'READY');
    assert.deepEqual(memo.scenarioOverrides, [{ expression: '电缆5米', scenarioClass: 'CABLE' }, { expression: '木箱', scenarioClass: 'PACKAGING' }]);
});

test('Pipeline performs one Requirement model call and no compiler/tool/API/database/write calls', async () => {
    const output = await runPlannerPipeline(contextFor(templateCase), { runRequirementPlannerAgent: async () => ['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 读取模板固定件', 'TARGET: 通用款模板', 'GOAL_FACT: FORMAL_DETAIL', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'].join('\n') });
    assert.deepEqual(output.execution, { toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0 });
    assert.equal(output.modelCalls.requirementPlanner, 1);
    assert.equal(output.modelCalls.planCompiler, 0);
    assert.equal(output.rawPlan.steps[0].capability, 'templates.detail');
});

test('Planner prototype remains isolated from production runtime and frozen upstream writes', () => {
    const plannerDir = path.join(root, 'scripts/ai-experiments/planner-v1');
    for (const file of fs.readdirSync(plannerDir).filter(file => file.endsWith('.cjs'))) {
        const source = fs.readFileSync(path.join(plannerDir, file), 'utf8');
        assert.doesNotMatch(source, /require\([^)]*api\/services\/(?!aiProvider)/i);
        assert.doesNotMatch(source, /safeUpdate|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i);
    }
    assert.doesNotMatch(fs.readFileSync(path.join(plannerDir, 'planCompiler.cjs'), 'utf8'), /fetch\(|internalFetch|costEngine/i);
});

test('Negative missing-capability fixture has no template read capability', () => {
    const negative = NEGATIVE_CASES.find(item => item.id === 'N-01');
    const reduced = { ...catalog, visibleCapabilities: catalog.visibleCapabilities.filter(item => !negative.catalogOmit.includes(item.capabilityId)) };
    assert.equal(reduced.visibleCapabilities.some(item => item.capabilityId === 'templates.detail'), false);
});
