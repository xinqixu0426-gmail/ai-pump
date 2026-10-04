'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
    NOT_OBSERVABLE, classifyRun, compareDatabaseSnapshots, databaseSnapshot,
    evaluateBusinessOutcome, safetyTelemetry,
} = require('../scripts/ai-experiments/api-native-agent/d1FinalAcceptanceEvaluator.cjs');
const { scenarioOracle } = require('../scripts/ai-experiments/api-native-agent/d1FinalAcceptanceOracles.cjs');
const { evaluateProductDrift, PRODUCT_BASELINE_COMMIT } = require('../scripts/ai-experiments/api-native-agent/d1FinalProductDriftGuard.cjs');
const { buildRepetitionPlan, REPETITION_CASE_IDS, RUNS_PER_CASE } = require('../scripts/ai-experiments/api-native-agent/run-d1-final-controlled-repetition.cjs');
const { finalAcceptanceEnvironment, main: controlledMain } = require('../scripts/ai-experiments/api-native-agent/run-d1-final-controlled.cjs');
const { main: repetitionMain } = require('../scripts/ai-experiments/api-native-agent/run-d1-final-controlled-repetition.cjs');
const { assertRealDatabaseSource, initializeRealHarness, main: realMain } = require('../scripts/ai-experiments/api-native-agent/run-d1-final-real-catalog.cjs');
const { FINAL_V2_ARTIFACTS, deriveFinalizationStats, derivePerformance, scanForSecrets, serializeRun, writeFinalV2Artifacts } = require('../scripts/ai-experiments/api-native-agent/d1FinalAcceptanceEvidence.cjs');
const { buildFinalAcceptanceManifest } = require('../scripts/ai-experiments/api-native-agent/d1FinalAcceptanceManifest.cjs');
const { createFactLedger } = require('../api/services/ai-assistant/factLedger.cjs');
const { validateAiToolArgs } = require('../api/services/aiToolInputValidator.cjs');
const { formalToolFailure } = require('../api/services/aiFormalToolError.cjs');

function candidate({ answer = 'A成本为66元。', status = 'COMPLETED', valid = true, facts = [], receipts = [], traces = [], finalizationAttempts = [], claims, metrics, context, durationMs } = {}) {
    const ids = facts.map(fact => fact.factId);
    return { answer, traces, formalOutcomeReceipts: receipts, finalizationAttempts, metrics, context, durationMs,
        factLedger: { facts }, answerValidation: { valid, answer, code: valid ? null : 'MONEY_CLAIM_BINDING_MISMATCH', claims: claims || (ids.length ? [{ text: answer, factIds: ids }] : []), goals: [{ questionIndex: 0, status, factIds: ids }] } };
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

test('V3 product drift guard is pinned to the R6 product baseline and rejects product paths', () => {
    assert.equal(PRODUCT_BASELINE_COMMIT, 'f68dbaf024f3f424d7052da88d0009f6b7dd8043');
    const allowed = evaluateProductDrift(['scripts/ai-experiments/api-native-agent/d1FinalAcceptanceEvaluator.cjs', 'tests/d1FinalAcceptanceEvaluator.test.cjs']);
    assert.equal(allowed.pass, true);
    assert.equal(allowed.productBaselineCommit, PRODUCT_BASELINE_COMMIT);
    assert.equal(evaluateProductDrift(['api/services/costEngine.cjs']).pass, false);
});

function differenceFact(left = 'A', right = 'B', direction = 'RIGHT_MINUS_LEFT', value = 10) {
    return { factId: 'F-D', verified: true, entity: { type: 'recipe', canonicalName: left }, predicate: 'recipe_cost_difference', value, unit: 'CNY', qualifiers: { moneyRole: 'RECIPE_DIFFERENCE', participants: { left: { canonicalName: left }, right: { canonicalName: right } }, direction } };
}
test('FH1R1-01/02/03/04/05: recipe difference uses real nested participants and direction', () => {
    const oracle = { kind: 'RECIPE_DIFFERENCE', leftRecipeName: 'A', rightRecipeName: 'B', direction: 'RIGHT_MINUS_LEFT', delta: 10 };
    const passing = candidate({ answer: 'A和B成本差10元。', facts: [differenceFact()] });
    assert.equal(evaluateBusinessOutcome({ oracle }, passing).pass, true);
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ answer: 'A和B成本差10元。', facts: [differenceFact('C', 'B')] })).pass, false);
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ answer: 'A和B成本差10元。', facts: [differenceFact('A', 'C')] })).pass, false);
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ answer: 'A和B成本差10元。', facts: [differenceFact('A', 'B', 'LEFT_MINUS_RIGHT')] })).pass, false);
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ answer: 'A和B成本差10元。', facts: [differenceFact('C', 'D')] })).pass, false);
});

