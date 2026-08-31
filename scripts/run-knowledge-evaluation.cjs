require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const path = require('node:path');
const {
    CORE_AI_RELEASE_CASE_KEYS,
    assertCoreAiReleaseCases,
} = require('../api/services/aiEvaluationReleasePolicy.cjs');

const baseUrl = String(process.env.AI_EVAL_BASE_URL || 'http://localhost:3002').replace(/\/+$/, '');
const CORE_AI_RELEASE_CASE_COUNT = CORE_AI_RELEASE_CASE_KEYS.length;
let requestHeaders = {};
let commandSequence = 0;

function commandHeaders(prefix) {
    commandSequence += 1;
    return {
        'idempotency-key':
            `${prefix}:${Date.now()}:${process.pid}:${commandSequence}`,
    };
}

function parseCliOptions(argv = process.argv.slice(2)) {
    let reportPath = '';
    let scope = 'manual';
    let caseKey = '';
    let caseKeyProvided = false;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = String(argv[index] || '');
        if (argument.startsWith('--report=')) reportPath = argument.slice('--report='.length);
        if (argument === '--report') reportPath = String(argv[index + 1] || '');
        if (argument.startsWith('--scope=')) scope = argument.slice('--scope='.length);
        if (argument === '--scope') scope = String(argv[index + 1] || '');
        if (argument.startsWith('--case-key=')) {
            caseKeyProvided = true;
            caseKey = argument.slice('--case-key='.length);
        }
        if (argument === '--case-key') {
            caseKeyProvided = true;
            const value = String(argv[index + 1] || '');
            if (!value || value.startsWith('--')) {
                throw new Error('--case-key 必须提供用例 key');
            }
            caseKey = value;
        }
    }
    scope = scope.trim().toLowerCase();
    if (!['manual', 'release'].includes(scope)) {
        throw new Error('scope 只允许 manual 或 release');
    }
    caseKey = caseKey.trim();
    if (caseKeyProvided && !caseKey) throw new Error('--case-key 必须提供用例 key');
    if (caseKey.length > 160) throw new Error('case key 不能超过 160 个字符');
    if (scope === 'release' && caseKey) {
        throw new Error('发布门禁必须运行完整用例集合，不能使用 --case-key');
    }
    return { reportPath: reportPath.trim(), scope, caseKey };
}

function buildReleaseGateReport(input = {}) {
    const scope = input.scope === 'release' ? 'release' : 'manual';
    const caseKey = String(input.caseKey || '').trim();
    const execution = {
        mode: scope === 'release' ? 'release' : caseKey ? 'diagnostic' : 'manual',
        scope,
        caseKey: caseKey || null,
        releaseGate: scope === 'release',
    };
    if (input.skipped) {
        return {
            schemaVersion: 1,
            ...execution,
            generatedAt: input.generatedAt || new Date().toISOString(),
            status: 'skipped',
            blocked: false,
            baseUrl: input.baseUrl || baseUrl,
            gitCommit: String(input.health?.runtime?.gitCommit || ''),
            runId: null,
            totals: {
                total: 0,
                passed: 0,
                failed: 0,
                review: 0,
            },
            cases: [],
            error: '',
        };
    }
    const run = input.run || null;
    const failedCount = Number(run?.failedCount || 0);
    const reviewCount = Number(run?.reviewCount || 0);
    const blocked = input.error
        ? true
        : !run || run.status !== 'completed' || failedCount > 0 || reviewCount > 0;
    return {
        schemaVersion: 1,
        ...execution,
        generatedAt: input.generatedAt || new Date().toISOString(),
        status: input.error ? 'error' : blocked ? 'blocked' : 'passed',
        blocked,
        baseUrl: input.baseUrl || baseUrl,
        gitCommit: String(input.health?.runtime?.gitCommit || ''),
        runId: Number(run?.id || 0) || null,
        totals: {
            total: Number(run?.totalCount || 0),
            passed: Number(run?.passedCount || 0),
            failed: failedCount,
            review: reviewCount,
        },
        cases: (Array.isArray(input.cases) ? input.cases : []).map(item => ({
            caseId: Number(item.caseId || 0) || null,
            title: String(item.title || ''),
            status: String(item.status || ''),
            attempts: Number(item.attempts || 1),
            failedChecks: (Array.isArray(item.checks) ? item.checks : [])
                .filter(check => !check.passed)
                .map(check => ({
                    label: String(check.label || ''),
                    detail: String(check.detail || ''),
                })),
            error: String(item.errorText || ''),
        })),
        error: String(input.error || ''),
    };
}

