'use strict';

// N7.2 — Legacy responsibility-retirement witness for the Native cost-comparison
// slice "Native 成本比较的跨目录/多方案后处理".
//
// The witness compares the *business contract* of one responsibility slice, not
// source-code shape and not natural-language similarity:
//   capability resolution, canonical identity, formal API calls, evidence
//   provenance, result facts, error class, task/goal state, write admission and
//   the public result.
//
// Slice scope: the formal current-rebuilt cost of the base scenario inside one
// Native task.  The Legacy-authoritative path (AI_NATIVE_MODE=off) still owns
// this responsibility, so it stays classified FALLBACK and is NOT physically
// deleted.  What this slice retires is the *duplicate execution*: one task used
// to ask the formal scenario preview to rebuild the identical base scenario
// twice.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');

// ── business-contract fixture ────────────────────────────────────────────────
// Every value below is what the formal service returns; the controller must not
// invent any of it.
const FORMAL_BASE_COST = 108.5;
const FORMAL_UNIT_PRICE = 340;
const SOURCE_CONFIGURATION = Object.freeze({ unitPrice: FORMAL_UNIT_PRICE, cableLength: 5, hasCable: true });
const SOURCE_COST_PROFIT_QUESTION = 'V550技术档案里的价格算现在成本和毛利，卖340一台';

