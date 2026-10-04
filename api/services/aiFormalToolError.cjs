'use strict';

// Only contract-level diagnostics may cross from the formal API to the model.
const SAFE_DETAIL_KEYS = new Set(['path', 'missingFields', 'allowedValues', 'unknownFields', 'candidateCount', 'entityType', 'status', 'canonicalBinding']);
const SAFE_CATEGORIES = new Set(['INVALID_ARGUMENT', 'AMBIGUITY', 'NOT_FOUND', 'UNSUPPORTED_CAPABILITY', 'UNSUPPORTED_OVERRIDE', 'STALE_CONFLICT', 'TRANSPORT_UNAVAILABLE']);

function categoryFor(code, statusCode) {
    const value = String(code || '').toUpperCase();
    if (/AMBIGU/.test(value)) return 'AMBIGUITY';
    if (/NOT_FOUND|UNKNOWN_ENTITY/.test(value) || statusCode === 404) return 'NOT_FOUND';
    if (/PACKING.*BIND/.test(value)) return 'INVALID_ARGUMENT';
    if (/UNSUPPORTED.*OVERRIDE|OVERRIDE.*UNSUPPORTED/.test(value)) return 'UNSUPPORTED_OVERRIDE';
    if (/UNSUPPORTED|NOT_IMPLEMENTED|CAPABILITY.*MISSING/.test(value)) return 'UNSUPPORTED_CAPABILITY';
    if (/STALE|CONFLICT|VERSION_MISMATCH/.test(value) || statusCode === 409) return 'STALE_CONFLICT';
    if (/INVALID|REJECTED|MISSING|REQUIRED|UNVERIFIED|SCHEMA/.test(value) || statusCode === 400 || statusCode === 422) return 'INVALID_ARGUMENT';
    return 'TRANSPORT_UNAVAILABLE';
}

function safeDetails(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const safeScalar = value => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value !== 'string' || value.length > 160 || /[\r\n]|https?:\/\/|(?:token|secret|password|authorization)/i.test(value)) return undefined;
        return value;
    };
    const canonicalBinding = value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        const partId = Number(value.partId);
        const model = safeScalar(value.model);
        const supplier = safeScalar(value.supplier);
        const packingRole = safeScalar(value.packingRole);
        if (!Number.isSafeInteger(partId) || partId < 1 || model === undefined || supplier === undefined || packingRole === undefined) return undefined;
        return { partId, model, supplier, packingRole };
    };
    return Object.fromEntries(Object.entries(input).filter(([key]) => SAFE_DETAIL_KEYS.has(key)).map(([key, value]) => [key,
        key === 'canonicalBinding' ? canonicalBinding(value) : Array.isArray(value) ? value.map(safeScalar).filter(item => item !== undefined).slice(0, 20) : safeScalar(value),
    ]).filter(([, value]) => value !== undefined));
}

function formalToolFailure(result, agentToolName) {
    const code = typeof result?.code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(result.code) ? result.code : 'FORMAL_TOOL_FAILED';
    const category = SAFE_CATEGORIES.has(result?.category) ? result.category : categoryFor(code, result?.statusCode);
    const details = safeDetails(result?.validation || result?.details || result);
    return Object.freeze({ success: false, agentToolName, verified: false, data: null, code, category,
        recoverable: ['INVALID_ARGUMENT', 'AMBIGUITY', 'NOT_FOUND', 'STALE_CONFLICT', 'TRANSPORT_UNAVAILABLE'].includes(category),
        ...(Object.keys(details).length ? { details } : {}),
        message: {
            INVALID_ARGUMENT: '正式工具参数或身份需要修正。', AMBIGUITY: '正式身份存在多个候选，需要明确选择。',
            NOT_FOUND: '正式对象未找到。', UNSUPPORTED_CAPABILITY: '当前正式业务能力不支持该操作。',
            UNSUPPORTED_OVERRIDE: '当前正式场景不支持该配置或缺少正式绑定。',
            STALE_CONFLICT: '正式数据已变化，请重新读取。', TRANSPORT_UNAVAILABLE: '正式业务服务暂不可用。',
        }[category] });
}

module.exports = { categoryFor, formalToolFailure, safeDetails };
