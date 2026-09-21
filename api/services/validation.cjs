function parsePositiveId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function requirePositiveId(value, field = 'id') {
    const id = parsePositiveId(value);
    if (!id) throw new Error(`${field} 必须是正整数`);
    return id;
}

function parseFiniteNumber(value, field, { required = false, defaultValue = 0 } = {}) {
    if (value === undefined || value === null || value === '') {
        if (required) throw new Error(`${field} 为必填项`);
        return defaultValue;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${field} 必须是有效数字`);
    return number;
}

function parseNonNegativeNumber(value, field, options = {}) {
    const number = parseFiniteNumber(value, field, options);
    if (number < 0) throw new Error(`${field} 必须是非负数字`);
    return number;
}

function parsePositiveNumber(value, field, options = {}) {
    const number = parseFiniteNumber(value, field, options);
    if (number <= 0) throw new Error(`${field} 必须是正数`);
    return number;
}

function parseNonNegativeInteger(value, field, options = {}) {
    const number = parseNonNegativeNumber(value, field, options);
    if (!Number.isInteger(number)) throw new Error(`${field} 必须是非负整数`);
    return number;
}

function parseJsonArray(value, { fallback = [] } = {}) {
    if (!value) return fallback;
    if (Array.isArray(value)) return value;
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function parseJsonValue(value, field, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        throw new Error(`${field} 必须是有效 JSON`);
    }
}

function stringifyJsonArray(value, field, { defaultValue = [] } = {}) {
    const parsed = parseJsonValue(value, field, defaultValue);
    if (!Array.isArray(parsed)) throw new Error(`${field} 必须是 JSON 数组`);
    return JSON.stringify(parsed);
}

function stringifyJsonObject(value, field, { defaultValue = {} } = {}) {
    const parsed = parseJsonValue(value, field, defaultValue);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${field} 必须是 JSON 对象`);
    return JSON.stringify(parsed);
}

module.exports = {
    parsePositiveId,
    requirePositiveId,
    parseFiniteNumber,
    parseNonNegativeNumber,
    parsePositiveNumber,
    parseNonNegativeInteger,
    parseJsonArray,
    stringifyJsonArray,
    stringifyJsonObject,
};
