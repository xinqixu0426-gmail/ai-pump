const express = require('express');
const router = express.Router();
const { WRITE_TOOLS } = require('./tools.cjs');
const { getFactoryProfile } = require('./prompt.cjs');
const { executeToolCall } = require('./executor.cjs');
const {
    scopeAiContextForTurn,
    trimAiContext,
} = require('../../services/aiContext.cjs');
const {
    buildFreshLookupToolCalls,
    isDeterministicFreshLookupCalls,
} = require('../../services/aiFreshness.cjs');
const { composeAiSystemPrompt } = require('../../services/aiPromptComposer.cjs');
const { readAiProviderStream } = require('../../services/aiProviderStream.cjs');
const {
    appendRefreshedBusinessEvidence,
    buildAiToolCall,
    buildAiToolPlan,
    buildAiToolResultMessage,
    parseAiToolArguments,
    prepareAiToolCalls,
    prioritizeBusinessEvidence,
    viewTypeForAiTool,
} = require('../../services/aiToolProtocol.cjs');
const { routeAiTools } = require('./toolRouting.cjs');
const {
    buildWriteToolCorrection,
    isWriteClarificationReply,
    safeUnverifiedWriteReply,
    shouldRetryUnverifiedWriteReply,
} = require('../../services/aiWriteGuard.cjs');
const {
    aiProviderCapabilities,
    fetchAiProvider,
} = require('../../services/aiProvider.cjs');
const {
    normalizeAiPageContext,
    buildAiPageContextNote,
    resolveMessagesWithPageContext,
} = require('../../services/aiPageContext.cjs');
const authMiddleware = require('../../authMiddleware.cjs');
const {
    AiToolConfirmationError,
    completeAiToolConfirmation,
    confirmationSubjectForRequest,
    consumeAiToolConfirmation,
    failAiToolConfirmation,
} = require('../../services/aiToolConfirmation.cjs');
const {
    hasVerifiedExecution,
    hasVerifiedToolEvidence,
    hasVerifiedWriteExecution,
    safeMissingBusinessEvidenceReply,
} = require('../../services/aiExecutionEvidence.cjs');

function latestUserText(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'user' && typeof messages[index].content === 'string') {
            return messages[index].content;
        }
    }
    return '';
}

function buildSystemPrompt(options = {}) {
    return composeAiSystemPrompt({
        factoryProfile: getFactoryProfile(),
        domains: options.domains || [],
        query: options.query || '',
        extra: options.extra || '',
    });
}

function confirmAuth(req, res, next) {
    if (process.env.INTERNAL_SECRET && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET) {
        return next();
    }
    return authMiddleware(req, res, next);
}

function buildPendingWriteReply(toolResults) {
    const pending = toolResults.find(item => item?.result?.requiresConfirmation && item.result.confirmation);
    if (!pending) return '';
    const replies = {
        create_part: '好的，我来帮你新增这个零件，请核对下面的确认卡片。',
        batch_create_parts: '好的，我来批量录入这些零件，请核对整批确认卡片。',
        adjust_part_stock: '好的，我来批量调整这些零件的库存，请核对整批确认卡片。',
        update_part: '好的，我来帮你修改这个零件，请核对下面的确认卡片。',
        adjust_coil_stock: '好的，我来帮你调整线圈成品库存，请核对下面的确认卡片。',
        delete_part: '好的，我来帮你删除这个零件，请核对下面的确认卡片。',
        create_order: '好的，我来帮你新建这个订单，请核对下面的确认卡片。',
        update_order_status: '好的，我来帮你修改订单状态，请核对下面的确认卡片。',
        execute_order_readiness_action: '处理步骤当前可以执行，请核对下面的确认卡片。',
        create_recipe: '好的，我来帮你新建这个配方，请核对下面的确认卡片。',
        update_recipe: '好的，我来帮你修改这个配方，请核对下面的确认卡片。',
        delete_recipe: '好的，我来帮你删除这个配方，请核对下面的确认卡片。',
    };
    if (replies[pending.name]) return replies[pending.name];
    const title = pending.result.confirmation.title || '这个操作';
    return `好的，我来帮你处理「${title}」，请核对下面的确认卡片。`;
}

function hasPendingWriteConfirmation(toolResults) {
    return (toolResults || []).some(item => item?.result?.requiresConfirmation && item.result.confirmation);
}

function lacksStructuredWriteResult(toolRoute, toolResults, content) {
    if (!toolRoute?.writeIntent) return false;
    if (hasPendingWriteConfirmation(toolResults)) return false;
    if ((toolResults || []).some(item => hasVerifiedWriteExecution(item?.result))) return false;
    return !isWriteClarificationReply(content);
}

