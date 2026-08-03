const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const {
    resolveRecipeAnalysisFeedback,
    saveRecipeAnalysisFeedback,
} = require('./recipeAnalysisFeedback.cjs');
const {
    refreshFactoryRuleCandidates,
    restoreFactoryRuleEvent,
    reviewFactoryRuleCandidate,
} = require('./factoryRuleCandidates.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');

const SAVE_RECIPE_FEEDBACK_CAPABILITY_ID = requireBusinessCapability(
    'quality.recipe_feedback.save'
).capabilityId;
const RESOLVE_RECIPE_FEEDBACK_CAPABILITY_ID = requireBusinessCapability(
    'quality.recipe_feedback.resolve'
).capabilityId;
const REFRESH_RULE_CANDIDATES_CAPABILITY_ID = requireBusinessCapability(
    'quality.rule_candidates.refresh'
).capabilityId;
const REVIEW_RULE_CANDIDATE_CAPABILITY_ID = requireBusinessCapability(
    'quality.rule_candidates.review'
).capabilityId;
const RESTORE_RULE_EVENT_CAPABILITY_ID = requireBusinessCapability(
    'quality.rule_events.restore'
).capabilityId;

function qualityCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function positiveId(value, label) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        throw qualityCommandError(
            'quality_resource_id_invalid',
            `${label}必须是正整数`,
            400
        );
    }
    return id;
}

function mapQualityError(error, fallbackCode) {
    if (error instanceof CommandExecutionError) return error;
    return qualityCommandError(
        fallbackCode,
        error?.message || '质量规则操作失败',
        Number(error?.statusCode) || 400
    );
}

function collectWrites() {
    const state = { auditIds: [], writeCount: 0 };
    return {
        state,
        onWrite(write) {
            state.writeCount += 1;
            if (write?.auditId) state.auditIds.push(Number(write.auditId));
        },
    };
}

function versionWarnings(commandContext, expectedUpdatedAt, label, required) {
    return [
        ...(commandContext.warnings || []),
        ...(required && !expectedUpdatedAt ? [{
            code: 'resource_version_missing_compatibility',
            message: `兼容调用未提供 ${label} expectedUpdatedAt；建议刷新后再执行`,
        }] : []),
    ];
}

function feedbackByRecipeFinding(dependencies, recipeId, findingKey) {
    return dependencies.db.prepare(`
        SELECT *
        FROM recipe_analysis_feedback
        WHERE recipe_id = ? AND finding_key = ?
    `).get(recipeId, String(findingKey || '').trim());
}

function feedbackById(dependencies, feedbackId) {
    return dependencies.db.prepare(
        'SELECT * FROM recipe_analysis_feedback WHERE id = ?'
    ).get(feedbackId);
}

function candidateById(dependencies, candidateId) {
    return dependencies.db.prepare(
        'SELECT * FROM factory_rule_candidates WHERE id = ?'
    ).get(candidateId);
}

function executeSaveRecipeAnalysisFeedback(
    dependencies,
    recipeIdValue,
    input = {},
    commandContext = {}
) {
    const recipeId = positiveId(recipeIdValue, 'recipeId');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const commandInput = {
        recipeId,
        findingKey: input.findingKey,
        findingType: input.findingType,
        decision: input.decision,
        note: input.note,
        findingSnapshot: input.findingSnapshot,
        expectedUpdatedAt,
    };
    const current = feedbackByRecipeFinding(
        dependencies,
        recipeId,
        input.findingKey
    );
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: SAVE_RECIPE_FEEDBACK_CAPABILITY_ID,
        input: commandInput,
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '已有配方检查反馈',
            Boolean(current)
        ),
        execute: ({ auditContext }) => {
            const latest = feedbackByRecipeFinding(
                dependencies,
                recipeId,
                input.findingKey
            );
            if (latest) {
                assertExpectedUpdatedAt(
                    latest,
                    expectedUpdatedAt,
                    '配方检查反馈'
                );
            }
            const writes = collectWrites();
            let feedback;
            try {
                feedback = saveRecipeAnalysisFeedback(
                    recipeId,
                    commandInput,
                    {
                        ...dependencies,
                        actor: commandContext.actorKey,
                        auditContext,
                        onWrite: writes.onWrite,
                    }
                );
            } catch (error) {
                throw mapQualityError(
                    error,
                    'quality_recipe_feedback_save_failed'
                );
            }
            return {
                data: { feedback },
                resource: {
                    type: 'recipeAnalysisFeedback',
                    ids: [feedback.id],
                },
                changes: [{
                    resourceType: 'recipeAnalysisFeedback',
                    resourceId: feedback.id,
                    field: current ? 'decision' : 'created',
                    from: current?.decision || null,
                    to: current ? feedback.decision : true,
                }],
                auditIds: writes.state.auditIds,
                requiredAuditCount: writes.state.writeCount,
            };
        },
    });
}

