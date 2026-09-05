'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const p06Cases = require('../docs/ai-observability/data/p06-failure-cases.json');
const {
    analyzeP06FailureAgainstV5A,
    projectP06FailureCorpus,
    projectV4FailureCaseToV5Task,
} = require('../api/services/ai-v5/v4Projection.cjs');

const AT = '2026-09-04T00:00:00.000Z';

test('valid V4 safe metadata projects read-only into an explicitly incomplete V5 shadow task', () => {
    const source = {
        case_id: 'projection-001',
        result: 'PASS',
        failure_class: null,
        expected: { path: 'legacy_v3', primary_tool: 'must_not_become_capability' },
        safe_structural_metadata: {
            terminal_state: 'completed',
            tools: ['search_parts'],
            entity_resolutions: [],
            verifications: [],
        },
    };
    const before = JSON.stringify(source);
    const projected = projectV4FailureCaseToV5Task(source, { timestamp: AT });

    assert.equal(projected.status, 'partial');
    assert.equal(projected.task.state, 'COMPLETED');
    assert.equal(projected.task.requestedCapability, null);
    assert.deepEqual(projected.task.entityContext, []);
    assert.equal(projected.task.execution.toolRequest, null);
    assert.equal(projected.task.execution.toolResult, null);
    assert.equal(projected.task.verification, null);
    assert.equal(projected.task.metadata.sourceTerminalState, 'completed');
    assert.equal(projected.missing.includes('CAPABILITY_NOT_AVAILABLE'), true);
    assert.equal(projected.missing.includes('RAW_ENTITY_NOT_AVAILABLE'), true);
    assert.equal(JSON.stringify(source), before);
});

test('missing V4 fields are rejected or marked unavailable and never fabricated', () => {
    const rejected = projectV4FailureCaseToV5Task({}, { timestamp: AT });
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.task, null);

    const partial = projectV4FailureCaseToV5Task({
        case_id: 'missing-state',
        safe_structural_metadata: {},
    }, { timestamp: AT });
    assert.equal(partial.status, 'partial');
    assert.equal(partial.task.state, 'RECEIVED');
    assert.equal(partial.task.metadata.sourceTerminalState, null);
    assert.equal(partial.task.metadata.sourcePath, null);
    assert.equal(partial.task.metadata.sourceFailureClass, null);
    assert.equal(partial.missing.includes('MAPPABLE_V4_STATE_NOT_AVAILABLE'), true);
});

test('all 15 P06 safe paths project as incomplete shadow tasks without rejection', () => {
    const result = projectP06FailureCorpus(p06Cases, { timestamp: AT });
    assert.deepEqual({
        total: result.total,
        complete: result.complete,
        partial: result.partial,
        rejected: result.rejected,
    }, { total: 15, complete: 0, partial: 15, rejected: 0 });
    assert.equal(result.projections.every(item => item.projection.task.version === 1), true);
    assert.equal(result.projections.every(item => item.projection.task.requestedCapability === null), true);
    assert.equal(result.projections.every(item => item.projection.task.entityContext.length === 0), true);
    assert.equal(result.projections.every(item => item.projection.task.execution.toolRequest === null), true);
});

test('P06 C02 shadow analysis distinguishes blockable post-evidence routing from unknown liveness', () => {
    const cases = p06Cases.filter(item => item.failure_class === 'C02');
    const analyses = cases.map(analyzeP06FailureAgainstV5A);
    assert.equal(cases.length, 3);
    assert.equal(analyses.filter(item => item.wouldBeBlocked === 'YES').length, 2);
    assert.equal(analyses.filter(item => item.wouldBeBlocked === 'UNKNOWN').length, 1);
    assert.equal(analyses.every(item => item.scope === 'STATE_CONTRACT'), true);
});

test('P06 A01 shadow analysis blocks execution-ready promotion without validated arguments', () => {
    const cases = p06Cases.filter(item => item.failure_class === 'A01');
    const analyses = cases.map(analyzeP06FailureAgainstV5A);
    assert.equal(cases.length, 2);
    assert.equal(analyses.filter(item => item.wouldBeBlocked === 'YES').length, 2);
    assert.equal(analyses.filter(item => item.wouldBeBlocked === 'UNKNOWN').length, 0);
    assert.equal(analyses.every(item => item.scope === 'TOOL_REQUEST_CONTRACT'), true);
});

test('P06 R02 is explicitly out of scope and no routing decision is introduced', () => {
    const cases = p06Cases.filter(item => item.failure_class === 'R02');
    const analyses = cases.map(analyzeP06FailureAgainstV5A);
    assert.equal(cases.length, 3);
    assert.equal(analyses.every(item => item.scope === 'OUT_OF_SCOPE_V5_B'), true);
    assert.equal(analyses.every(item => item.wouldBeBlocked === 'UNKNOWN'), true);
});

