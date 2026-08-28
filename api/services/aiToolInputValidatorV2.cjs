const { AI_TOOLS } = require('../routes/ai/tools.cjs');

class AiToolInputValidationError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'AiToolInputValidationError';
        this.code = 'INVALID_AI_TOOL_INPUT';
        this.details = details;
    }
}

const TOOL_SCHEMAS = new Map(AI_TOOLS.map(tool => [
    tool.function.name,
    tool.function.parameters || { type: 'object', properties: {} },
]));

function fail(message, path, details = {}) {
    throw new AiToolInputValidationError(message, { path, ...details });
}

function normalizeString(value, schema, path) {
    if (typeof value !== 'string') fail(`${path} 必须是字符串`, path);
    const normalized = value.trim().replace(/\s+/g, ' ');
    const minLength = Number.isInteger(schema.minLength) ? schema.minLength : 0;
    if (normalized.length < minLength) {
        fail(`${path} 不能少于 ${minLength} 个字符`, path);
    }
    const maxLength = Number.isInteger(schema.maxLength) ? schema.maxLength : 500;
    if (normalized.length > maxLength) {
        fail(`${path} 不能超过 ${maxLength} 个字符`, path);
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(normalized)) {
        fail(`${path} 无效，可选：${schema.enum.join('、')}`, path, {
            allowedValues: schema.enum,
        });
    }
    return normalized;
}

function normalizeNumber(value, schema, path, integer = false) {
    if (typeof value === 'string' && value.trim()) {
        const trimmed = value.trim();
        if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) value = Number(trimmed);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(`${path} 必须是有效数字`, path);
    }
    if (integer && !Number.isInteger(value)) fail(`${path} 必须是整数`, path);
    if (schema.minimum !== undefined && value < schema.minimum) {
        fail(`${path} 不能小于 ${schema.minimum}`, path);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
        fail(`${path} 不能大于 ${schema.maximum}`, path);
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
        fail(`${path} 无效`, path, { allowedValues: schema.enum });
    }
    return value;
}

function normalizeObject(value, schema, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail(`${path} 必须是对象`, path);
    }
    const properties = schema.properties || {};
    if (schema.additionalProperties === true && !schema.properties) {
        return normalizeLooseJson(value, path);
    }
    const unknownFields = Object.keys(value).filter(key => !Object.hasOwn(properties, key));
    if (unknownFields.length > 0) {
        fail(`${path} 包含未声明字段：${unknownFields.join('、')}`, path, { unknownFields });
    }
    const normalized = {};
    for (const field of schema.required || []) {
        if (
            !Object.hasOwn(value, field)
            || value[field] === null
            || value[field] === ''
            || (typeof value[field] === 'string' && !value[field].trim())
        ) {
            fail(`${path}.${field} 为必填字段`, `${path}.${field}`);
        }
    }
    for (const [key, raw] of Object.entries(value)) {
        if (raw === undefined || raw === null) continue;
        if (
            typeof raw === 'string'
            && raw.trim() === ''
            && !(
                properties[key]?.type === 'string'
                && Object.hasOwn(properties[key], 'minLength')
                && properties[key].minLength === 0
            )
        ) continue;
        normalized[key] = normalizeBySchema(raw, properties[key], `${path}.${key}`);
    }
    return normalized;
}

function normalizeLooseJson(value, path) {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') return normalizeString(value, {}, path);
    if (typeof value === 'number') return normalizeNumber(value, {}, path);
    if (Array.isArray(value)) {
        if (value.length > 100) fail(`${path} 最多允许 100 项`, path);
        return value.map((item, index) => normalizeLooseJson(item, `${path}[${index}]`));
    }
    if (!value || typeof value !== 'object') fail(`${path} 包含不支持的值`, path);
    const entries = Object.entries(value);
    if (entries.length > 100) fail(`${path} 字段过多`, path);
    return Object.fromEntries(entries.map(([key, item]) => [
        key,
        normalizeLooseJson(item, `${path}.${key}`),
    ]));
}

function normalizeArray(value, schema, path) {
    if (!Array.isArray(value)) fail(`${path} 必须是数组`, path);
    if (schema.minItems !== undefined && value.length < schema.minItems) {
        fail(`${path} 至少需要 ${schema.minItems} 项`, path);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        fail(`${path} 最多允许 ${schema.maxItems} 项`, path);
    }
    return value.map((item, index) => normalizeBySchema(item, schema.items || {}, `${path}[${index}]`));
}

function normalizeBySchema(value, schema = {}, path = 'args') {
    if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
        const { oneOf, ...baseSchema } = schema;
        const matches = [];
        const failures = [];
        for (const candidate of oneOf) {
            try {
                matches.push(normalizeBySchema(value, {
                    ...baseSchema,
                    ...candidate,
                    properties: baseSchema.properties || candidate.properties,
                }, path));
            } catch (error) {
                failures.push(error.message);
            }
        }
        if (matches.length !== 1) {
            fail(`${path} 必须且只能符合一种输入形式`, path, {
                matchedSchemas: matches.length,
                failures,
            });
        }
        return matches[0];
    }
    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
        const { anyOf, ...baseSchema } = schema;
        const failures = [];
        for (const candidate of anyOf) {
            try {
                return normalizeBySchema(value, {
                    ...baseSchema,
                    ...candidate,
                    properties: baseSchema.properties || candidate.properties,
                }, path);
            } catch (error) {
                failures.push(error.message);
            }
        }
        fail(`${path} 不符合任何允许的输入形式`, path, { failures });
    }
    switch (schema.type) {
        case 'object':
            return normalizeObject(value, schema, path);
        case 'array':
            return normalizeArray(value, schema, path);
        case 'string':
            return normalizeString(value, schema, path);
        case 'integer':
            return normalizeNumber(value, schema, path, true);
        case 'number':
            return normalizeNumber(value, schema, path, false);
        case 'boolean':
            if (typeof value !== 'boolean') fail(`${path} 必须是布尔值`, path);
            return value;
        default:
            return value;
    }
}

function validateAiToolArgs(toolName, rawArgs = {}) {
    const schema = TOOL_SCHEMAS.get(String(toolName || ''));
    if (!schema) {
        throw new AiToolInputValidationError(`AI 工具未登记输入 schema：${toolName}`, {
            toolName,
        });
    }
    return normalizeBySchema(rawArgs, schema, 'args');
}

function isRegisteredAiTool(toolName) {
    return TOOL_SCHEMAS.has(String(toolName || ''));
}

module.exports = {
    AiToolInputValidationError,
    isRegisteredAiTool,
    validateAiToolArgs,
};