function executeResolveRecipeAnalysisFeedback(
    dependencies,
    feedbackIdValue,
    input = {},
    commandContext = {}
) {
    const feedbackId = positiveId(feedbackIdValue, 'feedbackId');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const commandInput = {
        feedbackId,
        note: input.note,
        expectedUpdatedAt,
    };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: RESOLVE_RECIPE_FEEDBACK_CAPABILITY_ID,
        input: commandInput,
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '配方检查反馈',
            true
        ),
        execute: ({ auditContext }) => {
            const current = feedbackById(dependencies, feedbackId);
            if (!current) {
                throw qualityCommandError(
                    'quality_recipe_feedback_not_found',
                    '配方检查反馈不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                '配方检查反馈'
            );
            const writes = collectWrites();
            let feedback;
            try {
                feedback = resolveRecipeAnalysisFeedback(
                    feedbackId,
                    commandInput,
                    {
                        ...dependencies,
                        actor: commandContext.actorKey,
                        auditContext,
                        onWrite: writes.onWrite,
                    }
                );
            } catch (error) {
                throw mapQualityError(
                    error,
                    'quality_recipe_feedback_resolve_failed'
                );
            }
            return {
                data: { feedback },
                resource: {
                    type: 'recipeAnalysisFeedback',
                    ids: [feedback.id],
                },
                changes: [{
                    resourceType: 'recipeAnalysisFeedback',
                    resourceId: feedback.id,
                    field: 'decision',
                    from: current.decision,
                    to: feedback.decision,
                }],
                auditIds: writes.state.auditIds,
                requiredAuditCount: writes.state.writeCount,
            };
        },
    });
}

function executeRefreshFactoryRuleCandidates(
    dependencies,
    _input = {},
    commandContext = {}
) {
    const commandInput = {};
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: REFRESH_RULE_CANDIDATES_CAPABILITY_ID,
        input: commandInput,
        execute: ({ auditContext }) => {
            const writes = collectWrites();
            let learning;
            try {
                learning = refreshFactoryRuleCandidates({
                    ...dependencies,
                    actor: commandContext.actorKey,
                    auditContext,
                    onWrite: writes.onWrite,
                });
            } catch (error) {
                throw mapQualityError(
                    error,
                    'quality_rule_candidates_refresh_failed'
                );
            }
            return {
                data: { learning },
                resource: {
                    type: 'factoryRuleCandidate',
                    ids: learning.candidates.map(candidate => candidate.id),
                },
                changes: [{
                    resourceType: 'factoryRuleCandidate',
                    resourceId: null,
                    field: 'derivedCandidates',
                    from: 'previousEvidence',
                    to: learning.stats,
                }],
                auditIds: writes.state.auditIds,
                requiredAuditCount: writes.state.writeCount,
            };
        },
    });
}

