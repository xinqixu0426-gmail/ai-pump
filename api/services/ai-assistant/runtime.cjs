'use strict';

const { loadDomainPolicy, runJudge } = require('./judge.cjs');
const { runMainAgent } = require('./mainAgent.cjs');

class AiAssistantRuntimeError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AiAssistantRuntimeError';
        this.code = code;
    }
}

async function runAiAssistantM1(input = {}, dependencies = {}) {
    const userMessage = String(input.userMessage || '').trim();
    if (!userMessage) throw new AiAssistantRuntimeError('AI_ASSISTANT_INPUT_INVALID', '缺少用户消息');
    const domainPolicy = dependencies.domainPolicy || loadDomainPolicy();
    const judgeResult = await runJudge({
        userMessage,
        recentConversation: input.recentConversation,
        domainPolicy,
        env: input.env,
        signal: input.signal,
        timeoutMs: input.judgeTimeoutMs,
        requestId: input.requestId,
    }, { modelCall: dependencies.judgeModelCall });

    if (judgeResult.output.persistentMutation) {
        return {
            status: 'PERSISTENT_MUTATION_REQUIRES_PROTECTED_PATH',
            judge: judgeResult.output,
            judgeRepaired: judgeResult.repaired,
            answer: '该请求需要走受保护的提案与 Owner 确认流程；M1 试运行时不会执行或准备写入。',
            toolResults: [],
        };
    }
    if (judgeResult.output.needsClarification || judgeResult.output.mode === 'UNCLEAR') {
        return {
            status: 'JUDGE_CLARIFICATION_OR_UNSUPPORTED',
            judge: judgeResult.output,
            judgeRepaired: judgeResult.repaired,
            answer: judgeResult.output.needsClarification
                ? judgeResult.output.clarificationReason
                : 'M1 仅开放配方临时毛利试算，请说明需要试算的配方、临时配置和售价。',
            toolResults: [],
        };
    }

    if (!['READ', 'ANALYZE', 'GENERAL'].includes(judgeResult.output.mode)) {
        return {
            status: 'JUDGE_CLARIFICATION_OR_UNSUPPORTED',
            judge: judgeResult.output,
            judgeRepaired: judgeResult.repaired,
            answer: 'M2-A 当前无法安全处理该请求，请补充需要查询的工厂业务对象。',
            toolResults: [],
        };
    }

    const main = await runMainAgent({
        userMessage,
        recentConversation: input.recentConversation,
        judge: judgeResult.output,
        domainPolicy,
        env: input.env,
        signal: input.signal,
        maxRuntimeMs: input.maxRuntimeMs,
        requestId: input.requestId,
    }, {
        modelCall: dependencies.mainModelCall,
        executeAgentTool: dependencies.executeAgentTool,
        executeToolCall: dependencies.executeToolCall,
    });
    return {
        status: 'COMPLETED',
        judge: judgeResult.output,
        judgeRepaired: judgeResult.repaired,
        answer: main.answer,
        toolResults: main.toolResults,
        modelCalls: { judge: judgeResult.repaired ? 2 : 1, main: main.modelCalls },
        durationMs: main.durationMs,
    };
}

module.exports = { AiAssistantRuntimeError, runAiAssistantM1 };