test('R6 recipe comparison accepts the formally equivalent reverse query, but not a different pair or inverse mismatch', () => {
    const oracle = { kind: 'RECIPE_DIFFERENCE', leftRecipeName: 'A', rightRecipeName: 'B', direction: 'RIGHT_MINUS_LEFT', delta: -10 };
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ answer: 'A比B成本高10元。', facts: [differenceFact('B', 'A', 'RIGHT_MINUS_LEFT', 10)] })).pass, true);
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ answer: 'A比B成本高10元。', facts: [differenceFact('C', 'A', 'RIGHT_MINUS_LEFT', 10)] })).pass, false);
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ answer: 'A比B成本高10元。', facts: [differenceFact('B', 'A', 'RIGHT_MINUS_LEFT', 9)] })).pass, false);
});

test('FH1R1-06/07/08/09: safely rejected scenarios are not unsupported executions', () => {
    const rejected = candidate({ answer: '该配置未应用。', receipts: [{ applicationStatus: 'NOT_APPLIED', comparisonStatus: 'COMPARABLE', capabilityOutcome: 'REQUESTED_CHANGE_NOT_APPLIED' }], traces: [{ name: 'compare_recipe_scenarios', businessExecution: true }] });
    const safe = safetyTelemetry(rejected, { oracle: { kind: 'SCENARIO', recipeName: 'A' } });
    assert.equal(safe.scenario.rejectedNotApplied, 1); assert.equal(safe.scenario.unsupportedExecuted, 0);
    const nonComparable = safetyTelemetry(candidate({ receipts: [{ applicationStatus: 'UNKNOWN', comparisonStatus: 'NON_COMPARABLE', capabilityOutcome: 'NON_COMPARABLE' }], traces: [{ name: 'compare_recipe_scenarios', businessExecution: true }] }), { oracle: { kind: 'SCENARIO', recipeName: 'A' } });
    assert.equal(nonComparable.scenario.unsupportedExecuted, 0);
    const falseZero = safetyTelemetry(candidate({ answer: '已经完成，增加0元。', receipts: rejected.formalOutcomeReceipts, traces: rejected.traces }), { oracle: { kind: 'SCENARIO', recipeName: 'A' } });
    assert.equal(falseZero.scenario.falseZeroCompletion, 1); assert.equal(falseZero.scenario.partialReportedComplete, 1);
    const applied = safetyTelemetry(candidate({ receipts: [{ applicationStatus: 'APPLIED', comparisonStatus: 'COMPARABLE', capabilityOutcome: 'EXECUTABLE_RESULT' }] }), { oracle: { kind: 'SCENARIO', recipeName: 'A' } });
    assert.equal(applied.scenario.rejectedNotApplied, 0); assert.equal(applied.scenario.unsupportedExecuted, 0);
});

