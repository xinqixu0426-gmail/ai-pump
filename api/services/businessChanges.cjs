const crypto = require('node:crypto');

const BUSINESS_DOMAINS = new Set([
    'order',
    'quotation',
    'purchasing',
    'part',
    'recipe',
    'template',
    'coil',
    'customer',
    'model_variant',
    'quality',
    'rotor',
    'settings',
    'file',
    'knowledge',
    'workflow',
]);

const EVENT_TYPES = new Set([
    'created',
    'updated',
    'deleted',
    'status_changed',
    'inventory_changed',
    'converted',
]);

const ENTITY_TYPE_ALIASES = Object.freeze({
    pumpShellTemplate: 'template',
    purchase_item: 'purchasing',
    purchase_item_progress: 'purchasing',
    purchase_inbound: 'purchasing',
    purchase_task: 'purchasing',
    statorVariant: 'coil',
    pumpModelVariant: 'model_variant',
    recipeAnalysisFeedback: 'quality',
    factoryRuleCandidate: 'quality',
    rotorDrawing: 'rotor',
    businessSetting: 'settings',
    runtimeSetting: 'settings',
    runtimeSettings: 'settings',
    factoryProfile: 'settings',
    factoryFile: 'file',
    factoryFileArchive: 'file',
    factoryFileLink: 'file',
    knowledgeDocument: 'knowledge',
    factoryWorkflowRun: 'workflow',
});

const ENTITY_LABEL_CONFIG = Object.freeze({
    order: { table: 'orders', column: 'contract_no', prefix: '订单' },
    quotation: { table: 'quotations', column: null, prefix: '报价' },
    part: { table: 'parts', column: 'model', prefix: '零件' },
    recipe: { table: 'recipes', column: 'name', prefix: '配方' },
    template: { table: 'pump_shell_templates', column: 'shell_model', prefix: '泵壳模板' },
    coil: { table: 'coils', column: 'spec', prefix: '线圈' },
    customer: { table: 'customers', column: 'name', prefix: '客户' },
    purchasing: { table: null, column: null, prefix: '采购业务' },
    model_variant: { table: 'pump_model_variants', column: 'model_name', prefix: '型号变体' },
    quality: { table: null, column: null, prefix: '质量规则' },
    rotor: { table: null, column: null, prefix: '转子档案' },
    settings: { table: null, column: null, prefix: '系统设置' },
    file: { table: null, column: null, prefix: '文件' },
    knowledge: { table: null, column: null, prefix: '知识资料' },
    workflow: { table: null, column: null, prefix: '工作流' },
});

const EVENT_ACTION_LABELS = Object.freeze({
    created: '创建',
    updated: '修改',
    deleted: '删除',
    status_changed: '变更状态',
    inventory_changed: '调整库存',
    converted: '转换',
});

function normalizeEntityType(value) {
    const raw = String(value || '').trim();
    return ENTITY_TYPE_ALIASES[raw] || raw;
}

function normalizeEntityId(value) {
    if (value === null || value === undefined || value === '') return '';
    return String(value).trim();
}

function safeJson(value, fallback) {
    try {
        return JSON.stringify(value ?? fallback);
    } catch {
        return JSON.stringify(fallback);
    }
}

