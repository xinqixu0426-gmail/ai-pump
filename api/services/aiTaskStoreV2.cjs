'use strict';

const crypto = require('node:crypto');
const { canonicalJson, stableHash, TaskStateV2, StepStateV1 } = require('./aiTaskContractV2.cjs');
const { validateFactRecordV1, validateTaskEnvelopeV2 } = require('./aiTaskValidationV2.cjs');

const EVENT_TYPES = new Set([
    'TASK_CREATED', 'STATE_CHANGED', 'PLAN_REVISED', 'STEP_PLANNED', 'STEP_STARTED',
    'STEP_SUCCEEDED', 'STEP_FAILED', 'RECEIPT_APPENDED', 'FACT_APPENDED', 'WAITING_INPUT',
    'RESULT_UPDATED', 'TASK_SUSPENDED', 'TASK_SUCCEEDED', 'TASK_PARTIAL', 'TASK_UNSUPPORTED',
    'TASK_FAILED', 'TASK_CANCELLED',
    'LEASE_ACQUIRED', 'LEASE_RELEASED', 'LEASE_EXPIRED', 'TASK_RECOVERED',
    'BUDGET_RESERVED', 'CANCEL_REQUESTED', 'TASK_WRITE_PREFLIGHTED', 'COMMAND_ADMITTED', 'COMMAND_RECONCILING', 'COMMAND_RECONCILED', 'TASK_RECOVERY_STARTED', 'TASK_RECOVERY_REUSED_STEP', 'TASK_RECOVERY_RETRY_STEP', 'STEP_ATTEMPT_INTERRUPTED', 'STEP_RETRY_STARTED',
    // NATIVE-W1：Native 写 V1 的提案/批准/执行/验证/安全失败事件（只记事实与哈希，绝不含凭据）。
    'WRITE_PROPOSAL_READY', 'WRITE_APPROVED', 'WRITE_EXECUTED', 'WRITE_VERIFIED', 'WRITE_FAILED_SAFE',
]);
const MAX_RECEIPT_BYTES = 98304;
const MAX_STATE_BYTES = 262144;
const VOLATILE_FACT_PREDICATES = new Set([
    'recipe.current_cost', 'scenario.cost', 'scenario.cost_comparison',
    'scenario.override_application', 'scenario.configuration_changes',
    'profitability.preview', 'inventory.virtual_readiness', 'inventory.stock',
    'quotation.current_state', 'order.current_state', 'catalog.price',
]);

class AiTaskStoreError extends Error {
    constructor(code) { super(code); this.name = 'AiTaskStoreError'; this.code = code; }
}
const fail = code => { throw new AiTaskStoreError(code); };
const json = (value, code) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
    return value;
};
const parse = (value, code) => {
    try { return JSON.parse(value); } catch { fail(code); }
};
const isoNow = clock => (clock ? new Date(clock()).toISOString() : new Date().toISOString());
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const SENSITIVE_FIELD = /(?:api[_-]?key|password|authorization|cookie|confirmationtoken|confirmation_token|secret|token)/iu;
function hasSensitiveField(value) {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, item]) => SENSITIVE_FIELD.test(key) || hasSensitiveField(item));
}

function loadAccessors(options = {}) { return options.dbAccessors || require('../db.cjs'); }
function taskRow(row) {
    if (!row) return null;
    return {
        id: Number(row.id), taskKey: row.task_key, parentTaskId: row.parent_task_id === null ? null : Number(row.parent_task_id),
        ownerKey: row.owner_key, conversationId: Number(row.conversation_id), userMessageId: Number(row.user_message_id),
        schemaVersion: Number(row.schema_version), revision: Number(row.revision), planRevision: Number(row.plan_revision),
        state: row.state, executionMode: row.execution_mode, inputHash: row.input_hash,
        spec: parse(row.spec_json, 'TASK_SPEC_JSON_INVALID'), budget: parse(row.budget_json, 'TASK_BUDGET_JSON_INVALID'),
        result: row.result_json === null ? null : parse(row.result_json, 'TASK_RESULT_JSON_INVALID'),
        lease: row.lease_owner === null ? null : { owner: row.lease_owner, token: row.lease_token, expiresAt: row.lease_expires_at },
        cancelRequestedAt: row.cancel_requested_at, createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at,
    };
}
function stepRow(row) { return row && ({ id: Number(row.id), stepKey: row.step_key, taskId: Number(row.task_id), planRevision: Number(row.plan_revision), sequence: Number(row.sequence), capabilityId: row.capability_id, toolName: row.tool_name, goalKeys: parse(row.goal_keys_json, 'STEP_GOALS_JSON_INVALID'), access: row.access, arguments: parse(row.args_json, 'STEP_ARGS_JSON_INVALID'), argsHash: row.args_hash, argumentSources: parse(row.argument_sources_json, 'STEP_SOURCES_JSON_INVALID'), state: row.state, attempt: Number(row.attempt), receiptKey: row.receipt_key, operationId: row.operation_id, idempotencyKey: row.idempotency_key, startedAt: row.started_at, finishedAt: row.finished_at, errorCode: row.error_code, createdAt: row.created_at, updatedAt: row.updated_at }); }
function evidenceRow(row) { return row && ({ id: Number(row.id), evidenceKey: row.evidence_key, taskId: Number(row.task_id), planRevision: Number(row.plan_revision), recordKind: row.record_kind, receiptKey: row.receipt_key, factKeyHash: row.fact_key_hash, supersedesKey: row.supersedes_key, payload: parse(row.payload_json, 'EVIDENCE_JSON_INVALID'), sourceHash: row.source_hash, observedAt: row.observed_at, createdAt: row.created_at, updatedAt: row.updated_at }); }
function eventRow(row) { return row && ({ id: Number(row.id), taskId: Number(row.task_id), seq: Number(row.seq), eventType: row.event_type, payload: parse(row.payload_json, 'EVENT_JSON_INVALID'), createdAt: row.created_at, updatedAt: row.updated_at }); }

