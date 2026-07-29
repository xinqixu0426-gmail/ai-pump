const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildEvaluationReport,
    expectedRank,
    matchesExpected,
    runKnowledgeRetrievalEvaluation,
} = require('../api/services/knowledgeRetrievalEvaluation.cjs');

function item(id, title) {
    return { id, title };
}

const cases = [
    {
        id: 'exact',
        title: '精确型号',
        category: 'exact',
        query: '12－220 冷轧',
        entryType: 'coil',
        expectedTitleIncludes: ['12-220', '冷轧'],
    },
    {
        id: 'semantic',
        title: '口语检索',
        category: 'semantic',
        query: '整根线加插头',
        entryType: 'business_rule',
        expectedTitleIncludes: ['电缆', '包装'],
    },
];

test('检索评测：标题匹配兼容全角符号且返回稳定名次', () => {
    const expected = cases[0];
    assert.equal(matchesExpected(item(1, '线圈：12-220 冷轧 国标眼'), expected), true);
    assert.equal(matchesExpected(item(2, '线圈：12-220 钢带 小眼'), expected), false);
    assert.equal(expectedRank([
        item(2, '线圈：12-220 钢带 小眼'),
        item(1, '线圈：12-220 冷轧 国标眼'),
    ], expected), 2);
});

test('检索评测：自动比较 FTS、向量和混合 Top1/Top3', async () => {
    const exact = item(1, '线圈：12-220 冷轧 国标眼');
    const cable = item(2, '业务规则：浮球、电缆和包装');
    const provider = {
        getStatus: () => ({ model: 'test/e5', dimensions: 3 }),
    };
    const report = await runKnowledgeRetrievalEvaluation({
        cases,
        provider,
        async executeCase(evaluationCase) {
            if (evaluationCase.id === 'exact') {
                return {
                    keyword: [exact],
                    vector: [exact],
                    hybrid: [exact],
                };
            }
            return {
                keyword: [],
                vector: [cable],
                hybrid: [cable],
            };
        },
    });

    assert.deepEqual(report.metrics.keyword, {
        top1Count: 1,
        top3Count: 1,
        total: 2,
        top1Percent: 50,
        top3Percent: 50,
    });
    assert.equal(report.metrics.hybrid.top1Percent, 100);
    assert.equal(report.metrics.hybrid.top3Percent, 100);
    assert.equal(report.acceptance.passed, true);
    assert.deepEqual(report.improvements, ['semantic']);
    assert.deepEqual(report.regressions, []);
});

test('检索评测：精确查询退步或执行异常都会阻止验收', () => {
    const caseResults = [
        {
            id: 'exact',
            category: 'exact',
            ranks: { keyword: 1, vector: 2, hybrid: 2 },
            error: '',
        },
        {
            id: 'semantic',
            category: 'semantic',
            ranks: { keyword: null, vector: null, hybrid: null },
            error: '模型不可用',
        },
    ];
    const report = buildEvaluationReport(cases, caseResults, {
        model: 'test/e5',
        dimensions: 3,
    });

    assert.equal(report.acceptance.passed, false);
    assert.equal(report.acceptance.noErrors, false);
    assert.equal(report.acceptance.exactTop1Passed, false);
    assert.deepEqual(report.regressions, ['exact']);
});
