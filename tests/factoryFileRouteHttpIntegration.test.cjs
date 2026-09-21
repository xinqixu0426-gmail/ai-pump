const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDatabaseDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pump-file-route-http-')
);
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(
    testDatabaseDirectory,
    'pump-{pid}.db'
);
process.env.JWT_SECRET = 'file-route-http-integration-secret';

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../api/authMiddleware.cjs');
const filesRouter = require('../api/routes/files.cjs');
const {
    db,
    stopBackupScheduler,
} = require('../api/db.cjs');
const {
    MAX_FACTORY_FILE_SIZE,
} = require('../api/services/factoryFileStore.cjs');
const {
    resetBusinessConfirmationsForTests,
} = require('../api/services/businessConfirmation.cjs');

let server;
let baseUrl;
let authenticatedCookie;

function authCookie() {
    const token = jwt.sign(
        { id: 1, username: 'file-http-user', role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
    );
    return `token=${token}`;
}

function createRecipe(name) {
    const now = new Date().toISOString();
    return Number(db.prepare(`
        INSERT INTO recipes (name, spec, created_at, updated_at, deleted_at)
        VALUES (?, 'HTTP', ?, ?, NULL)
    `).run(name, now, now).lastInsertRowid);
}

function attachmentForm({
    buffer,
    filename,
    recipeId,
    confirmationToken,
} = {}) {
    const form = new FormData();
    if (buffer !== undefined) {
        form.append('file', new Blob([buffer], { type: 'text/csv' }), filename || 'report.csv');
    }
    if (recipeId) {
        form.append('targetType', 'recipe');
        form.append('targetId', String(recipeId));
        form.append('relationRole', 'technical_reference');
        form.append('title', 'HTTP 测试报告');
        form.append('note', 'multipart 字段解析');
        form.append('source', 'business_page');
    }
    if (confirmationToken) form.append('confirmationToken', confirmationToken);
    return form;
}

async function requestMultipart(pathname, form, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: {
            accept: 'application/json',
            connection: 'close',
            ...(options.authenticated === false ? {} : { cookie: authenticatedCookie }),
            ...(options.headers || {}),
        },
        body: form,
        signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json();
    return { response, payload };
}

test.before(async () => {
    const app = express();
    app.use(cookieParser());
    app.use('/api', authMiddleware);
    app.use('/api/files', filesRouter);
    server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    authenticatedCookie = authCookie();
});

test.beforeEach(() => {
    resetBusinessConfirmationsForTests();
});

test.after(async () => {
    resetBusinessConfirmationsForTests();
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

test('业务附件 multipart 路由拒绝未登录、空文件和超限文件且不写库', async () => {
    const filesBefore = db.prepare('SELECT COUNT(*) AS count FROM factory_files').get().count;
    const linksBefore = db.prepare('SELECT COUNT(*) AS count FROM factory_file_links').get().count;
    const recipeId = createRecipe('HTTP-FILE-VALIDATION');
    const anonymous = await requestMultipart(
        '/api/files/business-attachment-preview',
        attachmentForm({
            buffer: Buffer.from('model,qty\nA,1', 'utf8'),
            filename: 'anonymous.csv',
            recipeId,
        }),
        { authenticated: false }
    );
    assert.equal(anonymous.response.status, 401);
    assert.equal(anonymous.payload.success, false);

    const empty = await requestMultipart(
        '/api/files/business-attachment-preview',
        attachmentForm({
            buffer: Buffer.alloc(0),
            filename: 'empty.csv',
            recipeId,
        })
    );
    assert.equal(empty.response.status, 400);
    assert.equal(empty.payload.success, false);
    assert.equal(empty.payload.error, '请选择文件');

    const oversized = await requestMultipart(
        '/api/files/business-attachment-preview',
        attachmentForm({
            buffer: Buffer.alloc(MAX_FACTORY_FILE_SIZE + 1, 0x61),
            filename: 'oversized.txt',
            recipeId,
        })
    );
    assert.equal(oversized.response.status, 400);
    assert.equal(oversized.payload.success, false);
    assert.equal(oversized.payload.error, '文件不能超过 10MB');

    assert.equal(
        db.prepare('SELECT COUNT(*) AS count FROM factory_files').get().count,
        filesBefore
    );
    assert.equal(
        db.prepare('SELECT COUNT(*) AS count FROM factory_file_links').get().count,
        linksBefore
    );
});

test('业务附件 multipart Preview→Command 绑定文件内容并组装解析和幂等回执', async () => {
    const filesBefore = db.prepare('SELECT COUNT(*) AS count FROM factory_files').get().count;
    const linksBefore = db.prepare('SELECT COUNT(*) AS count FROM factory_file_links').get().count;
    const recipeId = createRecipe('HTTP-FILE-COMMAND');
    const originalBuffer = Buffer.from('model,qty\nA,1', 'utf8');
    const preview = await requestMultipart(
        '/api/files/business-attachment-preview',
        attachmentForm({
            buffer: originalBuffer,
            filename: 'report.csv',
            recipeId,
        })
    );
    assert.equal(preview.response.status, 200);
    assert.equal(preview.payload.success, true);
    assert.equal(preview.payload.data.capabilityId, 'files.upload_business_attachment');
    assert.equal(preview.payload.data.file.detectedType, 'spreadsheet');
    assert.equal(preview.payload.data.target.id, recipeId);
    assert.ok(preview.payload.data.confirmationToken);
    assert.ok(preview.payload.data.suggestedIdempotencyKey);

    const confirmationToken = preview.payload.data.confirmationToken;
    const idempotencyKey = preview.payload.data.suggestedIdempotencyKey;
    const anonymousCommand = await requestMultipart(
        '/api/files/business-attachment',
        attachmentForm({
            buffer: originalBuffer,
            filename: 'report.csv',
            confirmationToken,
        }),
        {
            authenticated: false,
            headers: { 'idempotency-key': idempotencyKey },
        }
    );
    assert.equal(anonymousCommand.response.status, 401);
    assert.equal(anonymousCommand.payload.success, false);

    const missingIdempotency = await requestMultipart(
        '/api/files/business-attachment',
        attachmentForm({
            buffer: originalBuffer,
            filename: 'report.csv',
            confirmationToken,
        })
    );
    assert.equal(missingIdempotency.response.status, 400);
    assert.equal(missingIdempotency.payload.code, 'idempotency_key_required');

    const changedFile = await requestMultipart(
        '/api/files/business-attachment',
        attachmentForm({
            buffer: Buffer.from('model,qty\nA,2', 'utf8'),
            filename: 'report.csv',
            confirmationToken,
        }),
        { headers: { 'idempotency-key': idempotencyKey } }
    );
    assert.equal(changedFile.response.status, 409);
    assert.equal(
        changedFile.payload.code,
        'factory_file_business_attachment_preview_changed'
    );
    assert.equal(
        db.prepare('SELECT COUNT(*) AS count FROM factory_files').get().count,
        filesBefore
    );
    assert.equal(
        db.prepare('SELECT COUNT(*) AS count FROM factory_file_links').get().count,
        linksBefore
    );

    const commandForm = () => attachmentForm({
        buffer: originalBuffer,
        filename: 'report.csv',
        confirmationToken,
    });
    const created = await requestMultipart(
        '/api/files/business-attachment',
        commandForm(),
        { headers: { 'idempotency-key': idempotencyKey } }
    );
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.success, true);
    assert.equal(created.payload.data.status, 'completed');
    assert.equal(created.payload.data.capabilityId, 'files.upload_business_attachment');
    assert.equal(created.payload.data.file.originalName, 'report.csv');
    assert.equal(created.payload.data.file.parserStatus, 'parsed');
    assert.equal(created.payload.data.link.targetType, 'recipe');
    assert.equal(created.payload.data.link.targetId, recipeId);
    assert.equal(created.payload.data.link.relationRole, 'technical_reference');
    assert.equal(created.payload.data.link.title, 'HTTP 测试报告');
    assert.equal(created.payload.data.link.note, 'multipart 字段解析');
    assert.equal(created.payload.data.auditIds.length, 2);
    assert.ok(created.payload.data.operationId);
    assert.ok(created.payload.data.parseOperationId);
    assert.equal(created.payload.parseWarning, '');
    assert.equal(created.payload.deduplicated, false);
    const parseOperation = db.prepare(`
        SELECT capability_id, status
        FROM api_operations
        WHERE operation_id = ?
    `).get(created.payload.data.parseOperationId);
    assert.deepEqual(parseOperation, {
        capability_id: 'files.parse',
        status: 'completed',
    });

    const replay = await requestMultipart(
        '/api/files/business-attachment',
        commandForm(),
        { headers: { 'idempotency-key': idempotencyKey } }
    );
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.success, true);
    assert.equal(replay.payload.data.idempotentReplay, true);
    assert.equal(replay.payload.data.operationId, created.payload.data.operationId);
    assert.equal(replay.payload.data.file.id, created.payload.data.file.id);
    assert.equal(replay.payload.data.link.id, created.payload.data.link.id);
    assert.equal(
        db.prepare('SELECT COUNT(*) AS count FROM factory_files').get().count,
        filesBefore + 1
    );
    assert.equal(
        db.prepare('SELECT COUNT(*) AS count FROM factory_file_links').get().count,
        linksBefore + 1
    );
});
