const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.NODE_ENV !== 'test' || !process.env.PUMP_TEST_DATABASE_PATH) {
    throw new Error('aiReadInvestigationRuntimeV4Integration 必须使用隔离测试数据库');
}

const { runAiAgentRuntimeV3 } = require('../api/services/aiAgentRuntimeV3.cjs');

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

function firstPrice(result) {
    const rows = [result.data, result.parts, result.items].find(Array.isArray) || [];
    return rows[0]?.price;
}

test('V4 enabled：空观察后继续同 Fact 调查并以 FactState 完成', async t => {
    const previousFetch = global.fetch;
    let formalCalls = 0;
    global.fetch = async url => {
        const value = new URL(String(url));
        formalCalls += 1;
        if (['/api/coils', '/api/templates', '/api/recipes'].includes(value.pathname)) {
            return new Response(JSON.stringify({ success: true, data: [] }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (value.pathname !== '/api/parts') throw new Error(`unexpected URL: ${value}`);
        const empty = value.searchParams.get('keyword') === '800平刀';
        return new Response(JSON.stringify({
            success: true,
            data: empty ? [] : [{ id: 808, model: '800平刀切割泵壳', price: 87.35 }],
        }), { headers: { 'Content-Type': 'application/json' } });
    };
    t.after(() => { global.fetch = previousFetch; });

    let runtimeRounds = 0;
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
            runtimeRounds += 1;
            const capabilityName = options.tools[0].function.name;
            const argumentsByCapability = {
                search_coils: {},
                search_templates: { shellModel: '800平刀切割泵壳' },
                get_all_recipes: { keyword: '800平刀切割泵壳' },
            };
            return providerResponse({
                content: '',
                tool_calls: [{
                    id: `parts-${runtimeRounds}`,
                    type: 'function',
                    function: {
                        name: capabilityName,
                        arguments: JSON.stringify(capabilityName === 'search_parts'
                            ? (runtimeRounds === 1
                                ? { keyword: '800平刀' }
                                : { keyword: '800平刀切割泵壳' })
                            : argumentsByCapability[capabilityName]),
                    },
                }],
            });
        }
        return providerResponse({ content: '800平刀切割泵壳当前正式价格为 87.35 元。' });
    };

    const result = await runAiAgentRuntimeV3({
        messages: [{ role: 'user', content: '800平刀切割泵壳现在多少钱' }],
        fetchAiProvider: provider,
        agentVersion: 3,
        env: { AI_READ_INVESTIGATION_V4_ENABLED: 'true' },
    });

    assert.equal(runtimeRounds, 5);
    assert.equal(formalCalls, 5);
    assert.deepEqual(result.observations.map(item => item.outcome), [
        'success_empty',
        'success_non_empty',
        'success_empty',
        'success_empty',
        'success_empty',
    ]);
    assert.match(result.finalContent, /87\.35/);
});

test('V4 enabled：planner 只给首个实体时仍执行跨实体探测并对同名对象澄清', async t => {
    const previousFetch = global.fetch;
    const formalPaths = [];
    global.fetch = async url => {
        const value = new URL(String(url));
        formalPaths.push(value.pathname);
        const data = value.pathname === '/api/parts'
            ? [{ id: 901, model: '800平刀切割泵壳', price: 87.35 }]
            : value.pathname === '/api/templates'
                ? [{ id: 902, shellModel: '800平刀切割泵壳' }]
                : [];
        return new Response(JSON.stringify({ success: true, data }), {
            headers: { 'Content-Type': 'application/json' },
        });
    };
    t.after(() => { global.fetch = previousFetch; });

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
            return providerResponse({
                content: '',
                tool_calls: [{
                    id: `probe-${name}`,
                    type: 'function',
                    function: { name, arguments: JSON.stringify(args) },
                }],
            });
        }
        return providerResponse({ content: '不应基于单一实体直接回答价格。' });
    };

    const result = await runAiAgentRuntimeV3({
        messages: [{ role: 'user', content: '800平刀切割泵壳现在多少钱' }],
        fetchAiProvider: provider,
        agentVersion: 3,
        env: { AI_READ_INVESTIGATION_V4_ENABLED: 'true' },
    });

    assert.deepEqual(formalPaths, ['/api/parts', '/api/coils', '/api/templates']);
    assert.equal(result.observations.at(-1).outcome, 'ambiguous');
    assert.match(result.finalContent, /不同业务对象/);
    assert.doesNotMatch(result.finalContent, /87\.35/);
});

