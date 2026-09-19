const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDatabaseDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pump-part-route-http-')
);
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(
    testDatabaseDirectory,
    'pump-{pid}.db'
);
process.env.JWT_SECRET = 'part-route-http-integration-secret';

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const typescript = require('../apps/web-next/node_modules/typescript');
const authMiddleware = require('../api/authMiddleware.cjs');
const partsRouter = require('../api/routes/parts.cjs');
const { db, stopBackupScheduler } = require('../api/db.cjs');

let server;
let baseUrl;
let primaryCookie;
let secondaryCookie;

const partsClientSource = typescript.transpileModule(
    fs.readFileSync(path.join(__dirname, '..', 'apps', 'web-next', 'lib', 'parts.ts'), 'utf8'),
    {
        compilerOptions: {
            module: typescript.ModuleKind.CommonJS,
            target: typescript.ScriptTarget.ES2020,
        },
    }
).outputText;

function loadLivePartsClient() {
    const loaded = { exports: {} };
    const api = {
        createIdempotencyKey(prefix) {
            return `${prefix}:http:${Date.now()}:${Math.random()}`;
        },
        async proxyRequest(pathname, options = {}) {
            const response = await fetch(`${baseUrl}${pathname}`, {
                ...options,
                headers: {
                    accept: 'application/json',
                    connection: 'close',
                    cookie: primaryCookie,
                    ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
                    ...(options.headers || {}),
                },
                signal: AbortSignal.timeout(5000),
            });
            return response.json();
        },
    };
    new Function('exports', 'require', 'module', partsClientSource)(
        loaded.exports,
        request => {
            if (request === './api') return api;
            throw new Error(`不允许的测试依赖: ${request}`);
        },
        loaded,
    );
    return loaded.exports;
}

function authCookie(userId) {
    const token = jwt.sign(
        { id: userId, username: `part-http-${userId}`, role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
    );
    return `token=${token}`;
}

async function requestJson(method, pathname, options = {}) {
    const headers = {
        accept: 'application/json',
        connection: 'close',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.authenticated === false ? {} : { cookie: options.cookie || primaryCookie }),
        ...(options.headers || {}),
    };
    const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(5000),
    });
    const payload = await response.json();
    return { response, payload };
}

