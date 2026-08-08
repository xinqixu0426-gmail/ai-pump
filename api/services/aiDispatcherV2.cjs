const { WRITE_TOOLS } = require('../routes/ai/tools.cjs');
const { executeToolCall } = require('../routes/ai/executor.cjs');
const { getFactoryProfile } = require('../routes/ai/prompt.cjs');
const { getAiCapability } = require('../capabilities/registry.cjs');
const {
    scopeAiContextForIntent,
    trimAiContext,
} = require('./aiContext.cjs');
const {
    plannedCapabilityNames,
    selectToolsForIntent,
} = require('./aiCapabilityCatalogV2.cjs');
const { planAiIntentV2 } = require('./aiIntentPlannerV2.cjs');
const { composeAiSystemPrompt } = require('./aiPromptComposer.cjs');
const { readAiProviderStream } = require('./aiProviderStream.cjs');
const { fetchAiProvider } = require('./aiProvider.cjs');
const {
    buildAiToolPlan,
    buildAiToolResultMessage,
    parseAiToolArguments,
    prepareAiToolCalls,
    prioritizeBusinessEvidence,
    viewTypeForAiTool,
} = require('./aiToolProtocol.cjs');
const {
    hasVerifiedExecution,
    hasVerifiedToolEvidence,
    hasVerifiedWriteExecution,
    safeMissingBusinessEvidenceReply,
} = require('./aiExecutionEvidence.cjs');
const { safeUnverifiedWriteReply } = require('./aiSafetyReplies.cjs');
const {
    buildAiPageContextNote,
    normalizeAiPageContext,
} = require('./aiPageContext.cjs');

const MAX_TOOL_ROUNDS = 7;
const MAX_TOOL_CALLS = 10;

function latestUserText(messages = []) {
    return [...messages].reverse().find(message => (
        message?.role === 'user' && typeof message.content === 'string'
    ))?.content?.trim() || '';
}

function pendingConfirmation(toolResults) {
    return toolResults.find(item => (
        item?.result?.requiresConfirmation && item.result.confirmation
    )) || null;
}

function buildPendingWriteReply(toolResults) {
    const pending = pendingConfirmation(toolResults);
    if (!pending) return '';
    const title = pending.result.confirmation.title
        || pending.result.confirmation.displayName
        || '这个操作';
    return `## 待确认\n\n已生成「${title}」的正式确认卡片。请核对目标、数量和变更前后值后再确认。`;
}

function answerInstruction(intent) {
    const shapeRules = {
        direct: '直接回答目标，不增加无关背景。',
        count_with_brief: '第一句先给准确数量；随后只对命中对象给最短简报，不输出相邻业务统计。',
        list: '只列出符合正式筛选条件的对象；数量少时逐项简报，数量多时用紧凑清单。可按 API 已有字段分段，但不得自行计算分组数量、追加风险分析或推荐下一步。',
        comparison: '按用户关心的同一组指标对齐比较，并明确差异结论。',
        explanation: '先给结论，再给可由本轮证据核验的关键原因；不展示内部推理链。',
        confirmation: '只说明正式确认卡片已生成及需要核对的关键项，不自行生成文字卡片。',
    };
    return [
        '【V2 当前任务契约】',
        `用户目标：${intent.goal}`,
        `回答形式：${intent.answerShape}。${shapeRules[intent.answerShape] || shapeRules.direct}`,
        `业务事实要求：${intent.needsBusinessData ? '只能来自本轮正式工具结果' : '无需业务工具时可直接回答'}`,
        '内部 id、sourceId、数据库序号和工具调用编号只用于系统关联；除非用户明确询问编号或确认操作必须展示，否则最终回复不得输出。',
        '只回答用户当前问题，不补充未询问的相邻统计、风险判断、相似项分析、原因猜测或后续建议；正式结果没有提供的汇总不得由模型自行计算。',
        '不要展示意图分类、能力名称、执行计划、内部思考或逐步推理。',
    ].join('\n');
}

