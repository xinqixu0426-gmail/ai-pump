'use strict';

// N2.2 is a thin, read-only composition of the existing BOM and current-cost
// services.  It deliberately contains no pricing formula: both the base and
// every candidate use buildCurrentRecipeCostBasis and the registered BOM path.
const crypto = require('node:crypto');
const { buildCurrentRecipeCostBasis } = require('./currentRecipeCost.cjs');
const { applyRecipeBaseline, mergePackingSelection } = require('./recipeConfigurationBaseline.cjs');
const { recipeConfigurationPolicyFromRecord, assertRecipeConfigurationAllowed } = require('./recipeConfigurationPolicy.cjs');
const { inferPackagingSemantics } = require('./packagingSemantics.cjs');
const { canonicalJson, stableHash } = require('./stableJson.cjs');

const VERSION = 1;
const MAX_SCENARIOS = 3;
const MAX_SOURCE_VERSIONS = 128;
const MAX_RESULT_BYTES = 98_304;
const ALLOWED_OVERRIDES = new Set([
    'hasFloat', 'floatWire', 'floatAccessoryType',
    'hasCable', 'cableLength', 'cableWire', 'cableAccessoryType',
    'coilId', 'coilSheets', 'customBarrelLength',
    'packingParts', 'surfaceTreatmentMode', 'surfaceTreatmentCost',
]);
const PRICE_FIELDS = new Set([
    'unitCost', 'currentTotalCost', 'partsCost', 'coilCost', 'unitPrice',
    'partPrice', 'copperPrice', 'manualCost', 'price', 'totalCost',
]);
const SCENARIO_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/u;

class ScenarioComparisonError extends Error {
    constructor(code, message, statusCode = 400, details) {
        super(message || code);
        this.name = 'ScenarioComparisonError';
        this.code = code;
        this.statusCode = statusCode;
        if (details !== undefined) this.details = details;
    }
}

function fail(code, message, statusCode = 400, details) {
    throw new ScenarioComparisonError(code, message, statusCode, details);
}

function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function clone(value) {
    return structuredClone(value);
}

function finite(value, field, { positive = false, integer = false } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value)
        || (positive && value <= 0) || (integer && !Number.isInteger(value))) {
        fail('SCENARIO_COMPARE_INVALID_INPUT', `${field} 必须是${positive ? '正' : '有限'}${integer ? '整数' : '数字'}`);
    }
    return value;
}

const PACKING_ROLES = new Set(['container', 'pearlCotton', 'foam', 'fixed']);
const SURFACE_TREATMENT_MODES = new Set([
    'none', 'painting', 'electrophoresis', 'electrophoresis_powder_coating', 'powder_coating', 'custom',
]);

function normalizePackingParts(value) {
    if (!Array.isArray(value) || value.length > 12) {
        fail('SCENARIO_COMPARE_INVALID_INPUT', 'packingParts 必须是最多 12 项的数组');
    }
    const seen = new Set();
    return value.map((part, index) => {
        if (!part || typeof part !== 'object' || Array.isArray(part)) {
            fail('SCENARIO_COMPARE_INVALID_INPUT', `packingParts[${index}] 必须是对象`);
        }
        const unknown = Object.keys(part).filter(key => !['partId', 'model', 'supplier', 'qty', 'packingRole'].includes(key));
        if (unknown.length) fail('CLIENT_PRICE_FORBIDDEN', `packingParts[${index}] 包含不受支持的字段：${unknown.join('、')}`, 422);
        const partId = finite(part.partId, `packingParts[${index}].partId`, { positive: true, integer: true });
        const model = typeof part.model === 'string' ? part.model.trim() : '';
        const supplier = typeof part.supplier === 'string' ? part.supplier.trim() : '';
        const qty = finite(part.qty, `packingParts[${index}].qty`);
        const packingRole = typeof part.packingRole === 'string' ? part.packingRole : '';
        if (!model || model.length > 160 || supplier.length > 160 || !PACKING_ROLES.has(packingRole) || qty < 0) {
            fail('SCENARIO_COMPARE_INVALID_INPUT', `packingParts[${index}] 字段不合法`);
        }
        const identity = `${packingRole}:${partId}`;
        if (seen.has(identity)) fail('PACKING_PART_DUPLICATE', '同一正式包装零件不能重复出现', 422);
        seen.add(identity);
        return { partId, model, supplier, qty, packingRole };
    });
}

