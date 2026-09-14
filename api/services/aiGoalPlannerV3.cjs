const {
    DOMAIN_CAPABILITY_NAMES,
    getAiCapability,
} = require('../capabilities/registry.cjs');
const { fetchAiProvider } = require('./aiProvider.cjs');
const {
    DEFAULT_MAX_PLANNER_CAPABILITIES,
    buildDomainDirectoryPrompt,
    buildPlannerDirectoryPrompt,
    orderedPlannerCapabilities,
    plannedCapabilityNames,
} = require('./aiCapabilityCatalogV2.cjs');
const { normalizeProviderUsage } = require('./aiTokenBudget.cjs');
const { resolutionContextPrompt } = require('./aiResourceResolutionV3.cjs');
const { aiTurnStatePrompt } = require('./aiTurnStateV3.cjs');
const {
    CURRENT_INVENTORY_SCENARIO,
    INVENTORY_QUANTITY_PREDICATE,
    normalizeInventoryFactIntent,
} = require('./aiNumericScalarFactsV4.cjs');

// AI V3 的实际目标规划器；V2 文件仅保留兼容导出。
const INTENT_MODES = Object.freeze(['conversation', 'query', 'analysis', 'command']);
const CONTEXT_MODES = Object.freeze(['current_turn', 'previous_turn', 'page_context']);
const ANSWER_SHAPES = Object.freeze([
    'direct',
    'count_with_brief',
    'list',
    'comparison',
    'explanation',
    'confirmation',
]);
const ENTITY_SCOPES = Object.freeze(['none', 'single', 'collection', 'global']);
const DOMAIN_NAMES = Object.freeze(Object.keys(DOMAIN_CAPABILITY_NAMES));

class AiIntentPlanError extends Error {
    constructor(message, code = 'AI_INTENT_PLAN_INVALID', details = {}) {
        super(message);
        this.name = 'AiIntentPlanError';
        this.code = code;
        this.details = details;
    }
}

function latestUserText(messages = []) {
    return [...messages].reverse().find(message => (
        message?.role === 'user' && typeof message.content === 'string'
    ))?.content?.trim() || '';
}

function explicitKnowledgeSearchRequested(value) {
    const text = String(value || '').toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
    if (!text) return false;
    if (/(?:不要|无需|不用|禁止|别).{0,12}(?:search_factory_knowledge|知识库|工厂经验|业务规则)/.test(text)) {
        return false;
    }
    return text.includes('search_factory_knowledge')
        || /(?:查|查询|搜索|检索|使用|调用|根据|依据).{0,12}(?:知识库|工厂经验|业务规则)/.test(text)
        || /(?:知识库|工厂经验|业务规则).{0,12}(?:查|查询|搜索|检索)/.test(text)
        || /(?:哪些|哪个|什么|是否|能否|能不能|可以|怎么|如何|为什么|说明|查询|核对).{0,24}(?:用途|适用|适合|工况|兼容|配套|专用|用来|用于)/.test(text)
        || /(?:用途|适用|适合|工况|兼容|配套|专用|用来|用于).{0,24}(?:哪些|哪个|什么|是否|能否|能不能|可以|怎么|如何|为什么|说明|查询|核对)/.test(text);
}

function enforceExplicitReadRequirements(intent, userText) {
    if (!explicitKnowledgeSearchRequested(userText) || intent.requiresClarification) return intent;
    if (plannedCapabilityNames(intent).includes('search_factory_knowledge')) return intent;
    const capability = getAiCapability('search_factory_knowledge');
    if (
        !capability
        || capability.access !== 'read'
        || intent.steps.length >= 5
        || (
            intent.entityScope !== 'none'
            && !capability.entityScopes.includes(intent.entityScope)
        )
    ) return intent;
    return Object.freeze({
        ...intent,
        mode: intent.mode === 'conversation' ? 'query' : intent.mode,
        needsBusinessData: true,
        domains: Object.freeze([...new Set([...intent.domains, 'knowledge'])]),
        steps: Object.freeze([
            ...intent.steps,
            Object.freeze({
                capabilityName: 'search_factory_knowledge',
                objective: '读取用户明确要求的工厂知识或业务规则依据',
            }),
        ]),
    });
}

