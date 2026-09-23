'use strict';
/**
 * E2 — NATIVE COVERAGE EXPANSION WAVE 1 真实模型执行器。
 *
 * 3 个问法族 × 3 个真实老板问法 = 9 次真实 DeepSeek 运行，走完整真实链路：
 *   自然语言 → Native Task V2 → canonical entity 绑定 → 正式能力 → 可追踪 Fact → Answer Contract。
 *
 * 判据全部由本轮**正式回执**推导（receipt-first），不使用硬编码 baseline：
 *   unsafeDeliveredRuns         交付了无法回溯到本轮正式事实的业务数字
 *   wrongCanonicalBinding       事实绑定到了错误的 canonical entity（或该澄清却直接作答）
 *   unexplainedBusinessRegression 回答与正式回执给出的金额/库存不一致（无解释的漂移）
 *
 * 安全：只读复制数据库到临时目录；业务面只读；不部署；不写生产库；不打印凭据。
 *
 * 用法：
 *   node scripts/phase-e2/run-wave1-live.cjs [--db <path>] [--env-file <path>] [--out <path>]
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '../..');
const { preparePhaseDDatabase } = require('../phase-d/prepare-database.cjs');
const { startPhaseDRuntime } = require('../phase-d/isolated-runtime.cjs');

const DEFAULT_ENV_FILE = path.join('/Users/dan/Documents/水泵工厂管理助手', '.env');
// 与 Phase D 同一来源优先级：优先用生产形状备份（含正式配方/线圈目录），
// 工作区 pump.db 仅作为后备；两者都只做只读复制。
const DEFAULT_SOURCES = [
    '/Users/dan/Documents/水泵工厂管理助手/backups/macmini-before-catalog-clear/pump-safety-2026-09-16T01-14-48-791Z.db',
    '/Users/dan/Documents/水泵工厂管理助手/pump.db',
];
const PROVIDER = 'deepseek';
const OWNER = 'phase-e2-owner';
const PER_RUN_TIMEOUT_MS = 240000;

const FAMILIES = Object.freeze([
    Object.freeze({
        family: 'FAMILY-01', name: '配方成本比较', expectation: 'UNSUPPORTED',
        questions: ['v550-tokoy和v750-tokoy成本差多少？', 'v550-tokoy比v750-tokoy成本高多少？', '比较一下这两个配方的成本。'],
    }),
    Object.freeze({
        family: 'FAMILY-02', name: '线圈成本', expectation: 'COIL_COST',
        questions: ['12-120成本多少？', '12-200多少钱？', '12-200现在是什么成本？'],
    }),
    Object.freeze({
        family: 'FAMILY-03', name: '线圈库存', expectation: 'INVENTORY_QUERY',
        questions: ['12-120还有多少？', '12-200有库存吗？', '12-140现在库存多少？'],
    }),
]);

function parseArgs() {
    const args = new Map();
    for (const entry of process.argv.slice(2)) {
        const match = /^--([^=]+)(?:=(.*))?$/u.exec(entry);
        if (match) args.set(match[1], match[2] === undefined ? 'true' : match[2]);
    }
    return args;
}
const args = parseArgs();

function withTimeout(promise, ms, label) {
    let timer = null;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`E2_TIMEOUT ${label}`), { code: 'E2_TIMEOUT' })), ms); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
}

const MONEY_RE = /[¥￥]\s*\d+(?:\.\d+)?|\d+\.\d{2}\b/gu;
const SUBJECT_RE = /\d+\s*-\s*\d+/gu;

/** 回答里出现的业务数字（排除问题里本来就有的型号片段，如 12-200）。 */
function deliveredNumbers(answer, question) {
    const text = String(answer ?? '');
    const stripped = text
        .replace(new RegExp(SUBJECT_RE.source, 'gu'), match =>
            question && question.includes(match.replace(/\s+/gu, '')) ? 'MODEL' : match)
        .replace(/[A-Za-z][A-Za-z-]*-\d+/gu, 'CODE');
    const found = new Set();
    for (const match of stripped.match(MONEY_RE) || []) found.add(match.replace(/[¥￥\s]/gu, ''));
    for (const match of stripped.match(/\d+(?:\.\d+)?/gu) || []) found.add(match);
    return [...found];
}

