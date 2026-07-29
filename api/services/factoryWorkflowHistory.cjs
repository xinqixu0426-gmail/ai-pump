const crypto = require('node:crypto');

const MAX_RETAINED_RUNS = 500;
const VALID_WORKFLOW_TYPES = new Set([
    'order_readiness',
    'quotation_to_order',
    'management_action',
]);
const VALID_TOOLS = new Set([
    'execute_order_readiness_action',
    'execute_factory_workflow_step',
]);
const VALID_STATUSES = new Set(['completed', 'failed']);

function loadDbAccessors() {
    return require('../db.cjs');
}

function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
    return Array.isArray(value) ? value : [];
}

function text(value) {
    return String(value ?? '').trim();
}

function parseObject(value) {
    try {
        return object(JSON.parse(value || '{}'));
    } catch {
        return {};
    }
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, stableValue(value[key])])
    );
}

function planFingerprintPayload(plan = {}) {
    const subject = object(plan.subject);
    return {
        workflowType: text(plan.workflowType),
        subject: {
            type: text(subject.type),
            id: text(subject.id),
        },
        steps: list(plan.steps).map(step => ({
            id: text(step.id),
            title: text(step.title),
            reason: text(step.reason),
            expectedResult: text(step.expectedResult),
            mode: text(step.mode),
            status: text(step.status),
            path: text(step.path),
            dependsOn: list(step.dependsOn).map(text),
            canExecute: Boolean(step.canExecute),
            confirmation: step.confirmation ? stableValue(step.confirmation) : null,
        })),
    };
}

function fingerprintFactoryExecutionPlan(plan = {}) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(stableValue(planFingerprintPayload(plan))))
        .digest('hex');
}

function workflowRunRow(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        workflowType: row.workflow_type,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        actionId: row.action_id,
        toolName: row.tool_name,
        status: row.status,
        attemptNumber: Number(row.attempt_number || 1),
        planFingerprint: row.plan_fingerprint,
        plan: parseObject(row.plan_json),
        result: parseObject(row.result_json),
        recheck: parseObject(row.recheck_json),
        outcomeSummary: row.outcome_summary || '',
        errorText: row.error_text || '',
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function validateRunInput(input = {}) {
    const plan = object(input.plan);
    const subject = object(plan.subject);
    const workflowType = text(input.workflowType || plan.workflowType);
    const subjectType = text(input.subjectType || subject.type);
    const subjectId = text(input.subjectId || subject.id);
    const actionId = text(input.actionId);
    const toolName = text(input.toolName);
    const status = text(input.status);
    if (!VALID_WORKFLOW_TYPES.has(workflowType)) {
        throw new Error('执行历史 workflowType 无效');
    }
    if (!subjectType || !subjectId) throw new Error('执行历史缺少业务对象');
    if (!actionId) throw new Error('执行历史缺少 actionId');
    if (!VALID_TOOLS.has(toolName)) throw new Error('执行历史工具不在允许范围');
    if (!VALID_STATUSES.has(status)) throw new Error('执行历史状态无效');
    return {
        plan,
        workflowType,
        subjectType,
        subjectId,
        actionId,
        toolName,
        status,
    };
}

function recordFactoryWorkflowRun(input = {}, options = {}) {
    const normalized = validateRunInput(input);
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert } = dbAccessors;
    const now = text(input.completedAt) || new Date().toISOString();
    const startedAt = text(input.startedAt) || now;
    const planFingerprint = fingerprintFactoryExecutionPlan(normalized.plan);
    const latestAttempt = db.prepare(`
        SELECT MAX(attempt_number) AS attempt_number
        FROM factory_workflow_runs
        WHERE workflow_type = ? AND subject_id = ? AND action_id = ?
    `).get(normalized.workflowType, normalized.subjectId, normalized.actionId);
    const attemptNumber = Number(latestAttempt?.attempt_number || 0) + 1;
    const info = safeInsert('factory_workflow_runs', {
        workflow_type: normalized.workflowType,
        subject_type: normalized.subjectType,
        subject_id: normalized.subjectId,
        action_id: normalized.actionId,
        tool_name: normalized.toolName,
        status: normalized.status,
        attempt_number: attemptNumber,
        plan_fingerprint: planFingerprint,
        plan_json: JSON.stringify(normalized.plan),
        result_json: JSON.stringify(object(input.result)),
        recheck_json: JSON.stringify(object(input.recheck)),
        outcome_summary: text(input.outcomeSummary).slice(0, 1000),
        error_text: normalized.status === 'failed' ? text(input.error).slice(0, 2000) : '',
        started_at: startedAt,
        completed_at: now,
        created_at: now,
        updated_at: now,
    });

    db.prepare(`
        DELETE FROM factory_workflow_runs
        WHERE id NOT IN (
            SELECT id FROM factory_workflow_runs
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        )
    `).run(MAX_RETAINED_RUNS);

    return workflowRunRow(
        db.prepare('SELECT * FROM factory_workflow_runs WHERE id = ?')
            .get(Number(info.lastInsertRowid))
    );
}