test('FH1R1-10/11/12/13: claim-scoped money roles allow valid supporting facts and catch role misuse', () => {
    const facts = [money('F-1', 'R', 224, 'CURRENT_BASE'), money('F-2', 'R', 242, 'SCENARIO_CANDIDATE'), { factId: 'F-3', verified: true, entity: { type: 'recipe', canonicalName: 'R' }, predicate: 'scenario_cost_difference', value: 18, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_DIFFERENCE' } }];
    const good = candidate({ answer: '当前224元，修改后242元，增加18元。', facts, claims: [{ text: '当前224元', factIds: ['F-1'] }, { text: '修改后242元', factIds: ['F-2'] }, { text: '增加18元', factIds: ['F-3'] }] });
    assert.equal(safetyTelemetry(good, { oracle: { kind: 'SCENARIO', recipeName: 'R' } }).money.acceptedWrongBasis, 0);
    const currentWithScenario = candidate({ answer: '242元是当前正式成本。', facts: [facts[1]], claims: [{ text: '242元是当前正式成本', factIds: ['F-2'] }] });
    assert.equal(safetyTelemetry(currentWithScenario, { oracle: { kind: 'SCENARIO', recipeName: 'R' } }).money.acceptedWrongBasis, 1);
    assert.equal(safetyTelemetry(currentWithScenario, { oracle: { kind: 'SCENARIO', recipeName: 'R' } }).money.rejectedWrongBasisAttempts, 0);
    const scenarioWithCurrent = candidate({ answer: '试算后224元。', facts: [facts[0]], claims: [{ text: '试算后224元', factIds: ['F-1'] }] });
    assert.equal(safetyTelemetry(scenarioWithCurrent, { oracle: { kind: 'SCENARIO', recipeName: 'R' } }).money.acceptedWrongBasis, 1);
    const recipeFacts = [money('F-A', 'A', 224), money('F-B', 'B', 234), differenceFact()];
    const recipe = candidate({ answer: 'A当前224元，B当前234元，成本差10元。', facts: recipeFacts, claims: [{ text: 'A当前224元', factIds: ['F-A'] }, { text: 'B当前234元', factIds: ['F-B'] }, { text: '成本差10元', factIds: ['F-D'] }] });
    assert.equal(safetyTelemetry(recipe, { oracle: { kind: 'RECIPE_DIFFERENCE', leftRecipeName: 'A', rightRecipeName: 'B' } }).money.acceptedWrongBasis, 0);
});

test('FH1R1-10..15: serialized evidence preserves trace/finalization/context and is secret-safe and reconstructable', () => {
    const item = { id: 'D1-01', rawOwnerInput: '测试', businessMemo: 'business', policyMemo: 'policy', candidate: candidate({ facts: [money('F-1', 'A', 1)], metrics: { mainModelCalls: 2, businessToolCalls: 1, loadedToolNames: ['x'] }, context: { safe: true }, durationMs: 123, traces: [{ name: 'search_coils' }], finalizationAttempts: [{ attempt: 1, valid: true }] }), outcome: { pass: true, classification: 'PASS', declaredStatus: 'COMPLETED' }, safety: {} };
    const serialized = serializeRun(item);
    for (const field of ['metrics', 'traces', 'formalOutcomeReceipts', 'finalizationAttempts', 'answerValidation', 'context', 'durationMs', 'businessMemoHash', 'policyMemoHash']) assert.ok(Object.hasOwn(serialized, field));
    assert.equal(scanForSecrets(serialized).pass, true);
    assert.deepEqual(derivePerformance([serialized]), { averageMainModelCalls: 2, medianMainModelCalls: 2, averageBusinessToolCalls: 1, maxBusinessToolCalls: 1, averageLoadedTools: 1, maxLoadedTools: 1, medianDurationMs: 123, p95DurationMs: 123 });
    assert.deepEqual(deriveFinalizationStats([serialized]), { firstPassValid: 1, validAfterRepair: 0, fallbackCount: 0, formalResultObtainedButDeliveryFailed: 0 });
    assert.equal(scanForSecrets({ authorization: 'Bearer secret', nested: { confirmationToken: 'x' } }).pass, false);
    assert.equal(Object.keys(FINAL_V2_ARTIFACTS).length, 8);
});

test('FH1R1 artifact writer creates the frozen V2 contract without repository evidence or secrets', () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'd1-final-writer-'));
    try {
        writeFinalV2Artifacts(output, { sourceManifest: { test: true }, acceptance: '# Test-only contract\n' });
        assert.equal(JSON.parse(fs.readFileSync(path.join(output, FINAL_V2_ARTIFACTS.sourceManifest), 'utf8')).test, true);
        assert.equal(fs.readFileSync(path.join(output, FINAL_V2_ARTIFACTS.acceptance), 'utf8'), '# Test-only contract\n');
        writeFinalV2Artifacts(output, { safety: { authorization: 'Bearer secret' } });
        assert.doesNotMatch(fs.readFileSync(path.join(output, FINAL_V2_ARTIFACTS.safety), 'utf8'), /authorization|Bearer secret/iu);
    } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('FH1R1 repetition and real initialization contracts remain explicit and model-free', () => {
    const plan = buildRepetitionPlan();
    assert.deepEqual(REPETITION_CASE_IDS, ['D1-01', 'D1-03', 'D1-04', 'D1-05', 'D1-06', 'D1-07', 'D1-08']);
    assert.equal(RUNS_PER_CASE, 3); assert.equal(plan.length, 21); assert.equal(new Set(plan.map(item => item.runId)).size, 21);
    assert.throws(() => assertRealDatabaseSource({ NODE_ENV: 'test' }), /LOCAL_BUSINESS_DB/);
    const order = []; const runtime = initializeRealHarness({ environment: () => { order.push('environment'); return {}; }, assertDatabaseSource: () => { order.push('guard'); return { databaseSource: 'LOCAL_BUSINESS_DB' }; }, requireModule: name => { order.push(name); return name.includes('executor') ? { executeToolCall() {} } : { db: {} }; } });
    assert.deepEqual(order.slice(0, 2), ['environment', 'guard']); assert.equal(runtime.database.databaseSource, 'LOCAL_BUSINESS_DB');
});

test('FH1R1 runners require explicit model opt-in before opening a runtime', async () => {
    const previous = process.env.D1_FINAL_ALLOW_MODEL_RUN;
    delete process.env.D1_FINAL_ALLOW_MODEL_RUN;
    try {
        await assert.rejects(controlledMain(), /EXPLICIT_OPT_IN/);
        await assert.rejects(repetitionMain(), /EXPLICIT_OPT_IN/);
        await assert.rejects(realMain(), /EXPLICIT_OPT_IN/);
    } finally {
        if (previous === undefined) delete process.env.D1_FINAL_ALLOW_MODEL_RUN;
        else process.env.D1_FINAL_ALLOW_MODEL_RUN = previous;
    }
});

test('SR-01..07: Final runners own the environment helper and initialize it before fixture/executor work', () => {
    assert.equal(typeof finalAcceptanceEnvironment, 'function');
    const env = finalAcceptanceEnvironment();
    assert.equal(env.DEEPSEEK_MODEL, 'deepseek-chat');
    assert.equal(env.AI_CONTEXT_WINDOW_TOKENS, process.env.D1_R1_CONTEXT_WINDOW_TOKENS || '65536');
    const controlledSource = fs.readFileSync(path.join(process.cwd(), 'scripts/ai-experiments/api-native-agent/run-d1-final-controlled.cjs'), 'utf8');
    const repetitionSource = fs.readFileSync(path.join(process.cwd(), 'scripts/ai-experiments/api-native-agent/run-d1-final-controlled-repetition.cjs'), 'utf8');
    assert.doesNotMatch(controlledSource, /\{\s*freshMemos,\s*environment\s*\}/u);
    assert.doesNotMatch(repetitionSource, /run-d1-r1-controlled\.cjs.*environment/u);
    assert.ok(controlledSource.indexOf('const env = finalAcceptanceEnvironment();') < controlledSource.indexOf('startD1R1ControlledFixture()'));
    assert.ok(repetitionSource.indexOf('const env = finalAcceptanceEnvironment();') < repetitionSource.indexOf('startD1R1ControlledFixture()'));
});

test('FH1R1 manifest separates product and harness commits with runner hashes and no provider call', () => {
    const manifest = buildFinalAcceptanceManifest();
    assert.equal(manifest.productBaselineCommit, PRODUCT_BASELINE_COMMIT);
    assert.equal(manifest.productDrift.pass, true);
    assert.match(manifest.harnessCommit, /^[a-f0-9]{40}$/);
    for (const key of ['controlledRunnerHash', 'repetitionRunnerHash', 'realRunnerHash', 'candidateSourceHash', 'scenarioToolSchemaFingerprint']) assert.match(manifest[key], /^[a-f0-9]{64}$/);
});

test('R6 EV-SK-01..05: scenario business evidence matches semantics, not an oracle-local scenario key', () => {
    const oracle = { kind: 'SCENARIO', recipeName: 'V750-通用款', candidateScenarioKey: 'rotor', candidateAmount: 230, delta: 6, answerMarker: '不锈钢接轴', requiredOverrideKeys: ['rotorProcessMode'] };
    const facts = [
        money('F-candidate', 'V750-通用款', 230, 'SCENARIO_CANDIDATE'),
        { factId: 'F-delta', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'scenario_cost_difference', value: 6, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_DIFFERENCE', candidateScenarioKey: 'stainless' } },
    ];
    const semanticMatch = candidate({ answer: 'V750-通用款做不锈钢接轴增加6元。', facts, receipts: [{ scenarioKey: 'stainless', applicationStatus: 'APPLIED', comparisonStatus: 'COMPARABLE', appliedOverrideKeys: ['rotorProcessMode'], capabilityOutcome: 'EXECUTABLE_RESULT' }] });
    assert.equal(evaluateBusinessOutcome({ oracle }, semanticMatch).pass, true);
    const wrongOverride = candidate({ answer: 'V750-通用款做不锈钢接轴增加6元。', facts, receipts: [{ scenarioKey: 'stainless', applicationStatus: 'APPLIED', comparisonStatus: 'COMPARABLE', appliedOverrideKeys: ['surfaceTreatmentMode'], capabilityOutcome: 'EXECUTABLE_RESULT' }] });
    assert.equal(evaluateBusinessOutcome({ oracle }, wrongOverride).pass, false);
    const notApplied = candidate({ answer: 'V750-通用款做不锈钢接轴增加6元。', facts, receipts: [{ scenarioKey: 'stainless', applicationStatus: 'NOT_APPLIED', comparisonStatus: 'COMPARABLE', appliedOverrideKeys: ['rotorProcessMode'], capabilityOutcome: 'REQUESTED_CHANGE_NOT_APPLIED' }] });
    assert.equal(evaluateBusinessOutcome({ oracle }, notApplied).pass, false);
    const wrongAmount = candidate({ answer: 'V750-通用款做不锈钢接轴增加6元。', facts: [money('F-candidate', 'V750-通用款', 231, 'SCENARIO_CANDIDATE'), facts[1]], receipts: semanticMatch.formalOutcomeReceipts });
    assert.equal(evaluateBusinessOutcome({ oracle }, wrongAmount).pass, false);
});

test('R6 evaluator treats anonymous provenance as a quality signal, never as an invented formal identity', () => {
    const anonymous = { factId: 'F-1', verified: true, entity: { type: 'recipe', canonicalName: null }, predicate: 'formal_field:recipe.parts[0].model', value: '轴承', unit: null };
    const telemetry = safetyTelemetry(candidate({ facts: [anonymous], claims: [{ text: '正式详情读取成功。', factIds: ['F-1'] }] }), {});
    assert.notEqual(telemetry.identity.acceptedInventedIds, 1);
    assert.equal(telemetry.identity.anonymousEntityProvenanceFacts, 1);
});

test('R6 evaluator does not invent a wrong-basis violation from one valid multi-money assertion', () => {
    const facts = [money('F-current', 'R', 224, 'CURRENT_BASE'), money('F-candidate', 'R', 230, 'SCENARIO_CANDIDATE'), { factId: 'F-delta', verified: true, entity: { type: 'recipe', canonicalName: 'R' }, predicate: 'scenario_cost_difference', value: 6, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_DIFFERENCE' } }];
    const valid = candidate({ answer: 'R当前224元，试算230元，增加6元。', facts, claims: [{ text: 'R当前224元，试算230元，增加6元。', factIds: ['F-current', 'F-candidate', 'F-delta'] }] });
    assert.equal(safetyTelemetry(valid, { oracle: { kind: 'SCENARIO', recipeName: 'R' }, businessOutcome: { pass: true } }).money.acceptedWrongBasis, 0);
});

test('R6 evaluator defers to a validator-accepted, oracle-passing atomic answer instead of reclassifying natural-language contrast wording', () => {
    const facts = [money('F-current', 'R', 224, 'CURRENT_BASE'), { factId: 'F-delta', verified: true, entity: { type: 'recipe', canonicalName: 'R' }, predicate: 'scenario_cost_difference', value: 48, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_DIFFERENCE' } }];
    const valid = candidate({ answer: 'R试算配置比当前正式配置高48元。', facts, claims: [{ text: 'R试算配置比当前正式配置高48元。', factIds: ['F-delta'] }] });
    assert.equal(safetyTelemetry(valid, { oracle: { kind: 'SCENARIO', recipeName: 'R' }, businessOutcome: { pass: true } }).money.acceptedWrongBasis, 0);
});

test('R6 REAL detail and complete record-set oracles accept verified formal evidence without duplicated display names or a synthetic count fact', () => {
    const detail = candidate({ answer: '已读取正式配方 V750。', facts: [
        { factId: 'F-resolved', verified: true, entity: { type: 'recipe', canonicalName: 'V750' }, predicate: 'identity_resolved', value: 'V750' },
        { factId: 'F-detail', verified: true, entity: null, predicate: 'formal_result_available', value: true, source: { tool: 'get_recipe_detail' } },
        { factId: 'F-child', verified: true, entity: { type: 'recipe', canonicalName: null }, predicate: 'formal_field:recipe.parts[0].model', value: '轴承' },
    ], traces: [{ name: 'resolve_entity', success: true, verified: true, factIds: ['F-resolved'] }, { name: 'get_recipe_detail', success: true, verified: true, factIds: ['F-detail', 'F-child'] }], claims: [{ text: '已读取正式配方 V750。', factIds: ['F-resolved', 'F-detail'] }] });
    assert.equal(evaluateBusinessOutcome({ oracle: { kind: 'RECIPE_DETAIL', recipeName: 'V750' } }, detail).pass, true);
    const records = candidate({ answer: '正式方案只有一套：COIL-0001。', facts: [
        { factId: 'F-search', verified: true, entity: null, predicate: 'formal_result_available', value: true, source: { tool: 'search_coils' } },
        { factId: 'F-code', verified: true, entity: null, predicate: 'formal_field:data[0].schemeCode', value: 'COIL-0001', source: { tool: 'search_coils' } },
    ], claims: [{ text: '正式方案只有一套：COIL-0001。', factIds: ['F-search', 'F-code'] }] });
    assert.equal(evaluateBusinessOutcome({ oracle: { kind: 'COIL_COUNT', count: 1, queryComplete: true, candidateNames: ['COIL-0001'] } }, records).pass, true);
});

test('R6 recipe detail current-cost projection promotes only the formal complete current total', () => {
    const ledger = createFactLedger({ includeRecipeDetailCurrentCostFacts: true });
    const binding = new Map([['recipe:1', { verified: true, canonicalName: null }]]);
    ledger.appendToolResult({ toolName: 'get_recipe_detail', args: { recipeId: 1 }, entityBindings: binding, result: { success: true, verified: true, agentToolName: 'get_recipe_detail', data: { recipe: { id: 1, name: 'R' }, currentCost: { costComplete: true, currentTotalCost: 224, costBasis: 'currentFullCost' } } } });
    const current = ledger.facts().find(fact => fact.predicate === 'current_cost');
    assert.deepEqual({ entity: current?.entity?.canonicalName, value: current?.value, basis: current?.basis, role: current?.qualifiers?.moneyRole }, { entity: 'R', value: 224, basis: 'currentFullCost', role: 'CURRENT_FORMAL' });
    const incomplete = createFactLedger({ includeRecipeDetailCurrentCostFacts: true });
    incomplete.appendToolResult({ toolName: 'get_recipe_detail', args: { recipeId: 1 }, entityBindings: binding, result: { success: true, verified: true, agentToolName: 'get_recipe_detail', data: { recipe: { id: 1, name: 'R' }, currentCost: { costComplete: false, currentTotalCost: null, partialTotalCost: 224, costBasis: 'currentFullCost' } } } });
    assert.equal(incomplete.facts().some(fact => fact.predicate === 'current_cost'), false);
});

test('R6 packing schema accepts a formal part identity without forcing the model to echo mutable catalog display fields, while supplied mismatches remain safe', () => {
    const args = validateAiToolArgs('compare_recipe_scenarios', { recipeId: 1, version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'packing', label: '包装', overrides: { packingParts: [{ partId: 9, qty: 1, packingRole: 'container' }] } }] });
    assert.deepEqual(args.scenarios[0].overrides.packingParts[0], { partId: 9, qty: 1, packingRole: 'container' });
    const mismatch = formalToolFailure({ code: 'PACKING_IDENTITY_MISMATCH', statusCode: 422, details: { canonicalBinding: { partId: 9, model: '木箱', supplier: '正式供应商', packingRole: 'container' } } }, 'compare_recipe_scenarios');
    assert.deepEqual(mismatch.details.canonicalBinding, { partId: 9, model: '木箱', supplier: '正式供应商', packingRole: 'container' });
});

test('ADJ-01..05: ambiguity requires formal ambiguity and a safe clarification, not exhaustive candidate-name echo', () => {
    const oracle = { kind: 'AMBIGUITY', candidateNames: ['V750通用款', 'V750豪贝款'], answerPattern: /(?:确认|选择|具体|哪个)/u };
    const safe = candidate({ answer: '存在多个候选，请确认具体款式。', status: 'CLARIFICATION', traces: [{ name: 'resolve_entity', success: false, verified: false, businessExecution: false, code: 'ENTITY_AMBIGUOUS', factIds: ['F-1'] }], claims: [] });
    assert.equal(evaluateBusinessOutcome({ oracle }, safe).pass, true);
    const listed = candidate({ answer: '候选为V750通用款和V750豪贝款，请确认选择哪个。', status: 'CLARIFICATION', traces: safe.traces, claims: [] });
    assert.equal(evaluateBusinessOutcome({ oracle }, listed).pass, true);
    const tellWhichSet = candidate({ answer: '该对象不唯一，请告知要查哪一套。', status: 'CLARIFICATION', traces: safe.traces, claims: [] });
    assert.equal(evaluateBusinessOutcome({ oracle }, tellWhichSet).pass, true);
    const selected = candidate({ answer: 'V750通用款成本为100元。', status: 'CLARIFICATION', facts: [money('F-1', 'V750通用款', 100)], traces: [{ name: 'resolve_entity', success: false, verified: false, businessExecution: false, code: 'ENTITY_AMBIGUOUS' }, { name: 'get_recipe_detail', success: true, verified: true, businessExecution: true }], claims: [{ text: 'V750通用款成本为100元。', factIds: ['F-1'] }] });
    assert.equal(evaluateBusinessOutcome({ oracle }, selected).pass, false);
    const investigatedSafely = candidate({ answer: '存在多个候选，请确认具体款式。', status: 'CLARIFICATION', traces: [...safe.traces, { name: 'get_all_recipes', success: true, verified: true, businessExecution: true }], claims: [] });
    assert.equal(evaluateBusinessOutcome({ oracle }, investigatedSafely).pass, true);
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ answer: '有多个候选，请确认具体款式。', status: 'CLARIFICATION', claims: [] })).pass, false);
    const moneyCandidate = candidate({ answer: '存在多个候选，请确认；其中一款成本100元。', status: 'CLARIFICATION', traces: safe.traces, claims: [] });
    assert.equal(evaluateBusinessOutcome({ oracle }, moneyCandidate).pass, false);
});

