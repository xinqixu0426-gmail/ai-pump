const BEARING_DB = Object.freeze({
    '6201': Object.freeze({ dia: 12.0, depth: 10.0 }),
    '6202': Object.freeze({ dia: 15.0, depth: 11.0 }),
    '6203': Object.freeze({ dia: 17.0, depth: 12.0 }),
    '6204': Object.freeze({ dia: 20.0, depth: 14.0 }),
    '6205': Object.freeze({ dia: 25.0, depth: 15.0 }),
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
    let normalized = String(raw).trim();
    normalized = normalized.replace(
        /[-\/]?(2RS|2RZ|2Z|ZZ|RS|RZ|DDU|LLU|LLB|CM|C3|P6|P5|NR)\b/gi,
        ''
    );
    normalized = normalized.replace(/[-\/]+$/, '').trim();
    if (/^\d{3}$/.test(normalized)) normalized = `6${normalized}`;
    return normalized;
}

function validateFcParam(key, value) {
    const normalized = Number.parseFloat(value);
    if (!Number.isFinite(normalized)) return null;
    const limits = FC_PARAM_LIMITS[key];
    if (limits && (normalized < limits.min || normalized > limits.max)) {
        return null;
    }
    return normalized;
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
        if (params[key] == null) return;
        const value = validateFcParam(key, params[key]);
        if (value !== null) fcParams[key] = value;
    });
    if (params.impeller_span != null) {
        const value = validateFcParam('impeller_span', params.impeller_span);
        if (value !== null) fcParams.bearing_to_impeller = value;
    }
    if (params.bearing_to_impeller != null) {
        const value = validateFcParam(
            'bearing_to_impeller',
            params.bearing_to_impeller
        );
        if (value !== null) fcParams.bearing_to_impeller = value;
    }

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
    FC_PARAM_LIMITS,
    buildFcParams,
    normalizeBearing,
    normalizeDrawingName,
    normalizeDrawingText,
    validateFcParam,
};
