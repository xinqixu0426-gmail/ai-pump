const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

if (process.env.NODE_ENV !== 'test' || !process.env.PUMP_TEST_DATABASE_PATH) {
    throw new Error('aiReadInvestigationV4 必须使用 PUMP_TEST_DATABASE_PATH 隔离测试数据库');
}

const { createObservation } = require('../api/services/aiObservationV3.cjs');
const {
    buildClaimsFromInvestigation,
    validateClaims,
} = require('../api/services/aiClaimGroundingV4.cjs');
const { composeGroundedAnswerV4 } = require('../api/services/aiGroundedAnswerV4.cjs');
const {
    createFactRequirement,
    createInvestigationGoal,
    createInvestigationState,
    factIdentityKey,
} = require('../api/services/aiFactModelV4.cjs');
const {
    authorizeCapabilityCall,
    authorizeResolutionCall,
    selectNextCapability,
} = require('../api/services/aiCapabilityBrokerV4.cjs');
const {
    bindResolvedEntity,
    markCrossEntityAmbiguity,
    reduceObservation,
} = require('../api/services/aiFactReducerV4.cjs');
const {
    createReadInvestigationController,
    goalFromIntent,
    readInvestigationFlags,
    replayReadInvestigationShadow,
} = require('../api/services/aiReadInvestigationRuntimeV4.cjs');
const { executeToolCall } = require('../api/routes/ai/executor.cjs');
const partsRouter = require('../api/routes/parts.cjs');
const coilsRouter = require('../api/routes/coils.cjs');
const { db, stopBackupScheduler } = require('../api/db.cjs');

function verifiedResult(data) {
    return {
        success: true,
        data,
        count: Array.isArray(data) ? data.length : undefined,
        executionEvidence: {
            verified: true,
            kind: 'formal_api_query',
            calls: [{ method: 'GET', path: '/api/test' }],
        },
    };
}

function partGoal(options = {}) {
    const requirement = createFactRequirement({
        identity: {
            entityType: 'part',
            entityId: options.entityId ?? null,
            predicate: options.predicate || 'currentScalar',
            temporalScope: options.temporalScope || 'current',
            scenario: options.scenario || 'catalog_current',
            qualifiers: options.qualifiers || {},
        },
        requiredSourceOfTruth: 'partsService',
    });
    return createInvestigationGoal({
        goalId: options.goalId || 'goal-part',
        goal: '查询指定零件当前价格',
        mode: 'query',
        entityScope: 'single',
        domains: ['catalog'],
        originalTarget: options.originalTarget || '800平刀切割泵壳现在多少钱',
        requirements: [requirement],
    });
}

test('FactIdentity 不包含 capability，实体、时态、场景和 qualifiers 均参与身份', () => {
    const base = {
        entityType: 'recipe',
        entityId: 'recipe-1',
        predicate: 'currentRecipeCost',
        temporalScope: 'current',
        scenario: 'current_recipe_cost',
        qualifiers: { currency: 'CNY' },
    };
    assert.equal(factIdentityKey({ ...base, capabilityName: 'preview_recipe_cost' }), factIdentityKey(base));
    assert.notEqual(factIdentityKey(base), factIdentityKey({ ...base, entityId: 'recipe-2' }));
    assert.notEqual(factIdentityKey(base), factIdentityKey({
        ...base,
        predicate: 'savedRecipeCostSnapshot',
        temporalScope: 'saved_snapshot',
        scenario: 'saved_recipe_snapshot',
    }));
    assert.notEqual(factIdentityKey(base), factIdentityKey({
        ...base,
        qualifiers: { currency: 'USD' },
    }));
});

