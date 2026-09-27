const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-recipe-technical-profile-http-'));
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(directory, 'pump-{pid}.db');
process.env.JWT_SECRET = 'recipe-technical-profile-http-test-secret';

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

function authCookie() {
    return `token=${jwt.sign({ id: 1, username: 'technical-profile-http', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' })}`;
}

async function requestJson(method, pathname, body, headers = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: {
            accept: 'application/json', connection: 'close', cookie,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
    });
    return { response, payload: await response.json() };
}

function seed() {
    const shellPartId = Number(db.prepare(`
        INSERT INTO parts (model, category, remark, created_at, updated_at)
        VALUES ('http-shell', '泵壳', '{"isStainless":true}', ?, ?)
    `).run(NOW, NOW).lastInsertRowid);
    const bearingPartId = Number(db.prepare(`
        INSERT INTO parts (model, category, created_at, updated_at)
        VALUES ('轴承-6202', '轴承', ?, ?)
    `).run(NOW, NOW).lastInsertRowid);
    const templateId = Number(db.prepare(`
        INSERT INTO pump_shell_templates (shell_model, created_at, updated_at)
        VALUES ('http-template', ?, ?)
    `).run(NOW, NOW).lastInsertRowid);
    db.prepare(`
        INSERT INTO catalog_template_shell_bindings (template_id, shell_part_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
    `).run(templateId, shellPartId, NOW, NOW);
    const recipeId = Number(db.prepare(`
        INSERT INTO recipes (name, template_id, technical_data_json, custom_barrel_length, created_at, updated_at)
        VALUES ('http-recipe', ?, '{"rotorDiameter":999}', 88, ?, ?)
    `).run(templateId, NOW, NOW).lastInsertRowid);
    return { bearingPartId, recipeId };
}

function payload(bearingPartId, expectedUpdatedAt = null) {
    return {
        expectedUpdatedAt,
        functional: {
            rotorDiameter: 52, stackOffset: 1, oilSealDiameter: 20,
            impellerBoreDiameter: 12, impellerSpan: 24, impellerThickness: 3,
            threadLength: 14, threadDiameter: 8, barrelLength: 120,
            openOffset: 20, bearingSpanExplicit: null,
            upperBearingPartId: bearingPartId, lowerBearingPartId: bearingPartId,
        },
        technicalKnowledge: { items: [{ key: 'future_new_field', label: '未来字段', value: 'kept generic' }] },
    };
}

test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api', authMiddleware);
    app.use('/api/recipes', recipesRouter);
    server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
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

test('canonical technical-profile HTTP API is independent, strict, idempotent, and leaves legacy Recipe storage untouched', async () => {
    const { recipeId, bearingPartId } = seed();
    const absent = await requestJson('GET', `/api/recipes/${recipeId}/technical-profile`);
    assert.equal(absent.response.status, 200);
    assert.equal(absent.payload.data.canonicalPresent, false);
    assert.equal(absent.payload.data.functional, null);
    const legacyBefore = db.prepare('SELECT technical_data_json, custom_barrel_length FROM recipes WHERE id = ?').get(recipeId);

    const first = await requestJson('PUT', `/api/recipes/${recipeId}/technical-profile`, payload(bearingPartId), { 'idempotency-key': 'recipe-technical-http:001' });
    assert.equal(first.response.status, 200);
    assert.equal(first.payload.success, true);
    assert.equal(first.payload.data.capabilityId, 'recipes.technical_profile.update');
    assert.equal(first.payload.data.technicalProfile.functional.bearingSpan, 100);
    assert.equal(first.payload.data.technicalProfile.functional.bearingSpanSource, 'DERIVED');
    assert.equal(first.payload.data.technicalProfile.technicalKnowledge.items[0].key, 'future_new_field');
    assert.equal(first.payload.data.auditIds.length, 2);
    const current = first.payload.data.technicalProfile.updatedAt;
    assert.deepEqual(db.prepare('SELECT technical_data_json, custom_barrel_length FROM recipes WHERE id = ?').get(recipeId), legacyBefore);

    const replay = await requestJson('PUT', `/api/recipes/${recipeId}/technical-profile`, payload(bearingPartId), { 'idempotency-key': 'recipe-technical-http:001' });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.data.idempotentReplay, true);
    const missingVersion = await requestJson('PUT', `/api/recipes/${recipeId}/technical-profile`, payload(bearingPartId), { 'idempotency-key': 'recipe-technical-http:002' });
    assert.equal(missingVersion.response.status, 409);
    assert.equal(missingVersion.payload.code, 'technical_profile_version_required');
    const stale = await requestJson('PUT', `/api/recipes/${recipeId}/technical-profile`, payload(bearingPartId, '2020-01-01T00:00:00.000Z'), { 'idempotency-key': 'recipe-technical-http:003' });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.payload.code, 'technical_profile_version_conflict');
    const readback = await requestJson('GET', `/api/recipes/${recipeId}/technical-profile`);
    assert.equal(readback.payload.data.updatedAt, current);
    assert.equal(readback.payload.data.bearingReferences.upper.partId, bearingPartId);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries').get().count, 0);
});

test('canonical technical-profile HTTP query/command returns deterministic errors for missing Recipe', async () => {
    const missingGet = await requestJson('GET', '/api/recipes/999999/technical-profile');
    assert.equal(missingGet.response.status, 404);
    assert.equal(missingGet.payload.code, 'recipe_not_found');
    const missingPut = await requestJson('PUT', '/api/recipes/999999/technical-profile', { functional: {}, technicalKnowledge: { items: [] }, expectedUpdatedAt: null }, { 'idempotency-key': 'recipe-technical-http:404' });
    assert.equal(missingPut.response.status, 404);
    assert.equal(missingPut.payload.code, 'recipe_not_found');
});
