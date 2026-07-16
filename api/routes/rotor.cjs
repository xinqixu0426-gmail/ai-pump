const { Router } = require('express');
const { execFile } = require('child_process');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { db, safeInsert, safeUpdate, hardDelete } = require('../db.cjs');
const { rotorHistoryRow } = require('../services/rotorHistory.cjs');
const { parsePositiveId } = require('../services/validation.cjs');
const { buildRotorTemplateDraft } = require('../services/rotorTemplateDraft.cjs');

const router = Router();

function updateRotorJob(jobId, updates) {
    const row = db.prepare('SELECT id FROM rotor_drawings WHERE job_id = ?').get(jobId);
    if (!row) return;
    safeUpdate('rotor_drawings', row.id, updates);
}

function normalizeDrawingName(value, fallback = '') {
    const raw = String(value || '').trim();
    const name = raw || fallback;
    return name
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

function normalizeDrawingText(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 3)
        .join('\n')
        .slice(0, 120);
}

function rotorSuccess(res, data) {
    res.json({ success: true, data, ...data });
}

function rotorError(res, statusCode, message) {
    res.status(statusCode).json({ success: false, error: message, status: 'error', message });
}

const os = require('os');
const FREECAD_BIN = process.env.FREECAD_BIN || (os.platform() === 'darwin' ? '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD' : 'C:\\Program Files\\FreeCAD 1.1\\bin\\freecad.exe');
const WORKER_SCRIPT = path.join(__dirname, '../../freecad/worker.py');
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

const BEARING_DB = {
    "6201": { dia: 12.0, depth: 10.0 },
    "6202": { dia: 15.0, depth: 11.0 },
    "6203": { dia: 17.0, depth: 12.0 },
    "6204": { dia: 20.0, depth: 14.0 },
    "6205": { dia: 25.0, depth: 15.0 },
};

/**
 * 轴承型号标准化：
 *   "6202-2RS" → "6202"
 *   "6202-ZZ"  → "6202"
 *   "6202RS"   → "6202"
 *   "202"      → "6202"  （简写，自动补前缀6）
 *   "6202"     → "6202"  （已标准，不变）
 */
function normalizeBearing(raw) {
    if (!raw) return raw;
    let s = String(raw).trim();
    // 去掉常见后缀：-2RS, -2Z, -ZZ, -RS, -C3, /P6 等（含或不含连字符）
    s = s.replace(/[-\/]?(2RS|2RZ|2Z|ZZ|RS|RZ|DDU|LLU|LLB|CM|C3|P6|P5|NR)\b/gi, '');
    // 去掉末尾可能残留的连字符
    s = s.replace(/[-\/]+$/, '').trim();
    // 如果是纯 3 位数字（如 "202"），自动补前缀 "6"
    if (/^\d{3}$/.test(s)) s = '6' + s;
    return s;
}

const SYSTEM_PROMPT = '你是一个专业的工业图纸参数提取 AI。请仔细阅读用户的自然语言指令，并将提取的数值严格填入以下预定义的 JSON 字段中。\n\n'
    + '**必须且只能使用以下字段**（如果用户未提及该项的专属代名词，该字段必须填 null，绝对禁止跨行指派）：\n'
    + '- "upper_bearing" (上轴承型号，原样保留用户输入即可，如 "6202-2RS"、"202"、"6202" 都可以)\n'
    + '- "lower_bearing" (下轴承型号，原样保留用户输入即可，如 "6204-ZZ"、"204"、"6204" 都可以)\n'
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
    + '重要规则：开档/轴承间距已经包含转子片数形成的叠片长度；当用户只要求修改片数并说其他不变时，不要推导或增大开档/总长。\n\n'
    + '示例反馈：\n'
    + '用户：上轴承202，下轴承203.转子片数160片，定位30，开档150\n'
    + 'AI的JSON返回：\n'
    + '{"upper_bearing":"6202","lower_bearing":"6203","piece_count":160,"rotor_dia":null,"bearing_span":150,"stack_offset":30,"oil_seal_dia":null,"impeller_dia":null,"impeller_span":null,"impeller_depth":null,"thread_length":null,"thread_dia":null,"reply":"好的，正在为您生成转子图纸。"}';

