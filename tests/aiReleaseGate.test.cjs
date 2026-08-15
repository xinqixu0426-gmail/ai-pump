const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    buildReleaseGateReport,
    parseCliOptions,
    streamQuestionWithRetry,
    writeReleaseGateReport,
} = require('../scripts/run-knowledge-evaluation.cjs');

test('AI 发布门禁：全部通过时生成可验收报告', () => {
    const report = buildReleaseGateReport({
        generatedAt: '2026-08-02T10:00:00.000Z',
        health: { runtime: { gitCommit: 'abc123' } },
        run: {
            id: 9,
            status: 'completed',
            totalCount: 2,
            passedCount: 2,
            failedCount: 0,
            reviewCount: 0,
        },
        cases: [
            { caseId: 1, title: '术语检查', status: 'passed', checks: [{ passed: true }] },
        ],
    });

    assert.equal(report.status, 'passed');
    assert.equal(report.blocked, false);
    assert.equal(report.gitCommit, 'abc123');
    assert.deepEqual(report.totals, { total: 2, passed: 2, failed: 0, review: 0 });
    assert.deepEqual(report.cases[0].failedChecks, []);
});

test('AI 发布门禁：没有启用知识回归时跳过且不阻止发布', () => {
    const report = buildReleaseGateReport({
        generatedAt: '2026-08-08T10:00:00.000Z',
        health: { runtime: { gitCommit: 'def456' } },
        skipped: true,
    });

    assert.equal(report.status, 'skipped');
    assert.equal(report.blocked, false);
    assert.equal(report.gitCommit, 'def456');
    assert.deepEqual(report.totals, { total: 0, passed: 0, failed: 0, review: 0 });
    assert.deepEqual(report.cases, []);
});

test('AI 发布门禁：失败和待确认都会阻止验收且只保存失败依据', () => {
    const report = buildReleaseGateReport({
        run: {
            id: 10,
            status: 'completed',
            totalCount: 2,
            passedCount: 0,
            failedCount: 1,
            reviewCount: 1,
        },
        cases: [{
            caseId: 2,
            title: '文件类型检查',
            status: 'failed',
            checks: [
                { label: '包含性能测试报告', passed: false, detail: '回答缺少正确分类' },
                { label: '调用知识工具', passed: true, detail: '已调用' },
            ],
            errorText: '',
        }],
    });

    assert.equal(report.status, 'blocked');
    assert.equal(report.blocked, true);
    assert.equal(report.cases[0].failedChecks.length, 1);
    assert.equal(report.cases[0].failedChecks[0].detail, '回答缺少正确分类');
    assert.equal(Object.prototype.hasOwnProperty.call(report.cases[0], 'answerText'), false);
});

test('AI 发布门禁：流式连接瞬时中断后自动重试', async () => {
    let calls = 0;
    const result = await streamQuestionWithRetry('测试问题', {
        maxAttempts: 3,
        wait: async () => {},
        executor: async () => {
            calls += 1;
            if (calls < 3) throw new Error('terminated');
            return { answerText: '第三次成功', toolResults: [] };
        },
    });

    assert.equal(calls, 3);
    assert.equal(result.attempts, 3);
    assert.equal(result.answerText, '第三次成功');
});

test('AI 发布门禁：命令参数和 JSON 报告路径可无人值守使用', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-ai-gate-'));
    const reportPath = path.join(directory, 'gate.json');
    try {
        assert.deepEqual(parseCliOptions([`--report=${reportPath}`]), {
            reportPath,
            scope: 'manual',
        });
        assert.deepEqual(parseCliOptions(['--scope=release']), {
            reportPath: '',
            scope: 'release',
        });
        assert.throws(() => parseCliOptions(['--scope=unknown']), /manual 或 release/);
        const absolutePath = writeReleaseGateReport(reportPath, buildReleaseGateReport({
            error: '模型服务不可用',
        }));
        const saved = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
        assert.equal(saved.status, 'error');
        assert.equal(saved.blocked, true);
        assert.equal(saved.error, '模型服务不可用');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
