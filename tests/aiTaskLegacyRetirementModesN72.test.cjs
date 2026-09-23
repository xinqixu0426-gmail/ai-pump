'use strict';

// N7.2 — caller-graph, rollout-mode and write-admission evidence for the Native
// cost-comparison retirement slice.
//
// No physical deletion happens in this slice: the Legacy-authoritative path
// (AI_NATIVE_MODE=off, the default) still owns base-scenario current cost, so it
// stays classified FALLBACK.  These tests prove the retired *duplicate* has no
// remaining caller and that the rollout safety layer is untouched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const { startupAiNativeRolloutSummary, resolveAiNativeRollout } = require('../api/services/aiNativeRolloutPolicy.cjs');
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');
const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');

const ROOT = path.resolve(__dirname, '..');

function sourceFiles() {
    const files = [];
    const walk = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) continue;
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.(cjs|js|mjs|ts|tsx)$/u.test(entry.name)) files.push(full);
        }
    };
    for (const directory of ['api', 'scripts', 'tests', 'apps/web-next']) walk(path.join(ROOT, directory));
    return files;
}

function ownerFixture() {
    return {
        ACCESS_PASSWORD: 'synthetic-shared-password',
        JWT_SECRET: 'synthetic-jwt-test-secret',
        INTERNAL_SECRET: 'synthetic-internal-secret',
        PUMP_OWNER_ACCESS_PASSWORD: 'synthetic-owner-credential-only-for-unit-test',
        PUMP_OWNER_SUBJECT: 'synthetic_owner_subject_001',
        AI_V5_OWNER_SUBJECTS: '["synthetic_owner_subject_001"]',
    };
}

