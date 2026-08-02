const { createLogger } = require('../logger.cjs');

const DEFAULT_DELAY_MS = 1000;
const DEFAULT_RETRY_DELAYS_MS = [5000, 30000, 120000];

function envEnabled() {
    const vectorEnabled = String(process.env.KNOWLEDGE_VECTOR_ENABLED || '').trim().toLowerCase();
    if (['0', 'false', 'off', 'no'].includes(vectorEnabled)) return false;
    const configured = String(process.env.KNOWLEDGE_VECTOR_AUTO_SYNC_ENABLED || '').trim().toLowerCase();
    if (configured) return !['0', 'false', 'off', 'no'].includes(configured);
    return !process.env.NODE_TEST_CONTEXT;
}

function createKnowledgeVectorAutoSyncController(options = {}) {
    const syncVectors = options.syncVectors;
    if (typeof syncVectors !== 'function') throw new Error('自动向量同步缺少 syncVectors');
    const logger = options.logger || createLogger('knowledge-vector-sync');
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

    const pendingReasons = new Set();
    let pendingDeleted = 0;
    let timer = null;
    let retryIndex = 0;
    let rerunRequested = false;
    const state = {
        enabled,
        running: false,
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
            pending: pendingReasons.size > 0,
            pendingReasons: [...pendingReasons].sort(),
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
            void run();
        }, waitMs);
        timer?.unref?.();
    }

    function request(input = {}) {
        if (!enabled) return false;
        pendingReasons.add(String(input.reason || 'knowledge_sync'));
        pendingDeleted += Math.max(0, Number(input.deletedCount || 0));
        state.lastRequestedAt = now();
        if (state.running) {
            rerunRequested = true;
        } else {
            schedule(delayMs);
        }
        return true;
    }

    function persistRun(input) {
        if (!recordRun) return;
        try {
            recordRun(input);
        } catch (error) {
            logger.warn(`向量同步结果记录失败：${error?.message || error}`);
        }
    }

    async function run() {
        if (!enabled) return { success: false, skipped: true, reason: 'disabled' };
        if (state.running) {
            rerunRequested = true;
            return { success: false, skipped: true, reason: 'running' };
        }
        if (pendingReasons.size === 0) {
            return { success: true, skipped: true, reason: 'nothing_pending' };
        }

        cancelTimer();
        const reasons = [...pendingReasons];
        const cascadeDeleted = pendingDeleted;
        pendingReasons.clear();
        pendingDeleted = 0;
        rerunRequested = false;
        state.running = true;
        state.lastStartedAt = now();
        const startedAt = state.lastStartedAt;
        const startedMs = clockMs();

        try {
            const result = await syncVectors({ cascadeDeleted, reasons });
            retryIndex = 0;
            state.lastCompletedAt = now();
            state.lastFailedAt = null;
            state.lastError = '';
            state.consecutiveFailures = 0;
            state.lastResult = result.stats;
            persistRun({
                status: 'success',
                model: result.model,
                dimensions: result.dimensions,
                stats: result.stats,
                startedAt,
                completedAt: state.lastCompletedAt,
                durationMs: Math.max(0, clockMs() - startedMs),
            });
            logger.info('完成知识向量同步', result.stats);
            return { success: true, result, reasons };
        } catch (error) {
            reasons.forEach(reason => pendingReasons.add(reason));
            state.lastFailedAt = now();
            state.lastError = String(error?.message || error);
            state.consecutiveFailures += 1;
            state.lastResult = error?.stats || null;
            persistRun({
                status: 'failed',
                model: options.model?.() || 'unknown',
                dimensions: options.dimensions?.() || 1,
                stats: error?.stats,
                error,
                startedAt,
                completedAt: state.lastFailedAt,
                durationMs: Math.max(0, clockMs() - startedMs),
            });
            if (retryIndex < retryDelaysMs.length) {
                const retryDelay = retryDelaysMs[retryIndex];
                retryIndex += 1;
                schedule(retryDelay, true);
            }
            logger.error(`知识向量同步失败：${state.lastError}`);
            return { success: false, error: state.lastError, reasons };
        } finally {
            state.running = false;
            if (rerunRequested && !timer) schedule(0);
        }
    }

    function dispose() {
        cancelTimer();
        pendingReasons.clear();
        pendingDeleted = 0;
    }

    return {
        request,
        flush: run,
        getStatus: snapshot,
        dispose,
    };
}

let singleton = null;

function getController() {
    if (!singleton) {
        const { embeddingProvider } = require('./embeddingProvider.cjs');
        singleton = createKnowledgeVectorAutoSyncController({
            enabled: envEnabled(),
            syncVectors: details => require('./knowledgeVectorSync.cjs')
                .syncKnowledgeEmbeddings(details),
            recordRun: input => require('./knowledgeVectorSyncHistory.cjs')
                .recordKnowledgeVectorSyncRun(input),
            model: () => embeddingProvider.config.model,
            dimensions: () => embeddingProvider.config.dimensions,
        });
    }
    return singleton;
}

function requestKnowledgeVectorSync(input) {
    return getController().request(input);
}

function getKnowledgeVectorSyncStatus() {
    return getController().getStatus();
}

function flushKnowledgeVectorSync() {
    return getController().flush();
}

function stopKnowledgeVectorSync() {
    singleton?.dispose();
    singleton = null;
}

module.exports = {
    createKnowledgeVectorAutoSyncController,
    flushKnowledgeVectorSync,
    getKnowledgeVectorSyncStatus,
    requestKnowledgeVectorSync,
    stopKnowledgeVectorSync,
};