function validateRecoveryPlan(recovery) {
    json(recovery, 'TASK_RECOVERY_PLAN_INVALID');
    const required = ['version', 'proposal', 'sourceMessageIds', 'pending', 'activeMsBase'];
    if (Object.keys(recovery).length !== required.length || required.some(key => !(key in recovery))) fail('TASK_RECOVERY_PLAN_INVALID');
    if (recovery.version !== 1 || !Number.isInteger(recovery.activeMsBase) || recovery.activeMsBase < 0 || !recovery.proposal || typeof recovery.proposal !== 'object' || Array.isArray(recovery.proposal) || !recovery.sourceMessageIds || typeof recovery.sourceMessageIds !== 'object' || Array.isArray(recovery.sourceMessageIds) || hasSensitiveField(recovery)) fail('TASK_RECOVERY_PLAN_INVALID');
    for (const [messageRef, messageId] of Object.entries(recovery.sourceMessageIds)) if (typeof messageRef !== 'string' || !messageRef || !Number.isInteger(messageId) || messageId < 1) fail('TASK_RECOVERY_PLAN_INVALID');
    if (recovery.pending !== null && (!recovery.pending || typeof recovery.pending !== 'object' || Array.isArray(recovery.pending))) fail('TASK_RECOVERY_PLAN_INVALID');
    return recovery;
}
function validateWriteV1(write) {
    json(write, 'TASK_WRITE_V1_INVALID');
    const allowed = ['version', 'phase', 'capabilityId', 'toolName', 'target', 'delta', 'currentStock', 'nextStock',
        'expectedUpdatedAt', 'argsHash', 'proposalHash', 'idempotencyKey', 'previewFacts', 'proposedAt',
        'approval', 'execution', 'verification', 'reconciliation', 'failure'];
    if (Object.keys(write).some(key => !allowed.includes(key)) || hasSensitiveField(write)) fail('TASK_WRITE_V1_INVALID');
    const phases = ['PROPOSAL_READY', 'CONFIRMED', 'COMMITTED', 'RECONCILING', 'VERIFIED', 'FAILED_SAFE'];
    if (write.version !== 1 || !phases.includes(write.phase)) fail('TASK_WRITE_V1_INVALID');
    if (!write.target || typeof write.target !== 'object' || Array.isArray(write.target)) fail('TASK_WRITE_V1_INVALID');
    if (!Number.isInteger(write.target.partId) || write.target.partId < 1 || typeof write.target.model !== 'string' || !write.target.model) fail('TASK_WRITE_V1_INVALID');
    if (!Number.isInteger(write.delta) || write.delta === 0) fail('TASK_WRITE_V1_INVALID');
    if (!Number.isInteger(write.currentStock) || !Number.isInteger(write.nextStock)) fail('TASK_WRITE_V1_INVALID');
    if (typeof write.capabilityId !== 'string' || !write.capabilityId || typeof write.toolName !== 'string' || !write.toolName) fail('TASK_WRITE_V1_INVALID');
    if (!/^[a-f0-9]{64}$/u.test(String(write.proposalHash || '')) || !/^[a-f0-9]{64}$/u.test(String(write.argsHash || ''))) fail('TASK_WRITE_V1_INVALID');
    if (typeof write.idempotencyKey !== 'string' || !write.idempotencyKey) fail('TASK_WRITE_V1_INVALID');
    if (typeof write.proposedAt !== 'string' || !write.proposedAt) fail('TASK_WRITE_V1_INVALID');
    // 批准事实：只在 CONFIRMED 之后出现，且必须能独立证明「Owner 批准了这一个冻结提案」。
    if (write.approval !== undefined) {
        const approval = write.approval;
        if (!approval || typeof approval !== 'object' || Array.isArray(approval)) fail('TASK_WRITE_V1_INVALID');
        const approvalKeys = ['proposalHash', 'argsHash', 'capabilityId', 'toolName', 'targetPartId', 'ownerSubject', 'approvedAt', 'idempotencyKey'];
        if (Object.keys(approval).length !== approvalKeys.length || approvalKeys.some(key => !(key in approval))) fail('TASK_WRITE_V1_INVALID');
        if (approval.proposalHash !== write.proposalHash || approval.argsHash !== write.argsHash) fail('TASK_WRITE_V1_INVALID');
        if (approval.capabilityId !== write.capabilityId || approval.toolName !== write.toolName) fail('TASK_WRITE_V1_INVALID');
        if (approval.targetPartId !== write.target.partId || approval.idempotencyKey !== write.idempotencyKey) fail('TASK_WRITE_V1_INVALID');
        if (typeof approval.ownerSubject !== 'string' || !/^[a-f0-9]{64}$/u.test(approval.ownerSubject)) fail('TASK_WRITE_V1_INVALID');
        if (typeof approval.approvedAt !== 'string' || !approval.approvedAt) fail('TASK_WRITE_V1_INVALID');
    }
    return write;
}
function validateSpec(spec) {
    const required = ['version', 'answerOwner', 'userGoal', 'businessWritePolicy', 'subjects', 'goals', 'scenarios', 'questions', 'approvalOperationIds'];
    const allowed = [...required, 'recovery', 'writeV1'];
    if (Object.keys(spec).some(key => !allowed.includes(key)) || required.some(key => !(key in spec))) fail('TASK_SPEC_INVALID');
    if (spec.version !== 2 || spec.answerOwner !== 'TASK_V2' || typeof spec.userGoal !== 'string' || !spec.userGoal || spec.userGoal.length > 2000) fail('TASK_SPEC_INVALID');
    if (!['FORBIDDEN', 'CONFIRMATION_REQUIRED'].includes(spec.businessWritePolicy)) fail('TASK_SPEC_INVALID');
    for (const field of ['subjects', 'goals', 'scenarios', 'questions', 'approvalOperationIds']) if (!Array.isArray(spec[field])) fail('TASK_SPEC_INVALID');
    if (!spec.goals.length || spec.goals.length > 8) fail('TASK_SPEC_INVALID');
    if (spec.recovery !== undefined) validateRecoveryPlan(spec.recovery);
    if (spec.writeV1 !== undefined) validateWriteV1(spec.writeV1);
    return spec;
}
function validateBudget(budget) {
    json(budget, 'TASK_BUDGET_INVALID');
    const { limits, usage } = budget;
    json(limits, 'TASK_BUDGET_INVALID'); json(usage, 'TASK_BUDGET_INVALID');
    const exactLimits = ['maxModelCalls', 'maxToolCalls', 'maxToolResultBytes', 'maxTaskStateBytes', 'deadlineAt', 'maxApiCalls', 'maxActiveMs'];
    const exactUsage = ['modelCalls', 'toolCalls', 'apiCalls', 'activeMs'];
    if (Object.keys(limits).length !== exactLimits.length || exactLimits.some(key => !(key in limits)) || Object.keys(usage).length !== exactUsage.length || exactUsage.some(key => !(key in usage))) fail('TASK_BUDGET_INVALID');
    if (!Number.isInteger(limits.maxModelCalls) || limits.maxModelCalls < 1 || limits.maxModelCalls > 7 || !Number.isInteger(limits.maxToolCalls) || limits.maxToolCalls < 1 || limits.maxToolCalls > 10 || limits.maxToolResultBytes !== MAX_RECEIPT_BYTES || limits.maxTaskStateBytes !== MAX_STATE_BYTES || !Number.isInteger(limits.maxApiCalls) || limits.maxApiCalls < 1 || limits.maxApiCalls > 128 || !Number.isInteger(limits.maxActiveMs) || limits.maxActiveMs < 10000 || limits.maxActiveMs > 900000) fail('TASK_BUDGET_INVALID');
    for (const key of exactUsage) if (!Number.isInteger(usage[key]) || usage[key] < 0) fail('TASK_BUDGET_INVALID');
    if (usage.modelCalls > limits.maxModelCalls || usage.toolCalls > limits.maxToolCalls || usage.apiCalls > limits.maxApiCalls || usage.activeMs > limits.maxActiveMs) fail('TASK_BUDGET_EXCEEDED');
    return budget;
}
function taskStorageFromEnvelope(task) {
    const spec = validateSpec({ version: 2, answerOwner: 'TASK_V2', userGoal: task.userGoal, businessWritePolicy: task.constraints.businessWritePolicy, subjects: task.subjects, goals: task.goals, scenarios: task.scenarios, questions: task.questions, approvalOperationIds: task.approvalOperationIds, ...(task.recoveryPlan ? { recovery: task.recoveryPlan } : {}) });
    const budget = validateBudget({ limits: { maxModelCalls: task.constraints.maxModelCalls, maxToolCalls: task.constraints.maxToolCalls, maxToolResultBytes: task.constraints.maxToolResultBytes, maxTaskStateBytes: task.constraints.maxTaskStateBytes, deadlineAt: task.constraints.deadlineAt, maxApiCalls: task.constraints.maxApiCalls, maxActiveMs: task.constraints.maxActiveMs }, usage: task.budgetUsage });
    if (bytes({ spec, budget, result: null }) > MAX_STATE_BYTES) fail('TASK_STATE_TOO_LARGE');
    return { spec, budget };
}
function recoveredFactRevalidation(facts) {
    const revalidationRequiredFactIds = [...facts.values()]
        .filter(fact => fact.key.temporalScope === 'CURRENT' || VOLATILE_FACT_PREDICATES.has(fact.key.predicate))
        .map(fact => fact.factId);
    const reusableHistoricalFactIds = [...facts.values()]
        .filter(fact => !revalidationRequiredFactIds.includes(fact.factId))
        .map(fact => fact.factId);
    return { revalidationRequiredFactIds, reusableHistoricalFactIds };
}