function normalizeSurfaceTreatment(raw, normalized) {
    if (own(raw, 'surfaceTreatmentMode')) {
        if (!SURFACE_TREATMENT_MODES.has(raw.surfaceTreatmentMode)) {
            fail('SCENARIO_COMPARE_INVALID_INPUT', 'surfaceTreatmentMode 不支持');
        }
        normalized.surfaceTreatmentMode = raw.surfaceTreatmentMode;
    }
    if (own(raw, 'surfaceTreatmentCost')) {
        normalized.surfaceTreatmentCost = finite(raw.surfaceTreatmentCost, 'surfaceTreatmentCost');
        if (normalized.surfaceTreatmentCost < 0) fail('SCENARIO_COMPARE_INVALID_INPUT', 'surfaceTreatmentCost 必须非负');
    }
    if (normalized.surfaceTreatmentMode === 'none' && own(normalized, 'surfaceTreatmentCost') && normalized.surfaceTreatmentCost !== 0) {
        fail('SURFACE_TREATMENT_COST_CONFLICT', '不做表面处理时费用必须为 0', 422);
    }
}

function normalizeOverrides(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        fail('SCENARIO_COMPARE_INVALID_INPUT', 'overrides 必须是对象');
    }
    const unknown = Object.keys(raw).filter(field => !ALLOWED_OVERRIDES.has(field));
    if (unknown.length) {
        const price = unknown.find(field => PRICE_FIELDS.has(field));
        fail(price ? 'CLIENT_PRICE_FORBIDDEN' : 'UNSUPPORTED_OVERRIDE_FIELD',
            `不支持的情景覆盖字段：${unknown.join('、')}`, 422, { fields: unknown });
    }
    const normalized = {};
    for (const [field, value] of Object.entries(raw)) {
        if (['hasFloat', 'hasCable'].includes(field)) {
            if (typeof value !== 'boolean') fail('SCENARIO_COMPARE_INVALID_INPUT', `${field} 必须是布尔值`);
            normalized[field] = value;
        } else if (['cableLength', 'customBarrelLength'].includes(field)) {
            normalized[field] = finite(value, field, { positive: field === 'customBarrelLength' });
        } else if (['coilId', 'coilSheets'].includes(field)) {
            normalized[field] = finite(value, field, { positive: true, integer: true });
        } else if (['floatAccessoryType', 'cableAccessoryType'].includes(field)) {
            if (!['standard', 'xinjie'].includes(value)) fail('SCENARIO_COMPARE_INVALID_INPUT', `${field} 不支持`);
            normalized[field] = value;
        } else if (field === 'packingParts' || field === 'surfaceTreatmentMode' || field === 'surfaceTreatmentCost') {
            // These are normalized below as a group so none/cost consistency is
            // checked even when object key ordering changes.
            continue;
        } else if (typeof value === 'string' && value.trim()) {
            normalized[field] = value.trim();
        } else {
            fail('SCENARIO_COMPARE_INVALID_INPUT', `${field} 不能为空`);
        }
    }
    if (own(raw, 'packingParts')) normalized.packingParts = normalizePackingParts(raw.packingParts);
    normalizeSurfaceTreatment(raw, normalized);
    if (own(normalized, 'coilSheets') && !own(normalized, 'coilId')) {
        fail('COIL_SHEETS_REQUIRES_COIL_ID', 'coilSheets 只能作为已选正式线圈的校验快照', 422);
    }
    return normalized;
}

