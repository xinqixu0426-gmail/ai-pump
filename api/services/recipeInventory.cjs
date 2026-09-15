const { resolveSavedCatalogPartIdentity, partIdOf } = require('./bomPartIdentity.cjs');
const { isPurchaseCoil } = require('./purchaseIdentity.cjs');
const { isPackagingEstimatePart } = require('./packagingEstimate.cjs');
const { isRotorProcessPart } = require('./rotorShaftJoint.cjs');

const text = value => String(value ?? '').trim();
const validId = value => ['number', 'string'].includes(typeof value)
    && text(value) !== '' && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const inactive = part => Boolean(part.deleted_at || part.deletedAt);

function unresolved(base, referenceStatus, message, currentName = null) {
    return { ...base, currentName, currentStock: null, referenceStatus, message,
        status: referenceStatus === 'missing' ? 'missing' : 'needs_review' };
}

function resolved(base, record, currentName, referenceStatus) {
    const currentStock = Number(record.stock);
    if (!['number', 'string'].includes(typeof record.stock) || text(record.stock) === ''
        || !Number.isFinite(currentStock) || currentStock < 0
        || (base.inventoryType === 'coil' && !Number.isSafeInteger(currentStock))) {
        return unresolved(base, 'invalid_stock', '目录库存数据异常，请核对', currentName);
    }
    return { ...base, currentName, currentStock, referenceStatus, message: null,
        status: currentStock > 0 ? 'in_stock' : 'out_of_stock' };
}

function inspectPart(part, partsCatalog, base) {
    const explicitId = part.partId != null;
    if (explicitId && !validId(part.partId)) return unresolved(base, 'invalid_id', '零件引用 ID 不合法');
    const identified = explicitId ? partsCatalog.find(row => partIdOf(row) === Number(part.partId)) : null;
    if (identified && inactive(identified)) return unresolved({ ...base, partId: partIdOf(identified) }, 'inactive', '引用零件已停用', identified.model);
    try {
        const matched = resolveSavedCatalogPartIdentity(partsCatalog, part);
        return resolved({ ...base, partId: partIdOf(matched), supplier: text(matched.supplier) }, matched,
            text(matched.model), explicitId ? 'resolved' : 'resolved_legacy');
    } catch (error) {
        const statuses = {
            BOM_PART_ID_NOT_FOUND: 'missing', BOM_PART_IDENTITY_NOT_FOUND: 'missing',
            BOM_PART_IDENTITY_AMBIGUOUS: 'ambiguous', BOM_PART_ID_MODEL_MISMATCH: 'identity_mismatch',
            BOM_PART_ID_SUPPLIER_MISMATCH: 'identity_mismatch',
            BOM_PART_MODEL_REQUIRED: 'invalid_reference', BOM_PART_ID_INVALID: 'invalid_id',
        };
        if (!statuses[error.code]) throw error;
        return unresolved({ ...base, ...(identified ? { partId: partIdOf(identified) } : {}) },
            statuses[error.code], error.message, identified ? text(identified.model) : null);
    }
}

function inspectCoil(part, recipe, coils, base) {
    // A saved BOM's explicit identity takes precedence over recipe defaults.
    // An invalid/missing/disabled ID never falls back to a different scheme.
    const requestedId = part.coilId ?? recipe.coil_id;
    let coil;
    if (requestedId != null) {
        if (!validId(requestedId)) return unresolved(base, 'invalid_id', '线圈引用 ID 不合法');
        coil = coils.find(row => Number(row.id) === Number(requestedId));
        if (!coil) return unresolved(base, 'missing', '引用的线圈方案不存在');
        base = { ...base, coilId: Number(coil.id) };
        if ((coil.schemeStatus ?? coil.scheme_status) !== 'official') {
            return unresolved(base, 'inactive', '引用的线圈方案不是正式方案', coil.schemeName ?? coil.scheme_name ?? null);
        }
    } else {
        if (!Number.isSafeInteger(Number(recipe.coil_sheets)) || Number(recipe.coil_sheets) <= 0) {
            return unresolved(base, 'missing', '未绑定具体片数的线圈方案，无法核对成品库存');
        }
        const candidates = coils.filter(row => (row.schemeStatus ?? row.scheme_status) === 'official'
            && text(row.spec) === text(recipe.coil_spec)
            && Number(row.sheets) === Number(recipe.coil_sheets)
            && text(row.material) === (text(recipe.coil_material) || '钢带')
            && text(row.slotType ?? row.slot_type) === (text(recipe.coil_slot_type) || '小眼'));
        const defaults = candidates.filter(row => Number(row.isDefault ?? row.is_default) === 1);
        coil = candidates.length === 1 ? candidates[0] : defaults.length === 1 ? defaults[0] : null;
        if (!coil) return unresolved(base, candidates.length ? 'ambiguous' : 'missing',
            candidates.length ? '匹配到多个线圈方案，请明确选择' : '未找到正式线圈方案');
        base = { ...base, coilId: Number(coil.id) };
    }
    if (!Number.isSafeInteger(Number(coil.sheets)) || Number(coil.sheets) <= 0) {
        return unresolved(base, 'invalid_reference', '线圈方案缺少有效的具体片数', text(coil.schemeName ?? coil.scheme_name) || null);
    }
    return resolved(base, coil, text(coil.schemeName ?? coil.scheme_name) || null,
        requestedId != null ? 'resolved' : 'resolved_legacy');
}

function inspectRecipeInventory(parts, partsCatalog, coilsCatalog, recipe) {
    return parts.map(part => {
        const coil = isPurchaseCoil(part);
        const base = { name: text(part.name || part.model), model: text(part.model),
            snapshotName: text(part.model), supplier: text(part.supplier), inventoryType: coil ? 'coil' : 'part' };
        if ((part.partId != null && (part.coilId != null || coil))
            || (part.inventoryType === 'part' && coil)) {
            return unresolved(base, 'invalid_reference', '同一行的零件与线圈引用类型冲突');
        }
        if (part.inventoryType === 'none' || isPackagingEstimatePart(part) || isRotorProcessPart(part)) {
            return { ...base, inventoryType: 'none', currentName: null, currentStock: null,
                referenceStatus: 'not_tracked', status: 'not_tracked', message: '此项不单独管理库存' };
        }
        return coil ? inspectCoil(part, recipe, coilsCatalog, base) : inspectPart(part, partsCatalog, base);
    });
}

module.exports = { inspectRecipeInventory };
