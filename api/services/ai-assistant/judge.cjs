'use strict';

const { fetchAiProvider, decodeAiProviderResponse } = require('../aiProvider.cjs');
const { resolveProviderConfig } = require('../aiProviderRegistry.cjs');
const { withAgentSpan, withModelSpan } = require('../observability.cjs');
const { renderInvestigationContext } = require('./context.cjs');
const { BOOTSTRAP_POLICY_PATH: DOMAIN_POLICY_PATH, getPublishedPolicySnapshot } = require('./domainPolicyStore.cjs');

const JUDGE_MODES = Object.freeze(['READ', 'ANALYZE', 'PERSIST_MUTATION', 'GENERAL', 'UNCLEAR']);
const POLICY_IDS = Object.freeze(['RULE-01', 'RULE-02', 'RULE-03', 'RULE-04', 'RULE-05', 'RULE-06', 'RULE-07', 'RULE-08']);

class JudgeError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'JudgeError';
        this.code = code;
    }
}

function loadDomainPolicy() {
    return getPublishedPolicySnapshot().policyContent;
}

function boundedConversation(recentConversation = []) {
    return (Array.isArray(recentConversation) ? recentConversation : [])
        .filter(message => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string')
        .slice(-4)
        .map(message => ({ role: message.role, content: message.content.slice(0, 2_000) }));
}

function judgeSystemPrompt(domainPolicy, policyVersion = 'bootstrap') {
    return [
        '你是水泵工厂 AI Assistant 的 Judge。理解用户的真实业务目标，并依据领域策略判断读取、试算分析或持久化变更。',
        '不要选择工具、不要回答用户、不要编造 ID 或业务事实。持久化变更只有明确改变正式保存状态时才为 true。',
        '对可由正式只读目录或预览调查的身份、当前成本、库存和方案歧义，不要仅因尚未解析而要求澄清；保留用户目标，让 Main Agent 查询或展示候选。',
        'needsClarification=true 只表示必须由用户补充、且无法由已允许的正式查询或预览取得的信息，例如没有目标对象、没有要执行的数值变化，或用户目标本身互相矛盾。正式身份解析、读取当前库存、形成预览，以及 Owner 在模型之外确认，都是系统后续步骤，不是要求用户澄清的理由。',
        '用户已明确要求将一个正式业务状态保存、落库、应用或执行，且已给出可由目录解析的对象和具体变更时，应为 PERSIST_MUTATION，并且 needsClarification=false。questions 是本轮要回应的业务目标清单，不表示必须先向用户追问。',
        '只输出一个 JSON 对象，不要 Markdown、代码围栏或额外文字。',
        'JSON 必须有 mode, goal, questions, constraints, persistentMutation, needsClarification, clarificationReason, appliedPolicyIds 八个字段。',
        '对业务请求，questions 必须用平实语言列出每个需要回应的实际目标；不要遗漏并列问题，也不要无故留空。',
        '当 needsClarification=false 时，clarificationReason 应为 null。',
        `mode 只能是 ${JUDGE_MODES.join(' | ')}；appliedPolicyIds 只能使用 ${POLICY_IDS.join(', ')}。`,
        '',
        `本轮固定的已发布工厂规则版本：${policyVersion}。`,
        '领域策略：',
        domainPolicy,
    ].join('\n');
}

function parseJsonObject(content) {
    if (typeof content !== 'string' || !content.trim()) {
        throw new JudgeError('JUDGE_FORMAT_INVALID', 'Judge 未返回 JSON 对象');
    }
    try {
        const value = JSON.parse(content);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new JudgeError('JUDGE_FORMAT_INVALID', 'Judge 输出必须是 JSON 对象');
        }
        return value;
    } catch (error) {
        if (error instanceof JudgeError) throw error;
        throw new JudgeError('JUDGE_FORMAT_INVALID', 'Judge 输出不是有效 JSON');
    }
}

