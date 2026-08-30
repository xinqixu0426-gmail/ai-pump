const {
    createPartPriceGetter,
    configuredWireModel,
    lengthPricedPartSubtotal,
    buildRecipeCostDraft,
    calculateCompleteCableCost,
} = require('./costEngine.cjs');
const {
    DEFAULT_COIL_MATERIAL,
    calculateCoilCost,
    resolveWireFromCoils,
} = require('./coilCost.cjs');
const { inferPackagingSemantics } = require('./packagingSemantics.cjs');
const { inferLegacyBomCostRole, normalizeBomRoles } = require('./bomRoles.cjs');
const {
    bindStableBomPartIdentities,
    partIdOf,
    resolveCatalogPartIdentity,
} = require('./bomPartIdentity.cjs');
const { resolveCapacitorModel } = require('./recipeBomEngine.cjs');
const {
    buildStainlessShaftJointBomPart,
    resolveStainlessShaftJointConfiguration,
} = require('./rotorShaftJoint.cjs');

// 报价覆盖试算口径：以配方保存快照为基线，只重算 overrides 涉及的动态项。
// 这里的结果用于报价/试算，不应反向改写配方 savedTotalCost。

function toBool(v) {
    return v === true || v === 1 || v === '1';
}

function sameNumber(a, b) {
    return Number(a || 0) === Number(b || 0);
}

function sameText(a, b) {
    return String(a || '') === String(b || '');
}

function getOverride(overrides, camelKey, snakeKey, fallback) {
    if (overrides?.[camelKey] !== undefined) return overrides[camelKey];
    if (overrides?.[snakeKey] !== undefined) return overrides[snakeKey];
    return fallback;
}

function inferPackingRole(part = {}) {
    return inferPackagingSemantics(part).packingRole;
}

function normalizePackingJsonText(value, boxType) {
    let list = [];
    try {
        list = JSON.parse(value || '[]');
    } catch {
        list = [];
    }
    if ((!Array.isArray(list) || list.length === 0) && boxType) {
        list = [{ model: boxType, supplier: '', qty: 1 }];
    }
    if (!Array.isArray(list)) list = [];
    return JSON.stringify(list
        .filter(part => part?.model)
        .map(part => {
            const normalized = {
                model: part.model,
                supplier: part.supplier || '',
                qty: Number(part.qty || 1)
            };
            if (part.snapshotPrice !== undefined) normalized.snapshotPrice = Number(part.snapshotPrice || 0);
            if (part.costSource === 'manual') normalized.costSource = 'manual';
            if (part.packagingMaterial) normalized.packagingMaterial = String(part.packagingMaterial);
            normalized.packingRole = inferPackingRole(part);
            return normalized;
        }));
}

function managedPartType(part) {
    return part?.costRole || inferLegacyBomCostRole(part);
}

function partSnapshotSubtotal(part, partsCache, partsByModel, calculateRecipeCost) {
    if (part?.snapshotPrice !== undefined) return Number(part.snapshotPrice || 0) * Number(part.qty || 0);
    return Number(calculateRecipeCost([part], partsCache, partsByModel).totalCost || 0);
}

function getFloatAccessoryDelta(getSetting, accessoryType = 'standard') {
    if (accessoryType !== 'xinjie') return 0;
    const delta = Number(getSetting('float_accessory_delta'));
    return Number.isFinite(delta) && delta >= 0 ? delta : 0;
}

function findBoxPrice(boxType, getPrice, partsCache) {
    if (!boxType) return 0;
    let price = getPrice(boxType);
    if (price !== 0) return price;
    const kw = String(boxType).trim();
    const cands = [];
    for (const [m, info] of Object.entries(partsCache)) {
        if (info.category === '包装' && m.includes(kw)) cands.push({ model: m, price: info.price });
    }
    return cands.length > 0 ? cands.reduce((min, c) => c.price < min.price ? c : min, cands[0]).price : 0;
}

