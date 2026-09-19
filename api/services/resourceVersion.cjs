const { CommandExecutionError } = require('./commandExecution.cjs');

function normalizeExpectedUpdatedAt(value, field = 'expectedUpdatedAt') {
    if (value === undefined || value === null || value === '') return null;
    const normalized = String(value).trim();
    if (!normalized || Number.isNaN(Date.parse(normalized))) {
        throw new CommandExecutionError('resource_version_invalid', `${field} 必须是有效 ISO 时间`, 400);
    }
    return normalized;
}

function assertExpectedUpdatedAt(record, expectedUpdatedAt, resourceLabel = '资源') {
    if (!expectedUpdatedAt) return;
    if (String(record?.updated_at || '') !== expectedUpdatedAt) {
        throw new CommandExecutionError(
            'resource_version_conflict',
            `${resourceLabel} 已被其他操作修改，请刷新后重试`,
            409
        );
    }
}

module.exports = {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
};
