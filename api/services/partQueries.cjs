const LOW_STOCK_MAX = 5;
const PART_STOCK_STATUSES = new Set(['low', 'out', 'attention', 'ok']);

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
    const keyword = normalizeText(input.keyword).toLocaleLowerCase();
    const category = normalizeText(input.category).toLocaleLowerCase();
    const supplier = normalizeText(input.supplier).toLocaleLowerCase();
    const stockStatus = normalizeText(input.stockStatus);
    if (stockStatus && !PART_STOCK_STATUSES.has(stockStatus)) {
        throw invalidPartQuery('stockStatus 只支持 low、out、attention 或 ok');
    }

    return (Array.isArray(parts) ? parts : []).filter(part => {
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
        return matchesStockStatus(part, stockStatus);
    });
}

module.exports = {
    LOW_STOCK_MAX,
    PART_STOCK_STATUSES,
    listParts,
    matchesStockStatus,
};
