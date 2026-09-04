'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const observability = require('../api/services/observability.cjs');
const { prepareAiToolCalls } = require('../api/services/aiToolProtocol.cjs');
const {
    argumentShape,
    collectV5ShadowFacts,
    stableIdentityHash,
} = require('../api/services/ai-v5/shadowFacts.cjs');
const {
    captureSafeV4ShadowFacts,
    projectSafeV4Facts,
} = require('../api/services/ai-v5/shadowProjection.cjs');
const {
    compareV4ActualToV5Shadow,
    evaluateP06ProductionShadowControls,
} = require('../api/services/ai-v5/shadowComparison.cjs');

const TRACE_ID = '1234567890abcdef1234567890abcdef';
const SENTINELS = [
    'P14_SECRET_SENTINEL', 'P14_ENTITY_SENTINEL', 'P14_TOOL_ARG_SENTINEL',
    'P14_TOOL_RESULT_SENTINEL', 'P14_PROMPT_SENTINEL', 'P14_RESPONSE_SENTINEL',
];

function sourceResult(outcome = 'completed') {
    return {
        finalContent: 'P14_RESPONSE_SENTINEL',
        intent: { mode: 'query', raw: 'P14_PROMPT_SENTINEL' },
        toolResults: [{ value: 'P14_TOOL_RESULT_SENTINEL' }],
        telemetry: {
            outcome,
            requestId: 'p14-request-001',
            toolSteps: [{ capabilityName: 'search_parts', success: true, errorCode: '' }],
        },
    };
}

test('request-scoped collector records only structural entity, route, argument, tool and verification facts', async () => {
    const original = sourceResult();
    const collected = await collectV5ShadowFacts(async () => {
        observability.withEntityNormalizationSpan({
            entityType: 'part', input: 'P14_ENTITY_SENTINEL-', output: 'P14_ENTITY_SENTINEL',
        }, () => ['P14_ENTITY_SENTINEL']);
        await observability.withEntityResolutionSpan({ entityType: 'part' }, async () => ({
            status: 'exact',
            receipt: {
                candidates: [{ name: 'P14_ENTITY_SENTINEL' }],
                selected: { id: 'P14_ENTITY_SENTINEL', matchKind: 'exact' },
            },
        }));
        observability.withRoutingSpan({ availableToolCount: 3, access: 'read' }, () => ({
            status: 'selected', capabilityName: 'search_parts',
        }));
        prepareAiToolCalls([{
            id: 'call-1',
            function: { name: 'search_parts', arguments: JSON.stringify({ keyword: 'P14_TOOL_ARG_SENTINEL' }) },
        }], 'model', { allowedToolNames: ['search_parts'], writeTools: new Set() });
        await observability.withToolSpan({
            toolName: 'search_parts', capability: 'inventory.parts.read', access: 'read',
            args: { query: 'P14_TOOL_ARG_SENTINEL' },
        }, async () => ({ success: true, value: 'P14_TOOL_RESULT_SENTINEL' }));
        observability.withVerificationSpan({
            status: 'verified', requiredCount: 1, observedCount: 1, missingCount: 0,
            toolExecutionCount: 1,
        }, () => true);
        return original;
    });
    assert.equal(collected.result, original);
    assert.equal(collected.shadowFacts.entityNormalizations.length, 1);
    assert.equal(collected.shadowFacts.entityResolutions[0].identityPreservationStatus, 'CANONICAL_ID_HASHED');
    assert.equal(collected.shadowFacts.routes[0].selectedToolName, 'search_parts');
    assert.equal(collected.shadowFacts.argumentValidations[0].status, 'VALIDATED');
    assert.deepEqual(collected.shadowFacts.argumentValidations[0].typeSignature, { keyword: 'string' });
    assert.equal(collected.shadowFacts.toolExecutions[0].executionStatus, 'SUCCESS');
    assert.equal(collected.shadowFacts.verifications[0].beforeAnyTool, false);
    const serialized = JSON.stringify(collected.shadowFacts);
    for (const sentinel of SENTINELS) assert.equal(serialized.includes(sentinel), false);
});

test('captured enriched facts project into all safe structural layers without raw values', async () => {
    const collected = await collectV5ShadowFacts(async () => {
        prepareAiToolCalls([{
            function: { name: 'search_parts', arguments: JSON.stringify({ keyword: 'P14_TOOL_ARG_SENTINEL' }) },
        }], 'model', { allowedToolNames: ['search_parts'], writeTools: new Set() });
        await observability.withToolSpan({ toolName: 'search_parts', access: 'read', args: { query: 'P14_TOOL_ARG_SENTINEL' } },
            async () => ({ success: true, data: 'P14_TOOL_RESULT_SENTINEL' }));
        observability.withVerificationSpan({ status: 'verified', requiredCount: 1, observedCount: 1, toolExecutionCount: 1 }, () => true);
        return sourceResult();
    });
    const facts = captureSafeV4ShadowFacts({ requestId: 'p14-request-001' }, collected.result, { traceId: TRACE_ID }, {
        createdAt: '2026-09-04T00:00:00.000Z', shadowTaskId: 'v5-shadow-p14-001',
        shadowFacts: collected.shadowFacts,
        structural: { intendedCapabilityId: 'inventory.read', expectedSuccess: true, entityStatus: 'NOT_APPLICABLE' },
    });
    const projection = projectSafeV4Facts(facts);
    const comparison = compareV4ActualToV5Shadow(projection);
    assert.deepEqual(projection.availability, {
        entityFactsAvailable: true,
        capabilityFactsAvailable: true,
        argumentFactsAvailable: true,
        stateFactsAvailable: true,
        verificationFactsAvailable: true,
    });
    assert.equal(comparison.comparisonStatus, 'AGREE');
    for (const value of Object.values(comparison).filter(value => value?.status)) {
        assert.ok(['AGREE', 'NOT_APPLICABLE'].includes(value.status));
    }
    const serialized = JSON.stringify({ facts, projection, comparison });
    for (const sentinel of SENTINELS) assert.equal(serialized.includes(sentinel), false);
});

