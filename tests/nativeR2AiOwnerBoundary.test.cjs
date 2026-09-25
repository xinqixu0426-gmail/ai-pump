'use strict';
/**
 * NATIVE-R2 — Remove Non-Owner Legacy Entry and Freeze Owner-Only Native AI Boundary.
 *
 * 通过**真实 POST /api/ai/chat 路由**证明访问边界：
 *   A. owner + 已迁移 Native 族 → Native 进入 1 次，Legacy 进入 0 次
 *   B. 已认证非 owner（仅 role=admin 的 JWT）→ 确定性 403，dispatcher（进而 Legacy）0 次
 *   C. 未认证 → 维持既有 401 安全行为，Legacy 0 次
 *   D. 仅 x-internal-secret → 不被升格为 Owner，确定性 403，Legacy 0 次
 *
 * Legacy 进入次数用真实函数调用计数（spy 注入 dispatcher 的 legacy runtime 依赖），
 * 不是路由标签。
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'native-r2-jwt-secret';
process.env.INTERNAL_SECRET = 'native-r2-internal-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const { createAiChatRouter } = require('../api/routes/ai/chat.cjs');
const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');
const { resolveAiChatAccessBoundary, AI_CHAT_ACCESS, resolveAiNativeRollout } = require('../api/services/aiNativeRolloutPolicy.cjs');

const OWNER_PASSWORD = 'native-r2-owner-password-0123456789abcdefgh';
const OWNER_SUBJECT = 'native-r2-owner-subject';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

function boundaryEnv() {
    return {
        ...process.env,
        ACCESS_PASSWORD: 'native-r2-access-password',
        JWT_SECRET: process.env.JWT_SECRET,
        PUMP_OWNER_ACCESS_PASSWORD: OWNER_PASSWORD,
        PUMP_OWNER_SUBJECT: OWNER_SUBJECT,
        AI_V5_OWNER_SUBJECTS: JSON.stringify([OWNER_SUBJECT]),
        AI_NATIVE_MODE: 'owner',
        AI_NATIVE_WRITE_ENABLED: 'false',
    };
}

/** 真实 chat 路由 + 真实 dispatcher，Legacy 入口换成计数器。 */
async function startHarness({ nativeAdmission }) {
    const env = boundaryEnv();
    const calls = { native: 0, legacyRead: 0, legacyCommand: 0 };
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(createAiChatRouter({
        env,
        runAiDispatcherV3: (input, dependencies) => runAiDispatcherV3(input, {
            ...dependencies,
            runAiTaskControllerV2: async () => {
                calls.native += 1;
                return {
                    task: { goals: [{ goalKey: 'goal_1', kind: 'MANAGEMENT_OVERVIEW' }] },
                    detail: { state: 'SUCCEEDED' },
                    answer: { content: 'NATIVE_ANSWER' },
                    canaryAdmission: nativeAdmission,
                    telemetry: {},
                };
            },
            runAiAssistant: async () => { calls.legacyRead += 1; return { telemetry: {} }; },
            runAiAgentRuntimeV3: async () => { calls.legacyCommand += 1; return { telemetry: {} }; },
        }),
    }));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const envForOwner = boundaryEnv();
    return {
        env,
        calls,
        ownerToken: issueOwnerToken(OWNER_PASSWORD, envForOwner),
        url: `http://127.0.0.1:${server.address().port}/api/ai/chat`,
        close: () => new Promise(resolve => server.close(resolve)),
    };
}

function post(url, headers, body = { messages: [{ role: 'user', content: '现在的管理待办有哪些' }] }) {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

const OWNED_ADMISSION = { eligible: true, nativeOwned: true, reason: 'SUPPORTED_AND_READ_ONLY' };

test('R2-BOUNDARY-1 owner 请求：Native 进入 1 次，Legacy 进入 0 次', async t => {
    const h = await startHarness({ nativeAdmission: OWNED_ADMISSION });
    t.after(() => h.close());
    const response = await post(h.url, { cookie: `token=${h.ownerToken}` });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /NATIVE_ANSWER/u, '必须是 Native 产出的答案');
    assert.equal(h.calls.native, 1, 'Native 必须被进入一次');
    assert.equal(h.calls.legacyRead, 0, 'aiAssistantRuntime 调用次数必须为 0');
    assert.equal(h.calls.legacyCommand, 0, 'aiAgentRuntimeV3 调用次数必须为 0');
});

