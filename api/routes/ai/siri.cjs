const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const { processAiChat } = require('./chat.cjs');
const { executeToolCall } = require('./executor.cjs');
const { limitText, classifySiriResult, buildSiriSpeech, firstBackgroundTask } = require('./siriResponse.cjs');
const { fetchWithPolicy } = require('../../services/httpClient.cjs');
const { isProductionEnvironment } = require('../../services/environment.cjs');
const {
    completeAiToolConfirmation,
    confirmationSubjectForChannel,
    consumeAiToolConfirmation,
    failAiToolConfirmation,
} = require('../../services/aiToolConfirmation.cjs');

const SIRI_TOKEN = process.env.SIRI_API_TOKEN || '';
const IS_PRODUCTION = isProductionEnvironment();
if (IS_PRODUCTION && !SIRI_TOKEN) {
    throw new Error('生产环境必须配置 SIRI_API_TOKEN');
}
const PUBLIC_DIR = path.join(__dirname, '..', '..', '..', 'public');

// ── Siri 结果存储（内存，5分钟 TTL） ──
const siriResults = new Map();
const siriConfirmations = new Map();
const SIRI_RESULT_TTL = 5 * 60 * 1000; // 5 minutes
const SIRI_CONFIRMATION_SUBJECT = confirmationSubjectForChannel('siri', SIRI_TOKEN);

// 每分钟清理过期结果
const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of siriResults) {
        if (now - entry.createdAt > SIRI_RESULT_TTL) siriResults.delete(id);
    }
    for (const [id, entry] of siriConfirmations) {
        if (now - entry.createdAt > SIRI_RESULT_TTL) siriConfirmations.delete(id);
    }
}, 60000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

/**
 * Siri 鉴权中间件
 * 开发环境未设置 SIRI_API_TOKEN 时跳过鉴权；生产环境启动时强制要求 token。
 */
function siriAuth(req, res, next) {
    if (!SIRI_TOKEN) return next();
    const token = req.headers['x-siri-token'];
    if (token !== SIRI_TOKEN) {
        return res.status(401).json({ success: false, error: '鉴权失败' });
    }
    next();
}

// ── Siri 结果页面静态文件 + API ──
router.use('/public', require('express').static(PUBLIC_DIR));

// 重定向: /siri-result?id=xxx → /public/siri-result.html?id=xxx
router.get('/siri-result', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'siri-result.html'));
});

// 获取存储的 Siri 结果
router.get('/api/siri/result/:id', (req, res) => {
    const entry = siriResults.get(req.params.id);
    if (!entry) {
        return res.json({ success: false, error: '结果不存在或已过期（5分钟）' });
    }
    res.json({ success: true, data: entry.data });
});

