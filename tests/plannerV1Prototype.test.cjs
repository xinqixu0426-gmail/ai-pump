'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { createPlannerCapabilityCatalogSnapshot } = require('../scripts/ai-experiments/planner-v1/capabilityCatalogSnapshot.cjs');
const { parsePlannerMemo } = require('../scripts/ai-experiments/planner-v1/plannerMemo.cjs');
const { messagesForPlanner } = require('../scripts/ai-experiments/planner-v1/plannerAgent.cjs');
const { runPlannerPipeline } = require('../scripts/ai-experiments/planner-v1/plannerPipeline.cjs');
const { evaluatePlannerCase } = require('../scripts/ai-experiments/planner-v1/plannerEvaluator.cjs');
const { BASE_CASES, NEGATIVE_CASES } = require('../scripts/ai-experiments/planner-v1/cases.cjs');

const root = path.resolve(__dirname, '..');
const catalog = createPlannerCapabilityCatalogSnapshot();
const templateCase = BASE_CASES.find(item => item.id === 'P-03');
const unresolvedCase = BASE_CASES.find(item => item.id === 'P-16');

function contextFor(testCase, overriddenCatalog = catalog) {
    return { rawOwnerInput: testCase.user, upstream: testCase.upstream, capabilityCatalog: overriddenCatalog };
}

test('Planner capability snapshot is derived from authoritative registry and exposes no writes', () => {
    assert.equal(catalog.registryPath, 'api/capabilities/registry.cjs');
    assert.equal(catalog.totalCapabilities, 147);
    assert.equal(catalog.plannerWriteCapabilitiesVisible, 0);
    assert.equal(catalog.visibleReadCapabilities, 5);
    assert.equal(catalog.visiblePreviewCapabilities, 1);
    assert.equal(catalog.hiddenWriteCapabilities, 101);
    assert.ok(catalog.visibleCapabilities.every(capability => ['READ', 'PREVIEW'].includes(capability.mode)));
});

test('Planner context contains frozen upstream contracts and no legacy intent/tool catalog', () => {
    const messages = messagesForPlanner({ ...contextFor(templateCase), businessMemo: templateCase.upstream.businessMemo, policyMemo: templateCase.upstream.policyMemo, groundingResult: templateCase.upstream.groundingResult, finalGroundedTargets: templateCase.upstream.finalGroundedTargets, groundingAmbiguity: templateCase.upstream.groundingAmbiguity });
    const prompt = messages[0].content;
    assert.match(prompt, /RAW_OWNER_INPUT/);
    assert.match(prompt, /BUSINESS_MEMO/);
    assert.match(prompt, /POLICY_MEMO/);
    assert.match(prompt, /FINAL_GROUNDED_TARGETS/);
    assert.match(prompt, /READ-ONLY CAPABILITY CATALOG/);
    assert.doesNotMatch(prompt, /Semantic Frame|Legacy Intent|internalApiClient|\/api\//i);
});

test('Parser keeps lightweight plan fields without converting them into execution', () => {
    const parsed = parsePlannerMemo([
        'PLAN_STATUS: READY',
        'OWNER_GOAL: 读取模板固定件',
        'GROUNDED_TARGET: 通用款模板',
        'REQUIRED_FACT: F1 | 当前固定件 | 通用款模板 | AUTHORITATIVE_BUSINESS_SOURCE | NONE',
        'STEP: P1 | READ | templates.detail | 通用款模板 | F1 | NONE',
        'COMPLETION: 得到固定件列表',
        'WRITE_REQUIRED: NO',
    ].join('\n'));
    assert.equal(parsed.status, 'READY');
    assert.equal(parsed.steps[0].capability, 'templates.detail');
    assert.equal(parsed.steps[0].mode, 'READ');
});

test('Planner evaluator rejects invented capabilities and any write-shaped step', () => {
    const output = { context: { ...contextFor(templateCase), finalGroundedTargets: templateCase.upstream.finalGroundedTargets }, plannerMemo: 'PLAN_STATUS: READY', plan: parsePlannerMemo([
        'PLAN_STATUS: READY', 'OWNER_GOAL: 通用款模板有哪些固定件', 'GROUNDED_TARGET: 通用款模板',
        'REQUIRED_FACT: F1 | 固定件 | 通用款模板 | AUTHORITATIVE_BUSINESS_SOURCE | NONE',
        'STEP: P1 | WRITE | invented.capability | 通用款模板 | F1 | NONE', 'COMPLETION: x', 'WRITE_REQUIRED: YES',
    ].join('\n')), execution: { toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0 } };
    const evaluation = evaluatePlannerCase(templateCase, output);
    assert.equal(evaluation.overall, 'FAIL');
    assert.ok(evaluation.failures.includes('STEP_MODE_INVALID'));
    assert.ok(evaluation.failures.includes('WRITE_STEP'));
    assert.ok(evaluation.failures.includes('PLANNER_INVENTED_CAPABILITY'));
});

test('Planner evaluator requires unresolved grounding to stop without steps', () => {
    const output = { context: { ...contextFor(unresolvedCase), finalGroundedTargets: [] }, plannerMemo: 'PLAN_STATUS: BLOCKED_GROUNDING', plan: parsePlannerMemo([
        'PLAN_STATUS: BLOCKED_GROUNDING', 'OWNER_GOAL: 这个多少钱', 'COMPLETION: waiting', 'WRITE_REQUIRED: NO',
    ].join('\n')), execution: { toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0 } };
    assert.equal(evaluatePlannerCase(unresolvedCase, output).overall, 'PASS');
});

test('Planner pipeline performs no tool, business API, database, or write execution', async () => {
    const output = await runPlannerPipeline(contextFor(templateCase), { runPlannerAgent: async () => [
        'PLAN_STATUS: READY', 'OWNER_GOAL: 通用款模板有哪些固定件', 'GROUNDED_TARGET: 通用款模板',
        'REQUIRED_FACT: F1 | 固定件 | 通用款模板 | AUTHORITATIVE_BUSINESS_SOURCE | NONE',
        'STEP: P1 | READ | templates.detail | 通用款模板 | F1 | NONE', 'COMPLETION: done', 'WRITE_REQUIRED: NO',
    ].join('\n') });
    assert.deepEqual(output.execution, { toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0 });
    assert.equal(output.modelCalls.intent, 0);
    assert.equal(output.modelCalls.utteranceExtractor, 0);
});

test('Planner prototype is isolated from production runtime and frozen upstream implementation writes', () => {
    const plannerDir = path.join(root, 'scripts/ai-experiments/planner-v1');
    for (const file of fs.readdirSync(plannerDir).filter(file => file.endsWith('.cjs'))) {
        const source = fs.readFileSync(path.join(plannerDir, file), 'utf8');
        assert.doesNotMatch(source, /require\([^)]*api\/services\/(?!aiProvider)/i);
        assert.doesNotMatch(source, /safeUpdate|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i);
    }
    const planner = fs.readFileSync(path.join(plannerDir, 'plannerPipeline.cjs'), 'utf8');
    assert.doesNotMatch(planner, /fetch\(|internalFetch|costEngine/i);
});

test('Negative missing-capability fixture has no template read capability', () => {
    const negative = NEGATIVE_CASES.find(item => item.id === 'N-01');
    const reduced = { ...catalog, visibleCapabilities: catalog.visibleCapabilities.filter(item => !negative.catalogOmit.includes(item.capabilityId)) };
    assert.equal(reduced.visibleCapabilities.some(item => item.capabilityId === 'templates.detail'), false);
});
