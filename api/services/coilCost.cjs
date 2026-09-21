const DEFAULT_COIL_MATERIAL = '钢带';
const DEFAULT_COIL_SLOT_TYPE = '小眼';
const COIL_MATERIALS = new Set(['钢带', '冷轧']);
const COIL_SLOT_TYPES = new Set(['小眼', '国标眼']);
const COIL_SCHEME_STATUSES = new Set(['testing', 'official', 'disabled']);
const COIL_PRICING_MODES = new Set(['calculated', 'kit']);
const DEFAULT_COIL_PRICING_MODE = 'calculated';
const WIRE_WEIGHT_AUTHORITIES = Object.freeze({
    calculated: 'OVERRIDABLE',
    kit: 'NON_OVERRIDABLE',
});

function wireWeightAuthorityForPricingMode(pricingMode) {
    return WIRE_WEIGHT_AUTHORITIES[String(pricingMode || '')] || 'UNSUPPORTED';
}

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

function coilPricingMode(coil) {
    return String(coilValue(coil, 'pricingMode') || DEFAULT_COIL_PRICING_MODE) === 'kit'
        ? 'kit'
        : DEFAULT_COIL_PRICING_MODE;
}

function coilIdOf(coil) {
    return Number(coilValue(coil, 'id') || coilValue(coil, 'Id') || 0) || null;
}

function coilSchemeSummary(coil) {
    return {
        coilId: coilIdOf(coil),
        schemeCode: String(coilValue(coil, 'schemeCode') || ''),
        schemeName: String(coilValue(coil, 'schemeName') || ''),
        isDefault: Boolean(coilValue(coil, 'isDefault')),
        ratedVoltageV: Number(coilValue(coil, 'ratedVoltageV') || 0) || null,
        ratedFrequencyHz: Number(coilValue(coil, 'ratedFrequencyHz') || 0) || null,
        market: String(coilValue(coil, 'market') || ''),
        schemeFamilyCode: String(coilValue(coil, 'schemeFamilyCode') || ''),
    };
}

function coilSchemeError(code, error, candidates = []) {
    return {
        success: false,
        status: code === 'COIL_SCHEME_AMBIGUOUS' || code === 'COIL_SCHEME_FAMILY_REQUIRED' ? 409 : 400,
        code,
        error,
        details: {
            candidates: candidates.map(coilSchemeSummary),
        },
    };
}