function createAiTaskStoreV2(options = {}) {
    const accessors = loadAccessors(options); const { db, safeInsert, safeUpdate } = accessors;
    if (!db || !safeInsert || !safeUpdate) throw new Error('TASK_STORE_DB_ACCESSORS_REQUIRED');
    const now = () => isoNow(options.clock);
    function getTaskByKey(taskKey) { return taskRow(db.prepare('SELECT * FROM ai_tasks WHERE task_key = ?').get(taskKey)); }
    function getTaskForOwner(taskKey, ownerKey) { return taskRow(db.prepare('SELECT * FROM ai_tasks WHERE task_key = ? AND owner_key = ?').get(taskKey, ownerKey)); }
    function getTaskById(id) { return taskRow(db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(id)); }
    function withImmediateTransaction(work) {
        db.exec('BEGIN IMMEDIATE');
        try { const result = work(); db.exec('COMMIT'); return result; } catch (error) {
            try { db.exec('ROLLBACK'); } catch { /* transaction was already closed */ }
            throw error;
        }
    }
    function leaseExpiry(durationMs) {
        if (!Number.isInteger(durationMs) || durationMs < 1) fail('LEASE_DURATION_INVALID');
        return new Date((options.clock ? Number(options.clock()) : Date.now()) + durationMs).toISOString();
    }
    function leaseMatches(task, workerId, leaseToken, { allowExpired = false } = {}) {
        if (!task?.lease || task.lease.owner !== workerId || task.lease.token !== leaseToken) return false;
        return allowExpired || new Date(task.lease.expiresAt).getTime() > (options.clock ? Number(options.clock()) : Date.now());
    }
    function requireLease(task, workerId, leaseToken, { allowTerminal = false } = {}) {
        if (!leaseMatches(task, workerId, leaseToken)) fail('LEASE_FENCED');
        if (!allowTerminal && TaskStateV2.includes(task.state) && ['SUCCEEDED', 'PARTIAL', 'UNSUPPORTED', 'FAILED', 'CANCELLED'].includes(task.state)) fail('LEASE_FENCED');
        return task;
    }
    function eligibleDetached(task, _timestamp) {
        return task.executionMode === 'DETACHED'
            && ['NEW', 'UNDERSTANDING', 'RESOLVING', 'RUNNING', 'SUSPENDED'].includes(task.state)
            && !task.lease;
    }
    function assertOwnerMessage({ ownerKey, conversationId, userMessageId }) {
        const row = db.prepare(`SELECT c.id conversation_id, m.id message_id, m.content FROM ai_conversations c JOIN ai_conversation_messages m ON m.conversation_id = c.id WHERE c.id = ? AND c.owner_key = ? AND c.deleted_at IS NULL AND m.id = ? AND m.role = 'user'`).get(conversationId, ownerKey, userMessageId);
        if (!row) fail('TASK_SOURCE_OWNERSHIP_INVALID');
        return row;
    }
    function appendEvent(taskId, eventType, payload, eventOptions = {}) {
        if (!EVENT_TYPES.has(eventType)) fail('TASK_EVENT_TYPE_INVALID');
        json(payload, 'TASK_EVENT_PAYLOAD_INVALID');
        if (bytes(payload) > 16384 || hasSensitiveField(payload)) fail('TASK_EVENT_PAYLOAD_UNSAFE');
        const sequence = Number(db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 next_seq FROM ai_task_events WHERE task_id = ?').get(taskId).next_seq);
        const timestamp = eventOptions.now || now();
        safeInsert('ai_task_events', { task_id: taskId, seq: sequence, event_type: eventType, payload_json: canonicalJson(payload), created_at: timestamp, updated_at: timestamp }, eventOptions.auditContext);
        return sequence;
    }
    function findTaskForIdempotency(ownerKey, idempotencyKey) {
        const rows = db.prepare(`SELECT t.*, e.payload_json FROM ai_tasks t JOIN ai_task_events e ON e.task_id=t.id WHERE t.owner_key=? AND e.event_type='TASK_CREATED' ORDER BY t.id DESC`).all(ownerKey);
        for (const row of rows) {
            const payload = parse(row.payload_json, 'EVENT_JSON_INVALID');
            if (payload.idempotencyKey === idempotencyKey) return taskRow(row);
        }
        return null;
    }
    function createTask(input) {
        const source = assertOwnerMessage(input);
        // Recovery is server-owned storage metadata, deliberately outside the
        // TaskEnvelopeV2 public contract. The route cannot inject it through
        // task fields; only the trusted preparation service passes it here.
        validateTaskEnvelopeV2(input.task, { sourceMessages: new Map() });
        if (input.recoveryPlan !== undefined) validateRecoveryPlan(input.recoveryPlan);
        if (input.task.steps.length || input.task.facts.length || (input.task.sourceEvidence || []).length) fail('TASK_CREATE_SERVER_STATE_REQUIRED');
        const stored = taskStorageFromEnvelope(input.recoveryPlan === undefined ? input.task : { ...input.task, recoveryPlan: input.recoveryPlan });
        if (input.task.ownerKey !== input.ownerKey || !TaskStateV2.includes(input.task.state) || input.task.taskId !== input.taskKey || !/^[0-9a-f-]{36}$/iu.test(input.taskKey) || typeof input.expiresAt !== 'string') fail('TASK_CREATE_INVALID');
        if (!/^[a-f0-9]{64}$/u.test(input.task.inputHash) || sha256(source.content) !== input.task.inputHash) fail('TASK_INPUT_HASH_INVALID');
        if (!['FOREGROUND', 'DETACHED'].includes(input.task.executionMode)) fail('TASK_EXECUTION_MODE_INVALID');
        const timestamp = now();
        const create = db.transaction(() => {
            const info = safeInsert('ai_tasks', { task_key: input.taskKey, parent_task_id: input.parentTaskId || null, owner_key: input.ownerKey, conversation_id: input.conversationId, user_message_id: input.userMessageId, schema_version: 2, revision: input.task.revision, plan_revision: input.task.planRevision, state: input.task.state, execution_mode: input.task.executionMode, input_hash: input.task.inputHash, spec_json: canonicalJson(stored.spec), budget_json: canonicalJson(stored.budget), result_json: null, lease_owner: null, lease_token: null, lease_expires_at: null, cancel_requested_at: null, created_at: timestamp, updated_at: timestamp, expires_at: input.expiresAt }, input.auditContext);
            const taskId = Number(info.lastInsertRowid); appendEvent(taskId, 'TASK_CREATED', { revision: input.task.revision, planRevision: input.task.planRevision, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) }, { now: timestamp, auditContext: input.auditContext }); return taskId;
        });
        return getTaskById(create.immediate());
    }
    function mutateTask(taskKey, expectedRevision, change, auditContext, leaseContext = null) {
        const mutate = db.transaction(() => {
            const current = getTaskByKey(taskKey); if (!current) fail('TASK_NOT_FOUND');
            if (leaseContext) requireLease(current, leaseContext.workerId, leaseContext.leaseToken);
            if (current.revision !== expectedRevision) fail('TASK_REVISION_CONFLICT');
            const patch = change(current); if (!patch || typeof patch !== 'object') fail('TASK_MUTATION_INVALID');
            if (patch.state && !TaskStateV2.includes(patch.state)) fail('TASK_STATE_INVALID');
            if (patch.spec) validateSpec(patch.spec); if (patch.budget) validateBudget(patch.budget);
            if (patch.result !== undefined && patch.result !== null) { json(patch.result, 'TASK_RESULT_INVALID'); if (bytes(patch.result) > 16384 || hasSensitiveField(patch.result)) fail('TASK_RESULT_TOO_LARGE'); }
            const nextRevision = current.revision + 1; const timestamp = now();
            const nextPlanRevision = patch.planRevision === undefined ? current.planRevision : patch.planRevision;
            if (!Number.isInteger(nextPlanRevision) || nextPlanRevision < current.planRevision) fail('TASK_PLAN_REVISION_INVALID');
            const nextSpec = patch.spec || current.spec; const nextBudget = patch.budget || current.budget; const nextResult = patch.result === undefined ? current.result : patch.result;
            if ((patch.state || current.state) === 'SUCCEEDED' && !nextSpec.goals.every(goal => goal.state === 'VERIFIED')) fail('TASK_SUCCEEDED_GOALS');
            if (bytes({ spec: nextSpec, budget: nextBudget, result: nextResult }) > MAX_STATE_BYTES) fail('TASK_STATE_TOO_LARGE');
            safeUpdate('ai_tasks', current.id, { revision: nextRevision, plan_revision: nextPlanRevision, state: patch.state || current.state, spec_json: canonicalJson(nextSpec), budget_json: canonicalJson(nextBudget), result_json: nextResult === null ? null : canonicalJson(nextResult), cancel_requested_at: patch.cancelRequestedAt === undefined ? current.cancelRequestedAt : patch.cancelRequestedAt }, auditContext);
            appendEvent(current.id, patch.eventType || 'STATE_CHANGED', patch.eventPayload || { revision: nextRevision }, { now: timestamp, auditContext });
            return current.id;
        });
        return getTaskById(mutate.immediate());
    }
    function claimNextDetachedTask({ workerId, leaseDurationMs = 30000 } = {}) {
        if (typeof workerId !== 'string' || !workerId) fail('LEASE_WORKER_INVALID');
        try {
            const claimedId = withImmediateTransaction(() => {
                const timestamp = now();
                const row = db.prepare(`SELECT * FROM ai_tasks
                    WHERE execution_mode = 'DETACHED'
                      AND state IN ('NEW','UNDERSTANDING','RESOLVING','RUNNING','SUSPENDED')
                      AND lease_owner IS NULL
                    ORDER BY updated_at ASC, id ASC LIMIT 1`).get();
                const current = taskRow(row);
                if (!current || !eligibleDetached(current, timestamp)) return null;
                const token = crypto.randomUUID();
                const expiry = leaseExpiry(leaseDurationMs);
                safeUpdate('ai_tasks', current.id, {
                    revision: current.revision + 1, lease_owner: workerId, lease_token: token,
                    lease_expires_at: expiry, updated_at: timestamp,
                });
                appendEvent(current.id, 'LEASE_ACQUIRED', { workerId, revision: current.revision + 1 }, { now: timestamp });
                return current.id;
            });
            return claimedId === null ? { outcome: 'LEASE_NOT_ACQUIRED', task: null } : { outcome: 'LEASE_ACQUIRED', task: getTaskById(claimedId) };
        } catch (error) {
            if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') return { outcome: 'LEASE_NOT_ACQUIRED', task: null };
            throw error;
        }
    }
    function renewLease(taskKey, workerId, leaseToken, { leaseDurationMs = 30000 } = {}) {
        return withImmediateTransaction(() => {
            const current = getTaskByKey(taskKey);
            if (!current || !leaseMatches(current, workerId, leaseToken)) return { outcome: 'LEASE_FENCED', task: current || null };
            const timestamp = now();
            safeUpdate('ai_tasks', current.id, { lease_expires_at: leaseExpiry(leaseDurationMs), updated_at: timestamp });
            return { outcome: 'LEASE_RENEWED', task: getTaskById(current.id) };
        });
    }
    function releaseLease(taskKey, workerId, leaseToken) {
        return withImmediateTransaction(() => {
            const current = getTaskByKey(taskKey);
            if (!current || !leaseMatches(current, workerId, leaseToken, { allowExpired: true })) return { outcome: 'LEASE_FENCED', task: current || null };
            const timestamp = now();
            safeUpdate('ai_tasks', current.id, { lease_owner: null, lease_token: null, lease_expires_at: null, updated_at: timestamp });
            appendEvent(current.id, 'LEASE_RELEASED', { workerId }, { now: timestamp });
            return { outcome: 'LEASE_RELEASED', task: getTaskById(current.id) };
        });
    }
    function assertLease(taskKey, workerId, leaseToken) {
        const task = getTaskByKey(taskKey); requireLease(task, workerId, leaseToken, { allowTerminal: true }); return task;
    }
    function reserveBudget(taskKey, expectedRevision, workerId, leaseToken, increments = {}) {
        const allowed = ['modelCalls', 'toolCalls', 'apiCalls'];
        if (!Object.keys(increments).length || Object.keys(increments).some(key => !allowed.includes(key) || !Number.isInteger(increments[key]) || increments[key] < 0)) fail('TASK_BUDGET_INCREMENT_INVALID');
        return mutateTask(taskKey, expectedRevision, current => {
            const usage = { ...current.budget.usage };
            for (const key of allowed) usage[key] += increments[key] || 0;
            const budget = { limits: current.budget.limits, usage };
            validateBudget(budget);
            return { budget, eventType: 'BUDGET_RESERVED', eventPayload: { modelCalls: increments.modelCalls || 0, toolCalls: increments.toolCalls || 0, apiCalls: increments.apiCalls || 0 } };
        }, undefined, { workerId, leaseToken });
    }
    function requestCancel(taskKey, expectedRevision) {
        return mutateTask(taskKey, expectedRevision, () => ({ cancelRequestedAt: now(), eventType: 'CANCEL_REQUESTED', eventPayload: { requested: true } }));
    }
    function recoverExpiredLeases() {
        const expired = db.prepare('SELECT task_key FROM ai_tasks WHERE lease_expires_at IS NOT NULL AND lease_expires_at < ? ORDER BY id').all(now()).map(row => row.task_key);
        const recovered = [];
        for (const taskKey of expired) {
            const result = withImmediateTransaction(() => {
                const current = getTaskByKey(taskKey); const timestamp = now();
                if (!current?.lease || new Date(current.lease.expiresAt).getTime() >= new Date(timestamp).getTime()) return null;
                const steps = db.prepare("SELECT access, state, operation_id FROM ai_task_steps WHERE task_id = ? AND (state = 'RUNNING' OR state = 'UNKNOWN_EFFECT')").all(current.id);
                const unknownCommand = steps.some(step => step.access === 'COMMAND' || step.state === 'UNKNOWN_EFFECT' || step.operation_id);
                const terminalOrWaiting = ['SUCCEEDED', 'PARTIAL', 'UNSUPPORTED', 'FAILED', 'CANCELLED', 'WAITING_INPUT', 'WAITING_APPROVAL'].includes(current.state);
                const nextState = unknownCommand ? 'RECONCILING' : terminalOrWaiting ? current.state : 'SUSPENDED';
                safeUpdate('ai_tasks', current.id, { revision: nextState === current.state ? current.revision : current.revision + 1, state: nextState, lease_owner: null, lease_token: null, lease_expires_at: null, updated_at: timestamp });
                appendEvent(current.id, 'LEASE_EXPIRED', { recoveredState: nextState }, { now: timestamp });
                if (nextState === 'SUSPENDED') appendEvent(current.id, 'TASK_SUSPENDED', { reason: 'LEASE_EXPIRED' }, { now: timestamp });
                return { taskKey, state: nextState };
            });
            if (result) recovered.push(result);
        }
        return recovered;
    }
    function listSteps(taskKey) { const task = getTaskByKey(taskKey); if (!task) return []; return db.prepare('SELECT * FROM ai_task_steps WHERE task_id = ? ORDER BY plan_revision, sequence').all(task.id).map(stepRow); }
    function prepareInterruptedReadRetryLeased(taskKey, expectedRevision, workerId, leaseToken, stepKey) {
        return withImmediateTransaction(() => {
            const current = getTaskByKey(taskKey); if (!current || current.revision !== expectedRevision) fail('TASK_REVISION_CONFLICT'); requireLease(current, workerId, leaseToken);
            const row = db.prepare('SELECT * FROM ai_task_steps WHERE task_id=? AND step_key=?').get(current.id, stepKey); const step = stepRow(row);
            if (!step || step.planRevision !== current.planRevision || !['QUERY', 'PREVIEW'].includes(step.access) || step.state !== 'RUNNING' || step.receiptKey || step.attempt !== 1 || stableHash(step.arguments) !== step.argsHash) fail('READ_RETRY_NOT_ELIGIBLE');
            const usage = { ...current.budget.usage, toolCalls: current.budget.usage.toolCalls + 1, apiCalls: current.budget.usage.apiCalls + 1 };
            const budget = { limits: current.budget.limits, usage }; validateBudget(budget);
            const timestamp = now();
            appendEvent(current.id, 'STEP_ATTEMPT_INTERRUPTED', { stepKey, attempt: 1, reasonCode: 'WORKER_INTERRUPTED' }, { now: timestamp });
            safeUpdate('ai_task_steps', step.id, { attempt: 2, error_code: null, updated_at: timestamp });
            safeUpdate('ai_tasks', current.id, { revision: current.revision + 1, budget_json: canonicalJson(budget), updated_at: timestamp });
            appendEvent(current.id, 'STEP_RETRY_STARTED', { stepKey, attempt: 2, reasonCode: 'WORKER_INTERRUPTED' }, { now: timestamp });
            return getTaskById(current.id);
        });
    }
    function appendStep(taskKey, expectedRevision, step, auditContext, leaseContext = null, internal = {}) {
        if (!StepStateV1.includes(step.state) || (step.access === 'COMMAND' && internal.protectedCommand !== true)) fail('TASK_STEP_INVALID');
        const result = mutateTask(taskKey, expectedRevision, current => {
            if (step.planRevision !== current.planRevision || !Array.isArray(step.goalKeys) || !step.goalKeys.length || stableHash(step.arguments) !== step.argsHash) fail('TASK_STEP_INVALID');
            if (step.access === 'COMMAND' && (
                current.spec.businessWritePolicy !== 'CONFIRMATION_REQUIRED'
                || !current.spec.approvalOperationIds.includes(step.operationId)
                || typeof step.idempotencyKey !== 'string'
                || !step.idempotencyKey
            )) fail('TASK_COMMAND_ADMISSION_INVALID');
            const sequence = Number(db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 value FROM ai_task_steps WHERE task_id = ? AND plan_revision = ?').get(current.id, current.planRevision).value);
            const timestamp = now();
            safeInsert('ai_task_steps', { step_key: step.stepId, task_id: current.id, plan_revision: current.planRevision, sequence, capability_id: step.capabilityId, tool_name: step.toolName, goal_keys_json: canonicalJson(step.goalKeys), access: step.access, args_json: canonicalJson(step.arguments), args_hash: step.argsHash, argument_sources_json: canonicalJson(step.argumentSources), state: step.state, attempt: step.attempt, receipt_key: null, operation_id: step.operationId || null, idempotency_key: step.idempotencyKey || null, started_at: step.startedAt, finished_at: step.finishedAt, error_code: step.errorCode, created_at: timestamp, updated_at: timestamp }, auditContext);
            return { eventType: step.access === 'COMMAND' ? 'COMMAND_ADMITTED' : 'STEP_PLANNED', eventPayload: { stepKey: step.stepId, sequence, ...(step.access === 'COMMAND' ? { operationId: step.operationId } : {}) } };
        }, auditContext, leaseContext);
        return { task: result, steps: listSteps(taskKey) };
    }
    function setStepState(taskKey, expectedRevision, stepKey, nextState, metadata = {}, auditContext, leaseContext = null) {
        if (!StepStateV1.includes(nextState)) fail('TASK_STEP_INVALID');
        return mutateTask(taskKey, expectedRevision, current => {
            const step = db.prepare('SELECT * FROM ai_task_steps WHERE task_id = ? AND step_key = ?').get(current.id, stepKey);
            if (!step) fail('TASK_STEP_NOT_FOUND');
            const allowed = { PLANNED: ['RUNNING', 'CANCELLED'], RUNNING: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'], UNKNOWN_EFFECT: metadata.reconciled === true ? ['SUCCEEDED'] : [] };
            if (!(allowed[step.state] || []).includes(nextState)) fail('TASK_STEP_TRANSITION_INVALID');
            const timestamp = now();
            safeUpdate('ai_task_steps', Number(step.id), { state: nextState, receipt_key: metadata.receiptKey, operation_id: metadata.operationId, started_at: nextState === 'RUNNING' ? timestamp : undefined, finished_at: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'].includes(nextState) ? timestamp : undefined, error_code: metadata.errorCode }, auditContext);
            return { eventType: nextState === 'RUNNING' ? 'STEP_STARTED' : nextState === 'SUCCEEDED' ? 'STEP_SUCCEEDED' : 'STEP_FAILED', eventPayload: { stepKey, state: nextState } };
        }, auditContext, leaseContext);
    }
    function appendEvidence(taskKey, expectedRevision, record, auditContext, leaseContext = null) {
        if (!['RECEIPT', 'FACT'].includes(record.recordKind) || !/^[a-f0-9]{64}$/u.test(record.sourceHash)) fail('TASK_EVIDENCE_INVALID');
        if (bytes(record.payload) > MAX_RECEIPT_BYTES || hasSensitiveField(record.payload)) fail('TASK_RECEIPT_TOO_LARGE');
        return mutateTask(taskKey, expectedRevision, current => {
            if (record.planRevision !== current.planRevision) fail('TASK_EVIDENCE_REVISION_INVALID');
            let receipt = null;
            if (record.recordKind === 'RECEIPT') {
                if (record.payload?.version !== 1 || record.payload?.receiptId !== record.evidenceKey || record.payload?.taskId !== current.taskKey || record.payload?.planRevision !== current.planRevision || record.payload?.origin !== 'SERVER_EXECUTOR' || record.payload?.sourceHash !== record.sourceHash || !record.payload?.result || typeof record.payload.result !== 'object') fail('TASK_RECEIPT_INVALID');
            }
            if (record.recordKind === 'FACT') {
                receipt = db.prepare('SELECT * FROM ai_task_evidence WHERE evidence_key = ?').get(record.receiptKey);
                if (!receipt || receipt.record_kind !== 'RECEIPT' || Number(receipt.task_id) !== current.id || Number(receipt.plan_revision) !== record.planRevision || !record.factKeyHash) fail('TASK_FACT_RECEIPT_INVALID');
                const receiptPayload = parse(receipt.payload_json, 'TASK_RECEIPT_INVALID');
                const facts = db.prepare("SELECT payload_json FROM ai_task_evidence WHERE task_id = ? AND record_kind = 'FACT'").all(current.id).map(row => parse(row.payload_json, 'TASK_FACT_INVALID'));
                try {
                    validateFactRecordV1(record.payload, { taskId: current.taskKey, trustedReceiptsById: new Map([[record.receiptKey, receiptPayload]]), factsById: new Map(facts.map(fact => [fact.factId, { ...fact, taskId: current.taskKey }])) });
                } catch (error) { fail(error.code || 'TASK_FACT_INVALID'); }
                if (stableHash(record.payload.key) !== record.factKeyHash || record.payload.sourceHash !== record.sourceHash) fail('TASK_FACT_INVALID');
            }
            if (record.supersedesKey) { const prior = db.prepare('SELECT * FROM ai_task_evidence WHERE evidence_key = ?').get(record.supersedesKey); if (!prior || prior.record_kind !== 'FACT' || Number(prior.task_id) !== current.id || prior.fact_key_hash !== record.factKeyHash || Number(prior.plan_revision) >= record.planRevision) fail('TASK_FACT_SUPERSEDE_INVALID'); }
            const timestamp = now(); safeInsert('ai_task_evidence', { evidence_key: record.evidenceKey, task_id: current.id, plan_revision: record.planRevision, record_kind: record.recordKind, receipt_key: record.recordKind === 'FACT' ? record.receiptKey : null, fact_key_hash: record.recordKind === 'FACT' ? record.factKeyHash : null, supersedes_key: record.supersedesKey || null, payload_json: canonicalJson(record.payload), source_hash: record.sourceHash, observed_at: record.observedAt, created_at: timestamp, updated_at: timestamp }, auditContext);
            return { eventType: record.recordKind === 'FACT' ? 'FACT_APPENDED' : 'RECEIPT_APPENDED', eventPayload: { evidenceKey: record.evidenceKey, recordKind: record.recordKind } };
        }, auditContext, leaseContext);
    }
    function listEvidence(taskKey) { const task = getTaskByKey(taskKey); if (!task) return []; return db.prepare('SELECT * FROM ai_task_evidence WHERE task_id = ? ORDER BY id').all(task.id).map(evidenceRow); }
    function listEvents(taskKey) { const task = getTaskByKey(taskKey); if (!task) return []; return db.prepare('SELECT * FROM ai_task_events WHERE task_id = ? ORDER BY seq').all(task.id).map(eventRow); }
    function loadValidatedEvidence(taskKey) {
        const task = getTaskByKey(taskKey); if (!task || task.schemaVersion !== 2) fail('TASK_SCHEMA_UNSUPPORTED');
        const records = listEvidence(taskKey); const receipts = new Map(); const facts = new Map(); const factsForValidation = new Map();
        for (const record of records.filter(item => item.recordKind === 'RECEIPT')) {
            const p = record.payload;
            if (p?.version !== 1 || p.receiptId !== record.evidenceKey || p.taskId !== task.taskKey || p.planRevision !== record.planRevision || p.sourceHash !== record.sourceHash || p.origin !== 'SERVER_EXECUTOR') fail('TASK_EVIDENCE_TAMPERED');
            receipts.set(record.evidenceKey, p);
        }
        for (const record of records.filter(item => item.recordKind === 'FACT')) {
            if (!receipts.has(record.receiptKey) || stableHash(record.payload?.key) !== record.factKeyHash || record.payload?.sourceHash !== record.sourceHash) fail('TASK_EVIDENCE_TAMPERED');
            try { validateFactRecordV1(record.payload, { taskId: task.taskKey, trustedReceiptsById: receipts, factsById: factsForValidation }); } catch { fail('TASK_EVIDENCE_TAMPERED'); }
            facts.set(record.evidenceKey, record.payload);
            factsForValidation.set(record.evidenceKey, { ...record.payload, taskId: task.taskKey });
        }
        const revalidation = recoveredFactRevalidation(facts);
        return { task, receipts, facts, revalidation, volatileRevalidationRequired: revalidation.revalidationRequiredFactIds.length > 0 };
    }
    function appendProtectedCommandStep(taskKey, expectedRevision, step) { return appendStep(taskKey, expectedRevision, step, undefined, null, { protectedCommand: true }); }
    return { appendEvidence, appendEvent, appendStep, appendProtectedCommandStep, assertLease, claimNextDetachedTask, createTask, findTaskForIdempotency, getTaskByKey, getTaskForOwner, listEvents, listEvidence, listSteps, loadValidatedEvidence, prepareInterruptedReadRetryLeased, mutateTask, recoverExpiredLeases, releaseLease, renewLease, requestCancel, reserveBudget, setStepState, taskStorageFromEnvelope, validateBudget, validateSpec };
}

module.exports = { AiTaskStoreError, EVENT_TYPES, MAX_RECEIPT_BYTES, MAX_STATE_BYTES, VOLATILE_FACT_PREDICATES, createAiTaskStoreV2, hasSensitiveField, recoveredFactRevalidation, taskStorageFromEnvelope, validateBudget, validateRecoveryPlan, validateSpec, validateWriteV1 };
