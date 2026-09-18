const { resolveSavedCatalogPartIdentity } = require('./bomPartIdentity.cjs');

function savedReferenceError(message) {
    return Object.assign(new Error(message), { code: 'SAVED_PART_REFERENCES_INVALID', statusCode: 422 });
}

function parseSavedParts(value, field = '保存的物料') {
    let parts = value;
    if (value == null || value === '') return [];
    if (typeof value === 'string') {
        try { parts = JSON.parse(value); } catch { throw savedReferenceError(`${field} JSON 损坏，请核对原始记录`); }
    }
    if (!Array.isArray(parts) || parts.length > 10000
        || parts.some(part => !part || typeof part !== 'object' || Array.isArray(part))) {
        throw savedReferenceError(`${field} 必须是最多 10000 行的物料对象数组`);
    }
    return parts;
}

// Only callers holding persisted data may use this adapter. Client selections
// continue through the strict new-write resolver; no request flag selects it.
function currentSavedParts(value, catalog, field = '保存的物料', category) {
    return parseSavedParts(value, field).map((part, index) => {
        if (part.partId == null) return { ...part };
        const matched = resolveSavedCatalogPartIdentity(catalog, part, { field: `${field}[${index}]` });
        if (category && matched.category !== category) {
            throw savedReferenceError(`${field}[${index}] 的引用分类不一致`);
        }
        return { ...part, model: matched.model, supplier: matched.supplier || '' };
    });
}

module.exports = { currentSavedParts, parseSavedParts };
