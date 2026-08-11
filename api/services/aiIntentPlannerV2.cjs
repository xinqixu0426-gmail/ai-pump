const {
    DOMAIN_CAPABILITY_NAMES,
    getAiCapability,
    listAiCapabilities,
} = require('../capabilities/registry.cjs');
const { fetchAiProvider } = require('./aiProvider.cjs');
const {
    buildPlannerDirectoryPrompt,
    plannedCapabilityNames,
} = require('./aiCapabilityCatalogV2.cjs');

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

function plannerTool() {
    const capabilityNames = listAiCapabilities().map(capability => capability.toolName);
    return {
        type: 'function',
        function: {
            name: 'submit_ai_intent_plan',
            description: '提交对当前用户目标的结构化理解和能力调用计划。该协议只规划，不读取或修改业务数据。',
            parameters: {
                type: 'object',
                properties: {
                    goal: { type: 'string', description: '用一句话准确复述用户当前真正目标' },
                    mode: { type: 'string', enum: INTENT_MODES },
                    domains: {
                        type: 'array',
                        items: { type: 'string', enum: DOMAIN_NAMES },
                        maxItems: 4,
                    },
                    needsBusinessData: { type: 'boolean' },
                    contextMode: { type: 'string', enum: CONTEXT_MODES },
                    answerShape: { type: 'string', enum: ANSWER_SHAPES },
                    requiresClarification: { type: 'boolean' },
                    ambiguities: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 3,
                    },
                    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
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
                required: [
                    'goal', 'mode', 'domains', 'needsBusinessData', 'contextMode',
                    'answerShape', 'requiresClarification', 'ambiguities', 'confidence', 'steps',
                ],
            },
        },
    };
}

function plannerPrompt(pageContext) {
    const pageNote = pageContext
        ? `当前页面上下文仅是候选指代：${pageContext.resourceType} #${pageContext.resourceId}，视图 ${pageContext.view}。只有用户明确指代当前页面对象时才使用 page_context。`
        : '当前没有页面上下文，不得选择 page_context。';
    return `你是 AI 调度器 V2 的意图规划器。只理解用户当前目标并提交结构化计划，不回答用户，不执行工具，不输出推理过程。

规划原则：
1. 允许口语、简称、疑问句和不规范表达；按语义理解，不按关键词机械匹配。
2. 当前用户明确提出的新业务问题覆盖旧话题。只有省略指代、紧邻追问或补充缺失参数才选择 previous_turn。
3. 需要库存、价格、成本、订单、报价、配方、客户、文件等正式事实时 needsBusinessData=true，并选择最小必要能力步骤。
4. 数量、筛选、计算和执行结果由正式能力提供；不得计划让模型自己计算或编造。
5. command 表示用户要求产生副作用；查询“有没有、多少、哪些、状态”等不是 command。
6. 新增、修改、删除、库存增减等 command 必须选择写能力；服务端之后负责正式预览、确认和回执。
7. 不要为了“了解情况”先读取全量再二次筛选；优先选择能直接表达用户条件的能力。
8. requiresClarification 只在缺少会改变执行目标的关键信息、存在多个无法安全选择的正式对象时为 true；此时 ambiguities 必须写清需要用户确认的内容，并且 steps 必须为空，禁止在澄清前读取或修改业务数据。
9. answerShape=count_with_brief 表示先给数量，再给每个命中对象的最短简报；不要扩展成流水账。
10. steps 只列取得答案或完成确认所需的业务能力，最多 5 步。
11. 先按能力的权威职责选择：已有正式记录的列表、数量、状态和实时库存用领域 Query；指定组合的计算、插值、草稿和差异分析用 Preview；用途、适用工况、兼容性、原因、工厂约定、明确确认关系、业务规则和独立资料必须用 Knowledge，即使同一个问题还询问“系统中有哪些”当前记录，也不能只安排领域 Query。不得用 Preview 代替 List，也不得用知识快照代替现有正式记录。
12. 能力名称相近时比较 description 中的权威职责、适用目标和明确排除项；选择能直接回答目标且能区分关键零结果语义的最小能力，不并列安排职责重复的工具。
13. 用户一个问题包含多个子目标时，逐项判断事实权威来源并为每种不同职责安排必要步骤。例如“当前有哪些正式记录”使用领域 Query，“用途、经验、规则依据、明确确认关系”使用 Knowledge；不能指望执行阶段临时扩搜计划外能力。
14. 用户用客户名、合同号、型号或名称指代资源但没有明确提供内部ID时，必须选择或使用支持名称查询的参数，不得从消息长度、列表顺序、历史回答或常识生成ID。ID只能来自用户明确编号、当前页面资源ID或本轮正式查询结果。

${pageNote}

可用能力目录：
${buildPlannerDirectoryPrompt()}`;
}

