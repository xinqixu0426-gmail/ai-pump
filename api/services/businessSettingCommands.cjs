const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');

const UPDATE_CAPABILITY_ID = requireBusinessCapability(
    'settings.update_business_value'
).capabilityId;
const ALLOWED_SETTINGS = new Set([
    'management_fee',
    'cable_accessories',
    'float_accessory_delta',
    'aluminum_wire_price_per_kg',
    'usd_cny_rate',
]);
const NUMERIC_SETTINGS = new Set([
    'management_fee',
    'float_accessory_delta',
    'aluminum_wire_price_per_kg',
    'usd_cny_rate',
]);

function businessSettingCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function requireAllowedSettingKey(value) {
    const key = String(value || '').trim();
    if (!ALLOWED_SETTINGS.has(key)) {
        throw businessSettingCommandError(
            'business_setting_key_invalid',
            '非法设置项',
            400
        );
    }
    return key;
}

function normalizeCableAccessories(value) {
    let config;
    try {
        config = typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        throw businessSettingCommandError(
            'cable_accessories_json_invalid',
            'cable_accessories 必须是有效 JSON',
            400
        );
    }
    for (const type of ['standard', 'xinjie']) {
        const name = config?.[type]?.name;
        const fee = Number(config?.[type]?.fee);
        if (typeof name !== 'string' || !name.trim()) {
            throw businessSettingCommandError(
                'cable_accessories_name_required',
                `${type}.name 不能为空`,
                400
            );
        }
        if (!Number.isFinite(fee) || fee < 0) {
            throw businessSettingCommandError(
                'cable_accessories_fee_invalid',
                `${type}.fee 必须是非负数字`,
                400
            );
        }
    }
    return JSON.stringify(config);
}

function normalizeBusinessSettingValue(key, value) {
    if (value === undefined) {
        throw businessSettingCommandError(
            'business_setting_value_required',
            'value 为必填项',
            400
        );
    }
    if (key === 'cable_accessories') {
        return normalizeCableAccessories(value);
    }
    if (NUMERIC_SETTINGS.has(key)) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue < 0) {
            throw businessSettingCommandError(
                'business_setting_number_invalid',
                `${key} 必须是非负数字`,
                400
            );
        }
    }
    return String(value);
}

function versionWarning(key, current, expectedUpdatedAt) {
    return current && !expectedUpdatedAt ? [{
        code: 'expected_updated_at_missing_compatibility',
        message: `设置项 ${key} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
    }] : [];
}

function executeBusinessSettingUpdate(
    dependencies,
    keyValue,
    input = {},
    commandContext = {}
) {
    const key = requireAllowedSettingKey(keyValue);
    const value = normalizeBusinessSettingValue(key, input.value);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const current = dependencies.db.prepare(`
        SELECT key, value, updated_at
        FROM system_settings
        WHERE key = ?
    `).get(key);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: UPDATE_CAPABILITY_ID,
        input: { key, value, expectedUpdatedAt },
        warnings: [
            ...(commandContext.warnings || []),
            ...versionWarning(key, current, expectedUpdatedAt),
        ],
        execute: ({ auditContext }) => {
            const live = dependencies.db.prepare(`
                SELECT key, value, updated_at
                FROM system_settings
                WHERE key = ?
            `).get(key);
            if (live) {
                assertExpectedUpdatedAt(
                    live,
                    expectedUpdatedAt,
                    `设置项 ${key}`
                );
            } else if (expectedUpdatedAt) {
                throw businessSettingCommandError(
                    'business_setting_not_found',
                    `设置项 "${key}" 不存在`,
                    404
                );
            }
            const write = dependencies.setSetting(key, value, auditContext);
            return {
                data: {
                    setting: {
                        key,
                        value: write.value,
                        updatedAt: write.updatedAt,
                    },
                },
                resource: {
                    type: 'businessSetting',
                    ids: [key],
                },
                changes: [{
                    resourceType: 'businessSetting',
                    resourceId: key,
                    field: 'value',
                    from: live?.value ?? null,
                    to: write.value,
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

module.exports = {
    ALLOWED_SETTINGS,
    NUMERIC_SETTINGS,
    UPDATE_CAPABILITY_ID,
    executeBusinessSettingUpdate,
    normalizeBusinessSettingValue,
    normalizeCableAccessories,
    requireAllowedSettingKey,
};
