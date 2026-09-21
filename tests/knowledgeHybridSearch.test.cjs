const test = require('node:test');
const assert = require('node:assert/strict');
const {
    canonicalText,
    mergeCandidates,
    searchFactoryKnowledge,
} = require('../api/services/knowledgeHybridSearch.cjs');
const { estimateTextTokens } = require('../api/services/aiTokenBudget.cjs');

function item(id, title, metadata = {}, overrides = {}) {
    return {
        id,
        entryType: overrides.entryType || 'recipe',
        sourceTable: overrides.sourceTable || 'recipes',
        sourceId: String(overrides.sourceId || id),
        title,
        summary: overrides.summary || '',
        tags: [],
        metadata,
        syncedAt: null,
        updatedAt: null,
    };
}

function provider(options = {}) {
    return {
        getStatus() {
            return {
                enabled: true,
                model: 'test/e5',
                dimensions: 3,
            };
        },
        async embedQuery() {
            if (options.error) throw options.error;
            return Float32Array.from([1, 0, 0]);
        },
    };
}

test('混合检索：型号、规格等精确命中优先于语义近似项', async () => {
    const semantic = item(1, 'V1600-3 水泵配方');
    const exact = item(2, '配方：V1600-3-12-200', { coilSpec: '12-200' });
    const vectorOnly = item(3, '配方：V1600-3-12-220');
    const result = await searchFactoryKnowledge(
        { query: '12－200', limit: 5 },
        {
            provider: provider(),
            db: {},
            keywordSearch: () => [semantic, exact],
            vectorSearch: () => ({
                extension: { available: true },
                results: [
                    { id: semantic.id, vectorDistance: 0.01 },
                    { id: exact.id, vectorDistance: 0.2 },
                    { id: vectorOnly.id, vectorDistance: 0.21 },
                ],
            }),
            itemLoader: () => [vectorOnly],
        }
    );

    assert.deepEqual(result.map(row => row.id), [exact.id, semantic.id]);
    assert.equal(result[0].matchMode, 'exact');
    assert.equal(result[0].evidenceLevel, 'exact_text');
    assert.equal(result[0].exactMatch, true);
    assert.equal(result[0].keywordRank, 2);
    assert.equal(result[1].matchMode, 'hybrid');
    assert.equal(result[1].evidenceLevel, 'text_match');
    assert.equal(result.some(row => row.id === vectorOnly.id), false);
});

test('混合检索：向量召回补充 FTS 未命中的语义条目并保留过滤条件', async () => {
    const semantic = item(9, '成品电缆采购规则', {}, {
        entryType: 'business_rule',
        sourceTable: 'business_rules',
    });
    let vectorOptions;
    const result = await searchFactoryKnowledge(
        {
            query: '带插头的整根线怎么采购',
            entryType: 'business_rule',
            sourceTable: 'business_rules',
            limit: 3,
        },
        {
            provider: provider(),
            db: {},
            keywordSearch: () => [],
            vectorSearch: (_db, _vector, options) => {
                vectorOptions = options;
                return {
                    extension: { available: true },
                    results: [{ id: semantic.id, vectorDistance: 0.08 }],
                };
            },
            itemLoader: (_db, ids) => {
                assert.deepEqual(ids, [semantic.id]);
                return [semantic];
            },
        }
    );

    assert.equal(result.length, 1);
    assert.equal(result[0].id, semantic.id);
    assert.equal(result[0].matchMode, 'vector');
    assert.equal(result[0].evidenceLevel, 'semantic_candidate');
    assert.equal(result[0].keywordRank, null);
    assert.equal(result[0].vectorDistance, 0.08);
    assert.equal(vectorOptions.entryType, 'business_rule');
    assert.equal(vectorOptions.sourceTable, 'business_rules');
});

test('混合检索：查询模型异常时完整回退 FTS 且不伪造语义命中', async () => {
    const keyword = item(3, '800 平刀切割泵壳', { model: '800平刀' });
    const warnings = [];
    const result = await searchFactoryKnowledge(
        { query: '800平刀', limit: 5 },
        {
            provider: provider({ error: new Error('模型缓存不可用') }),
            keywordSearch: () => [keyword],
            logger: {
                warn(message, meta) {
                    warnings.push({ message, meta });
                },
            },
        }
    );

    assert.equal(result.length, 1);
    assert.equal(result[0].matchMode, 'exact');
    assert.equal(result[0].evidenceLevel, 'exact_text');
    assert.equal(result[0].vectorDistance, null);
    assert.equal(result[0].keywordRank, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].meta.error, /模型缓存不可用/);
});

