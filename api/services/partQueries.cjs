const LOW_STOCK_MAX = 5;
const PART_STOCK_STATUSES = new Set(['low', 'out', 'attention', 'ok']);
const {
    normalizeOptionalLimit,
    normalizeOptionalNumber,
    normalizeQueryText,
} = require('./queryValidation.cjs');

function invalidPartQuery(message) {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'INVALID_PART_QUERY';
    return error;
}

function normalizeText(value) {
    return String(value || '').trim();
}

function matchesStockStatus(part, stockStatus) {
    const stock = Number(part.stock || 0);
    if (stockStatus === 'low') return stock > 0 && stock <= LOW_STOCK_MAX;
    if (stockStatus === 'out') return stock <= 0;
    if (stockStatus === 'attention') return stock <= LOW_STOCK_MAX;
    if (stockStatus === 'ok') return stock > LOW_STOCK_MAX;
    return true;
}

function listParts(parts, input = {}) {
    const keyword = normalizeQueryText(input.keyword, 'keyword').toLocaleLowerCase();
    const category = normalizeQueryText(input.category, 'category').toLocaleLowerCase();
    const supplier = normalizeQueryText(input.supplier, 'supplier').toLocaleLowerCase();
    const stockStatus = normalizeText(input.stockStatus);
    const minPrice = normalizeOptionalNumber(input.minPrice, 'minPrice', { min: 0 });
    const maxPrice = normalizeOptionalNumber(input.maxPrice, 'maxPrice', { min: 0 });
    const priceBelow = normalizeOptionalNumber(input.priceBelow, 'priceBelow', { min: 0 });
    const priceAbove = normalizeOptionalNumber(input.priceAbove, 'priceAbove', { min: 0 });
    const minStock = normalizeOptionalNumber(input.minStock, 'minStock');
    const maxStock = normalizeOptionalNumber(input.maxStock, 'maxStock');
    const stockBelow = normalizeOptionalNumber(input.stockBelow, 'stockBelow');
    const stockAbove = normalizeOptionalNumber(input.stockAbove, 'stockAbove');
    const limit = normalizeOptionalLimit(input.limit);
    if (stockStatus && !PART_STOCK_STATUSES.has(stockStatus)) {
        throw invalidPartQuery('stockStatus 只支持 low、out、attention 或 ok');
    }

    const matches = (Array.isArray(parts) ? parts : []).filter(part => {
        if (keyword) {
            const fields = [
                part.model,
                part.category,
                part.subcategory,
                part.supplier,
            ].map(value => normalizeText(value).toLocaleLowerCase());
            if (!fields.some(value => value.includes(keyword))) return false;
        }
        if (category) {
            const partCategory = normalizeText(part.category).toLocaleLowerCase();
            if (!partCategory.includes(category)) return false;
        }
        if (supplier) {
            const partSupplier = normalizeText(part.supplier).toLocaleLowerCase();
            if (!partSupplier.includes(supplier)) return false;
        }
        const price = Number(part.price || 0);
        const stock = Number(part.stock || 0);
        if (minPrice !== null && price < minPrice) return false;
        if (maxPrice !== null && price > maxPrice) return false;
        if (priceBelow !== null && price >= priceBelow) return false;
        if (priceAbove !== null && price <= priceAbove) return false;
        if (minStock !== null && stock < minStock) return false;
        if (maxStock !== null && stock > maxStock) return false;
        if (stockBelow !== null && stock >= stockBelow) return false;
        if (stockAbove !== null && stock <= stockAbove) return false;
        return matchesStockStatus(part, stockStatus);
    });
    return limit ? matches.slice(0, limit) : matches;
}

module.exports = {
    LOW_STOCK_MAX,
    PART_STOCK_STATUSES,
    listParts,
    matchesStockStatus,
};
