const express = require('express');
const router = express.Router();
const { WRITE_TOOLS } = require('./tools.cjs');
const { getFactoryProfile } = require('./prompt.cjs');
const { executeToolCall } = require('./executor.cjs');
const { trimAiContext, prioritizeCurrentEvidence } = require('../../services/aiContext.cjs');
const { buildFreshLookupToolCalls } = require('../../services/aiFreshness.cjs');
const { composeAiSystemPrompt } = require('../../services/aiPromptComposer.cjs');
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

const TOOL_PLAN_LABELS = {
    full_calculate: '完整成本估算',
    get_copper_price: '查询铜价',
    calculate_coil_cost: '计算线圈成本',
    get_coil_specs: '读取线圈规格',
    adjust_coil_stock: '调整线圈库存',
    get_all_recipes: '读取配方列表',
    dynamic_config_cost: '计算动态配置成本',
    get_recent_orders: '读取最近订单',
    create_part: '新建零件',
    create_order: '新建订单',
    add_recipe_to_order: '订单追加产品',
    update_part: '修改零件',
    get_order_detail: '读取订单详情',
    get_order_knowledge_package: '读取订单知识包',
    get_management_action_center: '读取管理待办',
    get_order_readiness_overview: '读取订单准备总览',
    check_order_readiness: '检查订单生产准备',
    plan_order_readiness_actions: '生成订单处理方案',
    execute_order_readiness_action: '执行订单处理步骤',
    update_order_status: '修改订单状态',
    remove_recipe_from_order: '订单移除产品',
    update_order_item: '修改订单产品',
    generate_purchase_list: '生成采购清单',
    delete_order: '删除订单',
    create_recipe: '新建配方',
    delete_recipe: '删除配方',
    update_recipe: '修改配方',
    search_factory_file_archive_targets: '查找文件归档目标',
    archive_factory_file: '归档工厂文件',
    build_recipe_bom_draft: '生成 BOM 草稿',
    preview_recipe_cost: '配方成本试算',
    preview_pump_shell_cost: '泵壳成本试算',
    inspect_quotation_file: '识别报价文件',
    build_quotation_draft: '生成报价草稿',
    build_order_draft: '生成订单草稿',
    search_customer_history: '查询客户历史',
    explain_cost_change: '解释成本差异',
    get_data_quality_summary: '读取数据质量',
    analyze_recipe_configuration: '智能检查配方',
    set_recipe_analysis_feedback: '保存配方检查反馈',
    get_factory_learning_health: '检查学习证据健康状态',
    get_factory_rule_candidates: '读取候选业务规则',
    get_factory_rule_impact: '分析规则影响范围',
    get_factory_rule_compliance: '检查规则执行情况',
    get_factory_rule_history: '读取规则变更记录',
    restore_factory_rule_event: '恢复规则审核状态',
    refresh_factory_rule_candidates: '归纳候选业务规则',
    review_factory_rule_candidate: '审核候选业务规则',
    get_business_alerts: '读取经营异常',
    search_factory_knowledge: '搜索工厂知识库',
    get_factory_knowledge_detail: '读取知识详情',
    get_factory_knowledge_health: '检查知识库健康状态',
    sync_factory_knowledge: '同步工厂知识库',
    compare_recipes: '对比配方',
    search_parts: '搜索零件',
    delete_part: '删除零件',
    batch_update_prices: '批量调价',
    get_dashboard_summary: '读取运营看板',
    generate_rotor_drawing: '生成转子图纸',
    print_rotor_drawing: '打印转子图纸',
    get_rotor_drawing_history: '读取出图历史',
};

function compactValue(value) {
    if (value === undefined || value === null || value === '') return '';
    if (Array.isArray(value)) return `共 ${value.length} 项`;
    if (typeof value === 'object') return '已提供';
    return String(value);
}

function summarizeArgs(args = {}) {
    return Object.entries(args || {})
        .map(([key, value]) => ({ key, value: compactValue(value) }))
        .filter(item => item.value)
        .slice(0, 6);
}

