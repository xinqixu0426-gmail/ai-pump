const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const {
    diagnoseAiAnswerFeedback,
    recordAiAnswerFeedbackRetest,
    reviewAiAnswerFeedback,
    submitAiAnswerFeedback,
} = require('./aiAnswerFeedback.cjs');
const { updateFactoryAiRule } = require('./factoryAiRules.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');

const SUBMIT_FEEDBACK_CAPABILITY_ID = requireBusinessCapability(
    'ai.feedback.submit'
).capabilityId;
const DIAGNOSE_FEEDBACK_CAPABILITY_ID = requireBusinessCapability(
    'ai.feedback.diagnose'
).capabilityId;
const RETEST_FEEDBACK_CAPABILITY_ID = requireBusinessCapability(
    'ai.feedback.retest'
).capabilityId;
const REVIEW_FEEDBACK_CAPABILITY_ID = requireBusinessCapability(
    'ai.feedback.review'
).capabilityId;
const UPDATE_LEARNING_RULE_CAPABILITY_ID = requireBusinessCapability(
    'ai.learning_rules.update'
).capabilityId;

function feedbackCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function ownerKey(value) {
    return String(value || 'admin').trim().slice(0, 80) || 'admin';
}

function positiveId(value, label) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        throw feedbackCommandError(
            'ai_feedback_id_invalid',
            `${label}不合法`,
            400
        );
    }
    return id;
}

function mapFeedbackError(error, fallbackCode) {
    if (error instanceof CommandExecutionError) return error;
    return feedbackCommandError(
        fallbackCode,
        error?.message || 'AI 反馈操作失败',
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

function feedbackById(dependencies, owner, feedbackId) {
    return dependencies.db.prepare(`
        SELECT feedback.*
        FROM ai_answer_feedback AS feedback
        JOIN ai_conversations AS conversation
          ON conversation.id = feedback.conversation_id
        WHERE feedback.id = ?
          AND conversation.owner_key = ?
    `).get(feedbackId, ownerKey(owner));
}

function feedbackByMessage(dependencies, owner, messageId) {
    return dependencies.db.prepare(`
        SELECT feedback.*
        FROM ai_answer_feedback AS feedback
        JOIN ai_conversations AS conversation
          ON conversation.id = feedback.conversation_id
        WHERE feedback.message_id = ?
          AND conversation.owner_key = ?
          AND conversation.deleted_at IS NULL
    `).get(messageId, ownerKey(owner));
}

function executeSubmitAiAnswerFeedback(
    dependencies,
    owner,
    input = {},
    commandContext = {}
) {
    const messageId = positiveId(input.messageId, '消息ID');
    const current = feedbackByMessage(dependencies, owner, messageId);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const commandInput = {
        messageId,
        rating: input.rating,
        note: input.note,
        learnFromCorrection: input.learnFromCorrection,
        expectedUpdatedAt,
    };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: SUBMIT_FEEDBACK_CAPABILITY_ID,
        input: commandInput,
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '已有回答反馈',
            Boolean(current)
        ),
        execute: ({ auditContext }) => {
            const latest = feedbackByMessage(
                dependencies,
                owner,
                messageId
            );
            if (latest) {
                assertExpectedUpdatedAt(
                    latest,
                    expectedUpdatedAt,
                    'AI 回答反馈'
                );
            }
            const writes = collectWrites();
            let feedback;
            try {
                feedback = submitAiAnswerFeedback(owner, commandInput, {
                    dbAccessors: dependencies,
                    auditContext,
                    onWrite: writes.onWrite,
                });
            } catch (error) {
                throw mapFeedbackError(error, 'ai_feedback_submit_failed');
            }
            if (!feedback) {
                throw feedbackCommandError(
                    'ai_feedback_message_not_found',
                    'AI 回复不存在',
                    404
                );
            }
            return {
                data: { feedback },
                resource: {
                    type: 'aiAnswerFeedback',
                    ids: [feedback.id],
                },
                changes: [{
                    resourceType: 'aiAnswerFeedback',
                    resourceId: feedback.id,
                    field: current ? 'rating' : 'created',
                    from: current?.rating || null,
                    to: current ? feedback.rating : true,
                }],
                auditIds: writes.state.auditIds,
                requiredAuditCount: writes.state.writeCount,
            };
        },
    });
}

function executeFeedbackMutation({
    dependencies,
    owner,
    feedbackIdValue,
    input,
    commandContext,
    capabilityId,
    execute,
    fallbackCode,
    changeField,
} = {}) {
    const feedbackId = positiveId(feedbackIdValue, '反馈ID');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const commandInput = { ...input, feedbackId, expectedUpdatedAt };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId,
        input: commandInput,
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '回答反馈',
            true
        ),
        execute: ({ auditContext }) => {
            const current = feedbackById(
                dependencies,
                owner,
                feedbackId
            );
            if (!current) {
                throw feedbackCommandError(
                    'ai_feedback_not_found',
                    '反馈不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                'AI 回答反馈'
            );
            const writes = collectWrites();
            let feedback;
            try {
                feedback = execute(feedbackId, commandInput, {
                    dbAccessors: dependencies,
                    auditContext,
                    onWrite: writes.onWrite,
                });
            } catch (error) {
                throw mapFeedbackError(error, fallbackCode);
            }
            return {
                data: { feedback },
                resource: {
                    type: 'aiAnswerFeedback',
                    ids: [feedback.id],
                },
                changes: [{
                    resourceType: 'aiAnswerFeedback',
                    resourceId: feedback.id,
                    field: changeField,
                    from: 'previous',
                    to: 'updated',
                }],
                auditIds: writes.state.auditIds,
                requiredAuditCount: writes.state.writeCount,
            };
        },
    });
}

