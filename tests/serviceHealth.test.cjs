const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { buildReadinessSnapshot } = require('../api/services/serviceHealth.cjs');

test('readiness requires database, migrations, and startup backup', () => {
    const db = new Database(':memory:');
    db.pragma('user_version = 40');
    const snapshot = buildReadinessSnapshot(db, {
        backupState: {
            startupCompleted: true,
            startupCompletedAt: '2026-08-01T00:00:00.000Z',
        },
    });
    db.close();

    assert.equal(snapshot.ready, true);
    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.checks.migrations.version, 40);
});

test('readiness returns not_ready while startup backup is pending', () => {
    const db = new Database(':memory:');
    db.pragma('user_version = 40');
    const snapshot = buildReadinessSnapshot(db, {
        backupState: { running: true, startupCompleted: false },
    });
    db.close();

    assert.equal(snapshot.ready, false);
    assert.equal(snapshot.checks.database.ok, true);
    assert.equal(snapshot.checks.startupBackup.running, true);
});

test('readiness exposes database failure without throwing', () => {
    const db = new Database(':memory:');
    db.close();
    const snapshot = buildReadinessSnapshot(db, {
        backupState: { startupCompleted: true },
    });

    assert.equal(snapshot.ready, false);
    assert.equal(snapshot.checks.database.ok, false);
    assert.match(snapshot.checks.database.error, /not open|closed/);
});
