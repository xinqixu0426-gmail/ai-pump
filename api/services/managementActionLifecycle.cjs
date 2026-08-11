const { createLogger } = require('../logger.cjs');
const { buildManagementExecutionQueue } = require('./managementExecutionQueue.cjs');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_RECHECK_DELAY_MS = 500;
const PROGRESS_WINDOW_HOURS = 24;
const VALID_STATUSES = new Set(['active', 'resolved']);
const BUSINESS_MUTATION_PREFIXES = Object.freeze([
    '/api/parts',
    '/api/recipes',
    '/api/templates',
    '/api/model-variants',
    '/api/orders',
    '/api/coils',
    '/api/rotor',
    '/api/settings',
    '/api/customers',
    '/api/quotations',
    '/api/quality',
    '/api/knowledge',
]);
const NON_MUTATING_POST_PATHS = Object.freeze([
    /^\/api\/templates\/\d+\/apply$/,
    /^\/api\/recipes\/(?:cost-draft|bom-draft|model-variant-draft|save-payload-draft)$/,
    /^\/api\/recipes\/\d+\/cost-preview$/,
    /^\/api\/orders\/(?:purchase-plan|save-payload-draft)$/,
    /^\/api\/coils\/(?:spec-draft|calculate)$/,
    /^\/api\/rotor\/(?:recipe-draft|template-draft)$/,
    /^\/api\/quotations\/save-payload-draft$/,
    /^\/api\/quotations\/\d+\/order-draft$/,
    /^\/api\/files\/\d+\/(?:parse|quotation-draft)$/,
    /^\/api\/quality\/recipe-analysis$/,
]);

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

function shouldRecheckManagementActions(input = {}) {
    const method = String(input.method || '').toUpperCase();
    const statusCode = Number(input.statusCode || 0);
    const pathname = String(input.path || '').split('?')[0];
    const isNonMutatingPost = method === 'POST'
        && NON_MUTATING_POST_PATHS.some(pattern => pattern.test(pathname));
    return !isNonMutatingPost
        && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
        && statusCode >= 200
        && statusCode < 300
        && BUSINESS_MUTATION_PREFIXES.some(prefix => (
            pathname === prefix || pathname.startsWith(`${prefix}/`)
        ));
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

function listRecentlyResolved(options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db, managementActionLifecycleRow } = dbAccessors;
    const now = new Date(options.now || new Date());
    const windowHours = Number.isFinite(Number(options.windowHours))
        ? Math.max(1, Number(options.windowHours))
        : PROGRESS_WINDOW_HOURS;
    const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();
    return db.prepare(`
        SELECT * FROM management_action_lifecycles
        WHERE status = 'resolved' AND resolved_at >= ?
        ORDER BY resolved_at DESC, id DESC
        LIMIT 20
    `).all(since).map(row => lifecycleResponse(row, managementActionLifecycleRow));
}

function buildManagementActionProgress(center, options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db } = dbAccessors;
    const now = new Date(options.now || center.generatedAt || new Date());
    const windowHours = Number.isFinite(Number(options.windowHours))
        ? Math.max(1, Number(options.windowHours))
        : PROGRESS_WINDOW_HOURS;
    const resolvedItems = listRecentlyResolved({
        ...options,
        dbAccessors,
        now,
        windowHours,
    });
    const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();
    const resolvedCount = Number(db.prepare(`
        SELECT COUNT(*) AS count
        FROM management_action_lifecycles
        WHERE status = 'resolved' AND resolved_at >= ?
    `).get(since).count || 0);
    const unresolvedItems = Array.isArray(center.items) ? center.items : [];
    const blockedItems = unresolvedItems.filter(item => (
        item.resolution?.mode === 'needs_input'
        || item.resolution?.mode === 'monitor'
    ));
    const recurringByKey = new Map();
    for (const item of unresolvedItems) {
        if (Number(item.lifecycle?.occurrenceCount || 0) > 1) {
            recurringByKey.set(item.lifecycle.actionKey, item.lifecycle);
        }
    }
    const recurringItems = [...recurringByKey.values()]
        .sort((left, right) => (
            Number(right.occurrenceCount || 0) - Number(left.occurrenceCount || 0)
            || String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
        ))
        .slice(0, 10);
    const summary = [
        `最近 ${windowHours} 小时自动归档 ${resolvedCount} 项`,
        `当前仍待处理 ${unresolvedItems.length} 项`,
        blockedItems.length > 0 ? `其中 ${blockedItems.length} 项暂时受阻` : '',
        recurringItems.length > 0 ? `${recurringItems.length} 项曾反复出现` : '',
    ].filter(Boolean).join('；') + '。';
    return {
        generatedAt: now.toISOString(),
        windowHours,
        resolvedCount,
        unresolvedCount: unresolvedItems.length,
        blockedCount: blockedItems.length,
        recurringCount: recurringItems.length,
        summary,
        resolvedItems,
        blockedItems: blockedItems.slice(0, 10),
        recurringItems,
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
        progress: buildManagementActionProgress(decorated, {
            dbAccessors,
            now: center.generatedAt,
        }),
    };
}

