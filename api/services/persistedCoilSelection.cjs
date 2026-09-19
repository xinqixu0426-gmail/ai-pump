const { parsePositiveId } = require('./validation.cjs');

function selectionResultError(code, message, statusCode = 409, details = undefined) {
    return {
        success: false,
        code,
        message,
        statusCode,
        ...(details === undefined ? {} : { details }),
    };
}

function normalizePersistedCoilSelection(input = {}) {
    return {
        coilId: parsePositiveId(input.coilId ?? input.coil_id),
        schemeFamilyCode: String(
            input.coilSchemeFamilyCode
            ?? input.schemeFamilyCode
            ?? input.coil_scheme_family_code
            ?? ''
        ).trim().toUpperCase(),
        spec: String(input.coilSpec ?? input.spec ?? input.coil_spec ?? '').trim(),
        sheets: Number(input.coilSheets ?? input.sheets ?? input.coil_sheets ?? 0),
        material: String(input.coilMaterial ?? input.material ?? input.coil_material ?? '钢带').trim() || '钢带',
        slotType: String(input.coilSlotType ?? input.slotType ?? input.coil_slot_type ?? '小眼').trim() || '小眼',
    };
}

function resolvePersistedCoilSelection(db, input = {}) {
    const normalized = normalizePersistedCoilSelection(input);
    const hasCompleteDimensions = Boolean(normalized.spec)
        && Number.isInteger(normalized.sheets)
        && normalized.sheets > 0;
    if (!hasCompleteDimensions) {
        return {
            success: true,
            data: {
                coilId: null,
                schemeFamilyCode: '',
                selectionMode: 'none',
            },
        };
    }

    const candidates = db.prepare(`
        SELECT id, spec, sheets, material, slot_type, scheme_status,
               scheme_family_code, pricing_mode
        FROM coils
        WHERE scheme_status = 'official'
          AND spec = ?
          AND material = ?
          AND slot_type = ?
        ORDER BY sheets, id
    `).all(normalized.spec, normalized.material, normalized.slotType);
    const exactCandidates = candidates.filter(
        coil => Number(coil.sheets || 0) === normalized.sheets
    );

    if (normalized.coilId) {
        const coil = exactCandidates.find(
            candidate => Number(candidate.id) === normalized.coilId
        );
        if (!coil) {
            return selectionResultError(
                'COIL_SELECTION_MISMATCH',
                '所选线圈方案不存在、不是正式方案，或与规格、片数、材质、槽眼不一致',
                400
            );
        }
        const familyCode = String(coil.scheme_family_code || '').trim().toUpperCase();
        return {
            success: true,
            data: {
                coilId: normalized.coilId,
                schemeFamilyCode: familyCode,
                selectionMode: 'exact',
            },
        };
    }

    if (exactCandidates.length > 0) {
        return selectionResultError(
            'COIL_SELECTION_REQUIRED',
            '当前片数存在正式线圈方案，必须选择具体方案',
            409,
            { candidateIds: exactCandidates.map(coil => Number(coil.id)) }
        );
    }
    if (!normalized.schemeFamilyCode) {
        return selectionResultError(
            'COIL_SCHEME_FAMILY_REQUIRED',
            '当前片数需要插值或外推，必须选择线圈方案系列',
            409
        );
    }
    const familyCandidates = candidates.filter(coil => (
        String(coil.scheme_family_code || '').trim().toUpperCase() === normalized.schemeFamilyCode
        && String(coil.pricing_mode || 'calculated') === 'calculated'
    ));
    if (familyCandidates.length === 0) {
        return selectionResultError(
            'COIL_SCHEME_FAMILY_NOT_FOUND',
            '所选线圈方案系列不存在、不是正式计算方案，或与规格组合不一致',
            400
        );
    }
    return {
        success: true,
        data: {
            coilId: null,
            schemeFamilyCode: normalized.schemeFamilyCode,
            selectionMode: 'family',
        },
    };
}

module.exports = {
    normalizePersistedCoilSelection,
    resolvePersistedCoilSelection,
};