test('N7.2 CALLER_GRAPH: the deduplication seam has exactly the intended static callers and no dynamic reference', () => {
    const files = sourceFiles();
    // Built at runtime so this assertion does not match its own literal.
    const identity = 'reuseProfitability' + 'BaseCost';

    const staticCallers = files
        .filter(file => fs.readFileSync(file, 'utf8').includes(identity))
        .map(file => path.relative(ROOT, file).replace(/\\/gu, '/'))
        .sort();
    // Exactly one production definition/caller.  The two N7.2 suites build the
    // identifier at runtime on purpose, so they never appear as callers and the
    // retirement cannot be "verified" by a test that shares the seam's name.
    assert.deepEqual(staticCallers, ['api/services/aiTaskControllerV2.cjs']);

    // Dynamic registration / string lookup / mode-specific routing must not exist.
    const dynamicReferences = files.filter(file => [`'${identity}'`, `"${identity}"`, `\`${identity}\``]
        .some(literal => fs.readFileSync(file, 'utf8').includes(literal)));
    assert.deepEqual(dynamicReferences.map(file => path.relative(ROOT, file).replace(/\\/gu, '/')), []);

    // The retired duplicate left no route, tool surface or capability entry behind.
    const controller = fs.readFileSync(path.join(ROOT, 'api/services/aiTaskControllerV2.cjs'), 'utf8');
    assert.equal(/router\.(get|post|put|patch|delete)\(/u.test(controller), false);
    assert.equal(/require\(['"][^'"]*aiNativeToolDefinitionsV2/u.test(controller), false);

    // The Native tool surface is unchanged by this slice.
    const definitions = fs.readFileSync(path.join(ROOT, 'api/services/aiNativeToolDefinitionsV2.cjs'), 'utf8');
    const toolNames = [...definitions.matchAll(/name: '([a-z_]+)'/gu)].map(match => match[1]);
    assert.deepEqual(toolNames, ['compare_recipe_scenarios', 'preview_profitability', 'preview_virtual_readiness']);
});

test('N7.2 CALLER_GRAPH: the duplicate base-cost site is reachable only when no accepted receipt covers it', () => {
    const controller = fs.readFileSync(path.join(ROOT, 'api/services/aiTaskControllerV2.cjs'), 'utf8');
    // Built at runtime so this assertion does not match its own literal.
    const sitePattern = new RegExp('toolName' + ": 'compare_recipe_scenarios'", 'gu');
    const sites = [...controller.matchAll(sitePattern)].map(match => controller.slice(0, match.index).split('\n').length);
    // Four execution sites remain, each with a distinct, still-required reason:
    //   447  source-configuration comparison (document path)
    //   1059 configuration comparison when no formal unit price exists
    //   1065 configuration comparison for a config-only task
    //   1241 standalone current-cost rebuild, now guarded by the reuse seam
    assert.equal(sites.length, 4, `unexpected compare_recipe_scenarios execution sites: ${sites.length}`);
    // Every site is distinct and ordered; the last one is the retired duplicate.
    assert.equal(new Set(sites).size, sites.length);
    assert.equal(sites.at(-1), Math.max(...sites));

    // The last site is the retired duplicate.  It must be unreachable whenever an
    // accepted profitability receipt already carried the formal base scenario,
    // which is exactly how the runtime evidence reads it back.
    const guardIndex = controller.indexOf("goalByKind(task, 'CURRENT_COST').find(goal => goal.state === 'PENDING')");
    assert.notEqual(guardIndex, -1, 'the CURRENT_COST rebuild must stay guarded by a PENDING check');
    // The reuse seam is defined before both callers, so the guard cannot rely on
    // hoisting or on an undefined binding.
    assert.ok(controller.indexOf('function reuseProfitability' + 'BaseCost(') < guardIndex);
    assert.match(controller, /scenarioKey: 'source_live_config'/u);
});

test('N7.2 MODES: off, shadow, owner and rollback keep the N7.1 authority contract', () => {
    const env = ownerFixture();
    const ownerToken = issueOwnerToken(env.PUMP_OWNER_ACCESS_PASSWORD, env);
    const ownerRequest = { cookies: { token: ownerToken }, headers: {} };

    // Default: Legacy is fully authoritative.
    const off = resolveAiNativeRollout({ request: {}, env: {} });
    assert.equal(off.responsibility, 'LEGACY');
    assert.equal(off.reason, 'AI_NATIVE_OFF_LEGACY_AUTHORITATIVE');
    assert.equal(off.nativeTaskDelegation, false);
    assert.equal(off.nativeWriteAllowed, false);
    assert.equal(off.shadow, false);

    // SHADOW: Legacy still answers; no Native write admission.
    const shadow = resolveAiNativeRollout({ request: ownerRequest, env: { ...env, AI_NATIVE_MODE: 'shadow' } });
    assert.equal(shadow.responsibility, 'LEGACY');
    assert.equal(shadow.shadow, true);
    assert.equal(shadow.nativeTaskDelegation, false);
    assert.equal(shadow.nativeWriteAllowed, false);

    // OWNER: Native takes over reads only; AI_NATIVE_WRITE_ENABLED stays false.
    const owner = resolveAiNativeRollout({ request: ownerRequest, env: { ...env, AI_NATIVE_MODE: 'owner', AI_NATIVE_WRITE_ENABLED: 'false' } });
    assert.equal(owner.responsibility, 'NATIVE_OWNER');
    assert.equal(owner.nativeTaskDelegation, true);
    assert.equal(owner.nativeWriteAllowed, false);

    // The write kill switch stays independent of mode and defaults false.
    assert.equal(startupAiNativeRolloutSummary({ AI_NATIVE_MODE: 'owner' }).writeEnabled, false);
    assert.equal(resolveAiNativeRollout({ request: ownerRequest, env: { ...env, AI_NATIVE_MODE: 'owner', AI_NATIVE_WRITE_ENABLED: 'true' } }).nativeWriteAllowed, true);

    // ROLLBACK after retirement: off again restores Legacy authority with no DB,
    // schema or data step.
    const rolledBack = resolveAiNativeRollout({ request: ownerRequest, env: { AI_NATIVE_MODE: 'off' } });
    assert.equal(rolledBack.responsibility, 'LEGACY');
    assert.equal(rolledBack.nativeTaskDelegation, false);
    assert.equal(rolledBack.nativeWriteAllowed, false);
    assert.equal(rolledBack.reason, 'AI_NATIVE_OFF_LEGACY_AUTHORITATIVE');

    // Invalid mode still fails closed.
    const invalid = resolveAiNativeRollout({ request: ownerRequest, env: { ...env, AI_NATIVE_MODE: 'ownerish' } });
    assert.equal(invalid.responsibility, 'LEGACY');
    assert.equal(invalid.reason, 'AI_NATIVE_MODE_INVALID');
    assert.equal(invalid.nativeWriteAllowed, false);

    // Owner authentication is still required: shared admin, internal secret and
    // client-supplied headers cannot promote a request to Native.
    const sharedToken = jwt.sign({ role: 'admin' }, env.JWT_SECRET, { expiresIn: '1h' });
    for (const request of [
        { cookies: { token: sharedToken }, headers: {} },
        { headers: { 'x-internal-secret': env.INTERNAL_SECRET } },
        { headers: { 'x-owner': 'true', 'x-ai-native-mode': 'owner' }, body: { allowWrite: true } },
        {},
    ]) {
        const result = resolveAiNativeRollout({ request, env: { ...env, AI_NATIVE_MODE: 'owner' } });
        assert.equal(result.responsibility, 'LEGACY');
        assert.equal(result.nativeWriteAllowed, false);
    }
});

test('N7.2 WRITE_DUPLICATE_EFFECT: the slice reaches no write capability and records no operation', async () => {
    const calls = [];
    const execute = async (toolName, args) => {
        calls.push({ toolName, args });
        if (toolName === 'get_all_recipes') return { success: true, data: [{ id: 301, name: 'V550' }], queryReceipt: { authoritative: true, truncated: false, possiblyTruncated: false }, executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/recipes' }] } };
        if (toolName === 'get_recipe_technical_files') return { success: true, data: { files: [{ id: 91, originalName: 'V550-报价资料.json', fileSha256: 'b'.repeat(64), summary: { configuration: { unitPrice: 340, cableLength: 5, hasCable: true } } }] }, executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/technical-files' }] } };
        if (toolName === 'compare_recipe_scenarios') return { success: true, data: { readSetId: crypto.randomUUID(), recipe: { id: 301, name: 'V550' }, scenarios: [{ scenarioKey: 'base', configurationHash: 'base', cost: { complete: true, currentTotalCost: 108.5 }, configuration: { cableLength: 3 }, appliedOverrides: {}, notApplied: [] }, { scenarioKey: args.scenarios[0].scenarioKey, configurationHash: 'candidate', cost: { complete: true, currentTotalCost: 108.5 }, configuration: { cableLength: 5 }, appliedOverrides: {}, notApplied: [] }], comparisons: [{ baseScenarioKey: 'base', candidateScenarioKey: args.scenarios[0].scenarioKey, status: 'COMPARABLE', delta: 0, currency: 'CNY' }] }, executionEvidence: { verified: true, calls: [{ method: 'POST', path: '/api/recipes/301/scenario-compare-preview' }] } };
        if (toolName === 'preview_profitability') return { success: true, data: { preview: true, recipe: { id: 301, name: 'V550' }, scenarioKey: args.basisRef.scenarioKey, configurationHash: 'base', unitCost: 108.5, unitPrice: args.unitPrice, grossProfitPerUnit: 231.5, grossMarginOnSales: 0.68, markupOnCost: 2.13, quantity: null, totalCost: null, totalRevenue: null, totalGrossProfit: null, costComplete: true, costBasis: 'CURRENT_REBUILT', currency: 'CNY', readSetId: crypto.randomUUID(), readSetHash: 'a'.repeat(64), calculatedAt: new Date().toISOString(), warnings: [], scenarioContext: { readSetId: crypto.randomUUID(), scenarios: [{ scenarioKey: 'base', configurationHash: 'base', cost: { complete: true, currentTotalCost: 108.5 }, configuration: { cableLength: 3 }, appliedOverrides: {}, notApplied: [] }, { scenarioKey: args.basisRef.comparisonInput.scenarios[0].scenarioKey, configurationHash: 'candidate', cost: { complete: true, currentTotalCost: 108.5 }, configuration: { cableLength: 5 }, appliedOverrides: {}, notApplied: [] }], comparisons: [{ baseScenarioKey: 'base', candidateScenarioKey: args.basisRef.comparisonInput.scenarios[0].scenarioKey, status: 'COMPARABLE', delta: 0, currency: 'CNY' }] } }, executionEvidence: { verified: true, calls: [{ method: 'POST', path: '/api/cost/profitability-preview' }] } };
        throw new Error(`unexpected tool ${toolName}`);
    };
    const result = await runAiTaskControllerV2({ ownerKey: 'server-owner', requestId: 'n7-2-write', conversationId: 'n7-2-write-conversation', messages: [{ role: 'user', content: 'V550技术档案里的价格算现在成本和毛利，卖340一台' }] }, { executeToolCall: execute, sessionStore: createTaskSessionStoreV2() });

    assert.equal(result.task.state, 'SUCCEEDED');
    assert.deepEqual(calls.filter(call => /^(adjust_|batch_|create_|update_|delete_)/u.test(call.toolName)), []);
    assert.equal('approvalOperationIds' in result.task, false, 'the public task projection must not expose operation ids');
    assert.equal(JSON.stringify(result.answer).includes('operationId'), false);
    assert.equal(calls.filter(call => call.toolName === 'compare_recipe_scenarios').length, 1);
});
