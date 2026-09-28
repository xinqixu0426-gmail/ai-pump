const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-recipe-technical-migration-http-'));
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(directory, 'pump-{pid}.db');
process.env.JWT_SECRET = 'recipe-technical-migration-http-test-secret';

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../api/authMiddleware.cjs');
const recipesRouter = require('../api/routes/recipes.cjs');
const { db, stopBackupScheduler } = require('../api/db.cjs');

const NOW = '2026-09-28T00:00:00.000Z';
let server;
let baseUrl;
let cookie;
let seedSequence = 0;
let bearingSeeded = false;

function authCookie() {
    return `token=${jwt.sign({ id: 1, username: 'migration-http', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' })}`;
}

async function getJson(pathname) {
    const response = await fetch(`${baseUrl}${pathname}`, {
        headers: { accept: 'application/json', connection: 'close', cookie },
        signal: AbortSignal.timeout(5000),
    });
    return { response, payload: await response.json() };
}

function seed() {
    seedSequence += 1;
    const suffix = seedSequence;
    const shellPartId = Number(db.prepare(`
        INSERT INTO parts (model, category, remark, created_at, updated_at)
        VALUES (?, '泵壳', '{"isStainless":false}', ?, ?)
    `).run(`migration-shell-${suffix}`, NOW, NOW).lastInsertRowid);
    if (!bearingSeeded) {
        db.prepare(`
            INSERT INTO parts (model, category, created_at, updated_at)
            VALUES ('轴承-6202', '轴承', ?, ?)
        `).run(NOW, NOW);
        bearingSeeded = true;
    }
    const templateId = Number(db.prepare(`
        INSERT INTO pump_shell_templates (shell_model, created_at, updated_at)
        VALUES (?, ?, ?)
    `).run(`migration-template-${suffix}`, NOW, NOW).lastInsertRowid);
    db.prepare(`
        INSERT INTO catalog_template_shell_bindings (template_id, shell_part_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
    `).run(templateId, shellPartId, NOW, NOW);
    return Number(db.prepare(`
        INSERT INTO recipes (name, template_id, technical_data_json, created_at, updated_at)
        VALUES (?, ?, '{"rotorDiameter":52,"upperBearing":"202"}', ?, ?)
    `).run(`migration-recipe-${suffix}`, templateId, NOW, NOW).lastInsertRowid);
}