function domainPlannerTool() {
    return {
        type: 'function',
        function: {
            name: 'submit_ai_domain_plan',
            description: '提交当前目标所属业务域和风险信封。此阶段不选择具体能力。',
            parameters: {
                type: 'object',
                properties: {
                    goal: { type: 'string' },
                    mode: { type: 'string', enum: INTENT_MODES },
                    domains: { type: 'array', items: { type: 'string', enum: DOMAIN_NAMES }, maxItems: 4 },
                    needsBusinessData: { type: 'boolean' },
                    contextMode: { type: 'string', enum: CONTEXT_MODES },
                    answerShape: { type: 'string', enum: ANSWER_SHAPES },
                    entityScope: { type: 'string', enum: ENTITY_SCOPES },
                    requiresClarification: { type: 'boolean' },
                    ambiguities: { type: 'array', items: { type: 'string' }, maxItems: 3 },
                    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                },
                required: [
                    'goal', 'mode', 'domains', 'needsBusinessData', 'contextMode',
                    'answerShape', 'entityScope', 'requiresClarification', 'ambiguities', 'confidence',
                ],
            },
        },
    };
}

function collapseOverlappingCostSteps(intent) {
    const names = plannedCapabilityNames(intent);
    if (!names.includes('build_recipe_bom_draft')) return intent;
    const coveredByConfiguredBom = new Set([
        'full_calculate',
        'preview_recipe_cost',
        'preview_pump_shell_cost',
        'dynamic_config_cost',
        'calculate_coil_cost',
    ]);
    const steps = intent.steps.filter(step => !coveredByConfiguredBom.has(step.capabilityName));
    if (steps.length === intent.steps.length) return intent;
    return Object.freeze({
        ...intent,
        steps: Object.freeze(steps),
    });
}

function enforceCatalogPartPriceAuthority(intent, userText) {
    const text = String(userText || '').replace(/\s+/g, '');
    const explicitlyAsksCatalog = /零件|配件|物料|目录/.test(text);
    const asksCatalogUnitPrice = /(?:零件|配件|物料|目录|目前|当前)?.{0,12}(?:单价|目录价|零件价格|价钱|多少钱)/.test(text)
        || (explicitlyAsksCatalog && /价格|价钱|多少钱/.test(text));
    const asksConfiguredShellCost = /(?:机筒|筒长|加长).{0,12}\d|\d.{0,8}(?:mm|毫米).{0,8}(?:机筒|筒长|加长)|(?:完整|配置|成品).{0,8}成本/.test(text);
    if (!asksCatalogUnitPrice || asksConfiguredShellCost) return intent;
    const capability = getAiCapability('search_parts');
    if (!capability?.entityScopes.includes(intent.entityScope)) return intent;
    const directCatalogQuestion = explicitlyAsksCatalog && !/(配方|模板)/.test(text);
    const displacedCapabilities = directCatalogQuestion
        ? new Set([
            'preview_pump_shell_cost',
            'get_all_recipes',
            'get_recipe_detail',
            'get_recipe_technical_files',
            'search_templates',
            'get_template_detail',
        ])
        : new Set(['preview_pump_shell_cost']);
    const steps = intent.steps.filter(step => !displacedCapabilities.has(step.capabilityName));
    if (!steps.some(step => step.capabilityName === 'search_parts')) {
        steps.push(Object.freeze({
            capabilityName: 'search_parts',
            objective: '读取零件目录当前单价和来源',
        }));
    }
    return Object.freeze({
        ...intent,
        mode: intent.mode === 'conversation' ? 'query' : intent.mode,
        needsBusinessData: true,
        requiresClarification: false,
        ambiguities: Object.freeze([]),
        domains: Object.freeze([...new Set([...intent.domains, 'catalog'])].slice(0, 4)),
        steps: Object.freeze(steps),
    });
}

function enforceBusinessChangeAuthority(intent, userText) {
    const text = String(userText || '').replace(/\s+/g, '');
    const asksChangeHistory = /修改过|改了什么|变更记录|发生过.{0,8}(?:修改|变更|调整)/.test(text);
    const asksCurrentSnapshot = /(?:目前|当前|现在).{0,8}(?:状态|价格|库存|详情)/.test(text);
    if (!asksChangeHistory || asksCurrentSnapshot || intent.requiresClarification) return intent;
    const capability = getAiCapability('search_business_changes');
    if (!capability?.entityScopes.includes(intent.entityScope)) return intent;
    const displacedCapabilities = new Set([
        'get_all_recipes',
        'get_recent_orders',
        'search_quotations',
        'search_customers',
        'search_templates',
        'search_parts',
        'search_coils',
        'get_management_action_center',
    ]);
    const steps = intent.steps.filter(step => !displacedCapabilities.has(step.capabilityName));
    if (!steps.some(step => step.capabilityName === 'search_business_changes')) {
        steps.push(Object.freeze({
            capabilityName: 'search_business_changes',
            objective: '读取通用业务变更中心的正式变更记录',
        }));
    }
    return Object.freeze({
        ...intent,
        mode: intent.mode === 'conversation' ? 'query' : intent.mode,
        needsBusinessData: true,
        domains: Object.freeze([...new Set([...intent.domains, 'business_history'])].slice(0, 4)),
        steps: Object.freeze(steps),
    });
}