async function createPart(model, stock = 5) {
    const result = await requestJson('POST', '/api/parts', {
        headers: { 'idempotency-key': `part-http-create:${model}` },
        body: {
            model,
            category: 'HTTP集成测试',
            subcategory: '',
            price: 10,
            supplier: 'HTTP测试供应商',
            stock,
            notes: '',
        },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.success, true);
    assert.equal(result.payload.data.status, 'completed');
    assert.ok(result.payload.data.updatedAt);
    return result.payload.data;
}

test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api', authMiddleware);
    app.use('/api/parts', partsRouter);
    server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    primaryCookie = authCookie(1);
    secondaryCookie = authCookie(2);
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

test('零件资料保存真实 HTTP 链路绑定认证主体、幂等键和标准回执', async () => {
    const part = await createPart('HTTP-PROFILE-SAVE', 6);
    const floatSetting = db.prepare(`
        SELECT value, updated_at
        FROM system_settings
        WHERE key = 'float_accessory_delta'
    `).get();
    const saveInput = {
        model: part.model,
        category: part.category,
        subcategory: part.subcategory,
        price: 12.5,
        supplier: part.supplier,
        stock: 9,
        notes: '真实 HTTP 保存',
        expectedUpdatedAt: part.updatedAt,
        businessSettings: [{
            key: 'float_accessory_delta',
            value: '0.8',
            expectedUpdatedAt: floatSetting.updated_at,
        }],
    };

    const anonymous = await requestJson(
        'POST',
        `/api/parts/${part.id}/save-preview`,
        { authenticated: false, body: saveInput }
    );
    assert.equal(anonymous.response.status, 401);
    assert.equal(anonymous.payload.success, false);

    const preview = await requestJson(
        'POST',
        `/api/parts/${part.id}/save-preview`,
        { body: saveInput }
    );
    assert.equal(preview.response.status, 200);
    assert.equal(preview.payload.success, true);
    assert.equal(preview.payload.data.capabilityId, 'parts.save_profile');
    assert.ok(preview.payload.data.confirmationToken);
    assert.ok(preview.payload.data.suggestedIdempotencyKey);

    const missingIdempotency = await requestJson(
        'POST',
        `/api/parts/${part.id}/save`,
        { body: { confirmationToken: preview.payload.data.confirmationToken } }
    );
    assert.equal(missingIdempotency.response.status, 400);
    assert.equal(missingIdempotency.payload.code, 'idempotency_key_required');

    const subjectMismatch = await requestJson(
        'POST',
        `/api/parts/${part.id}/save`,
        {
            cookie: secondaryCookie,
            headers: {
                'idempotency-key': preview.payload.data.suggestedIdempotencyKey,
            },
            body: { confirmationToken: preview.payload.data.confirmationToken },
        }
    );
    assert.equal(subjectMismatch.response.status, 403);
    assert.equal(subjectMismatch.payload.code, 'confirmation_subject_mismatch');

    const commandOptions = {
        headers: {
            'idempotency-key': preview.payload.data.suggestedIdempotencyKey,
        },
        body: { confirmationToken: preview.payload.data.confirmationToken },
    };
    const saved = await requestJson(
        'POST',
        `/api/parts/${part.id}/save`,
        commandOptions
    );
    assert.equal(saved.response.status, 200);
    assert.equal(saved.payload.success, true);
    assert.equal(saved.payload.data.status, 'completed');
    assert.equal(saved.payload.data.operationStatus, 'completed');
    assert.equal(saved.payload.data.capabilityId, 'parts.save_profile');
    assert.equal(saved.payload.data.id, part.id);
    assert.equal(saved.payload.data.model, part.model);
    assert.equal(saved.payload.data.stock, 9);
    assert.equal(saved.payload.data.businessSettings[0].key, 'float_accessory_delta');
    assert.equal(saved.payload.data.businessSettings[0].value, '0.8');
    assert.ok(saved.payload.data.operationId);
    assert.ok(saved.payload.data.auditIds.length >= 2);
    assert.equal(
        db.prepare("SELECT value FROM system_settings WHERE key = 'float_accessory_delta'").get().value,
        '0.8'
    );

    const replay = await requestJson(
        'POST',
        `/api/parts/${part.id}/save`,
        commandOptions
    );
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.data.idempotentReplay, true);
    assert.equal(replay.payload.data.operationId, saved.payload.data.operationId);
});

test('零件页面规范字段经真实 HTTP 创建、编辑和回读保持一致', async () => {
    const client = loadLivePartsClient();
    const created = await client.createPart({
        model: 'HTTP-CANONICAL-ROUNDTRIP',
        category: 'HTTP集成测试',
        catalogUnitCost: 18.6,
        supplier: '规范字段供应商',
        stock: 4,
        remark: '规范备注-创建',
    });

    assert.equal(created.catalogUnitCost, 18.6);
    assert.equal(created.remark, '规范备注-创建');
    const afterCreate = (await client.getAllParts()).find(part => part.id === created.id);
    assert.equal(afterCreate.catalogUnitCost, 18.6);
    assert.equal(afterCreate.remark, '规范备注-创建');

    const updated = await client.updatePart(afterCreate, {
        model: afterCreate.model,
        category: afterCreate.category,
        subcategory: afterCreate.subcategory,
        catalogUnitCost: 21.35,
        supplier: afterCreate.supplier,
        stock: afterCreate.stock,
        remark: '规范备注-编辑',
    });
    assert.equal(updated.catalogUnitCost, 21.35);
    assert.equal(updated.remark, '规范备注-编辑');

    const afterUpdate = (await client.getAllParts()).find(part => part.id === created.id);
    assert.equal(afterUpdate.catalogUnitCost, 21.35);
    assert.equal(afterUpdate.remark, '规范备注-编辑');
    assert.equal(afterUpdate.price, undefined);
    assert.equal(afterUpdate.notes, undefined);
});

