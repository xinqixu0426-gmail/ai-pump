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
const { readAiProviderStream } = require('../api/services/aiProviderStream.cjs');
const {
    estimateAiMessagesTokens,
    estimateTextTokens,
    resolveAiTokenBudgets,
} = require('../api/services/aiTokenBudget.cjs');

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
    const csv = Buffer.from('型号,数量\nV1200,20', 'utf8');
    const csvId = Number(insert.run(
        '订单明细.csv', '.csv', 'spreadsheet', 'text/csv; charset=utf-8',
        csv.length, 'csv-hash', csv, now, now
    ).lastInsertRowid);
    db.prepare(`
        UPDATE factory_files
        SET parser_status = 'parsed',
            parsed_text = '【工作表：订单明细】\n[第 1 行] A: 型号 | B: 数量\n[第 2 行] A: V1200 | B: 20',
            parsed_json = '{"version":"spreadsheet-v1","sheetCount":1,"parsedSheetCount":1,"rowCount":2}',
            parsed_at = ?
        WHERE id = ?
    `).run(now, csvId);
    const word = Buffer.from('word-document');
    const wordId = Number(insert.run(
        '技术说明.docx', '.docx', 'text',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        word.length, 'word-hash', word, now, now
    ).lastInsertRowid);
    db.prepare(`
        UPDATE factory_files
        SET parser_status = 'parsed',
            parsed_text = '额定流量 12m³/h，额定扬程 40m',
            parsed_json = '{"version":"word-v1"}',
            parsed_at = ?
        WHERE id = ?
    `).run(now, wordId);
    const failedPdf = Buffer.from('%PDF-failed');
    const failedPdfId = Number(insert.run(
        '损坏报告.pdf', '.pdf', 'pdf', 'application/pdf', failedPdf.length,
        'failed-pdf-hash', failedPdf, now, now
    ).lastInsertRowid);
    db.prepare(`
        UPDATE factory_files
        SET parser_status = 'failed', parser_error = 'PDF 结构损坏', parsed_at = ?
        WHERE id = ?
    `).run(now, failedPdfId);
    return {
        csvId,
        db,
        failedPdfId,
        imageId,
        pdfId,
        scannedPdfId,
        spreadsheetId,
        textId,
        wordId,
    };
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
    assert.deepEqual(
        kimi.providerOptions.filter(option => option.available).map(option => option.value),
        ['default', 'local', 'kimi']
    );
});

test('AI 手动模型选择：可越过本地优先严格选择 DeepSeek', async () => {
    let captured;
    const response = await fetchAiProvider([{ role: 'user', content: '查询成本' }], {
        providerPreference: 'deepseek',
        env: {
            AI_PROVIDER: 'local-first',
            LOCAL_AI_BASE_URL: 'http://192.168.31.111:8080/v1',
            LOCAL_AI_MODEL: 'local-apex',
            DEEPSEEK_API_KEY: 'deepseek-key',
            DEEPSEEK_BASE_URL: 'https://deepseek.example/v1',
            DEEPSEEK_MODEL: 'deepseek-v4-flash',
        },
        fetchImpl: async (url, init) => {
            captured = { url, body: JSON.parse(init.body) };
            return new Response('{}', { status: 200 });
        },
    });

    assert.equal(response.ok, true);
    assert.equal(captured.url, 'https://deepseek.example/v1/chat/completions');
    assert.equal(captured.body.model, 'deepseek-v4-flash');
});

test('AI 本地优先：局域网模型无需密钥并保留工具与流式请求协议', async () => {
    let captured;
    const response = await fetchAiProvider([{ role: 'user', content: '查询零件' }], {
        env: {
            AI_PROVIDER: 'local-first',
            LOCAL_AI_BASE_URL: 'http://192.168.31.111:8080/v1',
            LOCAL_AI_MODEL: 'local-apex',
        },
        tools: [{
            type: 'function',
            function: {
                name: 'search_parts',
                description: '查询零件',
                parameters: { type: 'object', properties: {} },
            },
        }],
        toolChoice: 'auto',
        stream: true,
        fetchImpl: async (url, init) => {
            captured = { url, headers: init.headers, body: JSON.parse(init.body) };
            return new Response('data: [DONE]\n\n', { status: 200 });
        },
    });

    assert.equal(response.ok, true);
    assert.equal(captured.url, 'http://192.168.31.111:8080/v1/chat/completions');
    assert.equal(captured.headers.Authorization, undefined);
    assert.equal(captured.body.model, 'local-apex');
    assert.equal(captured.body.stream, true);
    assert.equal(captured.body.stream_options.include_usage, true);
    assert.equal(captured.body.tool_choice, 'auto');
    assert.equal(captured.body.tools[0].function.name, 'search_parts');
    assert.deepEqual(captured.body.chat_template_kwargs, { enable_thinking: false });
    assert.equal(captured.body.max_tokens, 384);
});

