const test = require('node:test');
const assert = require('node:assert/strict');
const {
    limitText,
    classifySiriResult,
    buildSiriSpeech,
} = require('../api/routes/ai/siriResponse.cjs');

test('Siri 契约：朗读文本保持简短', () => {
    const text = '这是一个很长很长的 Siri 回复，里面包含大量业务细节，但 Siri 只应该朗读最关键的结论，详细数据交给结果页展示。';
    const short = limitText(text, 24);
    assert.equal(short.length, 24);
    assert.match(short, /…$/);
});

test('Siri 契约：写操作返回待确认状态', () => {
    const classified = classifySiriResult([
        {
            name: 'update_part',
            result: {
                success: true,
                requiresConfirmation: true,
                confirmation: { toolName: 'update_part', title: '修改零件', args: { model: 'A', price: 2 } },
            },
        },
    ]);

    assert.equal(classified.status, 'confirmation_required');
    assert.equal(classified.pending.name, 'update_part');
    assert.equal(buildSiriSpeech({ status: classified.status, pending: classified.pending }), '修改零件需要确认。');
});

test('Siri 契约：后台任务返回 processing 状态', () => {
    const classified = classifySiriResult([
        { name: 'generate_rotor_drawing', result: { success: true, jobId: 'job-1', statusUrl: '/api/rotor/status/job-1' } },
    ]);

    assert.equal(classified.status, 'processing');
    assert.deepEqual(classified.task, {
        id: 'job-1',
        type: 'generate_rotor_drawing',
        statusUrl: '/api/rotor/status/job-1',
        estimatedSeconds: 30,
    });
    assert.equal(buildSiriSpeech({ status: classified.status, task: classified.task }), '任务已提交，编号job-1。');
});

test('Siri 契约：工具失败返回 failed 状态', () => {
    const classified = classifySiriResult([
        { name: 'search_parts', result: { success: false, error: '没有找到零件' } },
    ]);

    assert.equal(classified.status, 'failed');
    assert.equal(buildSiriSpeech({ status: classified.status, failed: classified.failed }), '没有找到零件');
});
