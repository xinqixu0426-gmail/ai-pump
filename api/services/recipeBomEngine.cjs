const {
    DEFAULT_LONG_SCREW_EXTRA_LENGTH,
    applyLongScrewRule,
    applyStainlessShellBundleRule,
    roundMoney,
    wireModel,
    inferPackingMaterial,
    getPartPriceFromCatalog,
} = require('./costEngine.cjs');
const {
    buildCompleteCablePart,
    getCableAccessoryFeeFromCatalog,
    getCableAccessoryNameFromCatalog,
} = require('./cableAccessory.cjs');
const {
    DEFAULT_COIL_MATERIAL,
    calculateCoilCost,
} = require('./coilCost.cjs');

// BOM 草稿口径：根据模板、常用配置和表单选择展开标准化 parts。
// 这里只负责组装和带入当前参考价；真正保存成本快照必须再走 buildRecipeCostDraft。

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
    if (isStainlessStretchBarrelComponent(component)) {
        return Number(customBarrelLength || Number(component.qty || 0) * 10) / 10;
    }
    return Number(component.qty || 1);
}

function isStainlessStretchBarrelComponent(component) {
    return component?.componentType === 'stainlessStretchBarrel'
        || component?.isStainlessStretchBarrel === true;
}

function componentUnitPrice(partsCatalog, component) {
    const model = String(component?.model || '').trim();
    const supplier = String(component?.supplier || '').trim();
    const shellComponentCatalog = (partsCatalog || []).filter(part => part.category === '泵壳搭配');
    const catalogPrice = model ? getPriceByModelAndSupplier(shellComponentCatalog, model, supplier) : 0;
    if (catalogPrice > 0) {
        return { price: catalogPrice, costSource: 'catalog' };
    }
    return { price: Number(component?.unitCost || 0), costSource: 'manual' };
}