function plannerTool(options = {}) {
    const capabilityNames = orderedPlannerCapabilities(options)
        .slice(0, DEFAULT_MAX_PLANNER_CAPABILITIES)
        .map(capability => capability.name);
    return {
        type: 'function',
        function: {
            name: 'submit_ai_intent_plan',
            description: '提交当前目标信封所需的能力步骤。目标、模式、业务域、回答形态和对象范围由服务端继承，本阶段不得重复提交。',
            parameters: {
                type: 'object',
                properties: {
                    requiredFactIntents: {
                        type: 'array',
                        maxItems: 3,
                        description: '规范业务事实，不填写工具、单位或来源。',
                        items: {
                            type: 'object',
                            properties: {
                                entityType: { type: 'string', enum: ['part', 'coil'] },
                                predicate: { type: 'string', enum: [INVENTORY_QUANTITY_PREDICATE] },
                                temporalScope: { type: 'string', enum: ['current'] },
                                scenario: { type: 'string', enum: [CURRENT_INVENTORY_SCENARIO] },
                            },
                            required: ['entityType', 'predicate', 'temporalScope', 'scenario'],
                        },
                    },
                    steps: {
                        type: 'array',
                        maxItems: 5,
                        items: {
                            type: 'object',
                            properties: {
                                capabilityName: { type: 'string', enum: capabilityNames },
                                objective: { type: 'string' },
                            },
                            required: ['capabilityName', 'objective'],
                        },
                    },
                },
                required: ['requiredFactIntents', 'steps'],
            },
        },
    };
}

function domainPlannerPrompt(pageContext, resolutionContext, turnState) {
    const pageNote = pageContext
        ? `当前页面仅是候选指代：${pageContext.resourceType} #${pageContext.resourceId}，视图 ${pageContext.view}。`
        : '当前没有页面上下文，不得选择 page_context。';
    return `你是 AI 调度器 V3 的目标与风险分类器。只提交业务域信封，不回答用户，不选择具体工具，不输出推理过程。

先判断当前用户真正目标、读写模式、对象范围、上下文来源和最少必要业务域。业务域表示回答必须取得的正式证据来源，不是用户句子里出现过的名词集合；若用户已明确要求用某类权威资料回答语义或规则问题，且没有同时要求当前记录或数值计算，不要因为资料中可能提到客户、报价、成本或文件而扩大到对应业务域。解释一个业务项由什么组成、是否拆分、怎样计费等口径仍属于规则问题，即使句子出现“费用/成本”；只有明确询问当前单价、具体金额或要求数值试算时才增加 catalog/cost。成品型号的性能测试报告、测试曲线和逐条测试点属于 recipe 技术档案，不属于 drawing；型号中的数字、片数或引号不能把它误判为转子出图历史。新的明确问题覆盖旧话题；只有紧邻指代或补充缺参才用 previous_turn。查询“有没有、多少、哪些、状态”属于 query；产生新增、修改、删除或库存变化才属于 command。只有缺少会改变执行目标的关键信息时才要求澄清。业务域最多 4 个，不得因为可能有用而扩大。

${pageNote}

${resolutionContextPrompt(resolutionContext)}

${aiTurnStatePrompt(turnState)}

业务域目录（本阶段没有具体能力名）：
${buildDomainDirectoryPrompt()}`;
}