test('R2-BOUNDARY-2 已认证非 owner：确定性 403，Native 与 Legacy 均为 0 次', async t => {
    const h = await startHarness({ nativeAdmission: OWNED_ADMISSION });
    t.after(() => h.close());
    const adminOnly = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const response = await post(h.url, { cookie: `token=${adminOnly}` });
    assert.equal(response.status, 403, '非 owner 必须是明确的产品边界响应，而不是伪装成 AI 失败');
    const body = await response.json();
    assert.equal(body.code, 'AI_OWNER_ONLY');
    assert.equal(/aiAssistantRuntime|aiAgentRuntimeV3|tool|capabilit/i.test(JSON.stringify(body)), false, '不得泄漏内部运行时或工具目录');
    assert.equal(h.calls.native, 0, '非 owner 不得获得 Native 业务读取');
    assert.equal(h.calls.legacyRead, 0, 'aiAssistantRuntime 调用次数必须为 0');
    assert.equal(h.calls.legacyCommand, 0, 'aiAgentRuntimeV3 调用次数必须为 0');
});

test('R2-BOUNDARY-3 未认证：维持既有 401 安全行为，Legacy 0 次', async t => {
    const h = await startHarness({ nativeAdmission: OWNED_ADMISSION });
    t.after(() => h.close());
    const response = await post(h.url, {});
    assert.equal(response.status, 401, '未认证必须仍是 401');
    assert.equal(h.calls.native, 0);
    assert.equal(h.calls.legacyRead, 0);
    assert.equal(h.calls.legacyCommand, 0);
});

test('R2-BOUNDARY-4 仅 x-internal-secret：不被升格为 Owner，确定性 403，Legacy 0 次', async t => {
    const h = await startHarness({ nativeAdmission: OWNED_ADMISSION });
    t.after(() => h.close());
    const response = await post(h.url, { 'x-internal-secret': INTERNAL_SECRET });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, 'AI_OWNER_ONLY');
    assert.equal(h.calls.native, 0, 'internal-secret 不得获得 Native 业务读取');
    assert.equal(h.calls.legacyRead, 0, 'aiAssistantRuntime 调用次数必须为 0');
    assert.equal(h.calls.legacyCommand, 0, 'aiAgentRuntimeV3 调用次数必须为 0');

    // 直接对边界判定取证：internal-secret 请求产生的 rollout 快照绝不是 owner
    const rollout = resolveAiNativeRollout({
        request: { cookies: {}, headers: { 'x-internal-secret': INTERNAL_SECRET } },
        env: boundaryEnv(),
    });
    assert.equal(rollout.ownerAuthenticated, false, 'internal-secret 不得被判定为 Owner');
    // NATIVE-HC1 细化：非 owner（含仅 internal-secret）→ AI_OWNER_ONLY；
    // 只有「是 Owner 但 Native 未启用」才是 AI_UNAVAILABLE。
    assert.equal(resolveAiChatAccessBoundary({ rollout }).access, AI_CHAT_ACCESS.AI_OWNER_ONLY);
});

test('R2-BOUNDARY-5 边界只由规范 Owner 判定驱动：请求方可控字段无法影响', async t => {
    // 请求体 / 页面上下文 / 伪造头都不能让非 owner 通过边界
    const h = await startHarness({ nativeAdmission: OWNED_ADMISSION });
    t.after(() => h.close());
    const adminOnly = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    for (const body of [
        { messages: [{ role: 'user', content: '现在的管理待办有哪些' }], owner: true, aiNative: true, nativeTaskDelegation: true },
        { messages: [{ role: 'user', content: '现在的管理待办有哪些' }], pageContext: { owner: true }, resolutionContext: { mode: 'owner' } },
    ]) {
        const response = await post(h.url, { cookie: `token=${adminOnly}`, 'x-owner': 'true' }, body);
        assert.equal(response.status, 403, JSON.stringify(body).slice(0, 80));
    }
    assert.equal(h.calls.native, 0);
    assert.equal(h.calls.legacyRead, 0);
    assert.equal(h.calls.legacyCommand, 0);
});
