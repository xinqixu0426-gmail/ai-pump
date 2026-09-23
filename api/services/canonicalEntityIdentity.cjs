'use strict';
/**
 * E1-C — Cross-Capability Canonical Entity Identity（统一实体身份契约）
 *
 * ── 契约 ────────────────────────────────────────────────────────────
 * 1. **主键优先**：canonical identity 只能由正式实体主键产生
 *    （`{entityType, entityId}`，与 Native Task V2 `makeFactKey` 的字段一致）。
 *    身份规范本身来自已有的 `aiStableEntityIdentityV4`（`ENTITY_IDENTITY_SPECS`），
 *    本模块不另造规范。
 * 2. **名称不是 canonical**：`name`/`model`/`schemeCode` 只是**展示身份**。
 *    缺少主键时状态为 `IDENTITY_INCOMPLETE`，绝不声称 canonical，
 *    也**不得**用于跨来源合并（否则同名不同 ID 会被吞掉）。
 * 3. **正式绑定**：缺主键时，允许用**同一轮其它正式回执**里的
 *    「业务键 → 主键」唯一映射把身份补齐（`FORMAL_RECEIPT_BINDING`）。
 *    映射不唯一（同名多 ID）时保持 `IDENTITY_INCOMPLETE` + `ambiguous`，不猜。
 *
 * 该模块被金额事实投影与关键事实投影共用，是未来新增 Native 能力时的身份入口。
 */

const { ENTITY_IDENTITY_SPECS, normalizeStableEntityIdentity } = require('./aiStableEntityIdentityV4.cjs');

// 实体类型判定：只认实体契约声明的身份字段（与 ENTITY_IDENTITY_SPECS 同源），
// 其次退回能力登记的业务域。不做自由文本猜测。
const ENTITY_TYPE_MARKERS = Object.freeze([
    Object.freeze({ entityType: 'coil', fields: Object.freeze(['schemeCode', 'scheme_code', 'coilId', 'slotType', 'schemeFamilyCode']) }),
    Object.freeze({ entityType: 'recipe', fields: Object.freeze(['recipeId', 'recipeName', 'partsCount']) }),
    Object.freeze({ entityType: 'part', fields: Object.freeze(['partId', 'category', 'supplier']) }),
    Object.freeze({ entityType: 'template', fields: Object.freeze(['templateId', 'shellModel']) }),
    Object.freeze({ entityType: 'customer', fields: Object.freeze(['customerId', 'customerName']) }),
    Object.freeze({ entityType: 'order', fields: Object.freeze(['orderId', 'contractNo']) }),
]);
const DOMAIN_ENTITY_TYPE = Object.freeze({
    recipe: 'recipe', coil: 'coil', catalog: 'part', part: 'part',
    template: 'template', customer: 'customer', order: 'order',
});

function present(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
}

/** 实体类型：记录自身身份字段优先，其次能力业务域。 */
function inferEntityType(record, domainHint) {
    if (record && typeof record === 'object') {
        for (const marker of ENTITY_TYPE_MARKERS) {
            if (marker.fields.some(field => present(record[field]) !== null)) return marker.entityType;
        }
        if (present(record.name) !== null && present(record.spec) !== null) return 'recipe';
    }
    return DOMAIN_ENTITY_TYPE[String(domainHint || '')] || null;
}

/** 业务键（展示身份）取值：取实体契约声明的稳定业务键与规范名。 */
function businessKeyValues(entityType, record) {
    const spec = ENTITY_IDENTITY_SPECS[entityType];
    if (!spec) return [];
    const normalized = normalizeStableEntityIdentity({ entityType, record });
    const values = new Set();
    if (normalized) {
        for (const value of Object.values(normalized.stableBusinessKeys)) if (value) values.add(String(value).trim());
        if (normalized.canonicalName) values.add(String(normalized.canonicalName).trim());
    }
    for (const field of spec.canonicalNameFields || []) {
        const value = present(record?.[field]);
        if (value) values.add(value);
    }
    return [...values].filter(Boolean);
}

/**
 * 主键优先的 canonical identity。
 * @returns {{ state: 'CANONICAL'|'IDENTITY_INCOMPLETE', entityType: string|null, entityId: string|null,
 *             displayName: string|null, businessKeys: string[], resolvedBy: string|null, reasonCode: string|null, ambiguous: boolean }}
 */