function canonicalPackingParts(db, requested) {
    const nonFixedRoles = new Set();
    const seenIds = new Set();
    return requested.map((part) => {
        const row = db.prepare('SELECT * FROM parts WHERE id = ?').get(part.partId);
        if (!row) fail('PACKING_PART_NOT_FOUND', `包装零件 #${part.partId} 不存在`, 422);
        if (row.deleted_at) fail('PACKING_PART_NOT_ACTIVE', `包装零件 #${part.partId} 已停用`, 422);
        if (String(row.category || '') !== '包装') fail('PACKING_PART_CATEGORY_INVALID', `零件 #${part.partId} 不是包装零件`, 422);
        const model = String(row.model || '').trim();
        const supplier = String(row.supplier || '').trim();
        if (part.model !== model || part.supplier !== supplier) {
            fail('PACKING_IDENTITY_MISMATCH', `包装零件 #${part.partId} 的型号或供应商与正式目录不一致`, 422);
        }
        const formal = inferPackagingSemantics({ ...row, model, supplier });
        if (formal.packingRole !== part.packingRole) {
            fail('PACKING_ROLE_MISMATCH', `包装零件 #${part.partId} 的角色与正式包装语义不一致`, 422);
        }
        if (part.packingRole !== 'fixed') {
            if (nonFixedRoles.has(part.packingRole)) fail('PACKING_ROLE_DUPLICATE', `${part.packingRole} 角色只能有一个包装零件`, 422);
            nonFixedRoles.add(part.packingRole);
        }
        if (seenIds.has(part.partId)) fail('PACKING_PART_DUPLICATE', `包装零件 #${part.partId} 重复`, 422);
        seenIds.add(part.partId);
        return { partId: part.partId, model, supplier, qty: part.qty, packingRole: formal.packingRole, packagingMaterial: formal.packagingMaterial };
    });
}

function effectiveSurfaceOverrides(baseConfig, requested, policy) {
    const effective = { ...requested };
    const modeRequested = own(requested, 'surfaceTreatmentMode');
    const costRequested = own(requested, 'surfaceTreatmentCost');
    const targetMode = modeRequested ? requested.surfaceTreatmentMode : baseConfig.surfaceTreatmentMode;
    if (targetMode === 'none') {
        if (costRequested && requested.surfaceTreatmentCost !== 0) fail('SURFACE_TREATMENT_COST_CONFLICT', '不做表面处理时费用必须为 0', 422);
        effective.surfaceTreatmentCost = 0;
        return effective;
    }
    if (modeRequested && !costRequested && targetMode !== baseConfig.surfaceTreatmentMode) {
        if (own(policy || {}, 'surfaceTreatmentOptions')) {
            const option = policy.surfaceTreatmentOptions.find(item => item.mode === targetMode);
            if (!option) {
                fail('RECIPE_CONFIGURATION_SURFACE_NOT_ALLOWED', '表面处理方式不在当前配方允许范围内', 422, { mode: targetMode });
            }
            effective.surfaceTreatmentCost = Number(option.cost);
        } else {
            fail('SURFACE_TREATMENT_COST_REQUIRED', '新表面处理方式没有正式费用政策，需要明确费用或正式政策', 422);
        }
    }
    return effective;
}

function normalizeInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('SCENARIO_COMPARE_INVALID_INPUT', '请求体必须是对象');
    const unknown = Object.keys(input).filter(key => !['version', 'baselinePolicy', 'scenarios'].includes(key));
    if (unknown.length) fail('SCENARIO_COMPARE_INVALID_INPUT', `请求包含未知字段：${unknown.join('、')}`);
    if (input.version !== VERSION) fail('SCENARIO_COMPARE_VERSION_UNSUPPORTED', 'version 必须为 1');
    if (input.baselinePolicy !== 'CURRENT_REBUILT') fail('SCENARIO_COMPARE_BASELINE_UNSUPPORTED', 'baselinePolicy 仅支持 CURRENT_REBUILT');
    if (!Array.isArray(input.scenarios) || input.scenarios.length > MAX_SCENARIOS) {
        fail('SCENARIO_COMPARE_INVALID_INPUT', `scenarios 必须包含 0 到 ${MAX_SCENARIOS} 项`);
    }
    const keys = new Set();
    return {
        version: VERSION,
        baselinePolicy: 'CURRENT_REBUILT',
        scenarios: input.scenarios.map((scenario, index) => {
            if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) fail('SCENARIO_COMPARE_INVALID_INPUT', `scenarios[${index}] 必须是对象`);
            const extras = Object.keys(scenario).filter(key => !['scenarioKey', 'label', 'overrides'].includes(key));
            if (extras.length) fail('SCENARIO_COMPARE_INVALID_INPUT', `scenarios[${index}] 含未知字段：${extras.join('、')}`);
            const scenarioKey = String(scenario.scenarioKey || '');
            const label = String(scenario.label || '');
            if (!SCENARIO_KEY.test(scenarioKey) || scenarioKey.toLowerCase() === 'base') {
                fail('SCENARIO_KEY_INVALID', 'scenarioKey 必须合法且不能使用保留 key base');
            }
            if (keys.has(scenarioKey.toLowerCase())) fail('SCENARIO_KEY_DUPLICATE', `scenarioKey 重复：${scenarioKey}`);
            keys.add(scenarioKey.toLowerCase());
            if (!label || label.length > 80) fail('SCENARIO_COMPARE_INVALID_INPUT', 'label 长度必须为 1 到 80');
            return { scenarioKey, label, overrides: normalizeOverrides(scenario.overrides) };
        }),
    };
}