function calculateCoilSnapshot(coils, spec, sheets, material = DEFAULT_COIL_MATERIAL, options = {}) {
    const result = calculateCoilCost(coils, { spec, sheets, material, ...options });
    if (!result.success) return null;
    const data = result.data;
    return {
        totalCost: roundMoney(data.totalCost),
        material: data.material || material || DEFAULT_COIL_MATERIAL,
        unitPrice: data.unitPrice,
        wireWeight: data.wireWeight,
        source: data.source,
        formula: data.formula,
        wireGauge: data.wireGauge || '',
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
    const shellMeta = context.shellMeta || null;

    const customBarrelLength = resolveBarrelLength(input.customBarrelLength, variant);
    const longScrewExtraLength = input.longScrewExtraLength ?? variant?.longScrewExtraLength ?? DEFAULT_LONG_SCREW_EXTRA_LENGTH;
    const coilSpec = input.coilSpec ?? variant?.coilSpec ?? '';
    const coilSheets = input.coilSheets ?? variant?.coilSheets ?? '';
    const coilMaterial = input.coilMaterial ?? variant?.coilMaterial ?? DEFAULT_COIL_MATERIAL;
    const costMode = template?.costMode || 'components';
    const shellComponents = normalizeSelectionList(template?.shellComponentsJson);
    const hasStainlessStretchBarrelComponent = shellComponents.some(component => component?.included !== false && isStainlessStretchBarrelComponent(component));
    const shouldApplyLongScrewRule = costMode === 'components'
        ? hasStainlessStretchBarrelComponent
        : shellMeta?.isStainless === true;
    const templateParts = normalizeSelectionList(template?.partsJson)
        .map(part => shouldApplyLongScrewRule ? applyLongScrewRule(part, customBarrelLength, longScrewExtraLength) : part);

    const baseShellPrice = template
        ? (costMode === 'bundle'
            ? Number(template.bundleCost || 0)
            : shellComponents.reduce((sum, component) => {
                if (component.included === false) return sum;
                const { price } = componentUnitPrice(partsCatalog, component);
                return sum + price * lengthCmQty(component, customBarrelLength);
            }, 0))
        : 0;
    const shellBundlePart = template && costMode === 'bundle'
        ? applyStainlessShellBundleRule({
            model: template.shellModel,
            name: '泵壳套件',
            supplier: '',
            qty: 1,
            snapshotPrice: baseShellPrice,
            baseSnapshotPrice: baseShellPrice,
            source: 'pump_shell_template',
            costSource: 'manual',
            ...(shellMeta?.isStainless ? { dynamicRule: 'stainlessShellBundleByBarrelLength' } : {}),
        }, customBarrelLength)
        : null;
    const shellPrice = shellBundlePart ? Number(shellBundlePart.snapshotPrice || 0) : baseShellPrice;

    const bomParts = [];
    if (template) {
        if (costMode === 'bundle') {
            bomParts.push({
                ...shellBundlePart,
                formula: shellBundlePart.formula || `泵壳套件价 ${roundMoney(shellPrice)}`,
            });
        } else {
            shellComponents.forEach(component => {
                if (component.included === false) return;
                const qty = lengthCmQty(component, customBarrelLength);
                const { price: unitCost, costSource } = componentUnitPrice(partsCatalog, component);
                const isVariableStainlessBarrel = isStainlessStretchBarrelComponent(component) && component.pricingMode === 'lengthCm';
                bomParts.push({
                    model: component.model || component.name,
                    name: component.pricingMode === 'lengthCm' ? `${component.name}(按cm)` : component.name,
                    supplier: component.supplier || '',
                    qty,
                    snapshotPrice: unitCost,
                    source: 'pump_shell_template',
                    costSource,
                    ...(isVariableStainlessBarrel ? {
                        dynamicRule: 'stainlessStretchBarrelByLength',
                        barrelLength: Number(customBarrelLength || 0) || null,
                    } : {}),
                    formula: component.pricingMode === 'lengthCm'
                        ? `${component.name}: ${unitCost}×${qty}cm${isVariableStainlessBarrel ? '（长度来自配方/型号变体）' : ''}`
                        : `${component.name}: ${unitCost}×${qty}`,
                });
            });
        }
    }

    templateParts.forEach(part => {
        const supplier = part.supplier || '';
        bomParts.push({
            model: part.model,
            name: part.name,
            supplier,
            qty: Number(part.qty || 1),
            snapshotPrice: getPriceByModelAndSupplier(partsCatalog, part.model, supplier),
            ...(part.dynamicRule === 'longScrewByBarrelLength' ? {
                dynamicRule: part.dynamicRule,
                barrelLength: part.barrelLength,
                longScrewExtraLength: part.longScrewExtraLength,
                screwLength: part.screwLength,
                formula: `长螺丝长度=${part.barrelLength || 0}+${part.longScrewExtraLength || 0}=${part.screwLength || 0}mm`,
            } : {}),
        });
    });

    const customWireWeight = input.coilWireWeight !== undefined && input.coilWireWeight !== null && input.coilWireWeight !== ''
        ? Number(input.coilWireWeight)
        : null;
    const coilSnapshot = input.coilResult || calculateCoilSnapshot(coils, coilSpec, coilSheets, coilMaterial, {
        ...(customWireWeight != null && Number.isFinite(customWireWeight) ? { wireWeight: customWireWeight } : {}),
    });
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
            ...(manualPrice !== undefined ? { costSource: 'manual', formula: `手输价 ${manualPrice}` } : {}),
        });
    });

    if (toBool(input.hasFloat)) {
        const model = wireModel('浮球', input.floatWire || '');
        const accessoryType = input.floatAccessoryType || 'standard';
        const basePrice = getPriceByModelAndSupplier(partsCatalog, model, '');
        const delta = accessoryType === 'xinjie' ? Number(input.floatAccessoryDelta || 0) : 0;
        bomParts.push({
            model,
            name: accessoryType === 'xinjie' ? '浮球-新界式' : '浮球',
            supplier: '',
            qty: 1,
            snapshotPrice: basePrice + delta,
            floatAccessoryType: accessoryType,
            floatAccessoryDelta: delta,
            ...(delta ? { formula: `浮球目录价 ${basePrice}+新界差价 ${delta}` } : {}),
        });
    }

    if (toBool(input.hasCable) && Number(input.cableLength || 0) > 0) {
        const model = wireModel('电缆', input.cableWire || '');
        const accessoryType = input.cableAccessoryType || 'standard';
        const cableLength = Number(input.cableLength || 0);
        const cablePrice = getPriceByModelAndSupplier(partsCatalog, model, '');
        bomParts.push({
            ...buildCompleteCablePart({
                model,
                cableLength,
                cableUnitPrice: cablePrice,
                accessoryType,
                accessoryName: getCableAccessoryName(partsCatalog, model, '', accessoryType),
                accessoryFee: getCableAccessoryFee(partsCatalog, model, '', accessoryType),
            }),
            cableAssembly: true,
        });
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
            ...(isManual ? { costSource: 'manual', source: 'manual', formula: `手输价 ${Number(part.snapshotPrice || 0)}` } : {}),
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
