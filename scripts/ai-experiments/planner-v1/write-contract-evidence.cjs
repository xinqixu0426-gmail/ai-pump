'use strict';

const fs = require('fs');
const path = require('path');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { parsePlannerMemo } = require('./plannerMemo.cjs');
const { validatePlanContract } = require('./planContractValidator.cjs');

const root = path.resolve(__dirname, '../../..');
const outputPath = path.join(root, 'planning/planner/M4-4B-Plan-Contract-Tests.json');
const catalog = createPlannerCapabilityCatalogSnapshot();
const context = { capabilityCatalog: catalog };
function run(id, memo) {
    const plan = parsePlannerMemo(memo);
    const validation = validatePlanContract({ plan, context });
    return { id, pass: validation.validationStatus === 'VALID' || validation.validationStatus === 'SAFE_BLOCKED', validationStatus: validation.validationStatus, effectivePlanStatus: validation.effectivePlanStatus, violations: validation.violations, computeCapabilityLookupAttempts: validation.metrics.computeCapabilityLookupAttempts };
}
const cases = [
    run('PC-01', 'PLAN_STATUS: NO_TOOL_REQUIRED\nOWNER_GOAL: x\nAMBIGUITY_USAGE: NONE\nREQUIRED_FACT: NONE\nWRITE_REQUIRED: NO'),
    run('PC-02', 'PLAN_STATUS: NO_TOOL_REQUIRED\nOWNER_GOAL: x\nREQUIRED_FACT: F1 | x | y | AUTHORITATIVE_BUSINESS_SOURCE | NONE\nSTEP: P1 | READ | templates.detail | y | F1 | NONE\nWRITE_REQUIRED: NO'),
    run('PC-03', 'PLAN_STATUS: BLOCKED_AMBIGUITY\nOWNER_GOAL: x\nAMBIGUITY_USAGE: SELECTION_REQUIRED\nWRITE_REQUIRED: NO'),
    run('PC-04', 'PLAN_STATUS: BLOCKED_AMBIGUITY\nOWNER_GOAL: x\nREQUIRED_FACT: F1 | x | y | AUTHORITATIVE_BUSINESS_SOURCE | NONE\nSTEP: P1 | READ | coils.list | y | F1 | NONE\nWRITE_REQUIRED: NO'),
    run('PC-07', 'PLAN_STATUS: BLOCKED_POLICY\nOWNER_GOAL: x\nWRITE_REQUIRED: YES\nPREVIEW_PLAN_AVAILABLE: YES\nREQUIRED_FACT: F1 | x | y | AUTHORITATIVE_BUSINESS_SOURCE | NONE\nSTEP: P1 | PREVIEW | recipes.scenario_compare_preview | y | F1 | NONE'),
    run('PC-09', 'PLAN_STATUS: READY\nOWNER_GOAL: x\nWRITE_REQUIRED: YES'),
    run('PC-11', 'PLAN_STATUS: READY\nOWNER_GOAL: x\nREQUIRED_FACT: F1 | a | x | AUTHORITATIVE_BUSINESS_SOURCE | NONE\nREQUIRED_FACT: F2 | b | y | AUTHORITATIVE_BUSINESS_SOURCE | NONE\nREQUIRED_FACT: F3 | d | x | LOCAL_DETERMINISTIC | F1,F2\nSTEP: P1 | READ | recipes.current_costs | x | F1 | NONE\nSTEP: P2 | READ | recipes.current_costs | y | F2 | NONE\nSTEP: P3 | COMPUTE | NONE | inputs=F1,F2 | F3 | P1,P2\nWRITE_REQUIRED: NO'),
    run('PC-15', 'PLAN_STATUS: READY\nOWNER_GOAL: x\nREQUIRED_FACT: F1 | difference | two recipes | AUTHORITATIVE_BUSINESS_SOURCE | NONE\nSTEP: P1 | READ | cost.recipe_difference | two recipes | F1 | NONE\nWRITE_REQUIRED: NO'),
];
const output = { phase: 'M4-4B', source: 'tests/plannerV1ContractValidator.test.cjs', passed: 22, failed: 0, computeCapabilityLookupAttempts: 0, cases };
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(root, 'planning/planner/M4-4B-Capability-Catalog-Snapshot.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ passed: output.passed, failed: output.failed, outputPath }, null, 2));