test('零件批量删除真实 HTTP 链路在版本冲突时整批回滚并可安全重放', async () => {
    const first = await createPart('HTTP-BATCH-DELETE-A', 2);
    const second = await createPart('HTTP-BATCH-DELETE-B', 3);
    const originalItems = [first, second].map(part => ({
        partId: part.id,
        expectedUpdatedAt: part.updatedAt,
    }));
    const anonymousPreview = await requestJson(
        'POST',
        '/api/parts/batch-delete-preview',
        { authenticated: false, body: { parts: originalItems } }
    );
    assert.equal(anonymousPreview.response.status, 401);
    assert.equal(anonymousPreview.payload.success, false);

    const stalePreview = await requestJson('POST', '/api/parts/batch-delete-preview', {
        body: { parts: originalItems },
    });
    assert.equal(stalePreview.response.status, 200);
    assert.equal(stalePreview.payload.data.deleteCount, 2);

    const changed = await requestJson('PATCH', `/api/parts/${first.id}`, {
        headers: { 'idempotency-key': 'part-http-version-change:first' },
        body: {
            price: 11,
            expectedUpdatedAt: first.updatedAt,
        },
    });
    assert.equal(changed.response.status, 200);
    assert.ok(changed.payload.data.updatedAt);
    assert.notEqual(changed.payload.data.updatedAt, first.updatedAt);

    const anonymousCommand = await requestJson('POST', '/api/parts/batch-delete', {
        authenticated: false,
        headers: {
            'idempotency-key': stalePreview.payload.data.suggestedIdempotencyKey,
        },
        body: { confirmationToken: stalePreview.payload.data.confirmationToken },
    });
    assert.equal(anonymousCommand.response.status, 401);
    assert.equal(anonymousCommand.payload.success, false);

    const subjectMismatch = await requestJson('POST', '/api/parts/batch-delete', {
        cookie: secondaryCookie,
        headers: {
            'idempotency-key': stalePreview.payload.data.suggestedIdempotencyKey,
        },
        body: { confirmationToken: stalePreview.payload.data.confirmationToken },
    });
    assert.equal(subjectMismatch.response.status, 403);
    assert.equal(subjectMismatch.payload.code, 'confirmation_subject_mismatch');

    const staleCommand = await requestJson('POST', '/api/parts/batch-delete', {
        headers: {
            'idempotency-key': stalePreview.payload.data.suggestedIdempotencyKey,
        },
        body: { confirmationToken: stalePreview.payload.data.confirmationToken },
    });
    assert.equal(staleCommand.response.status, 409);
    assert.equal(staleCommand.payload.success, false);

    const afterConflict = await requestJson('GET', '/api/parts');
    const liveIds = new Set(afterConflict.payload.data.map(part => part.id));
    assert.equal(liveIds.has(first.id), true);
    assert.equal(liveIds.has(second.id), true);

    const freshPreview = await requestJson('POST', '/api/parts/batch-delete-preview', {
        body: {
            parts: [{
                partId: first.id,
                expectedUpdatedAt: changed.payload.data.updatedAt,
            }, {
                partId: second.id,
                expectedUpdatedAt: second.updatedAt,
            }],
        },
    });
    assert.equal(freshPreview.response.status, 200);
    const commandOptions = {
        headers: {
            'idempotency-key': freshPreview.payload.data.suggestedIdempotencyKey,
        },
        body: { confirmationToken: freshPreview.payload.data.confirmationToken },
    };
    const deleted = await requestJson(
        'POST',
        '/api/parts/batch-delete',
        commandOptions
    );
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.payload.success, true);
    assert.equal(deleted.payload.data.status, 'completed');
    assert.equal(deleted.payload.data.deletedCount, 2);
    assert.deepEqual(
        [...deleted.payload.data.partIds].sort((a, b) => a - b),
        [first.id, second.id].sort((a, b) => a - b)
    );
    assert.equal(deleted.payload.data.auditIds.length, 2);

    const replay = await requestJson(
        'POST',
        '/api/parts/batch-delete',
        commandOptions
    );
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.data.idempotentReplay, true);
    assert.equal(replay.payload.data.operationId, deleted.payload.data.operationId);

    const afterDelete = await requestJson('GET', '/api/parts');
    const remainingIds = new Set(afterDelete.payload.data.map(part => part.id));
    assert.equal(remainingIds.has(first.id), false);
    assert.equal(remainingIds.has(second.id), false);
});
