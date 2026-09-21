const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    buildEvaluationReport,
    checkEvaluationPrerequisite,
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
    assert.equal(report.status, 'passed');
    assert.equal(report.acceptance.passed, true);
    assert.equal(report.acceptance.exactCoveragePresent, true);
    assert.equal(report.acceptance.categoryCoverageComplete, true);
    assert.equal(report.coverage.evaluatedPercent, 100);
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

test('检索评测：缺少固定业务资料时明确跳过，不再误判为检索失败', async () => {
    const exact = item(1, '线圈：12-220 冷轧 国标眼');
    const provider = { getStatus: () => ({ model: 'test/e5', dimensions: 3 }) };
    const report = await runKnowledgeRetrievalEvaluation({
        cases,
        provider,
        checkPrerequisite: evaluationCase => ({
            available: evaluationCase.id === 'exact',
            reason: '测试库缺少该资料',
        }),
        async executeCase() {
            return { keyword: [], vector: [exact], hybrid: [exact] };
        },
    });
    assert.equal(report.caseCount, 2);
    assert.equal(report.evaluatedCount, 1);
    assert.equal(report.skippedCount, 1);
    assert.equal(report.metrics.hybrid.total, 1);
    assert.equal(report.cases[1].status, 'missing_prerequisite');
    assert.equal(report.acceptance.coverageSufficient, false);
    assert.equal(report.acceptance.passed, false);
    assert.equal(report.status, 'incomplete');
    assert.equal(report.coverage.minimumEvaluatedCount, 2);
    assert.deepEqual(report.coverage.missingCategories, ['semantic']);
});

test('检索评测：少量用例不能掩盖大部分前置资料缺失', () => {
    const manyCases = [
        ...cases,
        ...Array.from({ length: 9 }, (_value, index) => ({
            id: `extra-${index}`,
            title: `补充用例 ${index}`,
            category: index % 2 ? 'typo' : 'alias',
            query: `查询 ${index}`,
            entryType: 'recipe',
            expectedTitleIncludes: [`目标 ${index}`],
        })),
    ];
    const caseResults = manyCases.map((evaluationCase, index) => (
        index < 2
            ? {
                id: evaluationCase.id,
                category: evaluationCase.category,
                status: 'evaluated',
                ranks: index === 0
                    ? { keyword: 1, vector: 1, hybrid: 1 }
                    : { keyword: null, vector: 1, hybrid: 1 },
                error: '',
            }
            : {
                id: evaluationCase.id,
                category: evaluationCase.category,
                status: 'missing_prerequisite',
                ranks: { keyword: null, vector: null, hybrid: null },
                error: '',
            }
    ));

    const report = buildEvaluationReport(manyCases, caseResults, {});

    assert.equal(report.status, 'incomplete');
    assert.equal(report.acceptance.passed, false);
    assert.equal(report.acceptance.coverageSufficient, false);
    assert.equal(report.coverage.minimumEvaluatedCount, 8);
    assert.equal(report.coverage.evaluatedPercent, 18.2);
    assert.deepEqual(report.coverage.missingCategories.sort(), ['alias', 'typo']);
});

test('检索评测：前置资料检查兼容正式 knowledge_entries 表结构', () => {
    const db = new Database(':memory:');
    try {
        db.exec(`
            CREATE TABLE knowledge_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_type TEXT NOT NULL,
                source_table TEXT NOT NULL,
                source_id TEXT NOT NULL,
                title TEXT NOT NULL
            )
        `);
        db.prepare(`
            INSERT INTO knowledge_entries(entry_type, source_table, source_id, title)
            VALUES (?, ?, ?, ?)
        `).run('coil', 'coils', '1', '线圈：12-220 冷轧 国标眼');
        assert.deepEqual(checkEvaluationPrerequisite(cases[0], { db }), {
            available: true,
            reason: '',
        });
        assert.equal(checkEvaluationPrerequisite(cases[1], { db }).available, false);
    } finally {
        db.close();
    }
});
