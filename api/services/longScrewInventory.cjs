const {
    applyLongScrewRule,
    calculateScrewUnitPrice,
    isLongScrewPart,
    longScrewPriceByModel,
    screwDiameterFromModel,
    screwLengthFromModel,
} = require('./costEngine.cjs');

function parseJsonArray(value) {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function buildLongScrewPartRemark({ variant, part, pricing }) {
    return JSON.stringify({
        autoCreatedFrom: 'modelVariantLongScrew',
        modelVariantName: variant.model_name || variant.modelName || '',
        screwLength: part.screwLength,
        barrelLength: part.barrelLength,
        longScrewExtraLength: part.longScrewExtraLength,
        screwPricingModel: pricing.pricingPartModel,
        screwPricingSupplier: pricing.pricingSupplier,
    });
}

function buildRecipeLongScrewPartRemark({ recipeName, part, pricing }) {
    return JSON.stringify({
        autoCreatedFrom: 'recipeLongScrew',
        recipeName: recipeName || '',
        screwLength: part.screwLength || part.requestedScrewLength || null,
        barrelLength: part.barrelLength,
        longScrewExtraLength: part.longScrewExtraLength,
        screwPricingModel: pricing?.pricingPartModel || part.screwPricingModel || '',
        screwPricingSupplier: pricing?.pricingSupplier || part.screwPricingSupplier || '',
    });
}

function findSupplierByDiameter(partsCatalog, model) {
    const diameter = screwDiameterFromModel(model);
    if (!diameter) return '';
    const match = (partsCatalog || []).find(part => (
        part.category === '螺丝'
        && String(part.supplier || '').trim()
        && screwDiameterFromModel(part.model) === diameter
    ));
    return match?.supplier || '';
}

function resolveLongScrewPricing(partsCatalog, model, supplier = '') {
    const pricing = longScrewPriceByModel(partsCatalog, model, supplier);
    if (pricing) return pricing;
    const length = screwLengthFromModel(model);
    if (!length) return null;
    const unitPrice = calculateScrewUnitPrice(0, length, { enabled: true, diameter: screwDiameterFromModel(model) });
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
    return {
        unitPrice,
        pricingPartModel: '',
        pricingSupplier: findSupplierByDiameter(partsCatalog, model),
    };
}

function buildLongScrewInventoryParts({ variant, template, partsCatalog }) {
    const barrelLength = variant?.barrel_length ?? variant?.barrelLength;
    if (!barrelLength) return [];

    const templateParts = parseJsonArray(template?.parts_json ?? template?.partsJson);
    const results = [];
    const seen = new Set();
    templateParts
        .filter(isLongScrewPart)
        .map(part => applyLongScrewRule(part, barrelLength, variant?.long_screw_extra_length ?? variant?.longScrewExtraLength ?? 0))
        .forEach(part => {
            const model = String(part.model || '').trim();
            if (!model || seen.has(model)) return;
            const pricing = resolveLongScrewPricing(partsCatalog, model, part.supplier || '');
            if (!pricing || pricing.unitPrice <= 0) return;
            seen.add(model);
            results.push({
                model,
                category: '螺丝',
                price: pricing.unitPrice,
                supplier: pricing.pricingSupplier || part.supplier || '-',
                stock: 0,
                remark: buildLongScrewPartRemark({ variant, part, pricing }),
            });
        });
    return results;
}

function buildLongScrewInventoryPartsFromRecipe({ recipeName, parts, partsCatalog }) {
    const results = [];
    const seen = new Set();
    (Array.isArray(parts) ? parts : [])
        .filter(isLongScrewPart)
        .forEach(part => {
            const model = String(part.model || '').trim();
            if (!model || seen.has(model)) return;
            const pricing = resolveLongScrewPricing(partsCatalog, model, part.supplier || '');
            const snapshotPrice = Number(part.snapshotPrice);
            const price = Number.isFinite(snapshotPrice) && snapshotPrice > 0
                ? snapshotPrice
                : pricing?.unitPrice;
            if (!Number.isFinite(price) || price <= 0) return;
            seen.add(model);
            results.push({
                model,
                category: '螺丝',
                price,
                supplier: part.screwPricingSupplier || pricing?.pricingSupplier || part.supplier || '-',
                stock: 0,
                remark: buildRecipeLongScrewPartRemark({ recipeName, part, pricing }),
            });
        });
    return results;
}

module.exports = {
    buildLongScrewInventoryParts,
    buildLongScrewInventoryPartsFromRecipe,
};