function calculatePackingPartsCost(packingPartsJson, getPrice, partsCatalog = []) {
    let packingParts = [];
    try { packingParts = JSON.parse(packingPartsJson || '[]'); } catch { packingParts = []; }
    return packingParts.reduce((sum, part) => {
        if (!part?.model) return sum;
        const matched = resolveCatalogPartIdentity(partsCatalog, part, { field: 'packingPartsJson' });
        const price = part.snapshotPrice !== undefined
            ? Number(part.snapshotPrice || 0)
            : Number(matched?.price ?? getPrice(part.model));
        return sum + price * Number(part.qty || 1);
    }, 0);
}

function calculateCoilCostSnapshot(spec, sheets, material = DEFAULT_COIL_MATERIAL, slotType = '小眼', getCoils = () => [], options = {}) {
    if (!spec || !sheets) return { success: false, error: '线圈规格和片数不能为空' };
    return calculateCoilCost(getCoils(), { spec, sheets, material, slotType, ...options });
}

function resolveWire(dbWire, explicitWire) {
    if (explicitWire) return explicitWire;
    if (dbWire) return dbWire;
    return '0.55';
}

function buildRecipeData(row, overrides = {}) {
    return {
        id: row.id,
        name: row.name,
        parts_json: row.parts_json,
        template_id: row.template_id,
        coil_id: getOverride(overrides, 'coilId', 'coil_id', row.coil_id),
        coil_spec: getOverride(overrides, 'coilSpec', 'coil_spec', row.coil_spec),
        coil_sheets: Number(getOverride(overrides, 'coilSheets', 'coil_sheets', row.coil_sheets)),
        coil_material: getOverride(overrides, 'coilMaterial', 'coil_material', row.coil_material || DEFAULT_COIL_MATERIAL),
        coil_slot_type: getOverride(overrides, 'coilSlotType', 'coil_slot_type', row.coil_slot_type || '小眼'),
        has_float: getOverride(overrides, 'hasFloat', 'has_float', row.has_float),
        float_wire: getOverride(overrides, 'floatWire', 'float_wire', row.float_wire),
        float_accessory_type: getOverride(overrides, 'floatAccessoryType', 'float_accessory_type', row.float_accessory_type || 'standard'),
        has_cable: getOverride(overrides, 'hasCable', 'has_cable', row.has_cable),
        cable_length: Number(getOverride(overrides, 'cableLength', 'cable_length', row.cable_length)),
        cable_wire: getOverride(overrides, 'cableWire', 'cable_wire', row.cable_wire),
        cable_accessory_type: getOverride(overrides, 'cableAccessoryType', 'cable_accessory_type', row.cable_accessory_type || 'standard'),
        box_type: getOverride(overrides, 'boxType', 'box_type', row.box_type),
        packing_parts_json: getOverride(overrides, 'packingPartsJson', 'packing_parts_json', row.packing_parts_json),
        custom_barrel_length: (() => {
            const value = getOverride(overrides, 'customBarrelLength', 'custom_barrel_length', row.custom_barrel_length);
            return value != null ? Number(value) : value;
        })(),
        extra_parts_json: getOverride(overrides, 'extraPartsJson', 'extra_parts_json', row.extra_parts_json),
        assembly_wage: row.assembly_wage,
        packing_wage: row.packing_wage,
        painting_wage: row.painting_wage,
        surface_treatment_mode: getOverride(
            overrides,
            'surfaceTreatmentMode',
            'surface_treatment_mode',
            row.surface_treatment_mode || (row.painting_wage != null ? 'painting' : 'none')
        ),
        surface_treatment_cost: Number(getOverride(
            overrides,
            'surfaceTreatmentCost',
            'surface_treatment_cost',
            row.surface_treatment_cost != null ? row.surface_treatment_cost : (row.painting_wage != null ? row.painting_wage : 0)
        )),
        management_fee: row.management_fee,
        has_stainless_shaft_joint: getOverride(
            overrides,
            'hasStainlessShaftJoint',
            'has_stainless_shaft_joint',
            false
        ),
        stainless_shaft_joint_cost: getOverride(
            overrides,
            'stainlessShaftJointCost',
            'stainless_shaft_joint_cost',
            undefined
        ),
    };
}

