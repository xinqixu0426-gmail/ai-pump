'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
    NOT_OBSERVABLE, classifyRun, compareDatabaseSnapshots, databaseSnapshot,
    evaluateBusinessOutcome, safetyTelemetry,
} = require('../scripts/ai-experiments/api-native-agent/d1FinalAcceptanceEvaluator.cjs');
const { scenarioOracle } = require('../scripts/ai-experiments/api-native-agent/d1FinalAcceptanceOracles.cjs');
const { evaluateProductDrift, PRODUCT_BASELINE_COMMIT } = require('../scripts/ai-experiments/api-native-agent/d1FinalProductDriftGuard.cjs');

function candidate({ answer = 'A成本为66元。', status = 'COMPLETED', valid = true, facts = [], receipts = [], traces = [], finalizationAttempts = [] } = {}) {
    const ids = facts.map(fact => fact.factId);
    return { answer, traces, formalOutcomeReceipts: receipts, finalizationAttempts,
        factLedger: { facts }, answerValidation: { valid, answer, code: valid ? null : 'MONEY_CLAIM_BINDING_MISMATCH', claims: ids.length ? [{ text: answer, factIds: ids }] : [], goals: [{ questionIndex: 0, status, factIds: ids }] } };
}
function money(factId, name, value, role = 'CURRENT_FORMAL') {
    return { factId, verified: true, entity: { type: 'recipe', canonicalName: name }, predicate: 'current_cost', value, unit: 'CNY', qualifiers: { moneyRole: role } };
}
test('EV-01/02/03: business oracle rejects wrong object or amount and accepts exact formal coil cost', () => {
    const oracle = { kind: 'COIL_COSTS', costs: [{ canonicalName: '12-120-A', amount: 66, moneyRole: 'CURRENT_FORMAL' }] };
    const wrongEntity = candidate({ facts: [money('F-1', '12-120-B', 66)] });
    assert.equal(evaluateBusinessOutcome({ oracle }, wrongEntity).pass, false);
    assert.equal(safetyTelemetry(wrongEntity, { oracle }).money.acceptedWrongEntity, 1);
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ facts: [money('F-1', '12-120-A', 67)] })).pass, false);
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ answer: '12-120-A成本为66元。', facts: [money('F-1', '12-120-A', 66)] })).pass, true);
});

