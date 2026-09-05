'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createV5Task, createV5EntityReference } = require('../api/services/ai-v5/contracts.cjs');
const { READ_EXECUTION_REGISTRY, selectReadExecution, readPolicyLock } = require('../api/services/ai-v5/readExecutionRegistry.cjs');
const { getV5Capability } = require('../api/services/ai-v5/capabilityRegistry.cjs');
const { bindReadArguments } = require('../api/services/ai-v5/readArgumentBinder.cjs');
const { runReadExecutionShadow, executionShadowEnabled } = require('../api/services/ai-v5/readExecutionShadow.cjs');
const env = { AI_V5_SHADOW_ENABLED: 'true', AI_V5_EXECUTION_SHADOW_ENABLED: 'true' };
function input(id = 'read-test', type = 'part') {
    return { capabilityId: type === 'part' ? 'inventory.read' : 'recipe.cost.preview',
        routeInput: { domain: type === 'part' ? 'catalog' : 'recipe', operation: type === 'part' ? 'read_inventory' : 'preview_cost', entityType: type },
        task: createV5Task({ taskId: id, createdAt: new Date().toISOString(), entityContext: [createV5EntityReference({
            entityType: type, rawMention: 'generic-source-', canonicalEntityId: '123', resolutionReceiptRef: `${id}:resolve`,
        })] }) };
}
function result(id = '123') {
    return { success: true, count: 1, truncated: false, parts: [{ id, stock: 3 }],
        executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/parts' }] } };
}
test('both flags exact true, default off, ordinary shadow alone never executes', async () => {
    assert.equal(executionShadowEnabled({}), false);
    assert.equal(executionShadowEnabled({ AI_V5_SHADOW_ENABLED: 'true' }), false);
    let calls = 0;
    const out = await runReadExecutionShadow(input(), { env: {}, execute: () => { calls++; } });
    assert.equal(calls, 0); assert.equal(out.toolCalls, 0);
});
test('registry is unique read-only; missing, multiple and write tools fail closed', () => {
    const { WRITE_TOOLS } = require('../api/routes/ai/tools.cjs');
    for (const name of WRITE_TOOLS) assert.equal(READ_EXECUTION_REGISTRY.some(e => e.toolName === name), false);
    for (const entry of READ_EXECUTION_REGISTRY) assert.equal(readPolicyLock(getV5Capability(entry.capabilityId), entry), true);
    assert.equal(selectReadExecution('missing').status, 'NOT_EXECUTABLE');
    assert.equal(selectReadExecution('inventory.read', [READ_EXECUTION_REGISTRY[0], READ_EXECUTION_REGISTRY[0]]).status, 'TOOL_SELECTION_AMBIGUOUS');
    assert.equal(selectReadExecution('inventory.write').status, 'NOT_EXECUTABLE');
    assert.equal(readPolicyLock(getV5Capability('inventory.read'), { ...READ_EXECUTION_REGISTRY[0], toolName: 'adjust_part_stock' }), false);
});
test('async scheduler does not await controlled read execution; capacity retained while timed-out work remains', async () => {
    const { createV5ShadowMirror } = require('../api/services/ai-v5/shadowMirror.cjs');
    const { captureSafeV4ShadowFacts } = require('../api/services/ai-v5/shadowProjection.cjs');
    const facts = n => captureSafeV4ShadowFacts({ requestId: `f1-scheduler-${n}` },
        { intent: { mode: 'query' }, telemetry: { outcome: 'completed', toolSteps: [{ capabilityName: 'search_parts', success: true }] } },
        { traceId: String(n).padStart(32, '0') }, { shadowTaskId: `f1-scheduler-${n}` });
    const benchmark = async enabled => {
        const m = createV5ShadowMirror({ env: { ...env, AI_V5_SHADOW_ENABLED: String(enabled), AI_V5_SHADOW_SAMPLE_RATE: '1' },
            runIndependent: async () => {
                await new Promise(resolve => setTimeout(resolve, 20));
                return { modelCalls: 0, v5ToolCalls: 1, readExecution: { businessApiReadCalls: 1 } };
            } });
        const times = [];
        for (let n = 0; n < 35; n++) {
            const f = facts(n + 1), started = performance.now();
            await new Promise(resolve => setTimeout(resolve, 20));
            const response = { text: 'synthetic-v4-response' };
            const job = m.mirror(f, { sourceRequest: 'synthetic' });
            if (n >= 5) times.push(performance.now() - started);
            assert.deepEqual(response, { text: 'synthetic-v4-response' });
            await job.completion;
        }
        times.sort((a, b) => a - b);
        return { runs: 30, median: times[14], p95: times[28] };
    };
    const off = await benchmark(false), on = await benchmark(true);
    const medianOverheadPercent = (on.median / off.median - 1) * 100;
    const p95OverheadPercent = (on.p95 / off.p95 - 1) * 100;
    console.log(JSON.stringify({ benchmark: 'F1_SYNTHETIC_ASYNC_SCHEDULER', off, on, medianOverheadPercent, p95OverheadPercent,
        pass: medianOverheadPercent <= 5 && p95OverheadPercent <= 10 }));
    let settle;
    const m = createV5ShadowMirror({ env: { ...env, AI_V5_SHADOW_SAMPLE_RATE: '1' }, maxConcurrency: 1, timeoutMs: 5,
        project: () => new Promise(resolve => { settle = resolve; }) });
    const first = m.mirror(facts(999));
    await new Promise(resolve => setTimeout(resolve, 20));
    await first.completion;
    assert.equal(m.snapshot().active, 1);
    assert.equal(m.mirror(facts(998)).shadowStatus, 'SHADOW_EXECUTION_SKIPPED_CAPACITY');
    settle({}); await m.waitForIdle(100); assert.equal(m.snapshot().active, 0);
});
test('binder uses canonical recipe ID and no overrides/defaults', () => {
    const out = bindReadArguments(READ_EXECUTION_REGISTRY[1], input('recipe', 'recipe').task.entityContext[0]);
    assert.deepEqual(out.arguments, { recipeId: 123 });
});
test('A01 missing/wrong type/missing identity and unsupported coil field block', () => {
    const entity = input().task.entityContext[0];
    for (const bad of [null, { ...entity, entityType: 'coil' }, { ...entity, canonicalEntityId: null }, { ...entity, resolutionReceiptRef: null }]) {
        assert.equal(bindReadArguments(READ_EXECUTION_REGISTRY[0], bad).status, 'ARGUMENT_BINDING_UNSUPPORTED');
    }
    assert.equal(bindReadArguments(READ_EXECUTION_REGISTRY[2], { ...entity, entityType: 'coil' }).status, 'ARGUMENT_BINDING_UNSUPPORTED');
});
test('source strings remain exact, numeric-looking strings are not numeric arguments', () => {
    for (const rawMention of ['abc-', '-a-', 'a/b', 'a.b', 'a_b', 'a+b', '800', '800平刀', 'v750-tokoy-', 'V750-A']) {
        assert.deepEqual(bindReadArguments(READ_EXECUTION_REGISTRY[0], { ...input().task.entityContext[0], rawMention }).arguments, { keyword: rawMention });
    }
});
test('controlled policy and state gates precede execution; evidence verified without response values', async () => {
    let calls = 0;
    const out = await runReadExecutionShadow(input(), { env, execute: async (name, args, options) => {
        calls++; assert.equal(name, 'search_parts'); assert.equal(options.allowWrite, false);
        assert.deepEqual(args, { keyword: 'generic-source-' }); return result();
    } });
    assert.equal(calls, 1); assert.equal(out.verificationStatus, 'PASS');
    assert.ok(out.stateHistory.indexOf('EXECUTING') < out.stateHistory.indexOf('VERIFYING'));
    assert.equal(out.stateHistory.at(-1), 'COMPLETED');
    assert.equal(JSON.stringify(out).includes('generic-source-'), false);
    assert.equal(JSON.stringify(out).includes('123'), false);
});
test('route mismatch cannot execute', async () => {
    const i = input(); i.routeInput.entityType = 'coil';
    let calls = 0;
    const out = await runReadExecutionShadow(i, { env, execute: async () => { calls++; return result(); } });
    assert.equal(calls, 0); assert.equal(out.reasonCodes[0], 'CONTROLLED_RUNTIME_DENIED');
});
test('wrong result cannot be a verified success', async () => {
    const out = await runReadExecutionShadow(input(), { env, execute: async () => result('other'), compare: () => 'MISMATCH' });
    assert.equal(out.executionStatus, 'SUCCESS'); assert.equal(out.verificationStatus, 'FAIL'); assert.equal(out.resultComparison, 'MISMATCH');
});
test('unverified formal source fails evidence', async () => {
    const out = await runReadExecutionShadow(input(), { env, execute: async () => ({ ...result(), executionEvidence: null }) });
    assert.equal(out.verificationStatus, 'FAIL');
});
test('Tool/API errors safe and no retry', async () => {
    for (const executor of [async () => { throw new Error('private detail'); }, async () => ({ success: false, error: 'private detail' })]) {
        let calls = 0;
        const out = await runReadExecutionShadow(input(), { env, execute: async () => { calls++; return executor(); } });
        assert.equal(calls, 1); assert.equal(out.executionStatus, 'ERROR'); assert.equal(JSON.stringify(out).includes('private detail'), false);
    }
});
test('timeout aborts once, late completion never produces evidence', async () => {
    let aborted = false;
    const out = await runReadExecutionShadow(input(), { env, timeoutMs: 10, execute: (_, __, options) => new Promise(resolve => {
        options.signal.addEventListener('abort', () => { aborted = true; resolve(result()); });
    }) });
    assert.equal(out.executionStatus, 'TIMEOUT'); assert.equal(aborted, true); assert.equal(out.evidenceCount, 0);
});
test('10 concurrent synthetic read tasks have isolated args/results/state/evidence', async () => {
    const outcomes = await Promise.all(Array.from({ length: 10 }, (_, n) => {
        const i = input(`isolation-${n}`);
        const entity = { ...i.task.entityContext[0], canonicalEntityId: String(100 + n), rawMention: `source-${n}-` };
        i.task = createV5Task({ ...i.task, entityContext: [entity] });
        return runReadExecutionShadow(i, { env, execute: async (_, args, options) => {
            await new Promise(resolve => setTimeout(resolve, 10 - n));
            assert.equal(options.operationId, `isolation-${n}`); assert.equal(args.keyword, `source-${n}-`);
            return result(String(100 + n));
        } });
    }));
    assert.ok(outcomes.every(out => out.verificationStatus === 'PASS' && out.evidenceCount === 1));
});