function plannerPrompt(pageContext, resolutionContext, turnState, domains, domainPlan) {
    const pageNote = pageContext
        ? `当前页面上下文仅是候选指代：${pageContext.resourceType} #${pageContext.resourceId}，视图 ${pageContext.view}。只有用户明确指代当前页面对象时才使用 page_context。`
        : '当前没有页面上下文，不得选择 page_context。';
    return `你是 AI 调度器 V3 的能力规划器。目标与风险信封已经由上一阶段确定。你只提交 requiredFactIntents 和 steps，不重复提交或修改目标、模式、业务域、回答形态和对象范围；不回答用户，不执行工具，不输出推理过程。

服务端固定继承的目标信封：
${JSON.stringify({
        goal: domainPlan.goal,
        mode: domainPlan.mode,
        domains: domainPlan.domains,
        needsBusinessData: domainPlan.needsBusinessData,
        contextMode: domainPlan.contextMode,
        answerShape: domainPlan.answerShape,
        entityScope: domainPlan.entityScope,
    })}

规划原则：
1. 允许口语、简称、疑问句和不规范表达；按语义理解，不按关键词机械匹配。
2. 当前用户明确提出的新业务问题覆盖旧话题。只有省略指代、紧邻追问或补充缺失参数才选择 previous_turn。
3. 需要库存、价格、成本、订单、报价、配方、客户、文件等正式事实时 needsBusinessData=true，并选择最小必要能力步骤。
4. 数量、筛选、计算和执行结果由正式能力提供；不得计划让模型自己计算或编造。
5. command 表示用户要求产生副作用；查询“有没有、多少、哪些、状态”等不是 command。
6. 新增、修改、删除、库存增减等 command 必须选择写能力；服务端之后负责正式预览、确认和回执。
7. 不要为了“了解情况”先读取全量再二次筛选；优先选择能直接表达用户条件的能力。
8. requiresClarification 只在缺少会改变执行目标的关键信息，或已经通过正式候选查询确认存在多个无法安全选择的对象时为 true；此时 ambiguities 必须写清需要用户确认的内容，并且 steps 必须为空。名称、型号、简称或疑似错别字本身不是提前澄清的理由，先交给执行层做只读候选发现。
9. answerShape=count_with_brief 表示先给数量，再给每个命中对象的最短简报；不要扩展成流水账。
10. steps 是当前目标所需事实和起始调查能力，不是不可调整的脚本，最多 5 步。query/analysis 的业务域只用于把更可能的只读能力排在前面，不是读取权限边界；若名称可能同时代表零件、模板、配方或线圈等不同正式对象，应选择最直接的起始 Query，执行层可在正式零结果或已验证资源未找到后做有限次跨域只读调查。系统错误、写操作和跨目标扩展不得这样恢复。command 的业务域仍是硬信封。
11. 先按能力的权威职责选择：已有正式记录的列表、数量、状态和实时库存用领域 Query；指定组合的计算、插值、草稿和差异分析用 Preview；用途、适用工况、兼容性、原因、工厂约定、明确确认关系、业务规则和独立资料必须用 Knowledge，即使同一个问题还询问“系统中有哪些”当前记录，也不能只安排领域 Query。不得用 Preview 代替 List，也不得用知识快照代替现有正式记录。
12. 能力名称相近时比较 description 中的权威职责、适用目标和明确排除项；选择能直接回答目标且能区分关键零结果语义的最小能力，不并列安排职责重复的工具。
13. 用户一个问题包含多个子目标时，逐项判断事实权威来源并为每种不同职责安排必要步骤。例如“当前有哪些正式记录”使用领域 Query，“用途、经验、规则依据、明确确认关系”使用 Knowledge；不能指望执行阶段临时扩搜计划外能力。
14. 用户用客户名、合同号、型号、简称、称呼或疑似错别字指代资源但没有明确提供内部ID时，必须原样保留用户表达并选择支持名称查询的参数。执行层会通过正式目录主动尝试原词、较短前缀和候选评分：只读唯一高置信候选可以透明绑定，多候选必须列出并询问，写操作的模糊候选必须确认。不得由规划器脑补标准名或生成ID。ID只能来自用户明确编号、当前页面资源ID、本轮正式查询结果或紧邻追问携带的结构化正式绑定。
15. 具名客户或合同号的单订单详情、问题、异常和生产情况使用支持 orderQuery 的单订单能力；get_recent_orders 用于列表、数量和跨订单筛选。执行层负责从客户目录或订单目录主动发现正式候选；不要把用户可能输错一个字当成无结果终点。
16. entityScope 必须表达当前目标的对象范围：纯对话用 none；明确一个客户、合同、订单或“这个订单”用 single；要求若干筛选结果用 collection；明确全部、整体、所有订单总览用 global。每项能力目录中的 scope 是硬边界，single 目标不得使用经营异常、管理待办、订单准备总览或运营看板等 collection/global 能力。
17. 用户询问实时价格、库存、成本等正式事实并要求“说明数据来源”时，来源由对应 Query/Preview 的正式回执与 provenance 直接证明，不额外安排 Knowledge。只有用户确实询问独立资料、历史经验、规则依据或语义说明时才增加 Knowledge。
18. 用户首次用型号、简称或关键词查询单个业务对象时，不要因为“可能存在同名对象”提前要求澄清；应先规划最小正式 Query/Preview，让正式 API 返回零个、一个或多个候选。一个候选直接继续，多个候选由执行层列出后再问用户。
19. 如果上一轮 assistant 已列出正式候选，而当前用户用“第一个/第二个”、候选完整名称、后缀、规格或其他可唯一识别的描述作答，必须选择 previous_turn，沿用原目标和原能力，并把用户选中的正式名称或可唯一识别片段传给工具。不得再次泛问“请提供完整名称”，也不得凭序号生成内部 ID。
20. 候选澄清只解决对象绑定，不改变用户原始目标。例如上一轮问成本、这一轮选择具体配方，仍应调用配方成本 Preview；不能退化成只列配方或只读知识库。
21. “今天/最近/某段时间有没有修改、改了什么、为什么修改、哪些业务发生过某类调整”属于 business_history，使用 search_business_changes。它不是当前对象列表、管理待办或一般知识快照；不要改用 get_recent_orders、get_management_action_center 或 search_factory_knowledge 猜测历史。
22. 能力目录中的 requires 由正式 JSON Schema 自动生成。只有用户当前消息、可信页面/上一轮绑定，或更早计划步骤的正式结果能够提供全部必填输入时，才能把该能力列为必要步骤；缺少必填输入时不得抱着“也许有用”的想法追加 Preview 或详情能力。一个 Query 已直接返回目标要求的全部正式字段时，不得再安排职责重叠的 Preview。
23. “由什么组成、是否拆分、计费/收费口径如何”是在解释工厂规则，不等于询问当前零件单价或要求数值成本试算。用户明确要求 Knowledge 且没有索要当前数值时，只安排 Knowledge；不能因为规则文字出现费用、成本、零件或规格就追加 catalog/cost。只有明确询问当前单价、具体金额或给出完整试算输入时才增加相应 Query/Preview。
24. 指定成品型号的性能测试报告、测试曲线、有效测试数据或逐条测试点只使用 get_recipe_technical_files。转子出图历史只回答转子 PDF 出图任务、jobId 和生成记录；不能因为型号中包含数字、片数或引号就用 get_rotor_drawing_history 代替配方技术档案。
25. requiredFactIntents 表达业务事实，不表达工具。查询指定 Part 或 Coil 的当前库存数量时，登记 inventoryQuantity/current/current_inventory；库存状态不是库存数量，不能互相替代。单位和数据权威由服务端正式契约决定，不得填写或猜测。其他尚未进入 Fact 目录的目标保持 requiredFactIntents 为空，由既有 steps 兼容路径处理。

${pageNote}

${resolutionContextPrompt(resolutionContext)}

${aiTurnStatePrompt(turnState)}

可用能力目录：
${buildPlannerDirectoryPrompt({
        domains,
        mode: domainPlan.mode,
        entityScope: domainPlan.entityScope,
        maxCapabilities: DEFAULT_MAX_PLANNER_CAPABILITIES,
    })}`;
}