function calculateStoredCoilCost(values = {}) {
    const pricingMode = String(values.pricingMode || DEFAULT_COIL_PRICING_MODE);
    if (pricingMode === 'kit') return Number(values.kitPrice || 0);
    return (
        Number(values.unitPrice || 0) * Number(values.sheets || 0)
        + Number(values.wireWeight || 0) * Number(values.copperBase || 0)
        + Number(values.coilFee || 0)
        + Number(values.rotorFee || 0)
    );
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
    if (!String(spec || '').trim()) return { success: false, status: 400, error: '规格为必填项' };

    const targetSheets = Number(sheets);
    if (!Number.isInteger(targetSheets) || targetSheets <= 0) {
        return { success: false, status: 400, error: '片数必须是正整数' };
    }
    const parsedCustomerWireWeight = customerWireWeight === undefined || customerWireWeight === null || customerWireWeight === ''
        ? null
        : Number(customerWireWeight);
    if (parsedCustomerWireWeight !== null && (!Number.isFinite(parsedCustomerWireWeight) || parsedCustomerWireWeight < 0)) {
        return { success: false, status: 400, error: '自定义线重必须是非负数字' };
    }
    const parsedCopperPrice = customCopperPrice === undefined || customCopperPrice === null || customCopperPrice === ''
        ? null
        : Number(customCopperPrice);
    if (parsedCopperPrice !== null && (!Number.isFinite(parsedCopperPrice) || parsedCopperPrice < 0)) {
        return { success: false, status: 400, error: '铜价必须是非负数字' };
    }
    let specCoils = selectSpecCoils(coils, dimensions, { includeTesting: input.includeTesting === true });
    if (specCoils.length === 0) {
        return {
            success: false,
            status: 404,
            error: `未找到规格 "${spec}"、材质 "${material}"、槽眼 "${slotType}" 的正式线圈方案`,
        };
    }

    const explicitCoilId = Number(input.coilId || 0) || null;
    const explicitSchemeCode = String(input.schemeCode || '').trim();
    let explicitMatch = null;
    if (explicitCoilId || explicitSchemeCode) {
        explicitMatch = specCoils.find(coil => (
            explicitCoilId
                ? coilIdOf(coil) === explicitCoilId
                : String(coilValue(coil, 'schemeCode') || '') === explicitSchemeCode
        ));
        if (!explicitMatch) {
            return coilSchemeError(
                'COIL_SCHEME_NOT_FOUND',
                '所选线圈方案不存在、不是正式方案，或与当前规格组合不一致'
            );
        }
        if (Number(coilValue(explicitMatch, 'sheets')) !== targetSheets) {
            return coilSchemeError(
                'COIL_SCHEME_SHEETS_MISMATCH',
                `所选线圈方案为 ${coilValue(explicitMatch, 'sheets')} 片，与当前 ${targetSheets} 片不一致`,
                [explicitMatch]
            );
        }
    }

    const exactCandidates = specCoils.filter(
        coil => Number(coilValue(coil, 'sheets')) === targetSheets
    );
    let exactMatch = explicitMatch;
    if (!exactMatch && exactCandidates.length === 1) {
        [exactMatch] = exactCandidates;
    } else if (!exactMatch && exactCandidates.length > 1) {
        const defaults = exactCandidates.filter(coil => Boolean(coilValue(coil, 'isDefault')));
        if (defaults.length === 1) {
            [exactMatch] = defaults;
        } else {
            return coilSchemeError(
                'COIL_SCHEME_AMBIGUOUS',
                `规格 "${spec}"、${targetSheets} 片存在多个正式方案，请明确选择具体线圈方案`,
                exactCandidates
            );
        }
    }
    if (exactMatch && coilPricingMode(exactMatch) === 'kit') {
        const kitPrice = Number(coilValue(exactMatch, 'kitPrice') || 0);
        if (!Number.isFinite(kitPrice) || kitPrice <= 0) {
            return {
                success: false,
                status: 422,
                error: `规格 "${spec}"、材质 "${material}"、槽眼 "${slotType}"、${targetSheets} 片的供应商套件价无效`,
            };
        }
        return {
            success: true,
            data: {
                coilId: Number(coilValue(exactMatch, 'id') || coilValue(exactMatch, 'Id') || 0) || null,
                ...coilSchemeSummary(exactMatch),
                spec,
                material,
                slotType,
                diameterMm: dimensions.diameterMm,
                sheets: targetSheets,
                pricingMode: 'kit',
                kitPrice,
                unitPrice: 0,
                wireWeight: Number(coilValue(exactMatch, 'wireWeight') || 0),
                copperBase: Number(coilValue(exactMatch, 'copperBase') || 0),
                coilFee: 0,
                rotorFee: 0,
                wireGauge: coilValue(exactMatch, 'defaultWireGauge') || null,
                capacitor: coilValue(exactMatch, 'defaultCapacitor') || null,
                totalCost: parseFloat(kitPrice.toFixed(2)),
                formula: '供应商套件价',
                source: '供应商套件价（精确匹配）',
                requestedWireWeight: parsedCustomerWireWeight,
                appliedWireWeight: null,
                wireWeightAuthority: wireWeightAuthorityForPricingMode('kit'),
                overrideStatus: parsedCustomerWireWeight === null ? 'NOT_REQUESTED' : 'UNSUPPORTED_FOR_PRICING_MODE',
                isCustomWireWeight: false,
            },
        };
    }

    const explicitFamilyCode = String(
        input.schemeFamilyCode || coilValue(explicitMatch, 'schemeFamilyCode') || ''
    ).trim();
    const calculatedFamilies = new Set(
        specCoils
            .filter(coil => coilPricingMode(coil) === 'calculated')
            .map(coil => String(coilValue(coil, 'schemeFamilyCode') || '').trim())
            .filter(Boolean)
    );
    if (!exactMatch && !explicitFamilyCode && calculatedFamilies.size > 1) {
        return coilSchemeError(
            'COIL_SCHEME_FAMILY_REQUIRED',
            `规格 "${spec}" 存在多个线圈方案系列，插值或外推前必须明确方案系列`,
            specCoils
        );
    }
    if (explicitFamilyCode) {
        specCoils = specCoils.filter(
            coil => String(coilValue(coil, 'schemeFamilyCode') || '').trim() === explicitFamilyCode
        );
    }
    const calculatedCoils = specCoils.filter(coil => coilPricingMode(coil) === 'calculated');
    if (!exactMatch && calculatedCoils.length === 0) {
        return {
            success: false,
            status: 404,
            error: `未找到规格 "${spec}"、材质 "${material}"、槽眼 "${slotType}"、${targetSheets} 片的精确套件方案；供应商套件价不参与插值或外推`,
        };
    }

    const resolveUnitPrice = coil => Number(coilValue(coil, 'unitPrice') || 0);
    const calculationMatch = exactMatch || null;
    let unitPrice, wireWeight, copperBase, coilFee, rotorFee, wireGauge, capacitor, source;

    if (calculationMatch) {
        unitPrice = resolveUnitPrice(calculationMatch);
        wireWeight = parsedCustomerWireWeight ?? parseFloat(coilValue(calculationMatch, 'wireWeight') || 0);
        copperBase = parsedCopperPrice ?? parseFloat(coilValue(calculationMatch, 'copperBase') || 0);
        coilFee = parseFloat(coilValue(calculationMatch, 'coilFee') || 0);
        rotorFee = parseFloat(coilValue(calculationMatch, 'rotorFee') || 0);
        wireGauge = coilValue(calculationMatch, 'defaultWireGauge') || null;
        capacitor = coilValue(calculationMatch, 'defaultCapacitor') || null;
        source = '精确匹配';
    } else {
        let lower = null, upper = null;
        for (let i = 0; i < calculatedCoils.length; i++) {
            const s = parseInt(coilValue(calculatedCoils[i], 'sheets'));
            if (s < targetSheets) lower = calculatedCoils[i];
            if (s > targetSheets && !upper) upper = calculatedCoils[i];
        }

        if (lower && upper) {
            const lS = parseInt(coilValue(lower, 'sheets'));
            const uS = parseInt(coilValue(upper, 'sheets'));
            const ratio = (targetSheets - lS) / (uS - lS);
            unitPrice = resolveUnitPrice(lower);
            const iWW = parseFloat(coilValue(lower, 'wireWeight') || 0) + (parseFloat(coilValue(upper, 'wireWeight') || 0) - parseFloat(coilValue(lower, 'wireWeight') || 0)) * ratio;
            wireWeight = parsedCustomerWireWeight ?? parseFloat(iWW.toFixed(4));
            copperBase = parsedCopperPrice ?? parseFloat(coilValue(lower, 'copperBase') || 0);
            coilFee = parseFloat(coilValue(lower, 'coilFee') || 0) + (parseFloat(coilValue(upper, 'coilFee') || 0) - parseFloat(coilValue(lower, 'coilFee') || 0)) * ratio;
            rotorFee = parseFloat(coilValue(lower, 'rotorFee') || 0) + (parseFloat(coilValue(upper, 'rotorFee') || 0) - parseFloat(coilValue(lower, 'rotorFee') || 0)) * ratio;
            wireGauge = coilValue(lower, 'defaultWireGauge') || coilValue(upper, 'defaultWireGauge') || null;
            capacitor = coilValue(lower, 'defaultCapacitor') || coilValue(upper, 'defaultCapacitor') || null;
            source = `插值(${lS}片↔${uS}片, ratio=${ratio.toFixed(3)})`;
        } else if (lower) {
            unitPrice = resolveUnitPrice(lower);
            wireWeight = parsedCustomerWireWeight ?? parseFloat(coilValue(lower, 'wireWeight') || 0);
            copperBase = parsedCopperPrice ?? parseFloat(coilValue(lower, 'copperBase') || 0);
            coilFee = parseFloat(coilValue(lower, 'coilFee') || 0);
            rotorFee = parseFloat(coilValue(lower, 'rotorFee') || 0);
            wireGauge = coilValue(lower, 'defaultWireGauge') || null;
            capacitor = coilValue(lower, 'defaultCapacitor') || null;
            source = `外推(基于${parseInt(coilValue(lower, 'sheets'))}片)`;
        } else if (upper) {
            unitPrice = resolveUnitPrice(upper);
            wireWeight = parsedCustomerWireWeight ?? parseFloat(coilValue(upper, 'wireWeight') || 0);
            copperBase = parsedCopperPrice ?? parseFloat(coilValue(upper, 'copperBase') || 0);
            coilFee = parseFloat(coilValue(upper, 'coilFee') || 0);
            rotorFee = parseFloat(coilValue(upper, 'rotorFee') || 0);
            wireGauge = coilValue(upper, 'defaultWireGauge') || null;
            capacitor = coilValue(upper, 'defaultCapacitor') || null;
            source = `外推(基于${parseInt(coilValue(upper, 'sheets'))}片)`;
        }
    }

    const totalCost = unitPrice * targetSheets + wireWeight * copperBase + coilFee + rotorFee;
    const exactInventoryMatch = exactMatch && (
        parsedCustomerWireWeight === null
        || Math.abs(parsedCustomerWireWeight - Number(coilValue(exactMatch, 'wireWeight') || 0)) < 0.000001
    );
    return {
        success: true,
        data: {
            coilId: exactInventoryMatch
                ? Number(coilValue(exactMatch, 'id') || coilValue(exactMatch, 'Id') || 0) || null
                : null,
            ...(exactMatch ? coilSchemeSummary(exactMatch) : {
                schemeCode: '',
                schemeName: '',
                isDefault: false,
                ratedVoltageV: null,
                ratedFrequencyHz: null,
                market: '',
                schemeFamilyCode: explicitFamilyCode,
            }),
            spec,
            material,
            slotType,
            diameterMm: dimensions.diameterMm,
            sheets: targetSheets,
            pricingMode: 'calculated',
            kitPrice: 0,
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
            requestedWireWeight: parsedCustomerWireWeight,
            appliedWireWeight: parsedCustomerWireWeight === null ? null : wireWeight,
            wireWeightAuthority: wireWeightAuthorityForPricingMode('calculated'),
            overrideStatus: parsedCustomerWireWeight === null ? 'NOT_REQUESTED' : 'APPLIED',
            isCustomWireWeight: parsedCustomerWireWeight !== null,
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
    const reference = exactVariantCoils.find(coil => coilPricingMode(coil) === 'calculated')
        || exactVariantCoils[0]
        || allSpecCoils.find(coil => coilPricingMode(coil) === 'calculated')
        || allSpecCoils[0]
        || null;
    if (!reference) {
        return {
            spec,
            diameterMm,
            material,
            slotType,
            pricingMode: DEFAULT_COIL_PRICING_MODE,
            kitPrice: 0,
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
        pricingMode: DEFAULT_COIL_PRICING_MODE,
        kitPrice: 0,
        unitPrice: exactVariant && coilPricingMode(reference) === 'calculated'
            ? Number(coilValue(reference, 'unitPrice') || 0)
            : 0,
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

function resolveWireFromCoils(coils, statorSpec, statorSheets, material = DEFAULT_COIL_MATERIAL, slotType = DEFAULT_COIL_SLOT_TYPE, options = {}) {
    if (!statorSpec || !statorSheets) return null;
    const result = calculateCoilCost(coils, {
        spec: statorSpec,
        sheets: statorSheets,
        material,
        slotType,
        coilId: options.coilId,
        schemeCode: options.schemeCode,
        schemeFamilyCode: options.schemeFamilyCode,
    });
    return result.success ? result.data.wireGauge || null : null;
}

function calculateFullEstimateCoilCost(coils, statorSpec, statorSheets, material = DEFAULT_COIL_MATERIAL, slotType = DEFAULT_COIL_SLOT_TYPE, options = {}) {
    if (!statorSpec || !statorSheets) return null;
    const result = calculateCoilCost(coils, { spec: statorSpec, sheets: statorSheets, material, slotType, ...options });
    if (!result.success) return { error: result.error };
    const data = result.data;
    return {
        spec: data.spec,
        material: data.material,
        slotType: data.slotType,
        sheets: String(statorSheets),
        coilId: data.coilId || null,
        schemeCode: data.schemeCode || '',
        schemeName: data.schemeName || '',
        ratedVoltageV: data.ratedVoltageV || null,
        ratedFrequencyHz: data.ratedFrequencyHz || null,
        market: data.market || '',
        schemeFamilyCode: data.schemeFamilyCode || '',
        inventoryType: data.coilId ? 'coil' : 'none',
        pricingMode: data.pricingMode,
        kitPrice: data.kitPrice,
        unitPrice: data.unitPrice,
        wireWeight: data.wireWeight,
        copperBase: data.copperBase,
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
    COIL_PRICING_MODES,
    DEFAULT_COIL_PRICING_MODE,
    WIRE_WEIGHT_AUTHORITIES,
    wireWeightAuthorityForPricingMode,
    normalizeCoilSpec,
    normalizeCoilDimensions,
    calculateStoredCoilCost,
    coilSchemeSummary,
    parseStatorInput,
    calculateCoilCost,
    buildCoilSpecDraft,
    resolveWireFromCoils,
    calculateFullEstimateCoilCost,
    buildCoilSpecOptions,
};
