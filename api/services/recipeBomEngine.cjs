const {
    DEFAULT_LONG_SCREW_EXTRA_LENGTH,
    applyLongScrewRule,
    roundMoney,
    wireModel,
    inferPackingMaterial,
    getPartPriceFromCatalog,
} = require('./costEngine.cjs');
const {
    getCableAccessoryFeeFromCatalog,
    getCableAccessoryNameFromCatalog,
} = require('./cableAccessory.cjs');
const {
    DEFAULT_COIL_MATERIAL,
    calculateCoilCost,
} = require('./coilCost.cjs');

function parseJson(value, fallback) {
    if (!value) return fallback;
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function toBool(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
}

function capacitorValueFromModel(model) {
    const normalized = String(model || '').replace(/[uUμfFvV\s]/g, '').trim();
    const value = parseFloat(normalized);
    return Number.isFinite(value) ? value : null;
}

const getPriceByModelAndSupplier = getPartPriceFromCatalog;

function getCableAccessoryFee(partsCatalog, cableModel, supplier = '', accessoryType = 'standard') {
    return getCableAccessoryFeeFromCatalog(partsCatalog, cableModel, supplier, accessoryType);
}

function getCableAccessoryName(partsCatalog, cableModel, supplier = '', accessoryType = 'standard') {
    return getCableAccessoryNameFromCatalog(partsCatalog, cableModel, supplier, accessoryType);
}

function lengthCmQty(component, customBarrelLength) {
    if (component.pricingMode !== 'lengthCm') return Number(component.qty || 1);
    return Number(customBarrelLength || Number(component.qty || 0) * 10) / 10;
}

function calculateCoilSnapshot(coils, spec, sheets, material = DEFAULT_COIL_MATERIAL) {
    const result = calculateCoilCost(coils, { spec, sheets, material });
    if (!result.success) return null;
    const data = result.data;
    return {
        totalCost: roundMoney(data.totalCost),
        material: data.material || material || DEFAULT_COIL_MATERIAL,
        unitPrice: data.unitPrice,
        source: data.source,
        formula: data.formula,
        defaultCapacitor: data.capacitor || '',
    };
}

function resolveCapacitorModel(partsCatalog, explicitModel, coilSnapshot) {
    if (explicitModel) return explicitModel;
    const capValue = capacitorValueFromModel(coilSnapshot?.defaultCapacitor);
    if (capValue == null) return '';
    const caps = (partsCatalog || []).filter(part => part.category === '电容');
    const exact = caps.find(part => part.model === `${capValue}μF`);
    const fuzzy = exact || caps.find(part => capacitorValueFromModel(part.model) === capValue);
    return fuzzy?.model || '';
}

function normalizeSelectionList(value) {
    const list = Array.isArray(value) ? value : parseJson(value, []);
    return Array.isArray(list) ? list : [];
}

function resolveBarrelLength(inputValue, variant) {
    if (inputValue !== undefined && inputValue !== null && inputValue !== '') return inputValue;
    return variant?.barrelLength ?? null;
}

function buildRecipeBomDraft(input, context) {
    const partsCatalog = context.partsCatalog || [];
    const template = context.template || null;
    const variant = context.variant || null;
    const coils = context.coils || [];

    const customBarrelLength = resolveBarrelLength(input.customBarrelLength, variant);
    const longScrewExtraLength = input.longScrewExtraLength ?? variant?.longScrewExtraLength ?? DEFAULT_LONG_SCREW_EXTRA_LENGTH;
    const coilSpec = input.coilSpec ?? variant?.coilSpec ?? '';
    const coilSheets = input.coilSheets ?? variant?.coilSheets ?? '';
    const coilMaterial = input.coilMaterial ?? variant?.coilMaterial ?? DEFAULT_COIL_MATERIAL;
    const costMode = template?.costMode || 'components';
    const shellComponents = normalizeSelectionList(template?.shellComponentsJson);
    const templateParts = normalizeSelectionList(template?.partsJson)
        .map(part => applyLongScrewRule(part, customBarrelLength, longScrewExtraLength));

    const shellPrice = template
        ? (costMode === 'bundle'
            ? Number(template.bundleCost || 0)
            : shellComponents.reduce((sum, component) => {
                if (component.included === false) return sum;
                return sum + Number(component.unitCost || 0) * lengthCmQty(component, customBarrelLength);
            }, 0))
        : 0;

    const bomParts = [];
    if (template) {
        if (costMode === 'bundle') {
            bomParts.push({ model: template.shellModel, name: '泵壳整套', supplier: '', qty: 1, snapshotPrice: shellPrice, source: 'pump_shell_template', costSource: 'manual' });
        } else {
            shellComponents.forEach(component => {
                if (component.included === false) return;
                bomParts.push({
                    model: component.model || component.name,
                    name: component.pricingMode === 'lengthCm' ? `${component.name}(按cm)` : component.name,
                    supplier: '',
                    qty: lengthCmQty(component, customBarrelLength),
                    snapshotPrice: Number(component.unitCost || 0),
                    source: 'pump_shell_template',
                    costSource: 'manual',
                });
            });
        }
    }

    templateParts.forEach(part => {
        const supplier = part.supplier || '';
        bomParts.push({ model: part.model, name: part.name, supplier, qty: Number(part.qty || 1), snapshotPrice: getPriceByModelAndSupplier(partsCatalog, part.model, supplier) });
    });

    const coilSnapshot = input.coilResult || calculateCoilSnapshot(coils, coilSpec, coilSheets, coilMaterial);
    const capacitorModel = resolveCapacitorModel(partsCatalog, input.capacitorModel, coilSnapshot);
    if (capacitorModel) {
        bomParts.push({ model: capacitorModel, name: '电容', supplier: '', qty: 1, snapshotPrice: getPriceByModelAndSupplier(partsCatalog, capacitorModel, '') });
    }
    if (coilSnapshot && coilSpec && coilSheets) {
        bomParts.push({
            model: `${coilSpec}-${coilSheets}`,
            name: '线圈转子',
            supplier: '',
            qty: 1,
            snapshotPrice: Number(coilSnapshot.totalCost || 0),
            material: coilSnapshot.material || coilMaterial || DEFAULT_COIL_MATERIAL,
            unitPrice: coilSnapshot.unitPrice,
            source: coilSnapshot.source,
            formula: coilSnapshot.formula,
        });
    }

    normalizeSelectionList(input.optionalParts || input.extraParts).forEach(part => {
        if (!part.model) return;
        const manualPrice = part.costSource === 'manual' && part.snapshotPrice !== undefined
            ? Number(part.snapshotPrice || 0)
            : undefined;
        bomParts.push({
            model: part.model,
            name: part.model,
            supplier: part.supplier || '',
            qty: Number(part.qty || 1),
            snapshotPrice: manualPrice ?? getPriceByModelAndSupplier(partsCatalog, part.model, part.supplier || ''),
            ...(manualPrice !== undefined ? { costSource: 'manual' } : {}),
        });
    });

    if (toBool(input.hasFloat)) {
        const model = wireModel('浮球', input.floatWire || '');
        const accessoryType = input.floatAccessoryType || 'standard';
        const basePrice = getPriceByModelAndSupplier(partsCatalog, model, '');
        const delta = accessoryType === 'xinjie' ? Number(input.floatAccessoryDelta || 0) : 0;
        bomParts.push({ model, name: accessoryType === 'xinjie' ? '浮球-新界式' : '浮球', supplier: '', qty: 1, snapshotPrice: basePrice + delta, floatAccessoryType: accessoryType, floatAccessoryDelta: delta });
    }

    if (toBool(input.hasCable) && Number(input.cableLength || 0) > 0) {
        const model = wireModel('电缆', input.cableWire || '');
        const accessoryType = input.cableAccessoryType || 'standard';
        bomParts.push({ model, name: '电缆线', supplier: '', qty: Number(input.cableLength || 0), snapshotPrice: getPriceByModelAndSupplier(partsCatalog, model, '') });
        bomParts.push({ model: '电缆配件费', name: getCableAccessoryName(partsCatalog, model, '', accessoryType), supplier: '', qty: 1, snapshotPrice: getCableAccessoryFee(partsCatalog, model, '', accessoryType), cableAccessoryType: accessoryType });
    }

    normalizeSelectionList(input.packingParts || input.packingPartsJson).forEach(part => {
        if (!part.model) return;
        const isManual = part.costSource === 'manual';
        const packagingMaterial = inferPackingMaterial(part.model, part.packagingMaterial);
        bomParts.push({
            model: part.model,
            name: `${part.model}（${packagingMaterial}）`,
            supplier: part.supplier || '',
            qty: Number(part.qty || 1),
            snapshotPrice: isManual || part.snapshotPrice !== undefined ? Number(part.snapshotPrice || 0) : getPriceByModelAndSupplier(partsCatalog, part.model, part.supplier || ''),
            packagingMaterial,
            ...(isManual ? { costSource: 'manual', source: 'manual' } : {}),
        });
    });

    return {
        parts: bomParts,
        shellPrice: roundMoney(shellPrice),
        templateParts,
        shellComponents,
        coilSnapshot,
        capacitorModel,
        customBarrelLength: customBarrelLength != null ? Number(customBarrelLength) : null,
        longScrewExtraLength: Number(longScrewExtraLength || 0),
    };
}

module.exports = {
    buildRecipeBomDraft,
    calculateCoilSnapshot,
    getPriceByModelAndSupplier,
    inferPackingMaterial,
    lengthCmQty,
};