function parsePlanArguments(message, toolName = 'submit_ai_intent_plan') {
    const call = (message?.tool_calls || []).find(item => (
        item?.function?.name === toolName
    ));
    if (!call) {
        throw new AiIntentPlanError(`模型没有提交结构化计划 ${toolName}`, 'AI_INTENT_PLAN_MISSING');
    }
    try {
        const parsed = JSON.parse(call.function.arguments || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
        return parsed;
    } catch {
        throw new AiIntentPlanError('模型提交的意图计划不是有效 JSON');
    }
}

function assertEnum(value, values, field) {
    if (!values.includes(value)) throw new AiIntentPlanError(`${field} 无效`);
}

function normalizeText(value, field, maxLength = 240) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new AiIntentPlanError(`${field} 不能为空`);
    }
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (normalized.length > maxLength) throw new AiIntentPlanError(`${field} 过长`);
    return normalized;
}

function normalizeIntentPlan(raw, options = {}) {
    assertEnum(raw.mode, INTENT_MODES, 'mode');
    assertEnum(raw.contextMode, CONTEXT_MODES, 'contextMode');
    assertEnum(raw.answerShape, ANSWER_SHAPES, 'answerShape');
    const entityScope = raw.entityScope || 'none';
    assertEnum(entityScope, ENTITY_SCOPES, 'entityScope');
    assertEnum(raw.confidence, ['high', 'medium', 'low'], 'confidence');
    if (typeof raw.needsBusinessData !== 'boolean') {
        throw new AiIntentPlanError('needsBusinessData 必须是布尔值');
    }
    if (typeof raw.requiresClarification !== 'boolean') {
        throw new AiIntentPlanError('requiresClarification 必须是布尔值');
    }
    if (
        !Array.isArray(raw.domains)
        || raw.domains.length > 4
        || raw.domains.some(domain => !DOMAIN_NAMES.includes(domain))
    ) {
        throw new AiIntentPlanError('domains 包含未登记业务域');
    }
    const allowedDomains = new Set(options.allowedDomains || []);
    const allowedCapabilityNames = new Set(options.allowedCapabilityNames || []);
    if (allowedDomains.size > 0 && raw.domains.some(domain => !allowedDomains.has(domain))) {
        throw new AiIntentPlanError('详细计划包含目标信封之外的业务域');
    }
    if (!Array.isArray(raw.steps) || raw.steps.length > 5) {
        throw new AiIntentPlanError('steps 必须是最多 5 项的数组');
    }
    const rawFactIntents = raw.requiredFactIntents || [];
    if (!Array.isArray(rawFactIntents) || rawFactIntents.length > 3) {
        throw new AiIntentPlanError('requiredFactIntents 必须是最多 3 项的数组');
    }
    if (rawFactIntents.length > 0
        && (!['query', 'analysis'].includes(raw.mode) || entityScope !== 'single')) {
        throw new AiIntentPlanError('结构化 Fact intent 仅支持 single Query/Analysis');
    }
    const requiredFactIntents = rawFactIntents.map((item, index) => {
        const normalized = normalizeInventoryFactIntent(item);
        if (!normalized) throw new AiIntentPlanError(`requiredFactIntents[${index}] 未登记`);
        return normalized;
    });
    if (!Array.isArray(raw.ambiguities) || raw.ambiguities.length > 3) {
        throw new AiIntentPlanError('ambiguities 必须是最多 3 项的数组');
    }
    if (raw.requiresClarification && raw.ambiguities.length === 0) {
        throw new AiIntentPlanError('需要澄清时必须说明至少一项具体歧义');
    }
    if (raw.requiresClarification && raw.steps.length > 0) {
        throw new AiIntentPlanError('需要澄清时不得规划业务能力步骤');
    }

    const steps = raw.steps.map((step, index) => {
        const capabilityName = String(step?.capabilityName || '').trim();
        const capability = getAiCapability(capabilityName);
        if (!capability) {
            throw new AiIntentPlanError(`步骤 ${index + 1} 使用了未登记能力 ${capabilityName}`);
        }
        if (allowedCapabilityNames.size > 0 && !allowedCapabilityNames.has(capabilityName)) {
            throw new AiIntentPlanError(`步骤 ${index + 1} 使用了本阶段未下发能力 ${capabilityName}`);
        }
        if (allowedDomains.size > 0 && !capability.domains.some(domain => allowedDomains.has(domain))) {
            throw new AiIntentPlanError(`步骤 ${index + 1} 使用了目标信封之外的能力 ${capabilityName}`);
        }
        if (raw.mode !== 'command' && capability.access === 'write') {
            throw new AiIntentPlanError(`非写意图不得计划写能力 ${capabilityName}`);
        }
        return {
            capabilityName,
            objective: normalizeText(step.objective, `steps[${index}].objective`, 160),
        };
    });
    const stepNames = plannedCapabilityNames({ steps });
    const incompatibleStep = steps.find(step => (
        entityScope !== 'none'
        && !getAiCapability(step.capabilityName).entityScopes.includes(entityScope)
    ));
    if (incompatibleStep) {
        throw new AiIntentPlanError(
            `能力 ${incompatibleStep.capabilityName} 不支持 ${entityScope} 对象范围`
        );
    }
    if (
        raw.needsBusinessData
        && !raw.requiresClarification
        && stepNames.length === 0
        && !options.allowMissingSteps
    ) {
        throw new AiIntentPlanError('需要业务数据时必须规划至少一个正式能力');
    }
    if (raw.mode === 'conversation' && (raw.needsBusinessData || stepNames.length > 0)) {
        throw new AiIntentPlanError('普通对话不得携带业务能力步骤');
    }
    if (raw.contextMode === 'page_context' && !options.pageContext) {
        throw new AiIntentPlanError('没有页面上下文时不得引用 page_context');
    }

    // Stage 1 owns the risk/domain envelope. A capability may serve several domains,
    // but selecting it through one allowed domain must never widen later discovery.
    const domains = [...new Set(raw.domains)];
    return Object.freeze({
        version: 3,
        goal: normalizeText(raw.goal, 'goal'),
        mode: raw.mode,
        domains: Object.freeze(domains),
        needsBusinessData: raw.needsBusinessData,
        contextMode: raw.contextMode,
        answerShape: raw.answerShape,
        entityScope,
        requiresClarification: raw.requiresClarification,
        ambiguities: Object.freeze(raw.ambiguities.map((item, index) => (
            normalizeText(item, `ambiguities[${index}]`, 160)
        ))),
        confidence: raw.confidence,
        requiredFactIntents: Object.freeze(requiredFactIntents),
        steps: Object.freeze(steps),
    });
}

