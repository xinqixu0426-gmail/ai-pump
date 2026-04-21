const express = require('express');
const router = express.Router();
const { AI_TOOLS } = require('./tools.cjs');
const { getSystemPrompt } = require('./prompt.cjs');
const { executeToolCall } = require('./executor.cjs');

// ── AI Chat SSE 端点 ──
router.post('/api/ai/chat', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (type, payload) => {
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    };

    try {
        const { messages } = req.body;
        send('status', { status: 'thinking', message: '正在理解您的问题...' });

        let currentMessages = [
            { role: 'system', content: getSystemPrompt() },
            ...messages
        ];

        const apiKey = process.env.DEEPSEEK_API_KEY;
        const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
        let maxRounds = 5;
        let done = false;
        let allToolResults = []; // 新增：收集本轮会话的所有工具执行结果

        while (!done && maxRounds-- > 0) {
            const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model,
                    messages: currentMessages,
                    tools: AI_TOOLS,
                    stream: false
                })
            });

            if (!aiRes.ok) {
                const text = await aiRes.text();
                send('error', { message: `DeepSeek API 错误: ${aiRes.status} ${text.slice(0, 200)}` });
                return res.end();
            }

            const data = await aiRes.json();
            if (data.error) {
                send('error', { message: data.error.message || 'API 调用失败' });
                return res.end();
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
                    send('status', { status: 'calling', message: `正在调用: ${funcName}...` });

                    let args = {};
                    try { args = JSON.parse(tc.function.arguments); } catch (e) { /* ignore */ }

                    send('tool_call', { name: funcName, args });
                    const result = await executeToolCall(funcName, args, { allowWrite: true });
                    send('tool_result', { name: funcName, result });
                    
                    // 新增：记录到集合中供最后发送
                    allToolResults.push({ name: funcName, result });

                    currentMessages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        name: funcName,
                        content: JSON.stringify(result)
                    });
                }
            } else {
                send('content', { content: msg.content || '' });
                
                // 新增：如果本次会话产生过工具调用，则发送详情事件
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
        { role: 'system', content: getSystemPrompt() + promptSuffix },
        ...messages
    ];

    const apiKey = process.env.DEEPSEEK_API_KEY;
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    let maxRounds = 5;
    let done = false;
    let finalContent = '';

    // 这里由于不同工具可能需要的 view 类型不同，提供一个简单的 mapping，如果有未考虑到的暂时标为 action_result
    const VIEW_TYPE_MAP = {
        get_order_detail: 'order_detail',
        generate_purchase_list: 'purchase_list'
    };

    while (!done && maxRounds-- > 0) {
        const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages: currentMessages,
                tools: AI_TOOLS,
                stream: false
            })
        });

        if (!aiRes.ok) {
            const errText = await aiRes.text();
            throw new Error(`LLM API 错误: ${aiRes.status}`);
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
