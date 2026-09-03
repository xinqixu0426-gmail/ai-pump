const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

if (process.env.NODE_ENV !== 'test' || !process.env.PUMP_TEST_DATABASE_PATH) {
    throw new Error('aiEvidenceArchitecture 必须使用 PUMP_TEST_DATABASE_PATH 隔离测试数据库');
}

const {
    classifyObservationOutcome,
    createBehaviorEvent,
    createEvidenceLedger,
    createEvidenceRecord,
    createObservation,
    observationFromToolResult,
} = require('../api/services/aiObservationV3.cjs');
const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const { executeToolCall } = require('../api/routes/ai/executor.cjs');
const partsRouter = require('../api/routes/parts.cjs');
const { db, stopBackupScheduler } = require('../api/db.cjs');

function providerResponse(message) {
    return new Response(JSON.stringify({ choices: [{ message }] }), {
        headers: { 'Content-Type': 'application/json' },
    });
}

function planResponse(plan) {
    return providerResponse({
        tool_calls: [{
            id: 'intent-plan',
            type: 'function',
            function: {
                name: 'submit_ai_intent_plan',
                arguments: JSON.stringify(plan),
            },
        }],
    });
}

function twoStagePlanningProvider(provider) {
    let cachedIntentData = null;
    return async (messages, options = {}) => {
        const requestedTool = options?.toolChoice?.function?.name;
        if (requestedTool === 'submit_ai_intent_plan' && cachedIntentData) {
            const data = cachedIntentData;
            cachedIntentData = null;
            return new Response(JSON.stringify(data), {
                headers: { 'Content-Type': 'application/json' },
            });
        }
        const response = await provider(messages, options);
        if (requestedTool !== 'submit_ai_domain_plan') return response;
        const data = await response.json();
        const intentCall = data?.choices?.[0]?.message?.tool_calls?.find(item => (
            item?.function?.name === 'submit_ai_intent_plan'
        ));
        if (!intentCall) return new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
        });
        cachedIntentData = data;
        const { steps: _steps, ...domainPlan } = JSON.parse(intentCall.function.arguments);
        return providerResponse({
            tool_calls: [{
                id: 'domain-plan',
                type: 'function',
                function: {
                    name: 'submit_ai_domain_plan',
                    arguments: JSON.stringify(domainPlan),
                },
            }],
        });
    };
}

test('BehaviorEvent 永远不能进入 Evidence Ledger', () => {
    const ledger = createEvidenceLedger();
    const behavior = createBehaviorEvent('tool_rejected_not_allowed', {
        toolName: 'search_quotes',
    });
    assert.throws(() => ledger.append(behavior), /只接受 EvidenceRecord/);
    assert.deepEqual(ledger.snapshot(), []);
});

test('全部 BehaviorEvent 类型都不能直接或间接晋升为 Evidence', () => {
    const ledger = createEvidenceLedger();
    for (const type of [
        'tool_schema_rejected',
        'duplicate_call_suppressed',
        'plan_drift',
        'budget_exceeded',
        'tool_rejected_not_allowed',
    ]) {
        const behavior = createBehaviorEvent(type, { toolName: 'search_parts' });
        assert.throws(() => ledger.append(behavior), /只接受 EvidenceRecord/);
        assert.throws(() => createEvidenceRecord({
            kind: 'live_business',
            observation: behavior,
        }), /必须来自 Observation/);
        assert.equal(ledger.appendObservation(behavior), null);
    }
    assert.deepEqual(ledger.snapshot(), []);
});

test('Observation 确定性区分正式结果和技术失败', () => {
    const cases = [
        [{ result: { success: true, data: [{ id: 1 }] } }, 'success_non_empty'],
        [{ result: { success: true, data: [] } }, 'success_empty'],
        [{ result: { success: false, code: 'AI_RESOURCE_NOT_FOUND' } }, 'resource_not_found'],
        [{ result: { success: false, code: 'AI_RESOURCE_AMBIGUOUS' } }, 'ambiguous'],
        [{ result: { success: false, code: 'BUSINESS_RULE_REJECTED', statusCode: 422 } }, 'business_rule_rejected'],
        [{ result: { success: false, code: 'AI_REQUEST_TIMEOUT' } }, 'timeout'],
        [{ result: { success: false, code: 'AI_PROVIDER_NETWORK_ERROR' } }, 'transport_failure'],
        [{ result: { success: false, code: 'INTERNAL_API_PROTOCOL_FAILURE' } }, 'protocol_failure'],
        [{ result: { success: false, code: 'AI_REQUEST_CANCELLED' } }, 'cancelled'],
    ];
    for (const [input, expected] of cases) {
        assert.equal(classifyObservationOutcome(input), expected);
    }
});