function parseJson(value, fallback) {
    try {
        const parsed = JSON.parse(value || '');
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function clampText(value, max = 2000) {
    const text = String(value || '').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

function entityLabel(db, entityType, entityId) {
    const normalizedType = normalizeEntityType(entityType);
    const config = ENTITY_LABEL_CONFIG[normalizedType];
    if (!config) return `${normalizedType || '业务对象'} #${entityId}`;
    const fallback = `${config.prefix} #${entityId}`;
    if (!config.table || !config.column || !/^\d+$/.test(String(entityId))) return fallback;
    const row = db.prepare(
        `SELECT ${config.column} AS label FROM ${config.table} WHERE id = ?`
    ).get(Number(entityId));
    const label = String(row?.label || '').trim();
    if (!label) return fallback;
    if (normalizedType === 'coil') return `${config.prefix} ${label}（#${entityId}）`;
    return `${config.prefix} ${label}（#${entityId}）`;
}

function refsFromOutcome(outcome = {}, primaryType) {
    const refs = new Map();
    const add = (type, id, role = 'affected') => {
        const entityType = normalizeEntityType(type);
        const entityId = normalizeEntityId(id);
        if (!BUSINESS_DOMAINS.has(entityType) || !entityId) return;
        const key = `${entityType}\u0000${entityId}`;
        const current = refs.get(key);
        refs.set(key, {
            entityType,
            entityId,
            role: current?.role === 'primary' || role === 'primary' ? 'primary' : 'affected',
        });
    };
    const resource = outcome.resource || {};
    const resourceType = normalizeEntityType(primaryType || resource.type);
    if (resourceType !== 'purchasing') {
        for (const id of resource.ids || []) add(resourceType, id, 'primary');
    }
    for (const change of outcome.changes || []) {
        add(change.resourceType, change.resourceId, normalizeEntityType(change.resourceType) === resourceType ? 'primary' : 'affected');
    }
    return [...refs.values()];
}

function standardBusinessChange(options = {}) {
    const domain = normalizeEntityType(options.domain);
    const eventType = String(options.eventType || '').trim();
    if (!BUSINESS_DOMAINS.has(domain)) throw new Error(`不支持的业务变更域: ${domain}`);
    if (!EVENT_TYPES.has(eventType)) throw new Error(`不支持的业务变更类型: ${eventType}`);
    return (outcome = {}) => {
        const reason = typeof options.reason === 'function'
            ? options.reason(outcome)
            : String(options.reason || '');
        const detailRef = typeof options.detailRef === 'function'
            ? options.detailRef(outcome)
            : (options.detailRef || {});
        let entityRefs = typeof options.entityRefs === 'function'
            ? options.entityRefs(outcome)
            : refsFromOutcome(outcome, options.primaryEntityType || domain);
        if (domain === 'purchasing' && !entityRefs.some(ref => normalizeEntityType(ref.entityType) === 'purchasing')) {
            const orderRefs = entityRefs.filter(ref => normalizeEntityType(ref.entityType) === 'order');
            entityRefs = [
                ...orderRefs.map(ref => ({
                    entityType: 'purchasing',
                    entityId: ref.entityId,
                    role: 'primary',
                })),
                ...entityRefs.map(ref => ({ ...ref, role: 'affected' })),
            ];
        }
        return {
            domain,
            eventType,
            reason,
            detailRef,
            entityRefs,
            summary: typeof options.summary === 'function' ? options.summary(outcome) : options.summary,
        };
    };
}

function assertBusinessChangeDescriptor(descriptor, changes) {
    if (!descriptor || typeof descriptor !== 'object') {
        throw new Error('业务命令产生变更但缺少 businessChange 描述');
    }
    const domain = normalizeEntityType(descriptor.domain);
    const eventType = String(descriptor.eventType || '').trim();
    if (!BUSINESS_DOMAINS.has(domain)) throw new Error(`业务变更域未登记: ${domain}`);
    if (!EVENT_TYPES.has(eventType)) throw new Error(`业务变更类型未登记: ${eventType}`);
    if (!Array.isArray(changes) || changes.length === 0) {
        throw new Error('空操作不得记录业务变更事件');
    }
    const entityRefs = Array.isArray(descriptor.entityRefs) ? descriptor.entityRefs : [];
    if (entityRefs.length === 0) throw new Error('业务变更缺少 entityRefs');
    return { domain, eventType, entityRefs };
}

function recordBusinessChangeEvent(db, input = {}) {
    const changes = Array.isArray(input.changes) ? input.changes : [];
    if (changes.length === 0 || !input.descriptor) return null;
    const validated = assertBusinessChangeDescriptor(input.descriptor, changes);
    const normalizedRefs = [];
    const seen = new Set();
    for (const ref of validated.entityRefs) {
        const entityType = normalizeEntityType(ref.entityType);
        const entityId = normalizeEntityId(ref.entityId);
        if (!BUSINESS_DOMAINS.has(entityType) || !entityId) {
            throw new Error(`业务变更实体未登记: ${entityType || 'unknown'}#${entityId || '?'}`);
        }
        const key = `${entityType}\u0000${entityId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalizedRefs.push({
            entityType,
            entityId,
            role: ref.role === 'primary' ? 'primary' : 'affected',
            entityLabel: clampText(ref.entityLabel || entityLabel(db, entityType, entityId), 300),
        });
    }
    if (!normalizedRefs.some(ref => ref.role === 'primary')) normalizedRefs[0].role = 'primary';
    const reason = clampText(input.descriptor.reason, 1000);
    const labels = normalizedRefs.filter(ref => ref.role === 'primary').map(ref => ref.entityLabel);
    const summary = clampText(
        input.descriptor.summary
            || `${EVENT_ACTION_LABELS[validated.eventType]}${labels.join('、')}${reason ? `：${reason}` : ''}`,
        1000
    );
    const occurredAt = input.occurredAt || new Date().toISOString();
    const searchableChanges = changes.map(change => ({
        resourceType: normalizeEntityType(change.resourceType),
        resourceId: change.resourceId,
        field: change.field,
        reason: change.reason,
        identityKey: change.identityKey,
        description: change.description,
    }));
    const searchText = clampText([
        summary,
        reason,
        normalizedRefs.map(ref => ref.entityLabel).join(' '),
        searchableChanges.map(change => Object.values(change).filter(Boolean).join(' ')).join(' '),
    ].filter(Boolean).join('\n'), 8000);
    const info = db.prepare(`
        INSERT INTO business_change_events (
            operation_id, capability_id, event_type, primary_domain,
            summary, reason, changes_json, audit_ids_json, detail_ref_json,
            actor_key, search_text, source_type, occurred_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'command', ?, ?)
    `).run(
        input.operationId,
        input.capabilityId,
        validated.eventType,
        validated.domain,
        summary,
        reason,
        safeJson(changes, []),
        safeJson(input.auditIds, []),
        safeJson(input.descriptor.detailRef, {}),
        input.actorKey || 'system',
        searchText,
        occurredAt,
        occurredAt
    );
    const eventId = Number(info.lastInsertRowid);
    const insertRef = db.prepare(`
        INSERT INTO business_change_event_entities (
            event_id, entity_type, entity_id, entity_label, role, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const ref of normalizedRefs) {
        insertRef.run(eventId, ref.entityType, ref.entityId, ref.entityLabel, ref.role, occurredAt);
    }
    return { id: eventId, summary, eventType: validated.eventType, primaryDomain: validated.domain };
}

function businessChangeRow(row, entities = []) {
    return {
        id: Number(row.id),
        operationId: row.operation_id,
        capabilityId: row.capability_id,
        eventType: row.event_type,
        primaryDomain: row.primary_domain,
        summary: row.summary,
        reason: row.reason || '',
        changes: parseJson(row.changes_json, []),
        auditIds: parseJson(row.audit_ids_json, []),
        detailRef: parseJson(row.detail_ref_json, {}),
        actor: String(row.actor_key || '').startsWith('user:admin') ? '管理员' : '系统',
        sourceType: row.source_type,
        occurredAt: row.occurred_at,
        createdAt: row.created_at,
        entities: entities.map(entity => ({
            entityType: entity.entity_type,
            entityId: entity.entity_id,
            entityLabel: entity.entity_label,
            role: entity.role,
        })),
    };
}

function bjtDate(now = new Date()) {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
}

function addUtcDays(iso, days) {
    const date = new Date(iso);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString();
}

function periodRange(period, now = new Date()) {
    const today = bjtDate(now);
    const startToday = new Date(`${today}T00:00:00+08:00`).toISOString();
    if (!period || period === 'all') return { from: null, to: null };
    if (period === 'today') return { from: startToday, to: addUtcDays(startToday, 1) };
    if (period === 'yesterday') return { from: addUtcDays(startToday, -1), to: startToday };
    if (period === 'last7days') return { from: addUtcDays(startToday, -6), to: addUtcDays(startToday, 1) };
    if (period === 'last30days') return { from: addUtcDays(startToday, -29), to: addUtcDays(startToday, 1) };
    throw Object.assign(new Error('period 仅支持 today、yesterday、last7days、last30days 或 all'), {
        code: 'business_change_period_invalid',
        statusCode: 400,
    });
}

function normalizeIso(value, label) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw Object.assign(new Error(`${label} 不是有效时间`), {
            code: 'business_change_time_invalid',
            statusCode: 400,
        });
    }
    return date.toISOString();
}

function listBusinessChanges(db, input = {}, options = {}) {
    const range = periodRange(String(input.period || '').trim(), options.now || new Date());
    const from = normalizeIso(input.from, 'from') || range.from;
    const to = normalizeIso(input.to, 'to') || range.to;
    const domain = normalizeEntityType(input.domain);
    const entityType = normalizeEntityType(input.entityType);
    const entityId = normalizeEntityId(input.entityId);
    const eventType = String(input.eventType || '').trim();
    if (domain && !BUSINESS_DOMAINS.has(domain)) {
        throw Object.assign(new Error('domain 不在支持范围'), { code: 'business_change_domain_invalid', statusCode: 400 });
    }
    if (entityType && !BUSINESS_DOMAINS.has(entityType)) {
        throw Object.assign(new Error('entityType 不在支持范围'), { code: 'business_change_entity_type_invalid', statusCode: 400 });
    }
    if (eventType && !EVENT_TYPES.has(eventType)) {
        throw Object.assign(new Error('eventType 不在支持范围'), { code: 'business_change_event_type_invalid', statusCode: 400 });
    }
    const keyword = clampText(input.keyword, 200);
    const beforeId = Number(input.beforeId || 0);
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
    const where = [];
    const params = [];
    if (from) { where.push('e.occurred_at >= ?'); params.push(from); }
    if (to) { where.push('e.occurred_at < ?'); params.push(to); }
    if (domain) { where.push('e.primary_domain = ?'); params.push(domain); }
    if (eventType) { where.push('e.event_type = ?'); params.push(eventType); }
    if (keyword) { where.push('e.search_text LIKE ?'); params.push(`%${keyword}%`); }
    if (entityType || entityId) {
        const entityWhere = [];
        if (entityType) { entityWhere.push('r.entity_type = ?'); params.push(entityType); }
        if (entityId) { entityWhere.push('r.entity_id = ?'); params.push(entityId); }
        where.push(`EXISTS (SELECT 1 FROM business_change_event_entities r WHERE r.event_id = e.id AND ${entityWhere.join(' AND ')})`);
    }
    if (Array.isArray(input.candidateIds)) {
        const candidateIds = [...new Set(input.candidateIds.map(Number).filter(Number.isInteger))];
        if (candidateIds.length === 0) {
            where.push('1 = 0');
        } else {
            where.push(`e.id IN (${candidateIds.map(() => '?').join(', ')})`);
            params.push(...candidateIds);
        }
    }
    const baseWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM business_change_events e ${baseWhere}
    `).get(...params)?.count || 0);
    const pageWhere = [...where];
    const pageParams = [...params];
    if (Number.isInteger(beforeId) && beforeId > 0) {
        const cursor = db.prepare(
            'SELECT occurred_at FROM business_change_events WHERE id = ?'
        ).get(beforeId);
        if (cursor) {
            pageWhere.push('(e.occurred_at < ? OR (e.occurred_at = ? AND e.id < ?))');
            pageParams.push(cursor.occurred_at, cursor.occurred_at, beforeId);
        } else {
            pageWhere.push('1 = 0');
        }
    }
    const rows = db.prepare(`
        SELECT e.* FROM business_change_events e
        ${pageWhere.length ? `WHERE ${pageWhere.join(' AND ')}` : ''}
        ORDER BY e.occurred_at DESC, e.id DESC
        LIMIT ?
    `).all(...pageParams, limit);
    const selectRefs = db.prepare(`
        SELECT * FROM business_change_event_entities
        WHERE event_id = ? ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, id
    `);
    const items = rows.map(row => businessChangeRow(row, selectRefs.all(row.id)));
    return {
        items,
        total,
        nextCursor: items.length === limit ? String(items.at(-1).id) : null,
        appliedFilters: { period: input.period || 'all', from, to, domain: domain || null, entityType: entityType || null, entityId: entityId || null, eventType: eventType || null, keyword: keyword || null },
        asOf: new Date(options.now || Date.now()).toISOString(),
        provenance: { kind: 'live_business_history', sourceTable: 'business_change_events' },
    };
}

function businessChangeKnowledgeEntries(db) {
    const exists = db.prepare(`
        SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'business_change_events'
    `).get();
    if (!exists) return [];
    const rows = db.prepare('SELECT * FROM business_change_events ORDER BY id').all();
    const selectRefs = db.prepare(`
        SELECT * FROM business_change_event_entities WHERE event_id = ? ORDER BY id
    `);
    return rows.map(row => {
        const refs = selectRefs.all(row.id);
        return {
            id: Number(row.id),
            eventType: row.event_type,
            primaryDomain: row.primary_domain,
            title: row.summary,
            summary: row.summary,
            reason: row.reason || '',
            content: row.search_text,
            tags: [...new Set([row.primary_domain, row.event_type, ...refs.map(ref => ref.entity_type)])],
            entities: refs.map(ref => ({ type: ref.entity_type, id: ref.entity_id, label: ref.entity_label })),
            occurredAt: row.occurred_at,
            contentHash: crypto.createHash('sha256').update(row.search_text, 'utf8').digest('hex'),
        };
    });
}

module.exports = {
    BUSINESS_DOMAINS,
    EVENT_TYPES,
    businessChangeKnowledgeEntries,
    businessChangeRow,
    listBusinessChanges,
    recordBusinessChangeEvent,
    refsFromOutcome,
    standardBusinessChange,
};
