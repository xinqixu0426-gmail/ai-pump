const { buildCurrentRecipeBomInput } = require('./currentRecipeCost.cjs');
const { normalizeCoilSpec } = require('./coilCost.cjs');
const { inferPackagingSemantics } = require('./packagingSemantics.cjs');
const { parseJsonArray, parsePositiveId } = require('./validation.cjs');

function baselineError(code, message, statusCode, candidates = []) {
    return Object.assign(new Error(message), { code, statusCode, details: { candidates: candidates.map(recipe => ({
        recipeId: recipe.id, recipeName: recipe.name, templateId: recipe.templateId,
        coilSpec: recipe.coilSpec, coilSheets: recipe.coilSheets,
        hasFloat: Boolean(recipe.hasFloat), cableLength: recipe.cableLength,
    })) } });
}

function selectRecipeBaseline(recipes, input, templateId) {
    const available = recipes.filter(recipe => !recipe.deletedAt);
    if (input.baseRecipeId !== undefined) {
        const id = parsePositiveId(input.baseRecipeId);
        if (!id) throw baselineError('RECIPE_BASELINE_INVALID', '基准配方 ID 不合法', 400);
        const recipe = available.find(item => Number(item.id) === id);
        if (!recipe) throw baselineError('RECIPE_BASELINE_NOT_FOUND', '基准配方不存在', 404);
        if (templateId != null && Number(recipe.templateId) !== Number(templateId)) throw baselineError('RECIPE_BASELINE_TEMPLATE_MISMATCH', '基准配方与所选泵壳模板不一致', 409);
        return recipe;
    }
    const sameTemplate = available.filter(recipe => Number(recipe.templateId) === Number(templateId));
    const exact = sameTemplate.filter(recipe =>
        (!input.coilSpec || normalizeCoilSpec(recipe.coilSpec).diameterMm === normalizeCoilSpec(input.coilSpec).diameterMm)
        && (input.coilSheets == null || Number(recipe.coilSheets) === Number(input.coilSheets))
        && (!input.coilMaterial || recipe.coilMaterial === input.coilMaterial)
        && (!input.coilSlotType || recipe.coilSlotType === input.coilSlotType));
    const candidates = exact.length ? exact : sameTemplate;
    if (candidates.length > 1) throw baselineError('RECIPE_BASELINE_AMBIGUOUS', '存在多个基准配方，请选择完整配置基准；不要默认取第一条', 409, candidates);
    return candidates[0] || null;
}

// A packaging patch replaces only its role, preserving unrelated fixed inserts.
function mergePackingSelection(baseline, patches) {
    if (!patches.length) return [];
    const keys = part => {
        const role = inferPackagingSemantics(part).packingRole;
        return role === 'fixed' ? 'fixed:' + String(part.model || '') : role;
    };
    const replaced = new Set(patches.map(keys));
    return [...baseline.filter(part => !replaced.has(keys(part))), ...patches.filter(part => part.qty == null || Number(part.qty) !== 0)];
}

function applyRecipeBaseline(recipe, input, catalog) {
    const base = buildCurrentRecipeBomInput(recipe, catalog);
    const provided = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const result = { ...base, ...provided };
    for (const [wire, id] of [['floatWire', 'floatPartId'], ['cableWire', 'cablePartId']]) {
        if (provided[wire] !== undefined && String(provided[wire]) !== String(base[wire]) && provided[id] === undefined) delete result[id];
    }
    // A changed coil cannot inherit the old scheme identity, sheet-specific weight or family.
    if (['coilSpec', 'coilSheets', 'coilMaterial', 'coilSlotType', 'coilId'].some(key =>
        provided[key] != null && String(provided[key]) !== String(base[key]))) {
        for (const key of ['coilId', 'coilWireWeight', 'coilSchemeFamilyCode']) {
            if (provided[key] === undefined) delete result[key];
        }
    }
    if (provided.packingParts !== undefined || provided.packingPartsJson !== undefined) {
        result.packingParts = mergePackingSelection(base.packingParts, parseJsonArray(provided.packingParts ?? provided.packingPartsJson));
    }
    if (provided.optionalParts !== undefined || provided.extraParts !== undefined) {
        result.optionalParts = parseJsonArray(provided.optionalParts ?? provided.extraParts);
    }
    return {
        input: result,
        basis: {
            source: 'recipe', recipeId: recipe.id, recipeName: recipe.name,
            inheritedFields: Object.keys(base).filter(key => provided[key] === undefined),
            overriddenFields: Object.keys(provided).filter(key => Object.hasOwn(base, key)),
            note: '沿用此在售配方的完整配置，仅覆盖明确给定项；包装按角色替换，未提到的配套项保留。金额按当前正式价格重新计算，不使用保存总价。',
        },
    };
}
// Private chat supplies only user-mentioned configuration groups. Unmentioned
// model defaults must not override the formal baseline (especially false/[]).
function normalizeUserConfigurationOverrides(args, messages = []) {
    const text = messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
    const groups = [
        [/浮球|浮子|液位|hasFloat|floatWire|floatAccessoryType/i, ['hasFloat', 'floatWire', 'floatAccessoryType']],
        [/电缆|电源线|引线|线长|hasCable|cableLength|cableWire|cableAccessoryType/i, ['hasCable', 'cableLength', 'cableWire', 'cableAccessoryType']],
        [/包装|包材|箱|泡沫|珍珠棉|说明书|贴纸|packingParts|boxType/i, ['packingParts', 'packingPartsJson', 'boxType']],
        [/配件|零件|出水口|附件|optionalParts|extraParts/i, ['optionalParts', 'extraParts', 'extraPartsJson']],
    ];
    const normalize = value => {
        const copy = { ...value };
        for (const [mentioned, fields] of groups) if (!mentioned.test(text)) for (const field of fields) delete copy[field];
        return copy;
    };
    return { ...normalize(args), ...(args.overrides ? { overrides: normalize(args.overrides) } : {}) };
}
module.exports = { normalizeUserConfigurationOverrides, selectRecipeBaseline, applyRecipeBaseline, mergePackingSelection };
