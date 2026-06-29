const DEFAULT_COIL_MATERIAL = '钢带';
const MATERIAL_UNIT_PRICE_DEFAULTS = { '钢带': 0.21, '冷轧800': 0.22, '其他材质': 0 };

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
    const canUseMaterialPrice = requestedMaterial && materialPrices[material] !== undefined;
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

    const resolveUnitPrice = (coil) => useMaterialPriceFallback ? parseFloat(materialPrices[material] || 0) : parseFloat(coilValue(coil, 'unitPrice') || 0);
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
    getMaterialPriceMap,
    parseStatorInput,
    calculateCoilCost,
    resolveWireFromCoils,
    calculateFullEstimateCoilCost,
};
