const { embeddingProvider } = require('./embeddingProvider.cjs');
const {
    loadKnowledgeItems,
    mergeCandidates,
} = require('./knowledgeHybridSearch.cjs');
const { searchKnowledgeEntries } = require('./knowledge.cjs');
const { searchStoredEmbeddings } = require('./knowledgeVectorStore.cjs');

const RETRIEVAL_LIMIT = 10;
const MINIMUM_COVERAGE_RATIO = 0.7;
const FIXED_RETRIEVAL_CASES = Object.freeze([
    {
        id: 'exact_part_model',
        title: '泵壳精确型号',
        category: 'exact',
        query: '800平刀切割泵壳',
        entryType: 'part',
        expectedTitleIncludes: ['800平刀切割泵壳'],
    },
    {
        id: 'spoken_part_purpose',
        title: '泵壳用途口语',
        category: 'semantic',
        query: '切割杂草用的泵壳',
        entryType: 'part',
        expectedTitleIncludes: ['800平刀切割泵壳'],
    },
    {
        id: 'part_typo',
        title: '泵壳型号错别字',
        category: 'typo',
        query: '800平到切割泵壳',
        entryType: 'part',
        expectedTitleIncludes: ['800平刀切割泵壳'],
    },
    {
        id: 'spoken_recipe',
        title: '菲律宾配方口语',
        category: 'semantic',
        query: '菲律宾六十赫兹两寸水泵的配方',
        entryType: 'recipe',
        expectedTitleIncludes: ['V750', '菲律宾', '60hz'],
    },
    {
        id: 'recipe_model_format',
        title: '配方型号符号差异',
        category: 'alias',
        query: 'V1600三寸12-180配方',
        entryType: 'recipe',
        expectedTitleIncludes: ['V1600', '12-180'],
    },
    {
        id: 'exact_coil_variant',
        title: '线圈材质槽眼精确方案',
        category: 'exact',
        query: '12-220 冷轧 国标眼',
        entryType: 'coil',
        expectedTitleIncludes: ['12-220', '冷轧', '国标眼'],
    },
    {
        id: 'coil_typo',
        title: '线圈俗称和错别字',
        category: 'typo',
        query: '十二杠二百二十冷扎国标眼线圈',
        entryType: 'coil',
        expectedTitleIncludes: ['12-220', '冷轧', '国标眼'],
    },
    {
        id: 'complete_cable_rule',
        title: '成品电缆业务语义',
        category: 'semantic',
        query: '整根电线加插头怎么算',
        entryType: 'business_rule',
        expectedTitleIncludes: ['浮球', '电缆', '包装'],
    },
    {
        id: 'cost_formula_rule',
        title: '完整成本业务语义',
        category: 'semantic',
        query: '水泵成本里面人工包装管理费用怎么加',
        entryType: 'business_rule',
        expectedTitleIncludes: ['完整成本公式'],
    },
    {
        id: 'quotation_typo',
        title: '客户报价错别字',
        category: 'typo',
        query: '邱焕的报假',
        entryType: 'quotation',
        expectedTitleIncludes: ['邱焕'],
    },
    {
        id: 'test_report_alias',
        title: '测试报告别名',
        category: 'alias',
        query: 'V750菲律宾测试报表',
        entryType: 'recipe',
        expectedTitleIncludes: ['V750', '菲律宾'],
    },
]);

function canonicalText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase('zh-CN')
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

function matchesExpected(item, evaluationCase) {
    const title = canonicalText(item?.title);
    return evaluationCase.expectedTitleIncludes.every(value => title.includes(canonicalText(value)));
}

function expectedRank(items, evaluationCase) {
    const index = items.findIndex(item => matchesExpected(item, evaluationCase));
    return index < 0 ? null : index + 1;
}

function topTitles(items) {
    return items.slice(0, 3).map(item => String(item?.title || ''));
}

function checkEvaluationPrerequisite(evaluationCase, options = {}) {
    const database = options.db || require('../db.cjs').db;
    const rows = database.prepare(`
        SELECT title
        FROM knowledge_entries
        WHERE entry_type = ?
    `).all(evaluationCase.entryType);
    const available = rows.some(item => matchesExpected(item, evaluationCase));
    return {
        available,
        reason: available ? '' : '当前数据库缺少该固定评测用例的预期业务资料',
    };
}

