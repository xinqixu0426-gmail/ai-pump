'use strict';

const ENTITY_LOOKUP_API_VERSION = 1;
const MAX_MENTION_LENGTH = 160;
const MAX_ENTITY_TYPES_PER_REQUEST = 6;
const MAX_CANDIDATES_PER_TYPE = 10;
const MAX_TOTAL_CANDIDATES = 30;

const SUPPORTED_ENTITY_TYPES = Object.freeze([
    'coil',
    'customer',
    'order',
    'part',
    'recipe',
    'template',
]);
const MATCH_POLICIES = Object.freeze([
    'EXACT',
    'APPROVED_ALIAS',
    'EXACT_OR_APPROVED_ALIAS',
]);
const REQUEST_FIELDS = new Set(['version', 'mention', 'entityTypes', 'matchPolicy']);

class EntityLookupError extends Error {
    constructor(message, code = 'ENTITY_LOOKUP_INVALID_REQUEST', statusCode = 400, lookupStatus = 'INVALID_REQUEST') {
        super(message);
        this.name = 'EntityLookupError';
        this.code = code;
        this.statusCode = statusCode;
        this.lookupStatus = lookupStatus;
    }
}

function invalid(message, code = 'ENTITY_LOOKUP_INVALID_REQUEST', lookupStatus = 'INVALID_REQUEST') {
    return new EntityLookupError(message, code, 400, lookupStatus);
}

function validateEntityLookupRequest(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw invalid('请求体必须是对象');
    }
    const unexpectedFields = Object.keys(input).filter(key => !REQUEST_FIELDS.has(key));
    if (unexpectedFields.length > 0) {
        throw invalid('请求包含未声明字段', 'ENTITY_LOOKUP_UNEXPECTED_FIELD');
    }
    if (input.version !== ENTITY_LOOKUP_API_VERSION) {
        throw invalid('不支持的实体查询版本', 'ENTITY_LOOKUP_VERSION_UNSUPPORTED');
    }
    if (typeof input.mention !== 'string') {
        throw invalid('mention 必须是字符串', 'ENTITY_LOOKUP_MENTION_TYPE_INVALID');
    }
    if (input.mention.trim().length === 0) {
        throw invalid('mention 不能为空', 'ENTITY_LOOKUP_MENTION_REQUIRED');
    }
    if ([...input.mention].length > MAX_MENTION_LENGTH) {
        throw invalid('mention 超过最大长度', 'ENTITY_LOOKUP_MENTION_TOO_LONG');
    }
    if (!Array.isArray(input.entityTypes) || input.entityTypes.length === 0) {
        throw invalid('entityTypes 必须是非空数组', 'ENTITY_LOOKUP_ENTITY_TYPES_REQUIRED');
    }
    if (input.entityTypes.length > MAX_ENTITY_TYPES_PER_REQUEST) {
        throw invalid('entityTypes 超过单次上限', 'ENTITY_LOOKUP_ENTITY_TYPES_LIMIT');
    }
    if (input.entityTypes.some(type => typeof type !== 'string')) {
        throw invalid('entityTypes 只能包含字符串', 'ENTITY_LOOKUP_ENTITY_TYPE_INVALID');
    }
    if (new Set(input.entityTypes).size !== input.entityTypes.length) {
        throw invalid('entityTypes 不得重复', 'ENTITY_LOOKUP_ENTITY_TYPES_DUPLICATE');
    }
    const unsupported = input.entityTypes.filter(type => !SUPPORTED_ENTITY_TYPES.includes(type));
    if (unsupported.length > 0) {
        throw invalid('包含不支持的实体类型', 'ENTITY_LOOKUP_UNSUPPORTED_TYPE', 'UNSUPPORTED_TYPE');
    }
    if (!MATCH_POLICIES.includes(input.matchPolicy)) {
        throw invalid('matchPolicy 不受支持', 'ENTITY_LOOKUP_MATCH_POLICY_INVALID');
    }
    return Object.freeze({
        version: ENTITY_LOOKUP_API_VERSION,
        mention: input.mention,
        entityTypes: Object.freeze([...input.entityTypes]),
        matchPolicy: input.matchPolicy,
    });
}