function buildPackingSnapshotParts(packingPartsJson, partsCatalog) {
    let packingParts = [];
    try { packingParts = JSON.parse(packingPartsJson || '[]'); } catch { packingParts = []; }
    return packingParts
        .filter(part => part?.model)
        .map(part => {
            const matched = resolveCatalogPartIdentity(partsCatalog, part, { field: 'packingPartsJson' });
            const snapshotPrice = part.snapshotPrice !== undefined
                ? Number(part.snapshotPrice || 0)
                : Number(matched?.price || 0);
            return {
                ...part,
                partId: partIdOf(matched),
                model: String(part.model),
                name: String(part.name || part.model),
                supplier: String(part.supplier || matched?.supplier || ''),
                qty: Number(part.qty || 1),
                snapshotPrice,
                packingRole: inferPackingRole(part),
            };
        });
}

function calculateRecipeCostPreview(row, overrides = {}, dependencies = {}) {
    const {
        partsCache = {},
        partsByModel = {},
        partsCatalog = Object.values(partsByModel).flat(),
        calculateRecipeCost,
        getCoils = () => [],
        getSetting = () => undefined,
    } = dependencies;
    if (typeof calculateRecipeCost !== 'function') throw new Error('calculateRecipeCost dependency is required');

    const recipeData = buildRecipeData(row, overrides);
    const shaftJointConfiguration = resolveStainlessShaftJointConfiguration({
        hasStainlessShaftJoint: recipeData.has_stainless_shaft_joint,
        stainlessShaftJointCost: recipeData.stainless_shaft_joint_cost,
    }, getSetting);
    recipeData.has_stainless_shaft_joint = shaftJointConfiguration.hasStainlessShaftJoint ? 1 : 0;
    recipeData.stainless_shaft_joint_cost = shaftJointConfiguration.stainlessShaftJointCost;
    recipeData.rotor_shaft_process = shaftJointConfiguration.rotorShaftProcess;
    const parsedParts = JSON.parse(recipeData.parts_json || '[]');
    const longScrewPart = parsedParts.find(part => managedPartType(part) === 'longScrew');
    const refreshedPartsDraft = buildRecipeCostDraft({
        parts: parsedParts,
        customBarrelLength: recipeData.custom_barrel_length,
        longScrewExtraLength: longScrewPart?.longScrewExtraLength,
    }, { partsCatalog });
    const pricedParts = refreshedPartsDraft.parts;
    const getPrice = createPartPriceGetter(partsByModel);

    const managedTotals = { coil: 0, capacitor: 0, float: 0, cable: 0, packing: 0, barrelLength: 0, longScrew: 0, stainlessShellBundle: 0, rotorProcess: 0 };
    let longScrewTotal = 0;
    let stainlessShellBundleTotal = 0;
    const lengthPricedParts = [];
    for (const part of parsedParts) {
        const type = managedPartType(part);
        if (type === 'barrelLength') lengthPricedParts.push(part);
        if (Object.prototype.hasOwnProperty.call(managedTotals, type)) {
            managedTotals[type] += partSnapshotSubtotal(part, partsCache, partsByModel, calculateRecipeCost);
        }
    }
    for (const part of pricedParts) {
        if (managedPartType(part) === 'longScrew') {
            longScrewTotal += partSnapshotSubtotal(part, partsCache, partsByModel, calculateRecipeCost);
        }
        if (managedPartType(part) === 'stainlessShellBundle') {
            stainlessShellBundleTotal += partSnapshotSubtotal(part, partsCache, partsByModel, calculateRecipeCost);
        }
    }

    const savedBaseCost = Number(row.saved_total_cost || 0);
    const hasSavedBase = savedBaseCost > 0;
    const partsResult = calculateRecipeCost(pricedParts, partsCache, partsByModel);
    let totalCost = hasSavedBase ? savedBaseCost : Number(partsResult.totalCost || 0);
    totalCost -= managedTotals.coil + managedTotals.capacitor + managedTotals.float + managedTotals.cable + managedTotals.packing + managedTotals.barrelLength + managedTotals.longScrew + managedTotals.stainlessShellBundle;

    const dbWire = resolveWireFromCoils(getCoils(), recipeData.coil_spec, recipeData.coil_sheets, recipeData.coil_material, recipeData.coil_slot_type, { coilId: recipeData.coil_id });
    const resolvedWire = resolveWire(dbWire, recipeData.cable_wire || recipeData.float_wire);

    const coilChanged = !sameNumber(recipeData.coil_id, row.coil_id) || !sameText(recipeData.coil_spec, row.coil_spec) || !sameNumber(recipeData.coil_sheets, row.coil_sheets) || !sameText(recipeData.coil_material, row.coil_material || DEFAULT_COIL_MATERIAL) || !sameText(recipeData.coil_slot_type, row.coil_slot_type || '小眼');
    const floatChanged = toBool(recipeData.has_float) !== toBool(row.has_float) || !sameText(recipeData.float_wire, row.float_wire) || !sameText(recipeData.float_accessory_type, row.float_accessory_type || 'standard');
    const cableChanged = toBool(recipeData.has_cable) !== toBool(row.has_cable) || !sameNumber(recipeData.cable_length, row.cable_length) || !sameText(recipeData.cable_wire, row.cable_wire) || !sameText(recipeData.cable_accessory_type, row.cable_accessory_type || 'standard');
    const packingJsonChanged = normalizePackingJsonText(recipeData.packing_parts_json, recipeData.box_type) !== normalizePackingJsonText(row.packing_parts_json, row.box_type);
    const boxChanged = !sameText(recipeData.box_type, row.box_type) || packingJsonChanged;
    const baseSurfaceMode = row.surface_treatment_mode || (row.painting_wage != null ? 'painting' : 'none');
    const baseSurfaceCost = baseSurfaceMode === 'none'
        ? 0
        : Number(row.surface_treatment_cost != null ? row.surface_treatment_cost : (row.painting_wage || 0));
    const effectiveSurfaceCost = recipeData.surface_treatment_mode === 'none' ? 0 : Number(recipeData.surface_treatment_cost || 0);
    const surfaceChanged = !sameText(recipeData.surface_treatment_mode, baseSurfaceMode)
        || !sameNumber(effectiveSurfaceCost, baseSurfaceCost);
    const coilCalculation = coilChanged
        ? calculateCoilCostSnapshot(
            recipeData.coil_spec,
            recipeData.coil_sheets,
            recipeData.coil_material,
            recipeData.coil_slot_type,
            getCoils,
            { coilId: recipeData.coil_id }
        )
        : null;
    if (coilChanged && (!coilCalculation?.success || Number(coilCalculation.data?.totalCost || 0) <= 0)) {
        const error = new Error(coilCalculation?.error || '线圈配置无法生成有效成本');
        error.statusCode = 422;
        error.code = 'COIL_CONFIGURATION_UNPRICED';
        throw error;
    }
    const cableModel = configuredWireModel('电缆', recipeData.cable_wire, resolvedWire);
    const cableCatalogPart = cableChanged && toBool(recipeData.has_cable)
        ? resolveCatalogPartIdentity(partsCatalog, { model: cableModel }, { field: 'cableWire' })
        : null;
    const cableOverridePart = cableCatalogPart
        ? calculateCompleteCableCost({
            model: cableModel,
            supplier: cableCatalogPart.supplier,
            cableLength: recipeData.cable_length,
            cableAccessoryType: recipeData.cable_accessory_type,
        }, {
            partsCatalog,
            partsByModel,
            getSetting,
        })
        : null;

    const nextCapacitorModel = coilChanged
        ? resolveCapacitorModel(partsCatalog, '', coilCalculation?.data)
        : '';
    const nextCapacitorPart = nextCapacitorModel
        ? resolveCatalogPartIdentity(partsCatalog, { model: nextCapacitorModel }, { field: 'coilSheets' })
        : null;
    const nextCapacitorCost = nextCapacitorPart
        ? Number(nextCapacitorPart.price || 0)
        : managedTotals.capacitor;
    const floatOverridePart = floatChanged && toBool(recipeData.has_float)
        ? resolveCatalogPartIdentity(partsCatalog, {
            model: configuredWireModel('浮球', recipeData.float_wire, resolvedWire),
        }, { field: 'floatWire' })
        : null;
    const floatOverridePrice = floatOverridePart
        ? Number(floatOverridePart.price || 0)
            + getFloatAccessoryDelta(getSetting, recipeData.float_accessory_type)
        : 0;
    totalCost += coilChanged
        ? Number(coilCalculation.data.totalCost || 0) + nextCapacitorCost
        : managedTotals.coil + managedTotals.capacitor;

    if (!floatChanged) {
        totalCost += managedTotals.float;
    } else if (toBool(recipeData.has_float)) {
        totalCost += floatOverridePrice;
    }

    if (!cableChanged) {
        totalCost += managedTotals.cable;
    } else if (cableOverridePart) {
        totalCost += cableOverridePart.snapshotPrice;
    }

    totalCost += shaftJointConfiguration.stainlessShaftJointCost;

    totalCost += boxChanged
        ? (calculatePackingPartsCost(recipeData.packing_parts_json, getPrice, partsCatalog) || findBoxPrice(recipeData.box_type, getPrice, partsCache))
        : managedTotals.packing;

    totalCost += lengthPricedParts.reduce((sum, part) => sum + lengthPricedPartSubtotal(part, recipeData.custom_barrel_length), 0);
    totalCost += longScrewTotal;
    totalCost += stainlessShellBundleTotal;

    if (hasSavedBase && surfaceChanged) {
        totalCost += effectiveSurfaceCost - baseSurfaceCost;
    }

    if (!hasSavedBase) {
        totalCost += Number(recipeData.assembly_wage || 0);
        totalCost += Number(recipeData.packing_wage || 0);
        totalCost += effectiveSurfaceCost;
        totalCost += Number(recipeData.management_fee || Number(getSetting('management_fee')) || 0);
    }

    const snapshotParts = pricedParts.filter(part => !['coil', 'capacitor', 'float', 'cable', 'packing', 'rotorProcess'].includes(managedPartType(part)));
    if (!coilChanged) {
        snapshotParts.push(...pricedParts.filter(part => managedPartType(part) === 'coil'));
    } else if (recipeData.coil_spec && recipeData.coil_sheets) {
        const coilCost = Number(coilCalculation.data.totalCost || 0);
        if (coilCost > 0) {
            snapshotParts.push({
                model: `${recipeData.coil_spec}-${recipeData.coil_sheets}`,
                name: '线圈转子',
                supplier: '',
                qty: 1,
                snapshotPrice: coilCost,
                pricingMode: coilCalculation.data.pricingMode || 'calculated',
                kitPrice: Number(coilCalculation.data.kitPrice || 0),
                coilId: coilCalculation.data.coilId || null,
                schemeCode: coilCalculation.data.schemeCode || '',
                schemeName: coilCalculation.data.schemeName || '',
                ratedVoltageV: coilCalculation.data.ratedVoltageV || null,
                ratedFrequencyHz: coilCalculation.data.ratedFrequencyHz || null,
                market: coilCalculation.data.market || '',
                schemeFamilyCode: coilCalculation.data.schemeFamilyCode || '',
                inventoryType: coilCalculation.data.coilId ? 'coil' : 'none',
                material: recipeData.coil_material,
                slotType: recipeData.coil_slot_type,
                formula: coilCalculation.data.formula,
                coilCostSource: coilCalculation.data.source,
                source: 'configuration_override',
                costRole: 'coil',
                configurationDependencies: ['coilId', 'coilSpec', 'coilSheets', 'coilMaterial', 'coilSlotType'],
            });
        }
    }
    if (!coilChanged) {
        snapshotParts.push(...pricedParts.filter(part => managedPartType(part) === 'capacitor'));
    } else if (nextCapacitorPart) {
        snapshotParts.push({
            partId: partIdOf(nextCapacitorPart),
            model: String(nextCapacitorPart.model || ''),
            name: '电容',
            supplier: String(nextCapacitorPart.supplier || ''),
            qty: 1,
            snapshotPrice: Number(nextCapacitorPart.price || 0),
            source: 'configuration_override',
            costRole: 'capacitor',
            configurationDependencies: ['coilSpec', 'coilSheets', 'coilMaterial', 'coilSlotType'],
        });
    } else {
        snapshotParts.push(...pricedParts.filter(part => managedPartType(part) === 'capacitor'));
    }

    if (!floatChanged) {
        snapshotParts.push(...pricedParts.filter(part => managedPartType(part) === 'float'));
    } else if (toBool(recipeData.has_float)) {
        const floatModel = configuredWireModel('浮球', recipeData.float_wire, resolvedWire);
        snapshotParts.push({
            partId: partIdOf(floatOverridePart),
            model: floatModel,
            name: recipeData.float_accessory_type === 'xinjie' ? '浮球-新界式' : '浮球',
            supplier: String(floatOverridePart?.supplier || ''),
            qty: 1,
            snapshotPrice: floatOverridePrice,
            floatAccessoryType: recipeData.float_accessory_type,
            source: 'configuration_override',
        });
    }

    if (!cableChanged) {
        snapshotParts.push(...pricedParts.filter(part => managedPartType(part) === 'cable'));
    } else if (cableOverridePart) {
        snapshotParts.push({
            ...cableOverridePart,
            partId: partIdOf(cableCatalogPart),
            source: 'configuration_override',
        });
    }

    if (!boxChanged) {
        snapshotParts.push(...pricedParts.filter(part => managedPartType(part) === 'packing'));
    } else {
        snapshotParts.push(...buildPackingSnapshotParts(
            normalizePackingJsonText(recipeData.packing_parts_json, recipeData.box_type),
            partsCatalog
        ));
    }
    const shaftJointPart = buildStainlessShaftJointBomPart(shaftJointConfiguration);
    if (shaftJointPart) snapshotParts.push(shaftJointPart);

    const finalizedSnapshotParts = bindStableBomPartIdentities(
        normalizeBomRoles(snapshotParts),
        partsCatalog,
        { allowLegacySnapshot: true }
    );
    const effectiveManagementFee = Number(recipeData.management_fee || Number(getSetting('management_fee')) || 0);
    const costSnapshot = {
        version: 1,
        generatedAt: new Date().toISOString(),
        unitCost: Number(totalCost.toFixed(2)),
        partsCost: Number(finalizedSnapshotParts.reduce((sum, part) => sum + Number(part.snapshotPrice || 0) * Number(part.qty || 0), 0).toFixed(2)),
        expenses: {
            assemblyWage: Number(recipeData.assembly_wage || 0),
            packingWage: Number(recipeData.packing_wage || 0),
            surfaceTreatmentMode: recipeData.surface_treatment_mode,
            surfaceTreatmentCost: effectiveSurfaceCost,
            managementFee: effectiveManagementFee,
        },
        processes: {
            rotorShaft: {
                process: shaftJointConfiguration.rotorShaftProcess,
                cost: shaftJointConfiguration.stainlessShaftJointCost,
            },
        },
    };

    return {
        recipeName: recipeData.name,
        unitCost: Number(totalCost.toFixed(2)),
        parts: finalizedSnapshotParts,
        costSnapshot,
        warnings: coilChanged && !coilCalculation.data.coilId ? [{
            code: 'coil_inventory_scheme_required',
            message: `线圈 ${recipeData.coil_spec}-${recipeData.coil_sheets} 已按${coilCalculation.data.source}计价，但没有精确匹配的正式库存方案；订单确认前需先建立正式线圈方案`,
        }] : [],
        recipeData,
    };
}

module.exports = {
    DEFAULT_COIL_MATERIAL,
    buildRecipeData,
    calculateRecipeCostPreview,
    inferPackingRole,
};
