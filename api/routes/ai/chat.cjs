const express = require('express');
const router = express.Router();
const { AI_TOOLS, WRITE_TOOLS } = require('./tools.cjs');
const { getSystemPrompt } = require('./prompt.cjs');
const { executeToolCall } = require('./executor.cjs');
const authMiddleware = require('../../authMiddleware.cjs');

const AI_RUNTIME_RESPONSE_RULES = `

【运行时回答格式要求】
- 最终面向用户的回复必须使用 Markdown。
- 用短标题、项目符号、编号列表和加粗关键数字组织内容。
- 成本、报价、订单明细可用 Markdown 表格；不要输出 HTML。
- 不要只输出一整段纯文本。
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
    build_quotation_draft: '生成报价草稿',
    build_order_draft: '生成订单草稿',
    search_customer_history: '查询客户历史',
    explain_cost_change: '解释成本差异',
    get_data_quality_summary: '读取数据质量',
    get_business_alerts: '读取经营异常',
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
        const { messages } = req.body;
        send('status', { status: 'thinking', message: '正在理解您的问题...' });

        let currentMessages = [
            { role: 'system', content: buildSystemPrompt() },
            ...messages
        ];

        const apiKey = process.env.DEEPSEEK_API_KEY;
        let maxRounds = 5;
        let done = false;
        let allToolResults = [];

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
    const { context = [], promptSuffix = '', onToolCall, allowWrite = false } = options;
    const toolResults = [];

    const messages = context && context.length > 0
        ? [...context, { role: 'user', content: text }]
        : [{ role: 'user', content: text }];

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

    while (!done && maxRounds-- > 0) {
        let aiRes;
        try {
            aiRes = await fetchDeepSeek(currentMessages, false);
        } catch (err) {
            throw err;
        }

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

                if (typeof onToolCall === 'function') {
                    // 异步触发回调，不阻塞主流程
                    onToolCall(funcName).catch(e => console.error('[AI] onToolCall 回调异常:', e.message));
                }

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
