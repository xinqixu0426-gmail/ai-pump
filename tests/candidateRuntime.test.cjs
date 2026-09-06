'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { fork } = require('node:child_process');
const Database = require('better-sqlite3');
const { candidateEnabled, openCandidateDatabase } = require('../api/services/candidateDatabase.cjs');
const { runMigrations } = require('../api/database/migrations.cjs');

test('Candidate defaults off; native read-only guard blocks all mutation families', () => {
    assert.equal(candidateEnabled({}), false);
    assert.equal(candidateEnabled({ PUMP_V5_CANDIDATE_RUNTIME: 'TRUE' }), false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-candidate-unit-'));
    const file = path.join(dir, 'fixture.db');
    const setup = new Database(file); runMigrations(setup); setup.close();
    const before = fs.readFileSync(file);
    const db = openCandidateDatabase(file);
    assert.equal(db.readonly, true);
    assert.equal(db.prepare('SELECT 1 AS value').get().value, 1);
    for (const sql of ['INSERT INTO system_settings(key,value) VALUES (\'guard\',\'x\')',
        'UPDATE system_settings SET value=\'x\'', 'DELETE FROM system_settings',
        'CREATE TABLE forbidden(id)', 'VACUUM', 'PRAGMA user_version=1', 'PRAGMA wal_checkpoint(TRUNCATE)']) {
        assert.throws(() => db.prepare(sql).run());
    }
    assert.throws(() => db.exec('VACUUM'), /CANDIDATE_MUTATION_BLOCKED/);
    assert.throws(() => db.pragma('wal_checkpoint(TRUNCATE)'), /CANDIDATE_MUTATION_BLOCKED/);
    assert.throws(() => db.backup(path.join(dir, 'forbidden.db')), /CANDIDATE_MUTATION_BLOCKED/);
    db.close(); assert.deepEqual(fs.readFileSync(file), before);
    // Native normal-mode handle remains writable; Candidate has not changed its prototype.
    const normal = new Database(file); normal.prepare('INSERT INTO system_settings(key,value) VALUES (?,?)').run('normal', 'yes'); normal.close();
});

test('schema requiring migration fails closed without modifying the fixture', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pump-candidate-schema-')), 'old.db');
    const setup = new Database(file); setup.exec('CREATE TABLE schema_migrations(version INTEGER, name TEXT, checksum TEXT)'); setup.close();
    const before = fs.readFileSync(file);
    assert.throws(() => openCandidateDatabase(file), /CANDIDATE_SCHEMA_INCOMPATIBLE/);
    assert.deepEqual(fs.readFileSync(file), before);
});

test('Candidate write intent is excluded by the frozen router; gates never trigger reads alone', async () => {
    const { runCandidateRead } = require('../api/services/ai-v5/candidateRead.cjs');
    const env = { PUMP_V5_CANDIDATE_RUNTIME: 'true', AI_V5_READ_CANARY_ENABLED: 'true', AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED: 'true' };
    let tools = 0, models = 0, bodies = 0;
    const input = { previewOptIn: true, internalAuthorized: true, sourceRequest: '增加测试零件库存', factKey: 'inventory.quantity', deliver: () => { bodies++; } };
    const options = { env, riskOptions: { request: async () => ({ goal: 'synthetic', mode: 'query', domains: ['catalog'],
        needsBusinessData: true, contextMode: 'current_turn', answerShape: 'direct', entityScope: 'single',
        requiresClarification: false, ambiguities: [], confidence: 'high' }) },
    interpret: async () => ({ status: 'VALID', interpretation: { domain: 'catalog', operation: 'update',
        needsClarification: false, entityCandidates: [{ entityType: 'part', candidateText: 'synthetic' }] },
    resolvedIdentity: { entityType: 'part', canonicalId: '1' }, architectureMetadata: { complete: true, finalEntityStatus: 'FINAL_ENTITY_RESOLVED' } }),
    executionOptions: { execute: () => { tools++; throw Error('FORBIDDEN'); } }, answerOptions: { modelRequest: () => { models++; throw Error('FORBIDDEN'); } } };
    const result = await runCandidateRead(input, options);
    assert.equal(result.eligible, false); assert.equal(result.delivered, false);
    for (const key of Object.keys(env)) {
        const result = await runCandidateRead(input, { ...options, env: { ...env, [key]: 'false' }, interpret: () => { throw Error('GATE_BYPASS'); } });
        assert.equal(result.attempted, false);
    }
    assert.deepEqual([tools, models, bodies], [0, 0, 0]);
});

test('scheduled callback cannot mutate Candidate data', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pump-candidate-background-')), 'fixture.db');
    const setup = new Database(file); runMigrations(setup); setup.close();
    const before = fs.readFileSync(file), db = openCandidateDatabase(file);
    await new Promise(resolve => setImmediate(() => { assert.throws(() => db.prepare('DELETE FROM system_settings').run(), /CANDIDATE_MUTATION_BLOCKED/); resolve(); }));
    db.close(); assert.deepEqual(fs.readFileSync(file), before);
});

test('independent loopback Candidate process starts, rejects mutation routes and stops alone', async () => {
    const http = require('node:http');
    const other = http.createServer((_req, res) => res.end('other-runtime'));
    await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
    const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
    const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pump-candidate-process-')), 'fixture.db');
    const setup = new Database(file); runMigrations(setup); setup.close();
    const before = fs.readFileSync(file);
    const child = fork(path.resolve(__dirname, '../scripts/start-v5-candidate.cjs'), [], { silent: true,
        env: { ...process.env, PUMP_V5_CANDIDATE_RUNTIME: 'true', PUMP_V5_CANDIDATE_DATABASE: file,
            PUMP_V5_CANDIDATE_PORT: String(port), INTERNAL_SECRET: 'isolated-test-identity', AI_OBSERVABILITY_ENABLED: 'false' } });
    let stderr = ''; child.stderr.on('data', b => { stderr += b; }); child.stdout.resume();
    try {
        await new Promise((resolve, reject) => { child.once('message', resolve); child.once('exit', () => reject(Error('CANDIDATE_START_FAILED'))); });
        assert.notEqual(child.pid, process.pid);
        const headers = { 'x-internal-secret': 'isolated-test-identity' };
        assert.equal((await fetch(`http://127.0.0.1:${port}/api/health/ready`, { headers })).status, 200);
        assert.equal((await fetch(`http://127.0.0.1:${port}/api/parts`, { method: 'POST', headers })).status, 403);
        assert.equal((await fetch(`http://127.0.0.1:${port}/api/ai/chat`, { method: 'POST' })).status, 401);
        child.send({ type: 'candidate-stop' });
        assert.equal(await new Promise(resolve => child.once('exit', resolve)), 0);
        await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health/ready`));
        assert.equal(await (await fetch(`http://127.0.0.1:${other.address().port}`)).text(), 'other-runtime');
        assert.deepEqual(fs.readFileSync(file), before);
        assert.equal(stderr, '');
    } finally {
        if (child.connected) child.send({ type: 'candidate-stop' });
        await new Promise(resolve => other.close(resolve));
    }
});