function executeReviewFactoryRuleCandidate(
    dependencies,
    candidateIdValue,
    input = {},
    commandContext = {}
) {
    const candidateId = positiveId(candidateIdValue, '候选规则 ID');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const commandInput = {
        candidateId,
        status: input.status,
        reviewNote: input.reviewNote,
        expectedUpdatedAt,
    };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: REVIEW_RULE_CANDIDATE_CAPABILITY_ID,
        input: commandInput,
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '候选规则',
            true
        ),
        execute: ({ auditContext }) => {
            const current = candidateById(dependencies, candidateId);
            if (!current) {
                throw qualityCommandError(
                    'quality_rule_candidate_not_found',
                    '候选规则不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(current, expectedUpdatedAt, '候选规则');
            const writes = collectWrites();
            let candidate;
            try {
                candidate = reviewFactoryRuleCandidate(
                    candidateId,
                    commandInput,
                    {
                        ...dependencies,
                        actor: commandContext.actorKey,
                        auditContext,
                        onWrite: writes.onWrite,
                    }
                );
            } catch (error) {
                throw mapQualityError(
                    error,
                    'quality_rule_candidate_review_failed'
                );
            }
            return {
                data: { candidate },
                resource: {
                    type: 'factoryRuleCandidate',
                    ids: [candidate.id],
                },
                changes: [{
                    resourceType: 'factoryRuleCandidate',
                    resourceId: candidate.id,
                    field: 'status',
                    from: current.status,
                    to: candidate.status,
                }],
                auditIds: writes.state.auditIds,
                requiredAuditCount: writes.state.writeCount,
            };
        },
    });
}

function executeRestoreFactoryRuleEvent(
    dependencies,
    eventIdValue,
    input = {},
    commandContext = {}
) {
    const eventId = positiveId(eventIdValue, '规则事件 ID');
    const event = dependencies.db.prepare(
        'SELECT * FROM factory_rule_events WHERE id = ?'
    ).get(eventId);
    if (!event) {
        throw qualityCommandError(
            'quality_rule_event_not_found',
            '规则事件不存在',
            404
        );
    }
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const commandInput = {
        eventId,
        restoreNote: input.restoreNote,
        expectedUpdatedAt,
    };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: RESTORE_RULE_EVENT_CAPABILITY_ID,
        input: commandInput,
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '候选规则',
            true
        ),
        execute: ({ auditContext }) => {
            const current = candidateById(
                dependencies,
                Number(event.candidate_id)
            );
            if (!current || current.rule_key !== event.rule_key) {
                throw qualityCommandError(
                    'quality_rule_candidate_not_found',
                    '历史事件对应的候选规则不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(current, expectedUpdatedAt, '候选规则');
            const writes = collectWrites();
            let restoration;
            try {
                restoration = restoreFactoryRuleEvent(
                    eventId,
                    commandInput,
                    {
                        ...dependencies,
                        actor: commandContext.actorKey,
                        auditContext,
                        onWrite: writes.onWrite,
                    }
                );
            } catch (error) {
                throw mapQualityError(
                    error,
                    'quality_rule_event_restore_failed'
                );
            }
            return {
                data: { restoration },
                resource: {
                    type: 'factoryRuleCandidate',
                    ids: [restoration.candidate.id],
                },
                changes: [{
                    resourceType: 'factoryRuleCandidate',
                    resourceId: restoration.candidate.id,
                    field: 'status',
                    from: current.status,
                    to: restoration.candidate.status,
                }],
                auditIds: writes.state.auditIds,
                requiredAuditCount: writes.state.writeCount,
            };
        },
    });
}

module.exports = {
    REFRESH_RULE_CANDIDATES_CAPABILITY_ID,
    RESOLVE_RECIPE_FEEDBACK_CAPABILITY_ID,
    RESTORE_RULE_EVENT_CAPABILITY_ID,
    REVIEW_RULE_CANDIDATE_CAPABILITY_ID,
    SAVE_RECIPE_FEEDBACK_CAPABILITY_ID,
    executeRefreshFactoryRuleCandidates,
    executeResolveRecipeAnalysisFeedback,
    executeRestoreFactoryRuleEvent,
    executeReviewFactoryRuleCandidate,
    executeSaveRecipeAnalysisFeedback,
};
