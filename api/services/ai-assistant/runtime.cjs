'use strict';

const { runJudge } = require('./judge.cjs');
const { runMainAgent } = require('./mainAgent.cjs');
const { executeProtectedWriteConfirmation } = require('./protectedWriteBroker.cjs');
const { getPublishedPolicySnapshot } = require('./domainPolicyStore.cjs');
const { buildInvestigationContext } = require('./context.cjs');
const { createFactLedger } = require('./factLedger.cjs');
const { createRequestObservability } = require('./requestObservability.cjs');

class AiAssistantRuntimeError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AiAssistantRuntimeError';
        this.code = code;
    }
}

function terminalGoalStatuses(judge, status) {
    const count = Math.max(1, Array.isArray(judge?.questions) ? judge.questions.length : 0);
    return Object.freeze(Array.from({ length: count }, (_, questionIndex) => Object.freeze({ questionIndex, status, factIds: [] })));
}

// This is deliberately a conservative shape admission, not an entity or
// business-intent router.  It only admits an unambiguous one-sentence read
// form to a read-only Main Agent; every conjunction, scenario, mutation hint
// or unclear form remains on the Judge path.
function classifyRoute(input = {}) {
    const message = String(input.userMessage || '').trim();
    // A single terminal question mark is presentation, not a second goal.
    // Internal punctuation remains a conservative signal to retain Judge.
    const admissionText = message.replace(/[。！？!?]+$/u, '').trim();
    const hasExtraContext = (Array.isArray(input.attachments) && input.attachments.length > 0)
        || (Array.isArray(input.recentConversation) && input.recentConversation.length > 0)
        // Page context is a candidate identity rather than a business fact.
        // Keep it on the full path so Judge and Main Agent receive the same
        // policy/context snapshot and formally verify the candidate.
        || Boolean(input.pageContext);
    if (!admissionText || hasExtraContext || [...admissionText].length > 72) return 'GENERAL';
    if (/[，,；;。！？!?\n]/.test(admissionText)) return 'GENERAL';
    // These are generic state-changing or analytical connective forms.  They
    // only deny fast-path admission; they never select a capability.
    if (/(?:保存|落库|执行|确认|修改|更新|删除|创建|增加|减少|调整|改成|设为|如果|假设|为什么|原因|比较|差多少|顺便|然后|以及|并且)/.test(admissionText)) return 'GENERAL';
    return 'SIMPLE_READ';
}
function simpleReadJudge(userMessage) {
    return Object.freeze({
        mode: 'READ', goal: userMessage, questions: Object.freeze([userMessage]), constraints: Object.freeze([]),
        persistentMutation: false, needsClarification: false, clarificationReason: null,
        appliedPolicyIds: Object.freeze([]),
        // Begin with a compact generic read surface. The Main Agent must
        // formally resolve an entity before the broker exposes that entity's
        // richer read/preview profile on the next call.
        domains: Object.freeze(['general']),
    });
}
function referenceEntities(factLedger) {
    const seen = new Set(); const entities = [];
    for (const fact of factLedger?.facts || []) {
        if (fact?.predicate !== 'identity_resolved' || !fact.entity?.type || !fact.entity?.canonicalName) continue;
        const key = `${fact.entity.type}:${fact.entity.canonicalName}`;
        if (seen.has(key) || entities.length >= 8) continue;
        seen.add(key); entities.push(Object.freeze({ entityType: fact.entity.type, canonicalName: fact.entity.canonicalName }));
    }
    return Object.freeze(entities);
}

