const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const {
    completeAiEvaluationRun,
    configureAiSystemEvaluationCase,
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
const CONFIGURE_SYSTEM_CASE_CAPABILITY_ID = requireBusinessCapability(
    'ai.evaluations.system_cases.configure'
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
        error?.code || fallbackCode,
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

function systemCaseRow(dependencies, caseId) {
    return dependencies.db.prepare(`
        SELECT *
        FROM ai_evaluation_cases
        WHERE id = ? AND source_type = 'system'
    `).get(caseId);
}

function normalizeRunScope(value) {
    const scope = String(value || 'manual').trim();
    if (!['manual', 'release'].includes(scope)) {
        throw evaluationCommandError(
            'ai_evaluation_scope_invalid',
            '检查范围必须是 manual 或 release',
            400
        );
    }
    return scope;
}

function normalizeRunCaseKey(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') {
        throw evaluationCommandError(
            'ai_evaluation_case_key_invalid',
            'caseKey 必须是字符串',
            400
        );
    }
    const caseKey = value.trim();
    if (!caseKey || caseKey.length > 160) {
        throw evaluationCommandError(
            'ai_evaluation_case_key_invalid',
            'caseKey 必须是 1 到 160 个字符',
            400
        );
    }
    return caseKey;
}

function executeStartAiEvaluationRun(
    dependencies,
    owner,
    _input = {},
    commandContext = {}
) {
    const scope = normalizeRunScope(_input.scope);
    const caseKey = normalizeRunCaseKey(_input.caseKey);
    if (scope === 'release' && caseKey) {
        throw evaluationCommandError(
            'ai_evaluation_release_case_filter_forbidden',
            '发布门禁必须运行完整用例集合，不能按 caseKey 筛选',
            400
        );
    }
    if (scope === 'manual' && normalizeOwnerKey(owner) === 'internal') {
        throw evaluationCommandError(
            'ai_evaluation_manual_owner_forbidden',
            '手动 AI 回归必须使用普通登录身份，不能覆盖内部发布健康记录',
            403
        );
    }
    if (scope === 'release' && normalizeOwnerKey(owner) !== 'internal') {
        throw evaluationCommandError(
            'ai_evaluation_release_scope_forbidden',
            '发布门禁检查只允许内部服务启动',
            403
        );
    }
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: START_RUN_CAPABILITY_ID,
        input: {
            owner: normalizeOwnerKey(owner),
            scope,
            ...(caseKey ? { caseKey } : {}),
        },
        warnings: commandContext.warnings || [],
        execute: ({ auditContext }) => {
            const writes = collectAudits();
            let created;
            try {
                created = createAiEvaluationRun(owner, {
                    dbAccessors: dependencies,
                    scope,
                    caseKey,
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

function executeConfigureAiSystemEvaluationCase(
    dependencies,
    caseIdValue,
    input = {},
    commandContext = {}
) {
    const caseId = positiveId(caseIdValue, '系统检查项ID');
    if (typeof input.enabled !== 'boolean') {
        throw evaluationCommandError(
            'ai_evaluation_enabled_invalid',
            'enabled 必须是布尔值',
            400
        );
    }
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const commandInput = {
        caseId,
        enabled: input.enabled,
        expectedUpdatedAt,
    };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: CONFIGURE_SYSTEM_CASE_CAPABILITY_ID,
        input: commandInput,
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '系统检查项'
        ),
        execute: ({ auditContext }) => {
            const current = systemCaseRow(dependencies, caseId);
            if (!current) {
                throw evaluationCommandError(
                    'ai_evaluation_system_case_not_found',
                    '系统检查项不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                '系统检查项'
            );
            const writes = collectAudits();
            let configured;
            try {
                configured = configureAiSystemEvaluationCase(
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
                    'ai_evaluation_system_case_configure_failed'
                );
            }
            return {
                data: configured,
                resource: {
                    type: 'aiEvaluationCase',
                    ids: [configured.id],
                },
                changes: [{
                    resourceType: 'aiEvaluationCase',
                    resourceId: configured.id,
                    field: 'enabled',
                    from: Boolean(current.enabled),
                    to: configured.enabled,
                }],
                auditIds: writes.auditIds,
                requiredAuditCount: 1,
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
    CONFIGURE_SYSTEM_CASE_CAPABILITY_ID,
    RECORD_RESULT_CAPABILITY_ID,
    REVIEW_CASE_CAPABILITY_ID,
    START_RUN_CAPABILITY_ID,
    executeCompleteAiEvaluationRun,
    executeConfigureAiSystemEvaluationCase,
    executeRecordAiEvaluationResult,
    executeReviewAiEvaluationCase,
    executeStartAiEvaluationRun,
};