function parsePlanArguments(message) {
    const call = (message?.tool_calls || []).find(item => (
        item?.function?.name === 'submit_ai_intent_plan'
    ));
    if (!call) {
        throw new AiIntentPlanError('模型没有提交结构化意图计划', 'AI_INTENT_PLAN_MISSING');
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
    assertEnum(raw.confidence, ['high', 'medium', 'low'], 'confidence');
    if (typeof raw.needsBusinessData !== 'boolean') {
        throw new AiIntentPlanError('needsBusinessData 必须是布尔值');
    }
    if (typeof raw.requiresClarification !== 'boolean') {
        throw new AiIntentPlanError('requiresClarification 必须是布尔值');
    }
    if (!Array.isArray(raw.domains) || raw.domains.some(domain => !DOMAIN_NAMES.includes(domain))) {
        throw new AiIntentPlanError('domains 包含未登记业务域');
    }
    if (!Array.isArray(raw.steps) || raw.steps.length > 5) {
        throw new AiIntentPlanError('steps 必须是最多 5 项的数组');
    }
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
        if (raw.mode !== 'command' && capability.access === 'write') {
            throw new AiIntentPlanError(`非写意图不得计划写能力 ${capabilityName}`);
        }
        return {
            capabilityName,
            objective: normalizeText(step.objective, `steps[${index}].objective`, 160),
        };
    });
    const stepNames = plannedCapabilityNames({ steps });
    if (raw.needsBusinessData && !raw.requiresClarification && stepNames.length === 0) {
        throw new AiIntentPlanError('需要业务数据时必须规划至少一个正式能力');
    }
    if (raw.mode === 'conversation' && (raw.needsBusinessData || stepNames.length > 0)) {
        throw new AiIntentPlanError('普通对话不得携带业务能力步骤');
    }
    if (raw.contextMode === 'page_context' && !options.pageContext) {
        throw new AiIntentPlanError('没有页面上下文时不得引用 page_context');
    }

    const domains = [...new Set([
        ...raw.domains,
        ...steps.flatMap(step => getAiCapability(step.capabilityName)?.domains || []),
    ])].slice(0, 6);
    return Object.freeze({
        version: 2,
        goal: normalizeText(raw.goal, 'goal'),
        mode: raw.mode,
        domains: Object.freeze(domains),
        needsBusinessData: raw.needsBusinessData,
        contextMode: raw.contextMode,
        answerShape: raw.answerShape,
        requiresClarification: raw.requiresClarification,
        ambiguities: Object.freeze(raw.ambiguities.map((item, index) => (
            normalizeText(item, `ambiguities[${index}]`, 160)
        ))),
        confidence: raw.confidence,
        steps: Object.freeze(steps),
    });
}

async function planAiIntentV2(messages, options = {}) {
    if (!latestUserText(messages)) {
        throw new AiIntentPlanError('缺少当前用户消息', 'AI_INTENT_INPUT_MISSING');
    }
    const tool = plannerTool();
    const provider = options.fetchAiProvider || fetchAiProvider;
    const plannerMessages = [
        { role: 'system', content: plannerPrompt(options.pageContext) },
        ...messages,
    ];
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await provider(plannerMessages, {
            stream: false,
            tools: [tool],
            toolChoice: {
                type: 'function',
                function: { name: tool.function.name },
            },
            onProvider: options.onProvider,
            env: options.env,
            dbAccessors: options.dbAccessors,
            attachmentMode: 'metadata',
        });
        const data = await response.json();
        if (data.error) throw new AiIntentPlanError(data.error.message || '意图规划 API 错误');
        try {
            return normalizeIntentPlan(parsePlanArguments(data.choices?.[0]?.message), {
                pageContext: options.pageContext,
            });
        } catch (error) {
            if (!(error instanceof AiIntentPlanError) || attempt > 0) throw error;
            lastError = error;
            plannerMessages.push({
                role: 'system',
                content: '上一次提交未通过结构化协议校验。请重新调用 submit_ai_intent_plan，并只提交符合 schema 的有效 JSON 参数。',
            });
        }
    }
    throw lastError;
}

module.exports = {
    ANSWER_SHAPES,
    AiIntentPlanError,
    CONTEXT_MODES,
    DOMAIN_NAMES,
    INTENT_MODES,
    normalizeIntentPlan,
    planAiIntentV2,
    plannerTool,
};
