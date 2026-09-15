const { parsePositiveId } = require('./validation.cjs');

function identityError(code, message, details) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 422;
    if (details !== undefined) error.details = details;
    return error;
}

function partIdOf(part) {
    return parsePositiveId(part?.id ?? part?.Id ?? part?.partId);
}

function normalizedText(value) {
    return String(value || '').trim();
}

function resolveCatalogPartIdentity(partsCatalog = [], part = {}, options = {}) {
    const field = options.field || 'BOM';
    const requestedPartId = parsePositiveId(part.partId);
    if (part.partId != null && (!requestedPartId || !Number.isSafeInteger(requestedPartId)
        || !['string', 'number'].includes(typeof part.partId))) {
        throw identityError('BOM_PART_ID_INVALID', `${field} 的 partId 必须是有效正整数`);
    }
    const model = normalizedText(part.model);
    const supplier = normalizedText(part.supplier);
    if (requestedPartId) {
        const matched = partsCatalog.find(candidate => partIdOf(candidate) === requestedPartId);
        if (!matched) {
            throw identityError(
                'BOM_PART_ID_NOT_FOUND',
                `${field} 的零件 #${requestedPartId} 不存在或已停用`,
                { partId: requestedPartId, model, supplier }
            );
        }
        const catalogModel = normalizedText(matched.model);
        if (model && catalogModel !== model) {
            throw identityError(
                'BOM_PART_ID_MODEL_MISMATCH',
                `${field} 的 partId 与型号不一致`,
                { partId: requestedPartId, model, catalogModel }
            );
        }
        return matched;
    }
    if (!model) {
        throw identityError('BOM_PART_MODEL_REQUIRED', `${field} 的零件型号不能为空`);
    }
    const modelCandidates = partsCatalog.filter(
        candidate => normalizedText(candidate.model) === model
    );
    const candidates = supplier
        ? modelCandidates.filter(candidate => normalizedText(candidate.supplier) === supplier)
        : modelCandidates;
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) {
        throw identityError(
            'BOM_PART_IDENTITY_NOT_FOUND',
            `${field} 的零件“${model}”${supplier ? `（${supplier}）` : ''}在零件库中不存在`,
            { model, supplier }
        );
    }
    throw identityError(
        'BOM_PART_IDENTITY_AMBIGUOUS',
        `${field} 的零件“${model}”存在多个供应商，请明确选择供应商或 partId`,
        {
            model,
            supplier,
            candidates: candidates.map(candidate => ({
                partId: partIdOf(candidate),
                supplier: normalizedText(candidate.supplier),
            })),
        }
    );
}

function shouldRequireCatalogIdentity(part = {}) {
    if (part.inventoryType === 'coil' || part.costRole === 'coil') return false;
    if (part.costRole === 'rotorProcess') return false;
    if (part.costSource === 'manual') return false;
    if (part.costRole === 'longScrew') return false;
    return true;
}

// Only for reading a persisted reference. A saved ID is the lookup key;
// snapshot display text is not another identity key. New writes continue to
// use resolveCatalogPartIdentity and cannot opt into this through request data.
function resolveSavedCatalogPartIdentity(partsCatalog = [], part = {}, options = {}) {
    const activeParts = partsCatalog.filter(candidate => !candidate.deletedAt && !candidate.deleted_at);
    const matched = resolveCatalogPartIdentity(activeParts,
        part.partId == null ? part : { ...part, model: undefined }, options);
    const supplier = normalizedText(part.supplier);
    if (part.partId != null && supplier && supplier !== normalizedText(matched.supplier)) {
        throw identityError('BOM_PART_ID_SUPPLIER_MISMATCH', `${options.field || 'BOM'} 的供应商与引用零件不一致`,
            { partId: partIdOf(matched), supplier, catalogSupplier: normalizedText(matched.supplier) });
    }
    return matched;
}

function bindStableBomPartIdentities(parts = [], partsCatalog = [], options = {}) {
    return parts.map((part, index) => {
        if (!shouldRequireCatalogIdentity(part)) return part;
        let matched;
        try {
            matched = resolveCatalogPartIdentity(partsCatalog, part, {
                field: `parts[${index}]`,
            });
        } catch (error) {
            if (options.allowUnresolved === true
                && !parsePositiveId(part.partId)
                && ['BOM_PART_IDENTITY_NOT_FOUND', 'BOM_PART_IDENTITY_AMBIGUOUS'].includes(error.code)) {
                return {
                    ...part,
                    identityStatus: error.code === 'BOM_PART_IDENTITY_AMBIGUOUS'
                        ? 'ambiguous'
                        : 'unresolved',
                };
            }
            if (options.allowLegacySnapshot === true
                && !parsePositiveId(part.partId)
                && part.source !== 'configuration_override'
                && Number(part.snapshotPrice || 0) > 0
                && ['BOM_PART_IDENTITY_NOT_FOUND', 'BOM_PART_IDENTITY_AMBIGUOUS'].includes(error.code)) {
                return {
                    ...part,
                    identityStatus: 'legacy_unresolved',
                };
            }
            throw error;
        }
        return {
            ...part,
            partId: partIdOf(matched),
            model: normalizedText(matched.model),
            supplier: normalizedText(matched.supplier),
        };
    });
}

module.exports = {
    bindStableBomPartIdentities,
    partIdOf,
    resolveCatalogPartIdentity,
    resolveSavedCatalogPartIdentity,
    shouldRequireCatalogIdentity,
};
