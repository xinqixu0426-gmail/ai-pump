const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDatabaseDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pump-purchase-batch-http-')
);
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(
    testDatabaseDirectory,
    'pump-{pid}.db'
);
process.env.JWT_SECRET = 'purchase-batch-http-integration-secret';

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../api/authMiddleware.cjs');
const ordersRouter = require('../api/routes/orders.cjs');
const { db, stopBackupScheduler } = require('../api/db.cjs');

let server;
let baseUrl;
let authCookie;

function requestCookie() {
    const token = jwt.sign(
        { id: 1, username: 'purchase-http-admin', role: 'admin' },
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
    return { response, payload: await response.json() };
}

function supplierBatchInput() {
    return {
        supplier: 'HTTP供应商',
        purchased: true,
        tasks: [
            { identityKey: 'part:9101', model: 'HTTP-P-1', supplier: 'HTTP供应商' },
            { identityKey: 'part:9102', model: 'HTTP-P-2', supplier: 'HTTP供应商' },
        ],
    };
}

test.before(async () => {
    const now = '2026-08-31T00:00:00.000Z';
    db.prepare(`
        INSERT INTO parts (id, model, category, price, supplier, stock, created_at, updated_at)
        VALUES (?, ?, 'HTTP测试', 5, 'HTTP供应商', 0, ?, ?)
    `).run(9101, 'HTTP-P-1', now, now);
    db.prepare(`
        INSERT INTO parts (id, model, category, price, supplier, stock, created_at, updated_at)
        VALUES (?, ?, 'HTTP测试', 6, 'HTTP供应商', 0, ?, ?)
    `).run(9102, 'HTTP-P-2', now, now);
    const itemsJson = qty => JSON.stringify([{
        recipeName: 'HTTP测试水泵',
        qty,
        partsJson: JSON.stringify([
            { partId: 9101, model: 'HTTP-P-1', name: 'HTTP零件一', supplier: 'HTTP供应商', qty: 1, inventoryQty: 1 },
            { partId: 9102, model: 'HTTP-P-2', name: 'HTTP零件二', supplier: 'HTTP供应商', qty: 2, inventoryQty: 1 },
        ]),
    }]);
    const insertOrder = db.prepare(`
        INSERT INTO orders (
            id, customer_name, contract_no, status, items_json,
            purchase_list_json, todos_json, created_at, updated_at
        ) VALUES (?, ?, ?, '待采购', ?, '[]', '[]', ?, ?)
    `);
    insertOrder.run(9201, 'HTTP客户一', 'HTTP-C-1', itemsJson(2), now, now);
    insertOrder.run(9202, 'HTTP客户二', 'HTTP-C-2', itemsJson(3), now, now);

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api', authMiddleware);
    app.use('/api/orders', ordersRouter);
    server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    authCookie = requestCookie();
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

test('供应商多物料通过真实 HTTP Preview→Command 原子下单并支持幂等重放', async () => {
    const anonymous = await requestJson(
        'POST',
        '/api/orders/purchase-items/batch-draft',
        { authenticated: false, body: supplierBatchInput() }
    );
    assert.equal(anonymous.response.status, 401);
    assert.equal(anonymous.payload.success, false);

    const preview = await requestJson(
        'POST',
        '/api/orders/purchase-items/batch-draft',
        { body: supplierBatchInput() }
    );
    assert.equal(preview.response.status, 200);
    assert.equal(preview.payload.success, true);
    assert.equal(preview.payload.data.tasks.length, 2);
    assert.equal(preview.payload.data.affectedOrders.length, 2);
    assert.equal(preview.payload.data.affectedItems.length, 4);

    const commandBody = {
        ...supplierBatchInput(),
        expectedVersions: preview.payload.data.expectedVersions,
        previewHash: preview.payload.data.previewHash,
    };
    const headers = { 'idempotency-key': 'purchase-http:supplier-batch:success' };
    const command = await requestJson(
        'POST',
        '/api/orders/purchase-items/batch',
        { headers, body: commandBody }
    );
    assert.equal(command.response.status, 200);
    assert.equal(command.payload.success, true);
    assert.equal(command.payload.data.status, 'completed');
    assert.equal(command.payload.data.updatedCount, 2);
    assert.equal(command.payload.data.auditIds.length, 2);

    const replay = await requestJson(
        'POST',
        '/api/orders/purchase-items/batch',
        { headers, body: commandBody }
    );
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.data.idempotentReplay, true);

    const rows = db.prepare('SELECT status, purchase_list_json FROM orders WHERE id IN (9201, 9202)').all();
    assert.equal(rows.length, 2);
    for (const row of rows) {
        assert.equal(row.status, '采购中');
        assert.ok(JSON.parse(row.purchase_list_json).every(item => item.orderedQty === item.plannedQty));
    }
});

test('供应商多物料 HTTP 请求拒绝混合供应商并返回 400', async () => {
    const invalid = await requestJson(
        'POST',
        '/api/orders/purchase-items/batch-draft',
        {
            body: {
                purchased: true,
                tasks: [
                    { model: 'HTTP-P-1', supplier: 'HTTP供应商' },
                    { model: 'HTTP-P-X', supplier: '其他供应商' },
                ],
            },
        }
    );
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.payload.success, false);
    assert.equal(invalid.payload.code, 'purchase_supplier_mismatch');
});

test('供应商多物料 HTTP 预览在任一任务失效时返回 409 且不部分处理', async () => {
    const invalid = await requestJson(
        'POST',
        '/api/orders/purchase-items/batch-draft',
        {
            body: {
                purchased: true,
                tasks: [
                    supplierBatchInput().tasks[0],
                    { identityKey: 'part:9999', model: 'HTTP-P-X', supplier: 'HTTP供应商' },
                ],
            },
        }
    );
    assert.equal(invalid.response.status, 409);
    assert.equal(invalid.payload.success, false);
    assert.equal(invalid.payload.code, 'purchase_task_unavailable');
});
