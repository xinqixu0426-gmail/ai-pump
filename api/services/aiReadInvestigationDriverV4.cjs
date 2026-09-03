const TERMINAL_INVESTIGATION_STATUSES = new Set([
    'completed',
    'completed_negative',
    'needs_clarification',
    'failed_unverified',
    'budget_exhausted',
]);

function terminalResult(controller) {
    const state = controller.state();
    return Object.freeze({
        status: state.status,
        state,
        behaviorEvents: state.behaviorEvents,
        observations: state.observations,
        evidenceLedger: controller.ledger.snapshot(),
        // Compatibility data is projected only after the Fact-driven loop is terminal.
        compatibilityToolResults: controller.evidenceToolResults(),
        fallbackReason: null,
    });
}

function internalFailure(controller, error) {
    return Object.freeze({
        status: 'internal_failure',
        state: controller.state(),
        behaviorEvents: controller.state().behaviorEvents,
        observations: controller.state().observations,
        evidenceLedger: controller.ledger.snapshot(),
        compatibilityToolResults: [],
        fallbackReason: 'v4_internal_failure',
        error,
    });
}

function requiresV3Fallback(fallbackReason) {
    if (!fallbackReason) return false;
    if (fallbackReason === 'v4_internal_failure') return true;
    const error = new Error(`未知 V4 fallback reason: ${fallbackReason}`);
    error.code = 'AI_V4_UNKNOWN_FALLBACK_REASON';
    throw error;
}

async function runReadInvestigationDriverV4(input = {}) {
    const controller = input.controller;
    const executeDecision = input.executeDecision;
    if (!controller || typeof executeDecision !== 'function') {
        throw new TypeError('V4 read investigation driver 需要 controller 和 executeDecision');
    }
    const maxIterations = Number(input.maxIterations) > 0
        ? Number(input.maxIterations)
        : 12;

    try {
        for (let iteration = 0; iteration < maxIterations; iteration += 1) {
            if (TERMINAL_INVESTIGATION_STATUSES.has(controller.state().status)) {
                return terminalResult(controller);
            }
            const decision = controller.next();
            if (TERMINAL_INVESTIGATION_STATUSES.has(controller.state().status)) {
                return terminalResult(controller);
            }
            if (decision?.status !== 'selected') {
                throw new Error(`V4 Broker 未返回可执行能力: ${decision?.status || 'unknown'}`);
            }

            const outcome = await executeDecision({
                decision,
                goal: controller.goal,
                state: controller.state(),
                authorize: controller.authorize,
                authorizeDiscovery: controller.authorizeDiscovery,
                reuseBinding: controller.reuseBinding,
                recordDiscovery: controller.recordDiscovery,
            });
            if (!outcome || typeof outcome !== 'object') {
                throw new TypeError('V4 capability adapter 未返回结构化结果');
            }
            if (outcome.kind === 'behavior_rejected') {
                for (const event of outcome.events || []) {
                    controller.reject(event.type, event.details);
                }
                continue;
            }
            if (outcome.kind === 'resolution') {
                controller.recordResolutionOutcome({
                    requirementId: decision.requirementId,
                    receipt: outcome.receipt,
                });
                continue;
            }
            if (outcome.kind === 'technical_failure') {
                controller.failUnverified(outcome.reason);
                continue;
            }
            if (outcome.kind === 'state_updated') continue;
            if (outcome.kind !== 'observation') {
                throw new TypeError(`未知 V4 capability adapter result: ${outcome.kind}`);
            }
            controller.observe({
                capabilityName: decision.capabilityName,
                requirementId: decision.requirementId,
                args: outcome.args,
                parameterProvenance: outcome.parameterProvenance,
                resolutionReceipt: outcome.resolutionReceipt || null,
                result: outcome.result,
                toolResult: outcome.toolResult,
                trace: outcome.trace,
                error: outcome.error,
                cancelled: outcome.cancelled,
            });
        }
        controller.exhaustBudget();
        return terminalResult(controller);
    } catch (error) {
        if (error?.name === 'AbortError' || error?.code === 'AI_REQUEST_CANCELLED') throw error;
        return internalFailure(controller, error);
    }
}

