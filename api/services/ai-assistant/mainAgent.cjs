'use strict';

const { fetchAiProvider, decodeAiProviderResponse } = require('../aiProvider.cjs');
const { resolveProviderConfig } = require('../aiProviderRegistry.cjs');
const { withAgentSpan, withModelSpan } = require('../observability.cjs');
const { PROTECTED_PROPOSAL_TOOLS, executeAgentTool } = require('./agentTools.cjs');
const { renderInvestigationContext } = require('./context.cjs');
const { selectCapabilities } = require('./capabilityBroker.cjs');
const { createFactLedger, modelProjection } = require('./factLedger.cjs');
const { validateAnswer } = require('./answerValidator.cjs');

const MAX_TOOL_CALLS = 6;
const MAX_MAIN_MODEL_CALLS = 7;
const DEFAULT_RUNTIME_MS = 120_000;

class MainAgentError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'MainAgentError';
        this.code = code;
    }
}

function boundedConversation(recentConversation = []) {
    return (Array.isArray(recentConversation) ? recentConversation : [])
        .filter(message => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string')
        .slice(-4)
        .map(message => ({ role: message.role, content: message.content.slice(0, 2_000) }));
}

function mainAgentSystemPrompt(domainPolicy, mode = 'READ_ONLY', policyVersion = 'bootstrap') {
    const protectedProposal = mode === 'PROTECTED_PROPOSAL';
    return [
        '你是水泵工厂 AI Assistant 的 Main Agent。理解原始用户问题与 Judge 摘要，使用提供的只读工具取得所需正式业务事实后，自然、简洁地回答中文。',
        '自主选择必要工具和顺序；信息不足时继续调查，信息足够时停止。必须回答每个重要用户问题。',
        '正式金额只能引用工具返回的正式结果；不要自行计算、猜测数据库 ID，或混淆当前成本、临时情景与历史口径。',
        '实体名称不是数据库身份：只使用本轮正式身份工具返回的 ID。遇到歧义的配方或线圈，不得静默选择、合并或相加，应展示候选或简洁澄清。',
        '会话中的历史提及只是语言上下文；新一轮使用具体 ID 前，先用本轮正式身份工具重新查询和绑定。',
        '每个工具结果会附带 factRefs，它们是本轮唯一可引用的正式事实编号。最终回答必须只输出 JSON：{"answer":"给 Owner 的自然中文回答","claims":[{"text":"answer 中逐字出现的业务断言","factIds":["F-001"]}],"goals":[{"questionIndex":0,"status":"COMPLETED|PARTIAL|UNAVAILABLE|CLARIFICATION","factIds":["F-001"]}]}。每个 Judge 问题都必须有一项 goals；业务结论、金额、库存、数量、状态、身份、不存在和多方案结论必须由 factIds 支持。不要在 answer 中写 factRefs、内部 ID、令牌或 JSON 细节。若正式工具失败或事实不足，使用 PARTIAL/UNAVAILABLE/CLARIFICATION，且不要补算或猜测金额。',
        protectedProposal
            ? '本轮只能准备一项库存调整的受保护提案。必须先用 resolve_entity 唯一确认 part 身份，再调用 prepare_part_stock_adjustment。后者只预览；不得执行写入、不得展示确认令牌。canonicalId 仅是工具参数，绝不能在自然语言答复中提及。得到提案后立刻停止工具调用，并自然说明 Owner 仍需在模型之外确认。'
            : '本轮没有写工具。先用 resolve_entity 获得唯一正式身份；当前页面指代可用 resolve_page_context_entity 作正式验证。再把工具结果中的 canonicalId 用于要求实体身份的能力。不得猜测 ID；AMBIGUOUS、NOT_FOUND 或 INCOMPLETE 都不能自行选择。不要保存、创建提案或确认卡。不要输出内部术语、工具 JSON、HTTP/API 细节或计算过程。',
        '',
        `本轮固定的已发布工厂规则版本：${policyVersion}。`,
        '相关领域策略：',
        domainPolicy,
    ].join('\n');
}

async function defaultMainModelCall(messages, options = {}) {
    const config = resolveProviderConfig('deepseek', options.env || process.env);
    if (!config.apiKey) throw new MainAgentError('DEEPSEEK_NOT_CONFIGURED', 'DeepSeek 未配置，无法执行 Main Agent');
    const tools = Array.isArray(options.tools) ? options.tools : [];
    if (tools.length === 0) throw new MainAgentError('MAIN_AGENT_TOOLS_MISSING', '本轮没有可用的正式调查能力。');
    return withModelSpan({ provider: 'deepseek', model: config.model, streaming: false, toolDefinitionCount: tools.length }, () => (
        fetchAiProvider(messages, {
            config,
            tools,
            stream: false,
            signal: options.signal,
            timeoutMs: options.timeoutMs,
        })
    ));
}

async function assistantMessage(response) {
    const payload = await decodeAiProviderResponse(response);
    const message = payload?.choices?.[0]?.message;
    if (!message || typeof message !== 'object') {
        throw new MainAgentError('MAIN_AGENT_RESPONSE_INVALID', 'Main Agent 响应缺少 message');
    }
    return message;
}

function toolCallsFrom(message) {
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) return [];
    return message.tool_calls.map(call => {
        const name = String(call?.function?.name || '').trim();
        const rawArgs = call?.function?.arguments;
        if (!name || typeof rawArgs !== 'string') throw new MainAgentError('MAIN_AGENT_TOOL_CALL_INVALID', 'Main Agent 工具调用格式无效');
        let args;
        try { args = JSON.parse(rawArgs); } catch { throw new MainAgentError('MAIN_AGENT_TOOL_CALL_INVALID', 'Main Agent 工具参数不是有效 JSON'); }
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new MainAgentError('MAIN_AGENT_TOOL_CALL_INVALID', 'Main Agent 工具参数必须是对象');
        return { id: String(call.id || `tool-${name}`), name, args };
    });
}

