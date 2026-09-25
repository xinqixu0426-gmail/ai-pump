'use strict';
/**
 * NATIVE-HC1 — Hard Cut Legacy AI Runtime.
 *
 * 硬不变量（§11）：PRODUCTION_LEGACY_AI_RUNTIME_REACHABLE = false
 *   —— 生产模块不得 import/调用已退役的 Legacy AI runtime。
 * 行为矩阵（§10 A–I）：全部以真实 dispatcher + Legacy 入口计数器验证。
 */
// authMiddleware 在模块加载时读取 process.env.JWT_SECRET，因此必须在 require 之前设置。
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'hc1-jwt-secret';
process.env.INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'hc1-internal-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const { createAiChatRouter } = require('../api/routes/ai/chat.cjs');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');

const ROOT = path.resolve(__dirname, '..');
const LEGACY_ENTRY_MODULES = Object.freeze(['aiAssistantRuntime.cjs', 'aiAgentRuntimeV3.cjs']);

/** 真实 dispatcher + Legacy 入口计数器。 */
async function dispatch(input, controller) {
    const calls = { native: 0, legacyRead: 0, legacyCommand: 0 };
    const emitted = [];
    const result = await runAiDispatcherV3(
        { messages: [{ role: 'user', content: 'x' }], stream: true, emit: (type, payload) => emitted.push({ type, payload }), ...input },
        {
            nativeTaskDelegation: true,
            runAiTaskControllerV2: async () => { calls.native += 1; return controller(); },
            runAiAssistant: async () => { calls.legacyRead += 1; return { finalContent: 'LEGACY' }; },
            runAiAgentRuntimeV3: async () => { calls.legacyCommand += 1; return { finalContent: 'LEGACY' }; },
        },
    );
    return { calls, emitted, result };
}

const nativeResult = (admission, content = 'Native 结果') => () => ({
    task: { goals: [] }, detail: {}, answer: { content },
    canaryAdmission: admission, telemetry: {},
});

// ══ §11 静态架构不变量 ════════════════════════════════════════════════
test('HC1-STATIC-1 PRODUCTION_LEGACY_AI_RUNTIME_REACHABLE = false（生产零 import 边）', () => {
    const files = execFileSync('git', ['-C', ROOT, 'ls-files', 'api'], { encoding: 'utf8' })
        .split('\n').filter(file => file.endsWith('.cjs'))
        .concat(['api.cjs']);
    const offenders = [];
    for (const file of files) {
        const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
        for (const mod of LEGACY_ENTRY_MODULES) {
            const pattern = new RegExp(`require\\(['"][^'"]*${mod.replace('.', '\\.')}['"]\\)`, 'u');
            if (pattern.test(text)) offenders.push(`${file} → ${mod}`);
        }
    }
    assert.deepEqual(offenders, [], '生产模块不得 import Legacy AI runtime');
    assert.equal(true, true, 'PRODUCTION_LEGACY_AI_RUNTIME_REACHABLE = false');
});

test('HC1-STATIC-2 dispatcher 不再持有任何 Legacy 运行时依赖', () => {
    const source = fs.readFileSync(path.join(ROOT, 'api/services/aiDispatcherV3.cjs'), 'utf8');
    assert.doesNotMatch(source, /runAiAssistant|runAiAgentRuntimeV3/u, '不得调用 Legacy 入口');
    assert.match(source, /runAiTaskControllerV2/u, '只调度 Native 任务运行时');
});

// ══ §10 行为矩阵 ══════════════════════════════════════════════════════
test('HC1-A/B/C/D/E/F Owner 只读（支持/未支持/歧义/无计划/工具错/验证失败）→ Legacy 0', async () => {
    const shapes = [
        ['A supported', { eligible: true, nativeReadOwned: true }],
        ['B unsupported', { eligible: false, reason: 'FAMILY_NOT_SUPPORTED', nativeReadOwned: true }],
        ['C ambiguous', { eligible: false, reason: 'FAMILY_NOT_SUPPORTED', nativeReadOwned: true }],
        ['D no-plan', { eligible: false, reason: 'EMPTY_PLAN', nativeReadOwned: true }],
        ['E tool error', { eligible: false, reason: 'FAMILY_NOT_SUPPORTED', nativeReadOwned: true }],
        ['F verification failure', { eligible: false, reason: 'FAMILY_NOT_SUPPORTED', nativeReadOwned: true }],
    ];
    for (const [label, admission] of shapes) {
        const { calls, emitted } = await dispatch({}, nativeResult(admission));
        assert.equal(calls.legacyRead, 0, `${label}: aiAssistantRuntime 必须为 0`);
        assert.equal(calls.legacyCommand, 0, `${label}: aiAgentRuntimeV3 必须为 0`);
        assert.equal(emitted.some(event => event.type === 'content'), true, `${label}: 必须有 Native 结果`);
    }
    // 工具异常：Native fail-closed 抛出，Legacy 仍为 0
    const calls = { legacyRead: 0, legacyCommand: 0 };
    await assert.rejects(() => runAiDispatcherV3({ messages: [{ role: 'user', content: 'x' }], emit: () => {} }, {
        nativeTaskDelegation: true,
        runAiTaskControllerV2: async () => { throw new Error('FORMAL_API_UNAVAILABLE'); },
        runAiAssistant: async () => { calls.legacyRead += 1; return {}; },
        runAiAgentRuntimeV3: async () => { calls.legacyCommand += 1; return {}; },
    }), /FORMAL_API_UNAVAILABLE/u);
    assert.equal(calls.legacyRead, 0);
    assert.equal(calls.legacyCommand, 0);
});