test('AI 本地优先：中途 system 指令并入首条 system 消息以兼容只允许开头 system 的模板', async () => {
    let captured;
    const response = await fetchAiProvider([
        { role: 'system', content: '系统协议' },
        { role: 'user', content: '查询零件' },
        { role: 'assistant', content: '正在查询' },
        { role: 'system', content: '纠正：金额缺少本轮证据' },
        { role: 'user', content: '继续' },
    ], {
        env: {
            AI_PROVIDER: 'local',
            LOCAL_AI_BASE_URL: 'http://192.168.31.111:8080/v1',
            LOCAL_AI_MODEL: 'local-apex',
        },
        fetchImpl: async (url, init) => {
            captured = { body: JSON.parse(init.body) };
            return new Response(JSON.stringify({ choices: [] }), { status: 200 });
        },
    });

    assert.equal(response.ok, true);
    assert.deepEqual(
        captured.body.messages.map(message => message.role),
        ['system', 'user', 'assistant', 'user']
    );
    assert.match(captured.body.messages[0].content, /系统协议/);
    assert.match(captured.body.messages[0].content, /金额缺少本轮证据/);
    assert.deepEqual(captured.body.chat_template_kwargs, { enable_thinking: false });
    assert.equal(captured.body.max_tokens, 512);
});

test('AI 云端提供商：中途 system 消息保持原位不被并入', async () => {
    let captured;
    const response = await fetchAiProvider([
        { role: 'system', content: '系统协议' },
        { role: 'user', content: '查询零件' },
        { role: 'assistant', content: '正在查询' },
        { role: 'system', content: '纠正：金额缺少本轮证据' },
        { role: 'user', content: '继续' },
    ], {
        env: {
            AI_PROVIDER: 'deepseek',
            DEEPSEEK_API_KEY: 'deepseek-key',
            DEEPSEEK_BASE_URL: 'https://api.deepseek.test',
        },
        fetchImpl: async (url, init) => {
            captured = { body: JSON.parse(init.body) };
            return new Response(JSON.stringify({ choices: [] }), { status: 200 });
        },
    });

    assert.equal(response.ok, true);
    assert.deepEqual(
        captured.body.messages.map(message => message.role),
        ['system', 'user', 'assistant', 'system', 'user']
    );
});

test('AI 本地优先：仅临时故障且已配置 DeepSeek 时降级', async () => {
    const requests = [];
    const providers = [];
    const response = await fetchAiProvider([{ role: 'user', content: '查询零件' }], {
        env: {
            AI_PROVIDER: 'local-first',
            LOCAL_AI_BASE_URL: 'http://192.168.31.111:8080/v1',
            LOCAL_AI_MODEL: 'local-apex',
            DEEPSEEK_API_KEY: 'deepseek-key',
            DEEPSEEK_BASE_URL: 'https://api.deepseek.test',
        },
        retryDelayMs: 0,
        fetchImpl: async (url) => {
            requests.push(url);
            if (url.includes('192.168.31.111')) {
                return new Response('temporary failure', { status: 503 });
            }
            return new Response(JSON.stringify({ choices: [] }), { status: 200 });
        },
        onProvider: info => providers.push(info),
    });

    assert.equal(response.ok, true);
    assert.equal(requests.filter(url => url.includes('192.168.31.111')).length, 3);
    assert.equal(requests.filter(url => url.includes('api.deepseek.test')).length, 1);
    assert.equal(providers.at(-1).provider, 'deepseek');
    assert.equal(providers.at(-1).fallback, true);
    assert.equal(providers.at(-1).fallbackFrom, 'local');
    assert.equal(providers.at(-1).routeReason, 'local_fallback');
});

test('AI 智能路由：普通对话和已本地解析文件走 DeepSeek，图片与扫描文件走 Kimi K3', () => {
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
        }], { env, dbAccessors: { db: accessors.db } }).provider, 'deepseek');

        assert.equal(resolveAiProviderRoute([{
            role: 'user',
            content: '阅读报告、说明和文本',
            attachments: [
                { id: accessors.pdfId },
                { id: accessors.wordId },
                { id: accessors.textId },
            ],
        }], { env, dbAccessors: { db: accessors.db } }).provider, 'deepseek');

        const scannedRoute = resolveAiProviderRoute([{
            role: 'user',
            content: '读取扫描报告',
            attachments: [{ id: accessors.scannedPdfId }],
        }], { env, dbAccessors: { db: accessors.db } });
        assert.equal(scannedRoute.provider, 'kimi');
        assert.equal(scannedRoute.routeReason, 'file');

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

