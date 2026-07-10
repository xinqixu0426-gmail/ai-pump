const DEFAULT_COIL_MATERIAL = '钢带';
const MATERIAL_UNIT_PRICE_DEFAULTS = { '钢带': 0.21, '冷轧800': 0.22, '其他材质': 0 };
const SPEC_MATERIAL_UNIT_PRICE_DEFAULTS = {
    '9': { '钢带': 0.18, '冷轧800': 0.2 },
    '12': { '钢带': 0.21, '冷轧800': 0.22 },
    '12.8': { '钢带': 0.234, '冷轧800': 0.244 },
};

function coilValue(coil, key) {
    return coil?.[key] ?? coil?.[key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)];
}

function getMaterialPriceMap(getSetting) {
    try {
        const parsed = JSON.parse(getSetting('coil_material_prices') || '{}');
        return { ...MATERIAL_UNIT_PRICE_DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    } catch {
        return { ...MATERIAL_UNIT_PRICE_DEFAULTS };
    }
}

function normalizeCoilSpec(spec) {
    const raw = String(spec ?? '').trim();
    if (!raw) return '';
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? String(numeric) : raw;
}

function hasMaterialUnitPrice(spec, material, materialPrices = {}) {
    const normalizedSpec = normalizeCoilSpec(spec);
    const normalizedMaterial = String(material || DEFAULT_COIL_MATERIAL).trim() || DEFAULT_COIL_MATERIAL;
    return SPEC_MATERIAL_UNIT_PRICE_DEFAULTS[normalizedSpec]?.[normalizedMaterial] !== undefined
        || materialPrices[normalizedMaterial] !== undefined
        || MATERIAL_UNIT_PRICE_DEFAULTS[normalizedMaterial] !== undefined;
}

function getMaterialUnitPrice(spec, material = DEFAULT_COIL_MATERIAL, materialPrices = {}) {
    const normalizedSpec = normalizeCoilSpec(spec);
    const normalizedMaterial = String(material || DEFAULT_COIL_MATERIAL).trim() || DEFAULT_COIL_MATERIAL;
    const specPrice = SPEC_MATERIAL_UNIT_PRICE_DEFAULTS[normalizedSpec]?.[normalizedMaterial];
    if (specPrice !== undefined) return specPrice;
    if (materialPrices[normalizedMaterial] !== undefined) return Number(materialPrices[normalizedMaterial]) || 0;
    if (MATERIAL_UNIT_PRICE_DEFAULTS[normalizedMaterial] !== undefined) return MATERIAL_UNIT_PRICE_DEFAULTS[normalizedMaterial];
    return 0;
}

function parseStatorInput(stator) {
    if (!stator || typeof stator !== 'string' || !stator.includes('-')) {
        return { statorSpec: null, statorSheets: null };
    }
    const [spec, sheets] = stator.split('-');
    return { statorSpec: spec.trim(), statorSheets: sheets.trim() };
}

function sortBySheets(coils) {
    return [...(coils || [])].sort((a, b) => parseInt(coilValue(a, 'sheets')) - parseInt(coilValue(b, 'sheets')));
}

function selectSpecCoils(coils, spec, material, requestedMaterial, materialPrices = {}) {
    const allSpecCoils = sortBySheets((coils || []).filter(c => String(coilValue(c, 'spec')).trim() === String(spec).trim()));
    const materialCoils = allSpecCoils.filter(c => String(coilValue(c, 'material') || DEFAULT_COIL_MATERIAL).trim() === material);
    const canUseMaterialPrice = requestedMaterial && hasMaterialUnitPrice(spec, material, materialPrices);
    const useMaterialPriceFallback = canUseMaterialPrice && materialCoils.length === 0;
    const specCoils = materialCoils.length > 0 ? materialCoils : ((!requestedMaterial || canUseMaterialPrice) ? allSpecCoils : []);
    return { specCoils, useMaterialPriceFallback };
}

function calculateCoilCost(coils, input = {}, options = {}) {
    const { spec, sheets, wireWeight: customerWireWeight, copperPrice: customCopperPrice } = input;
    const requestedMaterial = input.material ? String(input.material).trim() : '';
    const material = requestedMaterial || DEFAULT_COIL_MATERIAL;
    if (!spec || !sheets) return { success: false, status: 400, error: '规格和片数为必填项' };

    const materialPrices = options.materialPrices || {};
    const targetSheets = parseInt(sheets);
    const { specCoils, useMaterialPriceFallback } = selectSpecCoils(coils, spec, material, requestedMaterial, materialPrices);
    if (specCoils.length === 0) {
        return {
            success: false,
            status: 404,
            error: requestedMaterial ? `未找到规格 "${spec}"、材质 "${material}" 的线圈数据` : `未找到规格 "${spec}" 的线圈数据`,
        };
    }

    const resolveUnitPrice = (coil) => {
        if (useMaterialPriceFallback) return getMaterialUnitPrice(spec, material, materialPrices);
        const unitPrice = coilValue(coil, 'unitPrice');
        return unitPrice !== undefined && unitPrice !== null && unitPrice !== '' ? parseFloat(unitPrice) : getMaterialUnitPrice(spec, material, materialPrices);
    };
    const exactMatch = specCoils.find(c => parseInt(coilValue(c, 'sheets')) === targetSheets);
    let unitPrice, wireWeight, copperBase, coilFee, rotorFee, wireGauge, capacitor, source;

    if (exactMatch) {
        unitPrice = resolveUnitPrice(exactMatch);
        wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(coilValue(exactMatch, 'wireWeight') || 0);
        copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(coilValue(exactMatch, 'copperBase') || 0);
        coilFee = parseFloat(coilValue(exactMatch, 'coilFee') || 0);
        rotorFee = parseFloat(coilValue(exactMatch, 'rotorFee') || 0);
        wireGauge = coilValue(exactMatch, 'defaultWireGauge') || null;
        capacitor = coilValue(exactMatch, 'defaultCapacitor') || null;
        source = '精确匹配';
    } else {
        let lower = null, upper = null;
        for (let i = 0; i < specCoils.length; i++) {
            const s = parseInt(coilValue(specCoils[i], 'sheets'));
            if (s < targetSheets) lower = specCoils[i];
            if (s > targetSheets && !upper) upper = specCoils[i];
        }

        if (lower && upper) {
            const lS = parseInt(coilValue(lower, 'sheets'));
            const uS = parseInt(coilValue(upper, 'sheets'));
            const ratio = (targetSheets - lS) / (uS - lS);
            unitPrice = resolveUnitPrice(lower);
            const iWW = parseFloat(coilValue(lower, 'wireWeight') || 0) + (parseFloat(coilValue(upper, 'wireWeight') || 0) - parseFloat(coilValue(lower, 'wireWeight') || 0)) * ratio;
            wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(iWW.toFixed(4));
            copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(coilValue(lower, 'copperBase') || 0);
            coilFee = parseFloat(coilValue(lower, 'coilFee') || 0) + (parseFloat(coilValue(upper, 'coilFee') || 0) - parseFloat(coilValue(lower, 'coilFee') || 0)) * ratio;
            rotorFee = parseFloat(coilValue(lower, 'rotorFee') || 0) + (parseFloat(coilValue(upper, 'rotorFee') || 0) - parseFloat(coilValue(lower, 'rotorFee') || 0)) * ratio;
            wireGauge = coilValue(lower, 'defaultWireGauge') || coilValue(upper, 'defaultWireGauge') || null;
            capacitor = coilValue(lower, 'defaultCapacitor') || coilValue(upper, 'defaultCapacitor') || null;
            source = `插值(${lS}片↔${uS}片, ratio=${ratio.toFixed(3)})`;
        } else if (lower) {
            unitPrice = resolveUnitPrice(lower);
            wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(coilValue(lower, 'wireWeight') || 0);
            copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(coilValue(lower, 'copperBase') || 0);
            coilFee = parseFloat(coilValue(lower, 'coilFee') || 0);
            rotorFee = parseFloat(coilValue(lower, 'rotorFee') || 0);
            wireGauge = coilValue(lower, 'defaultWireGauge') || null;
            capacitor = coilValue(lower, 'defaultCapacitor') || null;
            source = `外推(基于${parseInt(coilValue(lower, 'sheets'))}片)`;
        } else if (upper) {
            unitPrice = resolveUnitPrice(upper);
            wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(coilValue(upper, 'wireWeight') || 0);
            copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(coilValue(upper, 'copperBase') || 0);
            coilFee = parseFloat(coilValue(upper, 'coilFee') || 0);
            rotorFee = parseFloat(coilValue(upper, 'rotorFee') || 0);
            wireGauge = coilValue(upper, 'defaultWireGauge') || null;
            capacitor = coilValue(upper, 'defaultCapacitor') || null;
            source = `外推(基于${parseInt(coilValue(upper, 'sheets'))}片)`;
        }
    }

    const totalCost = unitPrice * targetSheets + wireWeight * copperBase + coilFee + rotorFee;
    return {
        success: true,
        data: {
            spec,
            material,
            sheets: targetSheets,
            unitPrice,
            wireWeight,
            copperBase,
            coilFee: parseFloat(coilFee.toFixed(2)),
            rotorFee: parseFloat(rotorFee.toFixed(2)),
            wireGauge,
            capacitor,
            totalCost: parseFloat(totalCost.toFixed(2)),
            formula: `${unitPrice}×${targetSheets} + ${wireWeight}×${copperBase} + ${coilFee.toFixed(2)} + ${rotorFee.toFixed(2)}`,
            source,
            isCustomWireWeight: customerWireWeight != null,
        },
    };
}

function buildCoilSpecDraft(coils, input = {}, options = {}) {
    const spec = String(input.spec || '').trim();
    const material = String(input.material || DEFAULT_COIL_MATERIAL).trim() || DEFAULT_COIL_MATERIAL;
    const materialPrices = options.materialPrices || {};
    const allSpecCoils = sortBySheets((coils || []).filter(c => String(coilValue(c, 'spec')).trim() === spec));
    const exactMaterialCoils = allSpecCoils.filter(c => String(coilValue(c, 'material') || DEFAULT_COIL_MATERIAL).trim() === material);
    const reference = exactMaterialCoils[0] || allSpecCoils[0] || null;
    if (!reference) {
        return {
            spec,
            material,
            unitPrice: getMaterialUnitPrice(spec, material, materialPrices),
            wireWeight: null,
            copperBase: null,
            coilFee: null,
            rotorFee: null,
            defaultWireGauge: '',
            defaultCapacitor: '',
            source: 'material-default',
            referenceCoilId: null,
            exactMaterial: false,
        };
    }
    const exactMaterial = exactMaterialCoils.length > 0;
    return {
        spec,
        material: coilValue(reference, 'material') || material,
        unitPrice: exactMaterial
            ? Number(coilValue(reference, 'unitPrice') || 0)
            : getMaterialUnitPrice(spec, material, materialPrices) || Number(coilValue(reference, 'unitPrice') || 0),
        wireWeight: Number(coilValue(reference, 'wireWeight') || 0),
        copperBase: Number(coilValue(reference, 'copperBase') || 0),
        coilFee: Number(coilValue(reference, 'coilFee') || 0),
        rotorFee: Number(coilValue(reference, 'rotorFee') || 0),
        defaultWireGauge: coilValue(reference, 'defaultWireGauge') || '',
        defaultCapacitor: coilValue(reference, 'defaultCapacitor') || '',
        source: exactMaterial ? 'same-spec-material' : 'same-spec',
        referenceCoilId: Number(coilValue(reference, 'id') || 0) || null,
        exactMaterial,
    };
}

function resolveWireFromCoils(coils, statorSpec, statorSheets, material = DEFAULT_COIL_MATERIAL) {
    if (!statorSpec || !statorSheets) return null;
    const requestedMaterial = material ? String(material).trim() : '';
    const { specCoils } = selectSpecCoils(coils, statorSpec, requestedMaterial || DEFAULT_COIL_MATERIAL, requestedMaterial, {});
    const targetSheets = Number(statorSheets);
    const exact = specCoils.find(coil => Number(coilValue(coil, 'sheets')) === targetSheets);
    return coilValue(exact, 'defaultWireGauge') || null;
}

function calculateFullEstimateCoilCost(coils, statorSpec, statorSheets, material = DEFAULT_COIL_MATERIAL, options = {}) {
    if (!statorSpec || !statorSheets) return null;
    const result = calculateCoilCost(coils, { spec: statorSpec, sheets: statorSheets, material }, options);
    if (!result.success) return { error: result.error };
    const data = result.data;
    return {
        spec: data.spec,
        material: data.material,
        sheets: String(statorSheets),
        unitPrice: data.unitPrice,
        cost: data.totalCost.toFixed(2),
        wireGauge: data.wireGauge,
        source: data.source,
        formula: data.formula,
    };
}

module.exports = {
    DEFAULT_COIL_MATERIAL,
    MATERIAL_UNIT_PRICE_DEFAULTS,
    SPEC_MATERIAL_UNIT_PRICE_DEFAULTS,
    getMaterialPriceMap,
    getMaterialUnitPrice,
    parseStatorInput,
    calculateCoilCost,
    buildCoilSpecDraft,
    resolveWireFromCoils,
    calculateFullEstimateCoilCost,
};
