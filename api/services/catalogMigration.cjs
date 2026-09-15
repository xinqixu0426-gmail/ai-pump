const { z } = require('zod');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { inspectCatalogRename, previewCatalogRename, executeCatalogRename } = require('./catalogRename.cjs');
const { issueBusinessConfirmation, consumeBusinessConfirmation } = require('./businessConfirmation.cjs');
const { executePersistentCommand, requestHash, CommandExecutionError } = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const CAPABILITY_ID = requireBusinessCapability('catalog.migrate').capabilityId;
const PREVIEW = z.object({ entries: z.array(z.object({ entityType: z.enum(['part', 'coil', 'template', 'recipe', 'modelVariant']), entityId: z.number().int().positive().safe(), naming: z.object({ ruleId: z.string().min(1), spec: z.record(z.unknown()) }).strict(), samePhysicalItem: z.literal(true), expectedUpdatedAt: z.string().min(1) }).strict()).min(1).max(100) }).strict();
const APPLY = z.object({ confirmationToken: z.string().min(1), idempotencyKey: z.string().min(8).max(200) }).strict();
function parse(schema, value) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new CommandExecutionError('CATALOG_MIGRATION_INVALID', '迁移需提供1–100条已核对规格、ID、版本及同物确认，不能提交未知字段', 400);
    return parsed.data;
}
function inspectMigration(db, request) {
    const ids = new Set();
    const names = new Set();
    return request.entries.map(entry => {
        const id = `${entry.entityType}:${entry.entityId}`;
        if (ids.has(id)) throw new CommandExecutionError('CATALOG_MIGRATION_DUPLICATE', '同一对象不能重复迁移', 400);
        ids.add(id);
        const inspected = inspectCatalogRename(db, entry);
        const key = JSON.stringify([entry.entityType, inspected.currentName.toLowerCase(), entry.entityType === 'part' ? String(inspected.physical.fields.supplier).trim().toLowerCase() : '']);
        if (names.has(key)) throw new CommandExecutionError('CATALOG_MIGRATION_NAME_CONFLICT', '本批生成名称冲突，请补充真实区别或分供应商', 409);
        names.add(key);
        return inspected;
    });
}
function previewCatalogMigration(db, value, subject) {
    const request = parse(PREVIEW, value);
    return db.transaction(() => {
        const inspected = inspectMigration(db, request);
        const confirmation = issueBusinessConfirmation({ capabilityId: CAPABILITY_ID, input: { request, inspected }, subject });
        return { preview: true, capabilityId: CAPABILITY_ID, ...confirmation, entries: inspected, suggestedIdempotencyKey: `catalog-migrate:${confirmation.operationId}`, warnings: [{ code: 'EXPLICIT_REVIEWED_SELECTION', message: '只迁移本批已核对对象；含义不明或有歧义的对象不得猜测合并，原始业务快照保留' }] };
    }).deferred();
}
function executeCatalogMigration(dependencies, value, context, subject) {
    const input = parse(APPLY, value);
    const confirmation = consumeBusinessConfirmation({ confirmationToken: input.confirmationToken, capabilityId: CAPABILITY_ID, subject, idempotencyKey: input.idempotencyKey });
    const { db } = dependencies;
    return executePersistentCommand({ db, ...context, capabilityId: CAPABILITY_ID, operationId: confirmation.operationId, idempotencyKey: input.idempotencyKey, input: confirmation.input,
        businessChange: standardBusinessChange({ domain: 'settings', eventType: 'updated', reason: '已核对目录批量命名迁移' }),
        execute: () => {
            if (requestHash(inspectMigration(db, confirmation.input.request)) !== requestHash(confirmation.input.inspected)) throw new CommandExecutionError('CATALOG_MIGRATION_PREVIEW_STALE', '目录、引用或来源在预览后变化，请重新核对', 409);
            const results = [];
            for (const entry of confirmation.input.request.entries) {
                // Rebase subsequent entries on the preceding changes inside this
                // transaction, after validating the entire frozen original plan.
                const current = require('./catalogSources.cjs').readCatalogSource(db, entry.entityType, entry.entityId);
                const preview = previewCatalogRename(db, { ...entry, expectedUpdatedAt: current.updated_at }, subject);
                results.push(executeCatalogRename(dependencies, { confirmationToken: preview.confirmationToken, idempotencyKey: preview.suggestedIdempotencyKey }, { ...context, idempotencyKey: preview.suggestedIdempotencyKey }, subject));
            }
            const auditIds = results.flatMap(result => result.auditIds);
            return { data: { migratedCount: results.length, entries: results.map(result => ({ entityType: result.entityType, entityId: result.entityId, currentName: result.currentName, operationId: result.operationId })) }, resource: { type: 'catalog', ids: results.map(result => result.entityId) }, changes: results.flatMap(result => result.changes), auditIds, requiredAuditCount: auditIds.length };
        },
    });
}
module.exports = { CAPABILITY_ID, previewCatalogMigration, executeCatalogMigration };
