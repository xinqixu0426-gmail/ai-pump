const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDatabaseDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pump-coil-route-http-')
);
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(
    testDatabaseDirectory,
    'pump-{pid}.db'
);
process.env.JWT_SECRET = 'coil-route-http-integration-secret';

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../api/authMiddleware.cjs');
const coilsRouter = require('../api/routes/coils.cjs');
const costRouter = require('../api/routes/cost.cjs');
const { db, stopBackupScheduler } = require('../api/db.cjs');

let server;
let baseUrl;
let authCookie;

function jwtCookie() {
    const token = jwt.sign(
        { id: 1, username: 'coil-http-admin', role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
    );
    return `token=${token}`;
}

async function requestJson(method, pathname, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: {
            accept: 'application/json',
            connection: 'close',
            ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(options.authenticated === false ? {} : { cookie: authCookie }),
            ...(options.headers || {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(5000),
    });
    const payload = await response.json();
    return { response, payload };
}

test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api', authMiddleware);
    app.use('/api', costRouter);
    app.use('/api/coils', coilsRouter);
    server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    authCookie = jwtCookie();
});

test.after(async () => {
    stopBackupScheduler();
    server?.closeAllConnections?.();
    if (server) {
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
    }
    if (db.open) db.close();
    fs.rmSync(testDatabaseDirectory, { recursive: true, force: true });
});

test('供应商线圈转子套件价贯穿真实 HTTP CRUD 与成本试算', async () => {
    const input = {
        spec: '777',
        diameterMm: 777,
        material: '钢带',
        slotType: '小眼',
        sheets: 987,
        schemeName: 'HTTP套件方案',
        schemeStatus: 'official',
        pricingMode: 'kit',
        kitPrice: 88.5,
        wireWeight: 9.9,
        copperBase: 99,
        coilFee: 12,
        rotorFee: 13,
    };

    const anonymous = await requestJson('POST', '/api/coils', {
        authenticated: false,
        body: input,
    });
    assert.equal(anonymous.response.status, 401);

    const invalid = await requestJson('POST', '/api/coils', {
        headers: { 'idempotency-key': 'coil-http-invalid-kit' },
        body: { ...input, kitPrice: 0 },
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.payload.code, 'coil_kit_price_required');

    const created = await requestJson('POST', '/api/coils', {
        headers: { 'idempotency-key': 'coil-http-create-kit' },
        body: input,
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.payload.success, true);
    assert.equal(created.payload.data.pricingMode, 'kit');
    assert.equal(created.payload.data.kitPrice, 88.5);
    assert.equal(created.payload.data.cost, 88.5);
    assert.equal(created.payload.data.unitPrice, 0);
    assert.equal(created.payload.data.wireWeight, 9.9);
    assert.equal(created.payload.data.copperBase, 99);
    assert.equal(created.payload.data.coilFee, 0);
    assert.equal(created.payload.data.rotorFee, 0);
    const coilId = created.payload.data.id;

    const listed = await requestJson('GET', '/api/coils');
    const listedCoil = listed.payload.data.find(coil => coil.id === coilId);
    assert.equal(listedCoil.pricingMode, 'kit');
    assert.equal(listedCoil.kitPrice, 88.5);

    const calculated = await requestJson('POST', '/api/coils/calculate', {
        body: {
            spec: '777',
            material: '钢带',
            slotType: '小眼',
            sheets: 987,
        },
    });
    assert.equal(calculated.response.status, 200);
    assert.equal(calculated.payload.data.coilId, coilId);
    assert.equal(calculated.payload.data.pricingMode, 'kit');
    assert.equal(calculated.payload.data.kitPrice, 88.5);
    assert.equal(calculated.payload.data.wireWeight, 9.9);
    assert.equal(calculated.payload.data.copperBase, 99);
    assert.equal(calculated.payload.data.totalCost, 88.5);
    assert.equal(calculated.payload.data.formula, '供应商套件价');

    const recipeId = Number(db.prepare(`
        INSERT INTO recipes (name, spec, parts_json, saved_total_cost)
        VALUES ('HTTP套件成本配方', 'HTTP测试', '[]', 0)
    `).run().lastInsertRowid);
    const fullEstimate = await requestJson('POST', '/api/cost/full-estimate', {
        body: {
            recipeId,
            stator: '777-987',
            statorMaterial: '钢带',
            statorSlotType: '小眼',
        },
    });
    assert.equal(fullEstimate.response.status, 200);
    assert.equal(fullEstimate.payload.data.totalCost, '88.50');
    assert.equal(fullEstimate.payload.data.statorCost.coilId, coilId);
    assert.equal(fullEstimate.payload.data.statorCost.inventoryType, 'coil');
    assert.equal(fullEstimate.payload.data.statorCost.pricingMode, 'kit');
    assert.equal(fullEstimate.payload.data.statorCost.kitPrice, 88.5);
    assert.equal(fullEstimate.payload.data.statorCost.wireWeight, 9.9);
    assert.equal(fullEstimate.payload.data.statorCost.copperBase, 99);
    assert.equal(fullEstimate.payload.data.statorCost.formula, '供应商套件价');

    const updated = await requestJson('PATCH', `/api/coils/${coilId}`, {
        headers: { 'idempotency-key': 'coil-http-update-kit' },
        body: {
            kitPrice: 91.25,
            expectedUpdatedAt: created.payload.data.updatedAt,
        },
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.payload.data.pricingMode, 'kit');
    assert.equal(updated.payload.data.kitPrice, 91.25);
    assert.equal(updated.payload.data.wireWeight, 9.9);
    assert.equal(updated.payload.data.copperBase, 99);
    assert.equal(updated.payload.data.cost, 91.25);

    const deleted = await requestJson('DELETE', `/api/coils/${coilId}`, {
        headers: { 'idempotency-key': 'coil-http-delete-kit' },
        body: { expectedUpdatedAt: updated.payload.data.updatedAt },
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.payload.success, true);

    const afterDelete = await requestJson('GET', '/api/coils');
    assert.equal(afterDelete.payload.data.some(coil => coil.id === coilId), false);
});
