const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const {
    completeAiEvaluationRun,
    createAiEvaluationRun,
    recordAiEvaluationResult,
} = require('./aiEvaluations.cjs');
const {
    reviewFeedbackEvaluationCase,
} = require('./aiRegressionCases.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');

const START_RUN_CAPABILITY_ID = requireBusinessCapability(
    'ai.evaluations.runs.start'
).capabilityId;
const RECORD_RESULT_CAPABILITY_ID = requireBusinessCapability(
    'ai.evaluations.results.record'
).capabilityId;
const COMPLETE_RUN_CAPABILITY_ID = requireBusinessCapability(
    'ai.evaluations.runs.complete'
).capabilityId;
const REVIEW_CASE_CAPABILITY_ID = requireBusinessCapability(
    'ai.evaluations.cases.review'
).capabilityId;

function evaluationCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function normalizeOwnerKey(value) {
    return String(value || 'admin').trim().slice(0, 80) || 'admin';
}

function positiveId(value, label) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        throw evaluationCommandError(
            'ai_evaluation_id_invalid',
            `${label}不合法`,
            400
        );
    }
    return id;
}

function mapEvaluationError(error, fallbackCode) {
    if (error instanceof CommandExecutionError) return error;
    return evaluationCommandError(
        fallbackCode,
        error?.message || 'AI 评测操作失败',
        Number(error?.statusCode) || 400
    );
}

function collectAudits() {
    const auditIds = [];
    return {
        auditIds,
        onWrite(write) {
            if (write?.auditId) auditIds.push(Number(write.auditId));
        },
    };
}

function versionWarnings(commandContext, expectedUpdatedAt, label) {
    return [
        ...(commandContext.warnings || []),
        ...(!expectedUpdatedAt ? [{
            code: 'resource_version_missing_compatibility',
            message: `兼容调用未提供 ${label} expectedUpdatedAt；建议刷新后再执行`,
        }] : []),
    ];
}

function runRow(dependencies, owner, runId) {
    return dependencies.db.prepare(`
        SELECT *
        FROM ai_evaluation_runs
        WHERE id = ? AND owner_key = ?
    `).get(runId, normalizeOwnerKey(owner));
}

function feedbackCaseRow(dependencies, caseId) {
    return dependencies.db.prepare(`
        SELECT *
        FROM ai_evaluation_cases
        WHERE id = ? AND source_type = 'feedback'
    `).get(caseId);
}

function executeStartAiEvaluationRun(
    dependencies,
    owner,
    _input = {},
    commandContext = {}
) {
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: START_RUN_CAPABILITY_ID,
        input: { owner: normalizeOwnerKey(owner) },
        warnings: commandContext.warnings || [],
        execute: ({ auditContext }) => {
            const writes = collectAudits();
            let created;
            try {
                created = createAiEvaluationRun(owner, {
                    dbAccessors: dependencies,
                    auditContext,
                    onWrite: writes.onWrite,
                });
            } catch (error) {
                throw mapEvaluationError(error, 'ai_evaluation_run_start_failed');
            }
            const supersededRunIds = created.supersededRunIds || [];
            return {
                data: created,
                resource: {
                    type: 'aiEvaluationRun',
                    ids: [created.run.id],
                },
                changes: [
                    ...supersededRunIds.map(runId => ({
                        resourceType: 'aiEvaluationRun',
                        resourceId: runId,
                        field: 'status',
                        from: 'running',
                        to: 'failed',
                    })),
                    {
                        resourceType: 'aiEvaluationRun',
                        resourceId: created.run.id,
                        field: 'created',
                        from: null,
                        to: true,
                    },
                ],
                auditIds: writes.auditIds,
                requiredAuditCount: supersededRunIds.length + 1,
            };
        },
    });
}

