const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeRecipeConfiguration, partRole, similarity } = require('../api/services/recipeIntelligence.cjs');

function recipe(overrides = {}) {
    return {
        id: 1,
        name: 'V750 基准',
        spec: '12-140',
        templateId: 7,
        coilSpec: '12',
        coilSheets: 140,
        coilMaterial: '钢带',
        coilSlotType: '小眼',
        hasFloat: 1,
        hasCable: 1,
        savedTotalCost: 280,
        partsJson: JSON.stringify([
            { name: '泵壳套件', model: 'V750', snapshotPrice: 90, dynamicRule: 'shell' },
            { name: '花板轴承', model: '202', snapshotPrice: 1.2 },
            { name: '线圈转子', model: '12-140', snapshotPrice: 110, costSource: 'coil' },
            { name: '浮球-新界式', model: '浮球-线径0.55', snapshotPrice: 7.4, costSource: 'dynamic' },
            { name: '成品电缆（新界式）', model: '电缆-线径0.55', snapshotPrice: 15, cableAssembly: true },
            { name: '说明书（说明书）', model: '说明书', snapshotPrice: 0.5, packingRole: 'fixed' },
        ]),
        ...overrides,
    };
}

test('配方智能分析按模板、BOM 角色和线圈配置排序相似配方', () => {
    const target = recipe();
    const close = recipe({ id: 2, name: 'V750 相近', coilSheets: 160 });
    const distant = recipe({
        id: 3,
        name: 'SPA',
        templateId: 9,
        coilSpec: '17',
        partsJson: JSON.stringify([
            { name: '泵壳套件', model: 'SPA', snapshotPrice: 150, dynamicRule: 'shell' },
            { name: '油缸轴承', model: '204', snapshotPrice: 3 },
        ]),
    });

    const closeScore = similarity(target, close);
    const distantScore = similarity(target, distant);
    assert.ok(closeScore.score > distantScore.score);
    assert.ok(closeScore.reasons.includes('使用同一泵壳模板'));

    const result = analyzeRecipeConfiguration({ recipeId: 1 }, {
        recipes: [target, distant, close],
        parts: [],
    });
    assert.equal(result.version, 'knowledge-v2.2');
    assert.equal(result.advisoryOnly, true);
    assert.equal(result.similarRecipes[0].id, 2);
    assert.equal(result.similarRecipes[0].confidence, 'high');
});

test('配方智能分析识别配置字段与 BOM 的确定性矛盾', () => {
    const target = recipe({
        partsJson: JSON.stringify([
            { name: '花板轴承', model: '202', snapshotPrice: 0 },
        ]),
    });
    const result = analyzeRecipeConfiguration({ recipeId: 1 }, {
        recipes: [target],
        parts: [{ id: 5, model: '202', price: 1.2, supplier: 'A' }],
    });

    const keys = result.missingItems.map(item => item.key);
    assert.ok(keys.includes('missing_shell'));
    assert.ok(keys.includes('missing_coil'));
    assert.ok(keys.includes('missing_float'));
    assert.ok(keys.includes('missing_cable'));
    assert.ok(keys.includes('missing_price:202'));
    assert.equal(result.summary.definiteIssueCount, 5);
    assert.ok(result.missingItems.every(item => item.confidence === 'high'));
});

test('配方智能分析把同类高频项标成复核建议而非确定错误', () => {
    const target = recipe({
        partsJson: JSON.stringify([
            { name: '泵壳套件', model: 'V750', snapshotPrice: 90, dynamicRule: 'shell' },
            { name: '花板轴承', model: '202', snapshotPrice: 1.2 },
            { name: '线圈转子', model: '12-140', snapshotPrice: 110, costSource: 'coil' },
            { name: '浮球-新界式', model: '浮球-线径0.55', snapshotPrice: 7.4, costSource: 'dynamic' },
            { name: '成品电缆（新界式）', model: '电缆-线径0.55', snapshotPrice: 15, cableAssembly: true },
        ]),
    });
    const peers = [2, 3, 4].map(id => recipe({ id, name: `V750 参考${id}` }));
    const result = analyzeRecipeConfiguration({ recipeId: 1 }, {
        recipes: [target, ...peers],
        parts: [{ id: 5, model: '202', price: 1.2 }],
    });

    const suggestion = result.missingItems.find(item => item.key === 'peer_pattern:包装:fixed');
    assert.ok(suggestion);
    assert.equal(suggestion.type, 'peer_pattern');
    assert.equal(suggestion.confidence, 'medium');
    assert.equal(suggestion.prevalence, 1);
    assert.match(suggestion.explanation, /不代表当前配方一定错误/);
});

