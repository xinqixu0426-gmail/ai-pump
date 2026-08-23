const { createLogger } = require('../logger.cjs');

const AUTO_SYNC_SOURCE_TABLES = new Set([
    'parts',
    'pump_shell_templates',
    'recipes',
    'recipe_technical_files',
    'knowledge_documents',
    'coils',
    'stator_variants',
    'customers',
    'quotations',
    'orders',
    'order_requirement_summaries',
    'order_execution_records',
    'factory_ai_rules',
    'system_settings',
    'business_change_events',
]);

const DEFAULT_DELAY_MS = 300;
const DEFAULT_RETRY_DELAYS_MS = [1000, 5000, 15000];

function envEnabled() {
    const configured = String(process.env.KNOWLEDGE_AUTO_SYNC_ENABLED || '').trim().toLowerCase();
    if (configured) return !['0', 'false', 'off', 'no'].includes(configured);
    return !process.env.NODE_TEST_CONTEXT;
}

function summarizeResult(result) {
    const stats = result?.stats || {};
    return {
        total: Number(stats.total || 0),
        inserted: Number(stats.inserted || 0),
        updated: Number(stats.updated || 0),
        unchanged: Number(stats.unchanged || 0),
        deleted: Number(stats.deleted || 0),
        ftsEnabled: Boolean(result?.ftsEnabled),
    };
}

function createKnowledgeAutoSyncController(options = {}) {
    const syncKnowledge = options.syncKnowledge;
    if (typeof syncKnowledge !== 'function') throw new Error('自动知识同步缺少 syncKnowledge');

    const logger = options.logger || createLogger('knowledge-auto-sync');
    const enabled = options.enabled ?? true;
    const delayMs = Number.isFinite(Number(options.delayMs))
        ? Math.max(0, Number(options.delayMs))
        : DEFAULT_DELAY_MS;
    const retryDelaysMs = Array.isArray(options.retryDelaysMs)
        ? options.retryDelaysMs.map(Number).filter(Number.isFinite).map(value => Math.max(0, value))
        : DEFAULT_RETRY_DELAYS_MS;
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    const now = options.now || (() => new Date().toISOString());
    const clockMs = options.clockMs || Date.now;
    const recordRun = typeof options.recordRun === 'function' ? options.recordRun : null;

    const pendingSources = new Set();
    let timer = null;
    let retryIndex = 0;
    let rerunRequested = false;
    const state = {
        enabled,
        running: false,
        lastMode: null,
        lastRequestedAt: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastFailedAt: null,
        lastError: '',
        consecutiveFailures: 0,
        retryScheduled: false,
        lastResult: null,
    };

    function snapshot() {
        return {
            ...state,
            pending: pendingSources.size > 0,
            pendingCount: pendingSources.size,
            pendingSources: [...pendingSources].sort(),
        };
    }

    function cancelTimer() {
        if (timer) clearTimer(timer);
        timer = null;
        state.retryScheduled = false;
    }

    function schedule(waitMs, retry = false) {
        cancelTimer();
        state.retryScheduled = retry;
        timer = setTimer(() => {
            timer = null;
            state.retryScheduled = false;
            run('automatic');
        }, waitMs);
        timer?.unref?.();
    }

    function persistRun(input) {
        if (!recordRun) return;
        try {
            recordRun(input);
        } catch (error) {
            logger.warn(`同步结果记录失败：${error?.message || error}`);
        }
    }

    function request(change = {}) {
        if (!enabled) return false;
        const sourceTable = String(change.sourceTable || '').trim();
        if (sourceTable !== 'system' && !AUTO_SYNC_SOURCE_TABLES.has(sourceTable)) return false;
        const sourceId = String(change.sourceId ?? '*').trim() || '*';
        pendingSources.add(`${sourceTable}:${sourceId}`);
        state.lastRequestedAt = now();
        if (state.running) {
            rerunRequested = true;
        } else {
            schedule(delayMs);
        }
        return true;
    }

    function run(mode = 'automatic') {
        if (!enabled) return { success: false, skipped: true, reason: 'disabled' };
        if (state.running) {
            rerunRequested = true;
            return { success: false, skipped: true, reason: 'running' };
        }
        if (pendingSources.size === 0 && mode === 'automatic') {
            return { success: true, skipped: true, reason: 'nothing_pending' };
        }

        cancelTimer();
        const sources = [...pendingSources];
        pendingSources.clear();
        state.running = true;
        state.lastMode = mode;
        state.lastStartedAt = now();
        const startedAt = state.lastStartedAt;
        const startedMs = clockMs();
        const attempt = state.consecutiveFailures + 1;
        rerunRequested = false;

        try {
            const result = syncKnowledge();
            retryIndex = 0;
            state.lastCompletedAt = now();
            persistRun({
                mode,
                status: 'success',
                sources,
                attempt,
                result,
                startedAt,
                completedAt: state.lastCompletedAt,
                durationMs: Math.max(0, clockMs() - startedMs),
            });
            state.lastFailedAt = null;
            state.lastError = '';
            state.consecutiveFailures = 0;
            state.lastResult = summarizeResult(result);
            logger.info(`完成自动同步，来源 ${sources.length} 项`, state.lastResult);
            return { success: true, result, sources };
        } catch (error) {
            sources.forEach(source => pendingSources.add(source));
            state.lastFailedAt = now();
            state.lastError = error?.message || String(error);
            state.consecutiveFailures += 1;
            state.lastResult = null;
            persistRun({
                mode,
                status: 'failed',
                sources,
                attempt,
                error: state.lastError,
                startedAt,
                completedAt: state.lastFailedAt,
                durationMs: Math.max(0, clockMs() - startedMs),
            });
            if (retryIndex < retryDelaysMs.length) {
                const retryDelay = retryDelaysMs[retryIndex];
                retryIndex += 1;
                schedule(retryDelay, true);
            }
            logger.error(`自动同步失败：${state.lastError}`);
            return { success: false, error: state.lastError, sources };
        } finally {
            state.running = false;
            if (rerunRequested && !timer) schedule(0);
        }
    }

    function recordExternalSuccess(result, mode = 'manual', details = {}) {
        cancelTimer();
        pendingSources.clear();
        retryIndex = 0;
        rerunRequested = false;
        state.lastMode = mode;
        state.lastStartedAt = details.startedAt || now();
        state.lastCompletedAt = now();
        state.lastFailedAt = null;
        state.lastError = '';
        state.consecutiveFailures = 0;
        state.lastResult = summarizeResult(result);
        if (!details.skipRecord) {
            persistRun({
                mode,
                status: 'success',
                sources: details.sources || [],
                attempt: details.attempt || 1,
                result,
                startedAt: state.lastStartedAt,
                completedAt: state.lastCompletedAt,
                durationMs: details.durationMs || 0,
            });
        }
    }

    function recordExternalFailure(error, mode = 'manual', details = {}) {
        state.lastMode = mode;
        state.lastStartedAt = details.startedAt || now();
        state.lastFailedAt = now();
        state.lastError = error?.message || String(error);
        state.consecutiveFailures += 1;
        state.lastResult = null;
        persistRun({
            mode,
            status: 'failed',
            sources: details.sources || [],
            attempt: details.attempt || 1,
            error: state.lastError,
            startedAt: state.lastStartedAt,
            completedAt: state.lastFailedAt,
            durationMs: details.durationMs || 0,
        });
    }

    function dispose() {
        cancelTimer();
        pendingSources.clear();
    }

    return {
        request,
        flush: () => run('flush'),
        getStatus: snapshot,
        recordExternalSuccess,
        recordExternalFailure,
        dispose,
    };
}

