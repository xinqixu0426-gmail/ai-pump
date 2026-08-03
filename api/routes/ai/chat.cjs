const express = require('express');
const router = express.Router();
const { WRITE_TOOLS } = require('./tools.cjs');
const { getFactoryProfile } = require('./prompt.cjs');
const { executeToolCall } = require('./executor.cjs');
const { trimAiContext } = require('../../services/aiContext.cjs');
const { buildFreshLookupToolCalls } = require('../../services/aiFreshness.cjs');
const { composeAiSystemPrompt } = require('../../services/aiPromptComposer.cjs');
const { readAiProviderStream } = require('../../services/aiProviderStream.cjs');
const {
    appendRefreshedBusinessEvidence,
    buildAiToolCall,
    buildAiToolPlan,
    buildAiToolResultMessage,
    parseAiToolArguments,
    prioritizeBusinessEvidence,
    viewTypeForAiTool,
} = require('../../services/aiToolProtocol.cjs');
const { routeAiTools } = require('./toolRouting.cjs');
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
        send('status', { status: 'thinking', message: '正在理解您的问题...' });

        let currentMessages = [
            {
                role: 'system',
                content: `${buildSystemPrompt({
                    domains: initialToolRoute.domains,
                    query: latestUserText(routingMessages),
                })}${pageContextNote ? `\n\n${pageContextNote}` : ''}`,
            },
            ...messages
        ];

        let maxRounds = 5;
        let done = false;
        let allToolResults = [];
        let evidenceContextPrioritized = false;
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
            currentMessages = prioritizeBusinessEvidence(currentMessages, messages.length);
            evidenceContextPrioritized = true;
        };

        if (freshLookupCalls.length > 0) {
            send('tool_plan', {
                ...buildAiToolPlan(
                    freshLookupCalls.map((call, index) => (
                        buildAiToolCall(call.name, call.args, `fresh_lookup_${index}`)
                    )),
                    WRITE_TOOLS
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
            } else {
                send('status', { status: 'analyzing', message: '已刷新当前数据，正在分析...' });
            }
        }

        while (!done && maxRounds-- > 0) {
            let aiRes;
            try {
                const toolRoute = routeAiTools(routingMessages, {
                    pageContext,
                    requiredToolNames: freshLookupCalls.map(call => call.name),
                    priorToolNames: allToolResults.map(item => item.name),
                });
                aiRes = await fetchAiProvider(currentMessages, {
                    tools: toolRoute.tools,
                    stream: true,
                    onProvider: announceProvider,
                });
            } catch (err) {
                send('error', { message: err.message });
                return res.end();
            }

            const providerStream = await readAiProviderStream(aiRes, {
                onContent: content => send('content', { content }),
            });
            const msgContent = providerStream.content;
            const toolCallsArr = providerStream.toolCalls;
            currentMessages.push({
                role: 'assistant',
                content: msgContent || "",
                tool_calls: toolCallsArr.length > 0 ? toolCallsArr : undefined
            });

            if (toolCallsArr.length > 0) {
                send('tool_plan', buildAiToolPlan(toolCallsArr, WRITE_TOOLS));
                for (const tc of toolCallsArr) {
                    const funcName = tc.function.name;
                    send('status', { status: 'calling', message: `正在调用: ${funcName}...` });

                    const args = parseAiToolArguments(tc.function.arguments);

                    send('tool_call', { name: funcName, args });
                    const result = await executeToolCall(funcName, args, {
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
                    if (!msgContent.trim()) {
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
        });
        const completedAt = new Date().toISOString();
        const receipt = {
            name: consumed.toolName,
            result,
            capabilityId: consumed.capabilityId,
            operationId: consumed.operationId,
            status: result?.success === false ? 'failed' : (result?.status || 'completed'),
            changes: Array.isArray(result?.changes) ? result.changes : [],
            warnings: Array.isArray(result?.warnings) ? result.warnings : [],
            auditId: result?.auditId ?? null,
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

    let currentMessages = [
        {
            role: 'system',
            content: `${buildSystemPrompt({
                domains: initialToolRoute.domains,
                query: latestUserText(routingMessages),
                extra: promptSuffix,
            })}${pageContextNote ? `\n\n${pageContextNote}` : ''}`,
        },
        ...messages
    ];

    let maxRounds = 5;
    let done = false;
    let finalContent = '';
    let evidenceContextPrioritized = false;
    const prioritizeEvidence = () => {
        if (evidenceContextPrioritized) return;
        currentMessages = prioritizeBusinessEvidence(currentMessages, messages.length);
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
        }
    }

    while (!done && maxRounds-- > 0) {
        const toolRoute = routeAiTools(routingMessages, {
            pageContext,
            requiredToolNames: freshLookupCalls.map(call => call.name),
            priorToolNames: toolResults.map(item => item.name),
        });
        const aiRes = await fetchAiProvider(currentMessages, {
            tools: toolRoute.tools,
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

        if (msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
                const funcName = tc.function.name;
                console.log(`[AI] 调用工具: ${funcName}`);

                const args = parseAiToolArguments(tc.function.arguments);

                const result = await executeToolCall(funcName, args, {
                    allowWrite,
                    confirmationSubject,
                });
                const viewType = viewTypeForAiTool(funcName);

                toolResults.push({ name: funcName, view_type: viewType, result });

                currentMessages.push(buildAiToolResultMessage(tc, result));
            }
            prioritizeEvidence();
        } else {
            finalContent = msg.content || '';
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
