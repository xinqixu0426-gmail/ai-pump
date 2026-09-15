const crypto = require('node:crypto');

function purchaseIdentityError(code, message) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 409;
    return error;
}
function text(value) { return String(value ?? '').trim(); }
function catalogId(value) {
    if (value == null) return null;
    if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))
        || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
        throw purchaseIdentityError('PURCHASE_ID_INVALID', '采购物料 ID 必须是正整数');
    }
    return Number(value);
}
function positiveFactor(value) {
    const number = Number(value ?? 1);
    if (!['number', 'string'].includes(typeof (value ?? 1)) || !Number.isFinite(number) || number <= 0) {
        throw purchaseIdentityError('PURCHASE_CONFIGURATION_INVALID', '采购单位换算数量必须大于零');
    }
    return number;
}
function purchaseIdentity(model, supplier = '', partId) {
    const id = catalogId(partId);
    return id ? `part:${id}` : `model:${JSON.stringify([text(model), text(supplier)])}`;
}
function purchaseStockIdentity(item) {
    const coilId = catalogId(item.coilId);
    const partId = catalogId(item.partId);
    if (coilId && partId) throw purchaseIdentityError('PURCHASE_ID_INVALID', '采购项不能同时指向零件和线圈库存');
    if (isPurchaseCoil(item)) {
        return coilId ? `coil:${coilId}` : `coil-model:${JSON.stringify([text(item.model), text(item.material || '钢带'), text(item.slotType || '小眼')])}`;
    }
    return purchaseIdentity(item.model, item.supplier, partId);
}
function isPurchaseCoil(item) {
    return item.inventoryType === 'coil' || item.coilId != null || item.costRole === 'coil'
        || item.costSource === 'coil' || text(item.name) === '线圈转子';
}
function purchaseConfiguration(item) {
    const cable = item.cableAssembly === true
        || item.cableLength != null || text(item.name).startsWith('成品电缆');
    const factor = positiveFactor(item.stockQtyPerUnit ?? (cable ? item.cableLength ?? item.inventoryQty : undefined));
    return [text(item.purchaseUnit), factor,
        cable ? positiveFactor(item.cableLength ?? item.stockQtyPerUnit ?? item.inventoryQty) : null,
        cable ? text(item.cableAccessoryType || item.cableAccessoryName || 'standard') : null,
        item.floatAccessoryType != null || item.costRole === 'float' || text(item.name) === '浮球' || text(item.model).startsWith('浮球-')
            ? text(item.floatAccessoryType || 'standard') : null];
}
function purchaseRowIdentity(item) {
    const base = purchaseStockIdentity(item);
    const config = purchaseConfiguration(item);
    return config[0] === '' && config[1] === 1 && config[2] === null && config[4] === null
        ? base : `${base}|configuration:${JSON.stringify(config)}`;
}
function purchaseRowId(item) {
    return `purchase-${crypto.createHash('sha256').update(purchaseRowIdentity(item)).digest('hex').slice(0, 24)}`;
}
function sameMaterial(next, previous) {
    const nextId = catalogId(next.coilId) || catalogId(next.partId);
    const previousId = catalogId(previous.coilId) || catalogId(previous.partId);
    const nextCoil = isPurchaseCoil(next);
    const previousCoil = isPurchaseCoil(previous);
    if (previous.inventoryType && nextCoil !== previousCoil) return false;
    if (nextId && previousId) return purchaseStockIdentity(next) === purchaseStockIdentity(previous);
    // Legacy name-only continuity remains exact and one-to-one. It never repairs
    // an explicit but different ID, and never trusts a stored identityKey.
    if (previousId) return false;
    return text(next.model) === text(previous.model) && text(next.supplier) === text(previous.supplier)
        && (!nextCoil || (text(next.material || '钢带') === text(previous.material || '钢带')
            && text(next.slotType || '小眼') === text(previous.slotType || '小眼')));
}
function isLegacyMeterRow(next, previous) {
    return next.purchaseUnit === '根' && next.cableLength != null && !previous.purchaseUnit
        && previous.stockQtyPerUnit == null && previous.cableLength == null;
}
function legacyFloatConfigurationMatches(next, previous) {
    return next.floatAccessoryType != null && previous.floatAccessoryType == null
        && JSON.stringify(purchaseConfiguration(next).slice(0, 4)) === JSON.stringify(purchaseConfiguration(previous).slice(0, 4));
}
function hasSavedPurchaseFacts(item) {
    return Boolean(item.purchased || item.purchasePriceRecorded || Number(item.purchasePrice) > 0
        || Number(item.orderedQty) > 0 || Number(item.receivedQty) > 0 || Number(item.stockedQty) > 0
        || item.stockInHistory?.length);
}
function matchPurchasePlanRows(nextRows, previousRows) {
    const used = new Set();
    const matches = nextRows.map(next => {
        const candidates = previousRows.map((previous, index) => ({ previous, index })).filter(({ previous }) =>
            sameMaterial(next, previous) && (JSON.stringify(purchaseConfiguration(next)) === JSON.stringify(purchaseConfiguration(previous))
                || isLegacyMeterRow(next, previous) || legacyFloatConfigurationMatches(next, previous)));
        if (candidates.length > 1 || (candidates.length === 1 && used.has(candidates[0].index))) {
            throw purchaseIdentityError('PURCHASE_CONTINUITY_AMBIGUOUS', `采购项“${next.model}”的历史进度不能唯一匹配，请先核对物料和配置`);
        }
        if (!candidates.length) return undefined;
        used.add(candidates[0].index);
        return candidates[0].previous;
    });
    if (previousRows.some((row, index) => !used.has(index) && hasSavedPurchaseFacts(row))) {
        throw purchaseIdentityError('PURCHASE_CONTINUITY_LOST', '旧采购项已有进度或实际价格，新计划无法接续，不能丢弃原记录');
    }
    return matches;
}

function purchaseRowMatches(item, input) {
    if (input.identityKey) return text(item.identityKey) === text(input.identityKey);
    return text(item.model) === text(input.model) && text(item.supplier) === text(input.supplier);
}
function uniquePurchaseRowIndex(rows, input) {
    const indexes = rows.flatMap((item, index) => purchaseRowMatches(item, input) ? [index] : []);
    if (indexes.length > 1) throw purchaseIdentityError('PURCHASE_TARGET_AMBIGUOUS', '存在同名不同配置的采购项，请选择具体采购行');
    return indexes[0] ?? -1;
}

module.exports = { isPurchaseCoil, catalogId, positiveFactor, purchaseIdentityError, purchaseIdentity, purchaseStockIdentity,
    purchaseConfiguration, purchaseRowIdentity, purchaseRowId, matchPurchasePlanRows, isLegacyMeterRow,
    purchaseRowMatches, uniquePurchaseRowIndex };
