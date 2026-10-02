'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPlannerCapabilityCatalogSnapshot } = require('../scripts/ai-experiments/planner-v1/capabilityCatalogSnapshot.cjs');
const { parsePlannerMemo } = require('../scripts/ai-experiments/planner-v1/plannerMemo.cjs');
const { validatePlanContract } = require('../scripts/ai-experiments/planner-v1/planContractValidator.cjs');

const context = { capabilityCatalog: createPlannerCapabilityCatalogSnapshot() };
function validate(lines) { return validatePlanContract({ plan: parsePlannerMemo(lines.join('\n')), context }); }
function base(status = 'READY') { return [`PLAN_STATUS: ${status}`, 'OWNER_GOAL: x', 'AMBIGUITY_USAGE: NONE', 'WRITE_REQUIRED: NO']; }
function fact(id, source = 'AUTHORITATIVE_BUSINESS_SOURCE', dependencies = 'NONE') { return `REQUIRED_FACT: ${id} | ${id} | target | ${source} | ${dependencies}`; }
function step(id, mode, capability, target, produces, depends = 'NONE') { return `STEP: ${id} | ${mode} | ${capability} | ${target} | ${produces} | ${depends}`; }
function has(result, code) { return result.violations.some(item => item.code === code); }

test('PC-01 NO_TOOL_REQUIRED with no steps is valid', () => assert.equal(validate([...base('NO_TOOL_REQUIRED'), 'REQUIRED_FACT: NONE']).validationStatus, 'VALID'));
test('PC-02 NO_TOOL_REQUIRED with read is invalid', () => assert.ok(has(validate([...base('NO_TOOL_REQUIRED'), fact('F1'), step('P1', 'READ', 'templates.detail', 'x', 'F1')]), 'BLOCKED_PLAN_STEP_VIOLATION')));
test('PC-03 BLOCKED_AMBIGUITY with no steps is valid', () => assert.equal(validate([...base('BLOCKED_AMBIGUITY')]).validationStatus, 'VALID'));
test('PC-04 BLOCKED_AMBIGUITY with read is invalid', () => assert.ok(has(validate([...base('BLOCKED_AMBIGUITY'), fact('F1'), step('P1', 'READ', 'coils.list', 'x', 'F1')]), 'BLOCKED_PLAN_STEP_VIOLATION')));
test('PC-05 BLOCKED_GROUNDING with a step is invalid', () => assert.ok(has(validate([...base('BLOCKED_GROUNDING'), fact('F1'), step('P1', 'READ', 'coils.list', 'x', 'F1')]), 'BLOCKED_PLAN_STEP_VIOLATION')));
test('PC-06 BLOCKED_CAPABILITY with a step is invalid', () => assert.ok(has(validate([...base('BLOCKED_CAPABILITY'), 'MISSING_CAPABILITY: missing.read', fact('F1'), step('P1', 'READ', 'coils.list', 'x', 'F1')]), 'BLOCKED_PLAN_STEP_VIOLATION')));
test('PC-07 BLOCKED_POLICY permits safe preview subplan', () => assert.equal(validate([...base('BLOCKED_POLICY'), 'WRITE_REQUIRED: YES', 'PREVIEW_PLAN_AVAILABLE: YES', fact('F1'), step('P1', 'PREVIEW', 'recipes.scenario_compare_preview', 'x', 'F1')]).validationStatus, 'VALID'));
test('PC-08 BLOCKED_POLICY rejects write', () => assert.ok(has(validate([...base('BLOCKED_POLICY'), 'WRITE_REQUIRED: YES', 'PREVIEW_PLAN_AVAILABLE: YES', fact('F1'), step('P1', 'WRITE', 'none', 'x', 'F1')]), 'WRITE_STEP_FORBIDDEN')));
test('PC-09 READY write requirement is safely blocked', () => { const result = validate([...base(), 'WRITE_REQUIRED: YES']); assert.equal(result.validationStatus, 'SAFE_BLOCKED'); assert.equal(result.effectivePlanStatus, 'BLOCKED_POLICY'); });
test('PC-10 any write step is invalid', () => assert.ok(has(validate([...base(), fact('F1'), step('P1', 'WRITE', 'none', 'x', 'F1')]), 'WRITE_STEP_FORBIDDEN')));
test('PC-11 COMPUTE consumes valid prior facts', () => assert.equal(validate([...base(), fact('F1'), fact('F2'), fact('F3', 'LOCAL_DETERMINISTIC', 'F1,F2'), step('P1', 'READ', 'recipes.current_costs', 'x', 'F1'), step('P2', 'READ', 'recipes.current_costs', 'y', 'F2'), step('P3', 'COMPUTE', 'NONE', 'inputs=F1,F2', 'F3', 'P1,P2')]).validationStatus, 'VALID'));
test('PC-12 COMPUTE never looks up a registry capability', () => assert.equal(validate([...base(), fact('F1', 'LOCAL_DETERMINISTIC'), step('P1', 'COMPUTE', 'NONE', 'inputs=FROZEN', 'F1')]).metrics.computeCapabilityLookupAttempts, 0));
test('PC-13 COMPUTE missing input is invalid', () => assert.ok(has(validate([...base(), fact('F1', 'LOCAL_DETERMINISTIC'), step('P1', 'COMPUTE', 'NONE', 'inputs=F2', 'F1')]), 'COMPUTE_INPUT_MISSING')));
test('PC-14 COMPUTE circular dependency is invalid', () => assert.ok(has(validate([...base(), fact('F1', 'LOCAL_DETERMINISTIC'), fact('F2', 'LOCAL_DETERMINISTIC'), step('P1', 'COMPUTE', 'NONE', 'inputs=F2', 'F1', 'P2'), step('P2', 'COMPUTE', 'NONE', 'inputs=F1', 'F2', 'P1')]), 'STEP_DEPENDENCY_CYCLE')));
test('PC-15 direct recipe-difference capability is valid', () => assert.equal(validate([...base(), fact('F1'), step('P1', 'READ', 'cost.recipe_difference', 'two recipes', 'F1')]).validationStatus, 'VALID'));
test('PC-16 two current-cost reads plus compute is valid', () => assert.equal(validate([...base(), fact('F1'), fact('F2'), fact('F3', 'LOCAL_DETERMINISTIC', 'F1,F2'), step('P1', 'READ', 'recipes.current_costs', 'left', 'F1'), step('P2', 'READ', 'recipes.current_costs', 'right', 'F2'), step('P3', 'COMPUTE', 'NONE', 'inputs=F1,F2', 'F3', 'P1,P2')]).validationStatus, 'VALID'));
test('PC-17 selection-required ambiguity parses', () => assert.equal(parsePlannerMemo([...base('BLOCKED_AMBIGUITY'), 'AMBIGUITY_USAGE: SELECTION_REQUIRED'].join('\n')).ambiguityUsage, 'SELECTION_REQUIRED'));
test('PC-18 set-consumable ambiguity parses', () => assert.equal(parsePlannerMemo([...base('NO_TOOL_REQUIRED'), 'AMBIGUITY_USAGE: SET_CONSUMABLE'].join('\n')).ambiguityUsage, 'SET_CONSUMABLE'));
test('PC-19 qualified explicit targets need no ambiguity block', () => assert.equal(validate([...base(), 'GROUNDED_TARGET: V750通用款', 'GROUNDED_TARGET: V750豪贝款', fact('F1'), step('P1', 'READ', 'cost.recipe_difference', 'two recipes', 'F1')]).validationStatus, 'VALID'));
test('PC-20 REQUIRED_FACT NONE parses to empty', () => assert.equal(parsePlannerMemo([...base('NO_TOOL_REQUIRED'), 'REQUIRED_FACT: NONE'].join('\n')).requiredFacts.length, 0));
test('PC-21 MISSING_CAPABILITY NONE parses to empty', () => assert.equal(parsePlannerMemo([...base('BLOCKED_CAPABILITY'), 'MISSING_CAPABILITY: NONE'].join('\n')).missingCapabilities.length, 0));
test('PC-22 UPSTREAM_CONTRACT_GAP NONE parses to empty', () => assert.equal(parsePlannerMemo([...base(), 'UPSTREAM_CONTRACT_GAP: NONE'].join('\n')).upstreamContractGaps.length, 0));
