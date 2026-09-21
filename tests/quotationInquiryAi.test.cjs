const test = require('node:test');
const assert = require('node:assert/strict');
const {
    generateQuotationInquirySummary,
    normalizeFileIds,
} = require('../api/services/quotationInquiryAi.cjs');

function files() {
    return new Map([
        [1, { id: 1, originalName: '询价图片.png', detectedType: 'image' }],
        [2, { id: 2, originalName: '询价清单.xlsx', detectedType: 'spreadsheet' }],
    ]);
}

function kimiConfig() {
    return {
        provider: 'kimi',
        displayName: 'Kimi 开放平台',
        apiKey: 'test-key',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k3',
        supportsImages: true,
        supportsFileExtraction: true,
    };
}

test('报价询价助手：强制把原始附件交给 Kimi 且不经过通用 AI 规划', async () => {
    const catalog = files();
    let providerCall = null;
    const result = await generateQuotationInquirySummary({
        fileIds: [1, 2],
        customerName: '客户A',
    }, {
        env: { KIMI_API_KEY: 'test-key' },
        getFactoryFile: id => catalog.get(id) || null,
        resolveProviderConfig: provider => {
            assert.equal(provider, 'kimi');
            return kimiConfig();
        },
        fetchAiProvider: async (messages, options) => {
            providerCall = { messages, options };
            return new Response(JSON.stringify({
                choices: [{ message: { content: '## 产品\n- 型号：V750' } }],
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
    });

    assert.deepEqual(providerCall.messages[0].attachments, [{ id: 1 }, { id: 2 }]);
    assert.match(providerCall.messages[0].content, /直接阅读本轮上传/);
    assert.equal(providerCall.options.config.provider, 'kimi');
    assert.equal(providerCall.options.attachmentMode, 'content');
    assert.equal(providerCall.options.stream, false);
    assert.deepEqual(providerCall.options.tools, []);
    assert.equal(result.summaryText, '## 产品\n- 型号：V750');
    assert.equal(result.provider, 'kimi');
    assert.equal(result.sourceMode, 'original_attachments');
    assert.deepEqual(result.sourceFileIds, [1, 2]);
});

test('报价询价助手：Kimi 失败时明确失败而不回退 DeepSeek 或本地 OCR', async () => {
    const catalog = files();
    let calls = 0;
    await assert.rejects(
        () => generateQuotationInquirySummary({ fileIds: [1] }, {
            env: { KIMI_API_KEY: 'test-key' },
            getFactoryFile: id => catalog.get(id) || null,
            resolveProviderConfig: kimiConfig,
            fetchAiProvider: async () => {
                calls += 1;
                throw new Error('服务暂时不可用');
            },
        }),
        error => {
            assert.equal(error.statusCode, 502);
            assert.match(error.message, /Kimi 读取询价附件失败/);
            return true;
        }
    );
    assert.equal(calls, 1);
});

test('报价询价助手：附件数量、ID、存在性和 Kimi 配置必须有效', async () => {
    assert.throws(() => normalizeFileIds([]), /至少选择一个/);
    assert.throws(() => normalizeFileIds([1, 2, 3, 4, 5]), /最多选择 4 个/);
    assert.throws(() => normalizeFileIds([1, 1]), /不能重复/);
    assert.throws(() => normalizeFileIds(['bad']), /ID 无效/);

    await assert.rejects(
        () => generateQuotationInquirySummary({ fileIds: [99] }, {
            env: { KIMI_API_KEY: 'test-key' },
            getFactoryFile: () => null,
        }),
        /不存在/
    );
    await assert.rejects(
        () => generateQuotationInquirySummary({ fileIds: [1] }, {
            env: {},
            getFactoryFile: () => files().get(1),
            resolveProviderConfig: () => ({ ...kimiConfig(), apiKey: '' }),
        }),
        error => error.statusCode === 503 && /API Key/.test(error.message)
    );
});

test('报价询价助手：优先读取系统已保存的 Kimi 运行配置且识别失效密文', async () => {
    const file = files().get(2);
    let receivedEnv = null;
    const result = await generateQuotationInquirySummary({ fileIds: [2] }, {
        getFactoryFile: () => file,
        effectiveRuntimeValues: () => ({
            values: { kimiApiKey: 'stored-key', kimiModel: 'kimi-k3', aiVisionEnabled: true },
            secretStatus: { kimiApiKey: { configured: true, source: 'runtime', error: '' } },
        }),
        resolveProviderConfig: (_provider, env) => {
            receivedEnv = env;
            return kimiConfig();
        },
        fetchAiProvider: async () => new Response(JSON.stringify({
            choices: [{ message: { content: '已读取保存配置' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    assert.equal(receivedEnv.KIMI_API_KEY, 'stored-key');
    assert.equal(result.summaryText, '已读取保存配置');

    await assert.rejects(
        () => generateQuotationInquirySummary({ fileIds: [2] }, {
            getFactoryFile: () => file,
            effectiveRuntimeValues: () => ({
                values: {},
                secretStatus: { kimiApiKey: { configured: false, source: 'invalid', error: '密钥不匹配' } },
            }),
        }),
        error => error.code === 'kimi_api_key_invalid' && /无法解密/.test(error.message)
    );
});
