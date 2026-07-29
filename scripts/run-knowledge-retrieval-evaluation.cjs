require('dotenv').config({ quiet: true });

const baseUrl = String(
    process.env.KNOWLEDGE_EVAL_BASE_URL || 'http://localhost:3002'
).replace(/\/+$/, '');

async function responseJson(response, label) {
    const text = await response.text();
    let payload;
    try {
        payload = text ? JSON.parse(text) : {};
    } catch {
        throw new Error(`${label} 返回非 JSON 响应：${response.status}`);
    }
    if (!response.ok || payload.success === false) {
        throw new Error(payload.error || `${label}失败：${response.status}`);
    }
    return payload.data ?? payload;
}

async function authenticate() {
    if (process.env.ACCESS_PASSWORD) {
        const response = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password: process.env.ACCESS_PASSWORD }),
            signal: AbortSignal.timeout(15000),
        });
        await responseJson(response, '自动登录');
        const cookie = response.headers.get('set-cookie')?.split(';')[0];
        if (!cookie) throw new Error('自动登录成功，但未收到登录 Cookie');
        return { cookie };
    }
    if (process.env.INTERNAL_SECRET) {
        return { 'x-internal-secret': process.env.INTERNAL_SECRET };
    }
    throw new Error('缺少 ACCESS_PASSWORD 或 INTERNAL_SECRET，无法执行无人值守检索评测');
}

function metric(label, value) {
    return `${label} Top1 ${value.top1Count}/${value.total} (${value.top1Percent}%)`
        + `，Top3 ${value.top3Count}/${value.total} (${value.top3Percent}%)`;
}

async function main() {
    const headers = await authenticate();
    const response = await fetch(`${baseUrl}/api/knowledge/retrieval-evaluation`, {
        headers,
        signal: AbortSignal.timeout(180000),
    });
    const report = await responseJson(response, '知识检索评测');
    console.log(`知识检索评测：${report.caseCount} 项，模型 ${report.model}`);
    console.log(metric('FTS', report.metrics.keyword));
    console.log(metric('向量', report.metrics.vector));
    console.log(metric('混合', report.metrics.hybrid));
    for (const item of report.cases) {
        const marker = item.ranks.hybrid != null && item.ranks.hybrid <= 3 ? 'PASS' : 'FAIL';
        console.log(
            `${marker} ${item.title}：FTS ${item.ranks.keyword ?? '-'}`
            + ` / 向量 ${item.ranks.vector ?? '-'} / 混合 ${item.ranks.hybrid ?? '-'}`
        );
        if (item.error) console.log(`  ${item.error}`);
    }
    if (!report.acceptance.passed) {
        throw new Error(
            `检索验收未通过：${JSON.stringify(report.acceptance)}`
        );
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
