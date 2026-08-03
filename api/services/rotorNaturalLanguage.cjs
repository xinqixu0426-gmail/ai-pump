const https = require('https');
const {
    buildFcParams,
    normalizeDrawingName,
    normalizeDrawingText,
} = require('./rotorParameters.cjs');

const DEFAULT_MODEL = 'deepseek-v4-flash';
const ROTOR_PARAM_KEYS = Object.freeze([
    'upper_bearing',
    'lower_bearing',
    'piece_count',
    'rotor_dia',
    'bearing_span',
    'stack_offset',
    'oil_seal_dia',
    'impeller_dia',
    'impeller_span',
    'bearing_to_impeller',
    'impeller_depth',
    'thread_length',
    'thread_dia',
]);

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

class RotorNaturalLanguageError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.name = 'RotorNaturalLanguageError';
        this.statusCode = statusCode;
    }
}

function mergeRotorBaseParams(baseParams, parsed) {
    if (!baseParams || typeof baseParams !== 'object') return parsed;
    const merged = { ...parsed };
    for (const key of ROTOR_PARAM_KEYS) {
        const current = merged[key];
        const fallback = baseParams[key];
        if (
            (current === null || current === undefined || current === '')
            && fallback !== undefined
            && fallback !== null
            && fallback !== ''
        ) {
            merged[key] = fallback;
        }
    }
    return merged;
}

function parseModelReply(response) {
    const rawReply = String(
        response?.choices?.[0]?.message?.content || ''
    ).trim();
    try {
        return JSON.parse(rawReply);
    } catch (_error) {
        const match = rawReply.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new RotorNaturalLanguageError('无法解析 AI 返回结果');
    }
}

function applyDeterministicCorrections(message, input) {
    const parsed = { ...input };
    const stack = message.match(/定位\s*(\d+\.?\d*)/);
    if (stack) {
        parsed.stack_offset = Number.parseFloat(stack[1]);
        if (
            parsed.rotor_dia === parsed.stack_offset
            && !message.match(/直径/)
        ) {
            parsed.rotor_dia = null;
        }
    }
    const impellerSpan = message.match(/叶轮开档\s*(\d+\.?\d*)/);
    if (impellerSpan) {
        parsed.impeller_span = Number.parseFloat(impellerSpan[1]);
        if (
            parsed.impeller_dia === parsed.impeller_span
            && !message.match(/叶轮孔径|叶轮直径/)
        ) {
            parsed.impeller_dia = null;
        }
    }
    const impellerDepth = message.match(/叶轮厚度\s*(\d+\.?\d*)/);
    if (impellerDepth) {
        parsed.impeller_depth = Number.parseFloat(impellerDepth[1]);
        if (
            parsed.impeller_dia === parsed.impeller_depth
            && !message.match(/叶轮孔径|叶轮直径/)
        ) {
            parsed.impeller_dia = null;
        }
    }
    const rotorDiameter = message.match(/转子直径\s*(\d+\.?\d*)/);
    if (rotorDiameter) {
        parsed.rotor_dia = Number.parseFloat(rotorDiameter[1]);
    }
    return parsed;
}

function buildSafetyWarning(fcParams, extracted) {
    let hasWarning = false;
    const warning = {
        status: 'warning',
        extracted,
    };
    const requiredLengthParams = [
        {
            key: 'upper_bearing_depth',
            name: '上轴承深度',
            value: fcParams.upper_bearing_depth,
        },
        {
            key: 'bearing_span',
            name: '开档',
            value: fcParams.bearing_span,
        },
        {
            key: 'bearing_to_impeller',
            name: '叶轮开档',
            value: fcParams.bearing_to_impeller,
        },
        {
            key: 'impeller_depth',
            name: '叶轮厚度',
            value: fcParams.impeller_depth,
        },
        {
            key: 'thread_length',
            name: '螺纹长度',
            value: fcParams.thread_length,
        },
    ];
    const missingLengthParams = requiredLengthParams.filter(
        item => item.value == null
    );
    const providedLengthParams = requiredLengthParams.filter(
        item => item.value != null
    );
    if (
        providedLengthParams.length > 0
        && missingLengthParams.length > 0
    ) {
        const calculatedTotal = requiredLengthParams.reduce(
            (sum, item) => sum + (item.value || 0),
            0
        );
        hasWarning = true;
        warning.missing_length = {
            missing_params: missingLengthParams.map(item => ({
                key: item.key,
                name: item.name,
            })),
            components: requiredLengthParams.map(item => ({
                name: item.name,
                value: item.value != null ? item.value : 0,
                missing: item.value == null,
            })),
            calculated_total: calculatedTotal,
        };
    }

    const bearingSpan = fcParams.bearing_span;
    const pieceCount = fcParams.piece_count;
    const stackOffset = fcParams.stack_offset;
    if (
        bearingSpan != null
        && pieceCount != null
        && stackOffset != null
    ) {
        const clearance = bearingSpan - (pieceCount / 2) - stackOffset;
        if (clearance < 35) {
            hasWarning = true;
            warning.stator_clearance = {
                message:
                    `线圈与上轴承端盖距离过短（${clearance.toFixed(1)}mm < 35mm），可能会导致漏电或干涉`,
                clearance: Math.round(clearance * 10) / 10,
            };
        }
    }
    return hasWarning ? warning : null;
}