const ROTOR_PARAM_KEYS = [
    'upper_bearing', 'lower_bearing', 'piece_count', 'rotor_dia',
    'bearing_span', 'stack_offset', 'oil_seal_dia', 'impeller_dia',
    'impeller_span', 'bearing_to_impeller', 'impeller_depth',
    'thread_length', 'thread_dia'
];

function mergeRotorBaseParams(baseParams, parsed) {
    if (!baseParams || typeof baseParams !== 'object') return parsed;
    const merged = { ...parsed };
    for (const key of ROTOR_PARAM_KEYS) {
        const current = merged[key];
        if ((current === null || current === undefined || current === '') && baseParams[key] !== undefined && baseParams[key] !== null && baseParams[key] !== '') {
            merged[key] = baseParams[key];
        }
    }
    return merged;
}

// ── DeepSeek 调用（带超时+重试） ──
function callDeepSeek(messages, retries = 2) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            model: DEEPSEEK_MODEL,
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

// ── 共享：启动 FreeCAD 出图任务 ──
function launchDrawJob(fcParams, source, res, drawingName = '') {
    if (runningJobs >= MAX_CONCURRENT_FREECAD) {
        rotorError(res, 429, '出图队列已满（最多 ' + MAX_CONCURRENT_FREECAD + ' 个并发），请稍后再试');
        return null;
    }

    const jobId = crypto.randomUUID();
    const outputFile = 'output_' + jobId + '.pdf';
    const normalizedDrawingName = normalizeDrawingName(drawingName);
    activeJobs.set(jobId, { status: 'processing', drawingName: normalizedDrawingName });
    runningJobs++;

    const now = new Date().toISOString();
    try {
        safeInsert('rotor_drawings', {
            job_id: jobId,
            drawing_name: normalizedDrawingName,
            nl_input: source,
            params_json: JSON.stringify(fcParams),
            fc_params_json: JSON.stringify(fcParams),
            status: 'processing',
            created_at: now,
            updated_at: now,
        });
    } catch (dbErr) {
        console.error('[Rotor] DB insert error:', dbErr.message);
    }

    console.log('[Rotor] 启动后台出图 jobId=' + jobId, fcParams);

    fcParams._jobId = jobId;
    const args = [WORKER_SCRIPT, '--pass', JSON.stringify(fcParams)];
    execFile(FREECAD_BIN, args, { maxBuffer: 10 * 1024 * 1024, timeout: 180000, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
        runningJobs = Math.max(0, runningJobs - 1);
        console.log('[Rotor] FreeCAD stdout:\n' + stdout);
        if (stderr) console.error('[Rotor] FreeCAD stderr:\n' + stderr);

        if (error) {
            console.error('[Rotor] 💥 渲染异常:', error.message);
            activeJobs.set(jobId, { status: 'failed', error: error.message, drawingName: normalizedDrawingName, doneAt: Date.now() });
            try { updateRotorJob(jobId, { status: 'failed', error: error.message }); } catch(e){ console.error('[Rotor] DB update error:', e.message); }
            return;
        }

        const srcPdf = path.join(path.dirname(WORKER_SCRIPT), `output_${jobId}.pdf`);
        const destDir = path.join(__dirname, '../../public/drawings');
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        const destPdf = path.join(destDir, outputFile);

        try {
            if (fs.existsSync(srcPdf)) {
                fs.copyFileSync(srcPdf, destPdf);
                fs.unlinkSync(srcPdf);
                const srcWork = path.join(path.dirname(WORKER_SCRIPT), `work_${jobId}.FCStd`);
                if (fs.existsSync(srcWork)) try { fs.unlinkSync(srcWork); } catch(_){}
                const fileUrl = '/drawings/' + outputFile;
                console.log('[Rotor] ✅ PDF 已移至: ' + destPdf);
                activeJobs.set(jobId, { status: 'success', fileUrl, drawingName: normalizedDrawingName, doneAt: Date.now() });
                try { updateRotorJob(jobId, { status: 'success', file_url: fileUrl }); } catch(e){ console.error('[Rotor] DB update error:', e.message); }
            } else {
                activeJobs.set(jobId, { status: 'failed', error: '未找到 output PDF', drawingName: normalizedDrawingName, doneAt: Date.now() });
                try { updateRotorJob(jobId, { status: 'failed', error: '未找到 output PDF' }); } catch(e){ console.error('[Rotor] DB update error:', e.message); }
            }
        } catch (mvErr) {
            activeJobs.set(jobId, { status: 'failed', error: '移动PDF失败: ' + mvErr.message, drawingName: normalizedDrawingName, doneAt: Date.now() });
            try { updateRotorJob(jobId, { status: 'failed', error: mvErr.message }); } catch(e){ console.error('[Rotor] DB update error:', e.message); }
        }
    });

    return jobId;
}

