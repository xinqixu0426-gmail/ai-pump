const DEFAULT_PENDING_LIMIT_MS = 60_000;
const DEFAULT_RUNNING_LIMIT_MS = 120_000;

function elapsedMs(value, nowMs) {
    const timestamp = Date.parse(value || '');
    return Number.isFinite(timestamp) ? Math.max(0, nowMs - timestamp) : null;
}

function buildKnowledgeSyncHealth(options = {}) {
    const autoSync = options.autoSync || {};
    const history = options.history || { items: [], stats: {} };
    const pendingTotal = Math.max(0, Number(options.pendingTotal || 0));
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const pendingLimitMs = Number(options.pendingLimitMs || DEFAULT_PENDING_LIMIT_MS);
    const runningLimitMs = Number(options.runningLimitMs || DEFAULT_RUNNING_LIMIT_MS);
    const issues = [];

    if (!autoSync.enabled) {
        issues.push({
            code: 'auto_sync_disabled',
            severity: 'attention',
            title: '自动同步已关闭',
            message: '业务数据变化后不会自动刷新知识，需要恢复自动同步或使用手动同步。',
            action: 'manual_sync',
        });
    }

    const runningAgeMs = autoSync.running ? elapsedMs(autoSync.lastStartedAt, nowMs) : null;
    if (runningAgeMs !== null && runningAgeMs > runningLimitMs) {
        issues.push({
            code: 'sync_running_too_long',
            severity: 'critical',
            title: '同步运行时间过长',
            message: `本次同步已运行 ${Math.ceil(runningAgeMs / 1000)} 秒，可能已经卡住。`,
            action: 'manual_sync',
        });
    }

    const pendingAgeMs = autoSync.pending ? elapsedMs(autoSync.lastRequestedAt, nowMs) : null;
    if (pendingAgeMs !== null && pendingAgeMs > pendingLimitMs) {
        issues.push({
            code: 'sync_pending_too_long',
            severity: 'critical',
            title: '同步等待时间过长',
            message: `${autoSync.pendingCount || pendingTotal || 1} 个来源等待超过 ${Math.ceil(pendingAgeMs / 1000)} 秒。`,
            action: 'manual_sync',
        });
    }

    if (
        pendingTotal > 0
        && !autoSync.pending
        && !autoSync.running
        && !autoSync.retryScheduled
    ) {
        issues.push({
            code: 'unscheduled_changes',
            severity: 'critical',
            title: '存在未安排的知识更新',
            message: `检测到 ${pendingTotal} 条知识与业务来源不一致，但当前没有同步任务。`,
            action: 'manual_sync',
        });
    }

    if (autoSync.lastError) {
        issues.push({
            code: 'sync_failed',
            severity: Number(autoSync.consecutiveFailures || 0) >= 2 ? 'critical' : 'attention',
            title: autoSync.retryScheduled ? '自动同步失败，正在重试' : '自动同步失败',
            message: String(autoSync.lastError).slice(0, 500),
            action: 'manual_sync',
        });
    } else {
        const latestRun = history.items?.[0];
        if (
            latestRun?.status === 'failed'
            && !autoSync.pending
            && !autoSync.running
            && !autoSync.retryScheduled
        ) {
            issues.push({
                code: 'last_run_failed',
                severity: latestRun.attempt >= 2 ? 'critical' : 'attention',
                title: '最近一次同步失败',
                message: latestRun.errorText || '同步没有成功完成。',
                action: 'manual_sync',
            });
        }
    }

    const status = issues.some(issue => issue.severity === 'critical')
        ? 'critical'
        : issues.length > 0
            ? 'attention'
            : 'healthy';
    const summary = status === 'healthy'
        ? '知识同步运行正常'
        : status === 'critical'
            ? `${issues.length} 项知识同步异常需要处理`
            : `${issues.length} 项知识同步状态需要关注`;

    return {
        status,
        summary,
        issues,
        needsRecovery: issues.some(issue => issue.action === 'manual_sync'),
        pendingTotal,
        latestRun: history.items?.[0] || null,
        lastSuccessAt: history.stats?.lastSuccessAt || null,
        lastFailureAt: history.stats?.lastFailureAt || null,
        checkedAt: new Date(nowMs).toISOString(),
    };
}

module.exports = {
    DEFAULT_PENDING_LIMIT_MS,
    DEFAULT_RUNNING_LIMIT_MS,
    buildKnowledgeSyncHealth,
};