function validateString(value, field, { nullable = false, max = 1_000 } = {}) {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
        throw new JudgeError('JUDGE_SCHEMA_INVALID', `${field} 必须是非空字符串`);
    }
    return value.trim();
}

function validateStringList(value, field, maxItems) {
    if (!Array.isArray(value) || value.length > maxItems) {
        throw new JudgeError('JUDGE_SCHEMA_INVALID', `${field} 必须是长度不超过 ${maxItems} 的数组`);
    }
    return value.map((item, index) => validateString(item, `${field}[${index}]`, { max: 500 }));
}

function validateJudgeOutput(value) {
    const required = [
        'mode', 'goal', 'questions', 'constraints', 'persistentMutation',
        'needsClarification', 'clarificationReason', 'appliedPolicyIds',
    ];
    const unknown = Object.keys(value).filter(key => !required.includes(key));
    if (unknown.length > 0 || required.some(key => !Object.hasOwn(value, key))) {
        throw new JudgeError('JUDGE_SCHEMA_INVALID', 'Judge 输出字段与约定不符');
    }
    if (!JUDGE_MODES.includes(value.mode)) {
        throw new JudgeError('JUDGE_SCHEMA_INVALID', 'Judge mode 不在允许范围内');
    }
    if (typeof value.persistentMutation !== 'boolean' || typeof value.needsClarification !== 'boolean') {
        throw new JudgeError('JUDGE_SCHEMA_INVALID', 'Judge 布尔字段无效');
    }
    if (value.persistentMutation !== (value.mode === 'PERSIST_MUTATION')) {
        throw new JudgeError('JUDGE_SCHEMA_INVALID', 'persistentMutation 必须与 PERSIST_MUTATION mode 一致');
    }
    const clarificationReason = value.needsClarification
        ? validateString(value.clarificationReason, 'clarificationReason', { max: 500 })
        : (() => {
            if (value.clarificationReason !== null && typeof value.clarificationReason !== 'string') {
                throw new JudgeError('JUDGE_SCHEMA_INVALID', '不需澄清时 clarificationReason 必须为 null 或字符串');
            }
            return null;
        })();
    const appliedPolicyIds = validateStringList(value.appliedPolicyIds, 'appliedPolicyIds', 8);
    if (appliedPolicyIds.some(id => !POLICY_IDS.includes(id))) {
        throw new JudgeError('JUDGE_SCHEMA_INVALID', 'Judge 使用了未知领域策略 ID');
    }
    return Object.freeze({
        mode: value.mode,
        goal: validateString(value.goal, 'goal'),
        questions: Object.freeze(validateStringList(value.questions, 'questions', 8)),
        constraints: Object.freeze(validateStringList(value.constraints, 'constraints', 12)),
        persistentMutation: value.persistentMutation,
        needsClarification: value.needsClarification,
        clarificationReason,
        appliedPolicyIds: Object.freeze(appliedPolicyIds),
    });
}

async function defaultJudgeModelCall(messages, options = {}) {
    const config = resolveProviderConfig('deepseek', options.env || process.env);
    if (!config.apiKey) throw new JudgeError('DEEPSEEK_NOT_CONFIGURED', 'DeepSeek 未配置，无法执行 Judge');
    return withModelSpan({ provider: 'deepseek', model: config.model, streaming: false, toolDefinitionCount: 0 }, () => (
        fetchAiProvider(messages, { config, stream: false, signal: options.signal, timeoutMs: options.timeoutMs })
    ));
}

async function responseContent(response) {
    const payload = await decodeAiProviderResponse(response);
    const message = payload?.choices?.[0]?.message;
    if (!message || typeof message.content !== 'string') {
        throw new JudgeError('JUDGE_FORMAT_INVALID', 'Judge 响应缺少 JSON 内容');
    }
    return message.content;
}

