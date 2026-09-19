const {
    parseJsonArray,
    parseNonNegativeNumber,
    parsePositiveId,
} = require('./validation.cjs');

const CONFIGURATION_POLICY_VERSION = 1;
const CONFIGURATION_POLICY_FIELD_TYPES = Object.freeze({
    hasFloat: 'boolean',
    floatWire: 'string',
    floatAccessoryType: 'accessory',
    hasCable: 'boolean',
    cableLength: 'number',
    cableWire: 'string',
    cableAccessoryType: 'accessory',
    coilId: 'positiveId',
    coilSchemeFamilyCode: 'string',
    coilSpec: 'string',
    coilSheets: 'number',
    coilMaterial: 'string',
    coilSlotType: 'coilSlotType',
    customBarrelLength: 'number',
});
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
const MAX_ALLOWED_VALUES = 100;

function policyError(code, message, statusCode = 400, details) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    if (details !== undefined) error.details = details;
    return error;
}

function parsePolicyObject(value, field) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        return parsed;
    } catch {
        throw policyError(
            'RECIPE_CONFIGURATION_POLICY_INVALID',
            `${field} 必须是 JSON 对象`
        );
    }
}

function normalizeFieldValue(value, type, field) {
    if (type === 'boolean') {
        if (value === true || value === false) return value;
        if (value === 1 || value === 0) return Boolean(value);
        throw policyError('RECIPE_CONFIGURATION_POLICY_INVALID', `${field} 必须是布尔值`);
    }
    if (type === 'number') return parseNonNegativeNumber(value, field);
    if (type === 'positiveId') return parsePositiveId(value, field);
    const text = String(value ?? '').trim();
    if (!text) {
        throw policyError('RECIPE_CONFIGURATION_POLICY_INVALID', `${field} 不能为空`);
    }
    if (type === 'accessory' && !ACCESSORY_TYPES.has(text)) {
        throw policyError('RECIPE_CONFIGURATION_POLICY_INVALID', `${field} 不是支持的配件类型`);
    }
    if (type === 'coilSlotType' && !COIL_SLOT_TYPES.has(text)) {
        throw policyError('RECIPE_CONFIGURATION_POLICY_INVALID', `${field} 不是支持的槽眼类型`);
    }
    return text;
}

function stableValueKey(value) {
    return `${typeof value}:${String(value)}`;
}

function normalizeAllowedValues(values, type, field) {
    if (!Array.isArray(values)) {
        throw policyError('RECIPE_CONFIGURATION_POLICY_INVALID', `${field} 必须是数组`);
    }
    if (values.length > MAX_ALLOWED_VALUES) {
        throw policyError(
            'RECIPE_CONFIGURATION_POLICY_LIMIT',
            `${field} 最多允许 ${MAX_ALLOWED_VALUES} 个值`
        );
    }
    const normalized = values.map((value, index) => normalizeFieldValue(
        value,
        type,
        `${field}[${index}]`
    ));
    return [...new Map(normalized.map(value => [stableValueKey(value), value])).values()];
}

