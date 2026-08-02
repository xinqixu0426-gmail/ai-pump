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

test('AI 智能路由：普通对话和解析文件走 DeepSeek，图片原图走 Kimi', () => {
    const accessors = createFileAccessors();
    const env = {
        AI_PROVIDER: 'auto',
        DEEPSEEK_API_KEY: 'deepseek-key',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
        KIMI_API_KEY: 'kimi-key',
        KIMI_MODEL: 'kimi-k2.7-code',
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
        assert.equal(capabilities.supportsImages, true);
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
        KIMI_MODEL: 'kimi-k2.7-code',
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
                if (requests.length === 1) return new Response('Kimi unavailable', { status: 503 });
                return new Response(JSON.stringify({ choices: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            },
            onProvider: info => providers.push(info),
        });

        assert.equal(response.ok, true);
        assert.equal(requests.length, 2);
        assert.match(requests[0].url, /api\.kimi\.test/);
        assert.equal(requests[0].body.model, 'kimi-k2.7-code');
        assert.equal(Array.isArray(requests[0].body.messages[0].content), true);
        assert.match(requests[1].url, /api\.deepseek\.test/);
        assert.equal(typeof requests[1].body.messages[0].content, 'string');
        assert.match(requests[1].body.messages[0].content, /本地 OCR 结果/);
        assert.equal(providers.at(-1).provider, 'deepseek');
        assert.equal(providers.at(-1).fallback, true);
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
    accessors.db.close();
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