function safeAssistantToolMessage(message, calls) {
    return {
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : '',
        tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })),
    };
}

function canonicalToolCall(call) {
    return `${call.name}:${JSON.stringify(call.args, Object.keys(call.args).sort())}`;
}

function runtimeLimit(input) {
    const value = Number(input.maxRuntimeMs);
    if (!Number.isFinite(value)) return DEFAULT_RUNTIME_MS;
    return Math.max(10_000, Math.min(Math.trunc(value), 180_000));
}
function validationFailureGoals(judge = {}) {
    const count = Math.max(1, Array.isArray(judge.questions) ? judge.questions.length : 0);
    return Object.freeze(Array.from({ length: count }, (_, questionIndex) => Object.freeze({ questionIndex, status: 'UNAVAILABLE', factIds: [] })));
}
async function runMainAgent(input = {}, dependencies = {}) {
    const userMessage = String(input.userMessage || '').trim();
    if (!userMessage) throw new MainAgentError('MAIN_AGENT_INPUT_INVALID', '缺少用户消息');
    const judge = input.judge;
    if (!judge || typeof judge !== 'object') throw new MainAgentError('MAIN_AGENT_INPUT_INVALID', '缺少 Judge 结果');
    const modelCall = dependencies.modelCall || defaultMainModelCall;
    const runTool = dependencies.executeAgentTool || executeAgentTool;
    const proposalMode = input.mode === 'PROTECTED_PROPOSAL';
    const broker = proposalMode ? null : (dependencies.selectCapabilities || selectCapabilities)({ judge, resolvedEntities: input.resolvedEntities });
    const exposedTools = proposalMode ? PROTECTED_PROPOSAL_TOOLS : broker.tools;
    const startedAt = Date.now();
    const timeoutMs = runtimeLimit(input);
    const messages = [
        { role: 'system', content: mainAgentSystemPrompt(input.domainPolicy || '', input.mode, input.policyVersion) },
        ...boundedConversation(input.recentConversation),
        { role: 'system', content: renderInvestigationContext(input.investigationContext) },
        {
            role: 'user',
            content: `${userMessage}\n\nJudge 结果（用于理解目标，不是业务事实）：${JSON.stringify(judge)}`,
        },
    ];
    const toolResults = [];
    const factLedger = input.factLedger || createFactLedger();
    const callKeys = new Set();
    const resolvedRecipeIds = new Set();
    const resolvedRecipeBindings = new Map();
    const resolvedCoilBindings = new Map();
    const ambiguousCoilKeys = new Set();
    const resolvedPartBindings = new Map();
    const entityBindings = new Map();
    const selectedToolNames = new Set((broker?.capabilities || []).map(capability => capability.toolName));
    let protectedProposal = null;

    return withAgentSpan({ route: 'ai_assistant_main_agent', requestId: input.requestId, streaming: false,
        availableCapabilityCount: broker?.availableCapabilityCount ?? 0,
        selectedCapabilityCount: broker?.selectedCapabilityCount ?? 0,
        exposedToolCount: exposedTools.length, domains: broker?.domains || ['inventory'] }, async () => {
        for (let modelCalls = 0; modelCalls < MAX_MAIN_MODEL_CALLS; modelCalls += 1) {
            if (Date.now() - startedAt > timeoutMs) {
                throw new MainAgentError('MAIN_AGENT_TIMEOUT', 'Main Agent 超过本轮运行时间限制');
            }
            let message;
            try {
                message = await assistantMessage(await modelCall(messages, {
                    env: input.env,
                    signal: input.signal,
                    timeoutMs: Math.max(1, timeoutMs - (Date.now() - startedAt)),
                    stage: 'main_agent',
                    tools: exposedTools,
                }));
            } catch (error) {
                if (error instanceof MainAgentError) throw error;
                throw new MainAgentError(error?.code || 'MAIN_AGENT_MODEL_FAILED', 'Main Agent 调用失败');
            }
            const calls = toolCallsFrom(message);
            if (calls.length === 0) {
                const rawAnswer = String(message.content || '').trim();
                if (!rawAnswer) throw new MainAgentError('MAIN_AGENT_RESPONSE_INVALID', 'Main Agent 未返回工具调用或最终回答');
                const ledgerSnapshot = factLedger.snapshot();
                if (judge.mode !== 'GENERAL' && ledgerSnapshot.facts.length === 0) {
                    throw new MainAgentError('MAIN_AGENT_FORMAL_TOOL_REQUIRED', 'Main Agent 未取得正式工具结果');
                }
                if (proposalMode && !protectedProposal) throw new MainAgentError('MAIN_AGENT_PROPOSAL_REQUIRED', '受保护写请求必须先形成正式提案。');
                const answerValidation = (dependencies.validateAnswer || validateAnswer)(rawAnswer, { ledger: ledgerSnapshot, judge, mode: judge.mode });
                return { answer: answerValidation.answer, toolResults, factLedger: ledgerSnapshot, answerValidation, goalStatuses: answerValidation.goals || validationFailureGoals(judge), protectedProposal, modelCalls: modelCalls + 1, durationMs: Date.now() - startedAt, broker };
            }
            if (toolResults.length + calls.length > MAX_TOOL_CALLS) {
                throw new MainAgentError('MAIN_AGENT_TOOL_BUDGET_EXCEEDED', 'Main Agent 超过工具调用上限');
            }
            const batchKeys = new Set();
            for (const call of calls) {
                if (!exposedTools.some(item => item.function.name === call.name)) throw new MainAgentError('MAIN_AGENT_TOOL_NOT_ALLOWED', 'Main Agent 调用了当前模式未暴露的工具。');
                if (proposalMode && protectedProposal) throw new MainAgentError('MAIN_AGENT_TOOL_AFTER_PROPOSAL', '受保护提案形成后不得继续调用工具。');
                const callKey = canonicalToolCall(call);
                if (callKeys.has(callKey) || batchKeys.has(callKey)) throw new MainAgentError('MAIN_AGENT_REPEATED_TOOL_CALL', 'Main Agent 重复了相同工具调用');
                batchKeys.add(callKey);
            }
            messages.push(safeAssistantToolMessage(message, calls));
            for (const call of calls) {
                let result;
                try {
                    result = await runTool(call.name, call.args, {
                        resolvedRecipeIds, resolvedRecipeBindings, resolvedCoilBindings, ambiguousCoilKeys, resolvedPartBindings, entityBindings, selectedToolNames, pageContext: input.investigationContext?.pageContext || null, userMessage, confirmationSubject: input.confirmationSubject, writeAllowed: input.writeAllowed, signal: input.signal,
                        setProtectedProposal: value => { protectedProposal = value; },
                    }, { executeToolCall: dependencies.executeToolCall, resolveAgentEntity: dependencies.resolveAgentEntity,
                        lookupEntities: dependencies.lookupEntities, internalFetch: dependencies.internalFetch,
                        resolvePageContextEntity: dependencies.resolvePageContextEntity });
                } catch (error) {
                    result = {
                        success: false,
                        agentToolName: call.name,
                        verified: false,
                        data: null,
                        code: 'TOOL_ARGUMENT_REJECTED',
                        message: '该工具调用缺少本轮已验证的正式身份或参数无效；请先查询正式候选后再继续。',
                    };
                }
                if (result.success) callKeys.add(canonicalToolCall(call));
                toolResults.push(result);
                const appended = factLedger.appendToolResult({ toolName: call.name, args: call.args, result, entityBindings });
                messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(modelProjection(result, appended.factIds)) });
            }
        }
        throw new MainAgentError('MAIN_AGENT_MODEL_BUDGET_EXCEEDED', 'Main Agent 未在模型调用预算内完成回答');
    });
}

module.exports = {
    DEFAULT_RUNTIME_MS,
    MAX_MAIN_MODEL_CALLS,
    MAX_TOOL_CALLS,
    MainAgentError,
    defaultMainModelCall,
    mainAgentSystemPrompt,
    runMainAgent,
    toolCallsFrom,
};