async function runAiAssistant(input = {}, dependencies = {}) {
    const userMessage = String(input.userMessage || '').trim();
    if (!userMessage) throw new AiAssistantRuntimeError('AI_ASSISTANT_INPUT_INVALID', '缺少用户消息');
    const policySnapshot = dependencies.policySnapshot || getPublishedPolicySnapshot();
    const domainPolicy = dependencies.domainPolicy || policySnapshot.policyContent;
    const policyVersion = dependencies.policyVersion || policySnapshot.policyVersion;
    const routeClass = dependencies.routeClass || classifyRoute(input);
    const telemetry = dependencies.telemetry || createRequestObservability({ requestId: input.requestId, policyVersion, routeClass });
    const progress = typeof dependencies.onProgress === 'function' ? dependencies.onProgress : () => {};
    progress({ stage: 'understanding', routeClass });
    const investigationContext = telemetry.stage('contextBuild', () => (dependencies.contextBuilder || buildInvestigationContext)(input, dependencies.contextOptions));
    const factLedger = dependencies.factLedger || createFactLedger();
    let judgeResult;
    if (routeClass === 'SIMPLE_READ') {
        judgeResult = { output: simpleReadJudge(userMessage), repaired: false, skipped: true };
    } else try {
        progress({ stage: 'understanding', routeClass: 'GENERAL' });
        judgeResult = await telemetry.stage('judge', () => runJudge({
            userMessage, recentConversation: input.recentConversation, domainPolicy, policyVersion, investigationContext,
            env: input.env, signal: input.signal, timeoutMs: input.judgeTimeoutMs, requestId: input.requestId,
        }, { modelCall: dependencies.judgeModelCall }));
        telemetry.update({ judgeUsed: true, judgeModelCalls: judgeResult.repaired ? 2 : 1 });
    } catch (error) {
        if (String(error?.code || '').startsWith('JUDGE_')) return {
            status: 'JUDGE_CLARIFICATION_OR_UNSUPPORTED', judge: null, judgeRepaired: true,
            answer: '请说明要调整哪个对象，以及希望改成什么或调整多少。', toolResults: [], factLedger: factLedger.snapshot(), goalStatuses: terminalGoalStatuses(null, 'CLARIFICATION'), policyVersion, routeClass, metrics: telemetry.emit('JUDGE_CLARIFICATION_OR_UNSUPPORTED'),
        };
        throw error;
    }

    if (judgeResult.output.persistentMutation && dependencies.writeAllowed !== true) {
        return {
            status: 'WRITE_DISABLED', judge: judgeResult.output, judgeRepaired: judgeResult.repaired,
            answer: 'AI 写入当前未开放，本次没有执行任何修改。', toolResults: [], factLedger: factLedger.snapshot(), goalStatuses: terminalGoalStatuses(judgeResult.output, 'UNAVAILABLE'), policyVersion, routeClass, metrics: telemetry.emit('WRITE_DISABLED'),
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
            toolResults: [], factLedger: factLedger.snapshot(), goalStatuses: terminalGoalStatuses(judgeResult.output, 'CLARIFICATION'), policyVersion, routeClass, metrics: telemetry.emit('JUDGE_CLARIFICATION_OR_UNSUPPORTED'),
        };
    }

    if (!['READ', 'ANALYZE', 'GENERAL', 'PERSIST_MUTATION'].includes(judgeResult.output.mode)) {
        return {
            status: 'JUDGE_CLARIFICATION_OR_UNSUPPORTED',
            judge: judgeResult.output,
            judgeRepaired: judgeResult.repaired,
            answer: '当前无法安全处理该请求，请补充需要查询的工厂业务对象。',
            toolResults: [], factLedger: factLedger.snapshot(), goalStatuses: terminalGoalStatuses(judgeResult.output, 'UNAVAILABLE'), policyVersion, routeClass, metrics: telemetry.emit('JUDGE_CLARIFICATION_OR_UNSUPPORTED'),
        };
    }

    const proposalMode = judgeResult.output.persistentMutation === true;
    progress({ stage: proposalMode ? 'preparing_write_proposal' : 'reading_formal_data', routeClass });
    const main = await telemetry.stage('mainAgent', () => runMainAgent({
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
        factLedger, routeClass,
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
        validateAnswer: dependencies.validateAnswer, onProgress: progress, telemetry,
    }));
    telemetry.update({
        selectedDomains: main.broker?.domains || judgeResult.output.domains,
        selectedCapabilities: (main.broker?.capabilities || []).map(item => item.capabilityId),
        exposedToolCount: main.broker?.exposedToolCount || 0,
        mainModelCalls: main.modelCalls,
        actualToolCalls: main.toolResults.length,
        ontologyResolutionCount: main.toolResults.filter(item => /^resolve_/.test(item.agentToolName || '')).length,
        factCount: main.factLedger?.facts?.length || 0,
        goalCount: main.goalStatuses?.length || 0,
        goalStatuses: (main.goalStatuses || []).map(item => item.status),
        validatorResult: main.answerValidation?.code || null,
        writeProposalCreated: proposalMode && Boolean(main.protectedProposal),
    });
    const metrics = telemetry.emit(proposalMode ? 'PROPOSAL_READY' : 'COMPLETED');
    progress({ stage: 'verifying_result', routeClass });
    return {
        status: proposalMode ? 'PROPOSAL_READY' : 'COMPLETED',
        judge: judgeResult.output,
        judgeRepaired: judgeResult.repaired,
        policyVersion,
        answer: main.answer,
        toolResults: main.toolResults,
        factLedger: main.factLedger,
        answerValidation: main.answerValidation,
        goalStatuses: main.goalStatuses,
        capabilityBroker: main.broker || null,
        modelCalls: { judge: judgeResult.skipped ? 0 : (judgeResult.repaired ? 2 : 1), main: main.modelCalls },
        durationMs: metrics.timings.totalLatencyMs,
        routeClass,
        metrics,
        referenceEntities: referenceEntities(main.factLedger),
        ...(proposalMode ? { proposal: main.protectedProposal.proposal, confirmation: main.protectedProposal.confirmation } : {}),
    };
}

async function confirmAiAssistantPartStockProposal(input = {}, dependencies = {}) {
    return executeProtectedWriteConfirmation(input, dependencies);
}

const confirmAiAssistantProtectedWriteProposal = confirmAiAssistantPartStockProposal;
module.exports = { AiAssistantRuntimeError, classifyRoute, confirmAiAssistantPartStockProposal, confirmAiAssistantProtectedWriteProposal, referenceEntities, runAiAssistant, simpleReadJudge, terminalGoalStatuses };
