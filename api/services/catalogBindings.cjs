const { z } = require('zod');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { auditCatalogReferences } = require('./catalogReferenceAudit.cjs');
const { catalogSourceHash, readCatalogSource, readSnapshotPointer } = require('./catalogSources.cjs');
const { resolveCatalogReferences } = require('./catalogReferences.cjs');
const { CommandExecutionError, executePersistentCommand, requestHash } = require('./commandExecution.cjs');
const { issueBusinessConfirmation, consumeBusinessConfirmation } = require('./businessConfirmation.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');

const CAPABILITY_ID = requireBusinessCapability('catalog.bind_references').capabilityId;
const QUERY_ID = requireBusinessCapability('catalog.bound_names').capabilityId;
const SOURCE_TYPE = z.enum(['part', 'coil', 'template', 'recipe', 'modelVariant', 'quotation', 'order', 'orderRevision', 'drawing', 'fileLink']);
const PROFILE_COLUMNS = Object.freeze({ part: 'part_id', coil: 'coil_id', template: 'template_id', recipe: 'recipe_id', modelVariant: 'model_variant_id' });
const NAME_COLUMNS = Object.freeze({ part: 'model', coil: 'scheme_name', template: 'shell_model', recipe: 'name', modelVariant: 'model_name' });
const PROFILE_QUERIES = Object.fromEntries(Object.entries(PROFILE_COLUMNS).map(([type, column]) => [type,
    `SELECT * FROM catalog_identity_profiles WHERE ${column} = ?`]));
const SELECTION = z.object({
    sourceType: SOURCE_TYPE, sourceId: z.number().int().positive().safe(),
    path: z.string().min(2).max(2000).regex(/^\/(?:[^~]|~[01])*$/),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    targetType: z.enum(['part', 'coil', 'template', 'recipe', 'modelVariant']),
    targetId: z.number().int().positive().safe(),
}).strict();
const PREVIEW_INPUT = z.object({ bindings: z.array(SELECTION).min(1).max(100) }).strict();
const APPLY_INPUT = z.object({ confirmationToken: z.string(), idempotencyKey: z.string().optional() }).strict();
const READ_INPUT = z.object({ sourceType: SOURCE_TYPE, sourceId: z.number().int().positive().safe(),
    afterId: z.number().int().nonnegative().safe().default(0), limit: z.number().int().min(1).max(100).default(100),
}).strict();
function fail(code, message, status = 409) { throw new CommandExecutionError(code, message, status); }
function parse(schema, value) {
    const result = schema.safeParse(value);
    if (!result.success) fail('catalog_binding_invalid', '物料引用参数无效，请核对来源、路径和目标 ID', 400);
    return result.data;
}
function version(hash) { return `sha256:${hash}`; }
function existingBinding(db, selection) {
    return db.prepare(`SELECT * FROM catalog_reference_bindings WHERE source_type = ? AND source_id = ?
        AND source_version = ? AND source_path = ? AND source_hash = ?`).get(
        selection.sourceType, selection.sourceId, version(selection.sourceHash), selection.path, selection.sourceHash) || null;
}

// Only a unique, audited reference can become a binding. A client-provided ID
// alone is never evidence that an old name referred to that catalog record.
function inspectBindings(db, input) {
    const report = auditCatalogReferences(db);
    if (!report.complete) fail('catalog_binding_audit_incomplete', '引用盘点不完整，不能建立绑定');
    const seen = new Set();
    return input.bindings.map(selection => {
        const key = JSON.stringify([selection.sourceType, selection.sourceId, selection.path]);
        if (seen.has(key)) fail('catalog_binding_duplicate', '同一来源位置不能重复绑定', 400);
        seen.add(key);
        const matches = report.references.filter(ref => ref.sourceType === selection.sourceType
            && ref.sourceId === selection.sourceId && ref.path === selection.path && ref.sourceHash === selection.sourceHash);
        const reference = matches[0];
        if (matches.length !== 1 || !['resolved_id', 'resolved_legacy'].includes(reference.status)
            || reference.targetType !== selection.targetType || reference.candidateIds.length !== 1
            || reference.candidateIds[0] !== selection.targetId) {
            fail('catalog_binding_unresolved', '来源已变化或引用不能唯一核实，请重新盘点');
        }
        const source = readCatalogSource(db, selection.sourceType, selection.sourceId);
        const snapshot = readSnapshotPointer(source, selection.path);
        if (!snapshot.found || !['string', 'number'].includes(typeof snapshot.value)
            || catalogSourceHash(source) !== selection.sourceHash) fail('catalog_binding_source_changed', '引用来源或快照已变化');
        const target = readCatalogSource(db, selection.targetType, selection.targetId);
        const profile = db.prepare(PROFILE_QUERIES[selection.targetType]).get(selection.targetId) || null;
        const existing = existingBinding(db, selection);
        if (existing && (existing.deleted_at || existing.target_profile_id !== profile?.id
            || existing.target_spec_revision !== profile?.spec_revision)) fail('catalog_binding_conflict', '该位置已有不同或已撤销的绑定，不能覆盖');
        return { ...selection, snapshotValue: snapshot.value, currentName: target[NAME_COLUMNS[selection.targetType]],
            supplier: target.supplier ?? null, targetHash: catalogSourceHash(target),
            profileHash: catalogSourceHash(profile), existingHash: catalogSourceHash(existing),
            alreadyBound: Boolean(existing) };
    });
}

