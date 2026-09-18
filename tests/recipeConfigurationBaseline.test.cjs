const test = require('node:test');
const assert = require('node:assert/strict');
const { selectRecipeBaseline, applyRecipeBaseline } = require('../api/services/recipeConfigurationBaseline.cjs');
const recipe = {
    id: 1, name: '在售产品A', templateId: 10, coilId: 20, coilSpec: '12', coilSheets: 120,
    coilMaterial: '钢带', coilSlotType: '小眼', coilWireWeight: 0.559, coilSchemeFamilyCode: 'A',
    hasFloat: 1, floatAccessoryType: 'xinjie', hasCable: 1, cableLength: 8, cableAccessoryType: 'xinjie',
    packingPartsJson: JSON.stringify([{ model: '木箱', qty: 1 }, { model: '说明书', qty: 1 }, { model: '贴纸', qty: 1 }, { model: '珍珠棉', qty: 1 }, { model: '上下泡沫', qty: 1 }]),
    extraPartsJson: JSON.stringify([{ model: '出水口', qty: 1 }]),
};

test('existing recipe fills omitted configuration while explicit false and packaging role replacement win', () => {
    const before = JSON.stringify(recipe);
    const { input, basis } = applyRecipeBaseline(recipe, { hasFloat: false, packingParts: [{ model: '纸箱', qty: 1 }] });
    assert.equal(input.hasFloat, false); assert.equal(input.cableLength, 8);
    assert.equal(input.cableAccessoryType, 'xinjie'); assert.equal(input.coilId, 20);
    assert.deepEqual(input.optionalParts, [{ model: '出水口', qty: 1 }]);
    assert.deepEqual(input.packingParts.map(p => p.model), ['说明书', '贴纸', '珍珠棉', '上下泡沫', '纸箱']);
    assert.equal(basis.recipeId, 1); assert.ok(basis.overriddenFields.includes('hasFloat'));
    assert.equal(JSON.stringify(recipe), before);
});
test('explicit packaging removal and empty list do not resurrect omitted or zero-quantity parts', () => {
    assert.ok(!applyRecipeBaseline(recipe, { packingParts: [{ model: '珍珠棉', qty: 0 }] }).input.packingParts.some(p => p.model === '珍珠棉'));
    assert.deepEqual(applyRecipeBaseline(recipe, { packingParts: [] }).input.packingParts, []);
    assert.equal(applyRecipeBaseline(recipe, { hasCable: false }).input.hasCable, false);
});
test('coil changes cannot retain old sheet-specific identity or weight, explicit values remain', () => {
    const changed = applyRecipeBaseline(recipe, { coilSheets: 140 }).input;
    assert.equal(changed.coilId, undefined); assert.equal(changed.coilWireWeight, undefined); assert.equal(changed.coilSchemeFamilyCode, undefined);
    const explicit = applyRecipeBaseline(recipe, { coilSheets: 140, coilId: 21, coilWireWeight: 0.7 }).input;
    assert.equal(explicit.coilId, 21); assert.equal(explicit.coilWireWeight, 0.7);
});
test('baseline selection requires unique exact configuration or explicit recipe; unrelated and deleted recipes cannot substitute', () => {
    const other = { ...recipe, id: 2, coilSheets: 140 };
    assert.equal(selectRecipeBaseline([recipe, other], { coilSpec: '120', coilSheets: 120 }, 10).id, 1);
    assert.equal(selectRecipeBaseline([recipe], { coilSheets: 200 }, 10).id, 1);
    assert.equal(selectRecipeBaseline([recipe], {}, 99), null);
    assert.equal(selectRecipeBaseline([{ ...recipe, deletedAt: '2026-01-01' }], {}, 10), null);
    assert.throws(() => selectRecipeBaseline([recipe, other], {}, 10), e => e.code === 'RECIPE_BASELINE_AMBIGUOUS' && e.details.candidates.length === 2);
    assert.equal(selectRecipeBaseline([recipe, other], { baseRecipeId: 2 }, 10).id, 2);
    assert.throws(() => selectRecipeBaseline([recipe], { baseRecipeId: 1 }, 99), e => e.code === 'RECIPE_BASELINE_TEMPLATE_MISMATCH');
    assert.throws(() => selectRecipeBaseline([recipe], { baseRecipeId: 9 }, 10), e => e.code === 'RECIPE_BASELINE_NOT_FOUND');
});


test('private configuration overrides cannot invent or remove unmentioned baseline accessories', () => {
    const { normalizeUserConfigurationOverrides: normalize } = require('../api/services/recipeConfigurationBaseline.cjs');
    const args = { hasFloat: true, hasCable: false, cableLength: 10, optionalParts: [], packingParts: [{ model: '木箱' }] };
    const normalized = normalize(args, [{ role: 'user', content: '带浮球木箱' }, { role: 'assistant', content: '不要电缆' }]);
    assert.equal(normalized.hasFloat, true); assert.equal(normalized.hasCable, undefined);
    assert.equal(normalized.cableLength, undefined); assert.equal(normalized.optionalParts, undefined);
    assert.deepEqual(normalized.packingParts, args.packingParts);
    assert.equal(normalize(args, [{ role: 'user', content: '不要电源线' }]).hasCable, false);
    assert.equal(normalize({ overrides: args }, [{ role: 'user', content: '电缆改10米' }]).overrides.cableLength, 10);
    assert.equal(args.hasCable, false);
});
