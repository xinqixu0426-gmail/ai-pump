const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    CORE_AI_RELEASE_CASE_KEYS,
    assertCoreReleaseGateConfigured,
    buildReleaseGateReport,
    evaluationClientTimeoutMs,
    main,
    parseCliOptions,
    resolveEvaluationAuthentication,
    streamQuestionWithRetry,
    writeReleaseGateReport,
} = require('../scripts/run-knowledge-evaluation.cjs');

function coreSystemCases(count = 8, overrides = {}) {
    return CORE_AI_RELEASE_CASE_KEYS.slice(0, count).map((caseKey, index) => ({
        id: index + 1,
        caseKey,
        reviewStatus: 'approved',
        enabled: true,
        releaseGateEnabled: true,
        sourceType: 'system',
        ...overrides,
    }));
}

test('AI 发布门禁：release 固定使用内部身份且不会回退网页登录', () => {
    assert.deepEqual(resolveEvaluationAuthentication('release', {
        ACCESS_PASSWORD: 'password',
        INTERNAL_SECRET: 'internal-secret',
    }), {
        type: 'internal',
        secret: 'internal-secret',
    });
    assert.throws(
        () => resolveEvaluationAuthentication('release', { ACCESS_PASSWORD: 'password' }),
        /缺少 INTERNAL_SECRET/
    );
    assert.throws(
        () => resolveEvaluationAuthentication(
            'manual',
            { INTERNAL_SECRET: 'internal-secret' },
            { caseKey: 'part-current-price' }
        ),
        /需要 ACCESS_PASSWORD/
    );
    assert.equal(resolveEvaluationAuthentication('manual', {
        ACCESS_PASSWORD: 'password',
        INTERNAL_SECRET: 'internal-secret',
    }).type, 'login');
    assert.throws(
        () => resolveEvaluationAuthentication('manual', {
            INTERNAL_SECRET: 'internal-secret',
        }),
        /需要 ACCESS_PASSWORD/
    );
});

test('AI 单用例诊断：runner 只向服务端请求一个 caseKey 且报告不是 release gate', async () => {
    const requests = [];
    const report = await main({
        scope: 'manual',
        caseKey: 'part-current-price',
    }, {
        authenticate: async (scope, options) => {
            assert.equal(scope, 'manual');
            assert.equal(options.caseKey, 'part-current-price');
        },
        requestJson: async (method, requestPath, body) => {
            requests.push({ method, requestPath, body });
            if (requestPath === '/api/health') return { ready: true };
            if (requestPath === '/api/ai/evaluations/overview') {
                return { caseStats: { enabled: 8 } };
            }
            if (requestPath === '/api/ai/evaluations/runs') {
                return {
                    run: { id: 41, updatedAt: '2026-09-01T00:00:00.000Z' },
                    cases: [{
                        id: 7,
                        caseKey: 'part-current-price',
                        title: '零件当前价格',
                        question: '查询当前价格',
                    }],
                };
            }
            if (requestPath.endsWith('/results')) {
                return { status: 'passed', checks: [], errorText: '' };
            }
            if (requestPath.endsWith('/complete')) {
                return {
                    id: 41,
                    status: 'completed',
                    totalCount: 1,
                    passedCount: 1,
                    failedCount: 0,
                    reviewCount: 0,
                };
            }
            throw new Error(`unexpected request: ${method} ${requestPath}`);
        },
        streamQuestionWithRetry: async () => ({
            answerText: '当前价格已查询。',
            toolResults: [],
            attempts: 1,
        }),
    });

    assert.deepEqual(
        requests.find(item => item.requestPath === '/api/ai/evaluations/runs').body,
        { scope: 'manual', caseKey: 'part-current-price' }
    );
    assert.equal(report.mode, 'diagnostic');
    assert.equal(report.caseKey, 'part-current-price');
    assert.equal(report.releaseGate, false);
    assert.deepEqual(report.totals, { total: 1, passed: 1, failed: 0, review: 0 });
});

test('AI 发布门禁：8 条核心系统检查缺失或停用时禁止跳过', () => {
    assert.equal(assertCoreReleaseGateConfigured({ systemCases: coreSystemCases() }).length, 8);
    assert.throws(
        () => assertCoreReleaseGateConfigured({ systemCases: coreSystemCases(7) }),
        /配置不完整/
    );
    const disabled = coreSystemCases();
    disabled[0] = { ...disabled[0], enabled: false };
    assert.throws(
        () => assertCoreReleaseGateConfigured({ systemCases: disabled }),
        /不可执行 part-current-price/
    );
    const replacement = coreSystemCases();
    replacement[0] = { ...replacement[0], caseKey: 'replacement-system-case' };
    assert.throws(
        () => assertCoreReleaseGateConfigured({ systemCases: replacement }),
        /缺少 part-current-price/
    );
});

test('AI 发布门禁：客户端时限跟随服务端总时限并预留收尾时间', () => {
    assert.equal(evaluationClientTimeoutMs({}), 195000);
    assert.equal(evaluationClientTimeoutMs({ AI_CHAT_TIMEOUT_MS: '240000' }), 255000);
});

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
    assert.equal(report.mode, 'manual');
    assert.equal(report.releaseGate, false);
    assert.equal(report.gitCommit, 'abc123');
    assert.deepEqual(report.totals, { total: 2, passed: 2, failed: 0, review: 0 });
    assert.deepEqual(report.cases[0].failedChecks, []);
});

test('AI 手动检查：没有启用知识回归时可生成兼容跳过报告', () => {
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
            caseKey: '',
        });
        assert.deepEqual(parseCliOptions(['--scope=release']), {
            reportPath: '',
            scope: 'release',
            caseKey: '',
        });
        assert.deepEqual(parseCliOptions(['--case-key', 'part-current-price']), {
            reportPath: '',
            scope: 'manual',
            caseKey: 'part-current-price',
        });
        assert.deepEqual(parseCliOptions(['--case-key=part-current-price']), {
            reportPath: '',
            scope: 'manual',
            caseKey: 'part-current-price',
        });
        assert.throws(() => parseCliOptions(['--scope=unknown']), /manual 或 release/);
        assert.throws(() => parseCliOptions(['--case-key']), /必须提供/);
        assert.throws(() => parseCliOptions(['--case-key=']), /必须提供/);
        assert.throws(
            () => parseCliOptions([`--case-key=${'x'.repeat(161)}`]),
            /不能超过 160/
        );
        assert.throws(
            () => parseCliOptions(['--scope=release', '--case-key=part-current-price']),
            /必须运行完整用例集合/
        );
        const diagnosticReport = buildReleaseGateReport({
            scope: 'manual',
            caseKey: 'part-current-price',
            run: {
                id: 11,
                status: 'completed',
                totalCount: 1,
                passedCount: 1,
                failedCount: 0,
                reviewCount: 0,
            },
        });
        assert.equal(diagnosticReport.mode, 'diagnostic');
        assert.equal(diagnosticReport.caseKey, 'part-current-price');
        assert.equal(diagnosticReport.releaseGate, false);
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
