const test = require('node:test');
const assert = require('node:assert/strict');
const {
    AiIntentPlanError,
    normalizeIntentPlan,
    planAiIntentV2,
} = require('../api/services/aiIntentPlannerV2.cjs');

function plan(overrides = {}) {
    return {
        goal: '查询采购中的订单数量并给出简报',
        mode: 'query',
        domains: ['order'],
        needsBusinessData: true,
        contextMode: 'current_turn',
        answerShape: 'count_with_brief',
        entityScope: 'collection',
        requiresClarification: false,
        ambiguities: [],
        confidence: 'high',
        steps: [{ capabilityName: 'get_recent_orders', objective: '按状态读取订单' }],
        ...overrides,
    };
}

function structuredPlanResponse(requestOptions, detailedPlan, argumentsOverride) {
    const toolName = requestOptions.toolChoice.function.name;
    const { steps: _steps, ...domainPlan } = detailedPlan;
    const payload = toolName === 'submit_ai_domain_plan' ? domainPlan : detailedPlan;
    return new Response(JSON.stringify({
        choices: [{
            message: {
                tool_calls: [{
                    function: {
                        name: toolName,
                        arguments: argumentsOverride ?? JSON.stringify(payload),
                    },
                }],
            },
        }],
    }), { headers: { 'Content-Type': 'application/json' } });
}

test('V3 意图计划：结构化目标、上下文和能力步骤通过服务端校验', () => {
    const normalized = normalizeIntentPlan(plan());
    assert.equal(normalized.version, 3);
    assert.equal(normalized.mode, 'query');
    assert.equal(normalized.answerShape, 'count_with_brief');
    assert.equal(normalized.entityScope, 'collection');
    assert.deepEqual(normalized.steps.map(step => step.capabilityName), ['get_recent_orders']);
});

test('V2 意图计划：查询轮不能夹带写能力，页面引用必须有真实上下文', () => {
    assert.throws(
        () => normalizeIntentPlan(plan({
            steps: [{ capabilityName: 'create_order', objective: '创建订单' }],
        })),
        AiIntentPlanError
    );
    assert.throws(
        () => normalizeIntentPlan(plan({ contextMode: 'page_context' })),
        /没有页面上下文/
    );
});

test('V2 意图计划：需要澄清时必须说明歧义且不能夹带执行步骤', () => {
    assert.throws(() => normalizeIntentPlan(plan({
        requiresClarification: true,
        ambiguities: [],
        steps: [],
    })), /至少一项具体歧义/);
    assert.throws(() => normalizeIntentPlan(plan({
        requiresClarification: true,
        ambiguities: ['请明确订单'],
    })), /不得规划业务能力步骤/);
    const normalized = normalizeIntentPlan(plan({
        requiresClarification: true,
        ambiguities: ['请明确订单ID'],
        steps: [],
    }));
    assert.equal(normalized.requiresClarification, true);
});

test('V2 意图计划：模型必须通过强制结构化协议提交计划', async () => {
    let requestOptions;
    let requestMessages;
    const requests = [];
    const result = await planAiIntentV2([{ role: 'user', content: '采购中的单子有几个' }], {
        fetchAiProvider: async (messages, options) => {
            requestMessages = messages;
            requestOptions = options;
            requests.push({ messages, options });
            return structuredPlanResponse(options, plan());
        },
    });
    assert.equal(requestOptions.tools.length, 1);
    assert.equal(requestOptions.toolChoice.function.name, 'submit_ai_intent_plan');
    assert.deepEqual(
        Object.keys(requestOptions.tools[0].function.parameters.properties),
        ['steps']
    );
    assert.equal(requestOptions.attachmentMode, 'metadata');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.toolChoice.function.name, 'submit_ai_domain_plan');
    assert.doesNotMatch(requests[0].messages[0].content, /get_recent_orders/);
    assert.match(requests[0].messages[0].content, /是否拆分.*计费.*规则问题/);
    assert.match(requests[0].messages[0].content, /性能测试报告.*属于 recipe 技术档案/);
    assert.match(requests[1].messages[0].content, /只安排 Knowledge/);
    assert.match(requests[1].messages[0].content, /只使用 get_recipe_technical_files/);
    assert.match(requests[0].messages[0].content, /业务域表示回答必须取得的正式证据来源/);
    assert.match(requests[1].messages[0].content, /get_recent_orders/);
    assert.match(requests[1].messages[0].content, /requires=none/);
    assert.match(requests[1].messages[0].content, /requires 由正式 JSON Schema 自动生成/);
    assert.doesNotMatch(requests[1].messages[0].content, /search_parts/);
    assert.match(requestMessages[0].content, /不得用 Preview 代替 List/);
    assert.match(requestMessages[0].content, /上一轮 assistant 已列出正式候选/);
    assert.match(requestMessages[0].content, /不得用知识快照代替现有正式记录/);
    assert.match(requestMessages[0].content, /正式目录主动尝试原词、较短前缀和候选评分/);
    assert.match(requestMessages[0].content, /steps 是当前目标所需事实和起始调查能力/);
    assert.equal(result.steps[0].capabilityName, 'get_recent_orders');
});