function writeReleaseGateReport(reportPath, report) {
    if (!reportPath) return '';
    const absolutePath = path.resolve(reportPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return absolutePath;
}

async function readJson(response, label) {
    const text = await response.text();
    let payload;
    try {
        payload = text ? JSON.parse(text) : {};
    } catch {
        throw new Error(`${label} 返回了非 JSON 响应：${response.status}`);
    }
    if (!response.ok || payload.success === false) {
        throw new Error(payload.error || `${label}失败：${response.status}`);
    }
    return payload.data ?? payload;
}

async function requestJson(method, path, body, headers = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            ...requestHeaders,
            ...headers,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return readJson(response, `${method} ${path}`);
}

function resolveEvaluationAuthentication(scope, env = process.env, options = {}) {
    if (scope === 'release') {
        if (env.INTERNAL_SECRET) return { type: 'internal', secret: env.INTERNAL_SECRET };
        throw new Error('发布门禁缺少 INTERNAL_SECRET，不能降级为网页登录身份');
    }
    if (env.ACCESS_PASSWORD) return { type: 'login', password: env.ACCESS_PASSWORD };
    throw new Error(
        options.caseKey
            ? '单用例诊断需要 ACCESS_PASSWORD，不能使用内部发布身份'
            : '手动 AI 回归需要 ACCESS_PASSWORD，不能使用内部发布身份'
    );
}

function assertCoreReleaseGateConfigured(overview) {
    return assertCoreAiReleaseCases(overview?.systemCases);
}

function evaluationClientTimeoutMs(env = process.env) {
    const serverTimeout = Number(env.AI_CHAT_TIMEOUT_MS);
    const boundedServerTimeout = Number.isFinite(serverTimeout)
        ? Math.min(Math.max(Math.trunc(serverTimeout), 10 * 1000), 15 * 60 * 1000)
        : 180 * 1000;
    return boundedServerTimeout + 15 * 1000;
}

async function authenticate(scope = 'manual', options = {}) {
    const authentication = resolveEvaluationAuthentication(scope, process.env, options);
    if (authentication.type === 'login') {
        const response = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password: authentication.password }),
        });
        await readJson(response, '自动登录');
        const cookie = response.headers.get('set-cookie')?.split(';')[0];
        if (!cookie) throw new Error('自动登录成功，但未收到登录 Cookie');
        requestHeaders = { cookie };
        return;
    }
    if (authentication.type === 'internal') {
        requestHeaders = { 'x-internal-secret': authentication.secret };
        return;
    }
}

async function streamQuestion(question) {
    const response = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { ...requestHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: question }] }),
        signal: AbortSignal.timeout(evaluationClientTimeoutMs()),
    });
    if (!response.ok || !response.body) {
        throw new Error(`AI 查询失败：${response.status}`);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let answerText = '';
    let toolResults = [];
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            let event;
            try {
                event = JSON.parse(raw);
            } catch {
                continue;
            }
            if (event.type === 'content') answerText += event.content || '';
            if (event.type === 'tool_result') {
                toolResults.push({ name: event.name, result: event.result });
            }
            if (event.type === 'detail' && Array.isArray(event.toolResults)) {
                toolResults = event.toolResults;
            }
            if (event.type === 'error') throw new Error(event.message || 'AI 查询失败');
        }
    }
    return { answerText, toolResults };
}

async function streamQuestionWithRetry(question, options = {}) {
    const maxAttempts = Math.min(Math.max(Number(options.maxAttempts) || 3, 1), 5);
    const executor = options.executor || streamQuestion;
    const wait = options.wait || (delay => new Promise(resolve => setTimeout(resolve, delay)));
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const result = await executor(question);
            if (!String(result?.answerText || '').trim()) throw new Error('AI 未返回回答');
            return { ...result, attempts: attempt };
        } catch (error) {
            lastError = error;
            if (attempt >= maxAttempts) break;
            console.warn(
                `AI 查询中断，第 ${attempt}/${maxAttempts} 次未完成，准备重试：`
                + `${error instanceof Error ? error.message : error}`
            );
            await wait(attempt * 750);
        }
    }
    throw lastError || new Error('AI 查询失败');
}

