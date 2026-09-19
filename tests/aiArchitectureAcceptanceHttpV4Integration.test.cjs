const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

if (process.env.NODE_ENV !== 'test' || !process.env.PUMP_TEST_DATABASE_PATH) {
    throw new Error('aiArchitectureAcceptanceHttpV4Integration 必须使用隔离测试数据库');
}

const costRouter = require('../api/routes/cost.cjs');
const coilsRouter = require('../api/routes/coils.cjs');
const partsRouter = require('../api/routes/parts.cjs');
const recipesRouter = require('../api/routes/recipes.cjs');
const templatesRouter = require('../api/routes/templates.cjs');
const { db, stopBackupScheduler } = require('../api/db.cjs');
const { runAiAgentRuntimeV3 } = require('../api/services/aiAgentRuntimeV3.cjs');
const {
    createArchitectureAcceptanceCase,
    runArchitectureAcceptanceSuite,
} = require('../api/services/aiArchitectureAcceptanceV4.cjs');

async function startFormalApi(t) {
    const app = express();
    app.use(express.json());
    app.use('/api', costRouter);
    app.use('/api/coils', coilsRouter);
    app.use('/api/parts', partsRouter);
    app.use('/api/recipes', recipesRouter);
    app.use('/api/templates', templatesRouter);
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(async () => {
        server.closeAllConnections?.();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });
    return `http://127.0.0.1:${server.address().port}`;
}

function providerResponse(message) {
    return new Response(JSON.stringify({ choices: [{ message }] }), {
        headers: { 'Content-Type': 'application/json' },
    });
}

function plannerCall(name, value) {
    return providerResponse({
        tool_calls: [{
            id: name,
            type: 'function',
            function: { name, arguments: JSON.stringify(value) },
        }],
    });
}

function currentPartIntent() {
    return {
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
    };
}

