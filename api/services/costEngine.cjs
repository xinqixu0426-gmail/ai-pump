const {
    parseCableAccessoryFee,
    getGlobalCableAccessory,
    getCableAccessoryFeeFromPartsByModel,
} = require('./cableAccessory.cjs');

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

const DEFAULT_LONG_SCREW_EXTRA_LENGTH = 0;
const LONG_SCREW_LENGTH_STEP_MM = 5;
const SCREW_LENGTH_PRICE_FACTOR = 0.00424;
const SCREW_LENGTH_PRICE_OFFSET = -0.198;
const DEFAULT_PACKAGING_MATERIAL = '牛皮纸箱';

function parseNonNegativeNumber(value, field, { required = false, defaultValue = 0 } = {}) {
    if ((value === undefined || value === null || value === '') && !required) return defaultValue;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${field} 必须是非负数字`);
    return number;
}

function createPartPriceGetter(partsByModel) {
    return (model, supplier = '') => {
        const candidates = partsByModel[model] || [];
        const normalizedSupplier = String(supplier || '').trim();
        const exact = candidates.find(part => String(part.supplier || '').trim() === normalizedSupplier);
        if (exact && normalizedSupplier) return Number(exact.price || 0);
        if (candidates.length === 0) return 0;
        return Number(candidates.reduce((min, part) => part.price < min.price ? part : min, candidates[0]).price || 0);
    };
}

function findPartByModelAndSupplierFromCatalog(partsCatalog, model, supplier = '') {
    const targetModel = String(model || '').trim();
    const targetSupplier = String(supplier || '').trim();
    const candidates = (partsCatalog || []).filter(part => String(part.model || '').trim() === targetModel);
    const exact = candidates.find(part => targetSupplier && String(part.supplier || '').trim() === targetSupplier);
    if (exact) return exact;
    if (candidates.length === 0) return null;
    return candidates.reduce((min, part) => Number(part.price || 0) < Number(min.price || 0) ? part : min, candidates[0]);
}

function getPartPriceFromCatalog(partsCatalog, model, supplier = '') {
    const screwPrice = longScrewPriceByModel(partsCatalog, model, supplier);
    if (screwPrice) return screwPrice.unitPrice;
    const part = findPartByModelAndSupplierFromCatalog(partsCatalog, model, supplier);
    return part ? Number(part.price || 0) : 0;
}

function wireModel(prefix, wire) {
    return `${prefix}-线径${wire || ''}`;
}

function configuredWireModel(prefix, wireOrModel, resolvedWire) {
    const value = String(wireOrModel || '').trim();
    if (value.startsWith(prefix)) return value;
    const wire = value || resolvedWire;
    return wire ? wireModel(prefix, wire) : '';
}

function inferPackingMaterial(model = '', material) {
    if (material) return material;
    if (String(model).includes('木箱')) return '木箱';
    if (String(model).includes('彩')) return '彩印纸箱';
    return DEFAULT_PACKAGING_MATERIAL;
}

function lengthPricedPartSubtotal(part, customBarrelLength) {
    const price = Number(part?.snapshotPrice || 0);
    const savedQty = Number(part?.qty || 0);
    const nextQty = customBarrelLength && Number(customBarrelLength) > 0 ? Number(customBarrelLength) / 10 : savedQty;
    return price * nextQty;
}

function calculatePackingEstimate(body, partsByModel) {
    const getPrice = createPartPriceGetter(partsByModel);
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (parts.length === 0) throw new Error('parts 必须是非空数组');
    const details = parts.map(part => {
        if (!part?.model) throw new Error('每个包材必须包含 model');
        const qty = parseNonNegativeNumber(part.qty, 'qty', { defaultValue: 1 });
        const unitPrice = part.snapshotPrice !== undefined
            ? parseNonNegativeNumber(part.snapshotPrice, 'snapshotPrice')
            : getPrice(part.model, part.supplier);
        return {
            model: part.model,
            supplier: part.supplier || '',
            qty,
            unitPrice,
            subtotal: roundMoney(unitPrice * qty)
        };
    });
    return { details, totalCost: roundMoney(details.reduce((sum, part) => sum + part.subtotal, 0)) };
}

function calculateOverheadEstimate(body) {
    const assemblyWage = parseNonNegativeNumber(body.assemblyWage, 'assemblyWage');
    const packingWage = parseNonNegativeNumber(body.packingWage, 'packingWage');
    const surfaceTreatmentCost = parseNonNegativeNumber(body.surfaceTreatmentCost ?? body.paintingWage, 'surfaceTreatmentCost');
    const managementFee = parseNonNegativeNumber(body.managementFee, 'managementFee');
    const details = [
        { name: '安装工资', amount: assemblyWage },
        { name: '打包工资', amount: packingWage },
        { name: '表面处理', amount: surfaceTreatmentCost },
        { name: '管理费', amount: managementFee },
    ];
    return { details, totalCost: roundMoney(details.reduce((sum, item) => sum + item.amount, 0)) };
}

function formatLengthMm(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function roundLengthToStep(value, step = LONG_SCREW_LENGTH_STEP_MM) {
    const length = Number(value);
    const interval = Number(step);
    if (!Number.isFinite(length) || length <= 0) return 0;
    if (!Number.isFinite(interval) || interval <= 0) return length;
    return Math.ceil(length / interval) * interval;
}

function isLongScrewPart(part) {
    return `${part?.name || ''}${part?.model || ''}`.includes('长螺丝');
}

function longScrewModelFromBarrel(part, barrelLength, extraLength = DEFAULT_LONG_SCREW_EXTRA_LENGTH) {
    const barrel = Number(barrelLength || 0);
    const extra = Number(extraLength || 0);
    if (!Number.isFinite(barrel) || barrel <= 0) return null;
    const requestedLength = barrel + extra;
    if (!Number.isFinite(requestedLength) || requestedLength <= 0) return null;

    const prefixMatch = String(part?.model || '').match(/^(.+?\*)/);
    const prefix = prefixMatch ? prefixMatch[1] : '6*';
    return {
        model: `${prefix}${formatLengthMm(requestedLength)}`,
        requestedLength,
        screwLength: requestedLength,
    };
}

function applyLongScrewRule(part, barrelLength, extraLength = DEFAULT_LONG_SCREW_EXTRA_LENGTH) {
    if (!isLongScrewPart(part)) return part;
    const result = longScrewModelFromBarrel(part, barrelLength, extraLength);
    if (!result) return part;
    return {
        ...part,
        model: result.model,
        dynamicRule: 'longScrewByBarrelLength',
        barrelLength: Number(barrelLength || 0),
        longScrewExtraLength: Number(extraLength || 0),
        requestedScrewLength: result.requestedLength,
        screwLength: result.screwLength,
    };
}

function parseScrewPricingMeta(notes) {
    if (!notes) return null;
    try {
        const pricing = JSON.parse(notes)?.screwPricing;
        if (!pricing?.enabled) return null;
        const diameter = Number(pricing.diameter);
        if (!Number.isFinite(diameter) || diameter <= 0) return null;
        return { enabled: true, diameter, modelPrefix: pricing.modelPrefix };
    } catch {
        return null;
    }
}

function screwDiameterFromModel(model) {
    const match = String(model || '').match(/^(\d+(?:\.\d+)?)\*/);
    const diameter = match ? Number(match[1]) : NaN;
    return Number.isFinite(diameter) && diameter > 0 ? diameter : null;
}

function screwLengthFromModel(model) {
    const match = String(model || '').match(/\*(\d+(?:\.\d+)?)$/);
    const length = match ? Number(match[1]) : NaN;
    return Number.isFinite(length) && length > 0 ? length : null;
}

function calculateScrewUnitPrice(basePrice, length, pricing) {
    const screwLength = Number(length || 0);
    if (!Number.isFinite(screwLength) || screwLength <= 0) return 0;
    return roundMoney(Math.max(0, SCREW_LENGTH_PRICE_FACTOR * screwLength + SCREW_LENGTH_PRICE_OFFSET));
}

function findScrewPricingPart(partsCatalog, model, supplier = '') {
    const diameter = screwDiameterFromModel(model);
    if (!diameter || !Array.isArray(partsCatalog)) return null;
    const candidates = partsCatalog
        .map(part => ({ part, pricing: parseScrewPricingMeta(part.notes || part.remark) }))
        .filter(item => item.pricing && item.part.category === '螺丝' && Number(item.pricing.diameter) === diameter);
    if (candidates.length === 0) return null;
    const normalizedSupplier = String(supplier || '').trim();
    const exact = candidates.find(item => normalizedSupplier && String(item.part.supplier || '').trim() === normalizedSupplier);
    return exact || candidates.reduce((min, item) => Number(item.part.price || 0) < Number(min.part.price || 0) ? item : min, candidates[0]);
}

function longScrewPriceByModel(partsCatalog, model, supplier = '') {
    const length = screwLengthFromModel(model);
    if (!length) return null;
    const matched = findScrewPricingPart(partsCatalog, model, supplier);
    if (!matched) return null;
    return {
        unitPrice: calculateScrewUnitPrice(matched.part.price, length, matched.pricing),
        pricingPartModel: matched.part.model,
        pricingSupplier: matched.part.supplier || '',
    };
}

function longScrewFormulaPriceByModel(model) {
    const length = screwLengthFromModel(model);
    if (!length) return null;
    return {
        unitPrice: calculateScrewUnitPrice(0, length, { enabled: true, diameter: screwDiameterFromModel(model) }),
        pricingPartModel: '',
        pricingSupplier: '',
    };
}

function getCableAccessoryFee(partsByModel, cableModel, supplier, accessoryType = 'standard', getSetting = () => undefined) {
    return getCableAccessoryFeeFromPartsByModel(partsByModel, cableModel, supplier, accessoryType, getSetting);
}

function isCableAccessoryPart(part) {
    const model = String(part?.model || '');
    const name = String(part?.name || '');
    return model === '电缆配件费' || name.includes('电缆接头配件');
}

function findCablePart(parts) {
    return parts.find(part => String(part?.model || '').startsWith('电缆-') || String(part?.name || '').includes('电缆线'));
}

function getFloatAccessoryDelta(accessoryType = 'standard', getSetting = () => undefined) {
    if (accessoryType !== 'xinjie') return 0;
    const delta = Number(getSetting('float_accessory_delta'));
    return Number.isFinite(delta) && delta >= 0 ? delta : 0;
}

function isFloatPart(part) {
    const model = String(part?.model || '');
    const name = String(part?.name || '');
    return model.startsWith('浮球-') || name === '浮球';
}

function partsCatalogFromPartsByModel(partsByModel) {
    return Object.entries(partsByModel || {}).flatMap(([model, suppliers]) => (
        (suppliers || []).map(part => ({ ...part, model: part.model || model }))
    ));
}

function calculateRecipeCost(parts, partsCache = {}, partsByModel = {}, options = {}) {
    const getSetting = options.getSetting || (() => undefined);
    let totalCost = 0;
    const details = [];
    const missingParts = [];
    const partsCatalog = options.partsCatalog || partsCatalogFromPartsByModel(partsByModel);
    (parts || []).forEach(p => {
        const suppliers = partsByModel[p.model] || [];
        const match = suppliers.find(s => (s.supplier || '').trim() === (p.supplier || '').trim());
        let price = 0, source = '';
        if ((p.source === 'pump_shell_template' || p.costSource === 'manual') && p.snapshotPrice !== undefined) {
            price = p.snapshotPrice;
            source = p.costSource === 'manual' ? '手动估算价' : '模板手动价';
        } else if (isCableAccessoryPart(p)) {
            const cablePart = findCablePart(parts);
            price = getCableAccessoryFee(partsByModel, cablePart?.model || '', cablePart?.supplier || '', p.cableAccessoryType, getSetting);
            source = '电缆线配件费';
        } else if (isFloatPart(p)) {
            if (match && p.supplier) {
                price = match.price;
                source = '精确匹配';
            } else if (suppliers.length > 0) {
                const fb = suppliers.reduce((min, c) => c.price < min.price ? c : min, suppliers[0]);
                price = fb.price;
                source = '型号回退(取最低价)';
            } else if (p.snapshotPrice !== undefined) {
                price = p.snapshotPrice;
                source = '快照价格';
            } else {
                missingParts.push(p.model);
                source = '未找到';
            }
            if (source !== '快照价格') price += getFloatAccessoryDelta(p.floatAccessoryType, getSetting);
            if (p.floatAccessoryType === 'xinjie') source += '+新界式';
        } else if (isLongScrewPart(p)) {
            const screwPricing = longScrewPriceByModel(partsCatalog, p.model, p.supplier) || longScrewFormulaPriceByModel(p.model);
            if (screwPricing) {
                price = screwPricing.unitPrice;
                source = screwPricing.pricingPartModel ? `参数化螺丝(${screwPricing.pricingPartModel})` : '长螺丝公式价';
            } else if (p.snapshotPrice !== undefined) {
                price = p.snapshotPrice;
                source = '快照价格';
            } else {
                missingParts.push(p.model);
                source = '未找到';
            }
        } else if (match && p.supplier) {
            price = match.price;
            source = '精确匹配';
        } else if (suppliers.length > 0) {
            const fb = suppliers.reduce((min, c) => c.price < min.price ? c : min, suppliers[0]);
            price = fb.price;
            source = '型号回退(取最低价)';
        } else if ((p.name === '线圈转子' || p.name === '电容') && p.snapshotPrice !== undefined) {
            price = p.snapshotPrice;
            source = '快照价格';
        } else {
            missingParts.push(p.model);
            source = '未找到';
        }
        const qty = Number(p.qty || 0);
        const subtotal = Number(price || 0) * qty;
        totalCost += subtotal;
        details.push({ name: p.name || p.model, model: p.model, supplier: p.supplier || '-', price: parseFloat(price).toFixed(2), qty: p.qty, subtotal: subtotal.toFixed(2), source });
    });
    return { totalCost: totalCost.toFixed(2), itemCount: (parts || []).length, details, missingParts };
}

const SURFACE_TREATMENT_LABELS = {
    none: '无处理',
    painting: '喷漆',
    electrophoresis: '电泳',
    powder_coating: '喷塑',
    electrophoresis_powder_coating: '电泳+喷塑',
};

function normalizeRecipeParts(parts) {
    if (!Array.isArray(parts)) throw new Error('parts 必须是数组');
    return parts.map(part => ({
        ...part,
        model: String(part?.model || ''),
        name: String(part?.name || part?.model || ''),
        supplier: String(part?.supplier || ''),
        qty: parseNonNegativeNumber(part?.qty, 'qty', { defaultValue: 1 }),
        snapshotPrice: part?.snapshotPrice !== undefined ? parseNonNegativeNumber(part.snapshotPrice, 'snapshotPrice') : undefined,
    }));
}

function applyScrewPricing(part, partsCatalog) {
    if (!isLongScrewPart(part)) return part;
    const pricing = longScrewPriceByModel(partsCatalog, part.model, part.supplier) || longScrewFormulaPriceByModel(part.model);
    if (!pricing) return part;
    return {
        ...part,
        snapshotPrice: pricing.unitPrice,
        costSource: pricing.pricingPartModel ? 'screw_pricing' : 'screw_formula',
        screwPricingModel: pricing.pricingPartModel,
        screwPricingSupplier: pricing.pricingSupplier,
    };
}

function buildRecipeCostDraft(input, options = {}) {
    const barrelLength = input.customBarrelLength ?? input.barrelLength;
    const longScrewExtraLength = input.longScrewExtraLength ?? DEFAULT_LONG_SCREW_EXTRA_LENGTH;
    const partsCatalog = options.partsCatalog || input.partsCatalog || [];
    const parts = normalizeRecipeParts(input.parts || [])
        .map(part => applyLongScrewRule(part, barrelLength, longScrewExtraLength))
        .map(part => applyScrewPricing(part, partsCatalog));
    const assemblyWage = parseNonNegativeNumber(input.assemblyWage, 'assemblyWage');
    const packingWage = parseNonNegativeNumber(input.packingWage, 'packingWage');
    const surfaceTreatmentMode = input.surfaceTreatmentMode || 'none';
    const surfaceTreatmentCost = surfaceTreatmentMode === 'none'
        ? 0
        : parseNonNegativeNumber(input.surfaceTreatmentCost, 'surfaceTreatmentCost');
    const managementFee = parseNonNegativeNumber(input.managementFee, 'managementFee');
    const coilMaterial = input.coilMaterial || '钢带';

    const partsCost = parts.reduce((sum, part) => sum + Number(part.snapshotPrice || 0) * Number(part.qty || 1), 0);
    const laborCost = assemblyWage + packingWage + surfaceTreatmentCost + managementFee;
    const savedTotalCost = roundMoney(partsCost + laborCost);

    const wageLines = [
        `安装工资: ¥${assemblyWage.toFixed(2)}`,
        `打包工资: ¥${packingWage.toFixed(2)}`,
    ];
    if (surfaceTreatmentMode !== 'none') {
        const label = SURFACE_TREATMENT_LABELS[surfaceTreatmentMode] || surfaceTreatmentMode;
        wageLines.push(`表面处理(${label}): ¥${surfaceTreatmentCost.toFixed(2)}`);
    }
    wageLines.push(`管理费用: ¥${managementFee.toFixed(2)}`);

    const savedCostDetails = parts
        .map(part => {
            const price = Number(part.snapshotPrice || 0);
            const qty = Number(part.qty || 1);
            const base = `${part.name || part.model}: ¥${price.toFixed(2)} × ${qty} = ¥${(price * qty).toFixed(2)}`;
            if (part.name === '线圈转子') {
                return `${base}（材质: ${part.material || coilMaterial || '钢带'}，单价: ¥${Number(part.unitPrice || 0).toFixed(2)}，来源: ${part.source || '-'}，公式: ${part.formula || '-'}）`;
            }
            if (part.dynamicRule === 'longScrewByBarrelLength') {
                const pricingText = part.costSource === 'screw_pricing' || part.costSource === 'screw_formula'
                    ? `，按长度计价${part.screwPricingModel ? `: ${part.screwPricingModel}` : ''}，公式≈0.00424×长度-0.198`
                    : '';
                return `${base}（机筒: ${part.barrelLength}mm，补偿: ${part.longScrewExtraLength}mm，长螺丝: ${part.screwLength}mm${pricingText}）`;
            }
            return base;
        })
        .concat(wageLines)
        .join('\n');

    return {
        parts,
        partsCost: roundMoney(partsCost),
        laborCost: roundMoney(laborCost),
        savedTotalCost,
        savedCostDetails,
    };
}

module.exports = {
    DEFAULT_LONG_SCREW_EXTRA_LENGTH,
    LONG_SCREW_LENGTH_STEP_MM,
    DEFAULT_PACKAGING_MATERIAL,
    roundMoney,
    parseNonNegativeNumber,
    createPartPriceGetter,
    findPartByModelAndSupplierFromCatalog,
    getPartPriceFromCatalog,
    wireModel,
    configuredWireModel,
    inferPackingMaterial,
    lengthPricedPartSubtotal,
    calculatePackingEstimate,
    calculateOverheadEstimate,
    formatLengthMm,
    roundLengthToStep,
    isLongScrewPart,
    longScrewModelFromBarrel,
    applyLongScrewRule,
    parseScrewPricingMeta,
    screwDiameterFromModel,
    screwLengthFromModel,
    calculateScrewUnitPrice,
    findScrewPricingPart,
    longScrewPriceByModel,
    parseCableAccessoryFee,
    getGlobalCableAccessory,
    getCableAccessoryFee,
    isCableAccessoryPart,
    findCablePart,
    getFloatAccessoryDelta,
    isFloatPart,
    partsCatalogFromPartsByModel,
    calculateRecipeCost,
    buildRecipeCostDraft,
};