test('RD-01..06: recipe detail requires verified resolver and verified identity-protected detail, not child display-name duplication', () => {
    const oracle = { kind: 'RECIPE_DETAIL', recipeName: 'V750大脚板-2寸-经典款' };
    const traces = [{ name: 'resolve_entity', success: true, verified: true, businessExecution: true, factIds: ['F-resolve'] }, { name: 'get_recipe_detail', success: true, verified: true, businessExecution: true, factIds: ['F-detail'] }];
    const facts = [{ factId: 'F-child', verified: true, entity: { type: 'recipe', canonicalName: null }, predicate: 'formal_field:parts[0].model', value: '轴承' }];
    const pass = candidate({ answer: 'V750大脚板-2寸-经典款已读取正式配方明细。', facts, traces, claims: [{ text: 'V750大脚板-2寸-经典款已读取正式配方明细。', factIds: ['F-resolve', 'F-detail'] }] });
    assert.equal(evaluateBusinessOutcome({ oracle }, pass).pass, true);
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ answer: pass.answer, facts, traces: [traces[1]], claims: pass.answerValidation.claims })).pass, false);
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ answer: 'V550已读取正式配方明细。', facts, traces, claims: pass.answerValidation.claims })).pass, false);
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ answer: pass.answer, facts, traces: [traces[0], { ...traces[1], success: false, verified: false }], claims: pass.answerValidation.claims })).pass, false);
    assert.equal(evaluateBusinessOutcome({ oracle }, pass).pass, true);
    assert.equal(evaluateBusinessOutcome({ oracle }, candidate({ answer: 'V750大脚板-2寸-经典款配方ID 123已读取。', facts, traces, claims: pass.answerValidation.claims })).pass, false);
});