function sourceVersion(entityType, row) {
    const id = row?.id ?? row?.key;
    return {
        entityType,
        entityId: String(id),
        updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : (typeof row?.updatedAt === 'string' ? row.updatedAt : null),
        contentHash: stableHash(row),
    };
}

function canonicalRecipe(recipe, rawRecipe) {
    return {
        entityType: 'recipe',
        entityId: String(recipe.id),
        displayName: String(recipe.name || '').trim(),
        updatedAt: recipe.updatedAt || rawRecipe.updated_at || null,
        recordHash: stableHash(rawRecipe),
        schemeCode: null,
    };
}

function configuration(recipe) {
    const surfaceTreatmentMode = recipe.surfaceTreatmentMode || 'none';
    return {
        hasFloat: Boolean(recipe.hasFloat), floatWire: recipe.floatWire || '', floatAccessoryType: recipe.floatAccessoryType || 'standard',
        hasCable: Boolean(recipe.hasCable), cableLength: Number(recipe.cableLength || 0), cableWire: recipe.cableWire || '', cableAccessoryType: recipe.cableAccessoryType || 'standard',
        coilId: recipe.coilId ?? null, coilSchemeFamilyCode: recipe.coilSchemeFamilyCode || '', coilSpec: recipe.coilSpec || '',
        coilSheets: Number(recipe.coilSheets || 0), coilMaterial: recipe.coilMaterial || '钢带', coilSlotType: recipe.coilSlotType || '小眼',
        customBarrelLength: recipe.customBarrelLength ?? null, packingPartsJson: recipe.packingPartsJson || '[]',
        surfaceTreatmentMode, surfaceTreatmentCost: surfaceTreatmentMode === 'none' ? 0 : Number(recipe.surfaceTreatmentCost || 0),
    };
}

function equivalent(left, right) {
    return canonicalJson(left) === canonicalJson(right);
}

function configurationChanges(base, candidate) {
    return Object.keys(base).filter(field => !equivalent(base[field], candidate[field])).map(field => ({
        field, before: base[field], after: candidate[field],
    }));
}

function costView(basis, basisName) {
    return {
        complete: basis.costComplete,
        currentTotalCost: basis.costComplete ? basis.partialTotalCost : null,
        partialTotalCost: basis.partialTotalCost ?? null,
        currency: 'CNY', unit: 'pump', costBasis: basisName,
        missingParts: [...(basis.missingParts || [])], sourceOfTruth: 'costEngine',
    };
}

