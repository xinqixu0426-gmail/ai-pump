const DEFAULT_AUDIT_RETENTION_DAYS = 365;

function auditRetentionDays(value = process.env.AUDIT_RETENTION_DAYS) {
    if (value === '0' || value === 0) return 0;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 30) return DEFAULT_AUDIT_RETENTION_DAYS;
    return parsed;
}

function pruneAuditLog(db, options = {}) {
    const retentionDays = auditRetentionDays(options.retentionDays);
    if (retentionDays === 0) {
        return { retentionDays, deletedCount: 0, cutoff: null, disabled: true };
    }
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const result = db.prepare(`
        DELETE FROM audit_log
        WHERE created_at IS NOT NULL AND created_at < ?
    `).run(cutoff);
    return {
        retentionDays,
        deletedCount: Number(result.changes || 0),
        cutoff,
        disabled: false,
    };
}

module.exports = {
    DEFAULT_AUDIT_RETENTION_DAYS,
    auditRetentionDays,
    pruneAuditLog,
};