function executeDiagnoseAiAnswerFeedback(
    dependencies,
    owner,
    feedbackId,
    input = {},
    commandContext = {}
) {
    return executeFeedbackMutation({
        dependencies,
        owner,
        feedbackIdValue: feedbackId,
        input,
        commandContext,
        capabilityId: DIAGNOSE_FEEDBACK_CAPABILITY_ID,
        execute: (id, _input, options) => diagnoseAiAnswerFeedback(
            owner,
            id,
            {
                ...options,
                ...(dependencies.knowledgeService
                    ? { knowledgeService: dependencies.knowledgeService }
                    : {}),
                ...(dependencies.knowledgeOptions
                    ? { knowledgeOptions: dependencies.knowledgeOptions }
                    : {}),
            }
        ),
        fallbackCode: 'ai_feedback_diagnose_failed',
        changeField: 'diagnosis',
    });
}

function executeRetestAiAnswerFeedback(
    dependencies,
    owner,
    feedbackId,
    input = {},
    commandContext = {}
) {
    return executeFeedbackMutation({
        dependencies,
        owner,
        feedbackIdValue: feedbackId,
        input,
        commandContext,
        capabilityId: RETEST_FEEDBACK_CAPABILITY_ID,
        execute: (id, commandInput, options) => (
            recordAiAnswerFeedbackRetest(
                owner,
                id,
                commandInput,
                options
            )
        ),
        fallbackCode: 'ai_feedback_retest_failed',
        changeField: 'retest',
    });
}

function executeReviewAiAnswerFeedback(
    dependencies,
    owner,
    feedbackId,
    input = {},
    commandContext = {}
) {
    return executeFeedbackMutation({
        dependencies,
        owner,
        feedbackIdValue: feedbackId,
        input,
        commandContext,
        capabilityId: REVIEW_FEEDBACK_CAPABILITY_ID,
        execute: (id, commandInput, options) => (
            reviewAiAnswerFeedback(owner, id, commandInput, options)
        ),
        fallbackCode: 'ai_feedback_review_failed',
        changeField: 'status',
    });
}

function executeUpdateFactoryAiRule(
    dependencies,
    ruleIdValue,
    input = {},
    commandContext = {}
) {
    const ruleId = positiveId(ruleIdValue, '规则ID');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const commandInput = {
        ruleId,
        status: input.status,
        title: input.title,
        triggerText: input.triggerText,
        instruction: input.instruction,
        expectedUpdatedAt,
    };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: UPDATE_LEARNING_RULE_CAPABILITY_ID,
        input: commandInput,
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '长期纠正规则',
            true
        ),
        execute: ({ auditContext }) => {
            const current = dependencies.db.prepare(
                'SELECT * FROM factory_ai_rules WHERE id = ?'
            ).get(ruleId);
            if (!current) {
                throw feedbackCommandError(
                    'ai_learning_rule_not_found',
                    '纠正规则不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                '长期纠正规则'
            );
            const writes = collectWrites();
            let rule;
            try {
                rule = updateFactoryAiRule(ruleId, commandInput, {
                    dbAccessors: dependencies,
                    auditContext,
                    onWrite: writes.onWrite,
                });
            } catch (error) {
                throw mapFeedbackError(
                    error,
                    'ai_learning_rule_update_failed'
                );
            }
            return {
                data: { rule },
                resource: {
                    type: 'factoryAiRule',
                    ids: [rule.id],
                },
                changes: [{
                    resourceType: 'factoryAiRule',
                    resourceId: rule.id,
                    field: 'configuration',
                    from: 'previous',
                    to: 'updated',
                }],
                auditIds: writes.state.auditIds,
                requiredAuditCount: writes.state.writeCount,
            };
        },
    });
}

module.exports = {
    DIAGNOSE_FEEDBACK_CAPABILITY_ID,
    RETEST_FEEDBACK_CAPABILITY_ID,
    REVIEW_FEEDBACK_CAPABILITY_ID,
    SUBMIT_FEEDBACK_CAPABILITY_ID,
    UPDATE_LEARNING_RULE_CAPABILITY_ID,
    executeDiagnoseAiAnswerFeedback,
    executeRetestAiAnswerFeedback,
    executeReviewAiAnswerFeedback,
    executeSubmitAiAnswerFeedback,
    executeUpdateFactoryAiRule,
};
