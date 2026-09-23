'use strict';

// N7.2 final closure — canonical deterministic deep-api gate.
//
// The deep-api check count depends on the *shape* of the source SQLite database
// because several checks are gated on pre-existing business records.  Before
// this ticket the default run copied whatever ./pump.db existed on the machine,
// which made the release gate machine-dependent (489 macOS-empty / 490
// macOS-populated / 493 this Windows checkout).
//
// The canonical gate now builds its source from the repository's own versioned
// migrations, so the executed check set is identical on every machine and
// contains no production or user data.
//
// These tests assert the *mechanism*, not a hand-picked number.  The canonical
// count is whatever the deterministic suite naturally produces.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(ROOT, 'scripts', 'run-deep-api-smoke.cjs');

function runDeepApi(env = {}) {
    const isolatedTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'n72-canonical-gate-'));
    try {
        const cleanEnv = { ...process.env, TEMP: isolatedTemp, TMP: isolatedTemp, TMPDIR: isolatedTemp, ...env };
        // node --test sets NODE_TEST_CONTEXT, and api/db.cjs treats it as a test
        // marker that redirects the database path.  The deep-api runner spawns a
        // real API child with its own cloned database, so inheriting that marker
        // would make the child open an unrelated per-pid test database instead.
        delete cleanEnv.NODE_TEST_CONTEXT;
        delete cleanEnv.PUMP_TEST_DATABASE_PATH;
        const stdout = execFileSync(process.execPath, [RUNNER], {
            cwd: ROOT,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            env: cleanEnv,
        });
        const keyIndex = stdout.lastIndexOf('"passed"');
        const start = stdout.lastIndexOf('{', keyIndex);
        const tail = stdout.slice(start);
        let depth = 0; let end = -1;
        for (let index = 0; index < tail.length; index += 1) {
            if (tail[index] === '{') depth += 1;
            else if (tail[index] === '}') { depth -= 1; if (depth === 0) { end = index; break; } }
        }
        return JSON.parse(tail.slice(0, end + 1));
    } finally {
        fs.rmSync(isolatedTemp, { recursive: true, force: true });
    }
}

test('N7.2 canonical deep-api gate uses a repository-built deterministic source, not the local database', () => {
    const source = fs.readFileSync(RUNNER, 'utf8');
    // The canonical source is built from the repository's versioned migrations.
    assert.match(source, /api', 'database', 'migrations\.cjs'/u);
    assert.match(source, /runMigrations\(db\)/u);
    // It must key off the explicit environment variable, not a hardcoded path.
    assert.match(source, /process\.env\.DEEP_API_SOURCE_DATABASE_PATH/u);
});

test('N7.2 canonical deep-api gate stays platform-neutral', () => {
    const source = fs.readFileSync(RUNNER, 'utf8');
    // No absolute Windows drive path may be baked into the runner.
    assert.equal(/['"][A-Za-z]:[\\/]{1,2}/u.test(source), false, 'runner must not embed an absolute drive path');
    // Temp handling must come from node:os, and canonical paths must be relative
    // to the repository root rather than the current directory.
    assert.match(source, /os\.tmpdir\(\)/u);
    assert.match(source, /path\.join\(root, 'api'/u);
});

test('N7.2 canonical deep-api gate is deterministic and uses no local ./pump.db', () => {
    // An independent, empty temp directory is used for the run, and the local
    // source path is pointed at a non-existent file so we can prove the canonical
    // gate does not consult it.
    const absentSource = path.join(os.tmpdir(), `n72-absent-${crypto.randomUUID()}.db`);
    const first = runDeepApi({ DEEP_API_SOURCE_DATABASE_PATH: '' });
    const second = runDeepApi({ DEEP_API_SOURCE_DATABASE_PATH: '' });

    assert.equal(first.sourceMode, 'CANONICAL_DETERMINISTIC');
    assert.equal(second.sourceMode, 'CANONICAL_DETERMINISTIC');
    assert.equal(first.canonicalSource, true);
    assert.equal(first.localPumpDbUsed, false);
    assert.equal(first.failed, 0);
    assert.equal(second.failed, 0);
    assert.equal(first.tempDatabaseIntegrity, 'ok');
    assert.equal(first.tempDatabaseForeignKeyViolations, 0);
    // Determinism: identical executed check count across fresh temp databases.
    assert.equal(second.passed, first.passed, 'canonical check count must be reproducible');
    assert.equal(fs.existsSync(absentSource), false);
});

test('N7.2 explicit source override remains available as extended coverage', () => {
    const source = fs.readFileSync(RUNNER, 'utf8');
    // The override branch must still exist and be labelled as extended coverage,
    // so local richer databases can add checks without becoming the baseline.
    assert.match(source, /EXTENDED_SOURCE_DB/u);
    assert.match(source, /if \(process\.env\.DEEP_API_SOURCE_DATABASE_PATH\)/u);
    assert.match(source, /canonicalSource: sourceMode === 'CANONICAL_DETERMINISTIC'/u);
    assert.match(source, /localPumpDbUsed: sourceMode !== 'CANONICAL_DETERMINISTIC'/u);
});

test('N7.2 canonical gate does not weaken market or copper semantics', () => {
    const source = fs.readFileSync(RUNNER, 'utf8');
    // The deterministic current-BJT market snapshot fixture must still run.
    assert.match(source, /seedMcpDailyMarketSnapshotFixture\(path\.join\(temp, 'pump\.db'\)\)/u);
    // No fabricated production copper fallback may be introduced.
    assert.equal(/fake.*copper|copper.*fallback/iu.test(source), false, 'no fake copper fallback allowed');
    // Production market-data absence semantics stay untouched: this ticket only
    // changes which source database the test harness clones.
    for (const file of ['api/services/marketData.cjs', 'api/services/marketSync.cjs']) {
        const production = fs.readFileSync(path.join(ROOT, file), 'utf8');
        assert.equal(/n72|canonical|deep-api/iu.test(production), false, `${file} must not reference test-harness concepts`);
    }
});
