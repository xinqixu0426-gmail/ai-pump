const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
    requestHash,
} = require('./commandExecution.cjs');
const {
    consumeBusinessConfirmation,
    issueBusinessConfirmation,
} = require('./businessConfirmation.cjs');
const {
    buildKnowledgeEntries,
    inspectKnowledgeOverview,
    syncKnowledgeEntries,
} = require('./knowledge.cjs');
const { recordKnowledgeSyncRun } = require('./knowledgeSyncHistory.cjs');
const {
    requestKnowledgeVectorSync,
} = require('./knowledgeVectorAutoSync.cjs');

const KNOWLEDGE_SYNC_CAPABILITY_ID = requireBusinessCapability(
    'knowledge.sync_derived'
).capabilityId;

function knowledgeCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function requireExplicitIdempotency(commandContext) {
    if ((commandContext.warnings || []).some(
        warning => warning.code === 'idempotency_key_missing_compatibility'
    )) {
        throw knowledgeCommandError(
            'idempotency_key_required',
            '知识同步命令必须提供 Idempotency-Key 或 idempotencyKey',
            400
        );
    }
}

function buildKnowledgeSyncDraft(dependencies) {
    const currentEntries = buildKnowledgeEntries({
        dbAccessors: dependencies,
    });
    const overview = inspectKnowledgeOverview({
        dbAccessors: dependencies,
        currentEntries,
    });
    const storedEntries = dependencies.db.prepare(`
        SELECT source_table, source_id, content_hash
        FROM knowledge_entries
        ORDER BY source_table, source_id
    `).all();
    const previewHash = requestHash({
        currentEntries: currentEntries.map(entry => ({
            sourceTable: entry.sourceTable,
            sourceId: entry.sourceId,
            contentHash: entry.contentHash,
        })).sort((left, right) => (
            left.sourceTable.localeCompare(right.sourceTable)
            || left.sourceId.localeCompare(right.sourceId)
        )),
        storedEntries,
    });
    return {
        generatedAt: overview.generatedAt,
        previewHash,
        stats: overview.stats,
        changes: overview.changes,
    };
}

function buildKnowledgeSyncPreview(dependencies, subject) {
    const draft = buildKnowledgeSyncDraft(dependencies);
    const confirmation = issueBusinessConfirmation({
        capabilityId: KNOWLEDGE_SYNC_CAPABILITY_ID,
        input: { previewHash: draft.previewHash },
        subject,
    });
    return {
        capabilityId: KNOWLEDGE_SYNC_CAPABILITY_ID,
        operationId: confirmation.operationId,
        confirmationToken: confirmation.confirmationToken,
        inputHash: confirmation.inputHash,
        expiresAt: confirmation.expiresAt,
        suggestedIdempotencyKey: `knowledge-sync:${confirmation.operationId}`,
        generatedAt: draft.generatedAt,
        previewHash: draft.previewHash,
        stats: draft.stats,
        changes: draft.changes,
        warnings: draft.stats.pendingTotal === 0
            ? [{
                code: 'knowledge_already_fresh',
                message: '当前派生知识已是最新状态；执行只会记录一次核对结果',
            }]
            : [],
    };
}

function persistScheduledReceipt(db, receipt, vectorSyncScheduled) {
    const updated = {
        ...receipt,
        vectorSyncScheduled: Boolean(vectorSyncScheduled),
    };
    db.prepare(`
        UPDATE api_operations
        SET response_json = ?
        WHERE operation_id = ?
    `).run(JSON.stringify(updated), receipt.operationId);
    return updated;
}

function executeKnowledgeSync(
    dependencies,
    input,
    commandContext,
    subject
) {
    requireExplicitIdempotency(commandContext);
    const confirmation = consumeBusinessConfirmation({
        confirmationToken: input?.confirmationToken,
        capabilityId: KNOWLEDGE_SYNC_CAPABILITY_ID,
        subject,
        idempotencyKey: commandContext.idempotencyKey,
    });
    const draft = buildKnowledgeSyncDraft(dependencies);
    if (draft.previewHash !== confirmation.input.previewHash) {
        throw knowledgeCommandError(
            'knowledge_sync_preview_stale',
            '业务数据或派生知识在预览后已变化，请重新预览',
            409
        );
    }

    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const receipt = executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: KNOWLEDGE_SYNC_CAPABILITY_ID,
        operationId: confirmation.operationId,
        input: { previewHash: confirmation.input.previewHash },
        execute: ({ auditContext }) => {
            const result = syncKnowledgeEntries({
                dbAccessors: dependencies,
                auditContext,
                scheduleVectorSync: false,
            });
            const syncRun = recordKnowledgeSyncRun({
                mode: 'manual',
                status: 'success',
                sources: [],
                attempt: 1,
                result,
                startedAt,
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - startedMs,
            }, {
                dbAccessors: dependencies,
                auditContext,
            });
            const auditIds = [
                ...(result.auditIds || []),
                ...(syncRun.auditId ? [syncRun.auditId] : []),
            ];
            const changedCount = result.stats.inserted
                + result.stats.updated
                + result.stats.deleted;
            return {
                data: {
                    ...result,
                    syncRun,
                    vectorSyncScheduled: false,
                },
                resource: {
                    type: 'knowledgeSync',
                    ids: [syncRun.id],
                },
                changes: [{
                    resourceType: 'knowledgeEntries',
                    resourceId: null,
                    field: 'synchronized',
                    from: {
                        storedTotal: draft.stats.storedTotal,
                    },
                    to: {
                        total: result.stats.total,
                        inserted: result.stats.inserted,
                        updated: result.stats.updated,
                        deleted: result.stats.deleted,
                    },
                }],
                auditIds,
                requiredAuditCount: changedCount + 1,
            };
        },
    });
    if (receipt.idempotentReplay) return receipt;
    const vectorSyncScheduled = requestKnowledgeVectorSync({
        reason: 'knowledge_sync_command',
        deletedCount: receipt.deletedEmbeddings || 0,
    });
    return persistScheduledReceipt(
        dependencies.db,
        receipt,
        vectorSyncScheduled
    );
}

module.exports = {
    KNOWLEDGE_SYNC_CAPABILITY_ID,
    buildKnowledgeSyncDraft,
    buildKnowledgeSyncPreview,
    executeKnowledgeSync,
};