test('R7 frozen V3 D1-10 and REAL-01 trace contracts adjudicate without replacing model samples', () => {
    const ambiguity = candidate({ answer: 'V750存在多个候选，请确认具体款式。', status: 'CLARIFICATION', traces: [{ name: 'resolve_entity', success: false, verified: false, businessExecution: false, code: 'ENTITY_AMBIGUOUS', factIds: ['F-001'] }], claims: [] });
    assert.equal(evaluateBusinessOutcome({ oracle: { kind: 'AMBIGUITY', candidateNames: ['A', 'B'], answerPattern: /(?:确认|选择|具体|哪个)/u } }, ambiguity).pass, true);
    const detail = candidate({ answer: 'V750大脚板-2寸-经典款已正式解析并读取配方明细。', traces: [{ name: 'resolve_entity', success: true, verified: true, businessExecution: true, factIds: ['F-001'] }, { name: 'get_recipe_detail', success: true, verified: true, businessExecution: true, factIds: ['F-002', 'F-003'] }], claims: [{ text: 'V750大脚板-2寸-经典款已正式解析并读取配方明细。', factIds: ['F-001', 'F-002'] }] });
    assert.equal(evaluateBusinessOutcome({ oracle: { kind: 'RECIPE_DETAIL', recipeName: 'V750大脚板-2寸-经典款' } }, detail).pass, true);
});