function normalizeRecipeConfigurationPolicy(value, field = 'configurationPolicyJson') {
    const source = parsePolicyObject(value, field);
    if (!source || Object.keys(source).length === 0) return null;
    const unknownKeys = Object.keys(source).filter(key => ![
        'version',
        'fields',
        'packingPartIds',
        'surfaceTreatmentOptions',
    ].includes(key));
    if (unknownKeys.length > 0) {
        throw policyError(
            'RECIPE_CONFIGURATION_POLICY_UNKNOWN_FIELD',
            `${field} 包含不支持的字段：${unknownKeys.join('、')}`
        );
    }
    const version = Number(source.version);
    if (version !== CONFIGURATION_POLICY_VERSION) {
        throw policyError(
            'RECIPE_CONFIGURATION_POLICY_VERSION_UNSUPPORTED',
            `${field}.version 仅支持 ${CONFIGURATION_POLICY_VERSION}`
        );
    }
    const sourceFields = source.fields ?? {};
    if (!sourceFields || typeof sourceFields !== 'object' || Array.isArray(sourceFields)) {
        throw policyError('RECIPE_CONFIGURATION_POLICY_INVALID', `${field}.fields 必须是对象`);
    }
    const unknownFields = Object.keys(sourceFields).filter(
        key => !CONFIGURATION_POLICY_FIELD_TYPES[key]
    );
    if (unknownFields.length > 0) {
        throw policyError(
            'RECIPE_CONFIGURATION_POLICY_UNKNOWN_FIELD',
            `${field}.fields 包含不支持的配置：${unknownFields.join('、')}`
        );
    }
    const fields = {};
    Object.entries(sourceFields).forEach(([key, values]) => {
        fields[key] = normalizeAllowedValues(
            values,
            CONFIGURATION_POLICY_FIELD_TYPES[key],
            `${field}.fields.${key}`
        );
    });

    const normalized = { version: CONFIGURATION_POLICY_VERSION, fields };
    if (Object.prototype.hasOwnProperty.call(source, 'packingPartIds')) {
        if (!Array.isArray(source.packingPartIds)) {
            throw policyError(
                'RECIPE_CONFIGURATION_POLICY_INVALID',
                `${field}.packingPartIds 必须是数组`
            );
        }
        if (source.packingPartIds.length > MAX_ALLOWED_VALUES) {
            throw policyError(
                'RECIPE_CONFIGURATION_POLICY_LIMIT',
                `${field}.packingPartIds 最多允许 ${MAX_ALLOWED_VALUES} 个零件`
            );
        }
        normalized.packingPartIds = [...new Set(source.packingPartIds.map((partId, index) => {
            const parsed = parsePositiveId(partId);
            if (!parsed) {
                throw policyError(
                    'RECIPE_CONFIGURATION_POLICY_INVALID',
                    `${field}.packingPartIds[${index}] 必须是有效零件ID`
                );
            }
            return parsed;
        }))];
    }
    if (Object.prototype.hasOwnProperty.call(source, 'surfaceTreatmentOptions')) {
        if (!Array.isArray(source.surfaceTreatmentOptions)) {
            throw policyError(
                'RECIPE_CONFIGURATION_POLICY_INVALID',
                `${field}.surfaceTreatmentOptions 必须是数组`
            );
        }
        const seenModes = new Set();
        normalized.surfaceTreatmentOptions = source.surfaceTreatmentOptions.map((option, index) => {
            if (!option || typeof option !== 'object' || Array.isArray(option)) {
                throw policyError(
                    'RECIPE_CONFIGURATION_POLICY_INVALID',
                    `${field}.surfaceTreatmentOptions[${index}] 必须是对象`
                );
            }
            const mode = String(option.mode || '').trim();
            if (!SURFACE_TREATMENT_MODES.has(mode)) {
                throw policyError(
                    'RECIPE_CONFIGURATION_POLICY_INVALID',
                    `${field}.surfaceTreatmentOptions[${index}].mode 不受支持`
                );
            }
            if (seenModes.has(mode)) {
                throw policyError(
                    'RECIPE_CONFIGURATION_POLICY_DUPLICATE',
                    `${field}.surfaceTreatmentOptions 中的 ${mode} 重复`
                );
            }
            seenModes.add(mode);
            return {
                mode,
                cost: mode === 'none'
                    ? 0
                    : parseNonNegativeNumber(
                        option.cost,
                        `${field}.surfaceTreatmentOptions[${index}].cost`
                    ),
            };
        });
    }
    return normalized;
}

function stringifyRecipeConfigurationPolicy(value, field = 'configurationPolicyJson') {
    const policy = normalizeRecipeConfigurationPolicy(value, field);
    return policy ? JSON.stringify(policy) : null;
}

function recipeConfigurationPolicyFromRecord(record = {}) {
    return normalizeRecipeConfigurationPolicy(
        record.configurationPolicyJson ?? record.configuration_policy_json,
        'configurationPolicyJson'
    );
}

