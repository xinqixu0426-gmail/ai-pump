const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

if (process.env.NODE_ENV !== 'test' || !process.env.PUMP_TEST_DATABASE_PATH) {
    throw new Error('aiClaimGroundingRuntimeV4Integration 必须使用隔离测试数据库');
}

const { runAiAgentRuntimeV3 } = require('../api/services/aiAgentRuntimeV3.cjs');
const partsRouter = require('../api/routes/parts.cjs');
const { db, stopBackupScheduler } = require('../api/db.cjs');

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

function intentPlan() {
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

test('800平刀切割泵壳 R3 真实集成：正式 API 动态值直接形成确定性 Claim 答案', async t => {
    const previousPort = process.env.PORT;
    db.prepare('DELETE FROM parts WHERE model = ?').run('800平刀切割泵壳');
    const insertedPrice = 137.42;
    const insert = db.prepare(`
        INSERT INTO parts (model, category, price, supplier, stock, remark, created_at, updated_at)
        VALUES (?, '泵壳', ?, 'R3隔离测试', 0, '', datetime('now'), datetime('now'))
    `).run('800平刀切割泵壳', insertedPrice);

    const app = express();
    app.use(express.json());
    app.use('/api/parts', partsRouter);
    app.get(['/api/coils', '/api/templates', '/api/recipes'], (_request, response) => {
        response.json({ success: true, data: [] });
    });
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
    assert.ok(expected);
    assert.notEqual(expected.price, 95);

    let finalRendererCalls = 0;
    let claimGroundingEnabled = true;
    const provider = async (_messages, options = {}) => {
        const forced = options.toolChoice?.function?.name;
        if (forced === 'submit_ai_domain_plan') {
            const { steps: _steps, ...domain } = intentPlan();
            return plannerCall('submit_ai_domain_plan', domain);
        }
        if (forced === 'submit_ai_intent_plan') {
            return plannerCall('submit_ai_intent_plan', intentPlan());
        }
        if (Array.isArray(options.tools) && options.tools.length > 0) {
            const name = options.tools[0].function.name;
            const args = name === 'search_parts'
                ? { keyword: '800平刀切割泵壳' }
                : name === 'search_templates'
                    ? { shellModel: '800平刀切割泵壳' }
                    : name === 'get_all_recipes'
                        ? { keyword: '800平刀切割泵壳' }
                        : {};
            return providerResponse({ content: '', tool_calls: [{
                id: `r3-${name}`,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
            }] });
        }
        finalRendererCalls += 1;
        if (!claimGroundingEnabled) return providerResponse({ content: 'R2 legacy synthesis marker' });
        throw new Error('简单 Claim 答案不得调用最终 LLM renderer');
    };

    const result = await runAiAgentRuntimeV3({
        messages: [{ role: 'user', content: '800平刀切割泵壳现在多少钱' }],
        fetchAiProvider: provider,
        agentVersion: 3,
        env: {
            AI_READ_INVESTIGATION_V4_ENABLED: 'true',
            AI_CLAIM_GROUNDING_V4_ENABLED: 'true',
        },
    });

    assert.equal(result.investigationState.status, 'completed');
    assert.equal(result.answerRendering, 'deterministic');
    assert.equal(finalRendererCalls, 0);
    assert.equal(result.claims.length, 4);
    const priceClaim = result.claims.find(claim => claim.claimType === 'scalar_value');
    assert.equal(priceClaim.value, expected.price);
    assert.equal(priceClaim.predicate, 'price.current');
    assert.equal(priceClaim.scenario, 'catalog_current');
    assert.match(result.finalContent, new RegExp(`¥${String(expected.price).replace('.', '\\.')}`));

    await t.test('R3 默认关闭时保持原 R2 synthesis 边界', async () => {
        claimGroundingEnabled = false;
        const disabledResult = await runAiAgentRuntimeV3({
            messages: [{ role: 'user', content: '800平刀切割泵壳现在多少钱' }],
            fetchAiProvider: provider,
            agentVersion: 3,
            env: { AI_READ_INVESTIGATION_V4_ENABLED: 'true' },
        });
        assert.equal(disabledResult.investigationState.status, 'completed');
        assert.equal(disabledResult.finalContent, 'R2 legacy synthesis marker');
        assert.equal(disabledResult.claims, undefined);
        assert.equal(disabledResult.answerPlan, undefined);
        assert.equal(disabledResult.answerRendering, undefined);
        assert.equal(finalRendererCalls, 1);
    });
});

test.after(() => {
    stopBackupScheduler();
});
