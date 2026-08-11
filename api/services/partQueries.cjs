const LOW_STOCK_MAX = 5;
const PART_STOCK_STATUSES = new Set(['low', 'out', 'attention', 'ok']);
const PART_SORT_FIELDS = new Set(['price', 'stock', 'model', 'updatedAt']);
const PART_SORT_ORDERS = new Set(['asc', 'desc']);
const {
    normalizeOptionalEnum,
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

const SORT_ACCESSORS = {
    price: part => Number(part.price || 0),
    stock: part => Number(part.stock || 0),
    model: part => normalizeText(part.model).toLocaleLowerCase(),
    updatedAt: part => normalizeText(part.updatedAt || part.updated_at),
};

function sortParts(parts, sortBy, sortOrder) {
    const accessor = SORT_ACCESSORS[sortBy];
    const direction = sortOrder === 'asc' ? 1 : -1;
    return [...parts].sort((a, b) => {
        const valueA = accessor(a);
        const valueB = accessor(b);
        if (valueA < valueB) return -1 * direction;
        if (valueA > valueB) return 1 * direction;
        return 0;
    });
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
    const sortBy = normalizeOptionalEnum(input.sortBy, 'sortBy', PART_SORT_FIELDS);
    const sortOrder = normalizeOptionalEnum(input.sortOrder, 'sortOrder', PART_SORT_ORDERS) || 'desc';
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
    const sorted = sortBy ? sortParts(matches, sortBy, sortOrder) : matches;
    return limit ? sorted.slice(0, limit) : sorted;
}

module.exports = {
    LOW_STOCK_MAX,
    PART_SORT_FIELDS,
    PART_SORT_ORDERS,
    PART_STOCK_STATUSES,
    listParts,
    matchesStockStatus,
};