test('Evidence Ledger append-only 且只有同 Fact 的更新权威版本可 supersede', () => {
    const ledger = createEvidenceLedger();
    const observation = createObservation({
        attempted: true,
        outcome: 'success_non_empty',
        capabilityName: 'search_parts',
        factKey: 'part:800-shell-price',
        verified: true,
        sourceOfTruth: 'partsService',
        authorityVersion: 1,
        result: { executionEvidence: { verified: true, kind: 'formal_api_query' } },
    });
    const first = ledger.append(createEvidenceRecord({
        kind: 'live_business',
        observation,
        toolResult: { name: 'search_parts', result: observation.result },
    }));
    const unrelated = createObservation({
        attempted: true,
        outcome: 'success_non_empty',
        capabilityName: 'search_templates',
        factKey: 'template:800-shell',
        verified: true,
        sourceOfTruth: 'templateService',
        authorityVersion: 9,
        result: { executionEvidence: { verified: true, kind: 'formal_api_query' } },
    });
    const unrelatedRecord = ledger.appendObservation(unrelated, {
        toolResult: { name: 'search_templates', result: unrelated.result },
    });
    const newer = createObservation({
        ...observation,
        attempted: true,
        authorityVersion: 2,
    });
    const newerRecord = ledger.appendObservation(newer, {
        toolResult: { name: 'search_parts', result: newer.result },
    });

    assert.equal(ledger.snapshot().length, 3);
    assert.equal(unrelatedRecord.supersedesEvidenceId, null);
    assert.equal(newerRecord.supersedesEvidenceId, first.evidenceId);
    assert.equal(ledger.activeRecords().length, 2);
    assert.equal(first.authorityVersion, 1);

    const forged = ledger.append(createEvidenceRecord({
        kind: 'live_business',
        observation: unrelated,
        evidenceId: 'forged-id',
        supersedesEvidenceId: first.evidenceId,
        toolResult: { name: 'search_templates', result: unrelated.result },
    }));
    assert.equal(forged.evidenceId, 'evidence-4');
    assert.equal(forged.supersedesEvidenceId, null);
    assert.ok(ledger.activeRecords().some(item => item.evidenceId === newerRecord.evidenceId));

    const mutableResult = { data: [{ price: 87.35 }] };
    const immutableObservation = createObservation({
        attempted: true,
        outcome: 'success_non_empty',
        capabilityName: 'search_parts',
        factKey: 'part:immutable-price',
        verified: true,
        sourceOfTruth: 'partsService',
        authorityVersion: 1,
        result: mutableResult,
    });
    const immutableRecord = ledger.append(createEvidenceRecord({
        kind: 'live_business',
        observation: immutableObservation,
        toolResult: { name: 'search_parts', result: mutableResult },
    }));
    mutableResult.data[0].price = 999;
    assert.equal(immutableRecord.toolResult.result.data[0].price, 87.35);
});

test('技术失败和未执行拒绝不能升级为 verified_negative', () => {
    const ledger = createEvidenceLedger();
    for (const code of [
        'AI_REQUEST_TIMEOUT',
        'AI_PROVIDER_NETWORK_ERROR',
        'INTERNAL_API_PROTOCOL_FAILURE',
    ]) {
        const observation = observationFromToolResult('search_parts', {}, {
            success: false,
            code,
        });
        assert.equal(ledger.appendObservation(observation), null);
    }
    assert.throws(() => createObservation({
        outcome: 'resource_not_found',
        capabilityName: 'search_parts',
    }), /实际尝试/);
    const forgedEmpty = createObservation({
        attempted: true,
        outcome: 'success_empty',
        capabilityName: 'search_parts',
        verified: true,
        result: { success: true, data: [], executionEvidence: { verified: true } },
    });
    assert.throws(() => createEvidenceRecord({
        kind: 'live_business',
        observation: forgedEmpty,
    }), /正式证据语义一致/);
    const forgedTimeout = createObservation({
        attempted: true,
        outcome: 'timeout',
        capabilityName: 'search_parts',
        verified: true,
        result: { success: false, code: 'AI_REQUEST_TIMEOUT' },
    });
    assert.throws(() => createEvidenceRecord({
        kind: 'live_business',
        observation: forgedTimeout,
    }), /正式证据语义一致/);
    assert.deepEqual(ledger.snapshot(), []);
});

