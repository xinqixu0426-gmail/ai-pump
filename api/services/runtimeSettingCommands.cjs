const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const {
    applyRuntimeEnvironment,
    prepareRuntimeSettingsUpdate,
    persistRuntimeSettings,
    publicSnapshot,
    runtimeSettingsUpdatedAt,
} = require('./runtimeConfig.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');

const UPDATE_RUNTIME_CAPABILITY_ID = requireBusinessCapability(
    'settings.update_runtime'
).capabilityId;

function runtimeCommandError(code, message, statusCode = 400) {
    return new CommandExecutionError(code, message, statusCode);
}

function publicRuntimeChanges(draft) {
    return draft.changed.map((field) => {
        const secret = field.endsWith('ApiKey');
        return {
            resourceType: 'runtimeSetting',
            resourceId: field,
            field: 'value',
            from: secret
                ? Boolean(draft.current.values[field])
                : draft.current.values[field],
            to: secret ? true : draft.normalized[field],
            secret,
        };
    });
}

function executeRuntimeSettingsUpdate(
    dependencies,
    input = {},
    commandContext = {}
) {
    const options = {
        env: dependencies.env,
        dbAccessors: dependencies.dbAccessors,
    };
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const initialDraft = prepareRuntimeSettingsUpdate(input, options);
    const initialVersion = runtimeSettingsUpdatedAt(options);
    const versionWarnings = initialVersion && !expectedUpdatedAt
        ? [{
            code: 'expected_updated_at_missing_compatibility',
            message: '运行设置未提供 expectedUpdatedAt，并发覆盖保护未启用',
        }]
        : [];
    const receipt = executePersistentCommand({
        db: dependencies.dbAccessors.db,
        ...commandContext,
        capabilityId: UPDATE_RUNTIME_CAPABILITY_ID,
        input: {
            expectedUpdatedAt,
            settings: initialDraft.requested,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...versionWarnings,
        ],
        execute: ({ auditContext }) => {
            const liveVersion = runtimeSettingsUpdatedAt(options);
            if (liveVersion) {
                assertExpectedUpdatedAt(
                    { updated_at: liveVersion },
                    expectedUpdatedAt,
                    '运行设置'
                );
            } else if (expectedUpdatedAt) {
                throw runtimeCommandError(
                    'runtime_settings_version_conflict',
                    '运行设置版本已变化，请刷新后重试',
                    409
                );
            }
            const liveDraft = prepareRuntimeSettingsUpdate(input, options);
            const writes = persistRuntimeSettings(
                liveDraft.normalized,
                {
                    ...options,
                    auditContext,
                    transaction: false,
                }
            );
            const config = publicSnapshot(options);
            return {
                data: {
                    ...config,
                    changed: liveDraft.changed,
                },
                resource: {
                    type: 'runtimeSettings',
                    ids: liveDraft.changed,
                    version: config.updatedAt,
                },
                changes: publicRuntimeChanges(liveDraft),
                auditIds: writes
                    .map(write => write.auditId)
                    .filter(Boolean),
                requiredAuditCount: writes.length,
            };
        },
    });
    applyRuntimeEnvironment(initialDraft.requested, dependencies.env);
    return receipt;
}

module.exports = {
    UPDATE_RUNTIME_CAPABILITY_ID,
    executeRuntimeSettingsUpdate,
    publicRuntimeChanges,
    runtimeCommandError,
};
