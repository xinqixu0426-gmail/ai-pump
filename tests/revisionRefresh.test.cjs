const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../apps/web-next/node_modules/typescript');
const loaded = {};
new Function('exports', ts.transpileModule(fs.readFileSync('apps/web-next/lib/revision-refresh.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(loaded);
const { createRevisionRefresh } = loaded;

test('断线恢复后即使版本相同也重新读取资源', async () => {
    let offline = false;
    let calls = 0;
    const monitor = createRevisionRefresh(async () => { if (offline) throw new Error('offline'); return 'same'; });
    monitor.subscribe(async () => { calls += 1; });
    await monitor.tick();
    offline = true;
    await monitor.tick();
    offline = false;
    await monitor.tick();
    assert.equal(calls, 2);
});

test('首次先读版本再刷新，稳定版本不重复刷新；版本变化与恢复前台均重查', async () => {
    let revision = '1:op';
    let calls = 0;
    const monitor = createRevisionRefresh(async () => revision);
    const unsubscribe = monitor.subscribe(async () => { calls += 1; });
    await monitor.tick();
    await monitor.tick();
    assert.equal(calls, 1);
    revision = '2:next';
    await monitor.tick();
    assert.equal(calls, 2);
    monitor.invalidate();
    await monitor.tick();
    assert.equal(calls, 3);
    revision = '1:restored';
    await monitor.tick();
    assert.equal(calls, 4);
    unsubscribe();
    await monitor.tick();
    assert.equal(calls, 4);
});

test('失败的版本读取和单个刷新都重试，其他订阅者不重复加载', async () => {
    let readFailure = true;
    let attempts = 0;
    let good = 0;
    const monitor = createRevisionRefresh(async () => { if (readFailure) throw new Error('offline'); return 'r'; });
    monitor.subscribe(async () => { good += 1; });
    monitor.subscribe(async () => { attempts += 1; return attempts > 1; });
    await monitor.tick();
    assert.equal(good, 0);
    readFailure = false;
    await monitor.tick();
    await monitor.tick();
    assert.equal(good, 1);
    assert.equal(attempts, 2);
});

test('并发检查合并，读取过程中失效不能被旧响应确认', async () => {
    let release;
    let reads = 0;
    let refreshes = 0;
    const monitor = createRevisionRefresh(async () => { reads += 1; return 'r'; });
    monitor.subscribe(async () => { refreshes += 1; if (refreshes === 1) await new Promise(resolve => { release = resolve; }); });
    const first = monitor.tick();
    await Promise.resolve();
    const second = monitor.tick();
    assert.equal(reads, 1);
    monitor.invalidate();
    release();
    await Promise.all([first, second]);
    await monitor.tick();
    assert.equal(refreshes, 2);
});