function normalizeDomainPlan(raw, options = {}) {
    const normalized = normalizeIntentPlan({ ...raw, steps: [] }, {
        pageContext: options.pageContext,
        allowMissingSteps: true,
    });
    if (normalized.needsBusinessData && !normalized.requiresClarification) {
        // Domain phase intentionally has no concrete steps; detailed planning supplies them next.
        return Object.freeze({ ...normalized, steps: Object.freeze([]) });
    }
    return normalized;
}

function enforceProtectedCommandRoute(domainPlan, commandRoute) {
    if (commandRoute?.mode !== 'command') return domainPlan;
    const domains = [...new Set([
        ...(commandRoute.domains || []),
        ...domainPlan.domains,
    ])].filter(domain => DOMAIN_NAMES.includes(domain)).slice(0, 4);
    return Object.freeze({
        ...domainPlan,
        mode: 'command',
        domains: Object.freeze(domains),
        needsBusinessData: true,
        answerShape: 'confirmation',
        entityScope: domainPlan.entityScope === 'none' ? 'single' : domainPlan.entityScope,
    });
}

function enforcePreferredCommandCapability(intent, commandRoute) {
    const capabilityName = String(commandRoute?.preferredCapability || '').trim();
    if (!capabilityName || intent.requiresClarification) return intent;
    const capability = getAiCapability(capabilityName);
    if (!capability || capability.access !== 'write') return intent;
    if (!capability.domains.some(domain => intent.domains.includes(domain))) return intent;
    if (!capability.entityScopes.includes(intent.entityScope)) return intent;
    return Object.freeze({
        ...intent,
        steps: Object.freeze([
            Object.freeze({
                capabilityName,
                objective: intent.goal,
            }),
        ]),
    });
}