function makeScenarioRecipe(baseRecipe, baseConfig, overrides, coils, catalog = [], db = null) {
    const applied = {};
    const notApplied = [];
    const policy = recipeConfigurationPolicyFromRecord(baseRecipe);
    const effectiveOverrides = {};
    const enabled = (flag) => own(overrides, flag) ? overrides[flag] === true : Boolean(baseConfig[flag]);
    const dependentGroups = [
        { flag: 'hasCable', fields: ['cableLength', 'cableWire', 'cableAccessoryType'], code: 'CABLE_NOT_ENABLED' },
        { flag: 'hasFloat', fields: ['floatWire', 'floatAccessoryType'], code: 'FLOAT_NOT_ENABLED' },
    ];
    for (const [field, value] of Object.entries(overrides)) {
        const dependency = dependentGroups.find(group => group.fields.includes(field));
        if (dependency && !enabled(dependency.flag)) {
            notApplied.push({
                field,
                reasonCode: dependency.code,
                message: `${field} 依赖 ${dependency.flag}=true，当前情景未启用该配置`,
            });
            continue;
        }
        effectiveOverrides[field] = value;
    }
    if (own(effectiveOverrides, 'packingParts')) {
        if (!db) fail('SCENARIO_COMPARE_INTERNAL', '包装正式身份校验缺少数据库依赖', 500);
        effectiveOverrides.packingParts = canonicalPackingParts(db, effectiveOverrides.packingParts);
    }
    const appliedSurface = effectiveSurfaceOverrides(baseConfig, effectiveOverrides, policy);
    const policyOverrides = {
        ...appliedSurface,
        ...(own(appliedSurface, 'packingParts') ? { packingPartsJson: JSON.stringify(appliedSurface.packingParts) } : {}),
    };
    assertRecipeConfigurationAllowed({ baseline: baseConfig, overrides: policyOverrides, policy });
    const { input } = applyRecipeBaseline(baseRecipe, appliedSurface, catalog);
    if (own(appliedSurface, 'packingParts')) {
        // `buildCurrentRecipeBomInput` intentionally filters unusable saved
        // parts for general BOM reconstruction.  For an explicit packaging
        // patch, the formal baseline selection itself is authoritative: merge
        // against it so unrelated fixed inserts retain their role identity.
        const baselinePacking = JSON.parse(baseConfig.packingPartsJson || '[]');
        input.packingParts = mergePackingSelection(baselinePacking, appliedSurface.packingParts);
    }
    const next = { ...baseRecipe, ...input };
    for (const [field, value] of Object.entries(appliedSurface)) {
        if (field === 'coilId') {
            const coil = coils.find(item => Number(item.id) === value);
            if (!coil || String(coil.schemeStatus || 'official') !== 'official') {
                fail('COIL_SCHEME_NOT_FOUND', '所选线圈方案不存在或不是正式方案', 422);
            }
            if (own(overrides, 'coilSheets') && Number(coil.sheets) !== overrides.coilSheets) {
                fail('COIL_SHEETS_MISMATCH', `线圈 #${value} 的正式片数为 ${coil.sheets}`, 422);
            }
            // Replacement clears all old scheme identity and rehydrates the actual
            // candidate from the formal coil record.  This prevents partial merges.
            Object.assign(next, {
                coilId: coil.id, coilSpec: coil.spec, coilSheets: Number(coil.sheets), coilMaterial: coil.material,
                coilSlotType: coil.slotType, coilSchemeFamilyCode: coil.schemeFamilyCode || '', coilWireWeight: coil.wireWeight ?? null,
            });
            applied.coilId = coil.id;
            if (own(overrides, 'coilSheets')) applied.coilSheets = coil.sheets;
        } else if (field !== 'coilSheets' && field !== 'surfaceTreatmentCost') {
            next[field] = value;
            applied[field] = value;
        }
    }
    if (own(appliedSurface, 'packingParts')) {
        next.packingParts = input.packingParts;
        next.packingPartsJson = JSON.stringify(input.packingParts);
        applied.packingParts = appliedSurface.packingParts;
    }
    if (own(appliedSurface, 'surfaceTreatmentMode')) {
        next.surfaceTreatmentMode = appliedSurface.surfaceTreatmentMode;
        applied.surfaceTreatmentMode = appliedSurface.surfaceTreatmentMode;
    }
    if (own(appliedSurface, 'surfaceTreatmentCost')) {
        next.surfaceTreatmentCost = appliedSurface.surfaceTreatmentCost;
        // A policy-derived companion cost is a formal input to the business
        // preview, not a user-requested override.
        if (own(overrides, 'surfaceTreatmentCost')) applied.surfaceTreatmentCost = appliedSurface.surfaceTreatmentCost;
    }
    return { recipe: next, applied, notApplied };
}