test('layer priority preserves upstream failure blocks despite deferred verification', () => {
    const facts = captureSafeV4ShadowFacts({ requestId: 'p14-request-002' }, sourceResult('budget_exhausted'), null, {
        shadowTaskId: 'v5-shadow-p14-002', createdAt: '2026-09-04T00:00:00.000Z',
        structural: {
            failureClass: 'C02', intendedCapabilityId: 'inventory.read', validatedArgumentsReady: true,
            stateValid: false, entityStatus: 'NOT_APPLICABLE', verificationStatus: 'UNKNOWN',
        },
    });
    const comparison = compareV4ActualToV5Shadow(projectSafeV4Facts(facts));
    assert.equal(comparison.stateComparison.status, 'V5_BLOCKS_V4_FAILURE');
    assert.equal(comparison.verificationComparison.status, 'INSUFFICIENT_DATA');
    assert.equal(comparison.comparisonStatus, 'V5_BLOCKS_V4_FAILURE');
});

test('successful complete path with only verification deferred gets versioned deferred agreement', () => {
    const facts = captureSafeV4ShadowFacts({ requestId: 'p14-request-003' }, sourceResult(), null, {
        shadowTaskId: 'v5-shadow-p14-003', createdAt: '2026-09-04T00:00:00.000Z',
        structural: {
            expectedSuccess: true, intendedCapabilityId: 'inventory.read', validatedArgumentsReady: true,
            stateValid: true, entityStatus: 'NOT_APPLICABLE', verificationStatus: 'UNKNOWN',
        },
    });
    const comparison = compareV4ActualToV5Shadow(projectSafeV4Facts(facts));
    assert.equal(comparison.comparisonStatus, 'AGREE_WITH_DEFERRED_VERIFICATION');
});

test('argument shapes and canonical identity hashes are deterministic and content-free', () => {
    assert.deepEqual(argumentShape({ model: 'P14_ENTITY_SENTINEL', quantity: 3, flags: [] }), {
        keys: ['flags', 'model', 'quantity'], count: 3,
        typeSignature: { flags: 'array', model: 'string', quantity: 'number' },
    });
    assert.equal(stableIdentityHash('P14_ENTITY_SENTINEL'), stableIdentityHash('P14_ENTITY_SENTINEL'));
    assert.match(stableIdentityHash('P14_ENTITY_SENTINEL'), /^[a-f0-9]{24}$/);
    assert.equal(stableIdentityHash('P14_ENTITY_SENTINEL').includes('P14'), false);
});

test('P06 layered shadow evaluation reaches frozen comparability targets with zero false blocks', () => {
    const corpus = require('../docs/ai-observability/data/p06-failure-cases.json');
    const evaluation = evaluateP06ProductionShadowControls(corpus);
    assert.equal(evaluation.paths.length, 15);
    assert.equal(evaluation.metrics.c02Comparable, 3);
    assert.equal(evaluation.metrics.r02Comparable, 3);
    assert.equal(evaluation.metrics.a01Comparable, 2);
    assert.equal(evaluation.metrics.falseBlocks, 0);
    assert.equal(evaluation.metrics.blockedFailures, 8);
});

test('test-safe dispatcher import has zero source DB and backup side effects', () => {
    const root = path.resolve(__dirname, '..');
    const sourceDb = path.join(root, 'pump.db');
    const backupRoot = path.join(root, 'backups');
    const beforeDb = fs.statSync(sourceDb);
    const beforeBackups = fs.readdirSync(backupRoot, { recursive: true }).length;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-p14-import-'));
    const child = spawnSync(process.execPath, ['-e', "require('./api/services/aiDispatcherV3.cjs');"], {
        cwd: root,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            NODE_TEST_CONTEXT: 'p14-import-side-effect-test',
            PUMP_TEST_DATABASE_PATH: path.join(temporary, 'runtime-{pid}.db'),
            DB_BACKUP_DIR: path.join(temporary, 'backups'),
            AI_V5_SHADOW_ENABLED: 'false',
        },
        encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    const afterDb = fs.statSync(sourceDb);
    assert.equal(afterDb.size, beforeDb.size);
    assert.equal(afterDb.mtimeMs, beforeDb.mtimeMs);
    assert.equal(fs.readdirSync(backupRoot, { recursive: true }).length, beforeBackups);
    assert.equal(fs.existsSync(path.join(temporary, 'backups')), false);
    fs.rmSync(temporary, { recursive: true, force: true });
});
