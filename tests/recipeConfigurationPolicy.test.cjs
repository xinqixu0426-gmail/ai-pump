const test = require('node:test');
const assert = require('node:assert/strict');

const {
    assertRecipeConfigurationAllowed,
    normalizeRecipeConfigurationPolicy,
    stringifyRecipeConfigurationPolicy,
} = require('../api/services/recipeConfigurationPolicy.cjs');
const {
    normalizeRecipeConfigurationOverrides,
} = require('../api/services/configuredRecipeSnapshot.cjs');

test('配置策略规范化可保存字段、包装零件和表面处理选项', () => {
    const policy = normalizeRecipeConfigurationPolicy({
        version: 1,
        fields: {
            hasFloat: [false, true, true],
            cableLength: [5, 10, 20],
            coilSheets: [120, 130],
        },
        packingPartIds: [7, 8, 8],
        surfaceTreatmentOptions: [
            { mode: 'none', cost: 9 },
            { mode: 'painting', cost: 3.5 },
        ],
    });

    assert.deepEqual(policy.fields.hasFloat, [false, true]);
    assert.deepEqual(policy.packingPartIds, [7, 8]);
    assert.deepEqual(policy.surfaceTreatmentOptions, [
        { mode: 'none', cost: 0 },
        { mode: 'painting', cost: 3.5 },
    ]);
    assert.equal(JSON.parse(stringifyRecipeConfigurationPolicy(policy)).version, 1);
});

test('未配置策略保持历史开放模式', () => {
    assert.equal(normalizeRecipeConfigurationPolicy(null), null);
    assert.equal(normalizeRecipeConfigurationPolicy('{}'), null);
    assert.doesNotThrow(() => assertRecipeConfigurationAllowed({
        baseline: { cableLength: 5 },
        overrides: { cableLength: 999 },
        policy: null,
    }));
});

test('策略只限制已声明字段，基线值始终可继续使用', () => {
    const policy = normalizeRecipeConfigurationPolicy({
        version: 1,
        fields: { cableLength: [10, 20], coilSheets: [130] },
    });
    assert.doesNotThrow(() => assertRecipeConfigurationAllowed({
        baseline: { cableLength: 5, coilSheets: 120 },
        overrides: { cableLength: 5, coilSheets: 130, hasFloat: true },
        policy,
    }));
    assert.throws(
        () => assertRecipeConfigurationAllowed({
            baseline: { cableLength: 5, coilSheets: 120 },
            overrides: { cableLength: 30 },
            policy,
        }),
        error => error.code === 'RECIPE_CONFIGURATION_NOT_ALLOWED'
            && error.statusCode === 422
    );
});

test('包装策略按稳定 partId 放行并拒绝未登记包装', () => {
    const policy = normalizeRecipeConfigurationPolicy({
        version: 1,
        fields: {},
        packingPartIds: [8],
    });
    const baseline = {
        packingPartsJson: JSON.stringify([{ partId: 7, model: '纸箱', supplier: 'A', qty: 1 }]),
    };
    assert.doesNotThrow(() => assertRecipeConfigurationAllowed({
        baseline,
        overrides: {
            packingPartsJson: JSON.stringify([{ partId: 8, model: '木箱', supplier: 'B', qty: 1 }]),
        },
        policy,
    }));
    assert.throws(
        () => assertRecipeConfigurationAllowed({
            baseline,
            overrides: {
                packingPartsJson: JSON.stringify([{ model: '木箱', supplier: 'B', qty: 1 }]),
            },
            policy,
        }),
        error => error.code === 'RECIPE_CONFIGURATION_PACKING_NOT_ALLOWED'
    );
    assert.throws(
        () => assertRecipeConfigurationAllowed({
            baseline,
            overrides: {
                packingPartsJson: JSON.stringify([{ partId: 9, model: '纸箱', supplier: 'A', qty: 1 }]),
            },
            policy,
        }),
        error => error.code === 'RECIPE_CONFIGURATION_PACKING_NOT_ALLOWED'
            && error.statusCode === 422
    );
});