function summarizeMode(caseResults, mode) {
    const ranks = caseResults.map(result => result.ranks[mode]);
    const top1Count = ranks.filter(rank => rank === 1).length;
    const top3Count = ranks.filter(rank => rank != null && rank <= 3).length;
    const total = caseResults.length;
    return {
        top1Count,
        top3Count,
        total,
        top1Percent: total ? Number(((top1Count / total) * 100).toFixed(1)) : 0,
        top3Percent: total ? Number(((top3Count / total) * 100).toFixed(1)) : 0,
    };
}

function buildEvaluationReport(cases, caseResults, model = {}) {
    const evaluatedResults = caseResults.filter(result => result.status !== 'missing_prerequisite');
    const skippedResults = caseResults.filter(result => result.status === 'missing_prerequisite');
    const metrics = {
        keyword: summarizeMode(evaluatedResults, 'keyword'),
        vector: summarizeMode(evaluatedResults, 'vector'),
        hybrid: summarizeMode(evaluatedResults, 'hybrid'),
    };
    const exactCases = evaluatedResults.filter(result => result.category === 'exact');
    const exactCoveragePresent = exactCases.length > 0;
    const exactTop1Passed = exactCoveragePresent
        && exactCases.every(result => result.ranks.hybrid === 1);
    const noErrors = evaluatedResults.every(result => !result.error);
    const hybridDoesNotRegress = (
        metrics.hybrid.top1Count >= metrics.keyword.top1Count
        && metrics.hybrid.top3Count >= metrics.keyword.top3Count
    );
    const semanticImproved = metrics.hybrid.top3Count > metrics.keyword.top3Count;
    const requiredCategories = [...new Set(cases.map(item => item.category).filter(Boolean))];
    const evaluatedCategories = [...new Set(evaluatedResults.map(item => item.category).filter(Boolean))];
    const missingCategories = requiredCategories.filter(category => !evaluatedCategories.includes(category));
    const categoryCoverageComplete = missingCategories.length === 0;
    const minimumEvaluatedCount = Math.max(2, Math.ceil(cases.length * MINIMUM_COVERAGE_RATIO));
    const coveragePercent = cases.length > 0
        ? Number(((evaluatedResults.length / cases.length) * 100).toFixed(1))
        : 0;
    const coverageSufficient = evaluatedResults.length >= minimumEvaluatedCount
        && categoryCoverageComplete;
    const passed = noErrors && exactTop1Passed && hybridDoesNotRegress
        && semanticImproved && coverageSufficient;
    const status = passed
        ? 'passed'
        : !coverageSufficient && noErrors
            ? 'incomplete'
            : 'failed';
    return {
        generatedAt: new Date().toISOString(),
        status,
        model: model.model || '',
        dimensions: Number(model.dimensions || 0),
        caseCount: cases.length,
        evaluatedCount: evaluatedResults.length,
        skippedCount: skippedResults.length,
        metrics,
        acceptance: {
            passed,
            noErrors,
            exactCoveragePresent,
            exactTop1Passed,
            hybridDoesNotRegress,
            semanticImproved,
            coverageSufficient,
            categoryCoverageComplete,
        },
        coverage: {
            minimumRatio: MINIMUM_COVERAGE_RATIO,
            minimumEvaluatedCount,
            evaluatedPercent: coveragePercent,
            requiredCategories,
            evaluatedCategories,
            missingCategories,
        },
        regressions: caseResults
            .filter(result => (
                result.ranks.keyword != null
                && (result.ranks.hybrid == null || result.ranks.hybrid > result.ranks.keyword)
            ))
            .map(result => result.id),
        improvements: caseResults
            .filter(result => (
                result.ranks.hybrid != null
                && (result.ranks.keyword == null || result.ranks.hybrid < result.ranks.keyword)
            ))
            .map(result => result.id),
        cases: caseResults,
    };
}