let singleton = null;

function getController() {
    if (!singleton) {
        singleton = createKnowledgeAutoSyncController({
            enabled: envEnabled(),
            syncKnowledge: () => require('./knowledge.cjs').syncKnowledgeEntries(),
            recordRun: input => require('./knowledgeSyncHistory.cjs').recordKnowledgeSyncRun(input),
        });
    }
    return singleton;
}

function requestAutoKnowledgeSync(change) {
    return getController().request(change);
}

function requestFullAutoKnowledgeSync(reason = 'system') {
    return requestAutoKnowledgeSync({ sourceTable: 'system', sourceId: reason });
}

function getAutoKnowledgeSyncStatus() {
    return getController().getStatus();
}

function flushAutoKnowledgeSync() {
    return getController().flush();
}

function recordKnowledgeSyncSuccess(result, mode = 'manual', details = {}) {
    getController().recordExternalSuccess(result, mode, details);
}

function recordKnowledgeSyncFailure(error, mode = 'manual', details = {}) {
    getController().recordExternalFailure(error, mode, details);
}

function stopAutoKnowledgeSync() {
    singleton?.dispose();
    singleton = null;
}

module.exports = {
    AUTO_SYNC_SOURCE_TABLES,
    createKnowledgeAutoSyncController,
    requestAutoKnowledgeSync,
    requestFullAutoKnowledgeSync,
    getAutoKnowledgeSyncStatus,
    flushAutoKnowledgeSync,
    recordKnowledgeSyncSuccess,
    recordKnowledgeSyncFailure,
    stopAutoKnowledgeSync,
};
