const DEFAULT_COIL_MATERIAL = '钢带';
const DEFAULT_COIL_SLOT_TYPE = '小眼';
const COIL_MATERIALS = new Set(['钢带', '冷轧']);
const COIL_SLOT_TYPES = new Set(['小眼', '国标眼']);
const COIL_SCHEME_STATUSES = new Set(['testing', 'official', 'disabled']);

function coilValue(coil, key) {
    return coil?.[key] ?? coil?.[key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)];
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

function normalizeCoilSpec(spec) {
    const text = String(spec || '').trim();
    if (!text) return { commonName: '', diameterMm: 0 };
    const diameterMm = text === '12' ? 120 : Number.parseInt(text, 10);
    return {
        commonName: text,
        diameterMm: Number.isInteger(diameterMm) && diameterMm > 0 ? diameterMm : 0,
    };
}

function normalizeCoilDimensions(input = {}) {
    const spec = normalizeCoilSpec(input.spec ?? input.commonName ?? input.diameterMm);
    const explicitDiameter = Number(input.diameterMm);
    const rawMaterial = String(input.material || DEFAULT_COIL_MATERIAL).trim() || DEFAULT_COIL_MATERIAL;
    const material = rawMaterial.includes('冷轧')
        ? '冷轧'
        : rawMaterial.includes('钢带') ? '钢带' : rawMaterial;
    const rawSlotType = rawMaterial.includes('国标眼')
        ? '国标眼'
        : String(input.slotType || DEFAULT_COIL_SLOT_TYPE).trim() || DEFAULT_COIL_SLOT_TYPE;
    return {
        ...spec,
        diameterMm: Number.isInteger(explicitDiameter) && explicitDiameter > 0 ? explicitDiameter : spec.diameterMm,
        material,
        slotType: rawSlotType,
    };
}

function coilDiameterMm(coil) {
    const stored = Number(coilValue(coil, 'diameterMm') || 0);
    return stored > 0 ? stored : normalizeCoilSpec(coilValue(coil, 'spec')).diameterMm;
}

function selectSpecCoils(coils, dimensions, { includeTesting = false } = {}) {
    return sortBySheets((coils || []).filter(coil => {
        const status = String(coilValue(coil, 'schemeStatus') || 'official');
        if (status === 'disabled' || (!includeTesting && status !== 'official')) return false;
        return coilDiameterMm(coil) === dimensions.diameterMm
            && String(coilValue(coil, 'material') || DEFAULT_COIL_MATERIAL).trim() === dimensions.material
            && String(coilValue(coil, 'slotType') || DEFAULT_COIL_SLOT_TYPE).trim() === dimensions.slotType;
    }));
}