async function executeRetrievalCase(evaluationCase, options = {}) {
    const database = options.db || require('../db.cjs').db;
    const provider = options.provider || embeddingProvider;
    const keywordSearch = options.keywordSearch || searchKnowledgeEntries;
    const vectorSearch = options.vectorSearch || searchStoredEmbeddings;
    const itemLoader = options.itemLoader || loadKnowledgeItems;
    const keyword = keywordSearch({
        query: evaluationCase.query,
        entryType: evaluationCase.entryType,
        limit: RETRIEVAL_LIMIT,
    });
    const status = provider.getStatus();
    const queryVector = await provider.embedQuery(evaluationCase.query);
    const vectorResult = vectorSearch(database, queryVector, {
        model: status.model,
        dimensions: status.dimensions,
        entryType: evaluationCase.entryType,
        limit: RETRIEVAL_LIMIT,
    });
    if (!vectorResult.extension?.available) {
        throw new Error(vectorResult.extension?.error || 'sqlite-vec 不可用');
    }
    const loaded = itemLoader(database, vectorResult.results.map(item => item.id));
    const byId = new Map(loaded.map(item => [Number(item.id), item]));
    const vector = vectorResult.results
        .map(result => byId.get(Number(result.id)))
        .filter(Boolean);
    const hybrid = mergeCandidates(
        keyword,
        vectorResult.results,
        loaded,
        evaluationCase.query,
        RETRIEVAL_LIMIT
    );
    return { keyword, vector, hybrid };
}

async function runKnowledgeRetrievalEvaluation(options = {}) {
    const cases = options.cases || FIXED_RETRIEVAL_CASES;
    const executor = options.executeCase || executeRetrievalCase;
    const prerequisiteCheck = options.checkPrerequisite
        || (options.executeCase ? null : checkEvaluationPrerequisite);
    const caseResults = [];
    for (const evaluationCase of cases) {
        if (prerequisiteCheck) {
            const prerequisite = await prerequisiteCheck(evaluationCase, options);
            if (!prerequisite?.available) {
                caseResults.push({
                    id: evaluationCase.id,
                    title: evaluationCase.title,
                    category: evaluationCase.category,
                    query: evaluationCase.query,
                    entryType: evaluationCase.entryType,
                    expectedTitleIncludes: evaluationCase.expectedTitleIncludes,
                    status: 'missing_prerequisite',
                    ranks: { keyword: null, vector: null, hybrid: null },
                    top: { keyword: [], vector: [], hybrid: [] },
                    error: '',
                    prerequisite: prerequisite?.reason || '缺少固定评测资料',
                });
                continue;
            }
        }
        try {
            const results = await executor(evaluationCase, options);
            caseResults.push({
                id: evaluationCase.id,
                title: evaluationCase.title,
                category: evaluationCase.category,
                query: evaluationCase.query,
                entryType: evaluationCase.entryType,
                expectedTitleIncludes: evaluationCase.expectedTitleIncludes,
                status: 'evaluated',
                ranks: {
                    keyword: expectedRank(results.keyword, evaluationCase),
                    vector: expectedRank(results.vector, evaluationCase),
                    hybrid: expectedRank(results.hybrid, evaluationCase),
                },
                top: {
                    keyword: topTitles(results.keyword),
                    vector: topTitles(results.vector),
                    hybrid: topTitles(results.hybrid),
                },
                error: '',
            });
        } catch (error) {
            caseResults.push({
                id: evaluationCase.id,
                title: evaluationCase.title,
                category: evaluationCase.category,
                query: evaluationCase.query,
                entryType: evaluationCase.entryType,
                expectedTitleIncludes: evaluationCase.expectedTitleIncludes,
                status: 'error',
                ranks: { keyword: null, vector: null, hybrid: null },
                top: { keyword: [], vector: [], hybrid: [] },
                error: String(error?.message || error),
            });
        }
    }
    const status = (options.provider || embeddingProvider).getStatus();
    return buildEvaluationReport(cases, caseResults, status);
}

module.exports = {
    FIXED_RETRIEVAL_CASES,
    buildEvaluationReport,
    checkEvaluationPrerequisite,
    executeRetrievalCase,
    expectedRank,
    matchesExpected,
    runKnowledgeRetrievalEvaluation,
    summarizeMode,
};