test('配方智能分析只对可比固定件提示价格异常并保留证据', () => {
    const target = recipe({
        partsJson: JSON.stringify([
            { name: '泵壳套件', model: 'V750', snapshotPrice: 300, dynamicRule: 'shell' },
            { name: '花板轴承', model: '202', supplier: 'A', snapshotPrice: 9 },
            { name: '线圈转子', model: '12-140', snapshotPrice: 999, costSource: 'coil' },
        ]),
        hasFloat: 0,
        hasCable: 0,
    });
    const peers = [2, 3].map(id => recipe({
        id,
        name: `V750 参考${id}`,
        hasFloat: 0,
        hasCable: 0,
        partsJson: JSON.stringify([
            { name: '泵壳套件', model: 'V750', snapshotPrice: 90 + id, dynamicRule: 'shell' },
            { name: '花板轴承', model: '202', supplier: 'A', snapshotPrice: 1.2 },
            { name: '线圈转子', model: '12-140', snapshotPrice: 110 + id, costSource: 'coil' },
        ]),
    }));
    const result = analyzeRecipeConfiguration({ recipeId: 1 }, {
        recipes: [target, ...peers],
        parts: [
            { id: 5, model: '202', supplier: 'A', price: 1.2 },
            { id: 6, model: 'V750', supplier: 'A', price: 90 },
        ],
    });

    assert.equal(result.priceAlerts.length, 1);
    assert.equal(result.priceAlerts[0].model, '202');
    assert.equal(result.priceAlerts[0].type, 'catalog_price_difference');
    assert.equal(result.priceAlerts[0].referenceMedian, 1.2);
    assert.equal(result.priceAlerts[0].evidence[0].source, 'part_catalog');
});

test('配方智能分析支持未保存草稿并拒绝含糊名称', () => {
    const recipes = [
        recipe({ id: 1, name: 'V750 菲律宾' }),
        recipe({ id: 2, name: 'V750 越南' }),
    ];
    assert.throws(
        () => analyzeRecipeConfiguration({ recipeName: 'V750' }, { recipes, parts: [] }),
        /配方名称不明确/
    );

    const result = analyzeRecipeConfiguration({
        draft: {
            name: '新配方草稿',
            templateId: 7,
            parts: [{ name: '泵壳套件', model: 'V750', snapshotPrice: 90, dynamicRule: 'shell' }],
        },
    }, { recipes, parts: [] });
    assert.equal(result.mode, 'draft');
    assert.equal(result.recipe.id, null);
    assert.equal(partRole({ name: '850w上下泡沫（泡沫）', packingRole: 'foam' }), '包装:foam');
    assert.equal(partRole({ name: '不锈钢2寸出水口' }), '出水口');
    assert.equal(partRole({ name: '2寸塑料出水口' }), '出水口');
});

test('配方智能分析应用人工反馈并保留恢复入口', () => {
    const target = recipe({
        partsJson: JSON.stringify([{ name: '花板轴承', model: '202', snapshotPrice: 0 }]),
    });
    const result = analyzeRecipeConfiguration({ recipeId: 1 }, {
        recipes: [target],
        parts: [{ id: 5, model: '202', price: 1.2 }],
        feedback: [
            { id: 9, findingKey: 'missing_shell', decision: 'special_case', note: '客户自备泵壳' },
            { id: 10, findingKey: 'missing_coil', decision: 'confirmed', note: '需要补选' },
        ],
    });

    assert.equal(result.summary.suppressedFindingCount, 1);
    assert.equal(result.missingItems.some(item => item.key === 'missing_shell'), false);
    assert.equal(result.suppressedFindings[0].key, 'missing_shell');
    assert.equal(result.suppressedFindings[0].feedback.note, '客户自备泵壳');
    assert.equal(
        result.missingItems.find(item => item.key === 'missing_coil').feedback.decision,
        'confirmed'
    );
});