test('isolated HTTP oracle：同一配方 current cost 与 saved snapshot 即使数值相等仍是不同 Fact', async t => {
    const baseUrl = await startFormalApi(t);
    const recipeName = 'R4A-current-saved-isolation';
    const partInsert = db.prepare(`
        INSERT INTO parts (model, category, price, supplier, stock, remark, created_at, updated_at)
        VALUES ('R4A手工配置', 'R4A', 3.5, 'R4A隔离测试', 0, '', datetime('now'), datetime('now'))
    `).run();
    const inserted = db.prepare(`
        INSERT INTO recipes (
            name, spec, parts_json, extra_parts_json, saved_total_cost, assembly_wage,
            packing_wage, surface_treatment_cost, management_fee, created_at, updated_at
        ) VALUES (?, 'R4A', '[]', '[{"model":"R4A手工配置","qty":1,"snapshotPrice":3.5,"costSource":"manual"}]', 1, 7.25, 0, 0, 0, datetime('now'), datetime('now'))
    `).run(recipeName);
    const recipeId = String(inserted.lastInsertRowid);
    t.after(() => {
        db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
        db.prepare('DELETE FROM parts WHERE id = ?').run(partInsert.lastInsertRowid);
    });

    const currentResponse = await fetch(`${baseUrl}/api/recipes/current-costs`).then(response => response.json());
    assert.equal(currentResponse.success, true, JSON.stringify(currentResponse));
    const current = currentResponse.data.items.find(item => String(item.recipeId) === recipeId);
    assert.ok(current?.costComplete, JSON.stringify(current));
    db.prepare('UPDATE recipes SET saved_total_cost = ? WHERE id = ?')
        .run(current.currentTotalCost, recipeId);
    const savedResponse = await fetch(`${baseUrl}/api/recipes`).then(response => response.json());
    const saved = savedResponse.data.find(item => String(item.id) === recipeId);
    assert.equal(saved.savedTotalCost, current.currentTotalCost);
    const previousPort = process.env.PORT;
    process.env.PORT = new URL(baseUrl).port;
    t.after(() => { process.env.PORT = previousPort; });
    const userQuestion = `${recipeName} 的当前成本与保存成本快照是否相同`;
    const intent = {
        goal: '比较指定配方当前成本与保存成本快照',
        mode: 'analysis',
        domains: ['recipe', 'cost'],
        needsBusinessData: true,
        contextMode: 'current_turn',
        answerShape: 'comparison',
        entityScope: 'single',
        requiresClarification: false,
        ambiguities: [],
        confidence: 'high',
        steps: [
            { capabilityName: 'preview_recipe_cost', objective: '读取正式当前成本' },
            { capabilityName: 'get_recipe_detail', objective: '读取正式保存成本快照' },
        ],
    };
    let finalRendererCalls = 0;
    const provider = async (_messages, options = {}) => {
        const forced = options.toolChoice?.function?.name;
        if (forced === 'submit_ai_domain_plan') {
            const { steps: _steps, ...domain } = intent;
            return plannerCall('submit_ai_domain_plan', domain);
        }
        if (forced === 'submit_ai_intent_plan') return plannerCall('submit_ai_intent_plan', intent);
        if (Array.isArray(options.tools) && options.tools.length > 0) {
            const name = options.tools[0].function.name;
            return providerResponse({ content: '', tool_calls: [{
                id: `r4a-${name}`,
                type: 'function',
                function: { name, arguments: JSON.stringify({ recipeName }) },
            }] });
        }
        finalRendererCalls += 1;
        throw new Error('两个 Claim 的 comparison 应保持确定性输出');
    };
    const runtimeResult = await runAiAgentRuntimeV3({
        messages: [{ role: 'user', content: userQuestion }],
        fetchAiProvider: provider,
        agentVersion: 3,
        env: {
            AI_READ_INVESTIGATION_V4_ENABLED: 'true',
            AI_CLAIM_GROUNDING_V4_ENABLED: 'true',
        },
    });
    assert.equal(runtimeResult.investigationState.status, 'completed', JSON.stringify({
        behaviorEvents: runtimeResult.behaviorEvents,
        investigationState: runtimeResult.investigationState,
    }));
    assert.equal(runtimeResult.claims.length, 2);
    assert.equal(finalRendererCalls, 0);
    const currentClaim = runtimeResult.claims.find(claim => claim.scenario === 'current_recipe_cost');
    const savedClaim = runtimeResult.claims.find(claim => claim.scenario === 'saved_recipe_snapshot');
    assert.equal(currentClaim.value, savedClaim.value);
    assert.notEqual(currentClaim.claimIdentity, savedClaim.claimIdentity);

    const acceptance = createArchitectureAcceptanceCase({
        caseKey: 'http-current-cost-vs-saved-snapshot',
        domain: 'cost',
        userQuestion,
        mode: 'analysis',
        entityScope: 'single',
        oracleBuilder: async () => ({ status: 'ready', current, saved }),
        requiredFacts: [
            { entityType: 'recipe', predicate: 'currentRecipeCost', temporalScope: 'current', scenario: 'current_recipe_cost' },
            { entityType: 'recipe', predicate: 'savedRecipeCostSnapshot', temporalScope: 'saved_snapshot', scenario: 'saved_recipe_snapshot' },
        ],
        expectedClaims: async ({ oracle }) => [
            {
                claimType: 'scalar_value',
                subject: { entityType: 'recipe', entityId: recipeId },
                predicate: 'cost.current.recipe',
                value: oracle.current.currentTotalCost,
                unit: 'CNY',
                temporalScope: 'current',
                scenario: 'current_recipe_cost',
                evidenceClasses: ['live_business'],
                sourceOfTruth: 'costEngine',
            },
            {
                claimType: 'scalar_value',
                subject: { entityType: 'recipe', entityId: recipeId },
                predicate: 'cost.saved.snapshot',
                value: oracle.saved.savedTotalCost,
                unit: 'CNY',
                temporalScope: 'saved_snapshot',
                scenario: 'saved_recipe_snapshot',
                evidenceClasses: ['live_business'],
                sourceOfTruth: 'recipeServiceAndCostEngine',
            },
        ],
        allowedCapabilityClasses: ['query', 'preview'],
        optionalAllowedCapabilities: [],
        forbiddenSubstitutions: ['full_calculate'],
        requiredEvidenceClasses: ['live_business'],
        terminalState: 'completed',
        semanticRequirements: {},
        writeBoundary: 'read_only',
        freshness: {},
    });
    const report = await runArchitectureAcceptanceSuite({
        cases: [acceptance],
        executeCase: () => ({
            investigationState: runtimeResult.investigationState,
            entityScope: 'single',
            claims: runtimeResult.claims,
            evidenceLedger: runtimeResult.evidenceLedger,
            observations: runtimeResult.investigationState.observations,
            behaviorLog: runtimeResult.behaviorEvents,
            capabilityTrace: runtimeResult.toolResults.map(item => item.name),
            answerPlan: runtimeResult.answerPlan,
            answerRendering: runtimeResult.answerRendering,
            finalContent: runtimeResult.finalContent,
        }),
    });
    assert.equal(report.passed, true, JSON.stringify(report.cases[0]));
    assert.equal(report.metrics.dynamicOracleAgreementRate.rate, 1);
});