test('表面处理政策存在时必须精确匹配允许的方式和成本', () => {
    const policy = normalizeRecipeConfigurationPolicy({
        version: 1,
        fields: {},
        surfaceTreatmentOptions: [{ mode: 'painting', cost: 5 }],
    });
    assert.doesNotThrow(() => assertRecipeConfigurationAllowed({
        baseline: { surfaceTreatmentMode: 'none', surfaceTreatmentCost: 0 },
        overrides: { surfaceTreatmentMode: 'painting', surfaceTreatmentCost: 5 },
        policy,
    }));
    assert.throws(
        () => assertRecipeConfigurationAllowed({
            baseline: { surfaceTreatmentMode: 'none', surfaceTreatmentCost: 0 },
            overrides: { surfaceTreatmentMode: 'painting', surfaceTreatmentCost: 6 },
            policy,
        }),
        error => error.code === 'RECIPE_CONFIGURATION_SURFACE_NOT_ALLOWED'
    );
    assert.throws(
        () => assertRecipeConfigurationAllowed({
            baseline: { surfaceTreatmentMode: 'none', surfaceTreatmentCost: 0 },
            overrides: { surfaceTreatmentMode: 'electrophoresis', surfaceTreatmentCost: 6 },
            policy,
        }),
        error => error.code === 'RECIPE_CONFIGURATION_SURFACE_NOT_ALLOWED'
    );
    assert.doesNotThrow(() => assertRecipeConfigurationAllowed({
        baseline: { surfaceTreatmentMode: 'none', surfaceTreatmentCost: 0 },
        overrides: { surfaceTreatmentMode: 'electrophoresis', surfaceTreatmentCost: 6 },
        policy: normalizeRecipeConfigurationPolicy({ version: 1, fields: {} }),
    }));
});

// 生产覆盖恢复（PHASE 8A 生产等价回归发现）：
// 原生产分支 tests/recipeConfigurationPolicy.test.cjs 中的这条表面处理白名单用例，
// 在 Native 版本增量整合时未被带入候选，导致候选丢失了一条生产测试覆盖。
// 这里原样恢复该用例（断言与生产分支逐字一致），不改动任何产品行为。
test('表面处理必须同时匹配允许的方式和成本', () => {
    const policy = normalizeRecipeConfigurationPolicy({
        version: 1,
        fields: {},
        surfaceTreatmentOptions: [{ mode: 'painting', cost: 5 }],
    });
    assert.throws(
        () => assertRecipeConfigurationAllowed({
            baseline: { surfaceTreatmentMode: 'none', surfaceTreatmentCost: 0 },
            overrides: { surfaceTreatmentMode: 'painting', surfaceTreatmentCost: 6 },
            policy,
        }),
        error => error.code === 'RECIPE_CONFIGURATION_SURFACE_NOT_ALLOWED'
    );
});
test('策略拒绝未知字段和重复表面处理方式', () => {
    assert.throws(
        () => normalizeRecipeConfigurationPolicy({ version: 1, fields: { unknown: [1] } }),
        error => error.code === 'RECIPE_CONFIGURATION_POLICY_UNKNOWN_FIELD'
    );
    assert.throws(
        () => normalizeRecipeConfigurationPolicy({
            version: 1,
            fields: {},
            surfaceTreatmentOptions: [
                { mode: 'painting', cost: 1 },
                { mode: 'painting', cost: 2 },
            ],
        }),
        error => error.code === 'RECIPE_CONFIGURATION_POLICY_DUPLICATE'
    );
});

