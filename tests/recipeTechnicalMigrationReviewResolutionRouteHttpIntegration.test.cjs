const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-recipe-technical-review-http-'));
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(directory, 'pump-{pid}.db');
process.env.JWT_SECRET = 'recipe-technical-review-http-test-secret';
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../api/authMiddleware.cjs');
const recipesRouter = require('../api/routes/recipes.cjs');
const { db, stopBackupScheduler } = require('../api/db.cjs');
const NOW = '2026-09-28T00:00:00.000Z';
let server; let baseUrl; let sequence = 0;
const AUTH_COOKIE = `token=${jwt.sign({ id: 1, username: 'review-http', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' })}`;
async function request(method, pathname, body) { const response = await fetch(`${baseUrl}${pathname}`, { method, headers: { accept: 'application/json', 'content-type': 'application/json', connection: 'close', cookie: AUTH_COOKIE }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) }); return { response, payload: await response.json() }; }
function seed() {
    sequence += 1;
    const shellId = Number(db.prepare(`INSERT INTO parts (model, category, remark, created_at, updated_at) VALUES (?, '泵壳', '{"isStainless":true,"openOffset":18}', ?, ?)`)
        .run(`review-shell-${sequence}`, NOW, NOW).lastInsertRowid);
    db.prepare(`INSERT INTO parts (model, category, created_at, updated_at) VALUES ('轴承-6202', '轴承', ?, ?), ('轴承-6303', '轴承', ?, ?)`)
        .run(NOW, NOW, NOW, NOW);
    const templateId = Number(db.prepare(`INSERT INTO pump_shell_templates (shell_model, created_at, updated_at) VALUES (?, ?, ?)`)
        .run(`review-template-${sequence}`, NOW, NOW).lastInsertRowid);
    db.prepare(`INSERT INTO catalog_template_shell_bindings (template_id, shell_part_id, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(templateId, shellId, NOW, NOW);
    return Number(db.prepare(`INSERT INTO recipes (name, template_id, coil_sheets, custom_barrel_length, impeller_thickness, technical_data_json, created_at, updated_at) VALUES (?, ?, 160, 120, 3, ?, ?, ?)`)
        .run(`review-recipe-${sequence}`, templateId, JSON.stringify({ rotorDiameter: 52, stackOffset: 1, oilSealDiameter: 20, impellerBoreDiameter: 12, impellerSpan: 24, impellerDepth: 3, threadLength: 14, threadDiameter: 8, upperBearing: '202', lowerBearing: '6303', bearingSpan: 80 }), NOW, NOW).lastInsertRowid);
}
function counts() { return Object.fromEntries(['recipe_functional_technical_profiles', 'recipe_technical_knowledge', 'audit_log', 'business_change_events', 'api_operations'].map(table => [table, Number(db.prepare(`SELECT count(*) count FROM ${table}`).get().count)])); }
test.before(async () => { const app = express(); app.use(express.json()); app.use(cookieParser()); app.use('/api', authMiddleware); app.use('/api/recipes', recipesRouter); server = app.listen(0, '127.0.0.1'); await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { stopBackupScheduler(); server?.closeAllConnections?.(); if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); if (db.open) db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('HTTP Owner review preview and resolve create only canonical rows, then replay idempotently', async () => {
    const recipeId = seed();
    const legacy = db.prepare(`SELECT technical_data_json, custom_barrel_length FROM recipes WHERE id = ?`).get(recipeId);
    const plan = await request('POST', `/api/recipes/${recipeId}/technical-profile/migration-review-preview`, { resolution: { openOffset: 20 } });
    assert.equal(plan.response.status, 200); assert.equal(plan.payload.data.preview, true); assert.ok(plan.payload.data.confirmationToken);
    const result = await request('POST', `/api/recipes/${recipeId}/technical-profile/migration-review-resolve`, { confirmationToken: plan.payload.data.confirmationToken, idempotencyKey: 'review-http-idempotency-0001' });
    assert.equal(result.response.status, 200); assert.equal(result.payload.data.status, 'completed'); assert.equal(result.payload.data.migrationStateAfter, 'ALREADY_CANONICAL');
    assert.deepEqual(db.prepare(`SELECT technical_data_json, custom_barrel_length FROM recipes WHERE id = ?`).get(recipeId), legacy);
    const after = counts();
    const replay = await request('POST', `/api/recipes/${recipeId}/technical-profile/migration-review-resolve`, { confirmationToken: plan.payload.data.confirmationToken, idempotencyKey: 'review-http-idempotency-0001' });
    assert.equal(replay.response.status, 200); assert.equal(replay.payload.data.idempotentReplay, true); assert.deepEqual(counts(), after);
});
test('HTTP rejects incomplete Owner decisions without any mutation', async () => {
    const recipeId = seed(); const before = counts();
    const response = await request('POST', `/api/recipes/${recipeId}/technical-profile/migration-review-preview`, { resolution: {} });
    assert.equal(response.response.status, 409); assert.equal(response.payload.code, 'technical_profile_migration_review_incomplete'); assert.deepEqual(counts(), before);
});
