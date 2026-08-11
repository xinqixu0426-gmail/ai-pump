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
    const result = await planAiIntentV2([{ role: 'user', content: '采购中的单子有几个' }], {
        fetchAiProvider: async (messages, options) => {
            requestMessages = messages;
            requestOptions = options;
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        tool_calls: [{
                            function: {
                                name: 'submit_ai_intent_plan',
                                arguments: JSON.stringify(plan()),
                            },
                        }],
                    },
                }],
            }), { headers: { 'Content-Type': 'application/json' } });
        },
    });
    assert.equal(requestOptions.tools.length, 1);
    assert.equal(requestOptions.toolChoice.function.name, 'submit_ai_intent_plan');
    assert.equal(requestOptions.attachmentMode, 'metadata');
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
        fetchAiProvider: async () => {
            calls += 1;
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        tool_calls: [{
                            function: {
                                name: 'submit_ai_intent_plan',
                                arguments: calls === 1 ? '{bad json' : JSON.stringify(plan()),
                            },
                        }],
                    },
                }],
            }), { headers: { 'Content-Type': 'application/json' } });
        },
    });
    assert.equal(calls, 2);
    assert.equal(result.goal, plan().goal);
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