test('800平刀切割泵壳：正式 HTTP 动态 oracle 的 Evidence 在后续无关拒绝后仍可回答', async t => {
    const baseUrl = await startFormalApi(t);
    const previousPort = process.env.PORT;
    process.env.PORT = new URL(baseUrl).port;
    t.after(() => { process.env.PORT = previousPort; });
    const model = '800平刀切割泵壳';
    db.prepare('DELETE FROM parts WHERE model = ?').run(model);
    const inserted = db.prepare(`
        INSERT INTO parts (model, category, price, supplier, stock, remark, created_at, updated_at)
        VALUES (?, '泵壳', ?, 'R4A隔离测试', 0, '', datetime('now'), datetime('now'))
    `).run(model, 137.42);
    const partId = String(inserted.lastInsertRowid);
    t.after(() => db.prepare('DELETE FROM parts WHERE id = ?').run(partId));

    const formalResponse = await fetch(
        `${baseUrl}/api/parts?keyword=${encodeURIComponent(model)}`
    ).then(response => response.json());
    const formalPart = formalResponse.data.find(item => String(item.id) === partId);
    assert.ok(formalPart);
    const [coilResponse, templateResponse, recipeResponse] = await Promise.all([
        fetch(`${baseUrl}/api/coils`).then(response => response.json()),
        fetch(`${baseUrl}/api/templates?shellModel=${encodeURIComponent(model)}`).then(response => response.json()),
        fetch(`${baseUrl}/api/recipes?keyword=${encodeURIComponent(model)}`).then(response => response.json()),
    ]);
    const targetMention = '800平刀切割泵壳现在多少钱';
    let finalRendererCalls = 0;
    let irrelevantToolProposed = false;
    const provider = async (_messages, options = {}) => {
        const forced = options.toolChoice?.function?.name;
        if (forced === 'submit_ai_domain_plan') {
            const { steps: _steps, ...domain } = currentPartIntent();
            return plannerCall('submit_ai_domain_plan', domain);
        }
        if (forced === 'submit_ai_intent_plan') {
            return plannerCall('submit_ai_intent_plan', currentPartIntent());
        }
        if (Array.isArray(options.tools) && options.tools.length > 0) {
            const name = options.tools[0].function.name;
            if (name !== 'search_parts' && !irrelevantToolProposed) {
                irrelevantToolProposed = true;
                return providerResponse({ content: '', tool_calls: [{
                    id: 'r4a-irrelevant-tool',
                    type: 'function',
                    function: { name: 'get_dashboard_summary', arguments: '{}' },
                }] });
            }
            const args = name === 'search_parts'
                ? { keyword: model }
                : name === 'search_templates'
                    ? { shellModel: model }
                    : name === 'get_all_recipes'
                        ? { keyword: model }
                        : {};
            return providerResponse({ content: '', tool_calls: [{
                id: `r4a-${name}`,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
            }] });
        }
        finalRendererCalls += 1;
        throw new Error('direct deterministic answer 不应调用 final renderer');
    };
    const runtimeResult = await runAiAgentRuntimeV3({
        messages: [{ role: 'user', content: targetMention }],
        fetchAiProvider: provider,
        agentVersion: 3,
        env: {
            AI_READ_INVESTIGATION_V4_ENABLED: 'true',
            AI_CLAIM_GROUNDING_V4_ENABLED: 'true',
        },
    });
    assert.equal(runtimeResult.investigationState.status, 'completed');
    assert.equal(runtimeResult.answerRendering, 'deterministic');
    assert.equal(finalRendererCalls, 0);

    const acceptance = createArchitectureAcceptanceCase({
        caseKey: 'dynamic-800-evidence-survives-later-behavior',
        domain: 'part',
        userQuestion: targetMention,
        mode: 'query',
        entityScope: 'single',
        oracleBuilder: async () => ({
            status: 'ready',
            part: formalPart,
            competingDomains: {
                coil: coilResponse.data || [],
                template: templateResponse.data || [],
                recipe: recipeResponse.data || [],
            },
        }),
        requiredFacts: [
            { entityType: 'part', predicate: 'currentScalar', scenario: 'catalog_current' },
            ...['coil', 'template', 'recipe'].map(entityType => ({
                entityType,
                predicate: 'ambiguity',
                scenario: entityType === 'template' ? 'template_current' : `${entityType}_current`,
            })),
        ],
        expectedClaims: async ({ oracle }) => {
            assert.equal(oracle.competingDomains.coil.length, 0);
            assert.equal(oracle.competingDomains.template.length, 0);
            assert.equal(oracle.competingDomains.recipe.length, 0);
            return [{
                claimType: 'scalar_value',
                subject: { entityType: 'part', entityId: String(oracle.part.id) },
                predicate: 'price.current',
                value: oracle.part.price,
                unit: 'CNY',
                temporalScope: 'current',
                scenario: 'catalog_current',
                evidenceClasses: ['live_business'],
                sourceOfTruth: 'partsService',
            }, ...[
                ['coil', 'coil_current', 'coilService'],
                ['template', 'template_current', 'recipeService'],
                ['recipe', 'recipe_current', 'recipeService'],
            ].map(([entityType, scenario, sourceOfTruth]) => ({
                claimType: 'status',
                subject: { entityType, entityId: null },
                predicate: 'entity_match.disambiguated',
                value: 'no_competing_entity_match',
                unit: null,
                temporalScope: 'current',
                scenario,
                qualifiers: { targetMention },
                evidenceClasses: ['verified_negative'],
                sourceOfTruth,
            }))];
        },
        allowedCapabilityClasses: ['query'],
        optionalAllowedCapabilities: [],
        forbiddenSubstitutions: ['get_dashboard_summary'],
        requiredEvidenceClasses: ['live_business'],
        terminalState: 'completed',
        semanticRequirements: { evidencePreserved: true },
        writeBoundary: 'read_only',
        freshness: {},
    });
    const report = await runArchitectureAcceptanceSuite({
        cases: [acceptance],
        executeCase: () => ({
            investigationState: runtimeResult.investigationState,
            entityScope: 'single',
            claims: runtimeResult.claims,
            evidenceLedger: runtimeResult.evidenceLedger,
            observations: runtimeResult.investigationState.observations,
            behaviorLog: runtimeResult.behaviorEvents,
            capabilityTrace: runtimeResult.toolResults.map(item => item.name),
            answerPlan: runtimeResult.answerPlan,
            answerRendering: runtimeResult.answerRendering,
            finalContent: runtimeResult.finalContent,
        }),
    });
    assert.equal(report.passed, true, JSON.stringify(report.cases[0]));
    assert.equal(report.cases[0].checks.evidencePreserved, true);
    assert.equal(irrelevantToolProposed, true);
    assert.ok(runtimeResult.behaviorEvents.some(event => (
        event.type === 'tool_rejected_not_allowed'
        && event.toolName === 'get_dashboard_summary'
    )));
    assert.ok(report.cases[0].behaviorTypes.includes('tool_rejected_not_allowed'));
    assert.equal(runtimeResult.claims.find(claim => claim.claimType === 'scalar_value').value, formalPart.price);
});

test.after(() => {
    stopBackupScheduler();
    costRouter.stopCopperPriceScheduler?.();
});
