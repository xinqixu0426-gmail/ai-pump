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
        requiresClarification: false,
        ambiguities: [],
        confidence: 'high',
        steps: [{ capabilityName: 'get_recent_orders', objective: '按状态读取订单' }],
        ...overrides,
    };
}

test('V2 意图计划：结构化目标、上下文和能力步骤通过服务端校验', () => {
    const normalized = normalizeIntentPlan(plan());
    assert.equal(normalized.version, 2);
    assert.equal(normalized.mode, 'query');
    assert.equal(normalized.answerShape, 'count_with_brief');
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
    assert.match(requestMessages[0].content, /不得用 Preview 代替 List/);
    assert.match(requestMessages[0].content, /不得用知识快照代替现有正式记录/);
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
