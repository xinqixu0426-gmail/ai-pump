const { createLogger } = require('../logger.cjs');
const { buildManagementExecutionQueue } = require('./managementExecutionQueue.cjs');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const VALID_STATUSES = new Set(['active', 'resolved']);

function loadDbAccessors() {
    return require('../db.cjs');
}

function parseObject(value) {
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function lifecycleSnapshot(item) {
    return {
        id: String(item?.id || '').trim(),
        priority: String(item?.priority || 'low').trim(),
        category: String(item?.category || '').trim(),
        categoryLabel: String(item?.categoryLabel || '').trim(),
        title: String(item?.title || '').trim(),
        detail: String(item?.detail || '').trim(),
        action: String(item?.action || '').trim(),
        owner: String(item?.owner || '').trim(),
        path: String(item?.path || '').trim(),
        count: Math.max(1, Number(item?.count) || 1),
        entityType: String(item?.entityType || '').trim(),
        entityId: String(item?.entityId || '').trim(),
        sourceType: String(item?.sourceType || '').trim(),
        resolution: item?.resolution && typeof item.resolution === 'object'
            ? item.resolution
            : null,
    };
}

function snapshotJson(item) {
    return JSON.stringify(lifecycleSnapshot(item));
}

function lifecycleResponse(row, rowAdapter) {
    const lifecycle = rowAdapter(row);
    const { snapshotJson: rawSnapshotJson, ...publicLifecycle } = lifecycle;
    return {
        ...publicLifecycle,
        snapshot: parseObject(rawSnapshotJson),
    };
}

function syncManagementActionLifecycles(options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const {
        db,
        safeInsert,
        safeUpdate,
    } = dbAccessors;
    const now = (options.now || new Date()).toISOString();
    const currentItems = options.items || require('./managementActionCenter.cjs')
        .buildManagementActionCenter({ now: new Date(now) }).items;
    const currentByKey = new Map(
        currentItems
            .map(item => [String(item?.id || '').trim(), item])
            .filter(([key]) => key)
    );
    const stats = {
        observed: currentByKey.size,
        appeared: 0,
        updated: 0,
        resolved: 0,
        reopened: 0,
        unchanged: 0,
    };

    const reconcile = db.transaction(() => {
        const existingRows = db.prepare(
            'SELECT * FROM management_action_lifecycles ORDER BY id'
        ).all();
        const existingByKey = new Map(existingRows.map(row => [row.action_key, row]));

        for (const [actionKey, item] of currentByKey) {
            const existing = existingByKey.get(actionKey);
            const nextSnapshotJson = snapshotJson(item);
            if (!existing) {
                const info = safeInsert('management_action_lifecycles', {
                    action_key: actionKey,
                    status: 'active',
                    category: item.category,
                    source_type: item.sourceType,
                    entity_type: item.entityType,
                    entity_id: item.entityId,
                    title: item.title,
                    priority: item.priority,
                    occurrence_count: 1,
                    first_seen_at: now,
                    active_since: now,
                    resolved_at: null,
                    last_reopened_at: null,
                    snapshot_json: nextSnapshotJson,
                    created_at: now,
                    updated_at: now,
                });
                safeInsert('management_action_events', {
                    lifecycle_id: Number(info.lastInsertRowid),
                    event_type: 'appeared',
                    occurred_at: now,
                    snapshot_json: nextSnapshotJson,
                    created_at: now,
                });
                stats.appeared += 1;
                continue;
            }

            if (existing.status === 'resolved') {
                safeUpdate('management_action_lifecycles', existing.id, {
                    status: 'active',
                    category: item.category,
                    source_type: item.sourceType,
                    entity_type: item.entityType,
                    entity_id: item.entityId,
                    title: item.title,
                    priority: item.priority,
                    occurrence_count: Number(existing.occurrence_count || 0) + 1,
                    active_since: now,
                    resolved_at: null,
                    last_reopened_at: now,
                    snapshot_json: nextSnapshotJson,
                });
                safeInsert('management_action_events', {
                    lifecycle_id: existing.id,
                    event_type: 'reopened',
                    occurred_at: now,
                    snapshot_json: nextSnapshotJson,
                    created_at: now,
                });
                stats.reopened += 1;
                continue;
            }

            if (existing.snapshot_json !== nextSnapshotJson) {
                safeUpdate('management_action_lifecycles', existing.id, {
                    category: item.category,
                    source_type: item.sourceType,
                    entity_type: item.entityType,
                    entity_id: item.entityId,
                    title: item.title,
                    priority: item.priority,
                    snapshot_json: nextSnapshotJson,
                });
                stats.updated += 1;
            } else {
                stats.unchanged += 1;
            }
        }

        for (const existing of existingRows) {
            if (existing.status !== 'active' || currentByKey.has(existing.action_key)) continue;
            safeUpdate('management_action_lifecycles', existing.id, {
                status: 'resolved',
                resolved_at: now,
            });
            safeInsert('management_action_events', {
                lifecycle_id: existing.id,
                event_type: 'resolved',
                occurred_at: now,
                snapshot_json: existing.snapshot_json,
                created_at: now,
            });
            stats.resolved += 1;
        }
    });
    reconcile.immediate();

    return {
        syncedAt: now,
        stats,
        active: db.prepare(
            "SELECT COUNT(*) AS count FROM management_action_lifecycles WHERE status = 'active'"
        ).get().count,
    };
}

function listManagementActionLifecycles(params = {}, options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db, managementActionLifecycleRow } = dbAccessors;
    const status = VALID_STATUSES.has(params.status) ? params.status : '';
    const requestedLimit = Number(params.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 20;
    const rows = status
        ? db.prepare(`
            SELECT * FROM management_action_lifecycles
            WHERE status = ?
            ORDER BY updated_at DESC, id DESC
            LIMIT ?
        `).all(status, limit)
        : db.prepare(`
            SELECT * FROM management_action_lifecycles
            ORDER BY updated_at DESC, id DESC
            LIMIT ?
        `).all(limit);
    return rows.map(row => lifecycleResponse(row, managementActionLifecycleRow));
}

function lifecycleOverview(options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db } = dbAccessors;
    const aggregate = db.prepare(`
        SELECT
            COUNT(*) AS total_count,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
            SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
            SUM(CASE WHEN occurrence_count > 1 THEN 1 ELSE 0 END) AS reopened_count
        FROM management_action_lifecycles
    `).get();
    return {
        totalCount: Number(aggregate.total_count || 0),
        activeCount: Number(aggregate.active_count || 0),
        resolvedCount: Number(aggregate.resolved_count || 0),
        reopenedCount: Number(aggregate.reopened_count || 0),
    };
}