test('包装删除政策规范化并严格拒绝未知、不合法和错误类型字段', () => {
    const policy = normalizeRecipeConfigurationPolicy({ version: 1, fields: {}, packingRemovalPolicy: { removableRoles: ['pearlCotton', 'pearlCotton'], removablePartIds: [7, 7], allowClearAll: false } });
    assert.deepEqual(policy.packingRemovalPolicy, { removableRoles: ['pearlCotton'], removablePartIds: [7], allowClearAll: false });
    for (const removal of [
        { removableRoles: ['unknown'], removablePartIds: [], allowClearAll: false },
        { removableRoles: [], removablePartIds: [0], allowClearAll: false },
        { removableRoles: [], removablePartIds: [], allowClearAll: 'false' },
        { removableRoles: [], removablePartIds: [], allowClearAll: false, unexpected: true },
    ]) assert.throws(() => normalizeRecipeConfigurationPolicy({ version: 1, fields: {}, packingRemovalPolicy: removal }), error => error.code?.startsWith('RECIPE_CONFIGURATION_POLICY_'));
});

test('包装删除政策将替换、明确删除和清空全部明确分开', () => {
    const baseline = { packingPartsJson: JSON.stringify([
        { partId: 1, model: '纸箱', supplier: 'A', qty: 1, packingRole: 'container' },
        { partId: 2, model: '珍珠棉', supplier: 'A', qty: 1, packingRole: 'pearlCotton' },
        { partId: 3, model: '说明书', supplier: 'A', qty: 1, packingRole: 'fixed' },
    ]) };
    const deny = normalizeRecipeConfigurationPolicy({ version: 1, fields: {}, packingPartIds: [4], packingRemovalPolicy: { removableRoles: [], removablePartIds: [], allowClearAll: false } });
    assert.doesNotThrow(() => assertRecipeConfigurationAllowed({ baseline, overrides: { packingPartsJson: JSON.stringify([{ partId: 4, model: '木箱', supplier: 'B', qty: 1, packingRole: 'container' }]) }, policy: deny }));
    assert.throws(() => assertRecipeConfigurationAllowed({ baseline, overrides: { packingPartsJson: JSON.stringify([{ partId: 2, model: '珍珠棉', supplier: 'A', qty: 0, packingRole: 'pearlCotton' }]) }, policy: deny }), error => error.code === 'RECIPE_CONFIGURATION_PACKING_REMOVAL_NOT_ALLOWED');
    assert.throws(() => assertRecipeConfigurationAllowed({ baseline, overrides: { packingPartsJson: '[]' }, policy: deny }), error => error.code === 'RECIPE_CONFIGURATION_PACKING_CLEAR_ALL_NOT_ALLOWED');
    const allow = normalizeRecipeConfigurationPolicy({ version: 1, fields: {}, packingRemovalPolicy: { removableRoles: ['pearlCotton'], removablePartIds: [3], allowClearAll: false } });
    assert.doesNotThrow(() => assertRecipeConfigurationAllowed({ baseline, overrides: { packingPartsJson: JSON.stringify([{ partId: 2, model: '珍珠棉', supplier: 'A', qty: 0, packingRole: 'pearlCotton' }]) }, policy: allow }));
    assert.doesNotThrow(() => assertRecipeConfigurationAllowed({ baseline, overrides: { packingPartsJson: JSON.stringify([{ partId: 3, model: '说明书', supplier: 'A', qty: 0, packingRole: 'fixed' }]) }, policy: allow }));
    assert.throws(() => assertRecipeConfigurationAllowed({ baseline, overrides: { packingPartsJson: JSON.stringify([{ partId: 1, model: '纸箱', supplier: 'A', qty: 0, packingRole: 'container' }]) }, policy: allow }), error => error.code === 'RECIPE_CONFIGURATION_PACKING_REMOVAL_NOT_ALLOWED');
    const clear = normalizeRecipeConfigurationPolicy({ version: 1, fields: {}, packingRemovalPolicy: { removableRoles: [], removablePartIds: [], allowClearAll: true } });
    assert.doesNotThrow(() => assertRecipeConfigurationAllowed({ baseline, overrides: { packingPartsJson: '[]' }, policy: clear }));
    assert.doesNotThrow(() => assertRecipeConfigurationAllowed({ baseline, overrides: {}, policy: deny }));
    assert.doesNotThrow(() => assertRecipeConfigurationAllowed({ baseline, overrides: { packingPartsJson: '[]' }, policy: normalizeRecipeConfigurationPolicy({ version: 1, fields: {} }) }));
});

