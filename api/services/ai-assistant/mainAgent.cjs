'use strict';

const { fetchAiProvider, decodeAiProviderResponse } = require('../aiProvider.cjs');
const { resolveProviderConfig } = require('../aiProviderRegistry.cjs');
const { withAgentSpan, withModelSpan } = require('../observability.cjs');
const { AGENT_TOOLS, executeAgentTool } = require('./agentTools.cjs');

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

function mainAgentSystemPrompt(domainPolicy) {
    return [
        '你是水泵工厂 AI Assistant 的 Main Agent。理解原始用户问题与 Judge 摘要，使用提供的只读工具取得所需正式业务事实后，自然、简洁地回答中文。',
        '自主选择必要工具和顺序；信息不足时继续调查，信息足够时停止。必须回答每个重要用户问题。',
        '正式金额只能引用工具返回的正式结果；不要自行计算、猜测数据库 ID，或混淆当前成本、临时情景与历史口径。',
        '实体名称不是数据库身份：只使用本轮正式身份工具返回的 ID。遇到歧义的配方或线圈，不得静默选择、合并或相加，应展示候选或简洁澄清。',
        '本轮没有写工具。不要保存、创建提案或确认卡。不要输出内部术语、工具 JSON、HTTP/API 细节或计算过程。',
        '',
        '相关领域策略：',
        domainPolicy,
    ].join('\n');
}

async function defaultMainModelCall(messages, options = {}) {
    const config = resolveProviderConfig('deepseek', options.env || process.env);
    if (!config.apiKey) throw new MainAgentError('DEEPSEEK_NOT_CONFIGURED', 'DeepSeek 未配置，无法执行 Main Agent');
    return withModelSpan({ provider: 'deepseek', model: config.model, streaming: false, toolDefinitionCount: AGENT_TOOLS.length }, () => (
        fetchAiProvider(messages, {
            config,
            tools: AGENT_TOOLS,
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

async function runMainAgent(input = {}, dependencies = {}) {
    const userMessage = String(input.userMessage || '').trim();
    if (!userMessage) throw new MainAgentError('MAIN_AGENT_INPUT_INVALID', '缺少用户消息');
    const judge = input.judge;
    if (!judge || typeof judge !== 'object') throw new MainAgentError('MAIN_AGENT_INPUT_INVALID', '缺少 Judge 结果');
    const modelCall = dependencies.modelCall || defaultMainModelCall;
    const runTool = dependencies.executeAgentTool || executeAgentTool;
    const startedAt = Date.now();
    const timeoutMs = runtimeLimit(input);
    const messages = [
        { role: 'system', content: mainAgentSystemPrompt(input.domainPolicy || '') },
        ...boundedConversation(input.recentConversation),
        {
            role: 'user',
            content: `${userMessage}\n\nJudge 结果（用于理解目标，不是业务事实）：${JSON.stringify(judge)}`,
        },
    ];
    const toolResults = [];
    const callKeys = new Set();
    const resolvedRecipeIds = new Set();
    const resolvedRecipeBindings = new Map();
    const resolvedCoilBindings = new Map();

    return withAgentSpan({ route: 'ai_assistant_m1_main_agent', requestId: input.requestId, streaming: false }, async () => {
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
                    tools: AGENT_TOOLS,
                }));
            } catch (error) {
                if (error instanceof MainAgentError) throw error;
                throw new MainAgentError(error?.code || 'MAIN_AGENT_MODEL_FAILED', 'Main Agent 调用失败');
            }
            const calls = toolCallsFrom(message);
            if (calls.length === 0) {
                const answer = String(message.content || '').trim();
                if (!answer) throw new MainAgentError('MAIN_AGENT_RESPONSE_INVALID', 'Main Agent 未返回工具调用或最终回答');
                if (judge.mode !== 'GENERAL' && toolResults.length === 0) {
                    throw new MainAgentError('MAIN_AGENT_FORMAL_TOOL_REQUIRED', 'Main Agent 未取得正式工具结果');
                }
                return { answer, toolResults, modelCalls: modelCalls + 1, durationMs: Date.now() - startedAt };
            }
            if (toolResults.length + calls.length > MAX_TOOL_CALLS) {
                throw new MainAgentError('MAIN_AGENT_TOOL_BUDGET_EXCEEDED', 'Main Agent 超过工具调用上限');
            }
            for (const call of calls) {
                const callKey = canonicalToolCall(call);
                if (callKeys.has(callKey)) throw new MainAgentError('MAIN_AGENT_REPEATED_TOOL_CALL', 'Main Agent 重复了相同工具调用');
                callKeys.add(callKey);
            }
            messages.push(safeAssistantToolMessage(message, calls));
            for (const call of calls) {
                let result;
                try {
                    result = await runTool(call.name, call.args, {
                        resolvedRecipeIds, resolvedRecipeBindings, resolvedCoilBindings, signal: input.signal,
                    }, { executeToolCall: dependencies.executeToolCall });
                } catch (error) {
                    throw new MainAgentError(error?.code || 'MAIN_AGENT_TOOL_FAILED', error?.message || 'Main Agent 工具调用失败');
                }
                toolResults.push(result);
                messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(result) });
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
