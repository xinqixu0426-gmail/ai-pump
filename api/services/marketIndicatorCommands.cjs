const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const {
    updateAllCoilsCopperPrice,
} = require('./copperPriceUpdate.cjs');

const COPPER_SYNC_CAPABILITY_ID = requireBusinessCapability(
    'market.sync_copper_price'
).capabilityId;
const INDICATOR_SYNC_CAPABILITY_ID = requireBusinessCapability(
    'market.sync_indicators'
).capabilityId;

const ALUMINUM_SETTING_KEY = 'aluminum_wire_price_per_kg';
const EXCHANGE_RATE_SETTING_KEY = 'usd_cny_rate';
const SYNC_TRIGGERS = new Set([
    'manual',
    'startup',
    'scheduled',
    'internal',
]);
const SYNC_REQUEST_FIELDS = new Set(['idempotencyKey']);

function marketCommandError(code, message, statusCode = 400) {
    return new CommandExecutionError(code, message, statusCode);
}

function normalizeSyncTrigger(value) {
    const trigger = String(value || 'manual').trim();
    if (!SYNC_TRIGGERS.has(trigger)) {
        throw marketCommandError(
            'market_sync_trigger_invalid',
            '市场同步 trigger 无效'
        );
    }
    return trigger;
}

function assertMarketSyncRequestBody(input) {
    if (input === undefined || input === null) return {};
    if (typeof input !== 'object' || Array.isArray(input)) {
        throw marketCommandError(
            'market_sync_body_invalid',
            '市场同步请求体必须是对象'
        );
    }
    const unknownFields = Object.keys(input).filter(
        key => !SYNC_REQUEST_FIELDS.has(key)
    );
    if (unknownFields.length > 0) {
        throw marketCommandError(
            'market_sync_unknown_field',
            `市场同步请求包含未知字段: ${unknownFields.join(', ')}`
        );
    }
    return input;
}

function normalizeMarketSnapshot(snapshot, options = {}) {
    const copperPricePerTon = Number(snapshot?.copperPricePerTon);
    if (!Number.isFinite(copperPricePerTon) || copperPricePerTon <= 0) {
        throw marketCommandError(
            'copper_price_invalid',
            '铜价必须是大于 0 的数字'
        );
    }
    const result = {
        copperPricePerTon,
        fetchedAt: String(
            snapshot?.fetchedAt || new Date().toISOString()
        ),
        sources: snapshot?.sources || null,
    };
    if (options.requireAll) {
        const aluminumPricePerTon = Number(snapshot?.aluminumPricePerTon);
        const usdCnyRate = Number(snapshot?.usdCnyRate);
        if (!Number.isFinite(aluminumPricePerTon) || aluminumPricePerTon <= 0) {
            throw marketCommandError(
                'aluminum_price_invalid',
                '铝价必须是大于 0 的数字'
            );
        }
        if (!Number.isFinite(usdCnyRate) || usdCnyRate <= 0) {
            throw marketCommandError(
                'usd_cny_rate_invalid',
                '美元兑人民币汇率必须是大于 0 的数字'
            );
        }
        result.aluminumPricePerTon = aluminumPricePerTon;
        result.usdCnyRate = usdCnyRate;
        result.exchangeRateSourceDate =
            snapshot?.exchangeRateSourceDate || null;
    }
    return result;
}

function sameSettingValue(left, right) {
    return String(left ?? '') === String(right ?? '');
}

function applySettingIfChanged(
    dependencies,
    key,
    value,
    auditContext
) {
    const current = dependencies.db.prepare(`
        SELECT key, value, updated_at
        FROM system_settings
        WHERE key = ?
    `).get(key);
    if (current && sameSettingValue(current.value, value)) {
        return {
            changed: false,
            auditId: null,
            current,
            setting: {
                key,
                value: current.value,
                updatedAt: current.updated_at || null,
            },
        };
    }
    const write = dependencies.setSetting(key, value, auditContext);
    return {
        changed: true,
        auditId: write.auditId || null,
        current,
        setting: {
            key,
            value: write.value,
            updatedAt: write.updatedAt,
        },
    };
}

function copperChange(copperResult) {
    if (copperResult.updatedCount === 0) return [];
    return [{
        resourceType: 'coil',
        resourceIds: copperResult.updatedCoilIds,
        field: 'copperBase+cost',
        updatedCount: copperResult.updatedCount,
        copperPricePerKg: copperResult.copperPricePerKg,
    }];
}

