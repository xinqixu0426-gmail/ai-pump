const crypto = require('node:crypto');
const {
    COPPER_SYNC_CAPABILITY_ID,
    INDICATOR_SYNC_CAPABILITY_ID,
    executeCopperPriceSync,
    executeMarketIndicatorsSync,
} = require('./marketIndicatorCommands.cjs');
const {
    fetchCopperPrice,
    fetchMarketSnapshot,
    MARKET_SOURCES,
} = require('./marketData.cjs');

const PROCESS_RUN_ID = crypto.randomUUID();

function bjtDateKey(now = new Date()) {
    return new Date(
        new Date(now).getTime() + 8 * 60 * 60 * 1000
    ).toISOString().slice(0, 10);
}

function systemCommandContext(capabilityId, trigger, now = new Date()) {
    const stableWindow = trigger === 'scheduled'
        ? bjtDateKey(now)
        : trigger === 'startup'
            ? PROCESS_RUN_ID
            : crypto.randomUUID();
    return {
        actorKey: 'system:market-sync',
        capabilityId,
        idempotencyKey:
            `market:${capabilityId}:${trigger}:${stableWindow}`,
        operationId: crypto.randomUUID(),
        requestId: null,
        warnings: [],
    };
}

function settingValue(getSetting, key) {
    const value = Number(getSetting(key));
    return Number.isFinite(value) && value > 0
        ? value.toFixed(key === 'usd_cny_rate' ? 4 : 2)
        : '';
}

function createMarketSyncService(dependencies) {
    const commandDependencies = {
        db: dependencies.db,
        safeUpdate: dependencies.safeUpdate,
        setSetting: dependencies.setSetting,
    };

    async function getCopperPrice() {
        const price = await fetchCopperPrice(
            dependencies.fetchWithPolicy
        );
        const coils = dependencies.dbGetAllCoils();
        return {
            livePrice: price,
            livePricePerKg: (price / 1000).toFixed(2),
            dbPrice: coils.length > 0 ? coils[0].copperBase : null,
            lastUpdate: coils[0]?.UpdatedAt || null,
            sourceOfTruth: 'externalCopperMarket+coils.copper_base',
            source: MARKET_SOURCES.copper,
            asOf: new Date().toISOString(),
        };
    }

    async function getMarketIndicators() {
        const snapshot = await fetchMarketSnapshot(
            dependencies.fetchWithPolicy
        );
        const coils = dependencies.dbGetAllCoils();
        const dbCopperPrice =
            coils.length > 0 ? coils[0].copperBase : null;
        const settingUpdatedAt = (key) => dependencies.db.prepare(
            'SELECT updated_at FROM system_settings WHERE key = ?'
        ).get(key)?.updated_at || null;
        return {
            copper: {
                livePrice: snapshot.copperPricePerTon,
                livePricePerKg:
                    (snapshot.copperPricePerTon / 1000).toFixed(2),
                dbPrice: dbCopperPrice,
                lastUpdate: coils[0]?.UpdatedAt || null,
            },
            aluminum: {
                livePrice: snapshot.aluminumPricePerTon,
                livePricePerKg:
                    (snapshot.aluminumPricePerTon / 1000).toFixed(2),
                dbPrice: settingValue(
                    dependencies.getSetting,
                    'aluminum_wire_price_per_kg'
                ),
                lastUpdate: settingUpdatedAt(
                    'aluminum_wire_price_per_kg'
                ),
            },
            exchangeRate: {
                base: 'USD',
                quote: 'CNY',
                liveRate: snapshot.usdCnyRate.toFixed(4),
                dbRate: settingValue(
                    dependencies.getSetting,
                    'usd_cny_rate'
                ),
                lastUpdate: settingUpdatedAt('usd_cny_rate'),
                sourceDate: snapshot.exchangeRateSourceDate,
            },
            fetchedAt: snapshot.fetchedAt,
            asOf: snapshot.fetchedAt,
            sourceOfTruth:
                'externalMetalAndExchangeMarkets+coils+system_settings',
            sources: snapshot.sources,
        };
    }

    async function syncCopperPrice({
        commandContext,
        trigger = 'manual',
        now = new Date(),
    } = {}) {
        const snapshot = {
            copperPricePerTon: await fetchCopperPrice(
                dependencies.fetchWithPolicy
            ),
            fetchedAt: new Date(now).toISOString(),
            sources: {
                copper: MARKET_SOURCES.copper,
            },
        };
        const context = commandContext || systemCommandContext(
            COPPER_SYNC_CAPABILITY_ID,
            trigger,
            now
        );
        const result = executeCopperPriceSync(
            commandDependencies,
            snapshot,
            { trigger },
            context
        );
        dependencies.logger?.info('铜价同步完成', {
            operationId: result.operationId,
            updatedCount: result.updatedCount,
            idempotentReplay: result.idempotentReplay,
            trigger,
        });
        return result;
    }

    async function syncMarketIndicators({
        commandContext,
        trigger = 'manual',
        now = new Date(),
    } = {}) {
        const snapshot = await fetchMarketSnapshot(
            dependencies.fetchWithPolicy,
            now
        );
        const context = commandContext || systemCommandContext(
            INDICATOR_SYNC_CAPABILITY_ID,
            trigger,
            now
        );
        const result = executeMarketIndicatorsSync(
            commandDependencies,
            snapshot,
            { trigger },
            context
        );
        dependencies.logger?.info('市场指标同步完成', {
            operationId: result.operationId,
            updatedCount: result.updatedCount,
            aluminumPricePerKg: result.aluminumPricePerKg,
            usdCnyRate: result.usdCnyRate,
            idempotentReplay: result.idempotentReplay,
            trigger,
        });
        return result;
    }

    async function runCopperPriceUpdate(options = {}) {
        try {
            return await syncCopperPrice({
                trigger: options.trigger || 'startup',
                now: options.now || new Date(),
                commandContext: options.commandContext,
            });
        } catch (error) {
            dependencies.logger?.error(`铜价同步失败: ${error.message}`, {
                code: error.code,
                trigger: options.trigger || 'startup',
            });
            return null;
        }
    }

    return {
        getCopperPrice,
        getMarketIndicators,
        runCopperPriceUpdate,
        syncCopperPrice,
        syncMarketIndicators,
    };
}

module.exports = {
    bjtDateKey,
    createMarketSyncService,
    PROCESS_RUN_ID,
    settingValue,
    systemCommandContext,
};