function canonicalIdentityFor({ entityType = null, record = null } = {}) {
    const normalized = entityType ? normalizeStableEntityIdentity({ entityType, record }) : null;
    const primary = normalized?.primaryStableId ?? null;
    if (entityType && primary) {
        return Object.freeze({
            state: 'CANONICAL', entityType, entityId: String(primary),
            displayName: normalized.canonicalName || businessKeyValues(entityType, record)[0] || null,
            businessKeys: businessKeyValues(entityType, record),
            resolvedBy: 'PRIMARY_KEY', reasonCode: null, ambiguous: false,
        });
    }
    return Object.freeze({
        state: 'IDENTITY_INCOMPLETE', entityType, entityId: null,
        displayName: normalized?.canonicalName || businessKeyValues(entityType, record)[0] || null,
        businessKeys: businessKeyValues(entityType, record),
        resolvedBy: null,
        reasonCode: entityType ? 'PRIMARY_KEY_ABSENT' : 'ENTITY_TYPE_UNKNOWN',
        ambiguous: false,
    });
}

/**
 * 从本轮**已核验正式回执**建立「业务键 → 主键」索引。
 * 只登记同时具备主键与业务键的记录；同一业务键命中多个主键时标记为 ambiguous。
 */
function buildEntityBindingIndex(toolResults = []) {
    const index = new Map(); // `${entityType}\u0000${businessKey}` → Set(entityId)
    const hasVerified = require('./aiExecutionEvidence.cjs').hasVerifiedExecution;
    for (const item of toolResults) {
        const result = item?.result;
        if (!result || result.success === false || !hasVerified(result)) continue;
        const domain = require('../capabilities/registry.cjs').getAiCapability(item.name)?.domain;
        const seen = new Set();
        (function walk(value, depth = 0) {
            if (!value || typeof value !== 'object' || depth > 4) return;
            if (!Array.isArray(value) && !seen.has(value)) {
                seen.add(value);
                const entityType = inferEntityType(value, domain);
                const identity = canonicalIdentityFor({ entityType, record: value });
                if (identity.state === 'CANONICAL') {
                    for (const key of businessKeyValues(entityType, value)) {
                        const mapKey = `${entityType}\u0000${key}`;
                        if (!index.has(mapKey)) index.set(mapKey, new Set());
                        index.get(mapKey).add(identity.entityId);
                    }
                }
            }
            for (const child of Array.isArray(value) ? value : Object.values(value)) {
                if (child && typeof child === 'object') walk(child, depth + 1);
            }
        })(result.data ?? result, 1);
    }
    return index;
}

/**
 * 补齐身份：主键优先；否则用正式回执的唯一业务键映射绑定；再否则 fail-closed 为不完整。
 */
function resolveEntityIdentity({ entityType = null, record = null, domainHint = null, index = null } = {}) {
    const type = entityType || inferEntityType(record, domainHint);
    const direct = canonicalIdentityFor({ entityType: type, record });
    if (direct.state === 'CANONICAL') return direct;
    if (type && index) {
        const candidates = new Set();
        for (const key of businessKeyValues(type, record)) {
            const bound = index.get(`${type}\u0000${key}`);
            if (bound) for (const id of bound) candidates.add(id);
        }
        if (candidates.size === 1) {
            return Object.freeze({
                ...direct, state: 'CANONICAL', entityId: [...candidates][0],
                resolvedBy: 'FORMAL_RECEIPT_BINDING', reasonCode: null, ambiguous: false,
            });
        }
        if (candidates.size > 1) {
            return Object.freeze({ ...direct, reasonCode: 'AMBIGUOUS_BUSINESS_KEY', ambiguous: true });
        }
    }
    return direct;
}

/** 与 Native Task V2 FactKey 对齐的身份键：`entityType:entityId`；不完整时返回 null。 */
function entityIdentityKey(identity) {
    return identity && identity.state === 'CANONICAL' && identity.entityType && identity.entityId
        ? `${identity.entityType}:${identity.entityId}`
        : null;
}

module.exports = {
    ENTITY_TYPE_MARKERS,
    DOMAIN_ENTITY_TYPE,
    inferEntityType,
    businessKeyValues,
    canonicalIdentityFor,
    buildEntityBindingIndex,
    resolveEntityIdentity,
    entityIdentityKey,
};