function settingChange(key, result) {
    if (!result.changed) return [];
    return [{
        resourceType: 'businessSetting',
        resourceId: key,
        field: 'value',
        from: result.current?.value ?? null,
        to: result.setting.value,
    }];
}

function executeCopperPriceSync(
    dependencies,
    rawSnapshot,
    input = {},
    commandContext = {}
) {
    const snapshot = normalizeMarketSnapshot(rawSnapshot);
    const trigger = normalizeSyncTrigger(input.trigger);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: COPPER_SYNC_CAPABILITY_ID,
        input: { trigger },
        warnings: commandContext.warnings || [],
        execute: ({ auditContext }) => {
            const copperResult = updateAllCoilsCopperPrice(
                dependencies.db,
                dependencies.safeUpdate,
                snapshot.copperPricePerTon,
                null,
                {
                    auditContext,
                    transaction: false,
                }
            );
            return {
                data: {
                    ...copperResult,
                    fetchedAt: snapshot.fetchedAt,
                    trigger,
                    sourceOfTruth:
                        'externalCopperMarket+coils.copper_base+coils.cost',
                    sources: snapshot.sources,
                },
                resource: {
                    type: 'marketCopperPrice',
                    ids: copperResult.updatedCoilIds,
                },
                changes: copperChange(copperResult),
                auditIds: copperResult.auditIds,
                requiredAuditCount: copperResult.updatedCount,
            };
        },
    });
}

function executeMarketIndicatorsSync(
    dependencies,
    rawSnapshot,
    input = {},
    commandContext = {}
) {
    const snapshot = normalizeMarketSnapshot(
        rawSnapshot,
        { requireAll: true }
    );
    const trigger = normalizeSyncTrigger(input.trigger);
    const aluminumPricePerKg = (
        snapshot.aluminumPricePerTon / 1000
    ).toFixed(2);
    const usdCnyRate = snapshot.usdCnyRate.toFixed(4);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: INDICATOR_SYNC_CAPABILITY_ID,
        input: { trigger },
        warnings: commandContext.warnings || [],
        execute: ({ auditContext }) => {
            const copperResult = updateAllCoilsCopperPrice(
                dependencies.db,
                dependencies.safeUpdate,
                snapshot.copperPricePerTon,
                null,
                {
                    auditContext,
                    transaction: false,
                }
            );
            const aluminum = applySettingIfChanged(
                dependencies,
                ALUMINUM_SETTING_KEY,
                aluminumPricePerKg,
                auditContext
            );
            const exchangeRate = applySettingIfChanged(
                dependencies,
                EXCHANGE_RATE_SETTING_KEY,
                usdCnyRate,
                auditContext
            );
            const auditIds = [
                ...copperResult.auditIds,
                aluminum.auditId,
                exchangeRate.auditId,
            ].filter(Boolean);
            const settingWriteCount = Number(aluminum.changed)
                + Number(exchangeRate.changed);
            return {
                data: {
                    ...copperResult,
                    aluminumPricePerTon: snapshot.aluminumPricePerTon,
                    aluminumPricePerKg,
                    usdCnyRate,
                    exchangeRateSourceDate:
                        snapshot.exchangeRateSourceDate,
                    fetchedAt: snapshot.fetchedAt,
                    trigger,
                    sourceOfTruth:
                        'externalMetalAndExchangeMarkets+coils+system_settings',
                    sources: snapshot.sources,
                },
                resource: {
                    type: 'marketIndicators',
                    ids: [
                        ...copperResult.updatedCoilIds.map(String),
                        ALUMINUM_SETTING_KEY,
                        EXCHANGE_RATE_SETTING_KEY,
                    ],
                },
                changes: [
                    ...copperChange(copperResult),
                    ...settingChange(ALUMINUM_SETTING_KEY, aluminum),
                    ...settingChange(
                        EXCHANGE_RATE_SETTING_KEY,
                        exchangeRate
                    ),
                ],
                auditIds,
                requiredAuditCount:
                    copperResult.updatedCount + settingWriteCount,
            };
        },
    });
}

module.exports = {
    ALUMINUM_SETTING_KEY,
    COPPER_SYNC_CAPABILITY_ID,
    EXCHANGE_RATE_SETTING_KEY,
    INDICATOR_SYNC_CAPABILITY_ID,
    SYNC_TRIGGERS,
    SYNC_REQUEST_FIELDS,
    applySettingIfChanged,
    assertMarketSyncRequestBody,
    executeCopperPriceSync,
    executeMarketIndicatorsSync,
    normalizeMarketSnapshot,
    normalizeSyncTrigger,
};
