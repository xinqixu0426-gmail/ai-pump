function parseCableAccessoryFee(notes, accessoryType = 'standard') {
    if (!notes) return null;
    try {
        const meta = JSON.parse(notes);
        const typedFee = Number(meta?.cableAccessoryFees?.[accessoryType]);
        if (Number.isFinite(typedFee) && typedFee >= 0) return typedFee;
        const fee = Number(meta?.cableAccessoryFee);
        return Number.isFinite(fee) && fee >= 0 ? fee : null;
    } catch {
        return null;
    }
}

function parseCableAccessoryName(notes, accessoryType = 'standard') {
    if (!notes) return null;
    try {
        const name = JSON.parse(notes)?.cableAccessoryNames?.[accessoryType];
        return typeof name === 'string' && name.trim() ? name.trim() : null;
    } catch {
        return null;
    }
}

function getGlobalCableAccessory(getSetting = () => undefined, accessoryType = 'standard') {
    try {
        const config = JSON.parse(getSetting('cable_accessories') || '{}')?.[accessoryType];
        const fee = Number(config?.fee);
        return {
            name: typeof config?.name === 'string' && config.name.trim()
                ? config.name.trim()
                : (accessoryType === 'xinjie' ? '新界式' : '普通铜套'),
            fee: Number.isFinite(fee) && fee >= 0 ? fee : null,
        };
    } catch {
        return { name: accessoryType === 'xinjie' ? '新界式' : '普通铜套', fee: null };
    }
}

function findSupplierPart(parts, supplier = '') {
    const normalizedSupplier = String(supplier || '').trim();
    if (!Array.isArray(parts) || parts.length === 0) return null;
    const exact = parts.find(part => normalizedSupplier && String(part.supplier || '').trim() === normalizedSupplier);
    return exact || parts.reduce((min, part) => Number(part.price || 0) < Number(min.price || 0) ? part : min, parts[0]);
}

function getCablePartFromCatalog(partsCatalog, cableModel, supplier = '') {
    const candidates = (partsCatalog || []).filter(part => String(part.model || '') === String(cableModel || ''));
    return findSupplierPart(candidates, supplier);
}

function getCableAccessoryFeeFromPartsByModel(partsByModel, cableModel, supplier = '', accessoryType = 'standard', getSetting = () => undefined) {
    const globalAccessory = getGlobalCableAccessory(getSetting, accessoryType);
    if (globalAccessory.fee != null) return globalAccessory.fee;
    const candidates = partsByModel?.[cableModel] || [];
    const matched = findSupplierPart(candidates, supplier);
    const fee = parseCableAccessoryFee(matched?.notes, accessoryType);
    if (fee != null) return fee;
    const legacy = partsByModel?.['电缆配件费'] || [];
    if (legacy.length === 0) return 0;
    return Number(findSupplierPart(legacy, supplier)?.price || 0);
}

function getCableAccessoryNameFromPartsByModel(partsByModel, cableModel, supplier = '', accessoryType = 'standard', getSetting = () => undefined) {
    const globalAccessory = getGlobalCableAccessory(getSetting, accessoryType);
    if (globalAccessory.name) return globalAccessory.name;
    const candidates = partsByModel?.[cableModel] || [];
    const matched = findSupplierPart(candidates, supplier);
    const name = parseCableAccessoryName(matched?.notes, accessoryType);
    if (name) return name;
    return accessoryType === 'xinjie' ? '新界式' : '普通铜套';
}

function getCableAccessoryFeeFromCatalog(partsCatalog, cableModel, supplier = '', accessoryType = 'standard') {
    const matched = getCablePartFromCatalog(partsCatalog, cableModel, supplier);
    const fee = parseCableAccessoryFee(matched?.notes, accessoryType);
    if (fee != null) return fee;
    const legacy = (partsCatalog || []).filter(part => part.model === '电缆配件费');
    if (legacy.length === 0) return 0;
    return Number(findSupplierPart(legacy, supplier)?.price || 0);
}

function getCableAccessoryNameFromCatalog(partsCatalog, cableModel, supplier = '', accessoryType = 'standard') {
    const matched = getCablePartFromCatalog(partsCatalog, cableModel, supplier);
    const name = parseCableAccessoryName(matched?.notes, accessoryType);
    if (name) return name;
    return accessoryType === 'xinjie' ? '新界式' : '普通铜套';
}

module.exports = {
    parseCableAccessoryFee,
    parseCableAccessoryName,
    getGlobalCableAccessory,
    getCablePartFromCatalog,
    getCableAccessoryFeeFromPartsByModel,
    getCableAccessoryNameFromPartsByModel,
    getCableAccessoryFeeFromCatalog,
    getCableAccessoryNameFromCatalog,
};
