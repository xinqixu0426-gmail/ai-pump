class QueryValidationError extends Error {
    constructor(message, code = 'INVALID_QUERY') {
        super(message);
        this.name = 'QueryValidationError';
        this.statusCode = 400;
        this.code = code;
    }
}

function normalizeQueryText(value, field, { maxLength = 80 } = {}) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (text.length > maxLength) {
        throw new QueryValidationError(`${field} 不能超过 ${maxLength} 个字符`);
    }
    return text;
}

function normalizeOptionalLimit(value, { defaultValue = null, max = 100 } = {}) {
    if (value === undefined || value === null || value === '') return defaultValue;
    const raw = String(value).trim();
    if (!/^\d+$/.test(raw)) {
        throw new QueryValidationError(`limit 必须是 1 到 ${max} 的整数`);
    }
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit <= 0 || limit > max) {
        throw new QueryValidationError(`limit 必须是 1 到 ${max} 的整数`);
    }
    return limit;
}

function normalizeOptionalNumber(value, field, { min = null } = {}) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || (min !== null && number < min)) {
        throw new QueryValidationError(
            `${field} 必须是${min !== null ? `不小于 ${min} 的` : ''}有效数字`
        );
    }
    return number;
}

function normalizeOptionalBoolean(value, field) {
    if (value === undefined || value === null || value === '') return null;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new QueryValidationError(`${field} 必须是 true 或 false`);
}

function normalizeOptionalEnum(value, field, allowedValues) {
    const text = normalizeQueryText(value, field);
    if (text && !allowedValues.has(text)) {
        throw new QueryValidationError(
            `${field}无效，可选：${[...allowedValues].join('、')}`,
            `INVALID_${String(field).toUpperCase()}`
        );
    }
    return text;
}

module.exports = {
    QueryValidationError,
    normalizeOptionalBoolean,
    normalizeOptionalEnum,
    normalizeOptionalLimit,
    normalizeOptionalNumber,
    normalizeQueryText,
};