async function main(options = {}, dependencies = {}) {
    const scope = options.scope === 'release' ? 'release' : 'manual';
    const caseKey = String(options.caseKey || '').trim();
    const authenticateRequest = dependencies.authenticate || authenticate;
    const request = dependencies.requestJson || requestJson;
    const askQuestion = dependencies.streamQuestionWithRetry || streamQuestionWithRetry;
    await authenticateRequest(scope, { caseKey });
    const health = await request('GET', '/api/health');
    if (health.ready !== true && !['ok', 'ready'].includes(health.status)) {
        throw new Error('API 健康检查未通过');
    }

    const overview = await request('GET', '/api/ai/evaluations/overview');
    if (scope === 'release') assertCoreReleaseGateConfigured(overview);
    const enabledCases = Number(
        scope === 'release'
            ? overview?.caseStats?.releaseEnabled
            : overview?.caseStats?.enabled
    ) || 0;
    if (enabledCases === 0) {
        if (scope === 'release') {
            throw new Error('发布门禁没有可执行用例，禁止跳过 AI 回归');
        }
        console.log('知识库 AI 回归：没有启用用例，本次手动检查跳过');
        return buildReleaseGateReport({ health, skipped: true, scope, caseKey });
    }

    const created = await request(
        'POST',
        '/api/ai/evaluations/runs',
        { scope, ...(caseKey ? { caseKey } : {}) },
        commandHeaders('ai-evaluation-run-start')
    );
    const runId = Number(created.run?.id);
    const runUpdatedAt = String(created.run?.updatedAt || '');
    const cases = Array.isArray(created.cases) ? created.cases : [];
    if (!runId || cases.length === 0) throw new Error('没有可执行的知识库回归用例');
    if (caseKey && (cases.length !== 1 || cases[0].caseKey !== caseKey)) {
        throw new Error(`服务端没有按 case key 精确创建诊断运行：${caseKey}`);
    }

    console.log(
        caseKey
            ? `知识库 AI 单用例诊断：运行 #${runId}，${caseKey}`
            : `知识库 AI 回归：运行 #${runId}，共 ${cases.length} 项`
    );
    const caseResults = [];
    for (let index = 0; index < cases.length; index += 1) {
        const evaluationCase = cases[index];
        let answerText = '';
        let toolResults = [];
        let errorText = '';
        let attempts = 0;
        try {
            ({ answerText, toolResults, attempts } = await askQuestion(evaluationCase.question));
        } catch (error) {
            errorText = error instanceof Error ? error.message : 'AI 查询失败';
            attempts = 3;
        }
        const result = await request(
            'POST',
            `/api/ai/evaluations/runs/${runId}/results`,
            {
                caseId: evaluationCase.id,
                answerText,
                toolResults,
                errorText,
                expectedUpdatedAt: runUpdatedAt || null,
            },
            commandHeaders(`ai-evaluation-result:${runId}:${evaluationCase.id}`)
        );
        caseResults.push({
            caseId: evaluationCase.id,
            title: evaluationCase.title,
            status: result.status,
            checks: result.checks,
            errorText: result.errorText,
            attempts,
        });
        const marker = result.status === 'passed' ? 'PASS' : result.status === 'review' ? 'REVIEW' : 'FAIL';
        console.log(`[${index + 1}/${cases.length}] ${marker} ${evaluationCase.title}`);
    }

    const completed = await request(
        'POST',
        `/api/ai/evaluations/runs/${runId}/complete`,
        { expectedUpdatedAt: runUpdatedAt || null },
        commandHeaders(`ai-evaluation-run-complete:${runId}`)
    );
    console.log(
        `完成：通过 ${completed.passedCount}/${completed.totalCount}，`
        + `失败 ${completed.failedCount}，待确认 ${completed.reviewCount}`
    );
    return buildReleaseGateReport({
        health,
        run: completed,
        cases: caseResults,
        scope,
        caseKey,
    });
}

if (require.main === module) {
    const options = parseCliOptions();
    main(options).then(report => {
        const savedPath = writeReleaseGateReport(options.reportPath, report);
        if (savedPath) console.log(`发布门禁报告：${savedPath}`);
        if (report.blocked) process.exitCode = 1;
    }).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        const report = buildReleaseGateReport({
            error: message,
            scope: options.scope,
            caseKey: options.caseKey,
        });
        const savedPath = writeReleaseGateReport(options.reportPath, report);
        console.error(message);
        if (savedPath) console.error(`发布门禁报告：${savedPath}`);
        process.exitCode = 1;
    });
}

module.exports = {
    CORE_AI_RELEASE_CASE_KEYS,
    CORE_AI_RELEASE_CASE_COUNT,
    assertCoreReleaseGateConfigured,
    buildReleaseGateReport,
    evaluationClientTimeoutMs,
    main,
    parseCliOptions,
    resolveEvaluationAuthentication,
    streamQuestionWithRetry,
    writeReleaseGateReport,
};
