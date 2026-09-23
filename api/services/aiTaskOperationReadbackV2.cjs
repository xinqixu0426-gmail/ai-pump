'use strict';

// N6.2 reconciliation may inspect a formal command only through this narrow,
// task-bound read model.  The task runtime never queries api_operations itself.
const { getAiCapability } = require('../capabilities/registry.cjs');

class AiTaskOperationReadbackError extends Error {
    constructor(code) { super(code); this.name = 'AiTaskOperationReadbackError'; this.code = code; }
}

function parseReceipt(value) {
    try { return JSON.parse(value); } catch { throw new AiTaskOperationReadbackError('FORMAL_OPERATION_RECEIPT_INVALID'); }
}

function readTaskCommandOperationV2({ db, task, step }) {
    if (!db?.prepare || !task || !step || step.access !== 'COMMAND'
        || !task.spec?.approvalOperationIds?.includes(step.operationId)
        || typeof step.idempotencyKey !== 'string' || !step.idempotencyKey) {
        throw new AiTaskOperationReadbackError('TASK_OPERATION_READ_FORBIDDEN');
    }
    const capability = getAiCapability(step.toolName);
    if (!capability?.formalCapabilityIds?.length || capability.capabilityId !== step.capabilityId) {
        throw new AiTaskOperationReadbackError('TASK_OPERATION_CAPABILITY_INVALID');
    }
    const rows = db.prepare(`SELECT operation_id, capability_id, idempotency_key, status, response_json, completed_at
        FROM api_operations WHERE capability_id IN (${capability.formalCapabilityIds.map(() => '?').join(',')})
          AND idempotency_key = ? ORDER BY id`).all(...capability.formalCapabilityIds, step.idempotencyKey);
    if (rows.length === 0) return { status: 'MISSING' };
    if (rows.length !== 1) return { status: 'AMBIGUOUS' };
    const row = rows[0];
    if (row.status !== 'completed') return { status: 'PENDING' };
    if (!row.response_json) throw new AiTaskOperationReadbackError('FORMAL_OPERATION_RECEIPT_MISSING');
    const receipt = parseReceipt(row.response_json);
    if (receipt.operationId !== row.operation_id || receipt.capabilityId !== row.capability_id
        || receipt.status !== 'completed' || !Array.isArray(receipt.auditIds) || receipt.auditIds.length === 0) {
        throw new AiTaskOperationReadbackError('FORMAL_OPERATION_RECEIPT_INVALID');
    }
    return { status: 'COMPLETED', receipt: {
        operationId: receipt.operationId, capabilityId: receipt.capabilityId, status: receipt.status,
        auditId: receipt.auditId ?? receipt.auditIds[0], auditIds: receipt.auditIds,
        idempotentReplay: Boolean(receipt.idempotentReplay), completedAt: receipt.completedAt || row.completed_at || null,
    } };
}

module.exports = { AiTaskOperationReadbackError, readTaskCommandOperationV2 };