test('失败 Observation 不能 supersede 已有效的正式 Evidence', () => {
    const ledger = createEvidenceLedger();
    const factKey = 'part:800-shell:current-price';
    const success = createObservation({
        attempted: true,
        outcome: 'success_non_empty',
        capabilityName: 'search_parts',
        factKey,
        verified: true,
        sourceOfTruth: 'partsService',
        authorityVersion: 7,
        result: {
            success: true,
            data: [{ id: 800, price: 87.35 }],
            executionEvidence: { verified: true, kind: 'formal_api_query' },
        },
    });
    const validEvidence = ledger.appendObservation(success, {
        toolResult: { name: 'search_parts', result: success.result },
    });
    const failures = ['timeout', 'transport_failure', 'protocol_failure'].map(outcome => (
        createObservation({
            attempted: true,
            outcome,
            capabilityName: 'search_parts',
            factKey,
            verified: false,
            sourceOfTruth: 'partsService',
            authorityVersion: 8,
            result: { success: false, code: outcome.toUpperCase() },
        })
    ));

    for (const failure of failures) {
        assert.equal(ledger.appendObservation(failure), null);
    }
    assert.deepEqual(failures.map(item => item.outcome), [
        'timeout',
        'transport_failure',
        'protocol_failure',
    ]);
    assert.equal(ledger.snapshot().length, 1);
    assert.equal(ledger.activeRecords().length, 1);
    assert.equal(ledger.activeRecords()[0].evidenceId, validEvidence.evidenceId);
    assert.equal(ledger.activeRecords()[0].supersedesEvidenceId, null);
});

test('同 capability 和 sourceOfTruth 的不同实体不能互相 supersede', () => {
    const ledger = createEvidenceLedger();
    const records = [
        { entityId: 800, factKey: 'part:800:current-price', version: 1 },
        { entityId: 801, factKey: 'part:801:current-price', version: 99 },
    ].map(item => {
        const observation = createObservation({
            attempted: true,
            outcome: 'success_non_empty',
            capabilityName: 'search_parts',
            factKey: item.factKey,
            verified: true,
            sourceOfTruth: 'partsService',
            authorityVersion: item.version,
            result: {
                success: true,
                data: [{ id: item.entityId, category: '泵壳', price: 87.35 }],
                executionEvidence: { verified: true, kind: 'formal_api_query' },
            },
        });
        return ledger.appendObservation(observation, {
            toolResult: { name: 'search_parts', result: observation.result },
        });
    });

    assert.equal(records[0].capabilityName, records[1].capabilityName);
    assert.equal(records[0].sourceOfTruth, records[1].sourceOfTruth);
    assert.equal(records[0].supersedesEvidenceId, null);
    assert.equal(records[1].supersedesEvidenceId, null);
    assert.equal(ledger.activeRecords().length, 2);
});

test('当前配方成本与已保存成本快照属于不同业务 Fact', () => {
    const ledger = createEvidenceLedger();
    const scenarios = [
        { factKey: 'recipe:42:cost:current', version: 2, totalCost: 108.6 },
        { factKey: 'recipe:42:cost:saved_snapshot', version: 200, totalCost: 102.4 },
    ];
    const records = scenarios.map(scenario => {
        const observation = createObservation({
            attempted: true,
            outcome: 'success_non_empty',
            capabilityName: 'preview_recipe_cost',
            factKey: scenario.factKey,
            verified: true,
            sourceOfTruth: 'recipeCostService',
            authorityVersion: scenario.version,
            result: {
                success: true,
                data: { recipeId: 42, currentTotalCost: scenario.totalCost },
                executionEvidence: { verified: true, kind: 'formal_api_query' },
            },
        });
        return ledger.appendObservation(observation, {
            toolResult: { name: 'preview_recipe_cost', result: observation.result },
        });
    });

    assert.notEqual(records[0].factKey, records[1].factKey);
    assert.equal(records[0].supersedesEvidenceId, null);
    assert.equal(records[1].supersedesEvidenceId, null);
    assert.equal(ledger.activeRecords().length, 2);
});