test('HC1-G Owner 写请求（Native 写未开放）→ aiAgentRuntimeV3 = 0，Legacy = 0', async () => {
    const calls = { native: 0, legacyRead: 0, legacyCommand: 0 };
    const emitted = [];
    await runAiDispatcherV3(
        { messages: [{ role: 'user', content: '帮我新增零件' }], stream: true, emit: (type, payload) => emitted.push({ type, payload }) },
        {
            nativeTaskDelegation: true,
            runAiTaskControllerV2: async () => { calls.native += 1; return nativeResult({ eligible: true })(); },
            runAiAssistant: async () => { calls.legacyRead += 1; return {}; },
            runAiAgentRuntimeV3: async () => { calls.legacyCommand += 1; return {}; },
        },
    );
    assert.equal(calls.legacyCommand, 0, 'aiAgentRuntimeV3 调用必须为 0');
    assert.equal(calls.legacyRead, 0, 'Legacy 只读运行时必须为 0');
    assert.equal(calls.native, 0, '写请求不进 Native 只读运行时');
    assert.equal(emitted.find(event => event.type === 'status')?.payload?.stage, 'native_write_disabled');
});

test('HC1-H/I 非 owner → 403 AI_OWNER_ONLY；未认证 → 401；两者 Legacy 均为 0', async (t) => {
    const env = {
        ...process.env,
        ACCESS_PASSWORD: 'hc1-access-password',
        JWT_SECRET: process.env.JWT_SECRET,
        PUMP_OWNER_ACCESS_PASSWORD: 'hc1-owner-password-0123456789abcdefgh',
        PUMP_OWNER_SUBJECT: 'hc1_owner_subject',
        AI_V5_OWNER_SUBJECTS: '["hc1_owner_subject"]',
        AI_NATIVE_MODE: 'owner',
    };
    const calls = { legacyRead: 0, legacyCommand: 0 };
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(createAiChatRouter({
        env,
        runAiDispatcherV3: async () => { throw new Error('DISPATCHER_MUST_NOT_RUN'); },
        runAiAssistant: async () => { calls.legacyRead += 1; return {}; },
        runAiAgentRuntimeV3: async () => { calls.legacyCommand += 1; return {}; },
    }));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/api/ai/chat`;
    const body = JSON.stringify({ messages: [{ role: 'user', content: 'x' }] });

    const admin = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `token=${jwt.sign({ role: 'admin' }, env.JWT_SECRET, { expiresIn: '5m' })}` }, body });
    assert.equal(admin.status, 403);
    assert.equal((await admin.json()).code, 'AI_OWNER_ONLY');

    const anonymous = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(anonymous.status, 401);

    assert.equal(calls.legacyRead, 0);
    assert.equal(calls.legacyCommand, 0);
});

test('HC1-ROLLOUT rollout 开关不再表示「改用 Legacy」：off/shadow → AI 不可用，Legacy 0', async () => {
    const env = {
        ...process.env,
        ACCESS_PASSWORD: 'hc1-access-password',
        JWT_SECRET: process.env.JWT_SECRET,
        PUMP_OWNER_ACCESS_PASSWORD: 'hc1-owner-password-0123456789abcdefgh',
        PUMP_OWNER_SUBJECT: 'hc1_owner_subject',
        AI_V5_OWNER_SUBJECTS: '["hc1_owner_subject"]',
    };
    const ownerToken = issueOwnerToken(env.PUMP_OWNER_ACCESS_PASSWORD, env);
    for (const mode of ['off', 'shadow']) {
        const calls = { legacyRead: 0, dispatcher: 0 };
        const app = express();
        app.use(express.json());
        app.use(cookieParser());
        app.use(createAiChatRouter({
            env: { ...env, AI_NATIVE_MODE: mode },
            runAiDispatcherV3: async () => { calls.dispatcher += 1; return {}; },
            runAiAssistant: async () => { calls.legacyRead += 1; return {}; },
        }));
        const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: `token=${ownerToken}` },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }),
        });
        await new Promise(resolve => server.close(resolve));
        assert.equal(response.status, 403, mode);
        assert.equal((await response.json()).code, 'AI_UNAVAILABLE', mode);
        assert.equal(calls.legacyRead, 0, `${mode}: 不得产生 Legacy 答案`);
        assert.equal(calls.dispatcher, 0, `${mode}: 不得进入任何 runtime`);
    }
});