function usedPartIdsFromBom(bom) {
    return new Set((bom?.parts || []).map(part => Number(part?.partId)).filter(Number.isSafeInteger));
}

function sourceRowsForReadSet(db, rawRecipe, scenarios, boms) {
    const partIds = new Set();
    for (const bom of boms) for (const partId of usedPartIdsFromBom(bom)) partIds.add(partId);
    const coilIds = new Set(scenarios
        .map(scenario => Number(scenario.recipe?.coilId ?? scenario.configuration?.coilId))
        .filter(Number.isSafeInteger));
    const settings = new Set();
    if (rawRecipe.management_fee == null) settings.add('management_fee');
    if (scenarios.some(scenario => Boolean(scenario.recipe?.hasFloat)
        && scenario.recipe.floatAccessoryType === 'xinjie')) settings.add('float_accessory_delta');
    if (scenarios.some(scenario => Boolean(scenario.recipe?.hasCable))) settings.add('cable_accessories');
    const selectMany = (table, ids, column = 'id') => [...ids].sort((a, b) => Number(a) - Number(b))
        .map(id => db.prepare(`SELECT * FROM ${table} WHERE ${column} = ?`).get(id))
        .filter(Boolean);
    return [
        sourceVersion('recipe', rawRecipe),
        ...(rawRecipe.template_id ? (() => {
            const template = db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(rawRecipe.template_id);
            return template ? [sourceVersion('template', template)] : [];
        })() : []),
        ...selectMany('parts', partIds).map(row => sourceVersion('part', row)),
        ...selectMany('coils', coilIds).map(row => sourceVersion('coil', row)),
        ...selectMany('system_settings', settings, 'key').map(row => sourceVersion('setting', row)),
    ].sort((a, b) => `${a.entityType}:${a.entityId}`.localeCompare(`${b.entityType}:${b.entityId}`));
}

