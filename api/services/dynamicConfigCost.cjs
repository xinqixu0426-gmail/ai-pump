const {
    parseNonNegativeNumber,
    createPartPriceGetter,
    getCableAccessoryFee,
    getFloatAccessoryDelta,
    wireModel,
} = require('./costEngine.cjs');
const {
    getCableAccessoryNameFromPartsByModel,
} = require('./cableAccessory.cjs');

function normalizeCableAccessoryType(value) {
    const type = value || 'standard';
    if (!['standard', 'xinjie'].includes(type)) throw new Error('cableAccessoryType 必须是 standard 或 xinjie');
    return type;
}

function normalizeFloatAccessoryType(value) {
    const type = value || 'standard';
    if (!['standard', 'xinjie'].includes(type)) throw new Error('floatAccessoryType 必须是 standard 或 xinjie');
    return type;
}

function getCableAccessoryName(partsByModel, cableModel, supplier, accessoryType = 'standard', getSetting = () => undefined) {
    return getCableAccessoryNameFromPartsByModel(partsByModel, cableModel, supplier, accessoryType, getSetting);
}

function getFloatPrice(model, getPrice, accessoryType = 'standard', getSetting = () => undefined) {
    return getPrice(model) + getFloatAccessoryDelta(accessoryType, getSetting);
}

function findBoxMatch(boxType, partsCache, getPrice) {
    if (!boxType) return { model: '', price: 0 };
    let matchedModel = boxType;
    let price = getPrice(boxType);
    if (price !== 0) return { model: matchedModel, price };
    const keyword = String(boxType).trim();
    const candidates = [];
    for (const [model, info] of Object.entries(partsCache || {})) {
        if (info.category === '包装' && model.includes(keyword)) candidates.push({ model, price: info.price });
    }
    if (candidates.length > 0) {
        const best = candidates.reduce((min, c) => c.price < min.price ? c : min, candidates[0]);
        matchedModel = best.model;
        price = best.price;
    }
    return { model: matchedModel, price };
}

function calculateDynamicConfigCost(input, dependencies = {}) {
    const {
        hasFloat,
        floatWire,
        floatAccessoryType = 'standard',
        cableLength,
        cableWire,
        cableAccessoryType = 'standard',
        boxType,
        resolvedWire,
    } = input || {};
    const {
        partsCache = {},
        partsByModel = {},
        getSetting = () => undefined,
        getPrice = createPartPriceGetter(partsByModel),
    } = dependencies;

    let totalCost = 0;
    const details = [];
    const normalizedFloatAccessoryType = normalizeFloatAccessoryType(floatAccessoryType);

    if (hasFloat) {
        const wire = floatWire || resolvedWire;
        const model = wireModel('浮球', wire);
        const price = getFloatPrice(model, getPrice, normalizedFloatAccessoryType, getSetting);
        totalCost += price;
        details.push({
            name: normalizedFloatAccessoryType === 'xinjie' ? '浮球-新界式' : '浮球-普通铜套',
            model,
            price: price.toFixed(2),
            qty: 1,
            subtotal: price.toFixed(2),
            floatAccessoryType: normalizedFloatAccessoryType,
        });
    }

    const needCable = cableLength && Number(cableLength) > 0;
    if (needCable) {
        const wire = cableWire || resolvedWire;
        const cableModel = wireModel('电缆', wire);
        const unitPrice = getPrice(cableModel);
        const length = Number(cableLength);
        totalCost += unitPrice * length;
        details.push({ name: '电缆线', model: cableModel, price: unitPrice.toFixed(2), qty: length, subtotal: (unitPrice * length).toFixed(2) });
        const normalizedCableAccessoryType = normalizeCableAccessoryType(cableAccessoryType);
        const accessoryFee = getCableAccessoryFee(partsByModel, cableModel, '', normalizedCableAccessoryType, getSetting);
        const accessoryName = getCableAccessoryName(partsByModel, cableModel, '', normalizedCableAccessoryType, getSetting);
        totalCost += accessoryFee;
        details.push({ name: accessoryName, model: '电缆配件费', price: accessoryFee.toFixed(2), qty: 1, subtotal: accessoryFee.toFixed(2) });
    }

    if (boxType) {
        const matched = findBoxMatch(boxType, partsCache, getPrice);
        totalCost += matched.price;
        details.push({
            name: matched.model.includes('木') ? '木箱' : '纸箱',
            model: matched.model,
            price: matched.price.toFixed(2),
            qty: 1,
            subtotal: matched.price.toFixed(2),
        });
    }

    return { totalCost, details };
}

function calculateFloatEstimate(body, partsByModel, getSetting = () => undefined) {
    const wire = String(body.wire || body.floatWire || '0.55').trim();
    const model = String(body.model || wireModel('浮球', wire)).trim();
    const qty = parseNonNegativeNumber(body.qty, 'qty', { defaultValue: 1 });
    const getPrice = createPartPriceGetter(partsByModel);
    const floatAccessoryType = normalizeFloatAccessoryType(body.floatAccessoryType);
    const basePrice = getPrice(model, body.supplier);
    const accessoryDelta = getFloatAccessoryDelta(floatAccessoryType, getSetting);
    const unitPrice = basePrice + accessoryDelta;
    return { model, wire, supplier: body.supplier || '', qty, floatAccessoryType, basePrice, accessoryDelta, unitPrice, totalCost: Number((unitPrice * qty).toFixed(2)) };
}

function calculateCableEstimate(body, partsByModel, getSetting = () => undefined) {
    const wire = String(body.wire || body.cableWire || '0.55').trim();
    const model = String(body.model || wireModel('电缆', wire)).trim();
    const supplier = String(body.supplier || '').trim();
    const length = parseNonNegativeNumber(body.length ?? body.cableLength, 'length', { required: true });
    const cableAccessoryType = normalizeCableAccessoryType(body.cableAccessoryType);
    const getPrice = createPartPriceGetter(partsByModel);
    const unitPrice = getPrice(model, supplier);
    const cableSubtotal = unitPrice * length;
    const accessoryFee = getCableAccessoryFee(partsByModel, model, supplier, cableAccessoryType, getSetting);
    const accessoryName = getCableAccessoryName(partsByModel, model, supplier, cableAccessoryType, getSetting);
    return {
        model, wire, supplier, length, unitPrice,
        cableSubtotal: Number(cableSubtotal.toFixed(2)),
        cableAccessoryType, accessoryName, accessoryFee,
        totalCost: Number((cableSubtotal + accessoryFee).toFixed(2))
    };
}

module.exports = {
    normalizeCableAccessoryType,
    normalizeFloatAccessoryType,
    getCableAccessoryName,
    getFloatPrice,
    findBoxMatch,
    calculateDynamicConfigCost,
    calculateFloatEstimate,
    calculateCableEstimate,
};
