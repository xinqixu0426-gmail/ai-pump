const PACKAGING_CATEGORY = '包装';
const PACKAGING_SUBCATEGORIES = Object.freeze(['外包装', '内衬', '固定包材']);

function normalizeText(value) {
    return String(value || '').trim();
}

function inferPackagingSubcategory(part = {}) {
    const identity = [
        part.model,
        part.supplier,
        part.notes,
        part.remark,
        part.packagingMaterial,
    ].map(normalizeText).join(' ');

    if (identity.includes('珍珠棉') || identity.includes('泡沫') || identity.includes('内衬')) {
        return '内衬';
    }
    if (
        identity.includes('木箱')
        || identity.includes('纸箱')
        || identity.includes('彩印')
        || identity.includes('牛皮')
        || identity.includes('外包装')
    ) {
        return '外包装';
    }
    return '固定包材';
}

function normalizePackagingSubcategory(value, part = {}) {
    const normalized = normalizeText(value);
    if (PACKAGING_SUBCATEGORIES.includes(normalized)) return normalized;
    if (['泡沫内衬', '珍珠棉'].includes(normalized)) return '内衬';
    if (['牛皮纸箱', '彩印箱', '彩印纸箱', '木箱'].includes(normalized)) return '外包装';
    return inferPackagingSubcategory(part);
}

function partSubcategory(category, subcategory, part = {}) {
    return normalizeText(category) === PACKAGING_CATEGORY
        ? normalizePackagingSubcategory(subcategory, part)
        : '';
}

module.exports = {
    PACKAGING_CATEGORY,
    PACKAGING_SUBCATEGORIES,
    inferPackagingSubcategory,
    normalizePackagingSubcategory,
    partSubcategory,
};
