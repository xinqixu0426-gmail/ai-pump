const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    aiProviderCapabilities,
    fetchAiProvider,
    prepareAiProviderMessages,
    resolveAiProviderConfig,
    resolveAiProviderRoute,
} = require('../api/services/aiProvider.cjs');

function createFileAccessors() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE factory_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_name TEXT NOT NULL,
            extension TEXT NOT NULL,
            detected_type TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            file_sha256 TEXT NOT NULL UNIQUE,
            file_blob BLOB NOT NULL,
            parser_status TEXT NOT NULL,
            source_type TEXT NOT NULL,
            duplicate_count INTEGER NOT NULL,
            metadata_json TEXT NOT NULL,
            parsed_text TEXT NOT NULL DEFAULT '',
            parsed_json TEXT NOT NULL DEFAULT '{}',
            parser_error TEXT NOT NULL DEFAULT '',
            parsed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
    `);
    const insert = db.prepare(`
        INSERT INTO factory_files (
            original_name, extension, detected_type, mime_type, file_size,
            file_sha256, file_blob, parser_status, source_type, duplicate_count,
            metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'direct_upload', 1, '{}', ?, ?)
    `);
    const now = '2026-07-29T00:00:00.000Z';
    const image = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const imageId = Number(insert.run(
        '泵壳.png', '.png', 'image', 'image/png', image.length,
        'image-hash', image, now, now
    ).lastInsertRowid);
    db.prepare(`
        UPDATE factory_files
        SET parser_status = 'parsed',
            parsed_text = '【图片 OCR】\nVoltage: 220V',
            parsed_json = '{"version":"image-ocr-v1","ocrApplied":true,"confidence":92,"pageCount":1,"drawingCandidateCount":1,"drawingCandidates":[{"label":"电压","value":"220","unit":"V","confidence":92,"needsReview":false,"source":{"pageNumber":1,"lineNumber":1}}]}',
            parsed_at = ?
        WHERE id = ?
    `).run(now, imageId);
    const note = Buffer.from('技术参数：扬程 38m', 'utf8');
    const textId = Number(insert.run(
        '参数.txt', '.txt', 'text', 'text/plain; charset=utf-8', note.length,
        'text-hash', note, now, now
    ).lastInsertRowid);
    const pdf = Buffer.from('%PDF-test');
    const pdfId = Number(insert.run(
        '报告.pdf', '.pdf', 'pdf', 'application/pdf', pdf.length,
        'pdf-hash', pdf, now, now
    ).lastInsertRowid);
    db.prepare(`
        UPDATE factory_files
        SET parser_status = 'parsed',
            parsed_text = '【第 1 页】\n流量 10 | 扬程 38',
            parsed_json = '{"version":"pdf-v1","pageCount":1,"parsedPageCount":1,"requiresOcr":false}',
            parsed_at = ?
        WHERE id = ?
    `).run(now, pdfId);
    const scan = Buffer.from('%PDF-scan');
    const scannedPdfId = Number(insert.run(
        '扫描图纸.pdf', '.pdf', 'pdf', 'application/pdf', scan.length,
        'scan-hash', scan, now, now
    ).lastInsertRowid);
    db.prepare(`
        UPDATE factory_files
        SET parser_status = 'metadata_only',
            parsed_json = '{"version":"pdf-v1","pageCount":1,"parsedPageCount":1,"requiresOcr":true}',
            parsed_at = ?
        WHERE id = ?
    `).run(now, scannedPdfId);
    const spreadsheet = Buffer.from('spreadsheet');
    const spreadsheetId = Number(insert.run(
        '客户报价.xlsx', '.xlsx', 'spreadsheet',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        spreadsheet.length, 'spreadsheet-hash', spreadsheet, now, now
    ).lastInsertRowid);
    db.prepare(`
        UPDATE factory_files
        SET parser_status = 'parsed',
            parsed_text = '【工作表：报价】\n[第 1 行] A: 产品型号 | B: 数量\n[第 2 行] A: V750 | B: 30',
            parsed_json = '{"version":"spreadsheet-v1","sheetCount":1,"parsedSheetCount":1,"rowCount":2}',
            parsed_at = ?
        WHERE id = ?
    `).run(now, spreadsheetId);
    return { db, imageId, textId, pdfId, scannedPdfId, spreadsheetId };
}

test('V9.1 AI 模型适配：默认保持 DeepSeek，Kimi 多模态能力可配置', () => {
    const deepseek = resolveAiProviderConfig({
        DEEPSEEK_API_KEY: 'deepseek-key',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
    });
    assert.equal(deepseek.provider, 'deepseek');
    assert.equal(deepseek.supportsImages, false);

    const kimi = aiProviderCapabilities({
        AI_PROVIDER: 'kimi',
        KIMI_API_KEY: 'kimi-key',
        KIMI_MODEL: 'kimi-k2.6',
    });
    assert.equal(kimi.displayName, 'Kimi 开放平台');
    assert.equal(kimi.supportsImages, true);
    assert.equal(kimi.maxAttachments, 4);
});

test('AI 智能路由：普通对话走 DeepSeek，图片和文件走 Kimi K3', () => {
    const accessors = createFileAccessors();
    const env = {
        AI_PROVIDER: 'auto',
        DEEPSEEK_API_KEY: 'deepseek-key',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
        KIMI_API_KEY: 'kimi-key',
        KIMI_MODEL: 'kimi-k3',
        AI_VISION_ENABLED: 'true',
    };
    try {
        assert.equal(resolveAiProviderRoute([{
            role: 'user',
            content: '查询订单',
        }], { env, dbAccessors: { db: accessors.db } }).provider, 'deepseek');

        assert.equal(resolveAiProviderRoute([{
            role: 'user',
            content: '分析表格',
            attachments: [{ id: accessors.spreadsheetId }],
        }], { env, dbAccessors: { db: accessors.db } }).provider, 'kimi');

        const imageRoute = resolveAiProviderRoute([{
            role: 'user',
            content: '识别图片',
            attachments: [{ id: accessors.imageId }],
        }], { env, dbAccessors: { db: accessors.db } });
        assert.equal(imageRoute.provider, 'kimi');
        assert.equal(imageRoute.routeReason, 'image');

        const capabilities = aiProviderCapabilities(env);
        assert.equal(capabilities.provider, 'auto');
        assert.equal(capabilities.defaultProvider, 'deepseek');
        assert.equal(capabilities.visionProvider, 'kimi');
        assert.equal(capabilities.fileProvider, 'kimi');
        assert.equal(capabilities.supportsImages, true);
    } finally {
        accessors.db.close();
    }
});

test('AI 智能路由：关闭视觉只影响图片，PDF和表格仍使用 Kimi 文件抽取', () => {
    const accessors = createFileAccessors();
    const env = {
        AI_PROVIDER: 'auto',
        DEEPSEEK_API_KEY: 'deepseek-key',
        KIMI_API_KEY: 'kimi-key',
        KIMI_MODEL: 'kimi-k3',
        AI_VISION_ENABLED: 'false',
    };
    try {
        const spreadsheetRoute = resolveAiProviderRoute([{
            role: 'user',
            content: '分析表格',
            attachments: [{ id: accessors.spreadsheetId }],
        }], { env, dbAccessors: { db: accessors.db } });
        assert.equal(spreadsheetRoute.provider, 'kimi');
        assert.equal(spreadsheetRoute.routeReason, 'file');

        const imageRoute = resolveAiProviderRoute([{
            role: 'user',
            content: '识别图片',
            attachments: [{ id: accessors.imageId }],
        }], { env, dbAccessors: { db: accessors.db } });
        assert.equal(imageRoute.provider, 'deepseek');
        assert.equal(imageRoute.routeReason, 'vision_unavailable');

        const capabilities = aiProviderCapabilities(env);
        assert.equal(capabilities.supportsImages, false);
        assert.equal(capabilities.visionProvider, null);
        assert.equal(capabilities.fileProvider, 'kimi');
    } finally {
        accessors.db.close();
    }
});

test('AI 智能路由：Kimi 调用失败时回退 DeepSeek 和本地 OCR', async () => {
    const accessors = createFileAccessors();
    const requests = [];
    const providers = [];
    const env = {
        AI_PROVIDER: 'auto',
        DEEPSEEK_API_KEY: 'deepseek-key',
        DEEPSEEK_BASE_URL: 'https://api.deepseek.test',
        KIMI_API_KEY: 'kimi-key',
        KIMI_BASE_URL: 'https://api.kimi.test/v1',
        KIMI_MODEL: 'kimi-k3',
        AI_VISION_ENABLED: 'true',
    };
    try {
        const response = await fetchAiProvider([{
            role: 'user',
            content: '识别图片',
            attachments: [{ id: accessors.imageId }],
        }], {
            env,
            dbAccessors: { db: accessors.db },
            fetchImpl: async (url, init) => {
                requests.push({ url, body: JSON.parse(init.body) });
                if (requests.length <= 3) return new Response('Kimi unavailable', { status: 503 });
                return new Response(JSON.stringify({ choices: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            },
            onProvider: info => providers.push(info),
            retryDelayMs: 0,
        });

        assert.equal(response.ok, true);
        assert.equal(requests.length, 4);
        assert.match(requests[0].url, /api\.kimi\.test/);
        assert.equal(requests[0].body.model, 'kimi-k3');
        assert.equal(Array.isArray(requests[0].body.messages[0].content), true);
        assert.match(requests[3].url, /api\.deepseek\.test/);
        assert.equal(typeof requests[3].body.messages[0].content, 'string');
        assert.match(requests[3].body.messages[0].content, /本地 OCR 结果/);
        assert.equal(providers.at(-1).provider, 'deepseek');
        assert.equal(providers.at(-1).fallback, true);
        assert.equal(providers.at(-1).routeReason, 'vision_fallback');
    } finally {
        accessors.db.close();
    }
});

test('AI 工具路由：没有可用工具时模型请求不发送空 tools 字段', async () => {
    let requestBody;
    const response = await fetchAiProvider([{
        role: 'user',
        content: '你好',
    }], {
        env: {
            AI_PROVIDER: 'deepseek',
            DEEPSEEK_API_KEY: 'deepseek-key',
            DEEPSEEK_BASE_URL: 'https://api.deepseek.test',
        },
        tools: [],
        fetchImpl: async (_url, init) => {
            requestBody = JSON.parse(init.body);
            return new Response(JSON.stringify({ choices: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });

    assert.equal(response.ok, true);
    assert.equal(Object.hasOwn(requestBody, 'tools'), false);
});

test('V2 意图规划：模型请求透传强制结构化 tool_choice', async () => {
    let requestBody;
    const toolChoice = {
        type: 'function',
        function: { name: 'submit_ai_intent_plan' },
    };
    const response = await fetchAiProvider([{ role: 'user', content: '查询缺货零件' }], {
        env: {
            AI_PROVIDER: 'deepseek',
            DEEPSEEK_API_KEY: 'deepseek-key',
            DEEPSEEK_BASE_URL: 'https://api.deepseek.test',
        },
        tools: [{
            type: 'function',
            function: {
                name: 'submit_ai_intent_plan',
                parameters: { type: 'object', properties: {} },
            },
        }],
        toolChoice,
        fetchImpl: async (_url, init) => {
            requestBody = JSON.parse(init.body);
            return new Response(JSON.stringify({ choices: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });

    assert.equal(response.ok, true);
    assert.deepEqual(requestBody.tool_choice, toolChoice);
    assert.deepEqual(requestBody.thinking, { type: 'disabled' });
});

test('AI provider：Kimi K3 强制工具选择时关闭 thinking 且不发送 reasoning_effort', async () => {
    let requestBody;
    const response = await fetchAiProvider([{ role: 'user', content: '查询缺货零件' }], {
        env: {
            AI_PROVIDER: 'kimi',
            KIMI_API_KEY: 'kimi-key',
            KIMI_BASE_URL: 'https://api.kimi-tool-choice.test/v1',
            KIMI_MODEL: 'kimi-k3',
            KIMI_REASONING_EFFORT: 'high',
        },
        tools: [{
            type: 'function',
            function: {
                name: 'submit_ai_intent_plan',
                parameters: { type: 'object', properties: {} },
            },
        }],
        toolChoice: {
            type: 'function',
            function: { name: 'submit_ai_intent_plan' },
        },
        fetchImpl: async (_url, init) => {
            requestBody = JSON.parse(init.body);
            return new Response(JSON.stringify({ choices: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });

    assert.equal(response.ok, true);
    assert.equal(requestBody.tool_choice, 'required');
    assert.deepEqual(requestBody.thinking, { type: 'disabled' });
    assert.equal(Object.hasOwn(requestBody, 'reasoning_effort'), false);
});

test('AI provider：Kimi 工具 schema 移除 Moonshot 不支持的组合约束', async () => {
    let requestBody;
    const response = await fetchAiProvider([{ role: 'user', content: '批量入库' }], {
        env: {
            AI_PROVIDER: 'kimi',
            KIMI_API_KEY: 'kimi-key',
            KIMI_BASE_URL: 'https://api.kimi-schema.test/v1',
            KIMI_MODEL: 'kimi-k3',
        },
        tools: [{
            type: 'function',
            function: {
                name: 'adjust_part_stock',
                parameters: {
                    type: 'object',
                    properties: {
                        changeQty: {
                            type: 'integer',
                            anyOf: [
                                { type: 'integer', maximum: -1 },
                                { type: 'integer', minimum: 1 },
                            ],
                        },
                    },
                    oneOf: [
                        { type: 'object', properties: {}, required: ['changeQty'] },
                    ],
                },
            },
        }],
        toolChoice: {
            type: 'function',
            function: { name: 'adjust_part_stock' },
        },
        fetchImpl: async (_url, init) => {
            requestBody = JSON.parse(init.body);
            return new Response(JSON.stringify({ choices: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });

    assert.equal(response.ok, true);
    const parametersText = JSON.stringify(requestBody.tools[0].function.parameters);
    assert.doesNotMatch(parametersText, /anyOf|oneOf|allOf/);
    assert.equal(requestBody.tools[0].function.parameters.properties.changeQty.type, 'integer');
});

test('AI provider：供应商拒绝 tool_choice 时同模型自动降级且不影响结构化工具', async () => {
    const bodies = [];
    const response = await fetchAiProvider([{ role: 'user', content: '查询订单' }], {
        env: {
            AI_PROVIDER: 'deepseek',
            DEEPSEEK_API_KEY: 'deepseek-key',
            DEEPSEEK_BASE_URL: 'https://api.deepseek-fallback.test',
            DEEPSEEK_MODEL: 'deepseek-v4-flash-fallback-test',
        },
        tools: [{
            type: 'function',
            function: {
                name: 'submit_ai_intent_plan',
                parameters: { type: 'object', properties: {} },
            },
        }],
        toolChoice: {
            type: 'function',
            function: { name: 'submit_ai_intent_plan' },
        },
        fetchImpl: async (_url, init) => {
            bodies.push(JSON.parse(init.body));
            if (bodies.length === 1) {
                return new Response(JSON.stringify({
                    error: { message: 'Thinking mode does not support this tool_choice' },
                }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify({ choices: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });

    assert.equal(response.ok, true);
    assert.equal(bodies.length, 2);
    assert.equal(Object.hasOwn(bodies[0], 'tool_choice'), true);
    assert.equal(Object.hasOwn(bodies[1], 'tool_choice'), false);
    assert.deepEqual(bodies[1].thinking, { type: 'disabled' });
});

test('V9.4 AI 附件：DeepSeek 不接收图片二进制但可读取本地 OCR 和文本附件', () => {
    const accessors = createFileAccessors();
    const messages = prepareAiProviderMessages([{
        role: 'user',
        content: '分析附件',
        attachments: [{ id: accessors.imageId }, { id: accessors.textId }],
    }], {
        config: resolveAiProviderConfig({ DEEPSEEK_API_KEY: 'key' }),
        dbAccessors: { db: accessors.db },
    });

    assert.equal(typeof messages[0].content, 'string');
    assert.match(messages[0].content, /本地 OCR 结果/);
    assert.match(messages[0].content, /Voltage: 220V/);
    assert.match(messages[0].content, /OCR 技术参数候选/);
    assert.match(messages[0].content, /置信度 92%/);
    assert.match(messages[0].content, /不支持直接识图/);
    assert.match(messages[0].content, /扬程 38m/);
    accessors.db.close();
});

test('V9.1 AI 附件：Kimi 图片按 OpenAI 多模态格式传递', () => {
    const accessors = createFileAccessors();
    const messages = prepareAiProviderMessages([{
        role: 'user',
        content: '识别这张图片',
        attachments: [{ id: accessors.imageId }],
    }], {
        config: resolveAiProviderConfig({
            AI_PROVIDER: 'kimi',
            KIMI_API_KEY: 'key',
            KIMI_MODEL: 'kimi-k2.6',
        }),
        dbAccessors: { db: accessors.db },
    });

    assert.equal(Array.isArray(messages[0].content), true);
    assert.equal(messages[0].content[1].type, 'image_url');
    assert.match(messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
    assert.match(messages[0].content[0].text, /原图已传入当前多模态模型/);
    assert.doesNotMatch(messages[0].content[0].text, /Voltage: 220V/);
    assert.doesNotMatch(messages[0].content[0].text, /OCR 技术参数候选/);
    accessors.db.close();
});

test('AI K3 文件路由：上传抽取 PDF、注入不可信内容并删除远端临时文件', async () => {
    const accessors = createFileAccessors();
    const calls = [];
    try {
        const response = await fetchAiProvider([{
            role: 'user',
            content: '总结报告',
            attachments: [{ id: accessors.pdfId }],
        }], {
            env: {
                AI_PROVIDER: 'auto',
                DEEPSEEK_API_KEY: 'deepseek-key',
                KIMI_API_KEY: 'kimi-key',
                KIMI_BASE_URL: 'https://api.kimi-files.test/v1',
                KIMI_MODEL: 'kimi-k3',
                KIMI_REASONING_EFFORT: 'low',
            },
            dbAccessors: { db: accessors.db },
            retryDelayMs: 0,
            fetchImpl: async (url, init = {}) => {
                calls.push({ url, method: init.method || 'GET', body: init.body });
                if (url.endsWith('/files') && init.method === 'POST') {
                    assert.equal(init.body instanceof FormData, true);
                    return new Response(JSON.stringify({ id: 'remote-pdf-1' }), { status: 200 });
                }
                if (url.endsWith('/files/remote-pdf-1/content')) {
                    return new Response('Kimi 抽取：测试报告扬程 38m', { status: 200 });
                }
                if (url.endsWith('/files/remote-pdf-1') && init.method === 'DELETE') {
                    return new Response('', { status: 204 });
                }
                if (url.endsWith('/chat/completions')) {
                    const body = JSON.parse(init.body);
                    assert.equal(body.model, 'kimi-k3');
                    assert.equal(body.reasoning_effort, 'low');
                    assert.match(body.messages[0].content, /Kimi 抽取：测试报告扬程 38m/);
                    assert.match(body.messages[0].content, /不可信业务数据/);
                    return new Response(JSON.stringify({ choices: [] }), { status: 200 });
                }
                return new Response('unexpected', { status: 500 });
            },
        });
        assert.equal(response.ok, true);
        assert.deepEqual(calls.map(call => `${call.method} ${new URL(call.url).pathname}`), [
            'POST /v1/files',
            'GET /v1/files/remote-pdf-1/content',
            'DELETE /v1/files/remote-pdf-1',
            'POST /v1/chat/completions',
        ]);
    } finally {
        accessors.db.close();
    }
});

test('AI provider：网络 fetch failed 重试后返回可诊断错误码', async () => {
    let attempts = 0;
    await assert.rejects(
        () => fetchAiProvider([{ role: 'user', content: '你好' }], {
            env: {
                AI_PROVIDER: 'deepseek',
                DEEPSEEK_API_KEY: 'deepseek-key',
                DEEPSEEK_BASE_URL: 'https://api.deepseek-network.test',
            },
            retryDelayMs: 0,
            fetchImpl: async () => {
                attempts += 1;
                const cause = Object.assign(new Error('socket reset'), { code: 'ECONNRESET' });
                throw new TypeError('fetch failed', { cause });
            },
        }),
        error => error.code === 'AI_PROVIDER_NETWORK_ERROR'
            && /ECONNRESET/.test(error.message)
    );
    assert.equal(attempts, 3);
});

test('V2 意图规划附件：只传文件元数据，不重复传正文、OCR 或图片二进制', () => {
    const accessors = createFileAccessors();
    const messages = prepareAiProviderMessages([{
        role: 'user',
        content: '分析附件',
        attachments: [{ id: accessors.imageId }, { id: accessors.textId }],
    }], {
        attachmentMode: 'metadata',
        config: resolveAiProviderConfig({ DEEPSEEK_API_KEY: 'key' }),
        dbAccessors: { db: accessors.db },
    });
    assert.equal(typeof messages[0].content, 'string');
    assert.match(messages[0].content, /规划阶段只读取文件元数据/);
    assert.doesNotMatch(messages[0].content, /Voltage: 220V/);
    assert.doesNotMatch(messages[0].content, /扬程 38m/);
    assert.doesNotMatch(messages[0].content, /base64/);
    accessors.db.close();
});

test('V2 意图规划附件：自动路由保持 DeepSeek，不提前调用 Kimi 文件能力', async () => {
    const accessors = createFileAccessors();
    let requestedUrl = '';
    try {
        const response = await fetchAiProvider([{
            role: 'user',
            content: '规划如何分析附件',
            attachments: [{ id: accessors.imageId }],
        }], {
            attachmentMode: 'metadata',
            env: {
                AI_PROVIDER: 'auto',
                DEEPSEEK_API_KEY: 'deepseek-key',
                DEEPSEEK_BASE_URL: 'https://api.deepseek-planner.test',
                KIMI_API_KEY: 'kimi-key',
                KIMI_BASE_URL: 'https://api.kimi-planner.test/v1',
                KIMI_MODEL: 'kimi-k3',
            },
            dbAccessors: { db: accessors.db },
            fetchImpl: async (url) => {
                requestedUrl = url;
                return new Response(JSON.stringify({ choices: [] }), { status: 200 });
            },
        });
        assert.equal(response.ok, true);
        assert.match(requestedUrl, /deepseek-planner/);
        assert.doesNotMatch(requestedUrl, /kimi-planner/);
    } finally {
        accessors.db.close();
    }
});

test('V9.2 AI 附件：PDF 解析文字按页码进入模型上下文', () => {
    const accessors = createFileAccessors();
    const messages = prepareAiProviderMessages([{
        role: 'user',
        content: '分析测试报告',
        attachments: [{ id: accessors.pdfId }],
    }], {
        config: resolveAiProviderConfig({ DEEPSEEK_API_KEY: 'key' }),
        dbAccessors: { db: accessors.db },
    });

    assert.equal(typeof messages[0].content, 'string');
    assert.match(messages[0].content, /按页码提取的 PDF 文字层内容/);
    assert.match(messages[0].content, /【第 1 页】/);
    assert.match(messages[0].content, /流量 10 \| 扬程 38/);
    accessors.db.close();
});

test('V9.2 AI 附件：扫描 PDF 没有文字层时不推断内容', () => {
    const accessors = createFileAccessors();
    const messages = prepareAiProviderMessages([{
        role: 'user',
        content: '读取图纸',
        attachments: [{ id: accessors.scannedPdfId }],
    }], {
        config: resolveAiProviderConfig({ DEEPSEEK_API_KEY: 'key' }),
        dbAccessors: { db: accessors.db },
    });

    assert.match(messages[0].content, /需要 OCR/);
    assert.match(messages[0].content, /不能推断扫描图片中的内容/);
    accessors.db.close();
});

test('V9.3 AI 附件：表格内容带文件ID和单元格定位进入模型上下文', () => {
    const accessors = createFileAccessors();
    const messages = prepareAiProviderMessages([{
        role: 'user',
        content: '分析这份报价',
        attachments: [{ id: accessors.spreadsheetId }],
    }], {
        config: resolveAiProviderConfig({ DEEPSEEK_API_KEY: 'key' }),
        dbAccessors: { db: accessors.db },
    });

    assert.match(messages[0].content, new RegExp(`统一文件ID ${accessors.spreadsheetId}`));
    assert.match(messages[0].content, /inspect_quotation_file/);
    assert.match(messages[0].content, /【工作表：报价】/);
    assert.match(messages[0].content, /\[第 2 行\] A: V750 \| B: 30/);
    accessors.db.close();
});