test('V5 production import remains limited to approved shadow, interpreter, and governed entity-read boundaries', () => {
    const apiRoot = path.resolve(__dirname, '..', 'api');
    const v5Root = path.join(apiRoot, 'services', 'ai-v5');
    const sourceFiles = [];
    const walk = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(target);
            else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) sourceFiles.push(target);
        }
    };
    walk(apiRoot);

    const productionImports = sourceFiles
        .filter(file => !file.startsWith(`${v5Root}${path.sep}`))
        .filter(file => /(?:require\s*\(|from\s+)[^\n]*ai-v5/i.test(fs.readFileSync(file, 'utf8')));
    assert.deepEqual(productionImports, [
        path.join(apiRoot, 'routes', 'ai', 'chat.cjs'),
        path.join(apiRoot, 'services', 'aiDispatcherV3.cjs'),
        path.join(apiRoot, 'services', 'aiToolProtocol.cjs'),
        path.join(apiRoot, 'services', 'observability.cjs'),
    ]);
    const dispatcher = fs.readFileSync(path.join(apiRoot, 'services', 'aiDispatcherV3.cjs'), 'utf8');
    assert.match(dispatcher, /ai-v5\/shadowProjection\.cjs/);
    assert.match(dispatcher, /ai-v5\/shadowMirror\.cjs/);
    assert.doesNotMatch(dispatcher, /ai-v5\/(?:controlledRuntime|policy|capabilityRouter|executor)/);

    const forbiddenV5Imports = fs.readdirSync(v5Root)
        .filter(name => name.endsWith('.cjs'))
        .flatMap(name => {
            const content = fs.readFileSync(path.join(v5Root, name), 'utf8');
            return /(?:executor|internalApiClient|aiProvider|db\.cjs|fetch\s*\()/i.test(content)
                ? [name]
                : [];
        });
    assert.deepEqual(forbiddenV5Imports, ['candidateSet.cjs', 'readExecutionShadow.cjs', 'taskInterpreter.cjs', 'twoStageModel.cjs', 'typeIndependentEntityResolver.cjs']);
    // P16-B1 adds one governed GET readback for explicitly required field evidence.
    // No direct database, raw fetch, writes, or alternate executor is admitted.
    const readExecution = fs.readFileSync(path.join(v5Root, 'readExecutionShadow.cjs'), 'utf8');
    assert.match(readExecution, /routes\/ai\/executor\.cjs/);
    assert.match(readExecution, /allowWrite: false/);
    assert.match(readExecution, /AI_V5_EXECUTION_SHADOW_ENABLED === 'true'/);
    assert.doesNotMatch(readExecution, /(?:db\.cjs|\bfetch\s*\(|postJson|putJson|patchJson|deleteJson)/i);
    assert.match(readExecution, /\{ createInternalFetch, getJson \} = require\('\.\.\/\.\.\/routes\/ai\/internalApiClient\.cjs'\)/);
    assert.match(readExecution, /if \(fieldRequirements\.length\)/);
    assert.match(readExecution, /\/api\/parts\?keyword=/);
    // Error-class allowlists contain AiProvider names, not an additional data/client import.
    const stageWrapper = fs.readFileSync(path.join(v5Root, 'twoStageModel.cjs'), 'utf8');
    assert.doesNotMatch(stageWrapper, /(?:executor|internalApiClient|aiProvider\.cjs|db\.cjs|fetch\s*\()/i);
    const interpreter = fs.readFileSync(path.join(v5Root, 'taskInterpreter.cjs'), 'utf8');
    assert.match(interpreter, /fetchProviderWithRetry/);
    assert.match(interpreter, /maxAttempts:\s*1/);
    assert.doesNotMatch(interpreter, /(?:executor|internalApiClient|db\.cjs)/i);
    const entityResolver = fs.readFileSync(path.join(v5Root, 'typeIndependentEntityResolver.cjs'), 'utf8');
    assert.match(entityResolver, /internalApiClient\.cjs/);
    assert.doesNotMatch(entityResolver, /(?:executor|db\.cjs)/i);
    const observabilityImporters = fs.readdirSync(v5Root)
        .filter(name => name.endsWith('.cjs'))
        .filter(name => /require\(['"]\.\.\/observability\.cjs['"]\)/.test(
            fs.readFileSync(path.join(v5Root, name), 'utf8')
        ));
    // P16-B2R admits metadata-only answer spans; no new data/Tool import.
    assert.deepEqual(observabilityImporters, ['candidateSetTwoStageInterpreter.cjs', 'readAnswerComposer.cjs', 'readAuthorityMux.cjs', 'readCanary.cjs', 'readExecutionShadow.cjs', 'shadowMirror.cjs']);
    const canary = fs.readFileSync(path.join(v5Root, 'readCanary.cjs'), 'utf8');
    assert.doesNotMatch(canary, /(?:db\.cjs|routes\/ai\/executor|routes\/ai\/internalApiClient|\ballowWrite:\s*true)/);
    const deliveryConsumers = fs.readdirSync(v5Root).filter(name => name !== 'readAnswerComposer.cjs')
        .filter(name => fs.readFileSync(path.join(v5Root, name), 'utf8').includes('composeReadAnswerForCanary'));
    assert.deepEqual(deliveryConsumers, ['readCanary.cjs']);
});