test('混合检索：模型状态读取异常也回退 FTS', async () => {
    const keyword = item(8, '客户：菲律宾经销商', { customerName: '菲律宾经销商' });
    const warnings = [];
    const result = await searchFactoryKnowledge(
        { query: '菲律宾经销商', limit: 5 },
        {
            provider: {
                getStatus() {
                    throw new Error('模型状态不可读');
                },
            },
            keywordSearch: () => [keyword],
            logger: {
                warn(message, meta) {
                    warnings.push({ message, meta });
                },
            },
        }
    );

    assert.equal(result[0].id, keyword.id);
    assert.equal(result[0].matchMode, 'exact');
    assert.equal(result[0].vectorDistance, null);
    assert.match(warnings[0].meta.error, /模型状态不可读/);
});

test('混合检索：关闭功能或空查询时不加载模型', async () => {
    let embedded = false;
    const disabledProvider = {
        getStatus: () => ({ enabled: true }),
        async embedQuery() {
            embedded = true;
            throw new Error('不应调用');
        },
    };
    const rows = [item(4, '最近知识')];

    const disabled = await searchFactoryKnowledge(
        { query: '知识', limit: 1 },
        {
            enabled: false,
            provider: disabledProvider,
            keywordSearch: () => rows,
        }
    );
    const empty = await searchFactoryKnowledge(
        { query: '', limit: 1 },
        {
            provider: disabledProvider,
            keywordSearch: () => rows,
        }
    );

    assert.equal(embedded, false);
    assert.equal(disabled[0].matchMode, 'exact');
    assert.equal(empty[0].matchMode, 'keyword');
});

test('混合检索：融合排序在同分时按关键词名次和 ID 保持稳定', () => {
    const first = item(10, '第一条');
    const second = item(11, '第二条');
    const merged = mergeCandidates(
        [first, second],
        [
            { id: second.id, vectorDistance: 0.1 },
            { id: first.id, vectorDistance: 0.2 },
        ],
        [],
        '不精确的查询',
        10
    );

    assert.deepEqual(merged.map(row => row.id), [first.id, second.id]);
    assert.ok(merged.every(row => row.matchMode === 'hybrid'));
    assert.ok(merged.every(row => row.evidenceLevel === 'text_match'));
    assert.equal(canonicalText(' 12－200 '), '12200');
});

test('知识检索：长正文只返回有位置的相关片段且不把完整 content 暴露给列表调用方', async () => {
    const longPrefix = '常规工厂说明。'.repeat(12000);
    const knowledge = {
        ...item(20, '线圈绕组工艺'),
        content: `${longPrefix}\n关键绕组数据：主绕组 168 匝，副绕组 212 匝。`,
    };
    const result = await searchFactoryKnowledge(
        { query: '主绕组 168 匝', limit: 1 },
        {
            enabled: false,
            keywordSearch: () => [knowledge],
            maxTokens: 600,
        }
    );
    assert.equal(Object.hasOwn(result[0], 'content'), false);
    assert.equal(result[0].relevantChunks.length > 0, true);
    assert.equal(result[0].relevantChunks.some(chunk => chunk.content.includes('主绕组 168 匝')), true);
    assert.equal(result[0].relevantChunks[0].charStart > 0, true);
});

test('知识检索：多候选共享同一全局片段预算，耗尽后不再强行分配最小片段', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
        ...item(30 + index, `候选 ${index + 1}`),
        content: `绕组预算候选 ${index + 1}，关键数据 ${'很长的说明'.repeat(80)}`,
    }));
    const result = await searchFactoryKnowledge(
        { query: '绕组预算候选', limit: 5 },
        {
            enabled: false,
            keywordSearch: () => rows,
            maxTokens: 2,
        }
    );
    const chunks = result.flatMap(entry => entry.relevantChunks);
    const totalTokens = chunks.reduce(
        (sum, chunk) => sum + estimateTextTokens(chunk.content),
        0
    );
    assert.equal(totalTokens <= 2, true);
    assert.equal(result.some(entry => entry.relevantChunks.length === 0), true);
});

test('知识检索：显式零 token 预算不回退为默认片段预算', async () => {
    const result = await searchFactoryKnowledge(
        { query: '绕组', limit: 1 },
        {
            enabled: false,
            keywordSearch: () => [{ ...item(40, '绕组'), content: '主绕组 168 匝' }],
            maxTokens: 0,
        }
    );
    assert.deepEqual(result[0].relevantChunks, []);
});