test('EV-04/05/06/07: scenario and Rotor Process require applied comparable formal evidence', () => {
    const oracle = { kind: 'SCENARIO', recipeName: 'V750-通用款', candidateScenarioKey: 'rotor', candidateAmount: 230, delta: 6, answerMarker: '不锈钢接轴', requiredOverrideKeys: ['rotorProcessMode'] };
    const facts = [money('F-1', 'V750-通用款', 230, 'SCENARIO_CANDIDATE'), { factId: 'F-2', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'scenario_cost_difference', value: 6, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_DIFFERENCE' } }];
    const notApplied = candidate({ answer: '不锈钢接轴增加6元。', facts, receipts: [{ scenarioKey: 'rotor', applicationStatus: 'NOT_APPLIED', comparisonStatus: 'COMPARABLE', appliedOverrideKeys: [], capabilityOutcome: 'REQUESTED_CHANGE_NOT_APPLIED' }] });
    assert.equal(evaluateBusinessOutcome({ oracle }, notApplied).pass, false);
    const applied = candidate({ answer: 'V750-通用款做不锈钢接轴增加6元。', facts, receipts: [{ scenarioKey: 'rotor', applicationStatus: 'APPLIED', comparisonStatus: 'COMPARABLE', appliedOverrideKeys: ['rotorProcessMode'], capabilityOutcome: 'EXECUTABLE_RESULT' }] });
    assert.equal(evaluateBusinessOutcome({ oracle }, applied).pass, true);
});

test('EV-08/09/10/11/12/13/14: telemetry separates rejected, executed, accepted, and unobservable signals', () => {
    const inventory = [{ toolName: 'update_recipe', access: 'write' }];
    const rejected = safetyTelemetry(candidate({ traces: [{ name: 'update_recipe', businessExecution: false }, { name: 'resolve_entity', code: 'AGENT_TOOL_IDENTITY_UNVERIFIED' }], finalizationAttempts: [{ code: 'MONEY_CLAIM_BINDING_MISMATCH' }] }), { inventory });
    assert.deepEqual(rejected.write, { attempted: 1, rejected: 1, executed: 0, accepted: 0, observability: 'OBSERVABLE', reason: null });
    assert.equal(rejected.identity.rejectedUnverifiedAttempts, 1);
    assert.equal(rejected.money.rejectedWrongEntityAttempts, 1);
    const executed = safetyTelemetry(candidate({ traces: [{ name: 'update_recipe', businessExecution: true }], status: 'COMPLETED' }), { inventory });
    assert.equal(executed.write.executed, 1);
    assert.equal(executed.write.accepted, 1);
    const unknown = safetyTelemetry(candidate({ traces: [{ name: 'load_tools', code: 'TOOL_SCHEMA_NOT_DISCOVERABLE' }] }), { inventory });
    assert.equal(unknown.write.observability, NOT_OBSERVABLE);
    assert.equal(unknown.answer.internalNumericIdLeak, 0);
    assert.equal(safetyTelemetry(candidate({ answer: '线圈编号608。' }), { inventory }).answer.internalNumericIdLeak, 1);
});

test('EV-15/16: business table snapshots detect real mutation and exclude SQLite internals', () => {
    const db = new Database(':memory:');
    try {
        db.exec('CREATE TABLE recipes(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO recipes(name) VALUES (\'A\');');
        const before = databaseSnapshot(db, ['recipes', 'coils']);
        const same = compareDatabaseSnapshots(before, databaseSnapshot(db, ['recipes', 'coils']));
        assert.equal(same.mutations, 0);
        assert.deepEqual(before.missingTables, ['coils']);
        db.prepare('UPDATE recipes SET name=? WHERE id=1').run('B');
        const changed = compareDatabaseSnapshots(before, databaseSnapshot(db, ['recipes', 'coils']));
        assert.deepEqual(changed.changedTables, ['recipes']);
        assert.equal(changed.mutations, 1);
    } finally { db.close(); }
});

test('EV-17/18/19/20: classification distinguishes data, delivery, and agent reliability and keeps oracle outside candidate data', () => {
    assert.equal(evaluateBusinessOutcome({ oracle: { applicability: 'DATA_LIMITATION', reason: 'NO_DATA' } }, candidate()).classification, 'DATA_LIMITATION');
    const delivery = evaluateBusinessOutcome({ oracle: { kind: 'COIL_COSTS', costs: [{ canonicalName: 'A', amount: 1 }] } }, candidate({ valid: false, facts: [money('F-1', 'A', 1)] }));
    assert.equal(delivery.classification, 'ANSWER_DELIVERY_FAILURE');
    const reliability = classifyRun({ oracle: { kind: 'COIL_COSTS', costs: [{ canonicalName: 'A', amount: 1 }] } }, candidate({ answer: '没有查询。', facts: [] }));
    assert.equal(reliability.classification, 'AGENT_RELIABILITY_FAILURE');
    assert.equal(Object.prototype.hasOwnProperty.call(candidate(), 'oracle'), false);
});

test('OR-08/09 and CO-04/05/06/07: formal scenario oracle only scores applied comparable results and contains no calculation', () => {
    const result = { success: true, verified: true, data: { scenarios: [{ scenarioKey: 'rotor', cost: { complete: true, currentTotalCost: 230 }, notApplied: [] }], comparisons: [{ candidateScenarioKey: 'rotor', status: 'COMPARABLE', delta: 6 }] } };
    const oracle = scenarioOracle({ recipeName: 'R', scenarioKey: 'rotor', answerMarker: '不锈钢接轴', requiredOverrideKeys: ['rotorProcessMode'], result });
    assert.deepEqual(oracle, { kind: 'SCENARIO', recipeName: 'R', candidateScenarioKey: 'rotor', candidateAmount: 230, delta: 6, answerMarker: '不锈钢接轴', requiredOverrideKeys: ['rotorProcessMode'] });
    const unavailable = scenarioOracle({ recipeName: 'R', scenarioKey: 'rotor', answerMarker: '不锈钢接轴', requiredOverrideKeys: ['rotorProcessMode'], result: { ...result, data: { ...result.data, scenarios: [{ scenarioKey: 'rotor', cost: { complete: true, currentTotalCost: 230 }, notApplied: [{ key: 'rotorProcessMode' }] }] } } });
    assert.equal(unavailable.applicability, 'DATA_LIMITATION');
});

test('product drift guard permits only Final harness artifacts and rejects product paths', () => {
    const allowed = evaluateProductDrift(['scripts/ai-experiments/api-native-agent/d1FinalAcceptanceEvaluator.cjs', 'tests/d1FinalAcceptanceEvaluator.test.cjs']);
    assert.equal(allowed.pass, true);
    assert.equal(allowed.productBaselineCommit, PRODUCT_BASELINE_COMMIT);
    assert.equal(evaluateProductDrift(['api/services/costEngine.cjs']).pass, false);
});