function createManagementActionLifecycleMonitor(options = {}) {
    const logger = options.logger || createLogger('management-action-lifecycle');
    const sync = options.sync || (() => syncManagementActionLifecycles());
    const intervalMs = Number.isFinite(Number(options.intervalMs))
        ? Math.max(1000, Number(options.intervalMs))
        : DEFAULT_INTERVAL_MS;
    const recheckDelayMs = Number.isFinite(Number(options.recheckDelayMs))
        ? Math.max(0, Number(options.recheckDelayMs))
        : DEFAULT_RECHECK_DELAY_MS;
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    let timer = null;
    let running = false;
    let pendingReason = '';
    const state = {
        lastStartedAt: null,
        lastCompletedAt: null,
        lastFailedAt: null,
        lastError: '',
        lastResult: null,
        lastRequestedAt: null,
        lastRequestReason: '',
        lastRunReason: '',
    };

    function schedule(delay = intervalMs) {
        if (timer) clearTimer(timer);
        timer = setTimer(() => {
            timer = null;
            void run();
        }, delay);
        timer?.unref?.();
    }

    async function run(reason = '') {
        if (running) {
            request(reason || 'while_running');
            return { skipped: true, reason: 'running' };
        }
        if (timer) clearTimer(timer);
        timer = null;
        running = true;
        const runReason = String(reason || pendingReason || 'scheduled').trim();
        pendingReason = '';
        state.lastStartedAt = new Date().toISOString();
        state.lastRunReason = runReason;
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
            schedule(pendingReason ? recheckDelayMs : intervalMs);
        }
    }

    function request(reason = 'business_write') {
        pendingReason = String(reason || 'business_write').trim();
        state.lastRequestedAt = new Date().toISOString();
        state.lastRequestReason = pendingReason;
        if (!running) schedule(recheckDelayMs);
        return {
            queued: true,
            reason: pendingReason,
            delayMs: recheckDelayMs,
        };
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

    return { start, stop, run, request, getStatus };
}

let monitorSingleton = null;

function getMonitor() {
    if (!monitorSingleton) monitorSingleton = createManagementActionLifecycleMonitor();
    return monitorSingleton;
}

function startManagementActionLifecycleMonitor() {
    getMonitor().start();
}

function requestManagementActionLifecycleRecheck(reason = 'business_write') {
    return getMonitor().request(reason);
}

function getManagementActionLifecycleMonitorStatus() {
    return getMonitor().getStatus();
}

function stopManagementActionLifecycleMonitor() {
    monitorSingleton?.stop();
    monitorSingleton = null;
}

module.exports = {
    DEFAULT_INTERVAL_MS,
    DEFAULT_RECHECK_DELAY_MS,
    PROGRESS_WINDOW_HOURS,
    buildManagementActionProgress,
    createManagementActionLifecycleMonitor,
    decorateManagementActionCenter,
    getManagementActionLifecycleMonitorStatus,
    lifecycleOverview,
    lifecycleSnapshot,
    listManagementActionLifecycles,
    listRecentlyResolved,
    requestManagementActionLifecycleRecheck,
    shouldRecheckManagementActions,
    startManagementActionLifecycleMonitor,
    stopManagementActionLifecycleMonitor,
    syncManagementActionLifecycles,
};