function previewCatalogBindings(db, value, subject) {
    const input = parse(PREVIEW_INPUT, value);
    return db.transaction(() => {
        const entries = inspectBindings(db, input);
        if (entries.every(entry => entry.alreadyBound)) fail('catalog_binding_no_changes', '所选引用已经绑定');
        const frozen = { bindings: input.bindings, entries };
        const confirmation = issueBusinessConfirmation({ capabilityId: CAPABILITY_ID, input: frozen, subject });
        return { preview: true, capabilityId: CAPABILITY_ID, ...confirmation, previewHash: requestHash(frozen),
            suggestedIdempotencyKey: `catalog-bind:${confirmation.operationId}`, entries,
            warnings: [{ code: 'DISPLAY_BINDING_ONLY', message: '仅建立显示引用；保留原快照，不确认物理规格，也不授权采购或库存写入' }] };
    }).deferred();
}

function executeCatalogBindings(dependencies, value, context, subject) {
    const input = parse(APPLY_INPUT, value);
    if (!context?.idempotencyKey || context.warnings?.some(warning => warning.code === 'idempotency_key_missing_compatibility')) {
        fail('idempotency_key_required', '绑定操作必须提供明确的幂等键', 400);
    }
    const confirmation = consumeBusinessConfirmation({ confirmationToken: input.confirmationToken,
        capabilityId: CAPABILITY_ID, subject, idempotencyKey: context.idempotencyKey });
    const { db, safeInsert } = dependencies;
    return executePersistentCommand({ db, ...context, capabilityId: CAPABILITY_ID,
        operationId: confirmation.operationId, input: confirmation.input,
        businessChange: standardBusinessChange({ domain: 'settings', eventType: 'updated', reason: '核实历史物料显示引用' }),
        execute: ({ auditContext }) => {
            const entries = inspectBindings(db, confirmation.input);
            if (requestHash(entries) !== requestHash(confirmation.input.entries)) fail('catalog_binding_preview_stale', '来源、目标或绑定已变化，请重新预览');
            const auditIds = [];
            const bindingIds = [];
            const changes = [];
            const now = new Date().toISOString();
            const insert = (table, values) => {
                const write = safeInsert(table, values, auditContext);
                auditIds.push(write.auditId);
                return Number(write.lastInsertRowid);
            };
            for (const entry of entries) {
                if (entry.alreadyBound) continue;
                let profile = db.prepare(PROFILE_QUERIES[entry.targetType]).get(entry.targetId);
                if (!profile) {
                    const id = insert('catalog_identity_profiles', { [PROFILE_COLUMNS[entry.targetType]]: entry.targetId,
                        naming_state: 'legacy', created_at: now, updated_at: now });
                    profile = { id, spec_revision: 1 };
                }
                const bindingId = insert('catalog_reference_bindings', {
                    source_type: entry.sourceType, source_id: entry.sourceId, source_version: version(entry.sourceHash),
                    source_path: entry.path, source_hash: entry.sourceHash, target_profile_id: profile.id,
                    target_spec_revision: profile.spec_revision, created_at: now, updated_at: now,
                });
                bindingIds.push(bindingId);
                changes.push({ resourceType: entry.targetType === 'modelVariant' ? 'model_variant' : entry.targetType,
                    resourceId: entry.targetId, field: 'catalogReferenceBinding', from: null, to: bindingId });
            }
            return { data: { bindingIds, displayOnly: true }, resource: { type: 'catalogReferenceBinding', ids: bindingIds },
                changes,
                auditIds, requiredAuditCount: auditIds.length };
        } });
}

function readBoundCatalogNames(db, value) {
    const input = parse(READ_INPUT, value);
    return db.transaction(() => {
        const source = readCatalogSource(db, input.sourceType, input.sourceId);
        if (!source) fail('catalog_binding_source_missing', '引用来源不存在', 404);
        const sourceHash = catalogSourceHash(source);
        const rows = db.prepare(`SELECT b.*, p.part_id, p.coil_id, p.template_id, p.recipe_id, p.model_variant_id
            FROM catalog_reference_bindings b JOIN catalog_identity_profiles p ON p.id = b.target_profile_id
            WHERE b.source_type = ? AND b.source_id = ? AND b.deleted_at IS NULL AND b.id > ? ORDER BY b.id LIMIT ?`)
            .all(input.sourceType, input.sourceId, input.afterId, input.limit + 1);
        const page = rows.slice(0, input.limit);
        const references = page.map(row => {
            const entityType = Object.keys(PROFILE_COLUMNS).find(type => row[PROFILE_COLUMNS[type]] != null);
            return { entityType, entityId: row[PROFILE_COLUMNS[entityType]], specRevision: row.target_spec_revision };
        });
        const resolved = resolveCatalogReferences(db, { references }).items;
        return { sourceOfTruth: QUERY_ID, sourceType: input.sourceType, sourceId: input.sourceId, sourceHash,
            nextAfterId: rows.length > input.limit ? page.at(-1).id : null,
            items: page.map((row, index) => {
                const target = resolved[index];
                const snapshot = readSnapshotPointer(source, row.source_path);
                const valid = row.source_hash === sourceHash && row.source_version === version(sourceHash)
                    && snapshot.found && ['number', 'string'].includes(typeof snapshot.value);
                let referenceStatus = target.referenceStatus;
                if (!valid) referenceStatus = 'stale_source';
                else if (!['missing', 'inactive'].includes(referenceStatus) && target.specRevision !== row.target_spec_revision) referenceStatus = 'specification_changed';
                else if (referenceStatus === 'specification_unverified') referenceStatus = 'bound_legacy';
                return { bindingId: row.id, path: row.source_path, entityType: target.entityType, entityId: target.entityId,
                    snapshotValue: valid ? snapshot.value : null, currentName: valid ? target.currentName : null,
                    referenceStatus, nameRevision: target.nameRevision, specRevision: target.specRevision, displayOnly: true };
            }) };
    }).deferred();
}

module.exports = { CAPABILITY_ID, previewCatalogBindings, executeCatalogBindings, readBoundCatalogNames };