function writeCounts() {
    return Object.fromEntries([
        'recipes', 'parts', 'pump_shell_templates', 'catalog_template_shell_bindings',
        'recipe_functional_technical_profiles', 'recipe_technical_knowledge',
        'audit_log', 'business_change_events', 'api_operations', 'knowledge_entries',
    ].map(table => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
}

function insertCanonicalPair(recipeId, options = {}) {
    db.prepare(`
        INSERT INTO recipe_functional_technical_profiles (
            recipe_id, schema_version, completeness_state, migration_state,
            migration_version, migration_fingerprint, provenance_json,
            legacy_evidence_json, created_at, updated_at
        ) VALUES (?, 1, ?, ?, ?, ?, '{}', '{}', ?, ?)
    `).run(
        recipeId,
        options.completenessState || 'INCOMPLETE',
        options.migrationState || 'ALREADY_CANONICAL',
        options.migrationVersion ?? null,
        options.migrationFingerprint ?? null,
        NOW,
        NOW,
    );
    db.prepare(`
        INSERT INTO recipe_technical_knowledge (recipe_id, schema_version, items_json, created_at, updated_at)
        VALUES (?, 1, '[]', ?, ?)
    `).run(recipeId, NOW, NOW);
}

test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api', authMiddleware);
    app.use('/api/recipes', recipesRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        if (server.listening) return resolve();
        server.once('listening', resolve);
        server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    cookie = authCookie();
});

test.after(async () => {
    stopBackupScheduler();
    server?.closeAllConnections?.();
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (db.open) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
});

test('migration dry-run and derived owner review queue HTTP endpoints are read-only and bounded', async () => {
    const recipeId = seed();
    const before = writeCounts();
    const one = await getJson(`/api/recipes/${recipeId}/technical-profile/migration-dry-run`);
    assert.equal(one.response.status, 200);
    assert.equal(one.payload.success, true);
    assert.equal(one.payload.data.recipeId, recipeId);
    assert.match(one.payload.data.fingerprint, /^[0-9a-f]{64}$/u);
    assert.equal(typeof one.payload.data.target.writeEligible, 'boolean');
    assert.ok(Array.isArray(one.payload.data.target.missingSet));
    assert.ok(Array.isArray(one.payload.data.target.unresolvedSet));

    const report = await getJson('/api/recipes/technical-profile/migration-dry-run?limit=1&offset=0');
    assert.equal(report.response.status, 200);
    assert.equal(report.payload.data.items.length, 1);
    assert.equal(report.payload.data.page.limit, 1);
    assert.equal(report.payload.data.pageSummary.total, 1);
    assert.equal(report.payload.data.cohortSummary.total >= 1, true);
    const queue = await getJson('/api/recipes/technical-profile/migration-review-queue?limit=1&offset=0');
    assert.equal(queue.response.status, 200);
    assert.ok(queue.payload.data.items.every(item => item.actionRequired));
    assert.deepEqual(writeCounts(), before);
});

test('migration dry-run HTTP rejects deleted and malformed targets without any write', async () => {
    const deletedRecipeId = Number(db.prepare(`
        INSERT INTO recipes (name, deleted_at, created_at, updated_at)
        VALUES ('deleted-migration-recipe', ?, ?, ?)
    `).run(NOW, NOW, NOW).lastInsertRowid);
    const before = writeCounts();
    const deleted = await getJson(`/api/recipes/${deletedRecipeId}/technical-profile/migration-dry-run`);
    assert.equal(deleted.response.status, 404);
    assert.equal(deleted.payload.code, 'recipe_not_found');
    const malformed = await getJson('/api/recipes/technical-profile/migration-dry-run?limit=101');
    assert.equal(malformed.response.status, 400);
    assert.equal(malformed.payload.code, 'technical_profile_migration_query_invalid');
    assert.deepEqual(writeCounts(), before);
});

test('migration dry-run HTTP preserves canonical state and reports migrated fingerprint drift without writes', async () => {
    const matchingId = seed();
    const initial = await getJson(`/api/recipes/${matchingId}/technical-profile/migration-dry-run`);
    const migrationFingerprint = initial.payload.data.migrationFingerprint;
    const migrationVersion = initial.payload.data.migrationVersion;
    insertCanonicalPair(matchingId, {
        migrationState: 'AUTO_MIGRATED', migrationVersion, migrationFingerprint,
    });
    const storedReviewId = seed();
    insertCanonicalPair(storedReviewId, { migrationState: 'NEEDS_OWNER_REVIEW' });
    const before = writeCounts();

    const matching = await getJson(`/api/recipes/${matchingId}/technical-profile/migration-dry-run`);
    assert.equal(matching.response.status, 200);
    assert.equal(matching.payload.data.classification, 'ALREADY_CANONICAL');
    assert.equal(matching.payload.data.migrationFingerprint, migrationFingerprint);
    assert.equal(matching.payload.data.target.writeEligible, false);

    db.prepare(`UPDATE recipes SET technical_data_json = '{"rotorDiameter":53,"upperBearing":"202"}' WHERE id = ?`).run(matchingId);
    const drift = await getJson(`/api/recipes/${matchingId}/technical-profile/migration-dry-run`);
    assert.equal(drift.response.status, 200);
    assert.equal(drift.payload.data.classification, 'NEEDS_OWNER_REVIEW');
    assert.ok(drift.payload.data.reasons.some(reason => reason.code === 'MIGRATION_SOURCE_CHANGED'));
    assert.equal(drift.payload.data.target.writeEligible, false);

    const queue = await getJson('/api/recipes/technical-profile/migration-review-queue?limit=100&offset=0');
    assert.equal(queue.response.status, 200);
    assert.ok(queue.payload.data.items.some(item => item.recipeId === storedReviewId));
    assert.ok(queue.payload.data.items.some(item => item.recipeId === matchingId));
    assert.deepEqual(writeCounts(), before);
});