// 生产整合 PHASE 5-R2 锁定的 qty 语义。
//
// 背景：docs/api-reference.md 对 POST /api/recipes/bom-draft 写了
// 「空数组清空包装，qty=0 移除对应角色」。但仓库里不存在完整的「0 = 移除角色」
// 执行链：recipeBomEngine 与 dynamicCostPreview 都用 Number(part.qty || 1)，
// 因此 qty=0 不但不会被移除，反而会变成 1。也就是说该文档句子描述的是期望能力，
// 不是当前能力。
//
// 生产整合阶段不允许把一个「接受了指令但不执行」的半实现打开，所以最终候选保持
// 生产现有语义：qty 必须为正数，qty=0 拒绝。
// 本测试是双向守卫：既证明 0 被拒绝，也证明它不会静默变成 1。
test('配方配置：packingParts 的 qty 必须为正数，qty=0 拒绝且不得静默变成 1', () => {
    const normalizeWith = qty => normalizeRecipeConfigurationOverrides(
        { packingPartsJson: JSON.stringify([{ partId: 7, model: '木箱', supplier: 'S', qty, packingRole: 'container' }]) },
        'overrides'
    );
    const normalizedOf = qty => JSON.parse(normalizeWith(qty).packingPartsJson)[0].qty;

    assert.equal(normalizedOf(1), 1);
    assert.equal(normalizedOf(2), 2);
    assert.equal(normalizedOf(null), 1, '缺省 qty 取默认值 1');
    assert.equal(normalizedOf(undefined), 1, '缺省 qty 取默认值 1');
    assert.equal(normalizedOf(''), 1, '空字符串按缺省处理');

    // qty=0 必须被拒绝，而不是被接受后静默变成 1。
    assert.throws(() => normalizeWith(0), /必须是正数/, 'qty=0 必须被拒绝');
    assert.throws(() => normalizeWith('0'), /必须是正数/, "qty='0' 必须被拒绝");
    assert.throws(
        () => normalizeWith(0),
        error => !/非负数字/.test(error.message),
        'qty=0 必须按正数约束拒绝，而不是按非负约束被接受'
    );
    for (const negative of [-1, -0.5, '-2']) {
        assert.throws(() => normalizeWith(negative), /必须是正数/, `qty=${JSON.stringify(negative)} 必须被拒绝`);
    }
    for (const notANumber of ['x', {}]) {
        assert.throws(() => normalizeWith(notANumber), /必须是有效数字/, `qty=${JSON.stringify(notANumber)} 必须按数字类型拒绝`);
    }

    // 策略层仍保留 CLEAR_ALL 授权语义（packingPartsJson: '[]' 清空包装），
    // 且策略缺失时保持历史 legacy_open 开放语义。
    const baseline = { packingPartsJson: JSON.stringify([{ partId: 7, model: '木箱', supplier: 'S', qty: 1, packingRole: 'container' }]) };
    assert.doesNotThrow(() => assertRecipeConfigurationAllowed({
        baseline,
        overrides: { packingPartsJson: JSON.stringify([{ partId: 7, model: '木箱', supplier: 'S', qty: 1, packingRole: 'container' }]) },
        policy: null,
    }));
    assert.throws(() => assertRecipeConfigurationAllowed({
        baseline,
        overrides: { packingPartsJson: '[]' },
        policy: normalizeRecipeConfigurationPolicy({ version: 1, fields: {}, packingRemovalPolicy: { removableRoles: [], removablePartIds: [], allowClearAll: false } }),
    }), error => error.code === 'RECIPE_CONFIGURATION_PACKING_CLEAR_ALL_NOT_ALLOWED');
    assert.doesNotThrow(() => assertRecipeConfigurationAllowed({
        baseline,
        overrides: { packingPartsJson: '[]' },
        policy: normalizeRecipeConfigurationPolicy({ version: 1, fields: {}, packingRemovalPolicy: { removableRoles: [], removablePartIds: [], allowClearAll: true } }),
    }));
});
