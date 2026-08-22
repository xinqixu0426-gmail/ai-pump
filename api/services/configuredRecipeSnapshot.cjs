const { assertRecipeBomPrices } = require('./costEngine.cjs');
const {
    calculateRecipeCostPreview,
} = require('./dynamicCostPreview.cjs');
const {
    parseJsonArray,
    parseNonNegativeNumber,
    parsePositiveId,
    parsePositiveNumber,
    stringifyJsonArray,
} = require('./validation.cjs');
const {
    assertRecipeConfigurationAllowed,
    recipeConfigurationPolicyFromRecord,
} = require('./recipeConfigurationPolicy.cjs');
const { validateStainlessShaftJointCost } = require('./rotorShaftJoint.cjs');

const CONFIGURATION_KEYS = Object.freeze([
    'hasFloat',
    'floatWire',
    'floatAccessoryType',
    'hasCable',
    'cableLength',
    'cableWire',
    'cableAccessoryType',
    'coilSpec',
    'coilSheets',
    'coilMaterial',
    'coilSlotType',
    'customBarrelLength',
    'boxType',
    'packingPartsJson',
    'surfaceTreatmentMode',
    'surfaceTreatmentCost',
    'hasStainlessShaftJoint',
    'stainlessShaftJointCost',
]);

const SURFACE_TREATMENT_MODES = new Set([
    'none',
    'painting',
    'electrophoresis',
    'electrophoresis_powder_coating',
    'powder_coating',
    'custom',
]);
const ACCESSORY_TYPES = new Set(['standard', 'xinjie']);
const COIL_SLOT_TYPES = new Set(['小眼', '国标眼']);

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeAccessoryType(value) {
    return value === 'xinjie' ? 'xinjie' : 'standard';
}

function configurationValidationError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'RECIPE_CONFIGURATION_OVERRIDES_INVALID';
    return error;
}

function normalizeBooleanOverride(value, field) {
    if (value === true || value === false) return value;
    if (value === 1 || value === 0) return Boolean(value);
    throw configurationValidationError(`${field} 必须是布尔值`);
}

function normalizeEnumOverride(value, field, allowedValues) {
    if (allowedValues.has(value)) return value;
    throw configurationValidationError(`${field} 不是支持的选项`);
}

function normalizeSurfaceTreatmentMode(value) {
    return SURFACE_TREATMENT_MODES.has(value) ? value : 'none';
}

function parseOptionalNonNegativeNumber(value, field) {
    if (value === undefined || value === null || value === '') return '';
    return parseNonNegativeNumber(value, field);
}

function normalizePackingPartsOverride(value, field) {
    const parts = parseJsonArray(stringifyJsonArray(value, field));
    return JSON.stringify(parts.map((part, index) => {
        if (!part || typeof part !== 'object' || Array.isArray(part)) {
            throw configurationValidationError(`${field}[${index}] 必须是对象`);
        }
        const model = String(part.model || '').trim();
        if (!model) throw configurationValidationError(`${field}[${index}].model 不能为空`);
        return {
            ...(parsePositiveId(part.partId) ? { partId: parsePositiveId(part.partId) } : {}),
            model,
            supplier: String(part.supplier || '').trim(),
            qty: parsePositiveNumber(part.qty, `${field}[${index}].qty`, { defaultValue: 1 }),
            ...(part.packagingMaterial ? { packagingMaterial: String(part.packagingMaterial) } : {}),
            ...(part.packingRole ? { packingRole: String(part.packingRole) } : {}),
        };
    }));
}

