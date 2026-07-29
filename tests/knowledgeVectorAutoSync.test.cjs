const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createKnowledgeVectorAutoSyncController,
} = require('../api/services/knowledgeVectorAutoSync.cjs');

const silentLogger = {
    info() {},
    warn() {},
    error() {},
};

test('Knowledge V6.2：后台向量任务合并请求并保存成功统计', async () => {
    const runs = [];
    let syncCount = 0;
    const controller = createKnowledgeVectorAutoSyncController({
        enabled: true,
        logger: silentLogger,
        retryDelaysMs: [],
        recordRun(input) {
            runs.push(input);
        },
        async syncVectors(input) {
            syncCount += 1;
            assert.equal(input.cascadeDeleted, 2);
            return {
                model: 'test/e5',
                dimensions: 3,
                stats: {
                    total: 10,
                    inserted: 2,
                    updated: 1,
                    unchanged: 7,
                    deleted: 2,
                    failed: 0,
                    pending: 0,
                },
            };
        },
    });

    controller.request({ reason: 'parts', deletedCount: 1 });
    controller.request({ reason: 'recipes', deletedCount: 1 });
    const result = await controller.flush();

    assert.equal(result.success, true);
    assert.equal(syncCount, 1);
    assert.equal(controller.getStatus().pending, false);
    assert.equal(controller.getStatus().lastResult.inserted, 2);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'success');
    controller.dispose();
});

test('Knowledge V6.2：部分失败保持待重试且历史写入失败不反向破坏结果', async () => {
    let syncCount = 0;
    const controller = createKnowledgeVectorAutoSyncController({
        enabled: true,
        logger: silentLogger,
        retryDelaysMs: [],
        model: () => 'test/e5',
        dimensions: () => 3,
        recordRun() {
            throw new Error('历史表暂不可写');
        },
        async syncVectors() {
            syncCount += 1;
            if (syncCount === 1) {
                const error = new Error('模型暂不可用');
                error.stats = {
                    total: 10,
                    inserted: 4,
                    updated: 0,
                    unchanged: 0,
                    deleted: 0,
                    failed: 6,
                    pending: 6,
                };
                throw error;
            }
            return {
                model: 'test/e5',
                dimensions: 3,
                stats: {
                    total: 10,
                    inserted: 6,
                    updated: 0,
                    unchanged: 4,
                    deleted: 0,
                    failed: 0,
                    pending: 0,
                },
            };
        },
    });

    controller.request({ reason: 'knowledge_sync' });
    const failed = await controller.flush();
    assert.equal(failed.success, false);
    assert.equal(controller.getStatus().pending, true);
    assert.equal(controller.getStatus().lastResult.pending, 6);

    const recovered = await controller.flush();
    assert.equal(recovered.success, true);
    assert.equal(controller.getStatus().pending, false);
    assert.equal(controller.getStatus().lastError, '');
    controller.dispose();
});
