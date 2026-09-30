'use strict';

const { runJudge } = require('./judge.cjs');
const { runMainAgent } = require('./mainAgent.cjs');
const { executeProtectedPartStockConfirmation } = require('./protectedPartStock.cjs');
const { getPublishedPolicySnapshot } = require('./domainPolicyStore.cjs');
const { buildInvestigationContext } = require('./context.cjs');

class AiAssistantRuntimeError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AiAssistantRuntimeError';
        this.code = code;
    }
}

async function runAiAssistant(input = {}, dependencies = {}) {
    const userMessage = String(input.userMessage || '').trim();
    if (!userMessage) throw new AiAssistantRuntimeError('AI_ASSISTANT_INPUT_INVALID', '缺少用户消息');
    const policySnapshot = dependencies.policySnapshot || getPublishedPolicySnapshot();
    const domainPolicy = dependencies.domainPolicy || policySnapshot.policyContent;
    const policyVersion = dependencies.policyVersion || policySnapshot.policyVersion;
    const investigationContext = (dependencies.contextBuilder || buildInvestigationContext)(input, dependencies.contextOptions);
    let judgeResult;
    try {
        judgeResult = await runJudge({
            userMessage,
            recentConversation: input.recentConversation,
            domainPolicy,
            policyVersion,
            investigationContext,
            env: input.env,
            signal: input.signal,
            timeoutMs: input.judgeTimeoutMs,
            requestId: input.requestId,
        }, { modelCall: dependencies.judgeModelCall });
    } catch (error) {
        if (String(error?.code || '').startsWith('JUDGE_')) return {
            status: 'JUDGE_CLARIFICATION_OR_UNSUPPORTED', judge: null, judgeRepaired: true,
            answer: '请说明要调整哪个对象，以及希望改成什么或调整多少。', toolResults: [], policyVersion,
        };
        throw error;
    }

    if (judgeResult.output.persistentMutation && dependencies.writeAllowed !== true) {
        return {
            status: 'WRITE_DISABLED', judge: judgeResult.output, judgeRepaired: judgeResult.repaired,
            answer: 'AI 写入当前未开放，本次没有执行任何修改。', toolResults: [], policyVersion,
        };
    }

    if (judgeResult.output.needsClarification || judgeResult.output.mode === 'UNCLEAR') {
        return {
            status: 'JUDGE_CLARIFICATION_OR_UNSUPPORTED',
            judge: judgeResult.output,
            judgeRepaired: judgeResult.repaired,
            answer: judgeResult.output.needsClarification
                ? judgeResult.output.clarificationReason
                : '请补充需要查询或试算的工厂业务对象。',
            toolResults: [], policyVersion,
        };
    }

    if (!['READ', 'ANALYZE', 'GENERAL', 'PERSIST_MUTATION'].includes(judgeResult.output.mode)) {
        return {
            status: 'JUDGE_CLARIFICATION_OR_UNSUPPORTED',
            judge: judgeResult.output,
            judgeRepaired: judgeResult.repaired,
            answer: '当前无法安全处理该请求，请补充需要查询的工厂业务对象。',
            toolResults: [], policyVersion,
        };
    }

    const proposalMode = judgeResult.output.persistentMutation === true;
    const main = await runMainAgent({
        userMessage,
        recentConversation: input.recentConversation,
        judge: judgeResult.output,
        domainPolicy,
        policyVersion,
        investigationContext,
        env: input.env,
        signal: input.signal,
        maxRuntimeMs: input.maxRuntimeMs,
        requestId: input.requestId,
        mode: proposalMode ? 'PROTECTED_PROPOSAL' : 'READ_ONLY',
        confirmationSubject: input.confirmationSubject,
        writeAllowed: dependencies.writeAllowed,
    }, {
        modelCall: dependencies.mainModelCall,
        executeAgentTool: dependencies.executeAgentTool,
        executeToolCall: dependencies.executeToolCall,
        selectCapabilities: dependencies.selectCapabilities,
        resolveAgentEntity: dependencies.resolveAgentEntity,
        resolvePageContextEntity: dependencies.resolvePageContextEntity,
        lookupEntities: dependencies.lookupEntities,
        internalFetch: dependencies.internalFetch,
        writeAllowed: dependencies.writeAllowed,
    });
    return {
        status: proposalMode ? 'PROPOSAL_READY' : 'COMPLETED',
        judge: judgeResult.output,
        judgeRepaired: judgeResult.repaired,
        policyVersion,
        answer: main.answer,
        toolResults: main.toolResults,
        capabilityBroker: main.broker || null,
        modelCalls: { judge: judgeResult.repaired ? 2 : 1, main: main.modelCalls },
        durationMs: main.durationMs,
        ...(proposalMode ? { proposal: main.protectedProposal.proposal, confirmation: main.protectedProposal.confirmation } : {}),
    };
}

async function confirmAiAssistantPartStockProposal(input = {}, dependencies = {}) {
    return executeProtectedPartStockConfirmation(input, dependencies);
}

module.exports = { AiAssistantRuntimeError, confirmAiAssistantPartStockProposal, runAiAssistant };
