const test = require('node:test');
const assert = require('node:assert/strict');
const {
    AUTO_SYNC_SOURCE_TABLES,
    createKnowledgeAutoSyncController,
} = require('../api/services/knowledgeAutoSync.cjs');

function createTimerHarness() {
    const callbacks = [];
    return {
        callbacks,
        setTimer(callback) {
            callbacks.push(callback);
            return { unref() {} };
        },
        clearTimer() {},
        runLatest() {
            const callback = callbacks.pop();
            if (callback) callback();
        },
    };
}

const silentLogger = {
    info() {},
    warn() {},
    error() {},
};

test('Knowledge V4：连续业务变更合并为一次自动增量同步', () => {
    const timers = createTimerHarness();
    let syncCount = 0;
    const controller = createKnowledgeAutoSyncController({
        enabled: true,
        delayMs: 300,
        retryDelaysMs: [],
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        logger: silentLogger,
        syncKnowledge() {
            syncCount += 1;
            return {
                ftsEnabled: true,
                stats: { total: 12, inserted: 1, updated: 2, unchanged: 9, deleted: 0 },
            };
        },
    });

    assert.equal(controller.request({ sourceTable: 'parts', sourceId: 1 }), true);
    assert.equal(controller.request({ sourceTable: 'parts', sourceId: 1 }), true);
    assert.equal(controller.request({ sourceTable: 'recipes', sourceId: 2 }), true);
    assert.equal(controller.request({ sourceTable: 'audit_log', sourceId: 3 }), false);
    assert.equal(controller.getStatus().pendingCount, 2);

    const result = controller.flush();
    assert.equal(result.success, true);
    assert.equal(syncCount, 1);
    assert.equal(controller.getStatus().pending, false);
    assert.equal(controller.getStatus().lastResult.updated, 2);
    assert.equal(controller.getStatus().lastResult.ftsEnabled, true);
    controller.dispose();
});

test('Knowledge V4：自动同步失败后保留来源并按计划重试', () => {
    const timers = createTimerHarness();
    let syncCount = 0;
    const controller = createKnowledgeAutoSyncController({
        enabled: true,
        delayMs: 0,
        retryDelaysMs: [10],
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        logger: silentLogger,
        syncKnowledge() {
            syncCount += 1;
            if (syncCount === 1) throw new Error('模拟同步失败');
            return {
                ftsEnabled: false,
                stats: { total: 8, inserted: 0, updated: 1, unchanged: 7, deleted: 0 },
            };
        },
    });

    controller.request({ sourceTable: 'customers', sourceId: 5 });
    const failed = controller.flush();
    assert.equal(failed.success, false);
    assert.equal(controller.getStatus().pending, true);
    assert.equal(controller.getStatus().retryScheduled, true);
    assert.equal(controller.getStatus().consecutiveFailures, 1);
    assert.match(controller.getStatus().lastError, /模拟同步失败/);

    timers.runLatest();
    assert.equal(syncCount, 2);
    assert.equal(controller.getStatus().pending, false);
    assert.equal(controller.getStatus().lastError, '');
    assert.equal(controller.getStatus().consecutiveFailures, 0);
    controller.dispose();
});

test('Knowledge V4：自动同步覆盖全部核心知识来源', () => {
    for (const sourceTable of [
        'parts',
        'pump_shell_templates',
        'recipes',
        'recipe_technical_files',
        'coils',
        'stator_variants',
        'customers',
        'quotations',
        'orders',
        'system_settings',
    ]) {
        assert.equal(AUTO_SYNC_SOURCE_TABLES.has(sourceTable), true, sourceTable);
    }
    assert.equal(AUTO_SYNC_SOURCE_TABLES.has('knowledge_entries'), false);
    assert.equal(AUTO_SYNC_SOURCE_TABLES.has('audit_log'), false);
});