function normalizeRecipeConfigurationOverrides(overrides, fieldPrefix = 'overrides') {
    if (overrides === undefined || overrides === null) return {};
    if (typeof overrides !== 'object' || Array.isArray(overrides)) {
        const error = new Error(`${fieldPrefix} 必须是对象`);
        error.statusCode = 400;
        error.code = 'RECIPE_CONFIGURATION_OVERRIDES_INVALID';
        throw error;
    }

    const unknownKeys = Object.keys(overrides).filter(key => !CONFIGURATION_KEYS.includes(key));
    if (unknownKeys.length > 0) {
        const error = new Error(`${fieldPrefix} 包含不支持的字段：${unknownKeys.join('、')}`);
        error.statusCode = 400;
        error.code = 'RECIPE_CONFIGURATION_OVERRIDE_UNKNOWN';
        throw error;
    }

    const normalized = {};
    if (hasOwn(overrides, 'hasFloat')) normalized.hasFloat = normalizeBooleanOverride(overrides.hasFloat, `${fieldPrefix}.hasFloat`);
    if (hasOwn(overrides, 'floatWire')) normalized.floatWire = String(overrides.floatWire || '');
    if (hasOwn(overrides, 'floatAccessoryType')) normalized.floatAccessoryType = normalizeEnumOverride(
        overrides.floatAccessoryType,
        `${fieldPrefix}.floatAccessoryType`,
        ACCESSORY_TYPES
    );
    if (hasOwn(overrides, 'hasCable')) normalized.hasCable = normalizeBooleanOverride(overrides.hasCable, `${fieldPrefix}.hasCable`);
    if (hasOwn(overrides, 'cableLength')) normalized.cableLength = parseOptionalNonNegativeNumber(overrides.cableLength, `${fieldPrefix}.cableLength`);
    if (hasOwn(overrides, 'cableWire')) normalized.cableWire = String(overrides.cableWire || '');
    if (hasOwn(overrides, 'cableAccessoryType')) normalized.cableAccessoryType = normalizeEnumOverride(
        overrides.cableAccessoryType,
        `${fieldPrefix}.cableAccessoryType`,
        ACCESSORY_TYPES
    );
    if (hasOwn(overrides, 'coilSpec')) normalized.coilSpec = String(overrides.coilSpec || '');
    if (hasOwn(overrides, 'coilSheets')) normalized.coilSheets = parseOptionalNonNegativeNumber(overrides.coilSheets, `${fieldPrefix}.coilSheets`);
    if (hasOwn(overrides, 'coilMaterial')) normalized.coilMaterial = String(overrides.coilMaterial || '钢带');
    if (hasOwn(overrides, 'coilSlotType')) normalized.coilSlotType = normalizeEnumOverride(
        overrides.coilSlotType,
        `${fieldPrefix}.coilSlotType`,
        COIL_SLOT_TYPES
    );
    if (hasOwn(overrides, 'customBarrelLength')) normalized.customBarrelLength = parseOptionalNonNegativeNumber(overrides.customBarrelLength, `${fieldPrefix}.customBarrelLength`);
    if (hasOwn(overrides, 'boxType')) normalized.boxType = String(overrides.boxType || '');
    if (hasOwn(overrides, 'packingPartsJson')) normalized.packingPartsJson = normalizePackingPartsOverride(
        overrides.packingPartsJson,
        `${fieldPrefix}.packingPartsJson`
    );
    if (hasOwn(overrides, 'surfaceTreatmentMode')) normalized.surfaceTreatmentMode = normalizeEnumOverride(
        overrides.surfaceTreatmentMode,
        `${fieldPrefix}.surfaceTreatmentMode`,
        SURFACE_TREATMENT_MODES
    );
    if (hasOwn(overrides, 'surfaceTreatmentCost')) normalized.surfaceTreatmentCost = parseNonNegativeNumber(
        overrides.surfaceTreatmentCost,
        `${fieldPrefix}.surfaceTreatmentCost`,
        { defaultValue: 0 }
    );
    if (normalized.surfaceTreatmentMode === 'none') normalized.surfaceTreatmentCost = 0;
    if (hasOwn(overrides, 'hasStainlessShaftJoint')) {
        normalized.hasStainlessShaftJoint = normalizeBooleanOverride(
            overrides.hasStainlessShaftJoint,
            `${fieldPrefix}.hasStainlessShaftJoint`
        );
    }
    if (normalized.hasStainlessShaftJoint === true
        && hasOwn(overrides, 'stainlessShaftJointCost')) {
        normalized.stainlessShaftJointCost = validateStainlessShaftJointCost(
            overrides.stainlessShaftJointCost,
            `${fieldPrefix}.stainlessShaftJointCost`
        );
    } else if (normalized.hasStainlessShaftJoint !== true
        && hasOwn(overrides, 'stainlessShaftJointCost')) {
        normalized.stainlessShaftJointCost = 0;
    }
    return normalized;
}

