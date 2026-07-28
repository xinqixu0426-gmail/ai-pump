const MAX_RETAINED_RUNS = 200;

const VALID_MODES = new Set(['automatic', 'flush', 'manual']);
const VALID_STATUSES = new Set(['success', 'failed']);

function loadDbAccessors() {
    return require('../db.cjs');
}

function parseSources(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
}

function normalizedCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function recordKnowledgeSyncRun(input, options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert, knowledgeSyncRunRow } = dbAccessors;
    const mode = VALID_MODES.has(input?.mode) ? input.mode : 'automatic';
    const status = VALID_STATUSES.has(input?.status) ? input.status : 'failed';
    const sources = [...new Set((Array.isArray(input?.sources) ? input.sources : []).map(String))];
    const stats = input?.result?.stats || input?.stats || {};
    const now = input?.completedAt || new Date().toISOString();
    const info = safeInsert('knowledge_sync_runs', {
        mode,
        status,
        trigger_sources_json: JSON.stringify(sources),
        source_count: sources.length,
        attempt: Math.max(1, normalizedCount(input?.attempt) || 1),
        total_count: normalizedCount(stats.total),
        inserted_count: normalizedCount(stats.inserted),
        updated_count: normalizedCount(stats.updated),
        unchanged_count: normalizedCount(stats.unchanged),
        deleted_count: normalizedCount(stats.deleted),
        fts_enabled: input?.result?.ftsEnabled || input?.ftsEnabled ? 1 : 0,
        duration_ms: normalizedCount(input?.durationMs),
        error_text: status === 'failed' ? String(input?.error || '').slice(0, 2000) : '',
        started_at: input?.startedAt || now,
        completed_at: now,
        created_at: now,
        updated_at: now,
    });

    db.prepare(`
        DELETE FROM knowledge_sync_runs
        WHERE id NOT IN (
            SELECT id FROM knowledge_sync_runs
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        )
    `).run(MAX_RETAINED_RUNS);

    const row = db.prepare('SELECT * FROM knowledge_sync_runs WHERE id = ?')
        .get(Number(info.lastInsertRowid));
    const adapted = knowledgeSyncRunRow(row);
    return {
        ...adapted,
        triggerSources: parseSources(adapted.triggerSourcesJson),
    };
}

function listKnowledgeSyncRuns(params = {}, options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db, knowledgeSyncRunRow } = dbAccessors;
    const requestedLimit = Number(params.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 20;
    const status = VALID_STATUSES.has(params.status) ? params.status : '';
    const rows = status
        ? db.prepare(`
            SELECT * FROM knowledge_sync_runs
            WHERE status = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        `).all(status, limit)
        : db.prepare(`
            SELECT * FROM knowledge_sync_runs
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        `).all(limit);
    const aggregate = db.prepare(`
        SELECT
            COUNT(*) AS total_retained,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
            MAX(CASE WHEN status = 'success' THEN completed_at END) AS last_success_at,
            MAX(CASE WHEN status = 'failed' THEN completed_at END) AS last_failure_at
        FROM knowledge_sync_runs
    `).get();
    return {
        items: rows.map(knowledgeSyncRunRow).map(row => ({
            ...row,
            triggerSources: parseSources(row.triggerSourcesJson),
        })),
        stats: {
            totalRetained: Number(aggregate.total_retained || 0),
            successCount: Number(aggregate.success_count || 0),
            failedCount: Number(aggregate.failed_count || 0),
            lastSuccessAt: aggregate.last_success_at || null,
            lastFailureAt: aggregate.last_failure_at || null,
        },
    };
}

module.exports = {
    MAX_RETAINED_RUNS,
    listKnowledgeSyncRuns,
    recordKnowledgeSyncRun,
};