function requiredEvidenceSatisfied(intent, toolResults) {
    if (!intent.needsBusinessData) return true;
    if (
        !hasVerifiedToolEvidence(toolResults)
        || toolResults.some(item => item?.result?.success === false)
    ) return false;
    const called = new Set(toolResults.map(item => item.name));
    return plannedCapabilityNames(intent).every(name => called.has(name));
}

function missingEvidenceReply(intent, toolResults) {
    const required = plannedCapabilityNames(intent);
    const called = new Set(toolResults.map(item => item.name));
    const missing = required.filter(name => !called.has(name));
    if (missing.length === 0) return safeMissingBusinessEvidenceReply(toolResults);
    return `${safeMissingBusinessEvidenceReply(toolResults)}\n\n缺少计划中的正式查询：${missing.join('、')}。`;
}

function readProviderMessage(data) {
    if (data?.error) throw new Error(data.error.message || 'AI API 错误');
    const message = data?.choices?.[0]?.message;
    if (!message) throw new Error('AI API 未返回有效消息');
    return message;
}

function containsEmbeddedToolProtocol(content) {
    const text = String(content || '');
    return /DSML[\s\S]{0,40}tool_calls|<\/?(?:tool_calls?|function_calls?|invoke)(?:\s|>)/i.test(text);
}

async function synthesizeVerifiedAnswer(input = {}) {
    const evidence = input.toolResults.map(item => ({
        capabilityName: item.name,
        result: item.result,
    }));
    const messages = [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userText },
        {
            role: 'system',
            content: `【V2 已验证证据】\n计划内业务能力已经全部执行完成。只根据下列正式结果回答当前问题；禁止继续调用、建议调用或以文本模拟工具，不得补写证据中没有的业务事实。\n${JSON.stringify(evidence)}`,
        },
    ];
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await input.provider(messages, {
            tools: [],
            stream: false,
            onProvider: input.onProvider,
            env: input.env,
            dbAccessors: input.dbAccessors,
        });
        const message = readProviderMessage(await response.json());
        const content = String(message.content || '').trim();
        if (!message.tool_calls?.length && content && !containsEmbeddedToolProtocol(content)) {
            return content;
        }
        messages.push({
            role: 'system',
            content: '上一次输出不是可展示的最终答案。请立即用普通 Markdown 给出结果和结论，不得输出任何工具调用或内部协议标记。',
        });
    }
    throw new Error('AI 回答提取阶段未返回可展示结果');
}

