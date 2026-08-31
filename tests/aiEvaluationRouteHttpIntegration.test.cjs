const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDatabaseDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pump-ai-evaluation-route-http-')
);
process.env.NODE_ENV = 'test';
process.env.NODE_TEST_CONTEXT = '1';
process.env.PUMP_TEST_DATABASE_PATH = path.join(
    testDatabaseDirectory,
    'pump-{pid}.db'
);
process.env.JWT_SECRET = 'ai-evaluation-route-http-secret';
process.env.INTERNAL_SECRET = 'ai-evaluation-route-internal-secret';

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const evaluationRouter = require('../api/routes/ai/evaluations.cjs');
const { db, stopBackupScheduler } = require('../api/db.cjs');
const {
    AI_RELEASE_RUN_OWNER_KEY,
    CORE_AI_RELEASE_CASE_KEYS,
} = require('../api/services/aiEvaluationReleasePolicy.cjs');

let server;
let baseUrl;
let loginCookie;
let requestSequence = 0;

function authCookie() {
    const token = jwt.sign(
        { id: 1, username: 'evaluation-http-admin', role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
    );
    return `token=${token}`;
}

async function requestJson(method, pathname, options = {}) {
    requestSequence += 1;
    const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: {
            accept: 'application/json',
            connection: 'close',
            'content-type': 'application/json',
            'idempotency-key': `evaluation-http-${requestSequence}`,
            ...(options.internal
                ? { 'x-internal-secret': process.env.INTERNAL_SECRET }
                : options.authenticated === false ? {} : { cookie: loginCookie }),
        },
        body: JSON.stringify(options.body || {}),
        signal: AbortSignal.timeout(5000),
    });
    return { response, payload: await response.json() };
}

test.before(async () => {
    const now = new Date().toISOString();
    db.prepare(`
        INSERT OR REPLACE INTO ai_evaluation_cases (
            case_key, title, category, question, evaluator_type, config_json,
            enabled, release_gate_enabled, sort_order, source_type,
            review_status, confidence_score, created_at, updated_at
        ) VALUES (?, ?, 'HTTP集成', '测试问题', 'rules', '{}', ?, 0, 9990,
                  'feedback', ?, 100, ?, ?)
    `).run('http-disabled-case', 'HTTP停用案例', 0, 'approved', now, now);
    db.prepare(`
        INSERT OR REPLACE INTO ai_evaluation_cases (
            case_key, title, category, question, evaluator_type, config_json,
            enabled, release_gate_enabled, sort_order, source_type,
            review_status, confidence_score, created_at, updated_at
        ) VALUES (?, ?, 'HTTP集成', '测试问题', 'rules', '{}', 1, 0, 9991,
                  'feedback', 'pending', 50, ?, ?)
    `).run('http-pending-case', 'HTTP待审案例', now, now);

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(evaluationRouter);
    server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    loginCookie = authCookie();
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

test('AI 评测 HTTP：认证、单案例错误与 release 完整性使用真实路由契约', async () => {
    const anonymous = await requestJson('POST', '/api/ai/evaluations/runs', {
        authenticated: false,
        body: { scope: 'manual', caseKey: CORE_AI_RELEASE_CASE_KEYS[0] },
    });
    assert.equal(anonymous.response.status, 401);

    const diagnostic = await requestJson('POST', '/api/ai/evaluations/runs', {
        body: { scope: 'manual', caseKey: CORE_AI_RELEASE_CASE_KEYS[0] },
    });
    assert.equal(diagnostic.response.status, 201);
    assert.equal(diagnostic.payload.success, true);
    assert.equal(diagnostic.payload.data.capabilityId, 'ai.evaluations.runs.start');
    assert.deepEqual(
        diagnostic.payload.data.cases.map(item => item.caseKey),
        [CORE_AI_RELEASE_CASE_KEYS[0]]
    );

    for (const [caseKey, expectedStatus, expectedCode] of [
        ['http-missing-case', 404, 'ai_evaluation_case_not_found'],
        ['http-disabled-case', 422, 'ai_evaluation_case_unavailable'],
        ['http-pending-case', 422, 'ai_evaluation_case_unavailable'],
    ]) {
        const result = await requestJson('POST', '/api/ai/evaluations/runs', {
            body: { scope: 'manual', caseKey },
        });
        assert.equal(result.response.status, expectedStatus, caseKey);
        assert.equal(result.payload.code, expectedCode, caseKey);
    }

    const internalManual = await requestJson('POST', '/api/ai/evaluations/runs', {
        internal: true,
        body: { scope: 'manual' },
    });
    assert.equal(internalManual.response.status, 403);
    assert.equal(internalManual.payload.code, 'ai_evaluation_manual_owner_forbidden');

    const filteredRelease = await requestJson('POST', '/api/ai/evaluations/runs', {
        internal: true,
        body: { scope: 'release', caseKey: CORE_AI_RELEASE_CASE_KEYS[0] },
    });
    assert.equal(filteredRelease.response.status, 400);
    assert.equal(
        filteredRelease.payload.code,
        'ai_evaluation_release_case_filter_forbidden'
    );

    db.prepare(`
        UPDATE ai_evaluation_cases SET release_gate_enabled = 0
        WHERE case_key = ?
    `).run(CORE_AI_RELEASE_CASE_KEYS[0]);
    const incompleteRelease = await requestJson('POST', '/api/ai/evaluations/runs', {
        internal: true,
        body: { scope: 'release' },
    });
    assert.equal(incompleteRelease.response.status, 409);
    assert.equal(
        incompleteRelease.payload.code,
        'ai_evaluation_release_cases_incomplete'
    );

    db.prepare(`
        UPDATE ai_evaluation_cases SET enabled = 1, release_gate_enabled = 1,
            review_status = 'approved'
        WHERE case_key = ?
    `).run(CORE_AI_RELEASE_CASE_KEYS[0]);
    const release = await requestJson('POST', '/api/ai/evaluations/runs', {
        internal: true,
        body: { scope: 'release' },
    });
    assert.equal(release.response.status, 201);
    assert.equal(release.payload.success, true);
    assert.equal(
        db.prepare('SELECT owner_key FROM ai_evaluation_runs WHERE id = ?')
            .get(release.payload.data.run.id).owner_key,
        AI_RELEASE_RUN_OWNER_KEY
    );
});
