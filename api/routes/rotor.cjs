const { Router } = require('express');
const { execFile } = require('child_process');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { db } = require('../db.cjs');

const router = Router();

const FREECAD_BIN = process.env.FREECAD_BIN || 'C:\\Program Files\\FreeCAD 1.1\\bin\\freecad.exe';
const WORKER_SCRIPT = path.join(__dirname, '../../freecad/worker.py');
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

const BEARING_DB = {
    "6201": { dia: 12.0, depth: 10.0 },
    "6202": { dia: 15.0, depth: 11.0 },
    "6203": { dia: 17.0, depth: 12.0 },
    "6204": { dia: 20.0, depth: 14.0 },
    "6205": { dia: 25.0, depth: 15.0 },
};

const SYSTEM_PROMPT = '你是一个专业的工业图纸参数提取 AI。请仔细阅读用户的自然语言指令，并将提取的数值严格填入以下预定义的 JSON 字段中。\n\n'
    + '**必须且只能使用以下字段**（如果用户未提及该项的专属代名词，该字段必须填 null，绝对禁止跨行指派）：\n'
    + '- "upper_bearing" (上轴承型号，例如提取为 "6202")\n'
    + '- "lower_bearing" (下轴承型号，例如提取为 "6204")\n'
    + '- "piece_count" (专属代名词：转子片数/片数。例如说转子片数160片 -> 160)\n'
    + '- "rotor_dia" (专属代名词：转子直径/转子外径)。【警告：如果用户没提直径，只说了"定位"或"螺丝长度"，你绝对不能把它们当作直径！必须填 null】\n'
    + '- "bearing_span" (专属代名词：开档/轴承间距。例如说开档150 -> 150)\n'
    + '- "stack_offset" (专属代名词：定位/叠片定位。例如说定位35 -> 35)\n'
    + '- "oil_seal_dia" (专属代名词：油封/油封孔径。例如说油封孔径14 -> 14)\n'
    + '- "impeller_dia" (专属代名词：叶轮/叶轮孔径)\n'
    + '- "impeller_span" (专属代名词：叶轮开档。例如说叶轮开档80 -> 80)\n'
    + '- "impeller_depth" (专属代名词：叶轮厚度。例如说叶轮厚度9 -> 9)\n'
    + '- "thread_length" (专属代名词：螺丝长度/螺纹长度)\n'
    + '- "thread_dia" (专属代名词：螺纹直径。例如用户说：螺丝直径12 -> 12)\n\n'
    + '示例反馈：\n'
    + '用户：上轴承202，下轴承203.转子片数160片，定位30，开档150\n'
    + 'AI的JSON返回：\n'
    + '{"upper_bearing":"6202","lower_bearing":"6203","piece_count":160,"rotor_dia":null,"bearing_span":150,"stack_offset":30,"oil_seal_dia":null,"impeller_dia":null,"impeller_span":null,"impeller_depth":null,"thread_length":null,"thread_dia":null,"reply":"好的，正在为您生成转子图纸。"}';

// ── DeepSeek 调用（带超时+重试） ──
function callDeepSeek(messages, retries = 2) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            model: 'deepseek-chat',
            messages,
            temperature: 0.1,
            max_tokens: 200
        });

        const req = https.request({
            hostname: 'api.deepseek.com',
            port: 443,
            path: '/v1/chat/completions',
            method: 'POST',
            timeout: 15000,
            headers: {
                'Authorization': 'Bearer ' + DEEPSEEK_API_KEY,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                } else if (res.statusCode >= 500 && retries > 0) {
                    console.warn('[Rotor] DeepSeek 5xx, retrying... remaining=' + retries);
                    setTimeout(() => callDeepSeek(messages, retries - 1).then(resolve, reject), 1000);
                } else {
                    reject(new Error('DeepSeek API Error: ' + res.statusCode + ' ' + data));
                }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('DeepSeek request timeout (15s)')); });
        req.on('error', (e) => {
            if (retries > 0) {
                console.warn('[Rotor] DeepSeek network error, retrying... remaining=' + retries);
                setTimeout(() => callDeepSeek(messages, retries - 1).then(resolve, reject), 1000);
            } else {
                reject(e);
            }
        });
        req.write(payload);
        req.end();
    });
}

// ── 异步任务管理 ──
const activeJobs = new Map();
let runningJobs = 0;
const MAX_CONCURRENT_FREECAD = 2;

// 2分钟后自动清理已完成任务
setInterval(() => {
    const now = Date.now();
    for (const [id, job] of activeJobs) {
        if (job.doneAt && now - job.doneAt > 120000) activeJobs.delete(id);
    }
}, 30000);

