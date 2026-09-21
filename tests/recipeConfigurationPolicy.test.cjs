const test = require('node:test');
const assert = require('node:assert/strict');

const {
    assertRecipeConfigurationAllowed,
    normalizeRecipeConfigurationPolicy,
    stringifyRecipeConfigurationPolicy,
} = require('../api/services/recipeConfigurationPolicy.cjs');

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
