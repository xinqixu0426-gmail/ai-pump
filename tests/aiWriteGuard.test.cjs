const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildWriteToolCorrection,
    safeUnverifiedWriteReply,
    shouldRetryUnverifiedWriteReply,
    unverifiedWriteClaimType,
} = require('../api/services/aiWriteGuard.cjs');

const writeTools = new Set(['create_part', 'batch_create_parts']);
const writeRoute = {
    writeIntent: true,
    toolNames: ['search_parts', 'create_part', 'batch_create_parts'],
};

test('AI 写回执保护：拦截无工具回执的虚假成功声明', () => {
    const content = '已调用后端标准 API 执行录入操作，零件录入成功。';
    assert.equal(unverifiedWriteClaimType(content), 'success');
    assert.equal(shouldRetryUnverifiedWriteReply({
        content,
        toolRoute: writeRoute,
        writeTools,
    }), true);
    assert.match(buildWriteToolCorrection(writeRoute, writeTools), /batch_create_parts/);
    assert.match(safeUnverifiedWriteReply(), /没有写入业务数据/);
});

test('AI 写回执保护：拦截模型自行生成的文字确认卡片', () => {
    const content = '请核对以下确认卡片，确认无误后回复“确认录入”，我将提交后端标准 API。';
    assert.equal(unverifiedWriteClaimType(content), 'confirmation');
    assert.equal(shouldRetryUnverifiedWriteReply({
        content,
        toolRoute: writeRoute,
        writeTools,
    }), true);
});

test('AI 写回执保护：已有写工具时拦截错误的无权限或无接口结论', () => {
    for (const content of [
        '当前可用工具中没有“新增零件”的标准 API，因此无法写入。',
        '我无法直接写入数据库，因为当前会话未提供零件库写入接口。',
        '本会话只有查询工具，没有权限录入零件。',
    ]) {
        assert.equal(unverifiedWriteClaimType(content), 'denial');
        assert.equal(shouldRetryUnverifiedWriteReply({
            content,
            toolRoute: writeRoute,
            writeTools,
        }), true);
    }
});

test('AI 写回执保护：参数不足的正常追问和明确失败说明不误拦截', () => {
    for (const content of [
        '请提供零件型号和单价。',
        '本轮没有执行写入，因为还缺少供应商。',
        '当前查询到 3 个零件。',
    ]) {
        assert.equal(shouldRetryUnverifiedWriteReply({
            content,
            toolRoute: writeRoute,
            writeTools,
        }), false);
    }
});