function configurationSnapshotFromRecipeData(recipeData) {
    return {
        hasFloat: Boolean(Number(recipeData.has_float || 0)),
        floatWire: String(recipeData.float_wire || ''),
        floatAccessoryType: normalizeAccessoryType(recipeData.float_accessory_type),
        hasCable: Boolean(Number(recipeData.has_cable || 0)),
        cableLength: Number(recipeData.cable_length || 0),
        cableWire: String(recipeData.cable_wire || ''),
        cableAccessoryType: normalizeAccessoryType(recipeData.cable_accessory_type),
        coilSpec: String(recipeData.coil_spec || ''),
        coilSheets: Number(recipeData.coil_sheets || 0),
        coilMaterial: String(recipeData.coil_material || '钢带'),
        coilSlotType: String(recipeData.coil_slot_type || '小眼'),
        customBarrelLength: recipeData.custom_barrel_length == null
            ? null
            : Number(recipeData.custom_barrel_length),
        boxType: String(recipeData.box_type || ''),
        packingPartsJson: JSON.stringify(parseJsonArray(recipeData.packing_parts_json)),
        surfaceTreatmentMode: normalizeSurfaceTreatmentMode(recipeData.surface_treatment_mode),
        surfaceTreatmentCost: Number(recipeData.surface_treatment_cost || 0),
        hasStainlessShaftJoint: Boolean(Number(recipeData.has_stainless_shaft_joint || 0)),
        stainlessShaftJointCost: Number(recipeData.stainless_shaft_joint_cost || 0),
        rotorShaftProcess: recipeData.rotor_shaft_process || 'standard',
    };
}

function buildConfiguredRecipeSnapshot(dependencies, recipeIdValue, rawOverrides = {}, options = {}) {
    const {
        calculateRecipeCost,
        db,
        dbGetAllCoils,
        getSetting,
        loadPartsData,
    } = dependencies;
    const recipeId = parsePositiveId(recipeIdValue);
    if (!recipeId) {
        const error = new Error(`${options.fieldPrefix || 'recipeId'} 必须是有效配方ID`);
        error.statusCode = 422;
        error.code = 'RECIPE_CONFIGURATION_RECIPE_REQUIRED';
        throw error;
    }
    const recipe = options.recipe || db.prepare(
        'SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL'
    ).get(recipeId);
    if (!recipe) {
        const error = new Error(`配方 #${recipeId} 不存在或已停用`);
        error.statusCode = 422;
        error.code = 'RECIPE_CONFIGURATION_RECIPE_NOT_FOUND';
        throw error;
    }

    const fieldPrefix = options.overridesField || 'overrides';
    const configurationOverrides = normalizeRecipeConfigurationOverrides(rawOverrides, fieldPrefix);
    const baselineConfiguration = configurationSnapshotFromRecipeData(recipe);
    const configurationPolicy = recipeConfigurationPolicyFromRecord(recipe);
    assertRecipeConfigurationAllowed({
        baseline: baselineConfiguration,
        overrides: configurationOverrides,
        policy: configurationPolicy,
    });
    const { partsCache, partsByModel } = loadPartsData();
    const preview = calculateRecipeCostPreview(recipe, configurationOverrides, {
        partsCache,
        partsByModel,
        partsCatalog: Object.values(partsByModel).flat(),
        calculateRecipeCost,
        getCoils: dbGetAllCoils,
        getSetting,
    });
    assertRecipeBomPrices(preview.parts);

    const configurationSnapshot = configurationSnapshotFromRecipeData(preview.recipeData);
    return {
        recipe,
        recipeId,
        configurationOverrides: {
            ...configurationOverrides,
            hasStainlessShaftJoint: configurationSnapshot.hasStainlessShaftJoint,
            stainlessShaftJointCost: configurationSnapshot.stainlessShaftJointCost,
        },
        configurationPolicy,
        configurationPolicyMode: configurationPolicy ? 'explicit' : 'legacy_open',
        configurationSnapshot,
        unitCost: Number(preview.unitCost || 0),
        bomSnapshot: preview.parts,
        costSnapshot: preview.costSnapshot,
        warnings: Array.isArray(preview.warnings) ? preview.warnings : [],
    };
}

module.exports = {
    CONFIGURATION_KEYS,
    buildConfiguredRecipeSnapshot,
    configurationSnapshotFromRecipeData,
    normalizeRecipeConfigurationOverrides,
};