// ── 共享：轴承查表 + 组装 FreeCAD 参数 ──
// P0-1: 严格数值校验白名单 — 防止异常值传入 execFile
const FC_PARAM_LIMITS = {
    piece_count:      { min: 1,   max: 1000 },
    rotor_dia:        { min: 1,   max: 500  },
    bearing_span:     { min: 1,   max: 1000 },
    stack_offset:     { min: 0,   max: 500  },
    oil_seal_dia:     { min: 1,   max: 200  },
    impeller_dia:     { min: 1,   max: 500  },
    impeller_depth:   { min: 0.1, max: 200  },
    thread_dia:       { min: 1,   max: 100  },
    thread_length:    { min: 1,   max: 500  },
    impeller_span:    { min: 1,   max: 500  },
    bearing_to_impeller: { min: 1, max: 500 },
};

function validateFcParam(key, value) {
    const v = parseFloat(value);
    if (!isFinite(v)) return null;
    const limits = FC_PARAM_LIMITS[key];
    if (limits && (v < limits.min || v > limits.max)) return null;
    return v;
}

function buildFcParams(params) {
    const fcParams = {};
    const errors = [];

    const upperBRaw = params.upper_bearing;
    const lowerBRaw = params.lower_bearing;
    const upperB = normalizeBearing(upperBRaw);
    const lowerB = normalizeBearing(lowerBRaw);

    if (upperB && BEARING_DB[upperB]) {
        fcParams.upper_bearing_dia = BEARING_DB[upperB].dia;
        fcParams.upper_bearing_depth = BEARING_DB[upperB].depth;
    } else if (upperB) {
        errors.push('未知的上轴承型号: ' + upperBRaw + (upperBRaw !== upperB ? ' (标准化后: ' + upperB + ')' : ''));
    }
    if (lowerB && BEARING_DB[lowerB]) {
        fcParams.lower_bearing_dia = BEARING_DB[lowerB].dia;
        fcParams.lower_bearing_depth = BEARING_DB[lowerB].depth;
    } else if (lowerB) {
        errors.push('未知的下轴承型号: ' + lowerBRaw + (lowerBRaw !== lowerB ? ' (标准化后: ' + lowerB + ')' : ''));
    }

    if (errors.length > 0) return { fcParams: null, errors };

    ['piece_count', 'rotor_dia', 'bearing_span', 'stack_offset',
     'oil_seal_dia', 'impeller_dia', 'impeller_depth',
     'thread_dia', 'thread_length'].forEach(k => {
        if (params[k] != null) {
            const v = validateFcParam(k, params[k]);
            if (v !== null) fcParams[k] = v;
        }
    });
    if (params.impeller_span != null) {
        const v = validateFcParam('impeller_span', params.impeller_span);
        if (v !== null) fcParams.bearing_to_impeller = v;
    }
    if (params.bearing_to_impeller != null) {
        const v = validateFcParam('bearing_to_impeller', params.bearing_to_impeller);
        if (v !== null) fcParams.bearing_to_impeller = v;
    }

    if (fcParams.piece_count) {
        fcParams._core_length = fcParams.piece_count * 0.5;
    }
    const drawingText = normalizeDrawingText(params.drawingText ?? params.drawing_text);
    if (drawingText) fcParams._drawing_text = drawingText;
    // 开档(bearing_span)已经包含叠片长度(_core_length)，总长不能再叠加片数长度。
    // 因此同一开档下，仅修改 piece_count 不应改变 _total_length。
    const totalLen = Number(fcParams.upper_bearing_depth || 0)
        + Number(fcParams.bearing_span || 0)
        + Number(fcParams.bearing_to_impeller || 0)
        + Number(fcParams.impeller_depth || 0)
        + Number(fcParams.thread_length || 0);
    if (totalLen > 0) fcParams._total_length = totalLen;

    return { fcParams, errors: [] };
}

