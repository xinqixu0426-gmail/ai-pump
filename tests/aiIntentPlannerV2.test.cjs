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
        ['requiredFactIntents', 'steps']
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
    assert.match(requests[1].messages[0].content, /search_parts/);
    assert.equal(
        requests[1].options.tools[0].function.parameters.properties.steps.items.properties.capabilityName.enum.includes('create_part'),
        false
    );
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

test('V3 两阶段规划：查询可跨域选择只读能力但不能选择写能力', async () => {
    const result = await planAiIntentV2([{ role: 'user', content: '查询采购中订单涉及的零件' }], {
        fetchAiProvider: async (_messages, options) => structuredPlanResponse(
            options,
            options.toolChoice.function.name === 'submit_ai_domain_plan'
                ? plan({ domains: ['order'] })
                : plan({
                    domains: ['catalog'],
                    steps: [{ capabilityName: 'search_parts', objective: '跨域读取正式零件' }],
                })
        ),
    });
    assert.deepEqual(result.domains, ['order']);
    assert.deepEqual(result.steps.map(step => step.capabilityName), ['search_parts']);

    await assert.rejects(() => planAiIntentV2([{ role: 'user', content: '查询采购中订单' }], {
        fetchAiProvider: async (_messages, options) => structuredPlanResponse(
            options,
            options.toolChoice.function.name === 'submit_ai_domain_plan'
                ? plan({ domains: ['order'] })
                : plan({ steps: [{ capabilityName: 'create_part', objective: '越权写零件' }] })
        ),
    }), /本阶段未下发能力/);
});

test('V3 受保护写命令忽略模型重复的只读 Fact intent 并保留确认能力边界', async () => {
    const commandRoute = {
        mode: 'command',
        domains: ['coil'],
        preferredCapability: null,
        source: 'explicit_user_command',
    };
    const result = await planAiIntentV2([{ role: 'user', content: '把12-120线圈库存增加100套' }], {
        commandRoute,
        fetchAiProvider: async (_messages, options) => structuredPlanResponse(
            options,
            options.toolChoice.function.name === 'submit_ai_domain_plan'
                ? plan({
                    goal: '调整线圈库存',
                    domains: ['coil'],
                    entityScope: 'single',
                    steps: [],
                })
                : plan({
                    goal: '调整线圈库存',
                    mode: 'command',
                    domains: ['coil'],
                    answerShape: 'confirmation',
                    entityScope: 'single',
                    requiredFactIntents: [{
                        entityType: 'coil',
                        predicate: 'currentInventory',
                        cardinality: 'single',
                        freshness: 'current',
                    }],
                    steps: [{ capabilityName: 'adjust_coil_stock', objective: '生成线圈库存确认卡' }],
                })
        ),
    });
    assert.equal(result.mode, 'command');
    assert.equal(result.answerShape, 'confirmation');
    assert.deepEqual(result.requiredFactIntents, []);
    assert.deepEqual(result.steps.map(step => step.capabilityName), ['adjust_coil_stock']);
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

test('V3 意图计划：完整配置 BOM 覆盖的成本能力不再重复规划', async () => {
    const result = await planAiIntentV2([{
        role: 'user',
        content: 'V750-大脚板-2寸做12-120片，带浮球、木箱和珍珠棉，成本多少？',
    }], {
        fetchAiProvider: async (_messages, options) => structuredPlanResponse(options, plan({
            goal: '计算完整模板配置成本',
            domains: ['recipe', 'cost'],
            entityScope: 'single',
            steps: [
                { capabilityName: 'build_recipe_bom_draft', objective: '生成完整配置 BOM 成本' },
                { capabilityName: 'preview_pump_shell_cost', objective: '再次计算泵壳成本' },
                { capabilityName: 'calculate_coil_cost', objective: '再次计算线圈成本' },
            ],
        })),
    });
    assert.deepEqual(
        result.steps.map(step => step.capabilityName),
        ['build_recipe_bom_draft']
    );
});

test('V3 意图计划：零件当前单价固定使用实时零件目录而不是机筒成本试算', async () => {
    const result = await planAiIntentV2([{
        role: 'user',
        content: '查询800平刀切割泵壳目前的单价，并说明数据来源。',
    }], {
        fetchAiProvider: async (_messages, options) => structuredPlanResponse(options, plan({
            goal: '查询泵壳单价',
            domains: ['catalog', 'cost'],
            entityScope: 'single',
            steps: [{ capabilityName: 'preview_pump_shell_cost', objective: '试算泵壳成本' }],
        })),
    });
    assert.deepEqual(result.steps.map(step => step.capabilityName), ['search_parts']);
});

test('V3 意图计划：相关零件现在多少钱只保留零件目录查询', async () => {
    const result = await planAiIntentV2([{
        role: 'user',
        content: 'V1600相关零件有哪些？我主要想知道泵壳现在多少钱。',
    }], {
        fetchAiProvider: async (_messages, options) => structuredPlanResponse(options, plan({
            goal: '查询 V1600 相关零件和当前泵壳价格',
            domains: ['recipe', 'catalog'],
            entityScope: 'collection',
            steps: [
                { capabilityName: 'get_all_recipes', objective: '查询相近配方' },
                { capabilityName: 'get_recipe_detail', objective: '读取相近配方详情' },
                { capabilityName: 'search_parts', objective: '查询零件目录' },
                { capabilityName: 'search_templates', objective: '查询相近模板' },
            ],
        })),
    });
    assert.deepEqual(result.steps.map(step => step.capabilityName), ['search_parts']);
});

test('V3 意图计划：零件当前价格不会被第一阶段误判为成本口径澄清', async () => {
    const result = await planAiIntentV2([{
        role: 'user',
        content: 'V1600相关零件有哪些？我主要想知道泵壳现在多少钱。',
    }], {
        fetchAiProvider: async (_messages, options) => structuredPlanResponse(
            options,
            options.toolChoice.function.name === 'submit_ai_domain_plan'
                ? plan({
                    goal: '查询 V1600 泵壳价格',
                    domains: ['recipe', 'catalog'],
                    entityScope: 'collection',
                    requiresClarification: true,
                    ambiguities: ['需要确认零件单价还是配方成本'],
                    steps: [],
                })
                : plan({
                    goal: '查询 V1600 相关零件和当前泵壳价格',
                    domains: ['recipe', 'catalog'],
                    entityScope: 'collection',
                    steps: [
                        { capabilityName: 'get_recipe_detail', objective: '读取相近配方详情' },
                        { capabilityName: 'search_parts', objective: '查询零件目录' },
                    ],
                })
        ),
    });
    assert.equal(result.requiresClarification, false);
    assert.deepEqual(result.ambiguities, []);
    assert.deepEqual(result.steps.map(step => step.capabilityName), ['search_parts']);
});

test('V3 意图计划：业务变更问题不再附带读取当前全量业务列表', async () => {
    const result = await planAiIntentV2([{
        role: 'user',
        content: '系统里有哪些修改过的配方？分别改了什么？',
    }], {
        fetchAiProvider: async (_messages, options) => structuredPlanResponse(options, plan({
            goal: '查询修改过的配方及变更内容',
            domains: ['recipe', 'business_history'],
            entityScope: 'collection',
            steps: [
                { capabilityName: 'search_business_changes', objective: '读取配方变更记录' },
                { capabilityName: 'get_all_recipes', objective: '读取全部当前配方' },
            ],
        })),
    });
    assert.deepEqual(result.steps.map(step => step.capabilityName), ['search_business_changes']);
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