test('V2 意图计划：模型首次返回非法 JSON 时协议层自动重试一次', async () => {
    let calls = 0;
    const result = await planAiIntentV2([{ role: 'user', content: '查询采购中订单' }], {
        fetchAiProvider: async (_messages, options) => {
            calls += 1;
            return structuredPlanResponse(
                options,
                plan(),
                options.toolChoice.function.name === 'submit_ai_intent_plan' && calls === 2
                    ? '{bad json'
                    : undefined
            );
        },
    });
    assert.equal(calls, 3);
    assert.equal(result.goal, plan().goal);
});

test('V3 意图计划：多领域能力不会扩大第一阶段确定的业务域信封', () => {
    const normalized = normalizeIntentPlan(plan({
        goal: '试算当前报价中的配方成本',
        domains: ['quotation'],
        entityScope: 'single',
        steps: [{ capabilityName: 'preview_recipe_cost', objective: '读取正式成本试算' }],
    }), {
        allowedDomains: ['quotation'],
        allowedCapabilityNames: ['preview_recipe_cost'],
    });
    assert.deepEqual(normalized.domains, ['quotation']);
});

test('V3 两阶段规划：详细计划不能越过目标信封选择其他业务域能力', async () => {
    await assert.rejects(
        () => planAiIntentV2([{ role: 'user', content: '查询采购中订单' }], {
            fetchAiProvider: async (_messages, options) => structuredPlanResponse(
                options,
                options.toolChoice.function.name === 'submit_ai_domain_plan'
                    ? plan({ domains: ['order'] })
                    : plan({
                        domains: ['catalog'],
                        steps: [{ capabilityName: 'search_parts', objective: '越域读取零件' }],
                    })
            ),
        }),
        /本阶段未下发能力/
    );
});

test('V3 两阶段规划：第二阶段只采纳能力步骤，目标信封始终由服务端继承', async () => {
    const result = await planAiIntentV2([{ role: 'user', content: '查询采购中订单' }], {
        fetchAiProvider: async (_messages, options) => structuredPlanResponse(
            options,
            options.toolChoice.function.name === 'submit_ai_domain_plan'
                ? plan({ domains: ['order'] })
                : plan({
                    goal: '模型尝试改写目标',
                    mode: 'analysis',
                    domains: ['catalog'],
                    answerShape: 'explanation',
                    entityScope: 'global',
                    steps: [{ capabilityName: 'get_recent_orders', objective: '按状态读取订单' }],
                })
        ),
    });
    assert.equal(result.goal, plan().goal);
    assert.equal(result.mode, plan().mode);
    assert.deepEqual(result.domains, plan().domains);
    assert.equal(result.answerShape, plan().answerShape);
    assert.equal(result.entityScope, plan().entityScope);
    assert.deepEqual(result.steps.map(step => step.capabilityName), ['get_recent_orders']);
});

test('V3 意图计划：用户明确要求知识依据时补齐只读知识步骤且不放宽其他工具', async () => {
    const providerPlan = plan({
        goal: '核对切割泵壳的正式用途记录',
        domains: ['catalog'],
        steps: [{ capabilityName: 'search_parts', objective: '查询切割相关零件' }],
    });
    const result = await planAiIntentV2([{
        role: 'user',
        content: '先使用 search_factory_knowledge 查询业务规则，再说明哪些泵壳明确用于切割。',
    }], {
        fetchAiProvider: async (_messages, options) => structuredPlanResponse(options, providerPlan),
    });
    assert.deepEqual(
        result.steps.map(step => step.capabilityName),
        ['search_parts', 'search_factory_knowledge']
    );
    assert.ok(result.domains.includes('knowledge'));
    assert.equal(result.needsBusinessData, true);
});

test('V3 意图计划：用户明确拒绝知识检索时不自动追加知识步骤', async () => {
    const result = await planAiIntentV2([{
        role: 'user',
        content: '不要查知识库，只查询当前零件库里的切割泵壳。',
    }], {
        fetchAiProvider: async (_messages, options) => structuredPlanResponse(options, plan({
            domains: ['catalog'],
            steps: [{ capabilityName: 'search_parts', objective: '查询切割泵壳' }],
        })),
    });
    assert.deepEqual(result.steps.map(step => step.capabilityName), ['search_parts']);
});

test('V3 意图计划：用途与兼容性问题即使模型漏规划也补齐知识证据', async () => {
    const result = await planAiIntentV2([{
        role: 'user',
        content: '说明哪些泵壳明确用于切割工况。',
    }], {
        fetchAiProvider: async (_messages, options) => structuredPlanResponse(options, plan({
            goal: '查询切割泵壳',
            domains: ['catalog'],
            steps: [{ capabilityName: 'search_parts', objective: '查询切割泵壳' }],
        })),
    });
    assert.deepEqual(
        result.steps.map(step => step.capabilityName),
        ['search_parts', 'search_factory_knowledge']
    );
});

test('V2 意图计划：单订单目标禁止使用全局经营和准备总览', () => {
    for (const capabilityName of [
        'get_order_readiness_overview',
        'get_business_alerts',
        'get_management_action_center',
        'get_dashboard_summary',
    ]) {
        assert.throws(() => normalizeIntentPlan(plan({
            goal: '查询叶总订单有什么问题',
            entityScope: 'single',
            steps: [{
                capabilityName,
                objective: '读取全局信息',
            }],
        })), new RegExp(`能力 ${capabilityName} 不支持 single 对象范围`));
    }
});
