const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rotorHistoryRow } = require('../api/services/rotorHistory.cjs');

const repoRoot = path.join(__dirname, '..');

function readUtf8(filePath) {
    return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

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

test('转子历史 Next 客户端仍兼容新旧字段', () => {
    const source = readUtf8('apps/web-next/lib/rotor.ts');

    assert.match(source, /export function normalizeRotorHistoryRow/);
    assert.match(source, /row\.jobId \?\? row\.job_id/);
    assert.match(source, /row\.drawingName \?\? row\.drawing_name/);
    assert.match(source, /row\.fcParamsJson \?\? row\.fc_params_json/);
    assert.match(source, /row\.fileUrl \?\? row\.file_url/);
    assert.match(source, /row\.linkedPumpModel \?\? row\.linked_pump_model/);
});
