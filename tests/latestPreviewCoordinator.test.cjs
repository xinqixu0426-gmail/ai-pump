const test = require('node:test');
const assert = require('node:assert/strict');
const { createLatestPreviewCoordinator } = require('../apps/web-next/lib/latest-preview.cjs');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, reject, resolve };
}

test('latest preview coordinator 只应用逆序完成中的最新成功结果', async () => {
    const coordinator = createLatestPreviewCoordinator();
    const first = deferred();
    const second = deferred();
    const applied = [];
    const settled = [];
    const handlers = {
        onSuccess: value => applied.push(value),
        onError: error => applied.push(error.message),
        onSettled: () => settled.push('settled'),
    };

    const firstRun = coordinator.run('item-1', () => first.promise, handlers);
    const secondRun = coordinator.run('item-1', () => second.promise, handlers);
    second.resolve('latest');
    assert.equal(await secondRun, true);
    first.resolve('stale');
    assert.equal(await firstRun, false);

    assert.deepEqual(applied, ['latest']);
    assert.deepEqual(settled, ['settled']);
});

test('latest preview coordinator 忽略旧请求失败且不回滚最新成功状态', async () => {
    const coordinator = createLatestPreviewCoordinator();
    const stale = deferred();
    const latest = deferred();
    const state = { value: 'initial', error: null };
    const handlers = {
        onSuccess: value => { state.value = value; },
        onError: error => { state.error = error.message; },
    };

    const staleRun = coordinator.run('item-1', () => stale.promise, handlers);
    const latestRun = coordinator.run('item-1', () => latest.promise, handlers);
    latest.resolve('latest');
    await latestRun;
    stale.reject(new Error('stale failure'));
    assert.equal(await staleRun, false);

    assert.deepEqual(state, { value: 'latest', error: null });
});

test('latest preview coordinator 清空后不会让旧请求与新请求发生序号碰撞', async () => {
    const coordinator = createLatestPreviewCoordinator();
    const stale = deferred();
    const latest = deferred();
    const applied = [];
    const handlers = {
        onSuccess: value => applied.push(value),
        onError: error => applied.push(error.message),
    };

    const staleRun = coordinator.run('item-1', () => stale.promise, handlers);
    coordinator.clear();
    const latestRun = coordinator.run('item-1', () => latest.promise, handlers);
    latest.resolve('after-reset');
    assert.equal(await latestRun, true);
    stale.resolve('before-reset');
    assert.equal(await staleRun, false);

    assert.deepEqual(applied, ['after-reset']);
});
