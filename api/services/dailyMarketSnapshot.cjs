const crypto = require('node:crypto');
const { CommandExecutionError } = require('./commandExecution.cjs');
const { normalizeMarketSnapshot } = require('./marketIndicatorCommands.cjs');

const MARKET_CACHE_KEY = 'market_snapshot_daily_cache';

function createDailyMarketSnapshot({ db, getSetting, setSetting, fetchSnapshot, dateKey }) {
    let inFlight = null;
    function read() {
        try {
            const state = JSON.parse(getSetting(MARKET_CACHE_KEY) || '{}');
            if (state.snapshot) {
                normalizeMarketSnapshot(state.snapshot, { requireAll: true });
                if (!Number.isFinite(new Date(state.snapshot.fetchedAt).getTime())) throw new Error('invalid snapshot time');
            }
            return state;
        } catch {
            return {};
        }
    }

    function save(state) {
        setSetting(MARKET_CACHE_KEY, JSON.stringify(state), {
            actorKey: 'system:market-cache',
            capabilityId: 'market.sync_copper_price',
            operationId: state.runId,
            requireAudit: true,
        });
    }

    async function refresh(now = new Date()) {
        if (inFlight) return inFlight;
        const today = dateKey(now);
        const claim = db.transaction(() => {
            const previous = read();
            if (previous.lastAttemptDate === today) return null;
            const state = {
                ...previous,
                runId: crypto.randomUUID(),
                lastAttemptDate: today,
                startedAt: new Date(now).toISOString(),
                completedAt: null,
                status: 'running',
                changedCount: 0,
                lastError: null,
            };
            save(state);
            return state;
        })();
        if (!claim) return read();
        inFlight = Promise.resolve().then(async () => {
            try {
                const snapshot = await fetchSnapshot(now);
                normalizeMarketSnapshot(snapshot, { requireAll: true });
                if (!Number.isFinite(new Date(snapshot.fetchedAt).getTime())) throw new Error('invalid snapshot time');
                const state = {
                    ...claim, snapshot, status: 'completed', changedCount: 1,
                    completedAt: new Date().toISOString(),
                };
                db.transaction(() => save(state))();
                return state;
            } catch (error) {
                db.transaction(() => save({
                    ...claim, status: 'failed', completedAt: new Date().toISOString(),
                    lastError: '今日行情获取失败，等待下一日更新',
                }))();
                throw error;
            } finally {
                inFlight = null;
            }
        });
        return inFlight;
    }

    function requireSnapshot(now = new Date(), requireToday = false) {
        const state = read();
        if (!state.snapshot || (requireToday && dateKey(state.snapshot.fetchedAt) !== dateKey(now))) {
            throw new CommandExecutionError(
                'market_snapshot_unavailable',
                state.lastError || '今日行情尚未就绪，请等待每日行情更新',
                503
            );
        }
        return {
            ...state,
            stale: dateKey(state.snapshot.fetchedAt) !== dateKey(now),
        };
    }

    return { read, refresh, requireSnapshot };
}

module.exports = { MARKET_CACHE_KEY, createDailyMarketSnapshot };