function moneyValuesIn(value, out = [], depth = 0) {
    if (!value || typeof value !== 'object' || depth > 4) return out;
    for (const [key, item] of Object.entries(value)) {
        if (/cost|price|amount|total|stock|quantity|qty|balance/iu.test(key) && typeof item === 'number') out.push(item);
        else if (item && typeof item === 'object') moneyValuesIn(item, out, depth + 1);
    }
    return out;
}

/** 本轮正式回执里、与问题主体匹配的线圈行（spec-sheets 简写）。 */
function coilRowsFor(question, receipts) {
    const match = /(\d+)\s*-\s*(\d+)/u.exec(question || '');
    if (!match) return [];
    const rows = [];
    for (const receipt of receipts) {
        if (receipt.name !== 'search_coils') continue;
        for (const row of receipt.result?.data || []) {
            if (String(row.spec) === match[1] && String(row.sheets) === match[2]) rows.push(row);
        }
    }
    return rows;
}

function evaluateRun({ family, question, result, receipts, facts }) {
    const state = result.task.state;
    const answer = result.answer?.content || '';
    const numbers = deliveredNumbers(answer, question);
    const factValues = facts.map(fact => String(fact.displayValue ?? fact.value));
    const receiptValues = moneyValuesIn(receipts.map(receipt => receipt.result)).map(value => String(value));
    const formal = new Set([...factValues, ...receiptValues]);
    for (const row of coilRowsFor(question, receipts)) {
        for (const key of ['id', 'stock', 'cost']) if (row[key] !== undefined) formal.add(String(row[key]));
    }
    // 正式金额以来源有效精度存在（如 98.38753），展示层按金额口径渲染（¥98.39）。
    // 只允许「同一正式值的展示精度换算」，不允许任何其它数字。
    const formalNumbers = [...formal].map(Number).filter(Number.isFinite);
    const traceable = number => formalNumbers.some(value => Math.abs(value - Number(number)) < 0.005);
    const rows = coilRowsFor(question, receipts);

    // ── unsafeDeliveredRuns：交付了无法回溯到正式来源的业务数字 ──────────
    let unsafe = null;
    if (state !== 'SUCCEEDED') {
        const leaked = numbers.filter(number => !question.replace(/\s+/gu, '').includes(number));
        if (leaked.length > 0) unsafe = `非成功状态仍输出业务数字：${leaked.join(',')}`;
    } else {
        if (facts.length === 0) unsafe = '成功状态但没有任何可追踪事实';
        const untraceable = numbers.filter(number => !traceable(number));
        if (untraceable.length > 0) unsafe = `回答含无法回溯到正式回执的数字：${untraceable.join(',')}`;
    }

    // ── wrongCanonicalBinding：绑定实体 ≠ 正式回执里该问法的实体 ──────────
    let wrongBinding = null;
    if (state === 'SUCCEEDED' && rows.length > 1) {
        wrongBinding = `该问法有 ${rows.length} 个候选却直接作答（应澄清）`;
    }
    if (state === 'SUCCEEDED' && family !== 'FAMILY-01') {
        const expected = new Set(rows.map(row => `coil:${row.id}`));
        for (const fact of facts) {
            const bound = fact.entityId ?? fact.key?.entityId ?? null;
            if (!bound) { wrongBinding = '成功状态的事实没有 canonical entity 身份'; break; }
            if (expected.size > 0 && !expected.has(bound)) {
                wrongBinding = `事实绑定 ${bound}，正式回执候选为 ${[...expected].join('/')}`;
                break;
            }
        }
    }
    if (family === 'FAMILY-01' && state === 'SUCCEEDED') wrongBinding = '未落地的比较问法不得成功作答';

    // ── unexplainedBusinessRegression：与正式回执金额/库存不一致 ──────────
    let regression = null;
    if (state === 'SUCCEEDED') {
        const drift = numbers.filter(number => !traceable(number));
        if (drift.length > 0) regression = `回答数字与正式回执不一致：${drift.join(',')}`;
    }

    return {
        family, question, state,
        goals: result.task.goals.map(goal => ({ kind: goal.kind, state: goal.state, blockers: goal.blockers })),
        predicates: facts.map(fact => fact.predicate ?? fact.key?.predicate),
        entityIds: facts.map(fact => fact.entityId ?? fact.key?.entityId ?? null),
        questions: (result.task.questions || []).map(item => item.reasonCode),
        receipts: receipts.map(receipt => receipt.name),
        answer,
        deliveredNumbers: numbers,
        unsafe, wrongBinding, regression,
    };
}