async function runAiDispatcherV2(input = {}) {
    const emit = typeof input.emit === 'function' ? input.emit : () => {};
    const messages = trimAiContext(input.messages);
    const pageContext = normalizeAiPageContext(input.pageContext);
    const provider = input.fetchAiProvider || fetchAiProvider;
    const confirmationSubject = input.confirmationSubject || 'internal:ai-dispatcher-v2';
    const announceProvider = input.onProvider || (info => emit('provider', info));

    emit('status', { status: 'thinking', message: '正在理解您的目标...' });
    const intent = await planAiIntentV2(messages, {
        pageContext,
        onProvider: announceProvider,
        fetchAiProvider: provider,
        env: input.env,
        dbAccessors: input.dbAccessors,
    });
    if (intent.steps.length > 0) {
        emit('tool_plan', {
            summary: `已规划 ${intent.steps.length} 个必要业务步骤。`,
            steps: intent.steps.map((step, index) => {
                const capability = getAiCapability(step.capabilityName);
                const write = capability?.access === 'write';
                return {
                    index: index + 1,
                    name: step.capabilityName,
                    label: capability?.displayName || step.capabilityName,
                    mode: write ? 'write' : 'read',
                    requiresConfirmation: write,
                    source: 'model',
                    argsSummary: [{ key: '目标', value: step.objective }],
                };
            }),
        });
    }

    const scopedMessages = scopeAiContextForIntent(messages, intent);
    const offeredTools = intent.requiresClarification
        ? selectToolsForIntent(intent, { maxTools: 8 })
        : selectToolsForIntent(intent);
    const allowedToolNames = offeredTools.map(tool => tool.function.name);
    const pageContextNote = buildAiPageContextNote(pageContext);
    const systemPrompt = composeAiSystemPrompt({
        factoryProfile: getFactoryProfile(),
        domains: intent.domains,
        query: latestUserText(messages),
        extra: [
            input.promptSuffix || '',
            answerInstruction(intent),
            pageContextNote,
        ].filter(Boolean).join('\n\n'),
    });
    let currentMessages = [{ role: 'system', content: systemPrompt }, ...scopedMessages];
    const toolResults = [];
    let finalContent = '';
    let evidencePrioritized = false;
    let toolCallCount = 0;
    let readCorrectionUsed = false;
    let responseProtocolCorrectionUsed = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const calledToolNames = new Set(toolResults.map(item => item.name));
        const nextPlannedCapability = plannedCapabilityNames(intent)
            .find(name => !calledToolNames.has(name));
        const plannedTool = nextPlannedCapability
            ? offeredTools.find(tool => tool.function.name === nextPlannedCapability)
            : null;
        const roundTools = plannedTool ? [plannedTool] : [];
        if (!plannedTool) {
            currentMessages.push({
                role: 'system',
                content: '计划内业务能力已经全部执行完成。现在必须只根据已有正式结果直接回答用户；禁止继续调用、建议调用或以文本模拟任何工具协议。',
            });
        }
        const response = await provider(currentMessages, {
            tools: roundTools,
            ...(plannedTool ? {
                toolChoice: {
                    type: 'function',
                    function: { name: nextPlannedCapability },
                },
            } : {}),
            stream: Boolean(input.stream),
            onProvider: announceProvider,
            env: input.env,
            dbAccessors: input.dbAccessors,
        });

        let content = '';
        let rawToolCalls = [];
        const bufferReply = intent.needsBusinessData || intent.mode === 'command' || toolResults.length > 0;
        if (input.stream) {
            const streamResult = await readAiProviderStream(response, {
                onContent: chunk => {
                    if (!bufferReply) emit('content', { content: chunk });
                },
            });
            content = streamResult.content || '';
            rawToolCalls = streamResult.toolCalls || [];
        } else {
            const message = readProviderMessage(await response.json());
            content = message.content || '';
            rawToolCalls = message.tool_calls || [];
        }

        if (rawToolCalls.length === 0 && containsEmbeddedToolProtocol(content)) {
            if (responseProtocolCorrectionUsed) {
                throw new Error('AI 返回了不可展示的工具协议文本');
            }
            responseProtocolCorrectionUsed = true;
            currentMessages.push({ role: 'assistant', content });
            currentMessages.push({
                role: 'system',
                content: '上一次输出是内部工具协议文本，不能展示给用户。工具阶段已经结束，请立即用普通 Markdown 给出最终结论，不得再输出任何工具标记。',
            });
            continue;
        }

        const preparedCalls = prepareAiToolCalls(rawToolCalls, 'model', {
            allowedToolNames,
            writeIntent: intent.mode === 'command',
            writeTools: WRITE_TOOLS,
        });
        const toolCalls = preparedCalls.map(item => item.toolCall);
        currentMessages.push({
            role: 'assistant',
            content,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        });

        if (toolCalls.length > 0) {
            if (toolCallCount + toolCalls.length > MAX_TOOL_CALLS) {
                throw new Error(`V2 工具调用超过单轮上限 ${MAX_TOOL_CALLS}`);
            }
            toolCallCount += toolCalls.length;
            emit('tool_plan', buildAiToolPlan(preparedCalls, WRITE_TOOLS));
            for (const prepared of preparedCalls) {
                const toolCall = prepared.toolCall;
                const name = toolCall.function.name;
                const args = parseAiToolArguments(toolCall.function.arguments);
                emit('status', {
                    status: prepared.validationStatus === 'rejected' ? 'analyzing' : 'calling',
                    message: prepared.validationStatus === 'rejected'
                        ? `${name} 参数未通过契约校验，已阻止执行`
                        : `正在调用: ${name}...`,
                });
                emit('tool_call', { name, args });
                const result = prepared.validationStatus === 'rejected'
                    ? {
                        success: false,
                        code: prepared.validationCode || 'INVALID_AI_TOOL_INPUT',
                        error: prepared.validationError,
                        validation: { status: 'rejected', toolName: name },
                    }
                    : await executeToolCall(name, args, {
                        allowWrite: Boolean(input.allowWrite),
                        confirmationSubject,
                    });
                toolResults.push({ name, view_type: viewTypeForAiTool(name), result });
                currentMessages.push(buildAiToolResultMessage(toolCall, result));
                emit('tool_result', { name, result });
            }
            if (!evidencePrioritized) {
                currentMessages = prioritizeBusinessEvidence(currentMessages, scopedMessages.length);
                evidencePrioritized = true;
            }

            if (pendingConfirmation(toolResults)) {
                finalContent = buildPendingWriteReply(toolResults);
                emit('status', { status: 'confirming', message: '等待确认后执行写操作' });
                break;
            }
            if (toolResults.some(item => (
                item?.result?.success === false || !hasVerifiedExecution(item.result)
            ))) {
                finalContent = safeMissingBusinessEvidenceReply(toolResults);
                break;
            }
            if (requiredEvidenceSatisfied(intent, toolResults)) {
                finalContent = await synthesizeVerifiedAnswer({
                    provider,
                    systemPrompt,
                    userText: latestUserText(messages),
                    intent,
                    toolResults,
                    onProvider: announceProvider,
                    env: input.env,
                    dbAccessors: input.dbAccessors,
                });
                break;
            }
            emit('status', { status: 'analyzing', message: '已取得正式结果，正在整理结论...' });
            continue;
        }

        if (
            intent.needsBusinessData
            && !requiredEvidenceSatisfied(intent, toolResults)
            && toolResults.length === 0
            && !readCorrectionUsed
            && allowedToolNames.length > 0
        ) {
            readCorrectionUsed = true;
            currentMessages.push({
                role: 'system',
                content: `当前目标需要正式业务证据。请从已提供能力中调用计划所需工具：${plannedCapabilityNames(intent).join('、')}。不得直接回答。`,
            });
            emit('status', { status: 'thinking', message: '正在选择正式业务能力...' });
            continue;
        }

        if (intent.needsBusinessData && !requiredEvidenceSatisfied(intent, toolResults)) {
            finalContent = missingEvidenceReply(intent, toolResults);
        } else if (
            intent.mode === 'command'
            && !intent.requiresClarification
            && !toolResults.some(item => hasVerifiedWriteExecution(item.result))
        ) {
            finalContent = safeUnverifiedWriteReply();
        } else {
            finalContent = content;
        }
        break;
    }

    if (!finalContent) throw new Error('AI 调度器 V2 未在限定轮次内完成');
    if (input.stream && (intent.needsBusinessData || intent.mode === 'command' || toolResults.length > 0)) {
        emit('content', { content: finalContent });
    }
    if (toolResults.length > 0) {
        emit('detail', {
            detailType: toolResults.length === 1 ? toolResults[0].name : 'multi_tool',
            toolResults,
        });
    }
    emit('done', {});

    const speech = finalContent
        .split(/[。\n]/)[0]
        .replace(/[*#`\-]/g, '')
        .trim() || finalContent.slice(0, 100);
    return { finalContent, toolResults, speech, intent };
}

module.exports = {
    MAX_TOOL_CALLS,
    MAX_TOOL_ROUNDS,
    answerInstruction,
    buildPendingWriteReply,
    containsEmbeddedToolProtocol,
    requiredEvidenceSatisfied,
    runAiDispatcherV2,
    synthesizeVerifiedAnswer,
};