const EXACT_LOOKUPS = Object.freeze({
    coil: Object.freeze({
        sql: `
            SELECT id
            FROM coils
            WHERE scheme_code = ? COLLATE NOCASE
               OR scheme_name = ? COLLATE NOCASE
               OR spec = ? COLLATE NOCASE
               OR (spec || '-' || CAST(sheets AS TEXT)) = ? COLLATE NOCASE
            ORDER BY id
            LIMIT ?
        `,
        parameters: mention => [mention, mention, mention, mention],
    }),
    customer: Object.freeze({
        sql: `
            SELECT id
            FROM customers
            WHERE deleted_at IS NULL
              AND name = ? COLLATE NOCASE
            ORDER BY id
            LIMIT ?
        `,
        parameters: mention => [mention],
    }),
    order: Object.freeze({
        sql: `
            SELECT id
            FROM orders
            WHERE deleted_at IS NULL
              AND (
                    CAST(id AS TEXT) = ?
                 OR contract_no = ? COLLATE NOCASE
                 OR customer_name = ? COLLATE NOCASE
              )
            ORDER BY id
            LIMIT ?
        `,
        parameters: mention => [mention, mention, mention],
    }),
    part: Object.freeze({
        sql: `
            SELECT id
            FROM parts
            WHERE deleted_at IS NULL
              AND model = ? COLLATE NOCASE
            ORDER BY id
            LIMIT ?
        `,
        parameters: mention => [mention],
    }),
    recipe: Object.freeze({
        sql: `
            SELECT id
            FROM recipes
            WHERE deleted_at IS NULL
              AND (name = ? COLLATE NOCASE OR spec = ? COLLATE NOCASE)
            ORDER BY id
            LIMIT ?
        `,
        parameters: mention => [mention, mention],
    }),
    template: Object.freeze({
        sql: `
            SELECT id
            FROM pump_shell_templates
            WHERE shell_model = ? COLLATE NOCASE
            ORDER BY id
            LIMIT ?
        `,
        parameters: mention => [mention],
    }),
});

function createEntityLookupService({ db } = {}) {
    if (!db || typeof db.prepare !== 'function') {
        throw new TypeError('实体查询服务缺少数据库依赖');
    }

    function lookupExact(entityType, mention) {
        const definition = EXACT_LOOKUPS[entityType];
        const rows = db.prepare(definition.sql).all(
            ...definition.parameters(mention),
            MAX_CANDIDATES_PER_TYPE + 1
        );
        const complete = rows.length <= MAX_CANDIDATES_PER_TYPE;
        const candidates = rows.slice(0, MAX_CANDIDATES_PER_TYPE).map(row => ({
            entityType,
            canonicalId: String(row.id),
            matchKind: 'EXACT',
        }));
        return { complete, candidates };
    }

    function lookupEntities(input) {
        const request = validateEntityLookupRequest(input);
        const candidates = [];
        let complete = true;

        for (const entityType of request.entityTypes) {
            const result = request.matchPolicy === 'APPROVED_ALIAS'
                ? { complete: true, candidates: [] }
                : lookupExact(entityType, request.mention);
            complete = complete && result.complete;
            candidates.push(...result.candidates);
        }

        const deduped = [];
        const seen = new Set();
        for (const candidate of candidates) {
            const key = `${candidate.entityType}\0${candidate.canonicalId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(candidate);
        }
        if (deduped.length > MAX_TOTAL_CANDIDATES) complete = false;
        const boundedCandidates = deduped.slice(0, MAX_TOTAL_CANDIDATES);
        return Object.freeze({
            version: ENTITY_LOOKUP_API_VERSION,
            status: complete ? 'OK' : 'INCOMPLETE',
            complete,
            attemptedEntityTypes: request.entityTypes.length,
            candidateCount: boundedCandidates.length,
            candidates: Object.freeze(boundedCandidates.map(candidate => Object.freeze({ ...candidate }))),
        });
    }

    return Object.freeze({ lookupEntities });
}

module.exports = {
    ENTITY_LOOKUP_API_VERSION,
    EntityLookupError,
    MATCH_POLICIES,
    MAX_CANDIDATES_PER_TYPE,
    MAX_ENTITY_TYPES_PER_REQUEST,
    MAX_MENTION_LENGTH,
    MAX_TOTAL_CANDIDATES,
    SUPPORTED_ENTITY_TYPES,
    createEntityLookupService,
    validateEntityLookupRequest,
};
