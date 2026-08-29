const test = require('node:test');
const assert = require('node:assert/strict');
const {
    RotorNaturalLanguageError,
    createRotorNaturalLanguageService,
    parseModelReply,
} = require('../api/services/rotorNaturalLanguage.cjs');

function modelResponse(value) {
    return {
        choices: [{
            message: {
                content: typeof value === 'string'
                    ? value
                    : JSON.stringify(value),
            },
        }],
    };
}

function createService(reply, previews = []) {
    return createRotorNaturalLanguageService({
        apiKey: 'test-key',
        callModel: async () => modelResponse(reply),
        buildDrawPreview: (input, actorKey) => {
            previews.push({ input, actorKey });
            return {
                preview: true,
                previewHash: 'rotor-preview-hash',
                confirmationToken: 'rotor-confirmation-token',
            };
        },
    });
}

test('转子自然语言 service 容忍代码块 JSON 并拒绝无 JSON 回复', () => {
    assert.deepEqual(
        parseModelReply(modelResponse('结果如下：```json\n{"piece_count":160}\n```')),
        { piece_count: 160 }
    );
    assert.throws(
        () => parseModelReply(modelResponse('没有结构化结果')),
        error => (
            error instanceof RotorNaturalLanguageError
            && error.message === '无法解析 AI 返回结果'
        )
    );
});

test('转子自然语言 service 在参数不足时只返回整理结果', async () => {
    const previews = [];
    const service = createService({ reply: '请补充参数' }, previews);
    const result = await service.preview(
        { message: '帮我出图' },
        'user:1'
    );

    assert.equal(result.status, 'need_params');
    assert.equal(result.message, '请补充参数');
    assert.equal(previews.length, 0);
});

test('转子自然语言 service 固化正则纠偏、基础参数合并和正式预览边界', async () => {
    const previews = [];
    const service = createService({
        upper_bearing: '202',
        piece_count: 160,
        rotor_dia: 30,
        stack_offset: null,
        bearing_span: null,
    }, previews);
    const result = await service.preview({
        message: '定位30，开档150，其他不变',
        force: true,
        baseParams: {
            lower_bearing: '203',
            bearing_span: 140,
            thread_length: 20,
        },
        supplements: {
            bearing_span: 150,
        },
        drawingName: 'V800/转子',
        drawingText: '第一行\r\n第二行',
    }, 'user:rotor');

    assert.equal(result.status, 'confirmation_required');
    assert.equal(result.previewHash, 'rotor-preview-hash');
    assert.equal(result.extracted.rotor_dia, null);
    assert.equal(result.extracted.stack_offset, 30);
    assert.equal(result.extracted.lower_bearing, '203');
    assert.equal(result.extracted.bearing_span, 140);
    assert.equal(previews.length, 1);
    assert.equal(previews[0].actorKey, 'user:rotor');
    assert.equal(previews[0].input.bearing_span, 150);
    assert.equal(previews[0].input.drawingName, 'V800_转子');
    assert.equal(previews[0].input.drawingText, '第一行\n第二行');
});

test('转子自然语言 service 在未强制时返回缺失长度和安全间隙告警', async () => {
    const previews = [];
    const service = createService({
        piece_count: 160,
        bearing_span: 140,
        stack_offset: 30,
    }, previews);
    const result = await service.preview(
        { message: '片数160，开档140，定位30' },
        'user:1'
    );

    assert.equal(result.status, 'warning');
    assert.deepEqual(
        result.warnings.map(warning => warning.code),
        ['rotor_length_parameters_incomplete', 'rotor_stator_clearance_low']
    );
    assert.ok(result.missing_length);
    assert.equal(result.stator_clearance.clearance, 30);
    assert.equal(previews.length, 0);
});

test('转子自然语言 service 统一输入和参数错误状态码', async () => {
    const withoutKey = createRotorNaturalLanguageService({
        apiKey: '',
        callModel: async () => modelResponse({}),
        buildDrawPreview: () => ({}),
    });
    await assert.rejects(
        () => withoutKey.preview({ message: '出图' }, 'user:1'),
        error => (
            error instanceof RotorNaturalLanguageError
            && error.statusCode === 500
            && error.message === '未配置 DEEPSEEK_API_KEY'
        )
    );

    const invalidBearing = createService({
        upper_bearing: '9999',
    });
    await assert.rejects(
        () => invalidBearing.preview(
            { message: '上轴承9999' },
            'user:1'
        ),
        error => (
            error instanceof RotorNaturalLanguageError
            && error.statusCode === 400
            && /未知的上轴承型号/.test(error.message)
        )
    );
});