function decorateManagementActionCenter(center, options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db, managementActionLifecycleRow } = dbAccessors;
    const activeRows = db.prepare(`
        SELECT * FROM management_action_lifecycles
        WHERE status = 'active'
    `).all();
    const activeByKey = new Map(activeRows.map(row => [
        row.action_key,
        lifecycleResponse(row, managementActionLifecycleRow),
    ]));
    const recentResolved = listManagementActionLifecycles(
        { status: 'resolved', limit: 8 },
        { dbAccessors }
    );
    const monitor = options.monitorStatus || getManagementActionLifecycleMonitorStatus();
    const decorated = {
        ...center,
        items: center.items.map(item => ({
            ...item,
            lifecycle: activeByKey.get(item.id) || null,
        })),
        lifecycle: {
            ...lifecycleOverview({ dbAccessors }),
            lastSyncedAt: monitor.lastCompletedAt,
            lastError: monitor.lastError,
            recentResolved,
        },
    };
    return {
        ...decorated,
        executionQueue: buildManagementExecutionQueue(decorated),
    };
}

function createManagementActionLifecycleMonitor(options = {}) {
    const logger = options.logger || createLogger('management-action-lifecycle');
    const sync = options.sync || (() => syncManagementActionLifecycles());
    const intervalMs = Number.isFinite(Number(options.intervalMs))
        ? Math.max(1000, Number(options.intervalMs))
        : DEFAULT_INTERVAL_MS;
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    let timer = null;
    let running = false;
    const state = {
        lastStartedAt: null,
        lastCompletedAt: null,
        lastFailedAt: null,
        lastError: '',
        lastResult: null,
    };

    function schedule(delay = intervalMs) {
        if (timer) clearTimer(timer);
        timer = setTimer(() => {
            timer = null;
            void run();
        }, delay);
        timer?.unref?.();
    }

    async function run() {
        if (running) return { skipped: true, reason: 'running' };
        running = true;
        state.lastStartedAt = new Date().toISOString();
        try {
            const result = await Promise.resolve(sync());
            state.lastCompletedAt = result.syncedAt || new Date().toISOString();
            state.lastFailedAt = null;
            state.lastError = '';
            state.lastResult = result.stats;
            logger.info('管理待办生命周期核对完成', result.stats);
            return { success: true, result };
        } catch (error) {
            state.lastFailedAt = new Date().toISOString();
            state.lastError = String(error?.message || error);
            logger.error(`管理待办生命周期核对失败：${state.lastError}`);
            return { success: false, error: state.lastError };
        } finally {
            running = false;
            schedule();
        }
    }

    function start() {
        if (!timer && !running) schedule(0);
    }

    function stop() {
        if (timer) clearTimer(timer);
        timer = null;
    }

    function getStatus() {
        return { ...state, running, scheduled: Boolean(timer) };
    }

    return { start, stop, run, getStatus };
}

let monitorSingleton = null;

function getMonitor() {
    if (!monitorSingleton) monitorSingleton = createManagementActionLifecycleMonitor();
    return monitorSingleton;
}

function startManagementActionLifecycleMonitor() {
    getMonitor().start();
}

function getManagementActionLifecycleMonitorStatus() {
    return getMonitor().getStatus();
}

module.exports = {
    DEFAULT_INTERVAL_MS,
    createManagementActionLifecycleMonitor,
    decorateManagementActionCenter,
    getManagementActionLifecycleMonitorStatus,
    lifecycleOverview,
    lifecycleSnapshot,
    listManagementActionLifecycles,
    startManagementActionLifecycleMonitor,
    syncManagementActionLifecycles,
};
