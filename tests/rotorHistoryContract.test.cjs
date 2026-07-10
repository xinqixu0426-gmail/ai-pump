const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { rotorHistoryRow } = require('../api/services/rotorHistory.cjs');

const sourcePath = path.join(__dirname, '../src/utils/rotorHistory.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(`${source}\nmodule.exports = { normalizeRotorHistoryRow, normalizeRotorHistoryRows, parseRotorFcParams };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const { normalizeRotorHistoryRow, parseRotorFcParams } = moduleStub.exports;

test('转子历史后端契约输出 camelCase 并临时保留 legacy 字段', () => {
    const row = rotorHistoryRow({
        id: 7,
        job_id: 'job-1',
        drawing_name: 'V750',
        nl_input: 'draw',
        params_json: '{"a":1}',
        fc_params_json: '{"piece_count":160}',
        status: 'success',
        file_url: '/drawings/a.pdf',
        error: '',
        linked_pump_model: '配方:V750',
        created_at: '2026-07-08T00:00:00.000Z',
        updated_at: '2026-07-08T00:01:00.000Z',
    });

    assert.equal(row.jobId, 'job-1');
    assert.equal(row.drawingName, 'V750');
    assert.equal(row.fcParamsJson, '{"piece_count":160}');
    assert.equal(row.linkedPumpModel, '配方:V750');
    assert.equal(row.createdAt, '2026-07-08T00:00:00.000Z');
    assert.equal(row.job_id, 'job-1');
    assert.equal(row.drawing_name, 'V750');
});

test('转子历史前端兼容新旧字段并解析 FreeCAD 参数', () => {
    const normalized = normalizeRotorHistoryRow({
        id: 8,
        job_id: 'legacy-job',
        drawing_name: '旧图纸',
        fc_params_json: '{"rotor_dia":88}',
        file_url: '/drawings/old.pdf',
        linked_pump_model: '订单:旧型号',
        created_at: '2026-07-08T01:00:00.000Z',
    });

    assert.equal(normalized.jobId, 'legacy-job');
    assert.equal(normalized.drawingName, '旧图纸');
    assert.equal(normalized.fileUrl, '/drawings/old.pdf');
    assert.equal(normalized.linkedPumpModel, '订单:旧型号');
    assert.deepEqual(parseRotorFcParams(normalized), { rotor_dia: 88 });
    assert.deepEqual(parseRotorFcParams({ fcParamsJson: '{bad' }), {});
});
