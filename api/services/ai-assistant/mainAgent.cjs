'use strict';

const { fetchAiProvider, decodeAiProviderResponse } = require('../aiProvider.cjs');
const { resolveProviderConfig } = require('../aiProviderRegistry.cjs');
const { withAgentSpan, withModelSpan } = require('../observability.cjs');
const { AGENT_TOOLS, executeAgentTool } = require('./agentTools.cjs');

const MAX_TOOL_CALLS = 6;
const MAX_MAIN_MODEL_CALLS = 4;
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
        '你是水泵工厂 AI Assistant 的 Main Agent。使用提供的只读工具调查后，自然、简洁地回答用户。',
        '正式金额只能引用工具返回的正式结果；不要自行计算、猜测数据库 ID 或把临时试算说成已保存正式成本。',
        '本轮没有写工具。用户要求持久化变更时，说明需要走受保护确认，不要执行或生成确认卡。',
        '对于本轮 V550 临时试算，先用 find_recipe 确认唯一正式配方，再用 preview_profitability；recipeId 只能来自前一个工具结果。',
        '工具结果足够后直接用中文回答，明确这是临时试算且没有保存。不要输出内部术语、工具 JSON 或计算过程。',
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
    if (message.tool_calls.length !== 1) {
        throw new MainAgentError('MAIN_AGENT_TOOL_CALL_INVALID', 'M1 每次 Main Agent 响应只允许一个工具调用');
    }
    const call = message.tool_calls[0];
    const name = String(call?.function?.name || '').trim();
    const rawArgs = call?.function?.arguments;
    if (!name || typeof rawArgs !== 'string') {
        throw new MainAgentError('MAIN_AGENT_TOOL_CALL_INVALID', 'Main Agent 工具调用格式无效');
    }
    let args;
    try {
        args = JSON.parse(rawArgs);
    } catch {
        throw new MainAgentError('MAIN_AGENT_TOOL_CALL_INVALID', 'Main Agent 工具参数不是有效 JSON');
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        throw new MainAgentError('MAIN_AGENT_TOOL_CALL_INVALID', 'Main Agent 工具参数必须是对象');
    }
    return [{ id: String(call.id || `tool-${name}`), name, args }];
}

function safeAssistantToolMessage(message, call) {
    return {
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : '',
        tool_calls: [{
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.args) },
        }],
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
                if (!toolResults.some(result => result.agentToolName === 'preview_profitability' && result.success)) {
                    throw new MainAgentError('MAIN_AGENT_FORMAL_PREVIEW_REQUIRED', 'Main Agent 未取得正式毛利试算结果');
                }
                return { answer, toolResults, modelCalls: modelCalls + 1, durationMs: Date.now() - startedAt };
            }
            if (toolResults.length >= MAX_TOOL_CALLS) {
                throw new MainAgentError('MAIN_AGENT_TOOL_BUDGET_EXCEEDED', 'Main Agent 超过工具调用上限');
            }
            const call = calls[0];
            const callKey = canonicalToolCall(call);
            if (callKeys.has(callKey)) {
                throw new MainAgentError('MAIN_AGENT_REPEATED_TOOL_CALL', 'Main Agent 重复了相同工具调用');
            }
            callKeys.add(callKey);
            let result;
            try {
                result = await runTool(call.name, call.args, { resolvedRecipeIds, signal: input.signal }, {
                    executeToolCall: dependencies.executeToolCall,
                });
            } catch (error) {
                throw new MainAgentError(error?.code || 'MAIN_AGENT_TOOL_FAILED', error?.message || 'Main Agent 工具调用失败');
            }
            toolResults.push(result);
            messages.push(safeAssistantToolMessage(message, call));
            messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(result) });
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