function sameConfigurationValue(left, right) {
    if (typeof left === 'boolean' || typeof right === 'boolean') {
        return Boolean(left) === Boolean(right);
    }
    if (typeof left === 'number' || typeof right === 'number') {
        return Number(left || 0) === Number(right || 0);
    }
    return String(left ?? '') === String(right ?? '');
}

function packingIdentity(part = {}) {
    const partId = parsePositiveId(part.partId);
    if (partId) return `part:${partId}`;
    return `legacy:${String(part.model || '').trim()}::${String(part.supplier || '').trim()}`;
}

function assertRecipeConfigurationAllowed({ baseline, overrides, policy }) {
    if (!policy) return;
    for (const [key, allowedValues] of Object.entries(policy.fields || {})) {
        if (!Object.prototype.hasOwnProperty.call(overrides, key)) continue;
        const nextValue = overrides[key];
        if (sameConfigurationValue(nextValue, baseline[key])) continue;
        if (!allowedValues.some(value => sameConfigurationValue(value, nextValue))) {
            throw policyError(
                'RECIPE_CONFIGURATION_NOT_ALLOWED',
                `${key} 的值不在当前配方允许范围内`,
                422,
                { field: key, value: nextValue, allowedValues }
            );
        }
    }

    if (Object.prototype.hasOwnProperty.call(policy, 'packingPartIds')
        && Object.prototype.hasOwnProperty.call(overrides, 'packingPartsJson')) {
        const baselineParts = parseJsonArray(baseline.packingPartsJson);
        const baselineIdentities = new Set(baselineParts.map(packingIdentity));
        const baselineLegacyIdentities = new Set(baselineParts.map(part => (
            `legacy:${String(part.model || '').trim()}::${String(part.supplier || '').trim()}`
        )));
        const allowedPartIds = new Set(policy.packingPartIds);
        const selected = parseJsonArray(overrides.packingPartsJson);
        const invalid = selected.find(part => {
            const legacyIdentity = `legacy:${String(part.model || '').trim()}::${String(part.supplier || '').trim()}`;
            const partId = parsePositiveId(part.partId);
            if (partId) {
                return !baselineIdentities.has(`part:${partId}`) && !allowedPartIds.has(partId);
            }
            if (baselineLegacyIdentities.has(legacyIdentity)) return false;
            return true;
        });
        if (invalid) {
            throw policyError(
                'RECIPE_CONFIGURATION_PACKING_NOT_ALLOWED',
                `包装“${invalid.model || '未命名'}”不在当前配方允许范围内`,
                422,
                { partId: parsePositiveId(invalid.partId), model: invalid.model || '' }
            );
        }
    }

    if (Object.prototype.hasOwnProperty.call(policy, 'surfaceTreatmentOptions')) {
        const nextMode = Object.prototype.hasOwnProperty.call(overrides, 'surfaceTreatmentMode')
            ? overrides.surfaceTreatmentMode
            : baseline.surfaceTreatmentMode;
        const nextCost = Object.prototype.hasOwnProperty.call(overrides, 'surfaceTreatmentCost')
            ? Number(overrides.surfaceTreatmentCost || 0)
            : Number(baseline.surfaceTreatmentCost || 0);
        if (nextMode !== baseline.surfaceTreatmentMode
            || nextCost !== Number(baseline.surfaceTreatmentCost || 0)) {
            const allowed = policy.surfaceTreatmentOptions.some(option => (
                option.mode === nextMode && Number(option.cost || 0) === nextCost
            ));
            if (!allowed) {
                throw policyError(
                    'RECIPE_CONFIGURATION_SURFACE_NOT_ALLOWED',
                    '表面处理方式或费用不在当前配方允许范围内',
                    422,
                    { mode: nextMode, cost: nextCost }
                );
            }
        }
    }
}

module.exports = {
    CONFIGURATION_POLICY_FIELD_TYPES,
    CONFIGURATION_POLICY_VERSION,
    assertRecipeConfigurationAllowed,
    normalizeRecipeConfigurationPolicy,
    recipeConfigurationPolicyFromRecord,
    stringifyRecipeConfigurationPolicy,
};