function verified(data, extra = {}) {
    return { success: true, data, ...extra, executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/formal' }] } };
}

function makeExecutor(options = {}) {
    const calls = [];
    const execute = async (toolName, args, executionOptions) => {
        calls.push({ toolName, args, executionOptions });
        if (toolName === 'get_all_recipes') {
            return verified([{ id: 301, name: 'V550' }], { queryReceipt: { authoritative: true, truncated: false, possiblyTruncated: false } });
        }
        if (toolName === 'get_recipe_technical_files') {
            return verified({ files: [{ id: 91, originalName: 'V550-报价资料.json', fileSha256: 'b'.repeat(64), summary: { configuration: { ...SOURCE_CONFIGURATION } } }] });
        }
        if (toolName === 'compare_recipe_scenarios') {
            const scenario = args.scenarios[0];
            return verified({
                readSetId: crypto.randomUUID(),
                recipe: { id: 301, name: 'V550' },
                scenarios: [
                    { scenarioKey: 'base', configurationHash: 'base-configuration', cost: { complete: true, currentTotalCost: FORMAL_BASE_COST }, configuration: { cableLength: 3 }, appliedOverrides: {}, notApplied: [] },
                    { scenarioKey: scenario.scenarioKey, configurationHash: 'candidate-configuration', cost: { complete: true, currentTotalCost: 108.5 }, configuration: { cableLength: 5 }, appliedOverrides: scenario.overrides, notApplied: [] },
                ],
                comparisons: [{ baseScenarioKey: 'base', candidateScenarioKey: scenario.scenarioKey, status: 'COMPARABLE', delta: 0, currency: 'CNY' }],
            });
        }
        if (toolName === 'preview_profitability') {
            const scenario = args.basisRef.comparisonInput.scenarios[0];
            const readSetId = crypto.randomUUID();
            const baseComplete = options.incompleteBaseCost ? false : true;
            return verified({
                preview: true, profitabilityId: crypto.randomUUID(), recipe: { id: 301, name: 'V550' },
                scenarioKey: args.basisRef.scenarioKey, configurationHash: 'base-configuration',
                unitCost: FORMAL_BASE_COST, unitPrice: args.unitPrice,
                grossProfitPerUnit: FORMAL_UNIT_PRICE - FORMAL_BASE_COST,
                grossMarginOnSales: (FORMAL_UNIT_PRICE - FORMAL_BASE_COST) / FORMAL_UNIT_PRICE,
                markupOnCost: (FORMAL_UNIT_PRICE - FORMAL_BASE_COST) / FORMAL_BASE_COST,
                quantity: args.quantity, totalCost: null, totalRevenue: null, totalGrossProfit: null,
                costComplete: true, costBasis: 'CURRENT_REBUILT', currency: 'CNY',
                readSetId, readSetHash: 'a'.repeat(64), calculatedAt: new Date().toISOString(), warnings: [],
                scenarioContext: {
                    readSetId,
                    scenarios: [
                        { scenarioKey: 'base', configurationHash: 'base-configuration', cost: { complete: baseComplete, currentTotalCost: baseComplete ? FORMAL_BASE_COST : null }, configuration: { cableLength: 3 }, appliedOverrides: {}, notApplied: [] },
                        { scenarioKey: scenario.scenarioKey, configurationHash: 'candidate-configuration', cost: { complete: baseComplete, currentTotalCost: baseComplete ? FORMAL_BASE_COST : null }, configuration: { cableLength: 5 }, appliedOverrides: scenario.overrides, notApplied: [] },
                    ],
                    comparisons: [{ baseScenarioKey: 'base', candidateScenarioKey: scenario.scenarioKey, status: 'COMPARABLE', delta: 0, currency: 'CNY' }],
                },
            });
        }
        throw new Error(`unexpected tool ${toolName}`);
    };
    return { execute, calls };
}

let counter = 0;
function input(text) {
    counter += 1;
    return { ownerKey: 'server-owner', requestId: `n7-2-${counter}`, conversationId: `n7-2-conversation-${counter}`, messages: [{ role: 'user', content: text }] };
}

async function runSlice(options = {}) {
    const fixture = makeExecutor(options);
    const result = await runAiTaskControllerV2(input(SOURCE_COST_PROFIT_QUESTION), { executeToolCall: fixture.execute, sessionStore: createTaskSessionStoreV2() });
    const scenarioCalls = fixture.calls.filter(call => call.toolName === 'compare_recipe_scenarios');
    const profitCall = fixture.calls.find(call => call.toolName === 'preview_profitability');
    const records = {
        requested: fixture.calls.map(call => call.toolName),
        scenarioReads: scenarioCalls.length,
        scenarioKeys: scenarioCalls.flatMap(call => call.args.scenarios.map(scenario => scenario.scenarioKey)),
        profitabilityReads: fixture.calls.filter(call => call.toolName === 'preview_profitability').length,
        unitPrice: profitCall?.args?.unitPrice ?? null,
        goalStates: Object.fromEntries(result.task.goals.map(goal => [goal.kind, goal.state])),
        taskState: result.task.state,
        predicates: result.task.facts.map(fact => fact.key.predicate).sort(),
        facts: result.task.facts,
        toolCalls: result.task.budgetUsage.toolCalls,
        answer: result.answer,
    };
    return { fixture, result, records };
}

test('N7.2 LEGACY_WITNESS: the slice keeps its business contract terms and retires only the duplicate read', async () => {
    const { records } = await runSlice();

    // Contract terms that must NOT change when duplicate execution is removed.
    assert.deepEqual([...new Set(records.requested)].sort(), ['compare_recipe_scenarios', 'get_all_recipes', 'get_recipe_technical_files', 'preview_profitability']);
    assert.equal(records.unitPrice, FORMAL_UNIT_PRICE, 'the source price is still the formal request basis');
    assert.equal(records.taskState, 'SUCCEEDED');
    assert.deepEqual(records.goalStates, { CURRENT_COST: 'VERIFIED', FILE_INSPECT: 'VERIFIED', PROFITABILITY: 'VERIFIED' });
    assert.deepEqual(records.predicates, ['profitability.preview', 'recipe.current_cost']);
    assert.equal(records.profitabilityReads, 1);
    assert.match(records.answer.content, /毛利/u);
    assert.doesNotMatch(records.answer.content, /adjust_|batch_update/u);

    // Capability resolution is unchanged: the same formal capabilities, and the
    // single remaining scenario read is the source-configuration comparison.
    assert.deepEqual(records.scenarioKeys, ['source_live_config']);
    assert.equal(records.scenarioReads, 1, 'the formal base scenario must be read once');
});

test('N7.2 NO_DUPLICATE_EXECUTION: one task issues exactly one formal base-scenario cost read', async () => {
    const { records } = await runSlice();
    const scenarioReads = records.requested.filter(name => name === 'compare_recipe_scenarios').length;
    assert.equal(scenarioReads, 1);
    assert.equal(new Set(records.scenarioKeys).size, records.scenarioKeys.length, `duplicate scenario read: ${records.scenarioKeys.join(',')}`);
    // Underlying formal capability calls for this slice: one source scenario
    // comparison plus one profitability preview.  The retired duplicate was a
    // second base-scenario rebuild for the CURRENT_COST goal.
    const underlying = scenarioReads + records.profitabilityReads;
    assert.equal(underlying, 2);
    assert.equal(records.toolCalls, 5, 'tool budget must not grow from the retirement');
});

test('N7.2 AUTHORITY: current cost is verified from the accepted formal receipt, not from prose', async () => {
    const { result, records } = await runSlice();
    const current = records.facts.find(fact => fact.key.predicate === 'recipe.current_cost');
    assert.ok(current, 'a current-cost fact must exist');
    assert.equal(current.key.entityType, 'recipe');
    assert.equal(current.key.entityId, '301');
    assert.equal(current.key.temporalScope, 'CURRENT');
    assert.equal(current.key.scenarioKey, null);
    assert.equal(current.key.qualifiers.basis, 'CURRENT_REBUILT');
    assert.equal(current.key.qualifiers.unit, 'pump');
    assert.equal(current.key.qualifiers.currency, 'CNY');
    assert.equal(current.evidenceState, 'VERIFIED_POSITIVE');
    assert.equal(current.complete, true);

    // Provenance stays server-owned: the public projection must not leak owner,
    // receipt, pointer, read set or raw model material.
    assert.deepEqual(Object.keys(current).sort(), ['complete', 'evidenceState', 'key', 'planRevision']);
    assert.equal(records.facts.every(fact => Object.hasOwn(fact, 'receiptId') === false), true);
    assert.equal(records.facts.every(fact => Object.hasOwn(fact, 'resultPointer') === false), true);
    assert.equal(Object.hasOwn(result.task, 'ownerKey'), false);

    // CURRENT_COST is VERIFIED while exactly one scenario read happened, and that
    // read was the source-configuration comparison.  The goal can therefore only
    // have been satisfied by the formal base scenario carried in the accepted
    // profitability receipt.  A wrong pointer would have yielded no finite value
    // and left the goal PARTIAL.
    assert.equal(records.goalStates.CURRENT_COST, 'VERIFIED');
    assert.deepEqual(records.scenarioKeys, ['source_live_config']);
});

test('N7.2 FAIL_CLOSED: an incomplete formal base scenario cannot verify current cost', async () => {
    const { records } = await runSlice({ incompleteBaseCost: true });
    // The reuse seam must refuse to assert a fact the formal service did not
    // return, and the goal must not become VERIFIED.
    assert.notEqual(records.goalStates.CURRENT_COST, 'VERIFIED');
    const completeCurrent = records.facts.filter(fact => fact.key.predicate === 'recipe.current_cost' && fact.complete === true);
    assert.deepEqual(completeCurrent, []);
});
