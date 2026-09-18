const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../apps/web-next/node_modules/typescript');

function load(name) {
    const loaded = {};
    new Function('exports', ts.transpileModule(fs.readFileSync(`apps/web-next/lib/${name}.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText)(loaded);
    return loaded;
}
const { createResourceRefreshGuard } = load('resource-refresh-guard');
const { createRevisionRefresh } = load('revision-refresh');

test('编辑中不读取目录，关闭编辑器后未确认的相同版本仍会补刷', async () => {
    let editing = true;
    let reads = 0;
    const guard = createResourceRefreshGuard(() => editing);
    const monitor = createRevisionRefresh(async () => 'unchanged-revision');
    monitor.subscribe(async () => {
        const request = guard.begin(true);
        if (!request) return false;
        reads += 1;
        return guard.canApply(request);
    });
    await monitor.tick();
    await monitor.tick();
    assert.equal(reads, 0);
    editing = false;
    await monitor.tick();
    await monitor.tick();
    assert.equal(reads, 1);
});

test('后台读取期间打开编辑器保留草稿；关闭后重新读取而非应用旧响应', async () => {
    let editing = false;
    let release;
    let reads = 0;
    let applied = 'draft';
    const guard = createResourceRefreshGuard(() => editing);
    const monitor = createRevisionRefresh(async () => 'same');
    monitor.subscribe(async () => {
        const request = guard.begin(true);
        if (!request) return false;
        const value = ++reads;
        if (value === 1) await new Promise(resolve => { release = resolve; });
        if (!guard.canApply(request)) return false;
        applied = value;
        return true;
    });
    const pending = monitor.tick();
    await Promise.resolve();
    editing = true;
    release();
    await pending;
    assert.equal(applied, 'draft');
    editing = false;
    await monitor.tick();
    assert.equal(applied, 2);
});

test('手动保存后的回读胜过后台旧请求，卸载后拒绝所有迟到结果', () => {
    let editing = false;
    const guard = createResourceRefreshGuard(() => editing);
    const background = guard.begin(true);
    editing = true;
    const afterSave = guard.begin(false);
    assert.equal(guard.canApply(background), false);
    assert.equal(guard.isLatest(background), false);
    assert.equal(guard.canApply(afterSave), true);
    assert.equal(guard.begin(true), null);
    assert.equal(guard.isLatest(afterSave), true);
    guard.invalidate();
    assert.equal(guard.canApply(afterSave), false);
    editing = false;
    assert.equal(guard.canApply(guard.begin(true)), true);
});