function listFactoryWorkflowRuns(params = {}, options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db } = dbAccessors;
    const workflowType = VALID_WORKFLOW_TYPES.has(text(params.workflowType))
        ? text(params.workflowType)
        : '';
    const subjectId = text(params.subjectId);
    const actionId = text(params.actionId);
    const status = VALID_STATUSES.has(text(params.status)) ? text(params.status) : '';
    const requestedLimit = Number(params.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 20;
    const values = [
        workflowType, workflowType,
        subjectId, subjectId,
        actionId, actionId,
        status, status,
    ];
    const where = `
        WHERE (? = '' OR workflow_type = ?)
          AND (? = '' OR subject_id = ?)
          AND (? = '' OR action_id = ?)
          AND (? = '' OR status = ?)
    `;
    const rows = db.prepare(`
        SELECT * FROM factory_workflow_runs
        ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `).all(...values, limit);
    const aggregate = db.prepare(`
        SELECT
            COUNT(*) AS total_count,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
        FROM factory_workflow_runs
        ${where}
    `).get(...values);
    return {
        items: rows.map(workflowRunRow),
        metrics: {
            totalCount: Number(aggregate.total_count || 0),
            completedCount: Number(aggregate.completed_count || 0),
            failedCount: Number(aggregate.failed_count || 0),
        },
    };
}

function compactRun(run) {
    if (!run) return null;
    return {
        id: run.id,
        workflowType: run.workflowType,
        subjectType: run.subjectType,
        subjectId: run.subjectId,
        actionId: run.actionId,
        toolName: run.toolName,
        status: run.status,
        attemptNumber: run.attemptNumber,
        planFingerprint: run.planFingerprint,
        outcomeSummary: run.outcomeSummary,
        errorText: run.errorText,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
    };
}

function refreshedMetrics(steps, current = {}) {
    return {
        ...current,
        totalSteps: steps.length,
        automaticSteps: steps.filter(item => item.mode === 'automatic').length,
        confirmableSteps: steps.filter(item => item.mode === 'confirmable' && item.status === 'available').length,
        executableSteps: steps.filter(item => item.canExecute && item.status === 'available').length,
        manualSteps: steps.filter(item => item.mode === 'manual' && item.status !== 'blocked').length,
        needsInputSteps: steps.filter(item => item.mode === 'needs_input' && item.status !== 'blocked').length,
        waitingSteps: steps.filter(item => item.status === 'waiting').length,
        blockedSteps: steps.filter(item => item.status === 'blocked').length,
        completedSteps: steps.filter(item => item.status === 'complete').length,
    };
}

function decorateFactoryExecutionPlanWithHistory(plan = {}, options = {}) {
    const subject = object(plan.subject);
    const workflowType = text(plan.workflowType);
    const subjectId = text(subject.id);
    if (!VALID_WORKFLOW_TYPES.has(workflowType) || !subjectId) {
        return { ...plan, executionHistory: null };
    }

    const history = listFactoryWorkflowRuns({
        workflowType,
        subjectId,
        limit: 10,
    }, options);
    const currentFingerprint = fingerprintFactoryExecutionPlan(plan);
    const samePlanCompleted = new Set(
        history.items
            .filter(run => run.status === 'completed' && run.planFingerprint === currentFingerprint)
            .map(run => run.actionId)
    );
    const steps = list(plan.steps).map(step => {
        if (!samePlanCompleted.has(text(step.id)) || !step.canExecute) return step;
        return {
            ...step,
            status: 'complete',
            reason: '该计划版本的步骤已有成功执行记录，不会重复执行。',
            canExecute: false,
            confirmation: null,
        };
    });
    const latestAttempt = history.items[0] || null;
    const recoverableSteps = steps.filter(step => (
        step.status === 'available'
        && step.canExecute === true
        && !samePlanCompleted.has(text(step.id))
    ));
    const remainingSteps = steps.filter(step => step.status !== 'complete');
    let recoveryState = 'none';
    let recoveryMessage = '当前没有需要恢复的执行记录。';
    if (latestAttempt?.status === 'failed') {
        const retryAvailable = recoverableSteps.some(step => text(step.id) === latestAttempt.actionId);
        recoveryState = retryAvailable ? 'retry_available' : 'blocked';
        recoveryMessage = retryAvailable
            ? `上次执行失败；“${latestAttempt.actionId}”仍未完成且当前可重新发起确认。`
            : '上次执行失败，但当前实时计划已变化或仍受阻，不能直接重试。';
    } else if (latestAttempt?.status === 'completed') {
        if (plan.status === 'complete' || remainingSteps.length === 0) {
            recoveryState = 'complete';
            recoveryMessage = '最近一次写操作已经完成，不会重复执行。';
        } else {
            recoveryState = 'continue';
            recoveryMessage = '最近一次写操作已完成，仅继续处理当前计划中仍未完成的步骤。';
        }
    }

    const allComplete = steps.length > 0 && steps.every(step => step.status === 'complete');
    return {
        ...plan,
        status: allComplete ? 'complete' : plan.status,
        metrics: refreshedMetrics(steps, object(plan.metrics)),
        steps,
        executionHistory: {
            latestAttempt: compactRun(latestAttempt),
            recentAttempts: history.items.slice(0, 5).map(compactRun),
            latestRecheck: latestAttempt?.recheck || null,
            recovery: {
                state: recoveryState,
                message: recoveryMessage,
                remainingStepIds: remainingSteps.map(step => text(step.id)).filter(Boolean),
                recoverableActionIds: recoverableSteps.map(step => text(step.id)).filter(Boolean),
            },
        },
    };
}

module.exports = {
    MAX_RETAINED_RUNS,
    VALID_STATUSES,
    VALID_TOOLS,
    VALID_WORKFLOW_TYPES,
    decorateFactoryExecutionPlanWithHistory,
    fingerprintFactoryExecutionPlan,
    listFactoryWorkflowRuns,
    recordFactoryWorkflowRun,
    workflowRunRow,
};