test('executor 失败元数据可被 Observation 确定性分类', async t => {
    const previousPort = process.env.PORT;
    let responseMode = 'transport';
    const app = express();
    app.get('/api/parts', (_request, response) => {
        if (responseMode === 'transport') {
            return response.status(503).json({ success: false, error: 'temporary unavailable' });
        }
        if (responseMode === 'timeout') {
            return response.status(504).json({ success: false, error: 'gateway timeout' });
        }
        return response.status(200).type('text/plain').send('not-json');
    });
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    process.env.PORT = String(server.address().port);
    t.after(async () => {
        process.env.PORT = previousPort;
        server.closeAllConnections?.();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });

    const outcomes = [];
    for (const mode of ['transport', 'timeout', 'protocol']) {
        responseMode = mode;
        const result = await executeToolCall('search_parts', { keyword: 'failure-probe' });
        outcomes.push(observationFromToolResult('search_parts', { keyword: 'failure-probe' }, result).outcome);
    }
    assert.deepEqual(outcomes, ['transport_failure', 'timeout', 'protocol_failure']);
});

test('evidence_survives_later_behavior_error', async t => {
    const previousPort = process.env.PORT;
    const price = 87.35;
    const insert = db.prepare(`
        INSERT INTO parts (model, category, price, supplier, stock, remark, created_at, updated_at)
        VALUES (?, '泵壳', ?, 'R1隔离测试', 0, '', datetime('now'), datetime('now'))
    `).run('800平刀切割泵壳', price);
    const app = express();
    app.use(express.json());
    app.use('/api/parts', partsRouter);
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    process.env.PORT = String(server.address().port);
    t.after(async () => {
        db.prepare('DELETE FROM parts WHERE id = ?').run(insert.lastInsertRowid);
        process.env.PORT = previousPort;
        server.closeAllConnections?.();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });

    const formalResponse = await fetch(
        `http://127.0.0.1:${server.address().port}/api/parts?keyword=${encodeURIComponent('800平刀切割泵壳')}`
    ).then(response => response.json());
    const expectedPrice = formalResponse.data.find(item => (
        item.id === Number(insert.lastInsertRowid)
    )).price;
    let providerCalls = 0;
    const provider = twoStagePlanningProvider(async (_messages, options) => {
        providerCalls += 1;
        if (providerCalls === 1) {
            return planResponse({
                goal: '查询指定泵壳当前价格',
                mode: 'query',
                domains: ['catalog'],
                needsBusinessData: true,
                contextMode: 'current_turn',
                answerShape: 'direct',
                entityScope: 'single',
                requiresClarification: false,
                ambiguities: [],
                confidence: 'high',
                steps: [{ capabilityName: 'search_parts', objective: '读取正式当前价格' }],
            });
        }
        if (providerCalls === 2) {
            return providerResponse({ content: '', tool_calls: [{
                id: 'empty-query',
                type: 'function',
                function: {
                    name: 'search_parts',
                    arguments: JSON.stringify({ keyword: '800平刀切割泵壳', category: '不存在分类' }),
                },
            }] });
        }
        if (providerCalls === 3) {
            assert.ok(options.tools.some(tool => tool.function.name === 'search_parts'));
            return providerResponse({ content: '', tool_calls: [{
                id: 'successful-query',
                type: 'function',
                function: {
                    name: 'search_parts',
                    arguments: JSON.stringify({ keyword: '800平刀切割泵壳' }),
                },
            }, {
                id: 'later-unrelated-rejection',
                type: 'function',
                function: { name: 'search_quotes', arguments: '{}' },
            }] });
        }
        assert.deepEqual(options.tools, []);
        return providerResponse({
            content: `800平刀切割泵壳当前正式价格为 ${expectedPrice} 元。`,
        });
    });

    const result = await runAiDispatcherV3({
        messages: [{ role: 'user', content: '800平刀切割泵壳现在多少钱' }],
        fetchAiProvider: provider,
    });

    assert.match(result.finalContent, new RegExp(String(expectedPrice)));
    assert.deepEqual(result.observations.map(item => item.outcome), [
        'success_empty',
        'success_non_empty',
    ]);
    assert.equal(result.evidenceLedger.length, 2);
    assert.ok(result.evidenceLedger.some(item => item.kind === 'live_business'));
    assert.ok(result.behaviorEvents.some(item => (
        item.type === 'tool_rejected_not_allowed' && item.toolName === 'search_quotes'
    )));
    assert.ok(!result.toolResults.some(item => item.name === 'search_quotes'));
    assert.ok(!result.evidenceLedger.some(item => item.capabilityName === 'search_quotes'));
    assert.doesNotMatch(result.finalContent, /没有取得正式业务 API/);
});

test.after(() => {
    stopBackupScheduler();
});
