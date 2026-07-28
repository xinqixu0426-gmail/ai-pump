const express = require('express');
const router = express.Router();
const { AI_TOOLS, WRITE_TOOLS } = require('./tools.cjs');
const { getSystemPrompt } = require('./prompt.cjs');
const { executeToolCall } = require('./executor.cjs');
const { trimAiContext } = require('../../services/aiContext.cjs');
const { buildFreshLookupToolCalls } = require('../../services/aiFreshness.cjs');
const authMiddleware = require('../../authMiddleware.cjs');

const AI_RUNTIME_RESPONSE_RULES = `

【运行时回答格式要求】
- 最终面向用户的回复必须使用 Markdown。
- 用短标题、项目符号、编号列表和加粗关键数字组织内容。
- 成本、报价、订单明细可用 Markdown 表格；不要输出 HTML。
- 不要只输出一整段纯文本。

【运行时业务路由要求】
- 价格、单价、成本、库存、订单状态、报价金额、铜价等会变化的系统数据，每次被询问时都必须重新调用合适的只读工具，以本轮工具结果为准；禁止直接复述历史会话里的数字。
- 用户明确要求查知识库时使用知识库工具；查询当前零件、配方、订单等实时业务字段时，优先使用对应业务工具。知识库与业务工具结果冲突时，应说明知识库可能尚未同步，并以业务系统当前值为准。
- 用户询问配方是否漏项、配置是否合理、固定件价格是否异常或有哪些相似配方时，必须使用 analyze_recipe_configuration。已批准工厂规则、确定性配置矛盾与同类配方复核建议必须分开描述；检查结果只读，不得自动修改。
- 用户明确要求确认、忽略、标记特殊情况或恢复某条检查提醒时，使用 set_recipe_analysis_feedback，并且只能使用最近一次检查结果中的精确 findingKey 和 findingType；反馈写入仍需确认。同类高频项反馈保存后会自动刷新候选规则，不要重复要求用户手动归纳。
- 候选业务规则至少需要两个配方确认相同高频项，同时使用特殊情况和忽略反馈计算置信度。读取使用 get_factory_rule_candidates；询问单条规则影响范围或批准前使用 get_factory_rule_impact；询问全部规则执行情况或不符合规则的配方时使用 get_factory_rule_compliance。归纳、批准和驳回分别使用 refresh_factory_rule_candidates、review_factory_rule_candidate，并等待写操作确认。候选规则未批准前不得当作正式规则；批准后立即参与相同泵壳模板的配方智能检查，如需进入 AI 知识检索还要同步知识库。
- 知识条目 metadata.testReports 中的附件以及标记为 pump_performance_test 的 .xls/.xlsx 文件，必须称为“性能测试报告”或“测试报告”；禁止称为“图纸”“参考图纸”或“工程图”。只有转子出图工具返回的 PDF 才能称为图纸。
- 性能测试报告模板中的“规定点、实测点、偏差”不作为有效技术结论，不得引用、展示或据此判断是否达标；最终回答中也不要出现这三个模板字段名，即使是为了说明忽略它们。回答性能问题时只使用逐条“测试点”的流量、扬程、电流、效率等实际曲线数据；报告没有可靠额定参数时只说“未提供可靠额定参数”，不能把某个点标成额定值或实测结论。
- 知识工具返回的 sources 是本轮回答的可追溯依据。只能引用实际使用过的来源，不得编造知识 ID、标题或链接；sources 中 freshness 不是 fresh 时，正文必须提示该知识待同步，涉及易变数据时改查实时业务工具。
- 工具结果 provenance.kind 为 live_business 时，说明数据来自本轮实时业务查询；为 knowledge_snapshot 时，说明数据来自最近一次知识库同步快照。两者冲突时以 live_business 为准。
- 用户提到机筒长度、机筒高度、桶长或 180mm/170mm 这类长度，并询问泵壳本体成本时，必须使用 preview_pump_shell_cost；不要使用 query_recipe_cost_by_name 返回默认配方成本。
- 用户询问整个配方、报价或订单在某个机筒长度下的总成本时，使用 preview_recipe_cost，并把长度放入 customBarrelLength 或 overrides.customBarrelLength。
- 未提供泵壳型号时先追问型号；不要默认猜 V750 或任何模板。
- 用户询问“12-220”这类线圈数据时，必须列出该规格片数下所有正式材质+槽眼方案；未指定材质或槽眼时禁止默认选择钢带小眼。
- 线圈知识中的“默认搭配电缆线径”是成品电缆搭配参数，不是主线/副线漆包线线径；回答时必须按字段原义标注。
- 查询客户报价时，按工具返回的 displaySequence 展示为“第1份、第2份”；不得把数据库 id 写成“报价单 #3”这类面向用户的顺序编号。
- 配方中的线材、长度、插头和规格共同组成一个“成品电缆”业务项。成本可以解释为线材长度成本与插头/规格成本共同构成，但不得拆成两个配件或两个独立收费项目。
`;

