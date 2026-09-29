'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');

const OWNER_ENV = Object.freeze({
    ACCESS_PASSWORD: 'synthetic-shared-password',
    JWT_SECRET: 'synthetic-jwt-test-secret',
    INTERNAL_SECRET: 'synthetic-internal-secret',
    PUMP_OWNER_ACCESS_PASSWORD: 'synthetic-owner-credential-only-for-current-architecture-test',
    PUMP_OWNER_SUBJECT: 'synthetic_owner_subject_001',
    AI_V5_OWNER_SUBJECTS: '["synthetic_owner_subject_001"]',
});
Object.assign(process.env, OWNER_ENV);
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');
const { createAiChatRouter } = require('../api/routes/ai/chat.cjs');

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function withServer(options, callback) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(createAiChatRouter(options));
    const server = await listen(app);
    try { return await callback(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise(resolve => server.close(resolve)); }
}

function ownerHeaders() {
    const token = issueOwnerToken(OWNER_ENV.PUMP_OWNER_ACCESS_PASSWORD, OWNER_ENV);
    assert.ok(token, 'owner test token must be issued');
    return { 'content-type': 'application/json', cookie: `token=${token}` };
}

test('public chat is Owner-only and emits Task-free content/done SSE through runAiAssistant', async () => {
    let calls = 0;
    await withServer({
        env: OWNER_ENV,
        writeAllowed: () => false,
        runAiAssistant: async () => { calls += 1; return { status: 'COMPLETED', answer: 'V550 当前成本来自正式工具。' }; },
    }, async base => {
        const denied = await fetch(`${base}/api/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'V550成本？' }] }) });
        assert.equal(denied.status, 401);
        const response = await fetch(`${base}/api/ai/chat`, { method: 'POST', headers: ownerHeaders(), body: JSON.stringify({ messages: [{ role: 'user', content: 'V550成本？' }] }) });
        const body = await response.text();
        assert.equal(response.status, 200);
        assert.match(body, /"type":"content"/);
        assert.match(body, /"type":"done"/);
        assert.doesNotMatch(body, /taskId|planRevision|expectedRevision/);
    });
    assert.equal(calls, 1);
});

test('proposal SSE exposes only task-free business facts and opaque confirmation token', async () => {
    await withServer({
        env: OWNER_ENV,
        writeAllowed: () => true,
        runAiAssistant: async () => ({
            status: 'PROPOSAL_READY', answer: '已生成库存调整方案。',
            proposal: { part: { id: 201, model: 'O型圈-110*2.65' }, currentStock: 8, delta: 3, nextStock: 11, clampedToZero: false },
            confirmation: { confirmationToken: 'opaque-token', expiresAt: '2026-10-01T00:00:00.000Z' },
        }),
    }, async base => {
        const response = await fetch(`${base}/api/ai/chat`, { method: 'POST', headers: ownerHeaders(), body: JSON.stringify({ messages: [{ role: 'user', content: '库存增加3并保存' }] }) });
        const body = await response.text();
        assert.match(body, /"type":"write_proposal"/);
        assert.match(body, /"stage":"AI_ASSISTANT_WRITE_PROPOSAL"/);
        assert.match(body, /"confirmationToken":"opaque-token"/);
        assert.doesNotMatch(body, /taskId|revision|goalKey|planRevision|argsHash|idempotencyKey|toolName/);
    });
});

test('confirm endpoint accepts only opaque token, fails closed at the server gate, and maps UNKNOWN_EFFECT', async () => {
    let executions = 0;
    await withServer({
        env: OWNER_ENV,
        writeAllowed: () => false,
        confirmAiAssistantPartStockProposal: async () => { executions += 1; return {}; },
    }, async base => {
        const response = await fetch(`${base}/api/ai/write/confirm`, { method: 'POST', headers: ownerHeaders(), body: JSON.stringify({ confirmationToken: 'opaque-token', delta: 3 }) });
        assert.equal(response.status, 400);
        assert.equal(executions, 0);
        const disabled = await fetch(`${base}/api/ai/write/confirm`, { method: 'POST', headers: ownerHeaders(), body: JSON.stringify({ confirmationToken: 'opaque-token' }) });
        assert.equal(disabled.status, 403);
        assert.equal(executions, 0);
    });
    await withServer({
        env: OWNER_ENV,
        writeAllowed: () => true,
        confirmAiAssistantPartStockProposal: async () => {
            executions += 1;
            const error = new Error('结果无法确认'); error.code = 'UNKNOWN_EFFECT'; error.manualReviewRequired = true; throw error;
        },
    }, async base => {
        const response = await fetch(`${base}/api/ai/write/confirm`, { method: 'POST', headers: ownerHeaders(), body: JSON.stringify({ confirmationToken: 'opaque-token' }) });
        const body = await response.json();
        assert.equal(response.status, 409);
        assert.equal(body.code, 'UNKNOWN_EFFECT');
        assert.equal(body.manualReviewRequired, true);
    });
    assert.equal(executions, 1);
});

test('cutover source contains one assistant route and no retired Task or dispatcher import', () => {
    const fs = require('node:fs'); const path = require('node:path');
    const root = path.join(__dirname, '..');
    const chat = fs.readFileSync(path.join(root, 'api/routes/ai/chat.cjs'), 'utf8');
    const routes = fs.readFileSync(path.join(root, 'api/routes/ai.cjs'), 'utf8');
    assert.match(chat, /runAiAssistant/);
    assert.doesNotMatch(chat, /aiDispatcherV3|aiTask|aiProtectedCommandRoute/);
    assert.doesNotMatch(routes, /tasks\.cjs/);
    assert.equal(fs.existsSync(path.join(root, 'api/services/aiDispatcherV3.cjs')), false);
    assert.equal(fs.existsSync(path.join(root, 'api/routes/ai/tasks.cjs')), false);
});