// ═══════════════════════════════════════════════
// POST /draw — 结构化参数出图（供 AI 助手 / 外部系统调用）
// ═══════════════════════════════════════════════
router.post('/draw', (req, res) => {
    try {
        const params = req.body;
        if (!params || Object.keys(params).length === 0) {
            return rotorError(res, 400, '缺少参数，请至少提供一项出图参数');
        }

        console.log('[Rotor] /draw 收到结构化出图请求:', params);

        const { fcParams, errors } = buildFcParams(params);
        if (errors.length > 0) {
            return rotorError(res, 400, errors.join('; '));
        }
        if (Object.keys(fcParams).filter(k => !k.startsWith('_')).length === 0) {
            return rotorError(res, 400, '未提取到有效参数');
        }

        const drawingName = normalizeDrawingName(params.drawingName ?? params.drawing_name);
        const jobId = launchDrawJob(fcParams, '[API] ' + JSON.stringify(params), res, drawingName);
        if (!jobId) return;

        return rotorSuccess(res, {
            status: 'success',
            message: '出图任务已启动',
            jobId,
            drawingName,
            params: fcParams
        });
    } catch (e) {
        console.error('[Rotor] /draw 错误:', e);
        return rotorError(res, 500, e.message);
    }
});

// ═══════════════════════════════════════════════
// POST /save — 保存暂定转子参数，不启动 FreeCAD
// ═══════════════════════════════════════════════
router.post('/save', (req, res) => {
    try {
        const params = req.body;
        if (!params || Object.keys(params).length === 0) {
            return res.status(400).json({ success: false, error: '缺少参数，请至少提供一项转子参数' });
        }

        const { fcParams, errors } = buildFcParams(params);
        if (errors.length > 0) {
            return res.status(400).json({ success: false, error: errors.join('; ') });
        }
        if (Object.keys(fcParams).filter(k => !k.startsWith('_')).length === 0) {
            return res.status(400).json({ success: false, error: '未提取到有效参数' });
        }

        const jobId = 'saved-' + crypto.randomUUID();
        const drawingName = normalizeDrawingName(params.drawingName ?? params.drawing_name, '暂存转子参数');
        const now = new Date().toISOString();
        safeInsert('rotor_drawings', {
            job_id: jobId,
            drawing_name: drawingName,
            nl_input: '[SAVED] ' + JSON.stringify(params),
            params_json: JSON.stringify(params),
            fc_params_json: JSON.stringify(fcParams),
            status: 'saved',
            created_at: now,
            updated_at: now,
        });

        return res.json({
            success: true,
            data: { jobId, drawingName, params: fcParams },
            jobId,
            drawingName,
            params: fcParams
        });
    } catch (e) {
        console.error('[Rotor] /save 错误:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════
// POST /chat — 自然语言出图（前端页面使用）
// ═══════════════════════════════════════════════
router.post('/chat', async (req, res) => {
    try {
        const { message, force, supplements, baseParams } = req.body;
        const drawingName = normalizeDrawingName(req.body.drawingName ?? req.body.drawing_name);
        const drawingText = normalizeDrawingText(req.body.drawingText ?? req.body.drawing_text);
        if (!message) return rotorError(res, 400, '缺少 message 字段');

        if (!DEEPSEEK_API_KEY) {
            return rotorError(res, 500, '未配置 DEEPSEEK_API_KEY');
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

        // 2. 正则兜底
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

        parsed = mergeRotorBaseParams(baseParams, parsed);

        // 3. 组装参数
        const { fcParams, errors } = buildFcParams(parsed);
        if (errors.length > 0) {
            return rotorError(res, 400, errors.join('; '));
        }

        if (Object.keys(fcParams).filter(k => !k.startsWith('_')).length === 0) {
            return rotorSuccess(res, { status: 'need_params', message: aiReply, extracted: parsed });
        }
        if (drawingText) fcParams._drawing_text = drawingText;

        // 4. 安全校验 (未 force 时触发)
        if (!force) {
            let hasWarning = false;
            let warningPayload = { status: 'warning', extracted: parsed };

            const requiredLengthParams = [
                { key: 'upper_bearing_depth', name: '上轴承深度', value: fcParams.upper_bearing_depth },
                { key: 'bearing_span', name: '开档', value: fcParams.bearing_span },
                { key: 'bearing_to_impeller', name: '叶轮开档', value: fcParams.bearing_to_impeller },
                { key: 'impeller_depth', name: '叶轮厚度', value: fcParams.impeller_depth },
                { key: 'thread_length', name: '螺纹长度', value: fcParams.thread_length }
            ];
            const missingLengthParams = requiredLengthParams.filter(p => p.value == null);
            const providedLengthParams = requiredLengthParams.filter(p => p.value != null);

            if (providedLengthParams.length > 0 && missingLengthParams.length > 0) {
                const totalLenCalc = requiredLengthParams.reduce((sum, p) => sum + (p.value || 0), 0);
                hasWarning = true;
                warningPayload.missing_length = {
                    missing_params: missingLengthParams.map(p => ({ key: p.key, name: p.name })),
                    components: requiredLengthParams.map(p => ({ name: p.name, value: p.value != null ? p.value : 0, missing: p.value == null })),
                    calculated_total: totalLenCalc
                };
            }

            const bSpan = fcParams.bearing_span, pCount = fcParams.piece_count, sOffset = fcParams.stack_offset;
            if (bSpan != null && pCount != null && sOffset != null) {
                const clearance = bSpan - (pCount / 2) - sOffset;
                if (clearance < 35) {
                    hasWarning = true;
                    warningPayload.stator_clearance = {
                        message: '线圈与上轴承端盖距离过短（' + clearance.toFixed(1) + 'mm < 35mm），可能会导致漏电或干涉',
                        clearance: Math.round(clearance * 10) / 10
                    };
                }
            }

            if (hasWarning) return rotorSuccess(res, warningPayload);
        }

        // 合并补充参数
        if (force && supplements && typeof supplements === 'object') {
            for (const [k, v] of Object.entries(supplements)) {
                if (typeof v === 'number' && v > 0) {
                    fcParams[k] = v;
                }
            }
            const tl = Number(fcParams.upper_bearing_depth || 0) + Number(fcParams.bearing_span || 0)
                + Number(fcParams.bearing_to_impeller || 0) + Number(fcParams.impeller_depth || 0) + Number(fcParams.thread_length || 0);
            if (tl > 0) fcParams._total_length = tl;
        }

        // 5. 启动出图
        const jobId = launchDrawJob(fcParams, message, res, drawingName);
        if (!jobId) return;

        return rotorSuccess(res, {
            status: 'success',
            message: '已收到指令，正在后台为您生成转子图纸...',
            jobId,
            drawingName,
            extracted: parsed
        });

    } catch (e) {
        console.error('[Rotor] 路由错误:', e);
        return rotorError(res, 500, e.message);
    }
});

// ═══════════════════════════════════════════════
// GET /status/:jobId — 查询出图任务状态
// ═══════════════════════════════════════════════
router.get('/status/:jobId', (req, res) => {
    const job = activeJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, status: 'not_found', message: '找不到此任务' });
    res.json({ success: true, data: job, ...job });
});

// ═══════════════════════════════════════════════
// GET /history — 出图历史记录
// ═══════════════════════════════════════════════
router.get('/history', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM rotor_drawings ORDER BY created_at DESC LIMIT 100').all();
        res.json({ success: true, data: rows.map(rotorHistoryRow) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// PATCH /history/:id/name — 重命名图纸
router.patch('/history/:id/name', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法记录ID' });
        const row = db.prepare('SELECT * FROM rotor_drawings WHERE id = ?').get(id);
        if (!row) return res.status(404).json({ success: false, error: '记录不存在' });
        const drawingName = normalizeDrawingName(req.body.drawingName ?? req.body.drawing_name);
        safeUpdate('rotor_drawings', id, { drawing_name: drawingName });
        if (row.job_id && activeJobs.has(row.job_id)) {
            const job = activeJobs.get(row.job_id);
            activeJobs.set(row.job_id, { ...job, drawingName });
        }
        res.json({ success: true, data: { drawingName } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════
// DELETE /history/:id — 删除出图记录
// ═══════════════════════════════════════════════
router.delete('/history/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法记录ID' });
        const row = db.prepare('SELECT * FROM rotor_drawings WHERE id = ?').get(id);
        if (!row) return res.status(404).json({ success: false, error: '记录不存在' });
        // 删除对应 PDF 文件
        if (row.file_url) {
            const filePath = path.join(__dirname, '../../public', row.file_url);
            if (fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch(_){}
            }
        }
        hardDelete('rotor_drawings', id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ═══════════════════════════════════════════════
// POST /print/:jobId — 打印图纸
// ═══════════════════════════════════════════════
router.post('/print/:jobId', (req, res) => {
    try {
        // 先查内存缓存
        let fileUrl = null;
        const job = activeJobs.get(req.params.jobId);
        if (job && job.status === 'success' && job.fileUrl) {
            fileUrl = job.fileUrl;
        }
        // 内存没有则查数据库
        if (!fileUrl) {
            const row = db.prepare('SELECT file_url, status FROM rotor_drawings WHERE job_id = ?').get(req.params.jobId);
            if (!row) return res.status(404).json({ success: false, error: '找不到此任务' });
            if (row.status !== 'success') return res.status(400).json({ success: false, error: '该任务尚未成功完成，无法打印' });
            fileUrl = row.file_url;
        }
        if (!fileUrl) return res.status(400).json({ success: false, error: '找不到 PDF 文件路径' });

        const pdfPath = path.join(__dirname, '../../public', fileUrl);
        if (!fs.existsSync(pdfPath)) {
            return res.status(404).json({ success: false, error: 'PDF 文件不存在: ' + fileUrl });
        }

        // 使用多种方式尝试打印
        const { execFileSync } = require('child_process');
        let printed = false;
        let lastErr = '';

        // 方案1: 用 SumatraPDF（如已安装）
        try {
            execFileSync('where', ['SumatraPDF'], { timeout: 3000 });
            console.log('[Rotor] 🖨️ 尝试 SumatraPDF:', pdfPath);
            execFileSync('SumatraPDF', ['-print-to-default', '-silent', pdfPath], { timeout: 30000 });
            printed = true;
        } catch (e) { lastErr = e.message; }

        // 方案2: 用 msedge 打印（大多数 Windows 都有）
        if (!printed) {
            try {
                const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
                if (fs.existsSync(edgePath)) {
                    console.log('[Rotor] 🖨️ 尝试 Edge 打印:', pdfPath);
                    execFileSync(edgePath, [
                        '--headless',
                        '--disable-gpu',
                        '--print-to-pdf-no-header',
                        '--no-pdf-header-footer',
                        '--print-to-default-printer',
                        pdfPath
                    ], { timeout: 30000 });
                    printed = true;
                }
            } catch (e) { lastErr = e.message; }
        }

        // 方案3: Windows 内置 ShellExecute print（兜底）
        if (!printed) {
            try {
                console.log('[Rotor] 🖨️ 尝试 rundll32 打印:', pdfPath);
                execFileSync('rundll32.exe', ['mshtml.dll,PrintHTML', pdfPath], { timeout: 15000 });
                printed = true;
            } catch (e) { lastErr = e.message; }
        }

        if (printed) {
            console.log('[Rotor] ✅ 打印指令已发送: ' + pdfPath);
            res.json({ success: true, message: '打印指令已发送到默认打印机' });
        } else {
            throw new Error('所有打印方式均失败: ' + lastErr);
        }
    } catch (e) {
        console.error('[Rotor] 🖨️ 打印失败:', e.message);
        res.status(500).json({ success: false, error: '打印失败: ' + e.message });
    }
});

// ═══════════════════════════════════════════════
// GET /order-pump-models — 获取订单中的水泵型号列表（供关联选择）
// ═══════════════════════════════════════════════
router.get('/order-pump-models', (req, res) => {
    try {
        const orders = db.prepare('SELECT id, customer_name, contract_no, items_json FROM orders ORDER BY updated_at DESC').all();
        const models = [];
        for (const row of orders) {
            try {
                const items = JSON.parse(row.items_json || '[]');
                for (const item of items) {
                    if (item.recipeName) {
                        models.push({
                            orderId: row.id,
                            customerName: row.customer_name || '',
                            contractNo: row.contract_no || '',
                            recipeName: item.recipeName,
                            spec: item.spec || ''
                        });
                    }
                }
            } catch { /* skip parse errors */ }
        }
        res.json({ success: true, data: models });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════
// POST /template-draft — 根据泵壳模板/变体生成转子出图表单草稿，不写库
// ═══════════════════════════════════════════════
router.post('/template-draft', (req, res) => {
    try {
        const templateId = parsePositiveId(req.body?.templateId);
        if (!templateId) return res.status(400).json({ success: false, error: 'templateId 为必填' });
        const template = db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(templateId);
        if (!template) return res.status(404).json({ success: false, error: '模板不存在' });

        let variant = null;
        const variantId = req.body?.variantId ? parsePositiveId(req.body.variantId) : null;
        if (variantId) {
            variant = db.prepare('SELECT * FROM pump_model_variants WHERE id = ? AND deleted_at IS NULL').get(variantId);
            if (!variant) return res.status(404).json({ success: false, error: '型号变体不存在' });
            if (Number(variant.template_id) !== Number(templateId)) return res.status(400).json({ success: false, error: '型号变体不属于该模板' });
        }

        const parts = db.prepare('SELECT model, category, remark AS notes FROM parts WHERE deleted_at IS NULL').all();
        const draft = buildRotorTemplateDraft({ template, variant, parts });
        res.json({ success: true, data: { ...draft, templateId, variantId: variantId || null } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════
// GET /link-targets — 获取出图记录可关联对象（订单/变体/配方）
// ═══════════════════════════════════════════════
router.get('/link-targets', (req, res) => {
    try {
        const targets = [];

        const orders = db.prepare('SELECT id, customer_name, contract_no, items_json FROM orders WHERE deleted_at IS NULL ORDER BY updated_at DESC').all();
        for (const row of orders) {
            try {
                const items = JSON.parse(row.items_json || '[]');
                for (const item of items) {
                    if (!item.recipeName) continue;
                    const label = item.recipeName + (item.spec ? ` (${item.spec})` : '');
                    targets.push({
                        type: 'order',
                        id: `${row.id}:${item.recipeName}`,
                        label,
                        value: `订单:${label}`,
                        secondary: `订单#${row.id} - ${row.customer_name || ''}${row.contract_no ? ' / ' + row.contract_no : ''}`,
                    });
                }
            } catch { /* skip parse errors */ }
        }

        const variants = db.prepare(`
            SELECT v.id, v.model_name, v.barrel_length, v.coil_spec, v.coil_sheets, t.shell_model
            FROM pump_model_variants v
            LEFT JOIN pump_shell_templates t ON t.id = v.template_id
            WHERE v.deleted_at IS NULL
            ORDER BY v.model_name
        `).all();
        variants.forEach(row => {
            const details = [
                row.shell_model || '',
                row.barrel_length ? `机筒${row.barrel_length}mm` : '',
                row.coil_spec ? `${row.coil_spec}-${row.coil_sheets || 0}` : '',
            ].filter(Boolean).join(' / ');
            targets.push({
                type: 'variant',
                id: String(row.id),
                label: row.model_name,
                value: `变体:${row.model_name}`,
                secondary: details || '型号变体',
            });
        });

        const recipes = db.prepare(`
            SELECT id, name, spec, custom_barrel_length, coil_spec, coil_sheets
            FROM recipes
            WHERE deleted_at IS NULL
            ORDER BY updated_at DESC
        `).all();
        recipes.forEach(row => {
            const label = row.name + (row.spec ? ` (${row.spec})` : '');
            const details = [
                row.custom_barrel_length ? `机筒${row.custom_barrel_length}mm` : '',
                row.coil_spec ? `${row.coil_spec}-${row.coil_sheets || 0}` : '',
            ].filter(Boolean).join(' / ');
            targets.push({
                type: 'recipe',
                id: String(row.id),
                label,
                value: `配方:${label}`,
                secondary: details || `配方#${row.id}`,
            });
        });

        res.json({ success: true, data: targets });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════
// PATCH /history/:id/link — 关联水泵型号到出图记录
// ═══════════════════════════════════════════════
router.patch('/history/:id/link', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法记录ID' });
        const linkedPumpModel = req.body.linkedPumpModel ?? req.body.linked_pump_model;
        if (typeof linkedPumpModel !== 'string') {
            return res.status(400).json({ success: false, error: '缺少 linkedPumpModel 参数' });
        }
        const row = db.prepare('SELECT * FROM rotor_drawings WHERE id = ?').get(id);
        if (!row) return res.status(404).json({ success: false, error: '记录不存在' });
        safeUpdate('rotor_drawings', id, { linked_pump_model: linkedPumpModel });
        res.json({ success: true, data: { linkedPumpModel }, linkedPumpModel });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
