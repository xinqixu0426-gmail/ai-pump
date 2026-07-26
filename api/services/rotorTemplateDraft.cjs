const emptyRotorPatchKeys = new Set([
    'upper_bearing',
    'lower_bearing',
    'piece_count',
    'rotor_dia',
    'bearing_span',
    'stack_offset',
    'oil_seal_dia',
    'impeller_dia',
    'impeller_span',
    'impeller_depth',
    'thread_length',
    'thread_dia',
]);

function normalizeBearing(value) {
    const normalized = String(value || '').trim().toUpperCase().replace(/^轴承/, '');
    if (normalized === '201') return '6201';
    if (normalized === '202') return '6202';
    if (normalized === '203') return '6203';
    if (normalized === '204') return '6204';
    if (normalized === '205') return '6205';
    return normalized;
}

function normalizeShellModel(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function shellModelCandidates(value) {
    const normalized = normalizeShellModel(value);
    const withoutSuffix = normalized.replace(/-[a-z0-9]+$/i, '');
    return withoutSuffix === normalized ? [normalized] : [normalized, withoutSuffix];
}

function safeParseObject(value) {
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function safeParseArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function openOffsetFromMeta(meta) {
    if (!meta) return null;
    const value = meta.openOffset ?? meta.openFactor;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function calculateBearingSpan(barrelLength, openOffset) {
    const length = Number(barrelLength);
    const offset = Number(openOffset);
    if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(offset)) return '';
    return String(Number((length - offset).toFixed(1)));
}

function stainlessBarrelDrawingText(barrelLength) {
    const length = Number(barrelLength);
    if (!Number.isFinite(length) || length <= 0) return '';
    return `不锈钢机筒：${Number(length.toFixed(1))}mm`;
}

function findShellMeta(template, parts) {
    const candidates = shellModelCandidates(template?.shell_model ?? template?.shellModel);
    const shellPart = candidates
        .map(candidate => (parts || []).find(part => part.category === '泵壳' && normalizeShellModel(part.model) === candidate))
        .find(Boolean);
    return safeParseObject(shellPart?.notes ?? shellPart?.remark ?? '{}');
}

function setPatchIfEmpty(patch, key, value, label, hints, unit = '') {
    if (!emptyRotorPatchKeys.has(key) || value === undefined || value === null || value === '') return;
    if (patch[key]) return;
    patch[key] = String(value);
    if (label) hints.push(`${label}${value}${unit}`);
}

function applyTemplateParts(patch, hints, template) {
    const templateParts = safeParseArray(template?.parts_json ?? template?.partsJson);
    templateParts.forEach(part => {
        const name = String(part?.name || '').trim();
        const model = String(part?.model || '').trim();
        if (!name || !model) return;
        if (name.includes('花板') && name.includes('轴承')) {
            patch.upper_bearing = normalizeBearing(model);
            hints.push(`上轴承${patch.upper_bearing}`);
        }
        if (name.includes('油缸') && name.includes('轴承')) {
            patch.lower_bearing = normalizeBearing(model);
            hints.push(`下轴承${patch.lower_bearing}`);
        }
        if (name.includes('机械油封') || (name.includes('机封') && !name.includes('骨架'))) {
            const dia = Number.parseFloat(model.split('*')[0].trim());
            if (Number.isFinite(dia)) {
                patch.oil_seal_dia = String(dia);
                hints.push(`油封孔径${dia}mm`);
            }
        }
    });
}

function applyTemplateRotorParams(patch, hints, template) {
    const rotorParams = safeParseObject(template?.rotor_params_json ?? template?.rotorParamsJson);
    Object.entries(rotorParams).forEach(([key, value]) => {
        if (!emptyRotorPatchKeys.has(key) || value === undefined || value === null || value === '') return;
        patch[key] = String(value);
        hints.push(`模板${key}`);
    });
}

function applyShellMetaDefaults(patch, hints, meta) {
    if (!meta) return;
    const defaults = [
        ['upper_bearing', '预设上轴承', meta.defaultUpperBearing, ''],
        ['lower_bearing', '预设下轴承', meta.defaultLowerBearing, ''],
        ['oil_seal_dia', '预设油封孔径', meta.defaultOilSealDia, 'mm'],
        ['bearing_span', '预设开档', meta.defaultBearingSpan, 'mm'],
        ['impeller_dia', '预设叶轮孔径', meta.defaultImpellerDia, 'mm'],
        ['impeller_span', '预设叶轮开档', meta.defaultImpellerSpan, 'mm'],
        ['impeller_depth', '预设叶轮厚度', meta.defaultImpellerDepth, 'mm'],
        ['thread_length', '预设螺丝长度', meta.defaultThreadLength, 'mm'],
        ['thread_dia', '预设螺纹直径', meta.defaultThreadDia, 'mm'],
        ['stack_offset', '预设定位', meta.defaultStackOffset, 'mm'],
    ];
    defaults.forEach(([key, label, value, unit]) => setPatchIfEmpty(patch, key, value, label, hints, unit));
}

function buildRotorTemplateDraft(input = {}) {
    const { template, variant, parts = [] } = input;
    if (!template) return { patch: {}, hints: [], meta: null, openOffset: null, barrelLength: null, drawingText: '' };

    const patch = {};
    const hints = [];
    applyTemplateParts(patch, hints, template);
    applyTemplateRotorParams(patch, hints, template);

    const meta = findShellMeta(template, parts);
    applyShellMetaDefaults(patch, hints, meta);
    const openOffset = openOffsetFromMeta(meta);
    let barrelLength = null;
    let drawingText = '';

    if (meta?.isStainless && meta.barrelLength) {
        barrelLength = Number(meta.barrelLength);
        drawingText = stainlessBarrelDrawingText(meta.barrelLength);
    }

    const variantBarrelLength = variant?.barrel_length ?? variant?.barrelLength;
    const variantName = variant?.model_name ?? variant?.modelName;
    if (variantBarrelLength && openOffset != null) {
        const span = calculateBearingSpan(variantBarrelLength, openOffset);
        if (span) {
            patch.bearing_span = span;
            barrelLength = Number(variantBarrelLength);
            drawingText = stainlessBarrelDrawingText(variantBarrelLength);
            hints.push(`${variantName || '变体'}机筒${variantBarrelLength}mm，开档${span}mm`);
        }
    }

    return {
        patch,
        hints,
        meta,
        openOffset,
        barrelLength: Number.isFinite(barrelLength) ? barrelLength : null,
        drawingText,
    };
}

const recipeTechnicalRotorMap = {
    upperBearing: { key: 'upper_bearing', label: '上轴承' },
    lowerBearing: { key: 'lower_bearing', label: '下轴承' },
    pieceCount: { key: 'piece_count', label: '片数' },
    rotorDiameter: { key: 'rotor_dia', label: '转子直径' },
    bearingSpan: { key: 'bearing_span', label: '开档' },
    stackOffset: { key: 'stack_offset', label: '定位' },
    oilSealDiameter: { key: 'oil_seal_dia', label: '油封孔径' },
    impellerBoreDiameter: { key: 'impeller_dia', label: '叶轮孔径' },
    impellerSpan: { key: 'impeller_span', label: '叶轮开档' },
    impellerDepth: { key: 'impeller_depth', label: '叶轮厚度' },
    threadLength: { key: 'thread_length', label: '螺纹长度' },
    threadDiameter: { key: 'thread_dia', label: '螺纹直径' },
};

function buildRotorRecipeDraft(input = {}) {
    const { recipe, template, variant, parts = [] } = input;
    if (!recipe) return { patch: {}, hints: [], meta: null, openOffset: null, barrelLength: null, drawingText: '' };

    const draft = buildRotorTemplateDraft({ template, variant, parts });
    const patch = { ...draft.patch };
    const hints = [...draft.hints];
    const barrelLengthValue = recipe.custom_barrel_length ?? recipe.customBarrelLength;
    let barrelLength = draft.barrelLength;
    let drawingText = draft.drawingText;

    if (barrelLengthValue && draft.openOffset != null) {
        const span = calculateBearingSpan(barrelLengthValue, draft.openOffset);
        if (span) patch.bearing_span = span;
        barrelLength = Number(barrelLengthValue);
        if (draft.meta?.isStainless) drawingText = stainlessBarrelDrawingText(barrelLengthValue);
    }

    const technicalData = safeParseObject(recipe.technical_data_json ?? recipe.technicalDataJson);
    Object.entries(recipeTechnicalRotorMap).forEach(([technicalKey, field]) => {
        const value = technicalData[technicalKey];
        if (value === undefined || value === null || value === '') return;
        patch[field.key] = String(value);
        hints.push(`${field.label}${value}`);
    });

    const impellerDepth = recipe.impeller_thickness ?? recipe.impellerThickness;
    if (!patch.impeller_depth && impellerDepth != null && impellerDepth !== '') {
        patch.impeller_depth = String(impellerDepth);
        hints.push(`叶轮厚度${impellerDepth}mm`);
    }

    return {
        ...draft,
        patch,
        hints,
        barrelLength: Number.isFinite(barrelLength) ? barrelLength : null,
        drawingText,
        drawingName: String(recipe.name || '').trim(),
    };
}

module.exports = {
    normalizeBearing,
    openOffsetFromMeta,
    calculateBearingSpan,
    stainlessBarrelDrawingText,
    buildRotorTemplateDraft,
    buildRotorRecipeDraft,
};
