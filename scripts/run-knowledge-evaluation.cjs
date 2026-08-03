require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const path = require('node:path');

const baseUrl = String(process.env.AI_EVAL_BASE_URL || 'http://localhost:3002').replace(/\/+$/, '');
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
    for (let index = 0; index < argv.length; index += 1) {
        const argument = String(argv[index] || '');
        if (argument.startsWith('--report=')) reportPath = argument.slice('--report='.length);
        if (argument === '--report') reportPath = String(argv[index + 1] || '');
    }
    return { reportPath: reportPath.trim() };
}

function buildReleaseGateReport(input = {}) {
    const run = input.run || null;
    const failedCount = Number(run?.failedCount || 0);
    const reviewCount = Number(run?.reviewCount || 0);
    const blocked = input.error
        ? true
        : !run || run.status !== 'completed' || failedCount > 0 || reviewCount > 0;
    return {
        schemaVersion: 1,
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

async function authenticate() {
    if (process.env.ACCESS_PASSWORD) {
        const response = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password: process.env.ACCESS_PASSWORD }),
        });
        await readJson(response, '自动登录');
        const cookie = response.headers.get('set-cookie')?.split(';')[0];
        if (!cookie) throw new Error('自动登录成功，但未收到登录 Cookie');
        requestHeaders = { cookie };
        return;
    }
    if (process.env.INTERNAL_SECRET) {
        requestHeaders = { 'x-internal-secret': process.env.INTERNAL_SECRET };
        return;
    }
    throw new Error('缺少 ACCESS_PASSWORD 或 INTERNAL_SECRET，无法执行无人值守回归');
}

async function streamQuestion(question) {
    const response = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { ...requestHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: question }] }),
        signal: AbortSignal.timeout(120000),
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

async function main() {
    await authenticate();
    const health = await requestJson('GET', '/api/health');
    if (health.ready !== true && !['ok', 'ready'].includes(health.status)) {
        throw new Error('API 健康检查未通过');
    }

    const created = await requestJson(
        'POST',
        '/api/ai/evaluations/runs',
        undefined,
        commandHeaders('ai-evaluation-run-start')
    );
    const runId = Number(created.run?.id);
    const runUpdatedAt = String(created.run?.updatedAt || '');
    const cases = Array.isArray(created.cases) ? created.cases : [];
    if (!runId || cases.length === 0) throw new Error('没有可执行的知识库回归用例');

    console.log(`知识库 AI 回归：运行 #${runId}，共 ${cases.length} 项`);
    const caseResults = [];
    for (let index = 0; index < cases.length; index += 1) {
        const evaluationCase = cases[index];
        let answerText = '';
        let toolResults = [];
        let errorText = '';
        let attempts = 0;
        try {
            ({ answerText, toolResults, attempts } = await streamQuestionWithRetry(evaluationCase.question));
        } catch (error) {
            errorText = error instanceof Error ? error.message : 'AI 查询失败';
            attempts = 3;
        }
        const result = await requestJson(
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

    const completed = await requestJson(
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
    });
}

if (require.main === module) {
    const options = parseCliOptions();
    main().then(report => {
        const savedPath = writeReleaseGateReport(options.reportPath, report);
        if (savedPath) console.log(`发布门禁报告：${savedPath}`);
        if (report.blocked) process.exitCode = 1;
    }).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        const report = buildReleaseGateReport({ error: message });
        const savedPath = writeReleaseGateReport(options.reportPath, report);
        console.error(message);
        if (savedPath) console.error(`发布门禁报告：${savedPath}`);
        process.exitCode = 1;
    });
}

module.exports = {
    buildReleaseGateReport,
    parseCliOptions,
    streamQuestionWithRetry,
    writeReleaseGateReport,
};
