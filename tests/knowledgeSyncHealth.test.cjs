const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildKnowledgeSyncHealth,
} = require('../api/services/knowledgeSyncHealth.cjs');

const NOW = Date.parse('2026-07-28T12:00:00.000Z');

function healthyAutoSync(overrides = {}) {
    return {
        enabled: true,
        running: false,
        pending: false,
        pendingCount: 0,
        retryScheduled: false,
        consecutiveFailures: 0,
        lastError: '',
        ...overrides,
    };
}

test('Knowledge V4：没有业务变化时不因长时间未同步产生假告警', () => {
    const health = buildKnowledgeSyncHealth({
        autoSync: healthyAutoSync(),
        pendingTotal: 0,
        nowMs: NOW,
        history: {
            items: [{
                status: 'success',
                completedAt: '2026-07-01T00:00:00.000Z',
            }],
            stats: {
                lastSuccessAt: '2026-07-01T00:00:00.000Z',
                lastFailureAt: null,
            },
        },
    });

    assert.equal(health.status, 'healthy');
    assert.equal(health.issues.length, 0);
    assert.equal(health.needsRecovery, false);
});

test('Knowledge V4：未安排的待同步数据产生严重告警', () => {
    const health = buildKnowledgeSyncHealth({
        autoSync: healthyAutoSync(),
        pendingTotal: 3,
        nowMs: NOW,
        history: { items: [], stats: {} },
    });

    assert.equal(health.status, 'critical');
    assert.equal(health.needsRecovery, true);
    assert.equal(health.issues[0].code, 'unscheduled_changes');
    assert.match(health.issues[0].message, /3 条/);
});

test('Knowledge V4：等待和运行超时均可识别', () => {
    const pending = buildKnowledgeSyncHealth({
        autoSync: healthyAutoSync({
            pending: true,
            pendingCount: 2,
            lastRequestedAt: '2026-07-28T11:58:00.000Z',
        }),
        nowMs: NOW,
        history: { items: [], stats: {} },
    });
    const running = buildKnowledgeSyncHealth({
        autoSync: healthyAutoSync({
            running: true,
            lastStartedAt: '2026-07-28T11:57:00.000Z',
        }),
        nowMs: NOW,
        history: { items: [], stats: {} },
    });

    assert.equal(pending.issues[0].code, 'sync_pending_too_long');
    assert.equal(running.issues[0].code, 'sync_running_too_long');
});

test('Knowledge V4：连续失败升级严重度，成功记录恢复健康', () => {
    const failed = buildKnowledgeSyncHealth({
        autoSync: healthyAutoSync({
            lastError: 'FTS 写入失败',
            consecutiveFailures: 2,
            retryScheduled: true,
        }),
        nowMs: NOW,
        history: { items: [], stats: {} },
    });
    const recovered = buildKnowledgeSyncHealth({
        autoSync: healthyAutoSync(),
        nowMs: NOW,
        history: {
            items: [{ status: 'success', attempt: 3 }],
            stats: { lastSuccessAt: '2026-07-28T11:59:00.000Z' },
        },
    });

    assert.equal(failed.status, 'critical');
    assert.equal(failed.issues[0].code, 'sync_failed');
    assert.equal(recovered.status, 'healthy');
});

test('Knowledge V4：关闭自动同步时提示关注但不伪装为系统故障', () => {
    const health = buildKnowledgeSyncHealth({
        autoSync: healthyAutoSync({ enabled: false }),
        nowMs: NOW,
        history: { items: [], stats: {} },
    });

    assert.equal(health.status, 'attention');
    assert.equal(health.issues[0].code, 'auto_sync_disabled');
});