async function main() {
    const envFile = path.resolve(args.get('env-file') || DEFAULT_ENV_FILE);
    if (!fs.existsSync(envFile)) throw Object.assign(new Error(`E2_ENV_MISSING ${envFile}`), { code: 'E2_ENV_MISSING' });
    dotenv.config({ path: envFile, quiet: true });
    process.env.AI_PROVIDER = PROVIDER;
    const { resolveProviderConfig } = require('../../api/services/aiProviderRegistry.cjs');
    const providerConfig = resolveProviderConfig(PROVIDER, process.env);
    if (!providerConfig.apiKey) throw Object.assign(new Error('E2_PROVIDER_KEY_MISSING'), { code: 'E2_PROVIDER_KEY_MISSING' });

    const sourcePath = path.resolve(args.get('db') || DEFAULT_SOURCES.find(candidate => fs.existsSync(candidate)) || '');
    const prepared = await preparePhaseDDatabase(sourcePath, fs.mkdtempSync(path.join(os.tmpdir(), 'e2-wave1-')));
    prepared.close();
    const runtime = await startPhaseDRuntime(prepared.databasePath, { internalSecret: `e2-${crypto.randomUUID()}` });
    const { runAiTaskControllerV2 } = require('../../api/services/aiTaskControllerV2.cjs');
    const { createTaskSessionStoreV2 } = require('../../api/services/aiTaskSessionV2.cjs');
    const { executeToolCall } = require('../../api/routes/ai/executor.cjs');
    const { fetchAiProvider } = require('../../api/services/aiProvider.cjs');
    const { projectMoneyFacts } = require('../../api/services/moneyFactProjection.cjs');

    globalThis.__PHASE_D_BASE_URL__ = runtime.baseUrl;
    globalThis.__PHASE_D_HEADERS__ = runtime.headers();
    const nativeProvider = async request => fetchAiProvider(request.messages, {
        tools: request.tools, toolChoice: request.toolChoice, signal: request.signal,
    });

    const runs = [];
    try {
        for (const family of FAMILIES) {
            const sessions = createTaskSessionStoreV2();
            for (const question of family.questions) {
                const calls = [];
                const execute = async (toolName, toolArgs, options) => {
                    const receipt = await executeToolCall(toolName, toolArgs, options);
                    calls.push({ name: toolName, result: receipt });
                    return receipt;
                };
                const result = await withTimeout(
                    runAiTaskControllerV2(
                        { ownerKey: OWNER, requestId: crypto.randomUUID(), conversationId: `e2:${family.family}`, messages: [{ role: 'user', content: question }] },
                        { provider: nativeProvider, executeToolCall: execute, sessionStore: sessions },
                    ),
                    PER_RUN_TIMEOUT_MS,
                    `${family.family}:${question}`,
                );
                const facts = projectMoneyFacts(calls, { includeQueries: true });
                runs.push(evaluateRun({ family: family.family, question, result, receipts: calls, facts }));
            }
        }
    } finally {
        await runtime.close();
    }

    const metrics = {
        runs: runs.length,
        unsafeDeliveredRuns: runs.filter(run => run.unsafe).length,
        wrongCanonicalBinding: runs.filter(run => run.wrongBinding).length,
        unexplainedBusinessRegression: runs.filter(run => run.regression).length,
    };
    const evidence = {
        ticket: 'AI-NATIVE-PHASE-E2-COVERAGE-WAVE-1',
        generatedAt: new Date().toISOString(),
        head: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        provider: { requested: PROVIDER, model: providerConfig.model, apiKeyPresent: true },
        database: { source: prepared.sourcePath, clonePath: prepared.databasePath, cloneSha256: prepared.sha256, sourceTouched: false },
        metrics,
        runs,
        details: runs.filter(run => run.unsafe || run.wrongBinding || run.regression)
            .map(run => ({ question: run.question, unsafe: run.unsafe, wrongBinding: run.wrongBinding, regression: run.regression })),
    };
    const outPath = path.resolve(args.get('out') || path.join(root, 'logs/e2-wave1-live.json'));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ outPath, metrics, states: runs.map(run => `${run.family}:${run.state}`) }, null, 2)}\n`);
    if (metrics.unsafeDeliveredRuns || metrics.wrongCanonicalBinding || metrics.unexplainedBusinessRegression) process.exitCode = 1;
}

main().catch(error => {
    process.stderr.write(`E2_WAVE1_LIVE_FAILED ${error.code || error.message}\n`);
    process.exitCode = 1;
});
