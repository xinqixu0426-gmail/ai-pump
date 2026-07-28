require('dotenv').config({ quiet: true });

const baseUrl = String(process.env.AI_EVAL_BASE_URL || 'http://localhost:3002').replace(/\/+$/, '');
let requestHeaders = {};

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

async function requestJson(method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            ...requestHeaders,
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

async function main() {
    await authenticate();
    const health = await requestJson('GET', '/api/health');
    if (health.status !== 'ok') throw new Error('API 健康检查未通过');

    const created = await requestJson('POST', '/api/ai/evaluations/runs');
    const runId = Number(created.run?.id);
    const cases = Array.isArray(created.cases) ? created.cases : [];
    if (!runId || cases.length === 0) throw new Error('没有可执行的知识库回归用例');

    console.log(`知识库 AI 回归：运行 #${runId}，共 ${cases.length} 项`);
    for (let index = 0; index < cases.length; index += 1) {
        const evaluationCase = cases[index];
        let answerText = '';
        let toolResults = [];
        let errorText = '';
        try {
            ({ answerText, toolResults } = await streamQuestion(evaluationCase.question));
        } catch (error) {
            errorText = error instanceof Error ? error.message : 'AI 查询失败';
        }
        const result = await requestJson(
            'POST',
            `/api/ai/evaluations/runs/${runId}/results`,
            {
                caseId: evaluationCase.id,
                answerText,
                toolResults,
                errorText,
            }
        );
        const marker = result.status === 'passed' ? 'PASS' : result.status === 'review' ? 'REVIEW' : 'FAIL';
        console.log(`[${index + 1}/${cases.length}] ${marker} ${evaluationCase.title}`);
    }

    const completed = await requestJson('POST', `/api/ai/evaluations/runs/${runId}/complete`);
    console.log(
        `完成：通过 ${completed.passedCount}/${completed.totalCount}，`
        + `失败 ${completed.failedCount}，待确认 ${completed.reviewCount}`
    );
    if (completed.failedCount > 0 || completed.reviewCount > 0) process.exitCode = 1;
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
