'use strict';
/**
 * E1-C — Cross-Capability Canonical Entity Identity（统一实体身份契约）
 *
 * 覆盖用户点名的测试 12–15：
 *   12 同一 recipe 跨 capability identity 一致
 *   13 same name different id 不合并
 *   14 缺主键时 fail closed / incomplete
 *   15 display label 变化不影响 canonical identity
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    canonicalIdentityFor,
    buildEntityBindingIndex,
    resolveEntityIdentity,
    entityIdentityKey,
    inferEntityType,
} = require('../api/services/canonicalEntityIdentity.cjs');
const { projectMoneyFacts } = require('../api/services/moneyFactProjection.cjs');

const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });

test('E1-C-12 同一 recipe 经不同 capability 得到同一个 canonical identity', () => {
    const receipts = [
        // 正式目录回执：提供「业务键 → 主键」的唯一映射（compare_recipes 自身不返回主键）。
        { name: 'get_all_recipes', result: verified([
            { id: 13, name: 'v550-tokoy', spec: '12-120，带浮球' },
            { id: 2, name: 'v750-tokoy', spec: '12-140，带浮球' },
        ]) },
        { name: 'get_recipe_detail', result: verified({ id: 13, name: 'v550-tokoy', spec: '12-120，带浮球', currentTotalCost: 271.98 }) },
        { name: 'preview_recipe_cost', result: verified({ recipeId: 13, recipeName: 'v550-tokoy', currentTotalCost: 271.98, costComplete: true }) },
        { name: 'compare_recipes', result: { ...verified({}), recipe1: { name: 'v550-tokoy', spec: '12-120，带浮球', cost: 271.98 }, recipe2: { name: 'v750-tokoy', spec: '12-140，带浮球', cost: 286.51 }, costDiff: '-14.53' } },
    ];
    const facts = projectMoneyFacts(receipts, { includeQueries: true });
    const byLabel = new Map(facts.map(fact => [`${fact.capability}|${fact.objectLabel}|${fact.predicate}`, fact]));
    const detail = byLabel.get('get_recipe_detail|v550-tokoy|currentTotalCost');
    const preview = byLabel.get('preview_recipe_cost|v550-tokoy|currentTotalCost');
    const compare = byLabel.get('compare_recipes|v550-tokoy|cost');
    assert.ok(detail && preview && compare, '三项能力都必须产生金额事实');
    assert.equal(detail.entityId, 'recipe:13');
    assert.equal(preview.entityId, 'recipe:13');
    // compare_recipes 自身不返回主键 → 必须由同一轮正式回执的唯一映射绑定，而不是退回名称。
    assert.equal(compare.entityId, 'recipe:13', 'compare_recipes 必须通过正式回执绑定拿到同一 identity');
    assert.equal(compare.identityResolvedBy, 'FORMAL_RECEIPT_BINDING');
    assert.deepEqual([...new Set([detail.entityId, preview.entityId, compare.entityId])], ['recipe:13']);
    // compare_recipes 的第二个主体同样由正式回执绑定到自己的主键（不允许退回名称）。
    const compareRight = byLabel.get('compare_recipes|v750-tokoy|cost');
    assert.equal(compareRight.entityId, 'recipe:2');
    assert.equal(compareRight.identityResolvedBy, 'FORMAL_RECEIPT_BINDING');
});

test('E1-C-13 同名不同主键不得合并；同名同值也不得合并', () => {
    const receipts = [{ name: 'search_coils', result: verified([
        { id: 41, schemeName: '正式方案', schemeCode: 'COIL-0041', cost: 100 },
        { id: 42, schemeName: '正式方案', schemeCode: 'COIL-0042', cost: 100 },
    ]) }];
    const facts = projectMoneyFacts(receipts, { includeQueries: true });
    assert.equal(facts.length, 2, '同名同值但主键不同的两个线圈都必须保留');
    assert.deepEqual(facts.map(fact => fact.entityId).sort(), ['coil:41', 'coil:42']);
});

test('E1-C-14 缺主键时 fail-closed：标记 IDENTITY_INCOMPLETE，且不按名称合并', () => {
    const receipts = [{ name: 'search_coils', result: verified([
        { schemeName: '正式方案', schemeCode: 'COIL-X', cost: 100 },
        { schemeName: '正式方案', schemeCode: 'COIL-X', cost: 100 },
    ]) }];
    const facts = projectMoneyFacts(receipts, { includeQueries: true });
    assert.equal(facts.length, 2, '没有主键时不得把两个来源位置合并成一个事实');
    assert.deepEqual([...new Set(facts.map(fact => fact.identityState))], ['IDENTITY_INCOMPLETE']);
    assert.deepEqual([...new Set(facts.map(fact => fact.identityReasonCode))], ['PRIMARY_KEY_ABSENT']);
    assert.deepEqual([...new Set(facts.map(fact => fact.entityId))], [null]);
});

test('E1-C-14b 业务键映射不唯一时保持不完整并标记 ambiguous（不猜）', () => {
    const index = buildEntityBindingIndex([{ name: 'get_all_recipes', result: verified([
        { id: 13, name: '同名方案', spec: 'A' },
        { id: 15, name: '同名方案', spec: 'B' },
    ]) }]);
    const resolved = resolveEntityIdentity({ entityType: 'recipe', record: { name: '同名方案', spec: 'A' }, index });
    assert.equal(resolved.state, 'IDENTITY_INCOMPLETE');
    assert.equal(resolved.reasonCode, 'AMBIGUOUS_BUSINESS_KEY');
    assert.equal(resolved.ambiguous, true);
    assert.equal(entityIdentityKey(resolved), null);
});

test('E1-C-15 display label 变化不影响 canonical identity', () => {
    const variants = [
        { id: 13, name: 'v550-tokoy', spec: '12-120' },
        { id: 13, displayName: 'V550 大脚板', spec: '12-120' },
        { id: 13, recipeName: '另一个显示名', spec: '12-120' },
    ];
    const identities = variants.map(record => canonicalIdentityFor({ entityType: 'recipe', record }));
    assert.deepEqual([...new Set(identities.map(item => item.entityId))], ['13']);
    assert.deepEqual([...new Set(identities.map(item => entityIdentityKey(item)))], ['recipe:13']);
    assert.deepEqual([...new Set(identities.map(item => item.state))], ['CANONICAL']);
    // 展示名可以不同 —— 这是允许的；canonical identity 必须相同。
    assert.equal(new Set(identities.map(item => item.displayName)).size > 1, true);
});

test('E1-C-16 实体主键优先于业务键（同一记录同时有两种键时用主键）', () => {
    const identity = canonicalIdentityFor({ entityType: 'coil', record: { id: 6, schemeCode: 'COIL-0006', schemeName: '正式方案' } });
    assert.equal(identity.state, 'CANONICAL');
    assert.equal(identity.entityId, '6');
    assert.equal(identity.resolvedBy, 'PRIMARY_KEY');
});

test('E1-C-17 未接入 producer 的 capability（build_recipe_bom_draft）如实标记 IDENTITY_INCOMPLETE', () => {
    // 真实 BOM 草稿的金额挂在 costPreview 下，而 costPreview 自身不携带 recipe 主键/名称；
    // 按契约必须 fail-closed 标记不完整，绝不从 capability 名称或父级文案猜身份。
    const facts = projectMoneyFacts([{ name: 'build_recipe_bom_draft', result: verified({
        costPreview: { currentTotalCost: 285.8, partsCost: 264.8, laborCost: 21, pricingComplete: true },
        configurationBasis: { source: 'recipe', recipeName: 'v550-tokoy', configurationComplete: true },
        parts: [{ model: 'V750-大脚板-2寸' }],
    }) }], { includeQueries: true });
    assert.ok(facts.length > 0);
    assert.deepEqual([...new Set(facts.map(fact => fact.identityState))], ['IDENTITY_INCOMPLETE']);
    assert.deepEqual([...new Set(facts.map(fact => fact.identityReasonCode))], ['PRIMARY_KEY_ABSENT']);
});

test('E1-C-18 实体类型判定来自实体契约字段，不来自自由文本', () => {
    assert.equal(inferEntityType({ schemeCode: 'COIL-1' }, null), 'coil');
    assert.equal(inferEntityType({ partsCount: 24, name: 'x' }, null), 'recipe');
    assert.equal(inferEntityType({ model: '珍珠棉' }, 'catalog'), 'part');
    assert.equal(inferEntityType({ foo: 'bar' }, null), null, '判不出来时必须返回 null（不猜）');
});
