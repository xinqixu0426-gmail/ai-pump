const BEARING_DB = Object.freeze({
    '6201': Object.freeze({ dia: 12.0, depth: 10.0 }),
    '6202': Object.freeze({ dia: 15.0, depth: 11.0 }),
    '6203': Object.freeze({ dia: 17.0, depth: 12.0 }),
    '6204': Object.freeze({ dia: 20.0, depth: 14.0 }),
    '6205': Object.freeze({ dia: 25.0, depth: 15.0 }),
    '6303': Object.freeze({ dia: 17.0, depth: 14.0 }),
    '6304': Object.freeze({ dia: 20.0, depth: 15.0 }),
});

const FC_PARAM_LIMITS = Object.freeze({
    piece_count: Object.freeze({ min: 1, max: 1000 }),
    rotor_dia: Object.freeze({ min: 1, max: 500 }),
    bearing_span: Object.freeze({ min: 1, max: 1000 }),
    stack_offset: Object.freeze({ min: 0, max: 500 }),
    oil_seal_dia: Object.freeze({ min: 1, max: 200 }),
    impeller_dia: Object.freeze({ min: 1, max: 500 }),
    impeller_depth: Object.freeze({ min: 0.1, max: 200 }),
    thread_dia: Object.freeze({ min: 1, max: 100 }),
    thread_length: Object.freeze({ min: 1, max: 500 }),
    impeller_span: Object.freeze({ min: 1, max: 500 }),
    bearing_to_impeller: Object.freeze({ min: 1, max: 500 }),
});

const FC_PARAM_LABELS = Object.freeze({
    piece_count: '转子片数',
    rotor_dia: '转子直径',
    bearing_span: '开档',
    stack_offset: '定位',
    oil_seal_dia: '油封孔径',
    impeller_dia: '叶轮孔径',
    impeller_depth: '叶轮厚度',
    thread_dia: '螺纹直径',
    thread_length: '螺纹长度',
    impeller_span: '叶轮开档',
    bearing_to_impeller: '叶轮开档',
});

const ROTOR_LENGTH_COMPONENTS = Object.freeze([
    Object.freeze({ key: 'upper_bearing_depth', name: '上轴承深度' }),
    Object.freeze({ key: 'bearing_span', name: '开档' }),
    Object.freeze({ key: 'bearing_to_impeller', name: '叶轮开档' }),
    Object.freeze({ key: 'impeller_depth', name: '叶轮厚度' }),
    Object.freeze({ key: 'thread_length', name: '螺纹长度' }),
]);
const MIN_STATOR_CLEARANCE_MM = 35;

function normalizeDrawingName(value, fallback = '') {
    const raw = String(value || '').trim();
    const name = raw || fallback;
    return name
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

function normalizeDrawingText(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 3)
        .join('\n')
        .slice(0, 120);
}

function normalizeBearing(raw) {
    if (!raw) return raw;
    let normalized = String(raw)
        .trim()
        .toUpperCase()
        .replace(/^轴承\s*/, '')
        .replace(/\s*轴承$/, '');
    normalized = normalized.replace(
        /[-\/]?(2RS|2RZ|2Z|ZZ|RS|RZ|DDU|LLU|LLB|CM|C3|P6|P5|NR)\b/gi,
        ''
    );
    normalized = normalized.replace(/[-\/]+$/, '').trim();
    if (/^\d{3}$/.test(normalized)) normalized = `6${normalized}`;
    return normalized;
}

function validateFcParam(key, value) {
    if (
        value == null
        || (typeof value === 'string' && value.trim() === '')
    ) return null;
    if (
        typeof value !== 'number'
        && (
            typeof value !== 'string'
            || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())
        )
    ) return null;
    const normalized = typeof value === 'number'
        ? value
        : Number(value.trim());
    if (!Number.isFinite(normalized)) return null;
    const limits = FC_PARAM_LIMITS[key];
    if (limits && (normalized < limits.min || normalized > limits.max)) {
        return null;
    }
    return normalized;
}

function validateProvidedFcParam(key, value, errors) {
    if (
        value == null
        || (typeof value === 'string' && value.trim() === '')
    ) return null;
    const normalized = validateFcParam(key, value);
    if (normalized !== null) return normalized;
    const limits = FC_PARAM_LIMITS[key];
    const range = limits ? `${limits.min}–${limits.max}` : '有效';
    errors.push(`${FC_PARAM_LABELS[key] || key}必须是 ${range} 之间的数字`);
    return null;
}