function calculateCoilCost(coils, input = {}) {
    const { spec, sheets, wireWeight: customerWireWeight, copperPrice: customCopperPrice } = input;
    const dimensions = normalizeCoilDimensions(input);
    const { material, slotType } = dimensions;
    if (!spec || !sheets) return { success: false, status: 400, error: '规格和片数为必填项' };

    const targetSheets = parseInt(sheets);
    const specCoils = selectSpecCoils(coils, dimensions, { includeTesting: input.includeTesting === true });
    if (specCoils.length === 0) {
        return {
            success: false,
            status: 404,
            error: `未找到规格 "${spec}"、材质 "${material}"、槽眼 "${slotType}" 的正式线圈方案`,
        };
    }

    const resolveUnitPrice = coil => Number(coilValue(coil, 'unitPrice') || 0);
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
            slotType,
            diameterMm: dimensions.diameterMm,
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

function buildCoilSpecDraft(coils, input = {}) {
    const dimensions = normalizeCoilDimensions(input);
    const { commonName: spec, material, slotType, diameterMm } = dimensions;
    const activeCoils = (coils || []).filter(coil => String(coilValue(coil, 'schemeStatus') || 'official') !== 'disabled');
    const allSpecCoils = sortBySheets(activeCoils.filter(coil => coilDiameterMm(coil) === diameterMm));
    const exactVariantCoils = allSpecCoils.filter(coil => (
        String(coilValue(coil, 'material') || DEFAULT_COIL_MATERIAL).trim() === material
        && String(coilValue(coil, 'slotType') || DEFAULT_COIL_SLOT_TYPE).trim() === slotType
    ));
    const reference = exactVariantCoils[0] || allSpecCoils[0] || null;
    if (!reference) {
        return {
            spec,
            diameterMm,
            material,
            slotType,
            unitPrice: 0,
            wireWeight: null,
            copperBase: null,
            coilFee: null,
            rotorFee: null,
            defaultWireGauge: '',
            defaultCapacitor: '',
            source: 'empty',
            referenceCoilId: null,
            exactVariant: false,
            exactMaterial: false,
        };
    }
    const exactVariant = exactVariantCoils.length > 0;
    return {
        spec,
        diameterMm,
        material: exactVariant ? (coilValue(reference, 'material') || material) : material,
        slotType,
        unitPrice: exactVariant ? Number(coilValue(reference, 'unitPrice') || 0) : 0,
        wireWeight: Number(coilValue(reference, 'wireWeight') || 0),
        copperBase: Number(coilValue(reference, 'copperBase') || 0),
        coilFee: Number(coilValue(reference, 'coilFee') || 0),
        rotorFee: Number(coilValue(reference, 'rotorFee') || 0),
        defaultWireGauge: coilValue(reference, 'defaultWireGauge') || '',
        defaultCapacitor: coilValue(reference, 'defaultCapacitor') || '',
        source: exactVariant ? 'same-variant' : 'same-spec',
        referenceCoilId: Number(coilValue(reference, 'id') || 0) || null,
        exactVariant,
        exactMaterial: exactVariant,
    };
}

function resolveWireFromCoils(coils, statorSpec, statorSheets, material = DEFAULT_COIL_MATERIAL, slotType = DEFAULT_COIL_SLOT_TYPE) {
    if (!statorSpec || !statorSheets) return null;
    const dimensions = normalizeCoilDimensions({ spec: statorSpec, material, slotType });
    const specCoils = selectSpecCoils(coils, dimensions);
    const targetSheets = Number(statorSheets);
    const exact = specCoils.find(coil => Number(coilValue(coil, 'sheets')) === targetSheets);
    return coilValue(exact, 'defaultWireGauge') || null;
}

function calculateFullEstimateCoilCost(coils, statorSpec, statorSheets, material = DEFAULT_COIL_MATERIAL, slotType = DEFAULT_COIL_SLOT_TYPE) {
    if (!statorSpec || !statorSheets) return null;
    const result = calculateCoilCost(coils, { spec: statorSpec, sheets: statorSheets, material, slotType });
    if (!result.success) return { error: result.error };
    const data = result.data;
    return {
        spec: data.spec,
        material: data.material,
        slotType: data.slotType,
        sheets: String(statorSheets),
        unitPrice: data.unitPrice,
        cost: data.totalCost.toFixed(2),
        wireGauge: data.wireGauge,
        source: data.source,
        formula: data.formula,
    };
}

function buildCoilSpecOptions(coils) {
    const specsMap = new Map();
    (coils || [])
        .filter(coil => String(coilValue(coil, 'schemeStatus') || 'official') === 'official')
        .forEach(coil => {
            const spec = String(coilValue(coil, 'spec') || '').trim();
            if (!spec) return;
            const material = String(coilValue(coil, 'material') || DEFAULT_COIL_MATERIAL).trim() || DEFAULT_COIL_MATERIAL;
            const slotType = String(coilValue(coil, 'slotType') || DEFAULT_COIL_SLOT_TYPE).trim() || DEFAULT_COIL_SLOT_TYPE;
            const sheets = Number(coilValue(coil, 'sheets') || 0);
            let option = specsMap.get(spec);
            if (!option) {
                option = {
                    spec,
                    commonName: String(coilValue(coil, 'commonName') || spec),
                    diameterMm: coilDiameterMm(coil),
                    material,
                    materials: [],
                    slotTypes: [],
                    variants: [],
                    unitPrice: Number(coilValue(coil, 'unitPrice') || 0),
                    sheets: [],
                    count: 0,
                };
                specsMap.set(spec, option);
            }
            if (!option.materials.includes(material)) option.materials.push(material);
            if (!option.slotTypes.includes(slotType)) option.slotTypes.push(slotType);
            let variant = option.variants.find(item => item.material === material && item.slotType === slotType);
            if (!variant) {
                variant = { material, slotType, sheets: [] };
                option.variants.push(variant);
            }
            if (sheets > 0 && !variant.sheets.includes(sheets)) variant.sheets.push(sheets);
            if (sheets > 0 && !option.sheets.includes(sheets)) option.sheets.push(sheets);
            if (material === DEFAULT_COIL_MATERIAL && slotType === DEFAULT_COIL_SLOT_TYPE) {
                option.material = material;
                option.unitPrice = Number(coilValue(coil, 'unitPrice') || 0);
            }
            option.count++;
        });

    return Array.from(specsMap.values())
        .map(option => ({
            ...option,
            materials: option.materials.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
            slotTypes: option.slotTypes.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
            sheets: option.sheets.sort((left, right) => left - right),
            variants: option.variants
                .map(variant => ({ ...variant, sheets: variant.sheets.sort((left, right) => left - right) }))
                .sort((left, right) => (
                    left.material.localeCompare(right.material, 'zh-Hans-CN')
                    || left.slotType.localeCompare(right.slotType, 'zh-Hans-CN')
                )),
        }))
        .sort((left, right) => (
            Number(left.diameterMm || 0) - Number(right.diameterMm || 0)
            || left.spec.localeCompare(right.spec, 'zh-Hans-CN', { numeric: true })
        ));
}

module.exports = {
    DEFAULT_COIL_MATERIAL,
    DEFAULT_COIL_SLOT_TYPE,
    COIL_MATERIALS,
    COIL_SLOT_TYPES,
    COIL_SCHEME_STATUSES,
    normalizeCoilSpec,
    normalizeCoilDimensions,
    parseStatorInput,
    calculateCoilCost,
    buildCoilSpecDraft,
    resolveWireFromCoils,
    calculateFullEstimateCoilCost,
    buildCoilSpecOptions,
};