function executeRecordAiEvaluationResult(
    dependencies,
    owner,
    runIdValue,
    input = {},
    commandContext = {}
) {
    const runId = positiveId(runIdValue, '运行ID');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const commandInput = {
        runId,
        caseId: input.caseId,
        answerText: input.answerText,
        toolResults: input.toolResults,
        errorText: input.errorText,
        expectedUpdatedAt,
    };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: RECORD_RESULT_CAPABILITY_ID,
        input: commandInput,
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '评测运行'
        ),
        execute: ({ auditContext }) => {
            const current = runRow(dependencies, owner, runId);
            if (!current) {
                throw evaluationCommandError(
                    'ai_evaluation_run_not_found',
                    '检查运行不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                'AI 评测运行'
            );
            const writes = collectAudits();
            let result;
            try {
                result = recordAiEvaluationResult(
                    owner,
                    runId,
                    commandInput,
                    {
                        dbAccessors: dependencies,
                        auditContext,
                        onWrite: writes.onWrite,
                    }
                );
            } catch (error) {
                throw mapEvaluationError(
                    error,
                    'ai_evaluation_result_record_failed'
                );
            }
            if (!result) {
                throw evaluationCommandError(
                    'ai_evaluation_run_not_found',
                    '检查运行不存在',
                    404
                );
            }
            return {
                data: { result },
                resource: {
                    type: 'aiEvaluationResult',
                    ids: [result.id],
                },
                changes: [{
                    resourceType: 'aiEvaluationResult',
                    resourceId: result.id,
                    field: 'created',
                    from: null,
                    to: true,
                }],
                auditIds: writes.auditIds,
                requiredAuditCount: 1,
            };
        },
    });
}

function executeCompleteAiEvaluationRun(
    dependencies,
    owner,
    runIdValue,
    input = {},
    commandContext = {}
) {
    const runId = positiveId(runIdValue, '运行ID');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: COMPLETE_RUN_CAPABILITY_ID,
        input: { runId, expectedUpdatedAt },
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '评测运行'
        ),
        execute: ({ auditContext }) => {
            const current = runRow(dependencies, owner, runId);
            if (!current) {
                throw evaluationCommandError(
                    'ai_evaluation_run_not_found',
                    '检查运行不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                'AI 评测运行'
            );
            if (current.status !== 'running') {
                throw evaluationCommandError(
                    'ai_evaluation_run_already_completed',
                    '本次知识库检查已经结束',
                    409
                );
            }
            const writes = collectAudits();
            let completed;
            try {
                completed = completeAiEvaluationRun(owner, runId, {
                    dbAccessors: dependencies,
                    auditContext,
                    onWrite: writes.onWrite,
                });
            } catch (error) {
                throw mapEvaluationError(
                    error,
                    'ai_evaluation_run_complete_failed'
                );
            }
            return {
                data: { run: completed },
                resource: {
                    type: 'aiEvaluationRun',
                    ids: [completed.id],
                },
                changes: [{
                    resourceType: 'aiEvaluationRun',
                    resourceId: completed.id,
                    field: 'status',
                    from: 'running',
                    to: completed.status,
                }],
                auditIds: writes.auditIds,
                requiredAuditCount: 1,
            };
        },
    });
}

function executeReviewAiEvaluationCase(
    dependencies,
    caseIdValue,
    input = {},
    commandContext = {}
) {
    const caseId = positiveId(caseIdValue, '回归用例ID');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const commandInput = {
        caseId,
        reviewStatus: input.reviewStatus,
        reviewNote: input.reviewNote,
        expectedUpdatedAt,
    };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: REVIEW_CASE_CAPABILITY_ID,
        input: commandInput,
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '回归用例'
        ),
        execute: ({ auditContext }) => {
            const current = feedbackCaseRow(dependencies, caseId);
            if (!current) {
                throw evaluationCommandError(
                    'ai_evaluation_case_not_found',
                    '纠错回归用例不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                'AI 回归用例'
            );
            const writes = collectAudits();
            let reviewed;
            try {
                reviewed = reviewFeedbackEvaluationCase(
                    caseId,
                    commandInput,
                    {
                        dbAccessors: dependencies,
                        auditContext,
                        onWrite: writes.onWrite,
                    }
                );
            } catch (error) {
                throw mapEvaluationError(
                    error,
                    'ai_evaluation_case_review_failed'
                );
            }
            return {
                data: reviewed,
                resource: {
                    type: 'aiEvaluationCase',
                    ids: [reviewed.id],
                },
                changes: [{
                    resourceType: 'aiEvaluationCase',
                    resourceId: reviewed.id,
                    field: 'reviewStatus',
                    from: current.review_status,
                    to: reviewed.reviewStatus,
                }],
                auditIds: writes.auditIds,
                requiredAuditCount: 1,
            };
        },
    });
}

module.exports = {
    COMPLETE_RUN_CAPABILITY_ID,
    RECORD_RESULT_CAPABILITY_ID,
    REVIEW_CASE_CAPABILITY_ID,
    START_RUN_CAPABILITY_ID,
    executeCompleteAiEvaluationRun,
    executeRecordAiEvaluationResult,
    executeReviewAiEvaluationCase,
    executeStartAiEvaluationRun,
};