function buildRotorSafetyWarnings(fcParams = {}) {
    const warnings = [];
    const lengthComponents = ROTOR_LENGTH_COMPONENTS.map(item => ({
        ...item,
        value: fcParams[item.key] ?? null,
        missing: fcParams[item.key] == null,
    }));
    const missingLengthParameters = lengthComponents.filter(item => item.missing);
    const providedLengthParameters = lengthComponents.filter(item => !item.missing);
    if (
        providedLengthParameters.length > 0
        && missingLengthParameters.length > 0
    ) {
        const calculatedTotalMm = providedLengthParameters.reduce(
            (sum, item) => sum + Number(item.value || 0),
            0
        );
        warnings.push({
            code: 'rotor_length_parameters_incomplete',
            severity: 'warning',
            message: `总长度参数不完整：缺少${missingLengthParameters.map(item => item.name).join('、')}；当前已提供参数合计 ${calculatedTotalMm.toFixed(1)}mm`,
            details: {
                missingParameters: missingLengthParameters.map(item => ({
                    key: item.key,
                    name: item.name,
                })),
                components: lengthComponents,
                calculatedTotalMm,
            },
        });
    }

    const bearingSpan = fcParams.bearing_span;
    const pieceCount = fcParams.piece_count;
    const stackOffset = fcParams.stack_offset;
    if (
        bearingSpan != null
        && pieceCount != null
        && stackOffset != null
    ) {
        const clearance = bearingSpan - (pieceCount / 2) - stackOffset;
        if (clearance < MIN_STATOR_CLEARANCE_MM) {
            let clearanceText = '';
            for (let precision = 1; precision <= 6; precision += 1) {
                const candidate = clearance.toFixed(precision);
                if (Number(candidate) < MIN_STATOR_CLEARANCE_MM) {
                    clearanceText = candidate;
                    break;
                }
            }
            const comparisonText = clearanceText
                ? `${clearanceText}mm < ${MIN_STATOR_CLEARANCE_MM}mm`
                : `实际值小于 ${MIN_STATOR_CLEARANCE_MM}mm`;
            warnings.push({
                code: 'rotor_stator_clearance_low',
                severity: 'danger',
                message: `线圈与上轴承端盖距离过短（${comparisonText}），可能会导致漏电或干涉`,
                details: {
                    clearanceMm: clearance,
                    thresholdMm: MIN_STATOR_CLEARANCE_MM,
                },
            });
        }
    }
    return warnings;
}

function buildFcParams(params = {}) {
    const fcParams = {};
    const errors = [];
    const upperBRaw = params.upper_bearing;
    const lowerBRaw = params.lower_bearing;
    const upperB = normalizeBearing(upperBRaw);
    const lowerB = normalizeBearing(lowerBRaw);

    if (upperB && BEARING_DB[upperB]) {
        fcParams.upper_bearing_dia = BEARING_DB[upperB].dia;
        fcParams.upper_bearing_depth = BEARING_DB[upperB].depth;
    } else if (upperB) {
        errors.push(
            `未知的上轴承型号: ${upperBRaw}${upperBRaw !== upperB ? ` (标准化后: ${upperB})` : ''}`
        );
    }
    if (lowerB && BEARING_DB[lowerB]) {
        fcParams.lower_bearing_dia = BEARING_DB[lowerB].dia;
        fcParams.lower_bearing_depth = BEARING_DB[lowerB].depth;
    } else if (lowerB) {
        errors.push(
            `未知的下轴承型号: ${lowerBRaw}${lowerBRaw !== lowerB ? ` (标准化后: ${lowerB})` : ''}`
        );
    }
    if (errors.length > 0) return { fcParams: null, errors };

    [
        'piece_count',
        'rotor_dia',
        'bearing_span',
        'stack_offset',
        'oil_seal_dia',
        'impeller_dia',
        'impeller_depth',
        'thread_dia',
        'thread_length',
    ].forEach(key => {
        const value = validateProvidedFcParam(key, params[key], errors);
        if (value !== null) fcParams[key] = value;
    });
    if (params.impeller_span != null) {
        const value = validateProvidedFcParam(
            'impeller_span',
            params.impeller_span,
            errors
        );
        if (value !== null) fcParams.bearing_to_impeller = value;
    }
    if (params.bearing_to_impeller != null) {
        const value = validateProvidedFcParam(
            'bearing_to_impeller',
            params.bearing_to_impeller,
            errors
        );
        if (value !== null) fcParams.bearing_to_impeller = value;
    }

    if (errors.length > 0) return { fcParams: null, errors };

    if (fcParams.piece_count) {
        fcParams._core_length = fcParams.piece_count * 0.5;
    }
    const drawingText = normalizeDrawingText(
        params.drawingText ?? params.drawing_text
    );
    if (drawingText) fcParams._drawing_text = drawingText;
    const totalLength = Number(fcParams.upper_bearing_depth || 0)
        + Number(fcParams.bearing_span || 0)
        + Number(fcParams.bearing_to_impeller || 0)
        + Number(fcParams.impeller_depth || 0)
        + Number(fcParams.thread_length || 0);
    if (totalLength > 0) fcParams._total_length = totalLength;

    return { fcParams, errors: [] };
}

module.exports = {
    BEARING_DB,
    FC_PARAM_LABELS,
    FC_PARAM_LIMITS,
    MIN_STATOR_CLEARANCE_MM,
    ROTOR_LENGTH_COMPONENTS,
    buildFcParams,
    buildRotorSafetyWarnings,
    normalizeBearing,
    normalizeDrawingName,
    normalizeDrawingText,
    validateFcParam,
};
