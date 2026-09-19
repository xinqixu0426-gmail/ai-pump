function buildReadinessSnapshot(db, options = {}) {
    const checks = {
        database: { ok: false },
        migrations: { ok: false },
        startupBackup: { ok: false },
    };

    try {
        db.prepare('SELECT 1 AS ok').get();
        checks.database = { ok: true };
    } catch (error) {
        checks.database = { ok: false, error: error.message };
    }

    try {
        const version = Number(db.pragma('user_version', { simple: true }));
        checks.migrations = {
            ok: Number.isInteger(version) && version > 0,
            version,
        };
    } catch (error) {
        checks.migrations = { ok: false, error: error.message };
    }

    const backup = options.backupState || {};
    checks.startupBackup = {
        ok: backup.startupCompleted === true && !backup.startupError,
        running: backup.running === true,
        completedAt: backup.startupCompletedAt || null,
        error: backup.startupError || null,
    };

    const ready = Object.values(checks).every(check => check.ok);
    return {
        status: ready ? 'ready' : 'not_ready',
        ready,
        timestamp: new Date().toISOString(),
        checks,
    };
}

module.exports = { buildReadinessSnapshot };
