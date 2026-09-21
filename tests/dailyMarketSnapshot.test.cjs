const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createDailyMarketSnapshot } = require('../api/services/dailyMarketSnapshot.cjs');
const { bjtDateKey, createMarketSyncService } = require('../api/services/marketSync.cjs');

function fixture(t, fetchSnapshot) {
    const db = new Database(':memory:');
    t.after(() => db.close());
    db.exec('CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
    let writes = 0;
    const dependencies = {
        db,
        getSetting: key => db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key)?.value || null,
        setSetting: (key, value) => {
            writes += 1;
            db.prepare('INSERT OR REPLACE INTO system_settings VALUES (?, ?, ?)').run(key, value, new Date().toISOString());
        },
        dateKey: bjtDateKey,
        fetchSnapshot,
    };
    return { dependencies, cache: createDailyMarketSnapshot(dependencies), writes: () => writes };
}

function snapshot(now) {
    return {
        copperPricePerTon: 105270, aluminumPricePerTon: 22120,
        usdCnyRate: 7.2345, fetchedAt: new Date(now).toISOString(),
        sources: { copper: 'test-copper', aluminum: 'test-aluminum', exchangeRate: 'test-rate' },
    };
}

test('每日行情查询无缓存时立即失败，不抓取、不写库', t => {
    let calls = 0;
    const f = fixture(t, async now => { calls += 1; return snapshot(now); });
    assert.throws(() => f.cache.requireSnapshot(), error => error.code === 'market_snapshot_unavailable' && error.statusCode === 503);
    assert.equal(calls, 0);
    assert.equal(f.writes(), 0);
});

test('每日行情合并并发，跨服务实例重启仍不重复抓取，查询严格只读', async t => {
    let calls = 0;
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const f = fixture(t, async now => { calls += 1; await blocked; return snapshot(now); });
    const now = new Date('2026-09-16T02:00:00Z');
    const first = f.cache.refresh(now);
    const second = f.cache.refresh(now);
    const restartedDuringFetch = createDailyMarketSnapshot(f.dependencies);
    await restartedDuringFetch.refresh(now);
    assert.equal(calls, 1);
    release();
    await Promise.all([first, second]);
    const restarted = createDailyMarketSnapshot(f.dependencies);
    await restarted.refresh(now);
    assert.equal(calls, 1);
    const before = f.writes();
    assert.equal(restarted.requireSnapshot(now).stale, false);
    assert.equal(restarted.requireSnapshot(now).snapshot.copperPricePerTon, 105270);
    assert.equal(f.writes(), before);
});

test('每日行情跨北京日期更新，失败保留旧值，当天不重试且拒绝旧值改价', async t => {
    let calls = 0;
    let fail = false;
    const f = fixture(t, async now => {
        calls += 1;
        if (fail) throw new Error('upstream unavailable');
        return snapshot(now);
    });
    await f.cache.refresh(new Date('2026-09-15T15:59:59Z'));
    fail = true;
    const nextDay = new Date('2026-09-15T16:00:00Z');
    await assert.rejects(f.cache.refresh(nextDay), /upstream unavailable/);
    const state = f.cache.requireSnapshot(nextDay);
    assert.equal(state.stale, true);
    assert.equal(state.status, 'failed');
    assert.equal(state.changedCount, 0);
    assert.ok(state.runId && state.startedAt && state.completedAt && state.lastError);
    assert.equal(state.snapshot.fetchedAt, '2026-09-15T15:59:59.000Z');
    await createDailyMarketSnapshot(f.dependencies).refresh(nextDay);
    assert.equal(calls, 2);
    assert.throws(() => f.cache.requireSnapshot(nextDay, true), error => error.code === 'market_snapshot_unavailable');
    fail = false;
    const followingDay = new Date('2026-09-16T16:00:00Z');
    await f.cache.refresh(followingDay);
    assert.equal(calls, 3);
    assert.equal(f.cache.requireSnapshot(followingDay).stale, false);
    assert.equal(f.cache.read().lastError, null);
});

test('铜价和指标 GET 共享快照且不访问外部，过期同步拒绝且不写正式数据', async t => {
    const f = fixture(t, async now => snapshot(now));
    const today = new Date('2026-09-16T02:00:00Z');
    await f.cache.refresh(today);
    let externalCalls = 0;
    const service = createMarketSyncService({
        ...f.dependencies,
        now: () => today,
        dbGetAllCoils: () => [{ copperBase: 100, UpdatedAt: '2026-09-15T01:00:00Z' }],
        fetchWithPolicy: async () => { externalCalls += 1; throw new Error('unexpected fetch'); },
    });
    const before = f.writes();
    assert.equal((await service.getCopperPrice()).livePrice, 105270);
    const indicators = await service.getMarketIndicators();
    assert.equal(indicators.copper.dbPrice, 100);
    assert.equal(indicators.exchangeRate.liveRate, '7.2345');
    assert.equal(indicators.asOf, '2026-09-16T02:00:00.000Z');
    assert.equal(indicators.stale, false);
    assert.equal(externalCalls, 0);
    assert.equal(f.writes(), before);
    const tomorrow = new Date('2026-09-17T02:00:00Z');
    await assert.rejects(service.syncMarketIndicators({ now: tomorrow }));
    const afterFailure = f.writes();
    await assert.rejects(service.syncCopperPrice({ now: tomorrow }), error => error.code === 'market_snapshot_unavailable');
    assert.equal(f.writes(), afterFailure);
    assert.equal(externalCalls, 3);
});

test('线圈加载与行情加载、错误和请求序号独立', () => {
    const source = fs.readFileSync(path.join(__dirname, '../apps/web-next/components/coils-view.tsx'), 'utf8');
    const start = source.indexOf('async function load(');
    const load = source.slice(start, source.indexOf('useEffect(() =>', start));
    assert.match(load, /await getAllCoils\(\)/);
    assert.doesNotMatch(load, /getMarketIndicators|setMarketIndicators|Promise\.all/);
    assert.match(source, /void load\(\);\s+void refreshMarketIndicators\(\);/);
    assert.match(source, /setMarketError\(err instanceof Error/);
    assert.match(source, /sequence === marketLoadSequence\.current/);
    assert.match(source, /sequence !== coilLoadSequence\.current/);
    assert.match(source, /非今日行情/);
});