function createRecipeScenarioComparison(dependencies = {}) {
    const { db, recipeRow, listCoils, loadPartsData, calculateRecipeCost, getSetting, getBomDraft } = dependencies;
    for (const [name, dependency] of Object.entries({ db, recipeRow, listCoils, loadPartsData, calculateRecipeCost, getSetting, getBomDraft })) {
        if (!dependency) throw new Error(`recipeScenarioComparison 缺少 ${name}`);
    }

    function compare(rawRecipeId, rawInput) {
        const recipeId = Number(rawRecipeId);
        if (!Number.isSafeInteger(recipeId) || recipeId < 1) fail('SCENARIO_COMPARE_RECIPE_ID_INVALID', '配方 ID 不合法');
        const normalizedInput = normalizeInput(rawInput);
        return db.transaction(() => {
            const rawRecipe = db.prepare('SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL').get(recipeId);
            if (!rawRecipe) fail('RECIPE_NOT_FOUND', `配方 #${recipeId} 不存在`, 404);
            const recipe = recipeRow(rawRecipe);
            const coils = listCoils();
            const { partsCache, partsByModel } = loadPartsData();
            const baseConfig = configuration(recipe);
            // `none` has a single formal cost representation: 0.  Construct
            // both sides from that same normalized configuration so the
            // scenario preview cannot disagree with current-cost semantics.
            const baseRecipe = { ...recipe, ...baseConfig };
            const baseBom = getBomDraft({ ...applyRecipeBaseline(baseRecipe, {}, Object.values(partsByModel).flat()).input, requireStablePartIdentity: true });
            const shared = { partsCache, partsByModel, calculateRecipeCost, coils, getSetting };
            const compute = (scenarioRecipe, bom) => buildCurrentRecipeCostBasis(scenarioRecipe, {
                ...shared, buildBomDraft: () => ({ parts: bom.parts }),
            });
            const baseBasis = compute(baseRecipe, baseBom);
            const scenarioRecipes = [baseRecipe];
            const scenarioBoms = [baseBom];
            const scenarios = [{
                scenarioKey: 'base', role: 'BASE', label: '当前正式配置',
                configuration: baseConfig, configurationHash: stableHash(baseConfig), requestedOverrides: {}, appliedOverrides: {}, notApplied: [],
                inheritedFields: Object.keys(baseConfig), cost: costView(baseBasis, 'CURRENT_REBUILT_BASE'),
            }];
            for (const requested of normalizedInput.scenarios) {
                const next = makeScenarioRecipe(baseRecipe, baseConfig, requested.overrides, coils, Object.values(partsByModel).flat(), db);
                const bomInput = applyRecipeBaseline(baseRecipe, next.recipe, Object.values(partsByModel).flat()).input;
                const bom = getBomDraft({ ...bomInput, requireStablePartIdentity: true });
                const candidateConfig = configuration(next.recipe);
                scenarioRecipes.push(next.recipe);
                scenarioBoms.push(bom);
                scenarios.push({
                    scenarioKey: requested.scenarioKey, role: 'CANDIDATE', label: requested.label,
                    configuration: candidateConfig, configurationHash: stableHash(candidateConfig),
                    requestedOverrides: clone(requested.overrides), appliedOverrides: next.applied, notApplied: next.notApplied,
                    inheritedFields: Object.keys(baseConfig).filter(field => !own(next.applied, field)),
                    cost: costView(compute(next.recipe, bom), 'CURRENT_REBUILT_SCENARIO'),
                });
            }
            const changes = [];
            const comparisons = scenarios.slice(1).map((candidate, index) => {
                const base = scenarios[0];
                const scenarioChanges = configurationChanges(base.configuration, candidate.configuration)
                    .map(change => ({ scenarioKey: candidate.scenarioKey, field: change.field, from: change.before, to: change.after }));
                const changePointers = scenarioChanges.map(change => {
                    const pointer = `/changes/${changes.length}`;
                    changes.push(change);
                    return pointer;
                });
                const comparable = candidate.notApplied.length === 0 && base.cost.complete && candidate.cost.complete;
                const status = candidate.notApplied.length ? 'OVERRIDE_NOT_APPLIED' : comparable ? 'COMPARABLE' : 'INCOMPLETE';
                const delta = comparable ? Math.round((candidate.cost.currentTotalCost - base.cost.currentTotalCost) * 100) / 100 : null;
                const candidateIndex = index + 1;
                return {
                    baseScenarioKey: 'base', candidateScenarioKey: candidate.scenarioKey, status, delta, currency: 'CNY',
                    drivers: scenarioChanges.length && comparable ? [{
                        costRole: 'configuration', description: scenarioChanges.map(change => change.field).join('、'), delta,
                        sourcePointers: [`/scenarios/0/cost/currentTotalCost`, `/scenarios/${candidateIndex}/cost/currentTotalCost`, ...changePointers],
                    }] : [],
                };
            });
            const readSetScenarios = scenarios.map((scenario, index) => ({
                recipe: scenarioRecipes[index], configuration: scenario.configuration,
            }));
            const versions = sourceRowsForReadSet(db, rawRecipe, readSetScenarios, scenarioBoms);
            const result = {
                version: VERSION, preview: true, comparisonId: crypto.randomUUID(),
                recipe: canonicalRecipe(recipe, rawRecipe),
                normalizedInput, readSetId: crypto.randomUUID(), readSetHash: stableHash(versions), calculatedAt: new Date().toISOString(),
                sourceVersions: versions.slice(0, MAX_SOURCE_VERSIONS), sourceVersionCount: versions.length,
                sourceVersionsComplete: versions.length <= MAX_SOURCE_VERSIONS,
                scenarios, comparisons, changes,
                warnings: [],
            };
            const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
            if (bytes > MAX_RESULT_BYTES) fail('PAYLOAD_LIMIT', '情景比较结果超过安全输出上限，未返回不完整结果', 422, { bytes, maxBytes: MAX_RESULT_BYTES });
            return result;
        })();
    }
    return Object.freeze({ compare });
}

module.exports = {
    ALLOWED_OVERRIDES, MAX_RESULT_BYTES, ScenarioComparisonError,
    createRecipeScenarioComparison, makeScenarioRecipe, normalizeScenarioCompareInput: normalizeInput,
};