// ═══════════════════════════════════════════════
// POST /chat — 自然语言出图
// ═══════════════════════════════════════════════
router.post('/chat', async (req, res) => {
    try {
        const { message, force } = req.body;
        if (!message) return res.status(400).json({ status: 'error', message: '缺少 message 字段' });

        if (!DEEPSEEK_API_KEY) {
            return res.status(500).json({ status: 'error', message: '未配置 DEEPSEEK_API_KEY' });
        }

        console.log('[Rotor] 收到出图指令:', message);

        // 1. DeepSeek 提取参数
        const aiRes = await callDeepSeek([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: message }
        ]);

        const rawReply = (aiRes.choices[0].message.content || '').trim();
        let parsed;
        try {
            parsed = JSON.parse(rawReply);
        } catch (_e) {
            const m = rawReply.match(/\{[\s\S]*\}/);
            if (m) parsed = JSON.parse(m[0]);
            else throw new Error('无法解析 AI 返回结果');
        }

        const aiReply = parsed.reply || '好的，正在为您处理';

        // 2. 正则兜底（支持小数）
        const mtStack = message.match(/定位\s*(\d+\.?\d*)/);
        if (mtStack) {
            parsed.stack_offset = parseFloat(mtStack[1]);
            if (parsed.rotor_dia === parsed.stack_offset && !message.match(/直径/)) parsed.rotor_dia = null;
        }
        const mtImpSpan = message.match(/叶轮开档\s*(\d+\.?\d*)/);
        if (mtImpSpan) {
            parsed.impeller_span = parseFloat(mtImpSpan[1]);
            if (parsed.impeller_dia === parsed.impeller_span && !message.match(/叶轮孔径|叶轮直径/)) parsed.impeller_dia = null;
        }
        const mtImpDepth = message.match(/叶轮厚度\s*(\d+\.?\d*)/);
        if (mtImpDepth) {
            parsed.impeller_depth = parseFloat(mtImpDepth[1]);
            if (parsed.impeller_dia === parsed.impeller_depth && !message.match(/叶轮孔径|叶轮直径/)) parsed.impeller_dia = null;
        }
        const mtRotorDia = message.match(/转子直径\s*(\d+\.?\d*)/);
        if (mtRotorDia) parsed.rotor_dia = parseFloat(mtRotorDia[1]);

        // 3. 轴承查表 + 组装 FreeCAD 参数
        const fcParams = {};
        const upperB = parsed.upper_bearing;
        const lowerB = parsed.lower_bearing;

        if (upperB && BEARING_DB[upperB]) {
            fcParams.upper_bearing_dia = BEARING_DB[upperB].dia;
            fcParams.upper_bearing_depth = BEARING_DB[upperB].depth;
        } else if (upperB) {
            return res.status(400).json({ status: 'error', message: '未知的上轴承型号: ' + upperB });
        }
        if (lowerB && BEARING_DB[lowerB]) {
            fcParams.lower_bearing_dia = BEARING_DB[lowerB].dia;
            fcParams.lower_bearing_depth = BEARING_DB[lowerB].depth;
        } else if (lowerB) {
            return res.status(400).json({ status: 'error', message: '未知的下轴承型号: ' + lowerB });
        }

        ['piece_count', 'rotor_dia', 'bearing_span', 'stack_offset',
         'oil_seal_dia', 'impeller_dia', 'impeller_depth',
         'thread_dia', 'thread_length'].forEach(k => {
            if (parsed[k] != null) fcParams[k] = parsed[k];
        });
        // impeller_span 在模板里的 alias 叫 bearing_to_impeller
        if (parsed.impeller_span != null) fcParams.bearing_to_impeller = parsed.impeller_span;

        // 派生参数：_core_length / _total_length（worker.py 的 dim_map 覆盖用）
        if (fcParams.piece_count) {
            fcParams._core_length = fcParams.piece_count * 0.5;
        }
        // _total_length = 上轴承深度 + 开档 + 叶轮开档 + 叶轮厚度 + 螺纹长度
        const totalLen = (fcParams.upper_bearing_depth || 0)
            + (fcParams.bearing_span || 0)
            + (fcParams.bearing_to_impeller || 0)
            + (fcParams.impeller_depth || 0)
            + (fcParams.thread_length || 0);
        if (totalLen > 0) fcParams._total_length = totalLen;

        if (Object.keys(fcParams).length === 0) {
            return res.json({ status: 'need_params', message: aiReply, extracted: parsed });
        }

        // 4. 定子距花板距离安全校验
        const bSpan = fcParams.bearing_span;
        const pCount = fcParams.piece_count;
        const sOffset = fcParams.stack_offset;

        if (!force && bSpan != null && pCount != null && sOffset != null) {
            const clearance = bSpan - (pCount / 2) - sOffset;
            if (clearance < 35) {
                console.log('[Rotor] ⚠️ 定子距花板距离=' + clearance.toFixed(1) + 'mm < 35mm');
                return res.json({
                    status: 'warning',
                    warning_type: 'stator_clearance',
                    message: '定子距离花板距离为 ' + clearance.toFixed(1) + 'mm，小于 35mm，过小的距离可能导致漆包线与花板接触导致漏电，是否继续？',
                    clearance: Math.round(clearance * 10) / 10,
                    extracted: parsed
                });
            }
        }

        // 5. 后台出图（并发限制）
        if (runningJobs >= MAX_CONCURRENT_FREECAD) {
            return res.status(429).json({ status: 'error', message: '出图队列已满（最多 ' + MAX_CONCURRENT_FREECAD + ' 个并发），请稍后再试' });
        }

        const jobId = crypto.randomUUID();
        const outputFile = 'output_' + jobId + '.pdf';
        activeJobs.set(jobId, { status: 'processing' });
        runningJobs++;

        // 保存出图记录到数据库
        const now = new Date().toISOString();
        try {
            db.prepare(`INSERT INTO rotor_drawings (job_id, nl_input, params_json, fc_params_json, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'processing', ?, ?)`)
                .run(jobId, message, JSON.stringify(parsed), JSON.stringify(fcParams), now, now);
        } catch (dbErr) {
            console.error('[Rotor] DB insert error:', dbErr.message);
        }

        console.log('[Rotor] 提取参数完成，启动后台出图 jobId=' + jobId, fcParams);

        fcParams._jobId = jobId;
        const args = [WORKER_SCRIPT, '--pass', JSON.stringify(fcParams)];
        execFile(FREECAD_BIN, args, { maxBuffer: 10 * 1024 * 1024, timeout: 180000 }, (error, stdout, stderr) => {
            runningJobs = Math.max(0, runningJobs - 1);
            console.log('[Rotor] FreeCAD stdout:\n' + stdout);
            if (stderr) console.error('[Rotor] FreeCAD stderr:\n' + stderr);

            if (error) {
                console.error('[Rotor] 💥 渲染异常:', error.message);
                activeJobs.set(jobId, { status: 'failed', error: error.message, doneAt: Date.now() });
                try { db.prepare(`UPDATE rotor_drawings SET status='failed', error=?, updated_at=? WHERE job_id=?`).run(error.message, new Date().toISOString(), jobId); } catch(e){ console.error('[Rotor] DB update error:', e.message); }
                return;
            }

            // worker.py 输出以 jobId 命名的 PDF
            const srcPdf = path.join(path.dirname(WORKER_SCRIPT), `output_${jobId}.pdf`);
            const destDir = path.join(__dirname, '../../public/drawings');
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
            const destPdf = path.join(destDir, outputFile);

            try {
                if (fs.existsSync(srcPdf)) {
                    fs.copyFileSync(srcPdf, destPdf);
                    fs.unlinkSync(srcPdf);
                    // 清理工作副本（可选）
                    const srcWork = path.join(path.dirname(WORKER_SCRIPT), `work_${jobId}.FCStd`);
                    if (fs.existsSync(srcWork)) try { fs.unlinkSync(srcWork); } catch(_){}

                    const fileUrl = '/drawings/' + outputFile;
                    console.log('[Rotor] ✅ PDF 已移至: ' + destPdf);
                    activeJobs.set(jobId, { status: 'success', fileUrl, doneAt: Date.now() });
                    try { db.prepare(`UPDATE rotor_drawings SET status='success', file_url=?, updated_at=? WHERE job_id=?`).run(fileUrl, new Date().toISOString(), jobId); } catch(e){ console.error('[Rotor] DB update error:', e.message); }
                } else {
                    activeJobs.set(jobId, { status: 'failed', error: '未找到 output PDF', doneAt: Date.now() });
                    try { db.prepare(`UPDATE rotor_drawings SET status='failed', error='未找到 output PDF', updated_at=? WHERE job_id=?`).run(new Date().toISOString(), jobId); } catch(e){ console.error('[Rotor] DB update error:', e.message); }
                }
            } catch (mvErr) {
                activeJobs.set(jobId, { status: 'failed', error: '移动PDF失败: ' + mvErr.message, doneAt: Date.now() });
                try { db.prepare(`UPDATE rotor_drawings SET status='failed', error=?, updated_at=? WHERE job_id=?`).run(mvErr.message, new Date().toISOString(), jobId); } catch(e){ console.error('[Rotor] DB update error:', e.message); }
            }
        });

        return res.json({
            status: 'success',
            message: '已收到指令，正在后台为您生成转子图纸...',
            jobId,
            extracted: parsed
        });

    } catch (e) {
        console.error('[Rotor] 路由错误:', e);
        return res.status(500).json({ status: 'error', message: e.message });
    }
});

// ═══════════════════════════════════════════════
// GET /status/:jobId — 查询出图任务状态
// ═══════════════════════════════════════════════
router.get('/status/:jobId', (req, res) => {
    const job = activeJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ status: 'not_found', message: '找不到此任务' });
    res.json(job);
});

// ═══════════════════════════════════════════════
// GET /history — 出图历史记录
// ═══════════════════════════════════════════════
router.get('/history', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM rotor_drawings ORDER BY created_at DESC LIMIT 100').all();
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════
// DELETE /history/:id — 删除出图记录
// ═══════════════════════════════════════════════
router.delete('/history/:id', (req, res) => {
    try {
        const row = db.prepare('SELECT * FROM rotor_drawings WHERE id = ?').get(req.params.id);
        if (!row) return res.status(404).json({ error: '记录不存在' });
        // 删除对应 PDF 文件
        if (row.file_url) {
            const filePath = path.join(__dirname, '../../public', row.file_url);
            if (fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch(_){}
            }
        }
        db.prepare('DELETE FROM rotor_drawings WHERE id = ?').run(req.params.id);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