async function requestStructuredPlan(provider, messages, tool, options = {}) {
    const response = await provider(messages, {
        stream: false,
        tools: [tool],
        toolChoice: { type: 'function', function: { name: tool.function.name } },
        onProvider: options.onProvider,
        env: options.env,
        dbAccessors: options.dbAccessors,
        attachmentMode: 'metadata',
        signal: options.signal,
    });
    const data = await response.json();
    if (data.error) throw new AiIntentPlanError(data.error.message || '意图规划 API 错误');
    const usage = normalizeProviderUsage(data.usage);
    if (usage && typeof options.onUsage === 'function') options.onUsage(usage);
    return parsePlanArguments(data.choices?.[0]?.message, tool.function.name);
}

async function planAiGoalV3(messages, options = {}) {
    if (!latestUserText(messages)) {
        throw new AiIntentPlanError('缺少当前用户消息', 'AI_INTENT_INPUT_MISSING');
    }
    const provider = options.fetchAiProvider || fetchAiProvider;
    const userText = latestUserText(messages);
    const domainTool = domainPlannerTool();
    const domainStartedAt = Date.now();
    const domainMessages = [
        {
            role: 'system',
            content: domainPlannerPrompt(options.pageContext, options.resolutionContext, options.turnState),
        },
        ...messages,
    ];
    let domainPlan;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const rawDomainPlan = await requestStructuredPlan(
                provider,
                domainMessages,
                domainTool,
                options
            );
            domainPlan = normalizeDomainPlan(rawDomainPlan, { pageContext: options.pageContext });
            domainPlan = enforceProtectedCommandRoute(domainPlan, options.commandRoute);
            break;
        } catch (error) {
            if (!(error instanceof AiIntentPlanError) || attempt > 0) throw error;
            domainMessages.push({
                role: 'system',
                content: `上一次目标信封未通过协议校验：${error.message}。请重新调用 submit_ai_domain_plan，只提交业务域和风险信封。`,
            });
        }
    }
    if (explicitKnowledgeSearchRequested(userText) && !domainPlan.domains.includes('knowledge')) {
        domainPlan = Object.freeze({
            ...domainPlan,
            domains: Object.freeze([...domainPlan.domains, 'knowledge'].slice(0, 4)),
        });
    }
    domainPlan = enforceCatalogPartPriceAuthority(domainPlan, userText);
    if (typeof options.onPlanningPhase === 'function') {
        options.onPlanningPhase({ phase: 'domain', durationMs: Date.now() - domainStartedAt });
    }
    if (domainPlan.requiresClarification || domainPlan.mode === 'conversation') return domainPlan;

    const tool = plannerTool({
        domains: domainPlan.domains,
        mode: domainPlan.mode,
        entityScope: domainPlan.entityScope,
    });
    if (tool.function.parameters.properties.steps.items.properties.capabilityName.enum.length === 0) {
        throw new AiIntentPlanError('目标业务域没有可用能力', 'AI_INTENT_CAPABILITY_DIRECTORY_EMPTY');
    }
    const plannerMessages = [
        {
            role: 'system',
            content: plannerPrompt(
                options.pageContext,
                options.resolutionContext,
                options.turnState,
                domainPlan.domains,
                domainPlan
            ),
        },
        ...messages,
    ];
    let lastError;
    const capabilityStartedAt = Date.now();
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const rawStepsPlan = await requestStructuredPlan(provider, plannerMessages, tool, options);
            const normalized = normalizeIntentPlan({
                ...domainPlan,
                requiredFactIntents: rawStepsPlan.requiredFactIntents,
                steps: rawStepsPlan.steps,
            }, {
                pageContext: options.pageContext,
                allowedDomains: domainPlan.mode === 'command' ? domainPlan.domains : [],
                allowedCapabilityNames:
                    tool.function.parameters.properties.steps.items.properties.capabilityName.enum,
            });
            if (typeof options.onPlanningPhase === 'function') {
                options.onPlanningPhase({ phase: 'capability', durationMs: Date.now() - capabilityStartedAt });
            }
            return enforcePreferredCommandCapability(enforceExplicitReadRequirements(
                enforceBusinessChangeAuthority(
                    enforceCatalogPartPriceAuthority(
                        collapseOverlappingCostSteps(normalized),
                        userText
                    ),
                    userText
                ),
                userText
            ), options.commandRoute);
        } catch (error) {
            if (!(error instanceof AiIntentPlanError) || attempt > 0) throw error;
            lastError = error;
            plannerMessages.push({
                role: 'system',
                content: `上一次提交未通过结构化协议校验：${error.message}。请重新调用 submit_ai_intent_plan，并只提交符合 schema 的有效 JSON 参数。`,
            });
        }
    }
    throw lastError;
}

async function planAiIntentV2(messages, options = {}) {
    return planAiGoalV3(messages, options);
}

module.exports = {
    ANSWER_SHAPES,
    AiIntentPlanError,
    CONTEXT_MODES,
    DOMAIN_NAMES,
    ENTITY_SCOPES,
    INTENT_MODES,
    domainPlannerPrompt,
    domainPlannerTool,
    collapseOverlappingCostSteps,
    enforceBusinessChangeAuthority,
    enforceCatalogPartPriceAuthority,
    enforceExplicitReadRequirements,
    enforcePreferredCommandCapability,
    enforceProtectedCommandRoute,
    explicitKnowledgeSearchRequested,
    normalizeDomainPlan,
    normalizeIntentPlan,
    planAiGoalV3,
    planAiIntentV2,
    plannerTool,
};