test('未解析的不同原始目标具有不同 Fact identity，正式绑定后移除临时目标限定', () => {
    const intent = target => goalFromIntent({
        goal: `查询${target}价格`,
        mode: 'query',
        entityScope: 'single',
        targetMentions: [target],
        steps: [{ capabilityName: 'search_parts' }],
    });
    const left = intent('800平刀切割泵壳');
    const right = intent('900平刀切割泵壳');
    assert.notEqual(left.requirements[0].factKey, right.requirements[0].factKey);
    const bound = bindResolvedEntity(
        createInvestigationState({ requirements: left.requirements }),
        left.requirements[0].requirementId,
        { selected: { id: 11 } }
    );
    assert.equal(bound.requirements[0].identity.entityId, '11');
    assert.equal(bound.requirements[0].identity.qualifiers.targetMention, undefined);
});

test('未解析实体保留 null identity，不能用 turnState ID 伪造可信参数', () => {
    const goal = partGoal();
    assert.equal(goal.requirements[0].identity.entityId, null);
    const state = createInvestigationState({
        goalId: goal.goalId,
        requirements: goal.requirements,
    });
    const denied = authorizeCapabilityCall({
        goal,
        state,
        capabilityName: 'search_parts',
        requirementId: goal.requirements[0].requirementId,
        args: { keyword: '800平刀切割泵壳' },
        parameterProvenance: { keyword: 'turn_state' },
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.code, 'UNTRUSTED_PARAMETER_PROVENANCE');

    const declaredByModel = goalFromIntent({
        goal: '查询指定零件当前价格',
        mode: 'query',
        entityScope: 'single',
        requiredFactIntents: [{
            entityType: 'part',
            entityId: 'model-invented-id',
            predicate: 'currentScalar',
            temporalScope: 'current',
            scenario: 'catalog_current',
        }],
    });
    assert.equal(declaredByModel.requirements[0].identity.entityId, null);
});

test('Broker 只选择匹配 Fact/范围/权威的只读能力，planner steps 只是排序提示', () => {
    const goal = partGoal();
    const state = createInvestigationState({ goalId: goal.goalId, requirements: goal.requirements });
    const selected = selectNextCapability({
        goal,
        state,
        planHints: ['create_part', 'search_parts'],
    });
    assert.equal(selected.status, 'selected');
    assert.equal(selected.capabilityName, 'search_parts');

    const mismatch = authorizeCapabilityCall({
        goal,
        state,
        capabilityName: 'preview_recipe_cost',
        requirementId: selected.requirementId,
        args: { recipeName: '800平刀切割泵壳' },
        parameterProvenance: { recipeName: 'original_user' },
    });
    assert.equal(mismatch.code, 'CAPABILITY_FACT_MISMATCH');
});

test('Broker 确定性拒绝不可信参数、原目标漂移、重复调用和预算超限', () => {
    const goal = partGoal();
    const requirementId = goal.requirements[0].requirementId;
    const base = createInvestigationState({ goalId: goal.goalId, requirements: goal.requirements });
    const trusted = authorizeCapabilityCall({
        goal,
        state: base,
        capabilityName: 'search_parts',
        requirementId,
        args: { keyword: '800平刀切割泵壳' },
        parameterProvenance: { keyword: 'original_user' },
    });
    assert.equal(trusted.allowed, true);
    const drift = authorizeCapabilityCall({
        goal,
        state: base,
        capabilityName: 'search_parts',
        requirementId,
        args: { keyword: 'V750' },
        parameterProvenance: { keyword: 'original_user' },
    });
    assert.equal(drift.code, 'ORIGINAL_TARGET_MISMATCH');
    const duplicate = authorizeCapabilityCall({
        goal,
        state: createInvestigationState({
            goalId: goal.goalId,
            requirements: goal.requirements,
            attemptedCalls: [{ signature: trusted.signature }],
        }),
        capabilityName: 'search_parts',
        requirementId,
        args: { keyword: '800平刀切割泵壳' },
        parameterProvenance: { keyword: 'original_user' },
    });
    assert.equal(duplicate.code, 'DUPLICATE_CALL');
    const exhausted = selectNextCapability({
        goal,
        state: createInvestigationState({
            goalId: goal.goalId,
            requirements: goal.requirements,
            budget: { maxCalls: 1, usedCalls: 1 },
        }),
    });
    assert.equal(exhausted.status, 'budget_exhausted');
    const budgetController = createReadInvestigationController({
        goal,
        budget: { maxCalls: 1, usedCalls: 1 },
    });
    assert.equal(budgetController.next().status, 'budget_exhausted');
    assert.equal(budgetController.state().status, 'budget_exhausted');
});

test('实体解析 discovery 必须经 Broker 授权、计入预算并记录 Observation', () => {
    const goal = goalFromIntent({
        goal: '查询 V750 当前配方成本',
        mode: 'query',
        entityScope: 'single',
        domains: ['recipe', 'cost'],
        targetMentions: ['V750'],
        steps: [{ capabilityName: 'preview_recipe_cost' }],
    });
    const controller = createReadInvestigationController({ goal });
    const selected = controller.next();
    const discoveryCall = {
        parentCapabilityName: 'preview_recipe_cost',
        capabilityName: 'get_all_recipes',
        requirementId: selected.requirementId,
        args: { keyword: 'V750' },
        parameterProvenance: { keyword: 'original_user' },
    };
    assert.equal(authorizeResolutionCall({
        ...discoveryCall,
        goal,
        state: controller.state(),
    }).allowed, true);
    const recorded = controller.recordDiscovery({
        ...discoveryCall,
        result: verifiedResult([{ id: 7, name: 'V750' }]),
    });
    assert.equal(recorded.accepted, true);
    assert.equal(recorded.state.budget.usedCalls, 1);
    assert.equal(recorded.state.observations.length, 1);
    assert.equal(recorded.state.requirements[0].status, 'open');
    assert.equal(controller.ledger.activeRecords().length, 0);
});

test('正式成功 Evidence 满足 Fact；后续 Behavior 与技术失败均不能清除它', () => {
    const goal = partGoal();
    const controller = createReadInvestigationController({ goal });
    const selected = controller.next();
    const success = controller.observe({
        capabilityName: selected.capabilityName,
        requirementId: selected.requirementId,
        args: { keyword: '800平刀切割泵壳' },
        parameterProvenance: { keyword: 'original_user' },
        result: verifiedResult([{ id: 1, model: '800平刀切割泵壳', price: 87.35 }]),
    });
    assert.equal(success.state.status, 'completed');
    assert.equal(success.state.requirements[0].status, 'satisfied');
    assert.equal(controller.ledger.activeRecords().length, 1);

    for (const type of ['tool_schema_rejected', 'duplicate_call_suppressed', 'plan_drift', 'budget_exceeded', 'tool_rejected_not_allowed']) {
        controller.reject(type, { toolName: 'unrelated_tool' });
    }
    const timeout = createObservation({
        attempted: true,
        observationId: 'late-timeout',
        outcome: 'timeout',
        capabilityName: 'search_parts',
        factKey: goal.requirements[0].factKey,
        verified: false,
        sourceOfTruth: 'partsService',
    });
    const afterFailure = reduceObservation(controller.state(), { observation: timeout, evidence: null });
    assert.equal(afterFailure.status, 'completed');
    assert.equal(afterFailure.requirements[0].status, 'satisfied');
    assert.equal(afterFailure.observations.at(-1).outcome, 'timeout');
    assert.equal(controller.ledger.activeRecords().length, 1);
});

test('空结果完成为 completed_negative；技术失败为 failed_unverified 而不是未找到', () => {
    const negativeController = createReadInvestigationController({
        goal: partGoal({ goalId: 'negative', predicate: 'verifiedNotFound' }),
    });
    const negativeSelected = negativeController.next();
    const negative = negativeController.observe({
        capabilityName: negativeSelected.capabilityName,
        requirementId: negativeSelected.requirementId,
        args: { keyword: '800平刀切割泵壳' },
        parameterProvenance: { keyword: 'original_user' },
        result: verifiedResult([]),
    });
    assert.equal(negative.state.status, 'completed_negative');
    assert.equal(negative.evidence.kind, 'verified_negative');

    const missingController = createReadInvestigationController({
        goal: partGoal({ goalId: 'not-found', predicate: 'verifiedNotFound' }),
    });
    const missingSelected = missingController.next();
    const missing = missingController.observe({
        capabilityName: missingSelected.capabilityName,
        requirementId: missingSelected.requirementId,
        args: { keyword: '800平刀切割泵壳' },
        parameterProvenance: { keyword: 'original_user' },
        result: {
            success: false,
            code: 'AI_RESOURCE_NOT_FOUND',
            executionEvidence: {
                verified: true,
                kind: 'formal_api_query_failure',
                calls: [{ method: 'GET', path: '/api/parts', outcome: 'not_found' }],
            },
        },
    });
    assert.equal(missing.observation.outcome, 'resource_not_found');
    assert.equal(missing.state.status, 'completed_negative');

    for (const outcome of ['timeout', 'transport_failure', 'protocol_failure', 'cancelled']) {
        const goal = partGoal({ goalId: `failure-${outcome}` });
        const state = createInvestigationState({ goalId: goal.goalId, requirements: goal.requirements });
        const observation = createObservation({
            attempted: true,
            outcome,
            capabilityName: 'search_parts',
            factKey: goal.requirements[0].factKey,
            verified: false,
            sourceOfTruth: 'partsService',
        });
        const failed = reduceObservation(state, { observation, evidence: null });
        assert.equal(failed.status, 'failed_unverified');
        assert.equal(failed.requirements[0].status, 'unavailable');
        assert.notEqual(failed.status, 'completed_negative');
    }
});

test('同名不同实体类型进入 clarification，且不能互相满足', () => {
    const part = createFactRequirement({
        identity: { entityType: 'part', entityId: null, predicate: 'entityIdentity', temporalScope: 'current', scenario: 'catalog_current' },
    });
    const template = createFactRequirement({
        identity: { entityType: 'template', entityId: null, predicate: 'entityIdentity', temporalScope: 'current', scenario: 'template_current' },
    });
    assert.notEqual(part.factKey, template.factKey);
    const state = createInvestigationState({ requirements: [part, template] });
    const ambiguous = createObservation({
        attempted: true,
        outcome: 'ambiguous',
        capabilityName: 'search_parts',
        factKey: part.factKey,
        verified: false,
        result: { resolutionReceipt: { originalMention: '800平刀', candidates: [
            { entityType: 'part', name: '800平刀' },
            { entityType: 'template', name: '800平刀' },
        ] } },
    });
    const next = reduceObservation(state, { observation: ambiguous });
    assert.equal(next.status, 'needs_clarification');
    assert.equal(next.requirements[0].status, 'needs_clarification');
    assert.equal(next.requirements[1].status, 'open');

    const boundPart = bindResolvedEntity(state, part.requirementId, {
        entityType: 'part',
        originalMention: '800平刀',
        selected: { id: 11, name: '800平刀' },
    });
    assert.equal(boundPart.requirements[0].identity.entityId, '11');
    assert.notEqual(boundPart.requirements[0].factKey, part.factKey);
    const crossEntity = markCrossEntityAmbiguity(boundPart, [
        { entityType: 'part', originalMention: '800平刀', selected: { id: 11 } },
        { entityType: 'template', originalMention: '800平刀', selected: { id: 22 } },
    ]);
    assert.equal(crossEntity.status, 'needs_clarification');
    assert.ok(crossEntity.requirements.every(item => item.status === 'needs_clarification'));
});

test('未解析 single 查询的多个同分正式候选进入 clarification，不能直接满足 Fact', () => {
    const goal = goalFromIntent({
        goal: '查询 800平刀切割泵壳价格',
        mode: 'query',
        entityScope: 'single',
        domains: ['catalog'],
        targetMentions: ['800平刀切割泵壳'],
        steps: [{ capabilityName: 'search_parts' }],
    });
    const controller = createReadInvestigationController({ goal });
    const selected = controller.next();
    const observed = controller.observe({
        capabilityName: selected.capabilityName,
        requirementId: selected.requirementId,
        args: { keyword: '800平刀切割泵壳' },
        parameterProvenance: { keyword: 'original_user' },
        result: verifiedResult([
            { id: 11, model: '800平刀切割泵壳', price: 87.35 },
            { id: 12, model: '800平刀切割泵壳', price: 91.2 },
        ]),
    });
    assert.equal(observed.state.status, 'needs_clarification');
    assert.equal(observed.state.requirements[0].status, 'needs_clarification');
    assert.equal(observed.observation.outcome, 'ambiguous');
    assert.equal(observed.evidence, null);
    assert.equal(controller.ledger.activeRecords().length, 0);
});

test('后续跨实体歧义只阻塞 open Fact，不重置已满足 Fact 或已有 Evidence', () => {
    const goal = partGoal({ entityId: '11' });
    const controller = createReadInvestigationController({ goal });
    const selected = controller.next();
    const success = controller.observe({
        capabilityName: selected.capabilityName,
        requirementId: selected.requirementId,
        args: { keyword: '800平刀切割泵壳' },
        parameterProvenance: { keyword: 'original_user' },
        result: verifiedResult([{ id: 11, model: '800平刀切割泵壳', price: 87.35 }]),
    });
    const satisfiedPart = success.state.requirements[0];
    const template = createFactRequirement({
        identity: {
            entityType: 'template',
            entityId: null,
            predicate: 'entityIdentity',
            temporalScope: 'current',
            scenario: 'template_current',
        },
    });
    const before = createInvestigationState({
        requirements: [satisfiedPart, template],
        evidenceIds: success.state.evidenceIds,
        observations: success.state.observations,
    });
    const after = markCrossEntityAmbiguity(before, [
        { entityType: 'part', originalMention: '800平刀', selected: { id: 11 } },
        { entityType: 'template', originalMention: '800平刀', selected: { id: 22 } },
    ]);
    assert.equal(after.status, 'needs_clarification');
    assert.equal(after.requirements[0].status, 'satisfied');
    assert.deepEqual(after.requirements[0].evidenceIds, satisfiedPart.evidenceIds);
    assert.equal(after.requirements[1].status, 'needs_clarification');
    assert.deepEqual(after.evidenceIds, before.evidenceIds);
    assert.equal(controller.ledger.activeRecords().length, 1);
});

test('多步 Fact 调查逐项完成，current recipe cost 与 saved snapshot 独立', () => {
    const intent = {
        goal: '读取配方当前成本和保存快照',
        mode: 'analysis',
        entityScope: 'single',
        domains: ['recipe', 'cost'],
        steps: [
            { capabilityName: 'preview_recipe_cost' },
            { capabilityName: 'get_recipe_detail' },
        ],
    };
    const goal = goalFromIntent(intent, { originalTarget: 'V750' });
    assert.equal(goal.requirements.length, 2);
    assert.notEqual(goal.requirements[0].factKey, goal.requirements[1].factKey);
    assert.equal(goal.requirements[0].identity.scenario, 'current_recipe_cost');
    assert.equal(goal.requirements[1].identity.scenario, 'saved_recipe_snapshot');
});

test('结构化 requiredFactIntents 是事实来源，planner steps 仅提供 broker hint', () => {
    const goal = goalFromIntent({
        goal: '读取线圈当前状态',
        mode: 'query',
        entityScope: 'single',
        domains: ['coil'],
        targetMentions: ['12-120'],
        requiredFactIntents: [{
            entityType: 'coil',
            predicate: 'currentStatus',
            temporalScope: 'current',
            scenario: 'coil_current',
        }],
        steps: [{ capabilityName: 'calculate_coil_cost' }],
    });
    assert.equal(goal.originalTarget, '12-120');
    assert.equal(goal.requirements[0].identity.predicate, 'currentStatus');
    const state = createInvestigationState({ goalId: goal.goalId, requirements: goal.requirements });
    assert.equal(selectNextCapability({
        goal,
        state,
        planHints: ['calculate_coil_cost', 'search_coils'],
    }).capabilityName, 'search_coils');
});

test('feature flags 默认关闭且仅显式 true 开启', () => {
    assert.deepEqual(readInvestigationFlags({}), { enabled: false, shadow: false });
    assert.deepEqual(readInvestigationFlags({
        AI_READ_INVESTIGATION_V4_ENABLED: 'true',
        AI_READ_INVESTIGATION_V4_SHADOW_ENABLED: 'TRUE',
    }), { enabled: true, shadow: true });
});

test('shadow 不重写 Fact 不一致的 Observation/Evidence', () => {
    const intent = {
        goal: '查询指定零件当前价格',
        mode: 'query',
        entityScope: 'single',
        domains: ['catalog'],
        requiredFactIntents: [{
            entityType: 'part',
            predicate: 'currentScalar',
            temporalScope: 'current',
            scenario: 'catalog_current',
        }],
    };
    const observation = createObservation({
        attempted: true,
        observationId: 'shadow-observation',
        outcome: 'success_non_empty',
        capabilityName: 'search_parts',
        factKey: 'source-fact',
        verified: true,
        sourceOfTruth: 'partsService',
        result: verifiedResult([{ id: 1, model: 'A' }]),
    });
    const state = replayReadInvestigationShadow({
        intent,
        originalTarget: 'A',
        observations: [observation],
        evidenceRecords: [{
            evidenceId: 'wrong-evidence',
            observationId: 'shadow-observation',
            factKey: 'different-fact',
            kind: 'live_business',
        }],
    });
    assert.equal(state.status, 'running');
    assert.equal(state.requirements[0].status, 'open');
    assert.equal(state.evidenceIds.length, 0);
});

test('800平刀切割泵壳真实集成：正式 API 动态值形成 Fact Evidence', async t => {
    const previousPort = process.env.PORT;
    const insertedPrice = 80 + Math.round(Math.random() * 1000) / 100;
    const insert = db.prepare(`
        INSERT INTO parts (model, category, price, supplier, stock, remark, created_at, updated_at)
        VALUES (?, '泵壳', ?, 'R2隔离测试', 0, '', datetime('now'), datetime('now'))
    `).run('800平刀切割泵壳', insertedPrice);
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
    const expected = formalResponse.data.find(item => item.id === Number(insert.lastInsertRowid));
    const result = await executeToolCall('search_parts', { keyword: '800平刀切割泵壳' });
    const controller = createReadInvestigationController({ goal: partGoal() });
    const selected = controller.next();
    const observed = controller.observe({
        capabilityName: selected.capabilityName,
        requirementId: selected.requirementId,
        args: { keyword: '800平刀切割泵壳' },
        parameterProvenance: { keyword: 'original_user' },
        result,
    });
    assert.equal(observed.state.status, 'completed');
    assert.equal(observed.evidence.kind, 'live_business');
    const observedParts = observed.evidence.toolResult.result.data
        || observed.evidence.toolResult.result.parts
        || observed.evidence.toolResult.result.items;
    assert.equal(observedParts.find(item => item.id === expected.id).price, expected.price);
    assert.notEqual(expected.price, 95);
});

test('正式 Part/Coil API 库存值物化为同一 numeric Fact contract', async t => {
    const previousPort = process.env.PORT;
    const part = db.prepare(`
        INSERT INTO parts (model, category, price, supplier, stock, remark, created_at, updated_at)
        VALUES (?, '测试件', 1, 'R2.3隔离测试', 0, '', datetime('now'), datetime('now'))
    `).run(`R2.3-part-${Date.now()}`);
    const coil = db.prepare(`
        INSERT INTO coils (spec, sheets, stock, created_at, updated_at)
        VALUES (?, 120, 0, datetime('now'), datetime('now'))
    `).run(`R2.3-coil-${Date.now()}`);
    const app = express();
    app.use(express.json());
    app.use('/api/parts', partsRouter);
    app.use('/api/coils', coilsRouter);
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    process.env.PORT = String(server.address().port);
    t.after(async () => {
        db.prepare('DELETE FROM coils WHERE id = ?').run(coil.lastInsertRowid);
        db.prepare('DELETE FROM parts WHERE id = ?').run(part.lastInsertRowid);
        process.env.PORT = previousPort;
        server.closeAllConnections?.();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });

    for (const item of [
        { entityType: 'part', id: part.lastInsertRowid, capabilityName: 'search_parts', queryKey: 'keyword', unit: '件' },
        { entityType: 'coil', id: coil.lastInsertRowid, capabilityName: 'search_coils', queryKey: 'spec', unit: '套' },
    ]) {
        const target = item.entityType === 'part'
            ? db.prepare('SELECT model FROM parts WHERE id = ?').get(item.id).model
            : db.prepare('SELECT spec FROM coils WHERE id = ?').get(item.id).spec;
        const goal = goalFromIntent({
            goal: '读取当前库存数量',
            mode: 'query',
            entityScope: 'single',
            domains: [item.entityType === 'part' ? 'catalog' : 'coil'],
            targetMentions: [target],
            requiredFactIntents: [{
                entityType: item.entityType,
                predicate: 'inventoryQuantity',
                temporalScope: 'current',
                scenario: 'current_inventory',
            }],
            steps: [{ capabilityName: item.capabilityName }],
        });
        const controller = createReadInvestigationController({ goal });
        const selected = controller.next();
        assert.equal(selected.capabilityName, item.capabilityName);
        const args = { [item.queryKey]: target };
        const result = await executeToolCall(item.capabilityName, args);
        const observed = controller.observe({
            capabilityName: item.capabilityName,
            requirementId: selected.requirementId,
            args,
            parameterProvenance: { [item.queryKey]: 'original_user' },
            result,
        });
        assert.equal(observed.state.status, 'completed', JSON.stringify(observed.state));
        assert.equal(observed.state.numericFacts[0].numericValue, 0);
        assert.equal(observed.state.numericFacts[0].unit, item.unit);
        assert.equal(observed.state.numericFacts[0].subject.entityType, item.entityType);
        assert.deepEqual(observed.state.numericFacts[0].evidenceRefs, [observed.evidence.evidenceId]);
        assert.equal(observed.state.numericFacts[0].authority.kind, 'live_business');
        assert.equal(observed.state.numericFacts[0].authority.sourceOfTruth, observed.evidence.sourceOfTruth);
        const evidenceLedger = controller.ledger.snapshot();
        const claims = buildClaimsFromInvestigation({
            state: observed.state,
            evidenceLedger,
            observations: observed.state.observations,
        });
        assert.equal(claims[0].value, 0);
        assert.equal(claims[0].unit, item.unit);
        assert.equal(claims[0].predicate, 'inventory.quantity');
        assert.equal(validateClaims(claims, {
            requirements: observed.state.requirements,
            state: observed.state,
            evidenceLedger,
            observations: observed.state.observations,
        }).valid, true);
        const answer = await composeGroundedAnswerV4({
            goal: '读取当前库存数量',
            state: observed.state,
            evidenceLedger,
            observations: observed.state.observations,
            answerShape: 'direct',
        });
        assert.equal(answer.rendering, 'deterministic');
        assert.match(answer.content, new RegExp(`0 ${item.unit}`));
    }
});

test.after(() => {
    stopBackupScheduler();
});
