const express = require('express');
const router = express.Router();
const { AI_TOOLS } = require('./tools.cjs');
const { getSystemPrompt } = require('./prompt.cjs');
const { executeToolCall } = require('./executor.cjs');

// ── 工具函数: 调用 DeepSeek API ──
async function fetchDeepSeek(messages, stream = false) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
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
router.post('/api/ai/chat', async (req, res) => {
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
            { role: 'system', content: getSystemPrompt() },
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
                for (const tc of toolCallsArr) {
                    const funcName = tc.function.name;
                    send('status', { status: 'calling', message: `正在调用: ${funcName}...` });

                    let args = {};
                    try { args = JSON.parse(tc.function.arguments); } catch (e) { /* ignore */ }

                    send('tool_call', { name: funcName, args });
                    const result = await executeToolCall(funcName, args, { allowWrite: true });
                    send('tool_result', { name: funcName, result });
                    
                    allToolResults.push({ name: funcName, result });

                    currentMessages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        name: funcName,
                        content: JSON.stringify(result)
                    });
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