function buildToolPlan(toolCalls = []) {
    const steps = toolCalls.map((tc, index) => {
        const name = tc.function?.name || '';
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
        const write = WRITE_TOOLS.has(name);
        return {
            index: index + 1,
            name,
            label: TOOL_PLAN_LABELS[name] || name,
            mode: write ? 'write' : 'read',
            requiresConfirmation: write,
            argsSummary: summarizeArgs(args),
        };
    });
    const writeCount = steps.filter(step => step.mode === 'write').length;
    return {
        steps,
        summary: writeCount > 0
            ? `准备执行 ${steps.length} 个步骤，其中 ${writeCount} 个写操作需要确认。`
            : `准备执行 ${steps.length} 个只读/试算步骤。`,
    };
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
            currentMessages = prioritizeCurrentEvidence(currentMessages, messages.length);
            currentMessages[0].content += '\n\n【本轮证据优先】已经获得本轮工具结果。历史 assistant 回答仅是旧回复，不是事实来源，不得用于补充、反转或解释本轮工具证据。最终结论只能来自本轮工具结果和明确业务规则。';
            evidenceContextPrioritized = true;
        };

        if (freshLookupCalls.length > 0) {
            send('tool_plan', {
                ...buildToolPlan(freshLookupCalls.map((call, index) => ({
                    id: `fresh_lookup_${index}`,
                    type: 'function',
                    function: { name: call.name, arguments: JSON.stringify(call.args) },
                }))),
                summary: `正在刷新 ${freshLookupCalls.length} 项易变业务数据。`,
            });

            for (const call of freshLookupCalls) {
                send('tool_call', call);
                const result = await executeToolCall(call.name, call.args, { allowWrite: false });
                send('tool_result', { name: call.name, result });
                allToolResults.push({ name: call.name, result });
            }
            currentMessages[0].content += `\n\n【本轮服务端已刷新数据】\n${JSON.stringify(allToolResults)}\n必须以这些本轮查询结果为准，不得复述历史数字。`;
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

            let msgContent = '';
            let toolCallsMap = {};
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            const reader = aiRes.body.getReader();
            while (true) {
                const { done: streamDone, value } = await reader.read();
                if (streamDone) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (let line of lines) {
                    line = line.trim();
                    if (!line || !line.startsWith('data: ')) continue;
                    
                    const jsonStr = line.substring(6).trim();
                    if (jsonStr === '[DONE]') continue;
                    
                    try {
                        const data = JSON.parse(jsonStr);
                        const delta = data.choices[0].delta;
                        
                        if (delta.content) {
                            msgContent += delta.content;
                            send('content', { content: delta.content });
                        }
                        
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                if (!toolCallsMap[tc.index]) {
                                    toolCallsMap[tc.index] = {
                                        id: tc.id || '',
                                        type: tc.type || 'function',
                                        function: {
                                            name: tc.function?.name || '',
                                            arguments: tc.function?.arguments || ''
                                        }
                                    };
                                } else {
                                    if (tc.id) toolCallsMap[tc.index].id += tc.id;
                                    if (tc.function?.name) toolCallsMap[tc.index].function.name += tc.function.name;
                                    if (tc.function?.arguments) toolCallsMap[tc.index].function.arguments += tc.function.arguments;
                                }
                            }
                        }
                    } catch(e) {
                        // ignore parse errors for partial chunks
                    }
                }
            }
            
            // 冲刷 decoder
            buffer += decoder.decode();

            const toolCallsArr = Object.values(toolCallsMap);
            currentMessages.push({
                role: 'assistant',
                content: msgContent || "",
                tool_calls: toolCallsArr.length > 0 ? toolCallsArr : undefined
            });

            if (toolCallsArr.length > 0) {
                send('tool_plan', buildToolPlan(toolCallsArr));
                for (const tc of toolCallsArr) {
                    const funcName = tc.function.name;
                    send('status', { status: 'calling', message: `正在调用: ${funcName}...` });

                    let args = {};
                    try { args = JSON.parse(tc.function.arguments); } catch (e) { /* ignore */ }

                    send('tool_call', { name: funcName, args });
                    const result = await executeToolCall(funcName, args, { allowWrite: false });
                    send('tool_result', { name: funcName, result });
                    send('status', {
                        status: hasPendingWriteConfirmation([{ name: funcName, result }]) ? 'confirming' : 'analyzing',
                        message: hasPendingWriteConfirmation([{ name: funcName, result }])
                            ? '等待确认后执行写操作'
                            : `已完成 ${funcName}，正在继续分析...`
                    });
                    
                    allToolResults.push({ name: funcName, result });

                    currentMessages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        name: funcName,
                        content: JSON.stringify(result)
                    });
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
    try {
        const { toolName, args } = req.body || {};
        if (!toolName) {
            return res.status(400).json({ success: false, error: '缺少 toolName' });
        }

        const result = await executeToolCall(toolName, args || {}, { allowWrite: true });
        res.json({ success: true, data: { name: toolName, result } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});



/**
 * 通用 AI 对话处理函数
 */
async function processAiChat(text, options = {}) {
    const { context = [], promptSuffix = '', allowWrite = false, pageContext: rawPageContext = null } = options;
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
        currentMessages = prioritizeCurrentEvidence(currentMessages, messages.length);
        currentMessages[0].content += '\n\n【本轮证据优先】已经获得本轮工具结果。历史 assistant 回答仅是旧回复，不是事实来源，不得用于补充、反转或解释本轮工具证据。最终结论只能来自本轮工具结果和明确业务规则。';
        evidenceContextPrioritized = true;
    };

    const VIEW_TYPE_MAP = {
        get_order_detail: 'order_detail',
        get_order_knowledge_package: 'order_knowledge_package',
        generate_purchase_list: 'purchase_list',
        get_management_action_center: 'management_action_center',
        get_order_readiness_overview: 'order_readiness_overview',
        check_order_readiness: 'order_readiness',
        plan_order_readiness_actions: 'order_readiness_plan',
        execute_order_readiness_action: 'order_readiness_action',
    };

    for (const call of freshLookupCalls) {
        const result = await executeToolCall(call.name, call.args, { allowWrite: false });
        toolResults.push({ name: call.name, view_type: VIEW_TYPE_MAP[call.name] || 'action_result', result });
    }
    if (toolResults.length > 0) {
        currentMessages[0].content += `\n\n【本轮服务端已刷新数据】\n${JSON.stringify(toolResults)}\n必须以这些本轮查询结果为准，不得复述历史数字。`;
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

                let args = {};
                try { args = JSON.parse(tc.function.arguments); } catch (e) { }

                const result = await executeToolCall(funcName, args, { allowWrite });
                const viewType = VIEW_TYPE_MAP[funcName] || 'action_result';

                toolResults.push({ name: funcName, view_type: viewType, result });

                currentMessages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    name: funcName,
                    content: JSON.stringify(result)
                });
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
