const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDatabaseDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pump-rotor-route-http-')
);
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(
    testDatabaseDirectory,
    'pump-{pid}.db'
);
process.env.JWT_SECRET = 'rotor-route-http-integration-secret';

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../api/authMiddleware.cjs');
const rotorRouter = require('../api/routes/rotor.cjs');
const { db, stopBackupScheduler } = require('../api/db.cjs');

let server;
let baseUrl;
let authCookie;

function jwtCookie() {
    const token = jwt.sign(
        { id: 1, username: 'rotor-http-admin', role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
    );
    return `token=${token}`;
}

async function postPreview(body) {
    const response = await fetch(`${baseUrl}/api/rotor/draw-preview`, {
        method: 'POST',
        headers: {
            accept: 'application/json',
            connection: 'close',
            'content-type': 'application/json',
            cookie: authCookie,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
    });
    return { response, payload: await response.json() };
}

function writeCounts() {
    return {
        drawings: db.prepare('SELECT COUNT(*) AS count FROM rotor_drawings').get().count,
        operations: db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count,
        audits: db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count,
    };
}

test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api', authMiddleware);
    app.use('/api/rotor', rotorRouter);
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

test('转子正式 Preview 通过真实 HTTP 返回全部警报且保持无副作用', async () => {
    const before = writeCounts();
    const preview = await postPreview({
        upper_bearing: '6202',
        piece_count: 160,
        bearing_span: 140,
        stack_offset: 30,
    });

    assert.equal(preview.response.status, 200);
    assert.equal(preview.payload.success, true);
    assert.ok(preview.payload.data.confirmationToken);
    assert.deepEqual(
        preview.payload.data.warnings.map(warning => warning.code),
        ['rotor_length_parameters_incomplete', 'rotor_stator_clearance_low']
    );
    assert.deepEqual(preview.payload.warnings, preview.payload.data.warnings);
    assert.deepEqual(writeCounts(), before);
});

test('转子正式 Preview 通过真实 HTTP 拒绝非数字和越界参数', async () => {
    for (const pieceCount of [true, [], 1001]) {
        const result = await postPreview({
            piece_count: pieceCount,
            bearing_span: 140,
        });
        assert.equal(result.response.status, 400);
        assert.equal(result.payload.success, false);
        assert.equal(result.payload.code, 'rotor_parameters_invalid');
        assert.match(result.payload.error, /转子片数必须是 1–1000 之间的数字/);
    }
});