test('V4 enabled：正式 API 技术失败直接终止为 failed_unverified', async t => {
    const previousFetch = global.fetch;
    let formalCalls = 0;
    let runtimeRounds = 0;
    global.fetch = async () => {
        formalCalls += 1;
        return new Response(JSON.stringify({ success: false, error: 'upstream timeout' }), {
            status: 504,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    t.after(() => { global.fetch = previousFetch; });

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
            runtimeRounds += 1;
            return providerResponse({ content: '', tool_calls: [{
                id: 'timeout-parts',
                type: 'function',
                function: {
                    name: options.tools[0].function.name,
                    arguments: JSON.stringify({ keyword: '800平刀切割泵壳' }),
                },
            }] });
        }
        throw new Error('failed_unverified 不应进入答案合成或 legacy recovery');
    };

    const result = await runAiAgentRuntimeV3({
        messages: [{ role: 'user', content: '800平刀切割泵壳现在多少钱' }],
        fetchAiProvider: provider,
        agentVersion: 3,
        env: { AI_READ_INVESTIGATION_V4_ENABLED: 'true' },
    });

    assert.equal(result.investigationState.status, 'failed_unverified');
    assert.equal(result.telemetry.outcome, 'failed_unverified');
    assert.equal(runtimeRounds, 1);
    assert.equal(formalCalls, 1);
    assert.match(result.finalContent, /无法验证|未能完成验证|失败/);
});

for (const providerFailure of [
    { label: 'timeout', code: 'AI_PROVIDER_TIMEOUT' },
    { label: 'transport', code: 'AI_PROVIDER_NETWORK' },
    { label: 'protocol', malformedJson: true },
]) {
    test(`V4 provider ${providerFailure.label} 终止为 failed_unverified，不回退旧 V3`, async t => {
        const previousFetch = global.fetch;
        global.fetch = async () => new Response(JSON.stringify({
            success: true,
            data: [{ id: 910, model: '800平刀切割泵壳', price: 89.5 }],
        }), { headers: { 'Content-Type': 'application/json' } });
        t.after(() => { global.fetch = previousFetch; });

        let runtimeRounds = 0;
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
                runtimeRounds += 1;
                if (providerFailure.malformedJson) {
                    return new Response('{not-json', {
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                const error = new Error(`simulated provider ${providerFailure.label}`);
                error.code = providerFailure.code;
                throw error;
            }
            throw new Error('provider failure 不应进入答案合成或 legacy recovery');
        };

        const result = await runAiAgentRuntimeV3({
            messages: [{ role: 'user', content: '800平刀切割泵壳现在多少钱' }],
            fetchAiProvider: provider,
            agentVersion: 3,
            env: { AI_READ_INVESTIGATION_V4_ENABLED: 'true' },
        });

        assert.equal(result.investigationState.status, 'failed_unverified');
        assert.equal(result.fallbackReason, null);
        assert.equal(result.telemetry.outcome, 'failed_unverified');
        assert.equal(runtimeRounds, 1);
        assert.match(result.finalContent, /无法验证|未能完成验证|失败/);
    });
}

test('V4 enabled 但 intent 不符合单实体范围时正常留在 V3，且不标记 internal fallback', async t => {
    const previousFetch = global.fetch;
    let formalCalls = 0;
    global.fetch = async url => {
        const value = new URL(String(url));
        if (value.pathname !== '/api/parts') throw new Error(`unexpected URL: ${value}`);
        formalCalls += 1;
        return new Response(JSON.stringify({
            success: true,
            data: [{ id: 911, model: '800平刀切割泵壳', price: 90.25 }],
        }), { headers: { 'Content-Type': 'application/json' } });
    };
    t.after(() => { global.fetch = previousFetch; });

    let runtimeRounds = 0;
    const collectionPlan = { ...intentPlan(), entityScope: 'collection' };
    const provider = async (_messages, options = {}) => {
        const forced = options.toolChoice?.function?.name;
        if (forced === 'submit_ai_domain_plan') {
            const { steps: _steps, ...domain } = collectionPlan;
            return plannerCall('submit_ai_domain_plan', domain);
        }
        if (forced === 'submit_ai_intent_plan') {
            return plannerCall('submit_ai_intent_plan', collectionPlan);
        }
        if (Array.isArray(options.tools) && options.tools.length > 0) {
            runtimeRounds += 1;
            return providerResponse({ content: '', tool_calls: [{
                id: 'collection-parts',
                type: 'function',
                function: {
                    name: 'search_parts',
                    arguments: JSON.stringify({ keyword: '800平刀切割泵壳' }),
                },
            }] });
        }
        return providerResponse({ content: '找到 1 个泵壳，当前价格为 90.25 元。' });
    };

    const result = await runAiAgentRuntimeV3({
        messages: [{ role: 'user', content: '查找所有 800平刀切割泵壳' }],
        fetchAiProvider: provider,
        agentVersion: 3,
        env: { AI_READ_INVESTIGATION_V4_ENABLED: 'true' },
    });

    assert.equal(Object.hasOwn(result, 'investigationState'), false);
    assert.equal(Object.hasOwn(result, 'fallbackReason'), false);
    assert.equal(Object.hasOwn(result.telemetry, 'fallbackReason'), false);
    assert.equal(runtimeRounds, 1);
    assert.equal(formalCalls, 1);
    assert.match(result.finalContent, /90\.25/);
});

test('V4 flags 默认关闭；shadow 不改变 V3 返回协议或额外执行 capability', async t => {
    const previousFetch = global.fetch;
    let formalCalls = 0;
    global.fetch = async url => {
        const value = new URL(String(url));
        if (value.pathname !== '/api/parts') throw new Error(`unexpected URL: ${value}`);
        formalCalls += 1;
        return new Response(JSON.stringify({
            success: true,
            data: [{ id: 809, model: '800平刀切割泵壳', price: 88.25 }],
        }), { headers: { 'Content-Type': 'application/json' } });
    };
    t.after(() => { global.fetch = previousFetch; });

    const makeProvider = () => async (_messages, options = {}) => {
        const forced = options.toolChoice?.function?.name;
        if (forced === 'submit_ai_domain_plan') {
            const { steps: _steps, ...domain } = intentPlan();
            return plannerCall('submit_ai_domain_plan', domain);
        }
        if (forced === 'submit_ai_intent_plan') {
            return plannerCall('submit_ai_intent_plan', intentPlan());
        }
        if (Array.isArray(options.tools) && options.tools.length > 0) {
            return providerResponse({ content: '', tool_calls: [{
                id: 'parts-once',
                type: 'function',
                function: {
                    name: 'search_parts',
                    arguments: JSON.stringify({ keyword: '800平刀切割泵壳' }),
                },
            }] });
        }
        return providerResponse({ content: '当前正式价格为 88.25 元。' });
    };

    const base = await runAiAgentRuntimeV3({
        messages: [{ role: 'user', content: '800平刀切割泵壳现在多少钱' }],
        fetchAiProvider: makeProvider(),
        agentVersion: 3,
        env: {},
    });
    const shadow = await runAiAgentRuntimeV3({
        messages: [{ role: 'user', content: '800平刀切割泵壳现在多少钱' }],
        fetchAiProvider: makeProvider(),
        agentVersion: 3,
        env: { AI_READ_INVESTIGATION_V4_SHADOW_ENABLED: 'true' },
    });

    assert.equal(formalCalls, 2);
    assert.deepEqual(Object.keys(shadow).sort(), Object.keys(base).sort());
    assert.deepEqual(
        shadow.toolResults.map(item => ({
            name: item.name,
            count: item.result.count,
            price: firstPrice(item.result),
            evidenceKind: item.result.executionEvidence.kind,
        })),
        base.toolResults.map(item => ({
            name: item.name,
            count: item.result.count,
            price: firstPrice(item.result),
            evidenceKind: item.result.executionEvidence.kind,
        }))
    );
    assert.equal(shadow.finalContent, base.finalContent);
    assert.equal(Object.hasOwn(shadow, 'investigationState'), false);
});