function toolsAfterDeterministicFreshLookup(tools, freshLookupCalls, toolResults) {
    const lookupCompleted = (
        isDeterministicFreshLookupCalls(freshLookupCalls)
        && toolResults.some(item => (
            item?.name === freshLookupCalls[0]?.name
            && item?.result
        ))
    );
    if (!lookupCompleted) return tools;

    return [];
}

router.get('/api/ai/capabilities', confirmAuth, (req, res) => {
    try {
        res.json({ success: true, data: aiProviderCapabilities() });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ── AI Chat SSE 端点 ──
router.post('/api/ai/chat', confirmAuth, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (type, payload) => {
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
        if (typeof res.flush === 'function') res.flush(); // 强制刷新，防止 compression 中间件缓冲
    };

    try {
        const confirmationSubject = confirmationSubjectForRequest(req);
        const messages = trimAiContext(req.body?.messages);
        const pageContext = normalizeAiPageContext(req.body?.pageContext);
        const routingMessages = resolveMessagesWithPageContext(messages, pageContext);
        const pageContextNote = buildAiPageContextNote(pageContext);
        const freshLookupCalls = buildFreshLookupToolCalls(routingMessages);
        const initialToolRoute = routeAiTools(routingMessages, {
            pageContext,
            requiredToolNames: freshLookupCalls.map(call => call.name),
        });
        const scopedMessages = scopeAiContextForTurn(messages, initialToolRoute);
        send('status', { status: 'thinking', message: '正在理解您的问题...' });

        let currentMessages = [
            {
                role: 'system',
                content: `${buildSystemPrompt({
                    domains: initialToolRoute.domains,
                    query: latestUserText(routingMessages),
                })}${pageContextNote ? `\n\n${pageContextNote}` : ''}`,
            },
            ...scopedMessages
        ];

        let maxRounds = 5;
        let done = false;
        let allToolResults = [];
        let evidenceContextPrioritized = false;
        let writeGuardRetries = 0;
        let lastProviderNotice = '';
        const announceProvider = (providerInfo) => {
            const key = [
                providerInfo.provider,
                providerInfo.model,
                providerInfo.fallback ? 'fallback' : 'primary',
            ].join(':');
            if (key === lastProviderNotice) return;
            lastProviderNotice = key;
            send('provider', providerInfo);
        };
        const prioritizeEvidence = () => {
            if (evidenceContextPrioritized) return;
            currentMessages = prioritizeBusinessEvidence(currentMessages, scopedMessages.length);
            evidenceContextPrioritized = true;
        };

        if (freshLookupCalls.length > 0) {
            send('tool_plan', {
                ...buildAiToolPlan(
                    freshLookupCalls.map((call, index) => (
                        buildAiToolCall(call.name, call.args, `fresh_lookup_${index}`)
                    )),
                    WRITE_TOOLS,
                    { source: 'rule' }
                ),
                summary: `正在刷新 ${freshLookupCalls.length} 项易变业务数据。`,
            });

            for (const call of freshLookupCalls) {
                send('tool_call', call);
                const result = await executeToolCall(call.name, call.args, {
                    allowWrite: false,
                    confirmationSubject,
                });
                send('tool_result', { name: call.name, result });
                allToolResults.push({ name: call.name, result });
            }
            currentMessages = appendRefreshedBusinessEvidence(currentMessages, allToolResults);
            prioritizeEvidence();
            if (hasPendingWriteConfirmation(allToolResults)) {
                send('status', { status: 'confirming', message: '等待确认后执行写操作' });
                send('content', { content: buildPendingWriteReply(allToolResults) });
                send('detail', {
                    detailType: allToolResults.length === 1 ? allToolResults[0].name : 'multi_tool',
                    toolResults: allToolResults,
                });
                send('done', {});
                done = true;
            } else if (!allToolResults.slice(-freshLookupCalls.length).every(
                item => hasVerifiedExecution(item?.result)
            )) {
                send('content', {
                    content: safeMissingBusinessEvidenceReply(
                        allToolResults.slice(-freshLookupCalls.length)
                    ),
                });
                send('detail', {
                    detailType: allToolResults.length === 1 ? allToolResults[0].name : 'multi_tool',
                    toolResults: allToolResults,
                });
                send('done', {});
                done = true;
            } else {
                send('status', { status: 'analyzing', message: '已刷新当前数据，正在分析...' });
            }
        }

        while (!done && maxRounds-- > 0) {
            let aiRes;
            let toolRoute;
            let offeredTools;
            try {
                toolRoute = routeAiTools(routingMessages, {
                    pageContext,
                    requiredToolNames: freshLookupCalls.map(call => call.name),
                    priorToolNames: allToolResults.map(item => item.name),
                });
                offeredTools = toolsAfterDeterministicFreshLookup(
                        toolRoute.tools,
                        freshLookupCalls,
                        allToolResults
                    );
                aiRes = await fetchAiProvider(currentMessages, {
                    tools: offeredTools,
                    stream: true,
                    onProvider: announceProvider,
                });
            } catch (err) {
                send('error', { message: err.message });
                return res.end();
            }

            const bufferBusinessReply = (
                toolRoute.toolNames.length > 0
                || allToolResults.length > 0
            );
            const providerStream = await readAiProviderStream(aiRes, {
                onContent: content => {
                    if (!bufferBusinessReply) send('content', { content });
                },
            });
            const msgContent = providerStream.content;
            const preparedToolCalls = prepareAiToolCalls(providerStream.toolCalls, 'model', {
                allowedToolNames: offeredTools.map(tool => tool.function.name),
                writeIntent: toolRoute.writeIntent,
                writeTools: WRITE_TOOLS,
            });
            const toolCallsArr = preparedToolCalls.map(item => item.toolCall);
            currentMessages.push({
                role: 'assistant',
                content: msgContent || "",
                tool_calls: toolCallsArr.length > 0 ? toolCallsArr : undefined
            });

            if (toolCallsArr.length > 0) {
                send('tool_plan', buildAiToolPlan(preparedToolCalls, WRITE_TOOLS));
                for (const preparedToolCall of preparedToolCalls) {
                    const tc = preparedToolCall.toolCall;
                    const funcName = tc.function.name;
                    send('status', {
                        status: preparedToolCall.validationStatus === 'rejected' ? 'analyzing' : 'calling',
                        message: preparedToolCall.validationStatus === 'rejected'
                            ? `${funcName} 参数未通过校验，已阻止执行`
                            : `正在调用: ${funcName}...`,
                    });

                    const args = parseAiToolArguments(tc.function.arguments);

                    send('tool_call', { name: funcName, args });
                    const result = preparedToolCall.validationStatus === 'rejected'
                        ? {
                            success: false,
                            error: preparedToolCall.validationError,
                            code: preparedToolCall.validationCode || 'INVALID_AI_BUSINESS_QUERY',
                            validation: { status: 'rejected', toolName: funcName },
                        }
                        : await executeToolCall(funcName, args, {
                            allowWrite: false,
                            confirmationSubject,
                        });
                    send('tool_result', { name: funcName, result });
                    send('status', {
                        status: hasPendingWriteConfirmation([{ name: funcName, result }]) ? 'confirming' : 'analyzing',
                        message: hasPendingWriteConfirmation([{ name: funcName, result }])
                            ? '等待确认后执行写操作'
                            : `已完成 ${funcName}，正在继续分析...`
                    });
                    
                    allToolResults.push({ name: funcName, result });

                    currentMessages.push(buildAiToolResultMessage(tc, result));
                }
                prioritizeEvidence();

                if (hasPendingWriteConfirmation(allToolResults)) {
                    const directReply = buildPendingWriteReply(allToolResults);
                    if (bufferBusinessReply || !msgContent.trim()) {
                        send('content', { content: directReply });
                    }
                    send('detail', {
                        detailType: allToolResults.length === 1 ? allToolResults[0].name : 'multi_tool',
                        toolResults: allToolResults
                    });
                    send('done', {});
                    done = true;
                } else {
                    send('status', { status: 'thinking', message: '正在根据工具结果继续推理...' });
                }
            } else {
                const missingBusinessEvidence = (
                    allToolResults.length > 0
                    && !hasVerifiedToolEvidence(allToolResults)
                );
                const guarded = shouldRetryUnverifiedWriteReply({
                    content: msgContent,
                    toolRoute,
                    writeTools: WRITE_TOOLS,
                }) || lacksStructuredWriteResult(toolRoute, allToolResults, msgContent);
                if (guarded && writeGuardRetries < 1) {
                    writeGuardRetries += 1;
                    currentMessages.push({
                        role: 'system',
                        content: buildWriteToolCorrection(toolRoute, WRITE_TOOLS),
                    });
                    send('status', {
                        status: 'thinking',
                        message: '正在校验写操作并生成真实确认卡片...',
                    });
                    continue;
                }
                if (bufferBusinessReply) {
                    send('content', {
                        content: missingBusinessEvidence
                            ? safeMissingBusinessEvidenceReply(allToolResults)
                            : guarded
                                ? safeUnverifiedWriteReply()
                                : msgContent,
                    });
                } else if (missingBusinessEvidence) {
                    send('content', {
                        content: safeMissingBusinessEvidenceReply(allToolResults),
                    });
                }
                if (allToolResults.length > 0) {
                    send('detail', {
                        detailType: allToolResults.length === 1 ? allToolResults[0].name : 'multi_tool',
                        toolResults: allToolResults
                    });
                }

                send('done', {});
                done = true;
            }
        }

        if (!done) {
            send('error', { message: '工具调用轮次超限' });
        }
        res.end();
    } catch (err) {
        send('error', { message: err.message });
        res.end();
    }
});

router.post('/api/ai/confirm-tool', confirmAuth, async (req, res) => {
    const confirmationSubject = confirmationSubjectForRequest(req);
    const { confirmationToken, toolName, args } = req.body || {};
    if (!confirmationToken) {
        return res.status(409).json({
            success: false,
            code: 'confirmation_token_required',
            error: '旧确认请求不能直接执行，请重新发起操作并核对新的确认卡片',
            requestId: req.requestId || null,
        });
    }

    let consumed = null;
    try {
        consumed = consumeAiToolConfirmation({
            confirmationToken,
            subject: confirmationSubject,
            expectedToolName: toolName,
            expectedArgs: Object.prototype.hasOwnProperty.call(req.body || {}, 'args') ? args : undefined,
        });
        if (consumed.replay) {
            return res.json({
                success: true,
                data: {
                    ...consumed.receipt,
                    idempotentReplay: true,
                },
            });
        }

        const result = await executeToolCall(consumed.toolName, consumed.args, {
            allowWrite: true,
            operationId: consumed.operationId,
            confirmationContext: consumed.executionContext,
        });
        if (!result || result.success === false || !hasVerifiedWriteExecution(result)) {
            const executionError = new Error(
                result?.error || '正式业务 API 未返回可验证的写操作回执'
            );
            executionError.code = result?.code || 'ai_write_evidence_missing';
            executionError.statusCode = 502;
            throw executionError;
        }
        const completedAt = new Date().toISOString();
        const receipt = {
            name: consumed.toolName,
            result,
            capabilityId: consumed.capabilityId,
            operationId: consumed.operationId,
            status: 'completed',
            changes: Array.isArray(result?.changes) ? result.changes : [],
            warnings: Array.isArray(result?.warnings) ? result.warnings : [],
            auditId: result?.auditId
                ?? result.executionEvidence.receipts[0]?.auditIds?.[0]
                ?? null,
            auditIds: result?.auditIds
                ?? result.executionEvidence.receipts.flatMap(receipt => receipt.auditIds || []),
            idempotentReplay: false,
            completedAt,
        };
        completeAiToolConfirmation({
            confirmationToken,
            subject: confirmationSubject,
            receipt,
        });
        return res.json({ success: true, data: receipt });
    } catch (err) {
        if (consumed && !consumed.replay) {
            try {
                failAiToolConfirmation({
                    confirmationToken,
                    subject: confirmationSubject,
                    error: err,
                });
            } catch {
                // 保留原始执行错误。
            }
        }
        const statusCode = err instanceof AiToolConfirmationError ? err.statusCode : 500;
        return res.status(statusCode).json({
            success: false,
            code: err.code || 'confirmation_execution_error',
            error: err.message,
            operationId: consumed?.operationId || null,
            requestId: req.requestId || null,
        });
    }
});



/**
 * 通用 AI 对话处理函数
 */
async function processAiChat(text, options = {}) {
    const {
        context = [],
        promptSuffix = '',
        allowWrite = false,
        pageContext: rawPageContext = null,
        confirmationSubject = 'internal:process-ai-chat',
    } = options;
    const toolResults = [];

    const messages = trimAiContext([
        ...(Array.isArray(context) ? context : []),
        { role: 'user', content: text },
    ]);

    const pageContext = normalizeAiPageContext(rawPageContext);
    const routingMessages = resolveMessagesWithPageContext(messages, pageContext);
    const pageContextNote = buildAiPageContextNote(pageContext);
    const freshLookupCalls = buildFreshLookupToolCalls(routingMessages);
    const initialToolRoute = routeAiTools(routingMessages, {
        pageContext,
        requiredToolNames: freshLookupCalls.map(call => call.name),
    });
    const scopedMessages = scopeAiContextForTurn(messages, initialToolRoute);

    let currentMessages = [
        {
            role: 'system',
            content: `${buildSystemPrompt({
                domains: initialToolRoute.domains,
                query: latestUserText(routingMessages),
                extra: promptSuffix,
            })}${pageContextNote ? `\n\n${pageContextNote}` : ''}`,
        },
        ...scopedMessages
    ];

    let maxRounds = 5;
    let done = false;
    let finalContent = '';
    let evidenceContextPrioritized = false;
    let writeGuardRetries = 0;
    const prioritizeEvidence = () => {
        if (evidenceContextPrioritized) return;
        currentMessages = prioritizeBusinessEvidence(currentMessages, scopedMessages.length);
        evidenceContextPrioritized = true;
    };

    for (const call of freshLookupCalls) {
        const result = await executeToolCall(call.name, call.args, {
            allowWrite: false,
            confirmationSubject,
        });
        toolResults.push({ name: call.name, view_type: viewTypeForAiTool(call.name), result });
    }
    if (toolResults.length > 0) {
        currentMessages = appendRefreshedBusinessEvidence(currentMessages, toolResults);
        prioritizeEvidence();
        if (hasPendingWriteConfirmation(toolResults)) {
            finalContent = buildPendingWriteReply(toolResults);
            done = true;
        } else if (!toolResults.slice(-freshLookupCalls.length).every(
            item => hasVerifiedExecution(item?.result)
        )) {
            finalContent = safeMissingBusinessEvidenceReply(
                toolResults.slice(-freshLookupCalls.length)
            );
            done = true;
        }
    }

    while (!done && maxRounds-- > 0) {
        const toolRoute = routeAiTools(routingMessages, {
            pageContext,
            requiredToolNames: freshLookupCalls.map(call => call.name),
            priorToolNames: toolResults.map(item => item.name),
        });
        const offeredTools = toolsAfterDeterministicFreshLookup(
                toolRoute.tools,
                freshLookupCalls,
                toolResults
            );
        const aiRes = await fetchAiProvider(currentMessages, {
            tools: offeredTools,
            stream: false,
        });

        const data = await aiRes.json();
        if (data.error) {
            throw new Error(data.error.message || 'API 错误');
        }

        const msg = data.choices[0].message;
        currentMessages.push({
            role: 'assistant',
            content: msg.content || "",
            tool_calls: msg.tool_calls
        });

        const preparedToolCalls = prepareAiToolCalls(msg.tool_calls || [], 'model', {
            allowedToolNames: offeredTools.map(tool => tool.function.name),
            writeIntent: toolRoute.writeIntent,
            writeTools: WRITE_TOOLS,
        });
        if (preparedToolCalls.length > 0) {
            for (const preparedToolCall of preparedToolCalls) {
                const tc = preparedToolCall.toolCall;
                const funcName = tc.function.name;
                console.log(`[AI] 调用工具: ${funcName}`);

                const args = parseAiToolArguments(tc.function.arguments);

                const result = preparedToolCall.validationStatus === 'rejected'
                    ? {
                        success: false,
                        error: preparedToolCall.validationError,
                        code: preparedToolCall.validationCode || 'INVALID_AI_BUSINESS_QUERY',
                        validation: { status: 'rejected', toolName: funcName },
                    }
                    : await executeToolCall(funcName, args, {
                        allowWrite,
                        confirmationSubject,
                    });
                const viewType = viewTypeForAiTool(funcName);

                toolResults.push({ name: funcName, view_type: viewType, result });

                currentMessages.push(buildAiToolResultMessage(tc, result));
            }
            prioritizeEvidence();
            if (hasPendingWriteConfirmation(toolResults)) {
                finalContent = buildPendingWriteReply(toolResults);
                done = true;
            }
        } else {
            const missingBusinessEvidence = (
                toolResults.length > 0
                && !hasVerifiedToolEvidence(toolResults)
            );
            const guarded = shouldRetryUnverifiedWriteReply({
                content: msg.content || '',
                toolRoute,
                writeTools: WRITE_TOOLS,
            }) || lacksStructuredWriteResult(toolRoute, toolResults, msg.content || '');
            if (guarded && writeGuardRetries < 1) {
                writeGuardRetries += 1;
                currentMessages.push({
                    role: 'system',
                    content: buildWriteToolCorrection(toolRoute, WRITE_TOOLS),
                });
                continue;
            }
            finalContent = missingBusinessEvidence
                ? safeMissingBusinessEvidenceReply(toolResults)
                : guarded
                    ? safeUnverifiedWriteReply()
                    : (msg.content || '');
            done = true;
        }
    }

    // 提取 speech：取 AI 回复的第一句话（句号或换行前）
    const speech = finalContent
        .split(/[。\n]/)[0]
        .replace(/[*#`\-]/g, '')
        .trim() || finalContent.slice(0, 100);

    return { finalContent, toolResults, speech };
}



module.exports = { router, processAiChat };