async function runJudge(input = {}, dependencies = {}) {
    const userMessage = String(input.userMessage || '').trim();
    if (!userMessage) throw new JudgeError('JUDGE_INPUT_INVALID', '缺少用户消息');
    const fallbackSnapshot = input.domainPolicy ? null : getPublishedPolicySnapshot();
    const domainPolicy = input.domainPolicy || fallbackSnapshot.policyContent;
    const policyVersion = input.policyVersion || fallbackSnapshot?.policyVersion || 'provided';
    const modelCall = dependencies.modelCall || defaultJudgeModelCall;
    const context = boundedConversation(input.recentConversation);
    const initialMessages = [
        { role: 'system', content: judgeSystemPrompt(domainPolicy, policyVersion) },
        ...context,
        { role: 'system', content: renderInvestigationContext(input.investigationContext) },
        { role: 'user', content: userMessage },
    ];

    return withAgentSpan({ route: 'ai_assistant_m1_judge', requestId: input.requestId, streaming: false }, async () => {
        let rawContent;
        try {
            rawContent = await responseContent(await modelCall(initialMessages, {
                env: input.env, signal: input.signal, timeoutMs: input.timeoutMs, stage: 'judge', repair: false,
            }));
            return { output: validateJudgeOutput(parseJsonObject(rawContent)), repaired: false, rawContent };
        } catch (firstError) {
            if (!['JUDGE_FORMAT_INVALID', 'JUDGE_SCHEMA_INVALID'].includes(firstError?.code)) throw firstError;
            const repairMessages = [
                { role: 'system', content: [
                    '你是 JSON 格式修复器。只输出一个 JSON 对象，不得输出 Markdown、答案、工具选择或额外字段。',
                    '对象必须且只能有 mode, goal, questions, constraints, persistentMutation, needsClarification, clarificationReason, appliedPolicyIds 八个字段。',
                    `mode 只能是 ${JUDGE_MODES.join(' | ')}；persistentMutation 和 needsClarification 必须是布尔值，且 persistentMutation 必须且只能在 mode 为 PERSIST_MUTATION 时为 true；questions、constraints、appliedPolicyIds 必须是字符串数组；clarificationReason 在 needsClarification=false 时必须为 null；appliedPolicyIds 只能使用 ${POLICY_IDS.join(', ')}。`,
                    'needsClarification=true 只适用于必须由用户补充且不能通过允许的正式查询/预览获得的信息；身份解析、库存读取、预览和模型外 Owner 确认不是澄清理由。若用户已明确要求保存正式业务状态且给出可解析对象和具体变更，则使用 PERSIST_MUTATION 且 needsClarification=false。questions 只列目标，不表示追问。',
                    '保留原始用户意图和已给出的会话语言上下文；不要回答用户、不要选择工具、不要编造 ID 或业务事实。',
                ].join('\n') },
                { role: 'user', content: `有界会话上下文：${JSON.stringify(context)}\n${renderInvestigationContext(input.investigationContext)}\n原始用户消息：${userMessage}\n先前无效输出：${String(rawContent || '').slice(0, 4_000)}\n请只修复为上述结构化 Judge 契约。` },
            ];
            try {
                rawContent = await responseContent(await modelCall(repairMessages, {
                    env: input.env, signal: input.signal, timeoutMs: input.timeoutMs, stage: 'judge', repair: true,
                }));
                return { output: validateJudgeOutput(parseJsonObject(rawContent)), repaired: true, rawContent };
            } catch (repairError) {
                if (repairError instanceof JudgeError) throw repairError;
                throw new JudgeError('JUDGE_REPAIR_FAILED', 'Judge 格式修复失败');
            }
        }
    });
}

module.exports = {
    DOMAIN_POLICY_PATH,
    JUDGE_MODES,
    POLICY_IDS,
    JudgeError,
    boundedConversation,
    defaultJudgeModelCall,
    judgeSystemPrompt,
    loadDomainPolicy,
    runJudge,
    validateJudgeOutput,
};
