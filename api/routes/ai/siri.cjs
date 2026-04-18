const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const { processAiChat } = require('./chat.cjs');

const SIRI_TOKEN = process.env.SIRI_API_TOKEN || '';

// ── Siri 结果存储（内存，5分钟 TTL） ──
const siriResults = new Map();
const SIRI_RESULT_TTL = 5 * 60 * 1000; // 5 minutes

// 每分钟清理过期结果
setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of siriResults) {
        if (now - entry.createdAt > SIRI_RESULT_TTL) siriResults.delete(id);
    }
}, 60000);

/**
 * Siri 鉴权中间件
 * 如果 .env 中设置了 SIRI_API_TOKEN，则要求请求头携带 X-Siri-Token
 * 未设置时跳过鉴权（开发模式）
 */
function siriAuth(req, res, next) {
    if (!SIRI_TOKEN) return next(); // 未配置 token 则跳过
    const token = req.headers['x-siri-token'];
    if (token !== SIRI_TOKEN) {
        return res.status(401).json({ success: false, error: '鉴权失败' });
    }
    next();
}

// ── Siri 结果页面静态文件 + API ──
router.use('/public', require('express').static(path.join(__dirname, '..', '..', 'public')));

// 重定向: /siri-result?id=xxx → /public/siri-result.html?id=xxx
router.get('/siri-result', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'siri-result.html'));
});

// 获取存储的 Siri 结果
router.get('/api/siri/result/:id', (req, res) => {
    const entry = siriResults.get(req.params.id);
    if (!entry) {
        return res.json({ success: false, error: '结果不存在或已过期（5分钟）' });
    }
    res.json({ success: true, data: entry.data });
});

/**
 * POST /api/siri/chat
 * Siri + 快捷指令语音对话端点
 *
 * Siri 自带 Apple STT，快捷指令直接发文字过来，不需要 ASR。
 *
/**
 * 请求体：
 * {
 *   "text": "V750的成本是多少",
 *   "project": "pump",             // pump | cad（路由到不同后端）
 *   "context": []                  // 可选: 多轮对话历史
 * }
 *
 * 响应：
 * {
 *   "success": true,
 *   "speech": "V750总成本853.50元",  // 朗读文字（简短、口语化）
 *   "content": "...",               // AI 完整回复
 *   "toolResults": [...]            // 结构化数据
 * }
 */
router.post('/api/siri/chat', siriAuth, async (req, res) => {
    try {
        const { text, project, context } = req.body;
        if (!text || !text.trim()) {
            return res.json({ success: false, speech: '没有收到你说的话', error: '文字内容为空' });
        }

        const targetProject = (project || 'pump').toLowerCase();
        console.log(`[Siri] 收到请求: project=${targetProject}, text="${text}"`);

        // ── CAD 项目：转发到 Python API ──
        if (targetProject === 'cad') {
            try {
                const cadApiUrl = process.env.CAD_API_URL || 'http://localhost:5000';
                const cadRes = await fetch(`${cadApiUrl}/api/siri/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, context: context || [] }),
                });
                const cadData = await cadRes.json();
                console.log('[Siri] CAD API 返回:', cadData.success);
                return res.json(cadData);
            } catch (err) {
                console.error('[Siri] CAD API 转发失败:', err.message);
                return res.json({ success: false, speech: 'CAD服务暂时不可用', error: err.message });
            }
        }

        // ── PumpDB 项目：本地处理 ──
        // 为 Siri 场景增加 system prompt 后缀：要求首句输出口语化摘要
        const siriPromptSuffix = `\n\n【当前为 Siri 语音模式】\n回复规则调整：\n- 你的回复会被 Siri 朗读给用户听，所以必须口语化、简洁\n- 回复的第一句话必须是对结果的一句话总结（会被提取为 speech 字段）\n- 不要使用 markdown 格式、表格、列表符号\n- 金额直接说"xxx元"，不要用特殊符号\n- 如果有多个数据，只说最关键的2-3个数字`;

        let finalContent = '';
        let toolResults = [];
        let speech = '';

        try {
            const aiData = await processAiChat(text, { context, promptSuffix: siriPromptSuffix });
            finalContent = aiData.finalContent;
            toolResults = aiData.toolResults;
            speech = aiData.speech;
        } catch (err) {
            console.error('[Siri] DeepSeek API 错误:', err);
            return res.json({ success: false, speech: 'AI服务暂时不可用，请稍后再试', error: err.message });
        }

        // 保存结果并生成 URL
        const resultId = crypto.randomUUID();
        siriResults.set(resultId, {
            createdAt: Date.now(),
            data: { speech, content: finalContent, toolResults, query: text, timestamp: new Date().toISOString() }
        });
        const resultUrl = `${req.protocol}://${req.get('host')}/siri-result?id=${resultId}`;

        console.log(`[Siri] 完成, speech="${speech}", 工具调用: ${toolResults.length} 次, resultUrl=${resultUrl}`);
        res.json({
            success: true,
            speech,
            content: finalContent,
            toolResults,
            resultUrl,
        });
    } catch (err) {
        console.error('[Siri] 错误:', err.message);
        res.json({ success: false, speech: '处理出错了，请再试一次', error: err.message });
    }
});


module.exports = router;