function applySupplements(fcParams, supplements) {
    if (!supplements || typeof supplements !== 'object') return;
    for (const [key, value] of Object.entries(supplements)) {
        if (typeof value === 'number' && value > 0) {
            fcParams[key] = value;
        }
    }
    const totalLength = Number(fcParams.upper_bearing_depth || 0)
        + Number(fcParams.bearing_span || 0)
        + Number(fcParams.bearing_to_impeller || 0)
        + Number(fcParams.impeller_depth || 0)
        + Number(fcParams.thread_length || 0);
    if (totalLength > 0) fcParams._total_length = totalLength;
}

function callDeepSeek(
    messages,
    retries = 2,
    {
        apiKey = process.env.DEEPSEEK_API_KEY,
        model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
        request = https.request,
        setTimer = setTimeout,
    } = {}
) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            model,
            messages,
            temperature: 0.1,
            max_tokens: 200,
        });
        const req = request({
            hostname: 'api.deepseek.com',
            port: 443,
            path: '/v1/chat/completions',
            method: 'POST',
            timeout: 15000,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        }, (response) => {
            let data = '';
            response.on('data', chunk => {
                data += chunk;
            });
            response.on('end', () => {
                if (
                    response.statusCode >= 200
                    && response.statusCode < 300
                ) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(error);
                    }
                } else if (response.statusCode >= 500 && retries > 0) {
                    console.warn(
                        `[Rotor] DeepSeek 5xx, retrying... remaining=${retries}`
                    );
                    setTimer(
                        () => callDeepSeek(
                            messages,
                            retries - 1,
                            { apiKey, model, request, setTimer }
                        ).then(resolve, reject),
                        1000
                    );
                } else {
                    reject(new Error(
                        `DeepSeek API Error: ${response.statusCode} ${data}`
                    ));
                }
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('DeepSeek request timeout (15s)'));
        });
        req.on('error', (error) => {
            if (retries > 0) {
                console.warn(
                    `[Rotor] DeepSeek network error, retrying... remaining=${retries}`
                );
                setTimer(
                    () => callDeepSeek(
                        messages,
                        retries - 1,
                        { apiKey, model, request, setTimer }
                    ).then(resolve, reject),
                    1000
                );
            } else {
                reject(error);
            }
        });
        req.write(payload);
        req.end();
    });
}

function createRotorNaturalLanguageService({
    buildDrawPreview,
    callModel = callDeepSeek,
    apiKey = process.env.DEEPSEEK_API_KEY,
    model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
} = {}) {
    if (typeof buildDrawPreview !== 'function') {
        throw new Error('转子自然语言服务缺少 buildDrawPreview');
    }

    async function preview(rawInput = {}, actorKey) {
        const message = rawInput.message;
        if (!message) {
            throw new RotorNaturalLanguageError('缺少 message 字段', 400);
        }
        if (!apiKey) {
            throw new RotorNaturalLanguageError(
                '未配置 DEEPSEEK_API_KEY',
                500
            );
        }

        console.log('[Rotor] 收到出图指令:', message);
        const response = await callModel([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: message },
        ], 2, { apiKey, model });
        const parsedReply = parseModelReply(response);
        const reply = parsedReply.reply || '好的，正在为您处理';
        let extracted = applyDeterministicCorrections(
            message,
            parsedReply
        );
        extracted = mergeRotorBaseParams(
            rawInput.baseParams,
            extracted
        );

        const { fcParams, errors } = buildFcParams(extracted);
        if (errors.length > 0) {
            throw new RotorNaturalLanguageError(
                errors.join('; '),
                400
            );
        }
        if (
            Object.keys(fcParams)
                .filter(key => !key.startsWith('_'))
                .length === 0
        ) {
            return {
                status: 'need_params',
                message: reply,
                extracted,
            };
        }

        const drawingText = normalizeDrawingText(
            rawInput.drawingText ?? rawInput.drawing_text
        );
        if (drawingText) fcParams._drawing_text = drawingText;
        if (!rawInput.force) {
            const warning = buildSafetyWarning(fcParams, extracted);
            if (warning) return warning;
        }
        if (rawInput.force) {
            applySupplements(fcParams, rawInput.supplements);
        }

        const drawingName = normalizeDrawingName(
            rawInput.drawingName ?? rawInput.drawing_name
        );
        const previewResult = buildDrawPreview(
            {
                ...extracted,
                ...(
                    rawInput.force
                    && rawInput.supplements
                    && typeof rawInput.supplements === 'object'
                        ? rawInput.supplements
                        : {}
                ),
                drawingName,
                drawingText,
                source: message,
            },
            actorKey
        );
        return {
            ...previewResult,
            status: 'confirmation_required',
            message: '参数已整理，请确认后生成图纸',
            extracted,
        };
    }

    return { preview };
}

module.exports = {
    DEFAULT_MODEL,
    ROTOR_PARAM_KEYS,
    RotorNaturalLanguageError,
    SYSTEM_PROMPT,
    applyDeterministicCorrections,
    buildSafetyWarning,
    callDeepSeek,
    createRotorNaturalLanguageService,
    mergeRotorBaseParams,
    parseModelReply,
};