function readProviderMessage(data) {
    if (data?.error) {
        const error = new Error(data.error.message || 'AI API 错误');
        error.code = 'AI_PROVIDER_PROTOCOL_FAILURE';
        throw error;
    }
    const message = data?.choices?.[0]?.message;
    if (!message) {
        const error = new Error('AI API 未返回有效消息');
        error.code = 'AI_PROVIDER_PROTOCOL_FAILURE';
        throw error;
    }
    return message;
}

function providerFailureReason(error) {
    const code = String(error?.code || '').toUpperCase();
    if (/TIMEOUT|TIMED_OUT/.test(code)) return 'provider_timeout';
    if (/PROTOCOL|NON_JSON|INVALID_JSON/.test(code) || error?.name === 'SyntaxError') {
        return 'provider_protocol_failure';
    }
    return 'provider_transport_failure';
}

function containsEmbeddedToolProtocol(content) {
    return /DSML[\s\S]{0,40}tool_calls|<\/?(?:tool_calls?|function_calls?|invoke)(?:\s|>)/i
        .test(String(content || ''));
}

async function runReadInvestigationExecutionV4(input = {}) {
    const {
        controller,
        provider,
        scopedMessages,
        executeToolCall,
        executeToolWithTiming,
    } = input;
    if (!provider || !executeToolCall || !executeToolWithTiming) {
        throw new TypeError('V4 execution adapter 缺少 provider/executor dependency');
    }
    const emit = typeof input.emit === 'function' ? input.emit : () => {};
    const onUsage = typeof input.onUsage === 'function' ? input.onUsage : () => {};
    const latestUserText = input.userText || '';
    let currentMessages = input.currentMessages || [];
    let providerTtftMs = null;
    let entityDiscoveryCalls = 0;

    const driverResult = await runReadInvestigationDriverV4({
        controller,
        maxIterations: input.maxIterations,
        executeDecision: async ({
            decision,
            authorize,
            authorizeDiscovery,
            reuseBinding,
            recordDiscovery,
        }) => {
            input.throwIfAborted?.();
            const tool = getAiToolDefinition(decision.capabilityName);
            if (!tool) throw new Error(`V4 capability schema 不存在: ${decision.capabilityName}`);
            let content = '';
            let reasoningContent = '';
            let rawToolCalls = [];
            try {
                const response = await provider(currentMessages, {
                    tools: [tool],
                    toolChoice: {
                        type: 'function',
                        function: { name: decision.capabilityName },
                    },
                    stream: Boolean(input.stream),
                    onProvider: input.onProvider,
                    env: input.env,
                    dbAccessors: input.dbAccessors,
                    signal: input.signal,
                });
                if (input.stream) {
                    const streamResult = await readAiProviderStream(response, {
                        signal: input.signal,
                        onUsage,
                        onFirstContent: event => {
                            if (providerTtftMs == null) providerTtftMs = event.ttftMs;
                        },
                    });
                    content = streamResult.content || '';
                    reasoningContent = streamResult.reasoningContent || '';
                    rawToolCalls = streamResult.toolCalls || [];
                } else {
                    const data = await response.json();
                    onUsage(data.usage);
                    const message = readProviderMessage(data);
                    content = message.content || '';
                    reasoningContent = message.reasoning_content || '';
                    rawToolCalls = message.tool_calls || [];
                }
            } catch (error) {
                if (error?.name === 'AbortError' || error?.code === 'AI_REQUEST_CANCELLED') {
                    throw error;
                }
                return {
                    kind: 'technical_failure',
                    reason: providerFailureReason(error),
                };
            }
            for (const toolCall of rawToolCalls) {
                controller.reject('tool_proposed', {
                    toolName: toolCall.function?.name || '',
                });
            }
            if (rawToolCalls.length === 0) {
                currentMessages = [
                    ...currentMessages,
                    { role: 'assistant', content },
                    {
                        role: 'system',
                        content: `当前缺失事实只能由 ${decision.capabilityName} 的正式结果验证。请调用该能力，不得直接作答。`,
                    },
                ];
                return {
                    kind: 'behavior_rejected',
                    events: [{
                        type: containsEmbeddedToolProtocol(content)
                            ? 'tool_schema_rejected'
                            : 'plan_drift',
                        details: {
                            toolName: decision.capabilityName,
                            code: 'V4_REQUIRED_CAPABILITY_NOT_CALLED',
                        },
                    }],
                };
            }
            const preparedCalls = prepareAiToolCalls(rawToolCalls, 'model', {
                allowedToolNames: [decision.capabilityName],
                writeIntent: false,
                writeTools: input.writeTools,
            });
            const prepared = preparedCalls.find(item => item.validationStatus === 'validated');
            if (!prepared) {
                currentMessages = [
                    ...currentMessages,
                    {
                        role: 'assistant',
                        content,
                        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
                        tool_calls: rawToolCalls,
                    },
                    ...preparedCalls.map(item => buildAiToolResultMessage(item.toolCall, {
                        success: false,
                        code: item.validationCode || 'INVALID_AI_TOOL_INPUT',
                        error: item.validationError || 'V4 capability 调用未通过校验',
                        validation: {
                            status: 'rejected',
                            toolName: item.toolCall.function?.name || '',
                        },
                    })),
                    {
                        role: 'system',
                        content: `调用未执行。请严格按 ${decision.capabilityName} schema 重新提交当前缺失事实所需参数。`,
                    },
                ];
                return {
                    kind: 'behavior_rejected',
                    events: preparedCalls.map(item => ({
                        type: item.validationCode === 'AI_TOOL_NOT_ALLOWED_FOR_CURRENT_TURN'
                            ? 'tool_rejected_not_allowed'
                            : 'tool_schema_rejected',
                        details: {
                            toolName: item.toolCall.function?.name || '',
                            code: item.validationCode,
                        },
                    })),
                };
            }

            const toolCall = prepared.toolCall;
            const capabilityName = decision.capabilityName;
            const args = normalizeExplicitCoilShorthandArgs(
                parseAiToolArguments(toolCall.function.arguments),
                scopedMessages
            );
            const reusedBinding = reuseBinding({
                capabilityName,
                requirementId: decision.requirementId,
                args,
            });
            let resolution = reusedBinding
                ? {
                    status: 'reused_binding',
                    args: reusedBinding.args,
                    receipt: reusedBinding.resolutionReceipt,
                }
                : null;
            if (!resolution) {
                const initialProvenance = inferParameterProvenance(args, latestUserText);
                const initialAuthorization = authorize({
                    capabilityName,
                    requirementId: decision.requirementId,
                    args,
                    parameterProvenance: initialProvenance,
                });
                if (!initialAuthorization.allowed) {
                    return {
                        kind: 'behavior_rejected',
                        events: [{
                            type: initialAuthorization.code === 'DUPLICATE_CALL'
                                ? 'duplicate_call_suppressed'
                                : 'tool_rejected_not_allowed',
                            details: { toolName: capabilityName, code: initialAuthorization.code },
                        }],
                    };
                }

                resolution = await resolveAiToolTargetV3({
                    toolName: capabilityName,
                    args,
                    executeToolCall: async (discoveryCapability, discoveryArgs, discoveryOptions = {}) => {
                    input.throwIfAborted?.();
                    const provenance = inferParameterProvenance(discoveryArgs, latestUserText);
                    const discoveryInput = {
                        parentCapabilityName: capabilityName,
                        capabilityName: discoveryCapability,
                        requirementId: decision.requirementId,
                        args: discoveryArgs,
                        parameterProvenance: provenance,
                    };
                    const discoveryAuthorization = authorizeDiscovery(discoveryInput);
                    if (!discoveryAuthorization.allowed) {
                        controller.reject('tool_rejected_not_allowed', {
                            toolName: discoveryCapability,
                            code: discoveryAuthorization.code,
                        });
                        return {
                            success: false,
                            code: discoveryAuthorization.code,
                            error: '实体解析 discovery 被 V4 Broker 拒绝',
                            executionEvidence: { verified: false },
                        };
                    }
                    const discoveryResult = entityDiscoveryCalls >= input.maxEntityDiscoveryCalls
                        ? {
                            success: false,
                            code: 'AI_ENTITY_DISCOVERY_BUDGET_EXCEEDED',
                            error: '正式候选调查已达到本轮上限',
                            executionEvidence: { verified: false },
                        }
                        : await executeToolWithTiming(discoveryCapability, () => (
                            executeToolCall(discoveryCapability, discoveryArgs, {
                                ...discoveryOptions,
                                signal: input.signal,
                            })
                        ));
                    entityDiscoveryCalls += 1;
                    const recorded = recordDiscovery({
                        ...discoveryInput,
                        result: discoveryResult,
                    });
                    emit('tool_call', { name: discoveryCapability, args: discoveryArgs });
                    emit('tool_result', { name: discoveryCapability, result: discoveryResult });
                    return recorded.accepted
                        ? discoveryResult
                        : {
                            success: false,
                            code: recorded.decision.code,
                            error: '实体解析 discovery 记录被 V4 Broker 拒绝',
                            executionEvidence: { verified: false },
                        };
                    },
                    confirmationSubject: input.confirmationSubject,
                });
            }
            if (resolution.status === 'ambiguous') {
                currentMessages = [
                    ...currentMessages,
                    {
                        role: 'assistant',
                        content,
                        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
                        tool_calls: [toolCall],
                    },
                    buildAiToolResultMessage(toolCall, resolution.result),
                ];
                return { kind: 'resolution', receipt: resolution.receipt };
            }
            if (resolution.status === 'system_error') return { kind: 'state_updated' };

            const resolvedArgs = resolution.args || args;
            const resolvedProvenance = inferParameterProvenance(
                resolvedArgs,
                latestUserText,
                resolution.receipt
            );
            const resolvedAuthorization = authorize({
                capabilityName,
                requirementId: decision.requirementId,
                args: resolvedArgs,
                parameterProvenance: resolvedProvenance,
                resolutionReceipt: resolution.receipt,
            });
            if (!resolvedAuthorization.allowed) {
                return {
                    kind: 'behavior_rejected',
                    events: [{
                        type: resolvedAuthorization.code === 'DUPLICATE_CALL'
                            ? 'duplicate_call_suppressed'
                            : 'tool_rejected_not_allowed',
                        details: { toolName: capabilityName, code: resolvedAuthorization.code },
                    }],
                };
            }

            emit('tool_plan', buildAiToolPlan([
                { ...prepared, v4RequirementId: decision.requirementId },
            ], input.writeTools));
            emit('tool_call', { name: capabilityName, args: resolvedArgs });
            let result = await executeToolWithTiming(capabilityName, () => (
                executeToolCall(capabilityName, resolvedArgs, {
                    allowWrite: false,
                    confirmationSubject: input.confirmationSubject,
                    signal: input.signal,
                })
            ));
            if (resolution.receipt && result && typeof result === 'object') {
                result = { ...result, resolutionReceipt: resolution.receipt };
            }
            result = enforceAiToolResultBudget(capabilityName, result, []);
            emit('tool_result', { name: capabilityName, result });
            currentMessages = [
                ...currentMessages,
                {
                    role: 'assistant',
                    content,
                    ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
                    tool_calls: [toolCall],
                },
                buildAiToolResultMessage(toolCall, result),
            ];
            return {
                kind: 'observation',
                args: resolvedArgs,
                parameterProvenance: resolvedProvenance,
                resolutionReceipt: resolution.receipt || null,
                result,
                toolResult: {
                    name: capabilityName,
                    view_type: viewTypeForAiTool(capabilityName),
                    result,
                },
            };
        },
    });
    return Object.freeze({
        ...driverResult,
        providerTtftMs,
        entityDiscoveryCalls,
    });
}

module.exports = {
    TERMINAL_INVESTIGATION_STATUSES,
    requiresV3Fallback,
    runReadInvestigationDriverV4,
    runReadInvestigationExecutionV4,
};
const { getAiToolDefinition } = require('./aiCapabilityCatalogV2.cjs');
const { readAiProviderStream } = require('./aiProviderStream.cjs');
const {
    buildAiToolPlan,
    buildAiToolResultMessage,
    enforceAiToolResultBudget,
    parseAiToolArguments,
    prepareAiToolCalls,
    viewTypeForAiTool,
} = require('./aiToolProtocol.cjs');
const { normalizeExplicitCoilShorthandArgs } = require('./aiToolIdentifierGrounding.cjs');
const { resolveAiToolTargetV3 } = require('./aiEntityResolverV3.cjs');
const { inferParameterProvenance } = require('./aiReadInvestigationRuntimeV4.cjs');