function buildSystemPrompt(extra = '') {
    return `${getSystemPrompt()}${AI_RUNTIME_RESPONSE_RULES}${extra || ''}`;
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
        delete_part: '好的，我来帮你删除这个零件，请核对下面的确认卡片。',
        create_order: '好的，我来帮你新建这个订单，请核对下面的确认卡片。',
        update_order_status: '好的，我来帮你修改订单状态，请核对下面的确认卡片。',
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
    query_recipe_cost_by_name: '查询配方成本',
    query_recipe_cost_by_id: '查询配方成本',
    full_calculate: '完整成本估算',
    get_copper_price: '查询铜价',
    calculate_coil_cost: '计算线圈成本',
    get_coil_specs: '读取线圈规格',
    get_all_recipes: '读取配方列表',
    get_all_parts: '读取零件列表',
    dynamic_config_cost: '计算动态配置成本',
    get_recent_orders: '读取最近订单',
    create_part: '新建零件',
    create_order: '新建订单',
    add_recipe_to_order: '订单追加产品',
    update_part: '修改零件',
    get_order_detail: '读取订单详情',
    update_order_status: '修改订单状态',
    remove_recipe_from_order: '订单移除产品',
    update_order_item: '修改订单产品',
    generate_purchase_list: '生成采购清单',
    delete_order: '删除订单',
    create_recipe: '新建配方',
    delete_recipe: '删除配方',
    update_recipe: '修改配方',
    build_recipe_bom_draft: '生成 BOM 草稿',
    preview_recipe_cost: '配方成本试算',
    preview_pump_shell_cost: '泵壳成本试算',
    build_quotation_draft: '生成报价草稿',
    build_order_draft: '生成订单草稿',
    search_customer_history: '查询客户历史',
    explain_cost_change: '解释成本差异',
    get_data_quality_summary: '读取数据质量',
    analyze_recipe_configuration: '智能检查配方',
    set_recipe_analysis_feedback: '保存配方检查反馈',
    get_factory_rule_candidates: '读取候选业务规则',
    get_factory_rule_impact: '分析规则影响范围',
    get_factory_rule_compliance: '检查规则执行情况',
    refresh_factory_rule_candidates: '归纳候选业务规则',
    review_factory_rule_candidate: '审核候选业务规则',
    get_business_alerts: '读取经营异常',
    search_factory_knowledge: '搜索工厂知识库',
    get_factory_knowledge_detail: '读取知识详情',
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

// ── 工具函数: 调用 DeepSeek API ──
async function fetchDeepSeek(messages, stream = false) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY');
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
    const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages,
            tools: AI_TOOLS,
            stream
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`DeepSeek API 错误: ${res.status} ${text.slice(0, 200)}`);
    }
    return res;
}

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
        send('status', { status: 'thinking', message: '正在理解您的问题...' });

        let currentMessages = [
            { role: 'system', content: buildSystemPrompt() },
            ...messages
        ];

        let maxRounds = 5;
        let done = false;
        let allToolResults = [];

        const freshLookupCalls = buildFreshLookupToolCalls(messages);
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
            send('status', { status: 'analyzing', message: '已刷新当前数据，正在分析...' });
        }

        while (!done && maxRounds-- > 0) {
            let aiRes;
            try {
                aiRes = await fetchDeepSeek(currentMessages, true);
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
    const { context = [], promptSuffix = '', allowWrite = false } = options;
    const toolResults = [];

    const messages = trimAiContext([
        ...(Array.isArray(context) ? context : []),
        { role: 'user', content: text },
    ]);

    let currentMessages = [
        { role: 'system', content: buildSystemPrompt(promptSuffix) },
        ...messages
    ];

    let maxRounds = 5;
    let done = false;
    let finalContent = '';

    const VIEW_TYPE_MAP = {
        get_order_detail: 'order_detail',
        generate_purchase_list: 'purchase_list'
    };

    for (const call of buildFreshLookupToolCalls(messages)) {
        const result = await executeToolCall(call.name, call.args, { allowWrite: false });
        toolResults.push({ name: call.name, view_type: VIEW_TYPE_MAP[call.name] || 'action_result', result });
    }
    if (toolResults.length > 0) {
        currentMessages[0].content += `\n\n【本轮服务端已刷新数据】\n${JSON.stringify(toolResults)}\n必须以这些本轮查询结果为准，不得复述历史数字。`;
    }

    while (!done && maxRounds-- > 0) {
        const aiRes = await fetchDeepSeek(currentMessages, false);

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