test('AI 智能路由：关闭视觉只影响图片，扫描/解析失败文件仍使用 Kimi 文件抽取', () => {
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
        assert.equal(spreadsheetRoute.provider, 'deepseek');

        for (const fileId of [accessors.scannedPdfId, accessors.failedPdfId]) {
            const fileRoute = resolveAiProviderRoute([{
                role: 'user',
                content: '读取异常文件',
                attachments: [{ id: fileId }],
            }], { env, dbAccessors: { db: accessors.db } });
            assert.equal(fileRoute.provider, 'kimi');
            assert.equal(fileRoute.routeReason, 'file');
        }

        const imageRoute = resolveAiProviderRoute([{
            role: 'user',
            content: '识别图片',
            attachments: [{ id: accessors.imageId }],
        }], { env, dbAccessors: { db: accessors.db } });
        assert.equal(imageRoute.provider, 'deepseek');
        assert.equal(imageRoute.routeReason, 'vision_unavailable');

        const mixedRoute = resolveAiProviderRoute([{
            role: 'user',
            content: '读取图片和扫描报告',
            attachments: [
                { id: accessors.imageId },
                { id: accessors.scannedPdfId },
            ],
        }], { env, dbAccessors: { db: accessors.db } });
        assert.equal(mixedRoute.provider, 'kimi');
        assert.equal(mixedRoute.routeReason, 'file');

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

test('AI K3 文件路由：只为扫描 PDF 上传抽取、注入不可信内容并删除远端临时文件', async () => {
    const accessors = createFileAccessors();
    const calls = [];
    try {
        const response = await fetchAiProvider([{
            role: 'user',
            content: '总结报告',
            attachments: [{ id: accessors.scannedPdfId }],
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

test('AI 提供商输入：长历史、工具 schema 与附件正文合计不超过同一上下文窗口', () => {
    const accessors = createFileAccessors();
    const env = {
        AI_PROVIDER: 'deepseek',
        DEEPSEEK_API_KEY: 'key',
        AI_CONTEXT_WINDOW_TOKENS: '8192',
        AI_RESERVED_OUTPUT_TOKENS: '1024',
        AI_ATTACHMENT_CONTEXT_TOKENS: '4096',
    };
    const tools = [{ type: 'function', function: { name: 'query', description: '查询协议'.repeat(250) } }];
    const messages = prepareAiProviderMessages([
        { role: 'system', content: '系统规则'.repeat(850) },
        {
            role: 'user',
            content: '请查附件中的扬程',
            attachments: [{ id: accessors.textId }],
        },
    ], {
        config: resolveAiProviderConfig(env),
        dbAccessors: { db: accessors.db },
        env,
        tools,
        toolChoice: 'required',
    });
    const totalTokens = estimateAiMessagesTokens(messages)
        + estimateTextTokens(JSON.stringify(tools))
        + estimateTextTokens(JSON.stringify('required'));
    assert.equal(totalTokens <= resolveAiTokenBudgets(env).usableInputTokens, true);
    accessors.db.close();
});

test('AI provider：流式请求显式要求供应商返回 usage 尾帧', async () => {
    let body;
    const response = await fetchAiProvider([{ role: 'user', content: '测试' }], {
        stream: true,
        env: {
            AI_PROVIDER: 'deepseek',
            DEEPSEEK_API_KEY: 'key',
            DEEPSEEK_BASE_URL: 'https://deepseek-usage.test',
        },
        fetchImpl: async (_url, init) => {
            body = JSON.parse(init.body);
            return new Response('data: [DONE]\n', {
                headers: { 'Content-Type': 'text/event-stream' },
            });
        },
    });
    assert.equal(response.ok, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
});

test('AI K3 文件路由：文件上传临时错误可降级，认证错误不降级', async () => {
    const accessors = createFileAccessors();
    try {
        const transientUrls = [];
        const response = await fetchAiProvider([{
            role: 'user',
            content: '读取扫描报告',
            attachments: [{ id: accessors.failedPdfId }],
        }], {
            env: {
                AI_PROVIDER: 'auto',
                DEEPSEEK_API_KEY: 'deepseek-key',
                DEEPSEEK_BASE_URL: 'https://api.deepseek-file-fallback.test',
                KIMI_API_KEY: 'kimi-key',
                KIMI_BASE_URL: 'https://api.kimi-upload-fallback.test/v1',
            },
            dbAccessors: { db: accessors.db },
            retryDelayMs: 0,
            fetchImpl: async url => {
                transientUrls.push(url);
                if (url.includes('kimi-upload-fallback')) {
                    return new Response('temporary upload failure', { status: 503 });
                }
                return new Response(JSON.stringify({ choices: [] }), { status: 200 });
            },
        });
        assert.equal(response.ok, true);
        assert.equal(transientUrls.filter(url => url.endsWith('/v1/files')).length, 3);
        assert.equal(transientUrls.filter(url => url.includes('deepseek-file-fallback')).length, 1);

        const rejectedUrls = [];
        await assert.rejects(
            () => fetchAiProvider([{
                role: 'user',
                content: '读取扫描报告',
                attachments: [{ id: accessors.failedPdfId }],
            }], {
                env: {
                    AI_PROVIDER: 'auto',
                    DEEPSEEK_API_KEY: 'deepseek-key',
                    KIMI_API_KEY: 'kimi-key',
                    KIMI_BASE_URL: 'https://api.kimi-upload-auth.test/v1',
                },
                dbAccessors: { db: accessors.db },
                retryDelayMs: 0,
                fetchImpl: async url => {
                    rejectedUrls.push(url);
                    return new Response('unauthorized', { status: 401 });
                },
            }),
            error => error.statusCode === 401 && error.fallbackEligible === false
        );
        assert.equal(rejectedUrls.length, 1);
        assert.match(rejectedUrls[0], /kimi-upload-auth.*\/files$/);
    } finally {
        accessors.db.close();
    }
});

test('AI K3 文件路由：内容抽取临时失败先清理远端文件再降级 DeepSeek', async () => {
    const accessors = createFileAccessors();
    const calls = [];
    try {
        const response = await fetchAiProvider([{
            role: 'user',
            content: '读取扫描报告',
            attachments: [{ id: accessors.failedPdfId }],
        }], {
            env: {
                AI_PROVIDER: 'auto',
                DEEPSEEK_API_KEY: 'deepseek-key',
                DEEPSEEK_BASE_URL: 'https://api.deepseek-content-fallback.test',
                KIMI_API_KEY: 'kimi-key',
                KIMI_BASE_URL: 'https://api.kimi-content-fallback.test/v1',
            },
            dbAccessors: { db: accessors.db },
            retryDelayMs: 0,
            fetchImpl: async (url, init = {}) => {
                calls.push(`${init.method || 'GET'} ${url}`);
                if (url.endsWith('/files') && init.method === 'POST') {
                    return new Response(JSON.stringify({ id: 'remote-content-failure' }), { status: 200 });
                }
                if (url.endsWith('/files/remote-content-failure/content')) {
                    return new Response('rate limited', { status: 429 });
                }
                if (url.endsWith('/files/remote-content-failure') && init.method === 'DELETE') {
                    return new Response('', { status: 204 });
                }
                return new Response(JSON.stringify({ choices: [] }), { status: 200 });
            },
        });
        assert.equal(response.ok, true);
        assert.equal(calls.filter(call => call.includes('/content')).length, 3);
        assert.equal(calls.filter(call => call.startsWith('DELETE ')).length, 1);
        assert.equal(calls.filter(call => call.includes('deepseek-content-fallback')).length, 1);
    } finally {
        accessors.db.close();
    }
});

test('AI K3 文件路由：抽取期间取消仍清理远端文件且不回退', async () => {
    const accessors = createFileAccessors();
    const controller = new AbortController();
    const calls = [];
    let markContentStarted;
    const contentStarted = new Promise(resolve => { markContentStarted = resolve; });
    let markCleanupStarted;
    const cleanupStarted = new Promise(resolve => { markCleanupStarted = resolve; });
    let releaseCleanup;
    try {
        const pending = fetchAiProvider([{
            role: 'user',
            content: '读取扫描报告',
            attachments: [{ id: accessors.failedPdfId }],
        }], {
            env: {
                AI_PROVIDER: 'auto',
                DEEPSEEK_API_KEY: 'deepseek-key',
                DEEPSEEK_BASE_URL: 'https://api.deepseek-cancel-file.test',
                KIMI_API_KEY: 'kimi-key',
                KIMI_BASE_URL: 'https://api.kimi-cancel-file.test/v1',
            },
            dbAccessors: { db: accessors.db },
            signal: controller.signal,
            retryDelayMs: 0,
            fetchImpl: async (url, init = {}) => {
                calls.push(`${init.method || 'GET'} ${url}`);
                if (url.endsWith('/files') && init.method === 'POST') {
                    return new Response(JSON.stringify({ id: 'remote-cancelled' }), { status: 200 });
                }
                if (url.endsWith('/files/remote-cancelled/content')) {
                    markContentStarted();
                    return new Promise((_resolve, reject) => {
                        init.signal.addEventListener('abort', () => {
                            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                        }, { once: true });
                    });
                }
                if (url.endsWith('/files/remote-cancelled') && init.method === 'DELETE') {
                    markCleanupStarted();
                    return new Promise(resolve => {
                        releaseCleanup = () => resolve(new Response(null, { status: 204 }));
                    });
                }
                return new Response(JSON.stringify({ choices: [] }), { status: 200 });
            },
        });
        const outcome = pending.then(
            () => 'resolved',
            error => error.code
        );
        await contentStarted;
        controller.abort(Object.assign(new Error('用户取消'), {
            name: 'AbortError',
            code: 'AI_REQUEST_CANCELLED',
        }));
        await cleanupStarted;
        const observed = await Promise.race([
            outcome,
            new Promise(resolve => setTimeout(() => resolve('cleanup_blocked_cancel'), 50)),
        ]);
        releaseCleanup();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(observed, 'AI_REQUEST_CANCELLED');
        assert.equal(calls.filter(call => call.startsWith('DELETE ')).length, 1);
        assert.equal(calls.some(call => call.includes('deepseek-cancel-file')), false);
        assert.equal(calls.some(call => call.endsWith('/chat/completions')), false);
    } finally {
        accessors.db.close();
    }
});

test('AI K3 文件路由：清理已经开始后取消也立即返回且清理使用独立信号', async () => {
    const accessors = createFileAccessors();
    accessors.db.prepare('UPDATE factory_files SET file_sha256 = ? WHERE id = ?')
        .run('cleanup-race-hash', accessors.failedPdfId);
    const controller = new AbortController();
    let markCleanupStarted;
    const cleanupStarted = new Promise(resolve => { markCleanupStarted = resolve; });
    let releaseCleanup;
    try {
        const pending = fetchAiProvider([{
            role: 'user',
            content: '读取扫描报告',
            attachments: [{ id: accessors.failedPdfId }],
        }], {
            env: {
                AI_PROVIDER: 'auto',
                DEEPSEEK_API_KEY: 'deepseek-key',
                KIMI_API_KEY: 'kimi-key',
                KIMI_BASE_URL: 'https://api.kimi-cleanup-race.test/v1',
            },
            dbAccessors: { db: accessors.db },
            signal: controller.signal,
            retryDelayMs: 0,
            fetchImpl: async (url, init = {}) => {
                if (url.endsWith('/files') && init.method === 'POST') {
                    return new Response(JSON.stringify({ id: 'remote-cleanup-race' }), { status: 200 });
                }
                if (url.endsWith('/files/remote-cleanup-race/content')) {
                    return new Response('Kimi 已提取的扫描报告', { status: 200 });
                }
                if (url.endsWith('/files/remote-cleanup-race') && init.method === 'DELETE') {
                    assert.ok(init.signal);
                    assert.notEqual(init.signal, controller.signal);
                    assert.equal(init.signal.aborted, false);
                    markCleanupStarted();
                    return new Promise(resolve => {
                        releaseCleanup = () => resolve(new Response(null, { status: 204 }));
                    });
                }
                throw new Error(`取消后不应继续调用模型：${url}`);
            },
        });
        const outcome = pending.then(
            () => 'resolved',
            error => error.code
        );
        await cleanupStarted;
        controller.abort(Object.assign(new Error('用户取消'), {
            name: 'AbortError',
            code: 'AI_REQUEST_CANCELLED',
        }));
        const observed = await Promise.race([
            outcome,
            new Promise(resolve => setTimeout(() => resolve('cleanup_blocked_cancel'), 50)),
        ]);
        assert.equal(observed, 'AI_REQUEST_CANCELLED');
        releaseCleanup();
        await new Promise(resolve => setImmediate(resolve));
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

test('AI provider：单次请求超时会重试并返回稳定超时错误码', async () => {
    let attempts = 0;
    await assert.rejects(
        () => fetchAiProvider([{ role: 'user', content: '你好' }], {
            env: {
                AI_PROVIDER: 'deepseek',
                DEEPSEEK_API_KEY: 'deepseek-key',
                DEEPSEEK_BASE_URL: 'https://api.deepseek-timeout.test',
            },
            timeoutMs: 5,
            retryDelayMs: 0,
            fetchImpl: async (_url, init) => {
                attempts += 1;
                return new Promise((_resolve, reject) => {
                    init.signal.addEventListener('abort', () => {
                        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                    }, { once: true });
                });
            },
        }),
        error => error.code === 'AI_PROVIDER_TIMEOUT'
            && error.retryable === true
            && error.fallbackEligible === true
    );
    assert.equal(attempts, 3);
});

test('AI provider：收到响应头后正文停滞仍受超时保护并重试', async () => {
    let attempts = 0;
    await assert.rejects(
        () => fetchAiProvider([{ role: 'user', content: '你好' }], {
            env: {
                AI_PROVIDER: 'deepseek',
                DEEPSEEK_API_KEY: 'deepseek-key',
                DEEPSEEK_BASE_URL: 'https://api.deepseek-body-timeout.test',
            },
            timeoutMs: 5,
            retryDelayMs: 0,
            fetchImpl: async () => {
                attempts += 1;
                return new Response(new ReadableStream({ start() {} }), { status: 200 });
            },
        }),
        error => error.code === 'AI_PROVIDER_TIMEOUT'
    );
    assert.equal(attempts, 3);
});

test('AI provider：流式响应头后静默会由 provider 超时终止', async () => {
    const response = await fetchAiProvider([{ role: 'user', content: '你好' }], {
        stream: true,
        env: {
            AI_PROVIDER: 'deepseek',
            DEEPSEEK_API_KEY: 'deepseek-key',
            DEEPSEEK_BASE_URL: 'https://api.deepseek-stream-timeout.test',
        },
        timeoutMs: 5,
        retryDelayMs: 0,
        fetchImpl: async () => new Response(
            new ReadableStream({ start() {} }),
            { status: 200 }
        ),
    });
    await assert.rejects(
        () => readAiProviderStream(response),
        error => error.code === 'AI_PROVIDER_TIMEOUT'
    );
});

test('AI 智能路由：调用方取消后立即停止且不会错误回退 DeepSeek', async () => {
    const accessors = createFileAccessors();
    const controller = new AbortController();
    const requestedUrls = [];
    let markRequestStarted;
    const requestStarted = new Promise(resolve => { markRequestStarted = resolve; });
    try {
        const pending = fetchAiProvider([{
            role: 'user',
            content: '识别图片',
            attachments: [{ id: accessors.imageId }],
        }], {
            env: {
                AI_PROVIDER: 'auto',
                DEEPSEEK_API_KEY: 'deepseek-key',
                DEEPSEEK_BASE_URL: 'https://api.deepseek-cancel.test',
                KIMI_API_KEY: 'kimi-key',
                KIMI_BASE_URL: 'https://api.kimi-cancel.test/v1',
                KIMI_MODEL: 'kimi-k3',
            },
            dbAccessors: { db: accessors.db },
            signal: controller.signal,
            retryDelayMs: 0,
            fetchImpl: async (url, init) => {
                requestedUrls.push(url);
                markRequestStarted();
                return new Promise((_resolve, reject) => {
                    init.signal.addEventListener('abort', () => {
                        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                    }, { once: true });
                });
            },
        });
        await requestStarted;
        controller.abort(Object.assign(new Error('用户取消'), {
            name: 'AbortError',
            code: 'AI_REQUEST_CANCELLED',
        }));
        await assert.rejects(pending, error => error.code === 'AI_REQUEST_CANCELLED');
        assert.equal(requestedUrls.length, 1);
        assert.match(requestedUrls[0], /kimi-cancel/);
    } finally {
        accessors.db.close();
    }
});

test('AI 分级文件路由：已解析 PDF、Word 和表格只内联本地内容且不上传 Kimi', async () => {
    const accessors = createFileAccessors();
    const calls = [];
    try {
        const response = await fetchAiProvider([{
            role: 'user',
            content: '汇总本地已解析附件',
            attachments: [
                { id: accessors.pdfId },
                { id: accessors.wordId },
                { id: accessors.spreadsheetId },
                { id: accessors.csvId },
            ],
        }], {
            env: {
                AI_PROVIDER: 'auto',
                DEEPSEEK_API_KEY: 'deepseek-key',
                DEEPSEEK_BASE_URL: 'https://api.deepseek-local-files.test',
                KIMI_API_KEY: 'kimi-key',
                KIMI_BASE_URL: 'https://api.kimi-unused-files.test/v1',
            },
            dbAccessors: { db: accessors.db },
            fetchImpl: async (url, init = {}) => {
                calls.push(url);
                const body = JSON.parse(init.body);
                assert.equal(body.model, 'deepseek-v4-flash');
                assert.match(body.messages[0].content, /流量 10 \| 扬程 38/);
                assert.match(body.messages[0].content, /额定流量 12m³\/h/);
                assert.match(body.messages[0].content, /A: V750 \| B: 30/);
                assert.match(body.messages[0].content, /A: V1200 \| B: 20/);
                return new Response(JSON.stringify({ choices: [] }), { status: 200 });
            },
        });
        assert.equal(response.ok, true);
        assert.equal(calls.length, 1);
        assert.match(calls[0], /deepseek-local-files/);
        assert.doesNotMatch(calls[0], /\/files/);
    } finally {
        accessors.db.close();
    }
});

test('AI 分级文件路由：图片与已解析文档混合时传原图并内联正文但不上传文件', async () => {
    const accessors = createFileAccessors();
    const urls = [];
    try {
        await fetchAiProvider([{
            role: 'user',
            content: '结合图片与报告分析',
            attachments: [
                { id: accessors.imageId },
                { id: accessors.pdfId },
            ],
        }], {
            env: {
                AI_PROVIDER: 'auto',
                DEEPSEEK_API_KEY: 'deepseek-key',
                KIMI_API_KEY: 'kimi-key',
                KIMI_BASE_URL: 'https://api.kimi-image-local.test/v1',
                AI_VISION_ENABLED: 'true',
            },
            dbAccessors: { db: accessors.db },
            fetchImpl: async (url, init = {}) => {
                urls.push(url);
                const body = JSON.parse(init.body);
                assert.equal(Array.isArray(body.messages[0].content), true);
                assert.match(body.messages[0].content[0].text, /流量 10 \| 扬程 38/);
                assert.equal(body.messages[0].content[1].type, 'image_url');
                return new Response(JSON.stringify({ choices: [] }), { status: 200 });
            },
        });
        assert.equal(urls.length, 1);
        assert.match(urls[0], /chat\/completions$/);
        assert.doesNotMatch(urls[0], /\/files(?:\/|$)/);
    } finally {
        accessors.db.close();
    }
});

test('AI 固定 Provider：手动 Kimi/DeepSeek 不被 auto 路由改写', async () => {
    const accessors = createFileAccessors();
    try {
        const kimiUrls = [];
        await fetchAiProvider([{
            role: 'user',
            content: '用 Kimi 总结本地报告',
            attachments: [{ id: accessors.pdfId }],
        }], {
            env: {
                AI_PROVIDER: 'kimi',
                KIMI_API_KEY: 'kimi-key',
                KIMI_BASE_URL: 'https://api.kimi-fixed-local.test/v1',
            },
            dbAccessors: { db: accessors.db },
            fetchImpl: async (url, init = {}) => {
                kimiUrls.push(url);
                const body = JSON.parse(init.body);
                assert.equal(body.model, 'kimi-k3');
                assert.match(body.messages[0].content, /流量 10 \| 扬程 38/);
                return new Response(JSON.stringify({ choices: [] }), { status: 200 });
            },
        });
        assert.equal(kimiUrls.length, 1);
        assert.match(kimiUrls[0], /kimi-fixed-local.*chat\/completions/);

        const deepseekUrls = [];
        await fetchAiProvider([{
            role: 'user',
            content: '用 DeepSeek 读取扫描报告',
            attachments: [{ id: accessors.scannedPdfId }],
        }], {
            env: {
                AI_PROVIDER: 'deepseek',
                DEEPSEEK_API_KEY: 'deepseek-key',
                DEEPSEEK_BASE_URL: 'https://api.deepseek-fixed-scan.test',
            },
            dbAccessors: { db: accessors.db },
            fetchImpl: async (url, init = {}) => {
                deepseekUrls.push(url);
                const body = JSON.parse(init.body);
                assert.match(body.messages[0].content, /需要 OCR/);
                return new Response(JSON.stringify({ choices: [] }), { status: 200 });
            },
        });
        assert.equal(deepseekUrls.length, 1);
        assert.match(deepseekUrls[0], /deepseek-fixed-scan/);
    } finally {
        accessors.db.close();
    }
});

test('AI 分级文件路由：混合附件只上传无法本地解析的文件', async () => {
    const accessors = createFileAccessors();
    const uploadedNames = [];
    const calls = [];
    try {
        const response = await fetchAiProvider([{
            role: 'user',
            content: '对比两个报告',
            attachments: [
                { id: accessors.pdfId },
                { id: accessors.failedPdfId },
            ],
        }], {
            env: {
                AI_PROVIDER: 'auto',
                DEEPSEEK_API_KEY: 'deepseek-key',
                KIMI_API_KEY: 'kimi-key',
                KIMI_BASE_URL: 'https://api.kimi-mixed-files.test/v1',
                KIMI_MODEL: 'kimi-k3',
            },
            dbAccessors: { db: accessors.db },
            retryDelayMs: 0,
            fetchImpl: async (url, init = {}) => {
                calls.push(`${init.method || 'GET'} ${new URL(url).pathname}`);
                if (url.endsWith('/files') && init.method === 'POST') {
                    uploadedNames.push(init.body.get('file').name);
                    return new Response(JSON.stringify({ id: 'remote-failed-1' }), { status: 200 });
                }
                if (url.endsWith('/files/remote-failed-1/content')) {
                    return new Response('Kimi 恢复的损坏报告内容', { status: 200 });
                }
                if (url.endsWith('/files/remote-failed-1') && init.method === 'DELETE') {
                    return new Response(null, { status: 204 });
                }
                if (url.endsWith('/chat/completions')) {
                    const body = JSON.parse(init.body);
                    assert.match(body.messages[0].content, /流量 10 \| 扬程 38/);
                    assert.match(body.messages[0].content, /Kimi 恢复的损坏报告内容/);
                    return new Response(JSON.stringify({ choices: [] }), { status: 200 });
                }
                return new Response('unexpected', { status: 500 });
            },
        });
        assert.equal(response.ok, true);
        assert.deepEqual(uploadedNames, ['损坏报告.pdf']);
        assert.equal(calls.filter(call => call === 'POST /v1/files').length, 1);
        assert.equal(calls.filter(call => call === 'POST /v1/chat/completions').length, 1);
    } finally {
        accessors.db.close();
    }
});

test('AI 分级文件路由：Word 解析中或失败时不伪装为本地成功', () => {
    const accessors = createFileAccessors();
    const env = {
        AI_PROVIDER: 'auto',
        DEEPSEEK_API_KEY: 'deepseek-key',
        KIMI_API_KEY: 'kimi-key',
    };
    try {
        const update = accessors.db.prepare(`
            UPDATE factory_files
            SET parser_status = ?, parsed_text = '', parser_error = ?
            WHERE id = ?
        `);
        for (const [status, error] of [['processing', ''], ['failed', 'Word 解析失败']]) {
            update.run(status, error, accessors.wordId);
            const route = resolveAiProviderRoute([{
                role: 'user',
                content: '读取 Word',
                attachments: [{ id: accessors.wordId }],
            }], { env, dbAccessors: { db: accessors.db } });
            assert.equal(route.provider, 'kimi');
            assert.equal(route.routeReason, 'file');
        }
    } finally {
        accessors.db.close();
    }
});

test('AI 智能路由：认证和参数错误不回退，只有临时上游错误才回退', async () => {
    const accessors = createFileAccessors();
    try {
        for (const status of [400, 401, 403, 422]) {
            const urls = [];
            await assert.rejects(
                () => fetchAiProvider([{
                    role: 'user',
                    content: '识别图片',
                    attachments: [{ id: accessors.imageId }],
                }], {
                    env: {
                        AI_PROVIDER: 'auto',
                        DEEPSEEK_API_KEY: 'deepseek-key',
                        DEEPSEEK_BASE_URL: 'https://api.deepseek-classify.test',
                        KIMI_API_KEY: 'kimi-key',
                        KIMI_BASE_URL: 'https://api.kimi-classify.test/v1',
                    },
                    dbAccessors: { db: accessors.db },
                    retryDelayMs: 0,
                    fetchImpl: async url => {
                        urls.push(url);
                        return new Response('rejected', { status });
                    },
                }),
                error => error.statusCode === status && error.fallbackEligible === false
            );
            assert.equal(urls.every(url => url.includes('kimi-classify')), true);
        }
    } finally {
        accessors.db.close();
    }
});

test('AI 智能路由：408、429 和 5xx 重试后回退 DeepSeek', async () => {
    const accessors = createFileAccessors();
    try {
        for (const status of [408, 429, 500, 503]) {
            const urls = [];
            const response = await fetchAiProvider([{
                role: 'user',
                content: '识别图片',
                attachments: [{ id: accessors.imageId }],
            }], {
                env: {
                    AI_PROVIDER: 'auto',
                    DEEPSEEK_API_KEY: 'deepseek-key',
                    DEEPSEEK_BASE_URL: 'https://api.deepseek-transient.test',
                    KIMI_API_KEY: 'kimi-key',
                    KIMI_BASE_URL: 'https://api.kimi-transient.test/v1',
                },
                dbAccessors: { db: accessors.db },
                retryDelayMs: 0,
                fetchImpl: async url => {
                    urls.push(url);
                    if (url.includes('kimi-transient')) {
                        return new Response('temporary failure', { status });
                    }
                    return new Response(JSON.stringify({ choices: [] }), { status: 200 });
                },
            });
            assert.equal(response.ok, true);
            assert.equal(urls.filter(url => url.includes('kimi-transient')).length, 3);
            assert.equal(urls.filter(url => url.includes('deepseek-transient')).length, 1);
        }
    } finally {
        accessors.db.close();
    }
});

test('AI 固定提供商：临时上游错误只重试当前模型，不跨模型回退', async () => {
    const urls = [];
    await assert.rejects(
        () => fetchAiProvider([{ role: 'user', content: '你好' }], {
            env: {
                AI_PROVIDER: 'deepseek',
                DEEPSEEK_API_KEY: 'deepseek-key',
                DEEPSEEK_BASE_URL: 'https://api.deepseek-fixed.test',
                KIMI_API_KEY: 'kimi-key',
                KIMI_BASE_URL: 'https://api.kimi-unused.test/v1',
            },
            retryDelayMs: 0,
            fetchImpl: async url => {
                urls.push(url);
                return new Response('temporary failure', { status: 503 });
            },
        }),
        error => error.code === 'AI_PROVIDER_UPSTREAM_ERROR'
            && error.fallbackEligible === true
    );
    assert.equal(urls.length, 3);
    assert.equal(urls.every(url => url.includes('deepseek-fixed')), true);
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

test('AI 长附件：按当前问题选取旧 100KB 截断点之后的相关片段', () => {
    const accessors = createFileAccessors();
    const prefix = '普通技术说明。'.repeat(12000);
    const source = `${prefix}\n关键绕组数据：主绕组 168 匝，副绕组 212 匝。`;
    const blob = Buffer.from(source, 'utf8');
    const now = '2026-08-31T00:00:00.000Z';
    const fileId = Number(accessors.db.prepare(`
        INSERT INTO factory_files (
            original_name, extension, detected_type, mime_type, file_size,
            file_sha256, file_blob, parser_status, source_type, duplicate_count,
            metadata_json, created_at, updated_at
        ) VALUES (?, '.txt', 'text', 'text/plain; charset=utf-8', ?, ?, ?, 'parsed', 'direct_upload', 1, '{}', ?, ?)
    `).run('长说明.txt', blob.length, 'long-text-hash', blob, now, now).lastInsertRowid);
    const messages = prepareAiProviderMessages([{
        role: 'user',
        content: '主绕组是多少匝？',
        attachments: [{ id: fileId }],
    }], {
        config: resolveAiProviderConfig({ DEEPSEEK_API_KEY: 'key' }),
        dbAccessors: { db: accessors.db },
        env: { AI_ATTACHMENT_CONTEXT_TOKENS: '800' },
    });
    assert.match(messages[0].content, /主绕组 168 匝/);
    assert.match(messages[0].content, /字符 \d+-\d+/);
    assert.doesNotMatch(messages[0].content, new RegExp(prefix.slice(0, 5000).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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