function buildResultUrl(req, resultId) {
    return `${req.protocol}://${req.get('host')}/siri-result?id=${resultId}`;
}

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
                const cadRes = await fetchWithPolicy(`${cadApiUrl}/api/siri/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, context: context || [] }),
                }, { timeoutMs: 30000, retries: 0, label: 'CAD Siri API' });
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
        const siriPromptSuffix = `\n\n【当前为 Siri 快捷指令模式】\n回复规则调整：\n- 回复必须非常简短，优先控制在1句话，最多2句话\n- 第一句话会被 Siri 朗读，必须直接给结论\n- 不要使用 markdown、表格、列表符号或长解释\n- 结构化明细会由系统页面展示，你不要重复逐条列出\n- 金额直接说"xxx元"，不要用特殊符号\n- 如果有多个数据，只说最关键的1-2个数字\n- 如果用户要求返回N条但实际不足N条，说"当前只有X条"，不要说"查不到"\n- 如果用户明确要求新增、修改、删除、生成采购清单等写操作，且参数足够明确，必须调用对应写工具，不要只用自然语言询问确认；后端会自动返回确认状态\n- 只有对象不明确或参数不足时，才先查询候选项并让用户补充`;

        let finalContent = '';
        let toolResults = [];
        let speech = '';

        try {
            const aiData = await processAiChat(text, {
                context,
                promptSuffix: siriPromptSuffix,
                confirmationSubject: SIRI_CONFIRMATION_SUBJECT,
            });
            finalContent = aiData.finalContent;
            toolResults = aiData.toolResults;
            speech = aiData.speech;
        } catch (err) {
            console.error('[Siri] DeepSeek API 错误:', err);
            return res.json({ success: false, status: 'failed', speech: 'AI服务暂时不可用。', error: err.message });
        }

        const classified = classifySiriResult(toolResults);
        const pendingConfirmation = classified.pending || null;
        const confirmationId = pendingConfirmation ? crypto.randomUUID() : '';
        if (pendingConfirmation) {
            siriConfirmations.set(confirmationId, {
                createdAt: Date.now(),
                confirmationToken: pendingConfirmation.result.confirmation.confirmationToken,
                sourceText: text,
            });
        }

        speech = buildSiriSpeech({
            status: classified.status,
            aiSpeech: speech,
            pending: pendingConfirmation,
            failed: classified.failed,
            task: classified.task,
        });
        finalContent = limitText(finalContent || speech, 180);

        // 保存结果并生成 URL
        const resultId = crypto.randomUUID();
        siriResults.set(resultId, {
            createdAt: Date.now(),
            data: {
                status: classified.status,
                speech,
                content: finalContent,
                toolResults,
                query: text,
                timestamp: new Date().toISOString(),
                confirmationId: confirmationId || undefined,
                confirmation: pendingConfirmation?.result?.confirmation,
                task: classified.task,
            }
        });
        const resultUrl = buildResultUrl(req, resultId);

        console.log(`[Siri] 完成, speech="${speech}", 工具调用: ${toolResults.length} 次, resultUrl=${resultUrl}`);
        res.json({
            success: classified.status !== 'failed',
            status: classified.status,
            speech,
            content: finalContent,
            toolResults,
            resultUrl,
            confirmationId: confirmationId || undefined,
            confirmation: pendingConfirmation?.result?.confirmation,
            task: classified.task,
        });
    } catch (err) {
        console.error('[Siri] 错误:', err.message);
        res.json({ success: false, status: 'failed', speech: '处理出错了。', error: err.message });
    }
});

router.post('/api/siri/confirm', siriAuth, async (req, res) => {
    let consumed = null;
    let consumedToken = '';
    try {
        const { confirmationId, confirm } = req.body || {};
        if (!confirmationId) {
            return res.status(400).json({ success: false, status: 'failed', speech: '缺少确认编号。', error: '缺少 confirmationId' });
        }
        if (confirm !== true) {
            return res.json({ success: false, status: 'cancelled', speech: '已取消。', error: '用户取消执行' });
        }

        const pending = siriConfirmations.get(confirmationId);
        if (!pending) {
            return res.status(404).json({ success: false, status: 'failed', speech: '确认已过期。', error: '确认不存在或已过期' });
        }

        consumedToken = pending.confirmationToken;
        siriConfirmations.delete(confirmationId);
        consumed = consumeAiToolConfirmation({
            confirmationToken: consumedToken,
            subject: SIRI_CONFIRMATION_SUBJECT,
        });
        const receipt = consumed.replay
            ? consumed.receipt
            : null;
        const result = receipt?.result || await executeToolCall(consumed.toolName, consumed.args, {
            allowWrite: true,
            operationId: consumed.operationId,
        });
        if (!consumed.replay) {
            completeAiToolConfirmation({
                confirmationToken: pending.confirmationToken,
                subject: SIRI_CONFIRMATION_SUBJECT,
                receipt: {
                    name: consumed.toolName,
                    result,
                    capabilityId: consumed.capabilityId,
                    operationId: consumed.operationId,
                    status: result?.success === false ? 'failed' : (result?.status || 'completed'),
                    changes: Array.isArray(result?.changes) ? result.changes : [],
                    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
                    auditId: result?.auditId ?? null,
                    idempotentReplay: false,
                    completedAt: new Date().toISOString(),
                },
            });
        }

        const failed = result?.success === false;
        const task = firstBackgroundTask([{ name: consumed.toolName, result }]);
        const status = failed ? 'failed' : task ? 'processing' : 'success';
        const speech = failed ? buildSiriSpeech({ status, failed: { result } }) : task ? buildSiriSpeech({ status, task }) : '已执行。';
        const toolResults = [{ name: consumed.toolName, view_type: 'action_result', result }];

        const resultId = crypto.randomUUID();
        siriResults.set(resultId, {
            createdAt: Date.now(),
            data: {
                status,
                speech,
                content: speech,
                toolResults,
                query: pending.sourceText,
                timestamp: new Date().toISOString(),
                task,
            }
        });

        res.json({
            success: !failed,
            status,
            speech,
            content: speech,
            toolResults,
            resultUrl: buildResultUrl(req, resultId),
            task,
        });
    } catch (err) {
        if (consumed && !consumed.replay) {
            try {
                if (consumedToken) {
                    failAiToolConfirmation({
                        confirmationToken: consumedToken,
                        subject: SIRI_CONFIRMATION_SUBJECT,
                        error: err,
                    });
                }
            } catch {
                // 保留原始执行错误。
            }
        }
        console.error('[Siri] 确认执行错误:', err.message);
        res.status(500).json({ success: false, status: 'failed', speech: '确认执行失败。', error: err.message });
    }
});


module.exports = router;
module.exports.stopSiriCleanup = () => clearInterval(cleanupTimer);
