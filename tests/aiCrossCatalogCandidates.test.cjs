const test = require('node:test');
const assert = require('node:assert/strict');
const {
    appendCrossCatalogCandidates,
    crossCatalogCandidates,
    isCatalogModelToken,
    withCrossCatalogCandidates,
} = require('../api/services/aiCrossCatalogCandidates.cjs');

const templates = [
    { id: 3, shellModel: 'V750大脚板-2寸-经典款', description: '模板-V750大脚板-2寸-经典款' },
    { id: 4, shellModel: 'SPA-2寸', description: '模板-SPA-2寸' },
];
const parts = [
    { id: 41, model: '泵壳-V750-2寸大脚板', category: '泵壳' },
    { id: 42, model: '木箱-V750', category: '包装' },
    { id: 43, model: '轴承-202', category: '轴承' },
];

function stubGetJson(failures = {}) {
    return async (_fetch, path) => {
        if (failures[path]) throw new Error(failures[path]);
        if (path === '/api/templates') return templates;
        if (path.startsWith('/api/parts')) return parts;
        return [];
    };
}

test('跨目录候选：只对型号简称探测，描述性短语不跨目录', async () => {
    assert.equal(isCatalogModelToken('V750'), true);
    assert.equal(isCatalogModelToken('v550的'), false);
    assert.equal(isCatalogModelToken('12-120'), true);
    assert.equal(isCatalogModelToken('Shadow不存在配方'), false);
    assert.deepEqual(await crossCatalogCandidates(stubGetJson(), null, 'Shadow不存在配方'), []);
    assert.deepEqual(await crossCatalogCandidates(stubGetJson(), null, ''), []);
});

test('跨目录候选：型号简称在模板与零件目录中分别取值，且不带价格', async () => {
    const candidates = await crossCatalogCandidates(stubGetJson(), null, 'V750');
    assert.deepEqual(candidates.map(item => [item.entityType, item.entityLabel, item.label]), [
        ['template', '泵壳模板', '模板-V750大脚板-2寸-经典款'],
        ['part', '零件', '泵壳-V750-2寸大脚板'],
        ['part', '零件', '木箱-V750'],
    ]);
    assert.deepEqual(candidates.map(item => item.canonicalId), [3, 41, 42]);
    assert.ok(candidates.every(item => !('price' in item) && !('stock' in item)));
    assert.equal(candidates[0].nextTool, 'preview_pump_shell_cost');
    assert.equal(candidates[1].nextTool, 'search_parts');
});

test('跨目录候选：未找到配方时补候选，但保留原"未找到"结论', async () => {
    const failure = { success: false, code: 'AI_RESOURCE_NOT_FOUND', entityType: 'recipe', query: 'V750', error: '未找到配方：V750' };
    const enriched = await withCrossCatalogCandidates({ getJson: stubGetJson(), internalFetch: null, failure });
    assert.equal(enriched.error, '未找到配方：V750');
    assert.equal(enriched.success, false);
    assert.equal(enriched.code, 'AI_RESOURCE_NOT_FOUND');
    assert.equal(enriched.crossCatalogCandidates.length, 3);
    assert.match(enriched.crossCatalogHint, /模板-V750大脚板-2寸-经典款（泵壳模板）/u);
    assert.match(enriched.crossCatalogHint, /不要让用户从零说明/u);
});

test('跨目录候选：多候选等其它失败码和目录读取失败都不改变结论', async () => {
    const ambiguous = { success: false, code: 'AI_RESOURCE_AMBIGUOUS', query: 'V750', error: '匹配到 2 个配方' };
    assert.equal(await withCrossCatalogCandidates({ getJson: stubGetJson(), internalFetch: null, failure: ambiguous }), ambiguous);
    const missing = { success: false, code: 'AI_RESOURCE_NOT_FOUND', query: 'V750', error: '未找到配方：V750' };
    const degraded = await withCrossCatalogCandidates({
        getJson: stubGetJson({ '/api/templates': '模板目录不可用', '/api/parts?keyword=V750': '零件目录不可用' }),
        internalFetch: null,
        failure: missing,
    });
    assert.equal(degraded, missing);
});

test('跨目录候选：模型空手反问时确定性补充候选清单，已点出候选则不重复', () => {
    const toolResults = [{
        name: 'preview_recipe_cost',
        result: {
            success: false,
            query: 'V750',
            crossCatalogCandidates: [
                { entityType: 'template', entityLabel: '泵壳模板', canonicalId: 3, label: '模板-V750大脚板-2寸-经典款' },
                { entityType: 'part', entityLabel: '零件', canonicalId: 41, label: '泵壳-V750-2寸大脚板' },
            ],
        },
    }];
    const vague = appendCrossCatalogCandidates('“V750”在正式配方目录中没有找到对应成品。请确认你要查的是哪一项。', toolResults);
    assert.match(vague, /请确认你要查的是哪一项/u);
    assert.match(vague, /模板-V750大脚板-2寸-经典款（泵壳模板 ID 3）/u);
    assert.match(vague, /泵壳-V750-2寸大脚板（零件 ID 41）/u);

    const concrete = appendCrossCatalogCandidates('“V750”不是配方；正式目录里有模板-V750大脚板-2寸-经典款和木箱-V750，你要查哪一个？', toolResults);
    assert.equal(concrete, '“V750”不是配方；正式目录里有模板-V750大脚板-2寸-经典款和木箱-V750，你要查哪一个？');

    assert.equal(appendCrossCatalogCandidates('其它问题。', []), '其它问题。');
});
