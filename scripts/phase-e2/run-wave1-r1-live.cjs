'use strict';
/**
 * E2-R1 — CLOSURE 真实模型执行器。
 *
 * 真实 DeepSeek + production-shaped 数据库只读副本 + 真实业务 HTTP 面：
 *   A. FAMILY-01 配方成本比较 ≥5 次（直接比较 / 口语比较 / A 模糊 / B 模糊 / 非金额负对照）
 *   B. 跨轮 canonical 主体继承 ≥5 次（这个还有库存吗 / 这个成本呢 / 换V550 / 不是这个 / 新的明确主体）
 *   C. Wave-1 线圈成本与线圈库存（回归）
 *
 * 判据全部由本轮正式回执推导（receipt-first），不使用硬编码 baseline：
 *   unsafeDeliveredRuns            交付了无法回溯到正式回执的业务数字
 *   wrongCanonicalBinding          事实绑定了错误的 canonical entity（或该澄清却直接作答）
 *   selfCalculatedMoney            差额/方向数字不是正式回执值（= 自行相减）
 *   unexplainedBusinessRegression  回答与正式回执不一致
 *
 * 用法：node scripts/phase-e2/run-wave1-r1-live.cjs [--env-file <path>] [--db <path>] [--out <path>]
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
const DEFAULT_SOURCES = [
    '/Users/dan/Documents/水泵工厂管理助手/backups/macmini-before-catalog-clear/pump-safety-2026-09-16T01-14-48-791Z.db',
    '/Users/dan/Documents/水泵工厂管理助手/pump.db',
];
const PROVIDER = 'deepseek';
const OWNER = 'phase-e2r1-owner';
const PER_RUN_TIMEOUT_MS = 240000;

// ── 场景（同一 conversation 内按顺序执行，逐轮判定）─────────────────────
const SCENARIOS = Object.freeze([
    {
        suite: 'WAVE1', key: 'wave1-coil-cost', steps: [
            { question: '12-120成本多少？', expect: { kind: 'COIL_COST', predicate: 'coil.current_cost' } },
            { question: '12-200多少钱？', expect: { state: 'WAITING_INPUT' } },
            { question: '12-140现在库存多少？', expect: { kind: 'INVENTORY_QUERY', predicate: 'inventory.coil' } },
        ],
    },
    {
        suite: 'COMPARISON', key: 'cmp-direct', steps: [
            { question: 'v550-tokoy和PHASED-浮球-有成本差多少？', expect: { kind: 'RECIPE_COST_COMPARISON', predicates: ['recipe.current_cost', 'recipe.current_cost', 'recipe.cost_difference'] } },
        ],
    },
    {
        suite: 'COMPARISON', key: 'cmp-colloquial', steps: [
            { question: '帮我比较一下 v550-tokoy 和 PHASED-浮球-有 哪个成本高一点，高多少？', expect: { kind: 'RECIPE_COST_COMPARISON', predicates: ['recipe.current_cost', 'recipe.current_cost', 'recipe.cost_difference'] } },
        ],
    },
    {
        suite: 'COMPARISON', key: 'cmp-a-ambiguous', steps: [
            { question: 'PHASED-同名方案和v550-tokoy成本差多少？', expect: { state: 'WAITING_INPUT', reasonCode: 'RECIPE_COMPARISON_AMBIGUOUS' } },
        ],
    },
    {
        suite: 'COMPARISON', key: 'cmp-b-ambiguous', steps: [
            { question: 'v550-tokoy和PHASED-同名方案成本差多少？', expect: { state: 'WAITING_INPUT', reasonCode: 'RECIPE_COMPARISON_AMBIGUOUS' } },
        ],
    },
    {
        suite: 'COMPARISON', key: 'cmp-negative-nonmoney', steps: [
            { question: 'v550-tokoy和PHASED-浮球-有什么配置区别？', expect: { forbidKind: 'RECIPE_COST_COMPARISON', forbidMoney: true } },
        ],
    },
    {
        suite: 'CONTINUATION', key: 'cont-inventory-after-cost', steps: [
            { question: '12-120成本多少？', expect: { kind: 'COIL_COST', predicate: 'coil.current_cost' } },
            { question: '这个还有库存吗？', expect: { kind: 'INVENTORY_QUERY', predicate: 'inventory.coil', sameFocus: true, forbidPredicate: 'coil.current_cost' } },
        ],
    },
    {
        suite: 'CONTINUATION', key: 'cont-cost-after-inventory', steps: [
            { question: '12-140还有多少？', expect: { kind: 'INVENTORY_QUERY', predicate: 'inventory.coil' } },
            { question: '这个成本呢？', expect: { kind: 'COIL_COST', predicate: 'coil.current_cost', sameFocus: true, forbidPredicate: 'inventory.coil' } },
        ],
    },
    {
        suite: 'CONTINUATION', key: 'cont-explicit-override', steps: [
            { question: '12-120成本多少？', expect: { kind: 'COIL_COST' } },
            { question: '先查V550成本', expect: { movedFocus: true, forbidPredicate: 'coil.current_cost' } },
        ],
    },
    {
        suite: 'CONTINUATION', key: 'cont-negation', steps: [
            { question: '12-120成本多少？', expect: { kind: 'COIL_COST' } },
            { question: '不是这个', expect: { forbidMoney: true } },
        ],
    },
    {
        suite: 'CONTINUATION', key: 'cont-ambiguous-then-select', steps: [
            { question: '12-200成本多少？', expect: { state: 'WAITING_INPUT' } },
            { question: '第二个', expect: { kind: 'COIL_COST' } },
            { question: '这个还有库存吗？', expect: { kind: 'INVENTORY_QUERY', predicate: 'inventory.coil', sameFocus: true } },
        ],
    },
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
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`E2R1_TIMEOUT ${label}`), { code: 'E2R1_TIMEOUT' })), ms); })]).finally(() => { if (timer) clearTimeout(timer); });
}
const MONEY_RE = /[¥￥]\s*\d+(?:\.\d+)?|\d+\.\d{2}/gu;
const SUBJECT_RE = /\d+\s*-\s*\d+/gu;
function deliveredNumbers(answer, question) {
    const text = String(answer ?? '')
        .replace(new RegExp(SUBJECT_RE.source, 'gu'), match => (question && question.includes(match.replace(/\s+/gu, '')) ? 'MODEL' : match))
        .replace(/[A-Za-z][A-Za-z-]*\d+/gu, 'CODE');
    return [...new Set([...text.matchAll(MONEY_RE)].map(match => match[0].replace(/[¥￥\s]/gu, '')))];
}
function formalValues(receipts) {
    const values = new Set();
    const walk = (value, depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 4) return;
        for (const [key, item] of Object.entries(value)) {
            if ((typeof item === 'number' || (typeof item === 'string' && /^-?\d+(?:\.\d+)?$/u.test(item.trim()))) && /cost|price|amount|total|stock|quantity|qty|diff/iu.test(key)) values.add(String(item).trim());
            else if (item && typeof item === 'object') walk(item, depth + 1);
        }
    };
    for (const receipt of receipts) walk(receipt.result);
    return values;
}
/** 差额/方向语境里的数字（自行相减的唯一表现面）。 */
function differenceClaims(answer) {
    const text = String(answer ?? '');
    const claims = [];
    for (const segment of text.split(/[。；;]/u)) {
        if (!/(?:差额|高|低|贵|便宜)/u.test(segment)) continue;
        for (const match of segment.matchAll(MONEY_RE)) claims.push(match[0].replace(/[¥￥\s]/gu, ''));
    }
    return claims;
}

function evaluateRun({ step, result, receipts, previousFocus }) {
    const expect = step.expect || {};
    const state = result.task.state;
    const answer = result.answer?.content || '';
    const kinds = result.task.goals.map(goal => goal.kind);
    // 目标的正式事实以 TaskEnvelope 投影为准；moneyFactProjection 只用于金额回溯。
    const taskFacts = result.task.facts || [];
    const predicates = taskFacts.map(fact => fact.key?.predicate);
    // 焦点身份必须带 entityType：真实库里 recipe:1 与 coil:1 都存在，裸 ID 会互相误判。
    const bareIds = taskFacts.map(fact => (fact.key?.entityType && fact.key?.entityId ? `${fact.key.entityType}:${fact.key.entityId}` : null)).filter(Boolean);
    const numbers = deliveredNumbers(answer, step.question);
    const formal = formalValues(receipts);
    const problems = [];

    if (expect.state && state !== expect.state) problems.push(`state=${state} expected=${expect.state}`);
    if (expect.kind && !kinds.includes(expect.kind)) problems.push(`missing goal ${expect.kind} (got ${kinds.join('/')})`);
    if (expect.forbidKind && kinds.includes(expect.forbidKind)) problems.push(`forbidden goal ${expect.forbidKind}`);
    if (expect.predicate && !predicates.includes(expect.predicate)) problems.push(`missing fact ${expect.predicate}`);
    if (expect.predicates && JSON.stringify([...predicates].sort()) !== JSON.stringify([...expect.predicates].sort())) problems.push(`facts=${predicates.join('/')} expected=${expect.predicates.join('/')}`);
    if (expect.reasonCode && !result.task.questions.some(question => question.reasonCode === expect.reasonCode)) problems.push(`missing reason ${expect.reasonCode}`);
    if (expect.forbidPredicate && predicates.includes(expect.forbidPredicate)) problems.push(`reused stale predicate ${expect.forbidPredicate}`);
    if (expect.sameFocus && previousFocus && bareIds.length && bareIds.some(id => id !== previousFocus)) problems.push(`focus moved ${previousFocus} → ${bareIds.join('/')}`);
    if (expect.movedFocus && previousFocus && bareIds.includes(previousFocus)) problems.push(`focus did not move from ${previousFocus}`);
    if (expect.forbidMoney && numbers.length) problems.push(`delivered money in a negative control: ${numbers.join(',')}`);

    // 任何业务数字都必须能回溯到本轮正式回执
    const untraceable = numbers.filter(number => ![...formal].some(value => Math.abs(Number(value) - Number(number)) < 0.005));
    if (untraceable.length && state === 'SUCCEEDED') problems.push(`untraceable numbers: ${untraceable.join(',')}`);
    // 差额类数字必须来自正式回执（不得自行相减）
    const selfCalculated = differenceClaims(answer).filter(number => ![...formal].some(value => Math.abs(Number(value) - Number(number)) < 0.005));
    if (selfCalculated.length) problems.push(`self-calculated difference: ${selfCalculated.join(',')}`);

    return {
        suite: step.suite || null, question: step.question, state, kinds, predicates, entityIds: bareIds,
        questions: result.task.questions.map(question => question.reasonCode),
        receipts: receipts.map(receipt => receipt.name), answer,
        deliveredNumbers: numbers,
        problems,
        unsafe: state !== 'SUCCEEDED' && numbers.length ? `非成功状态仍输出数字 ${numbers.join(',')}` : null,
        wrongBinding: problems.find(item => /focus|missing goal|state=|forbidden goal|reused stale/u.test(item)) || null,
        selfCalculated: selfCalculated.length ? `差额未回溯到正式回执 ${selfCalculated.join(',')}` : null,
        regression: untraceable.length ? `回答与正式回执不一致 ${untraceable.join(',')}` : null,
    };
}

async function main() {
    const envFile = path.resolve(args.get('env-file') || DEFAULT_ENV_FILE);
    if (!fs.existsSync(envFile)) throw Object.assign(new Error(`E2R1_ENV_MISSING ${envFile}`), { code: 'E2R1_ENV_MISSING' });
    dotenv.config({ path: envFile, quiet: true });
    process.env.AI_PROVIDER = PROVIDER;
    const { resolveProviderConfig } = require('../../api/services/aiProviderRegistry.cjs');
    const providerConfig = resolveProviderConfig(PROVIDER, process.env);
    if (!providerConfig.apiKey) throw Object.assign(new Error('E2R1_PROVIDER_KEY_MISSING'), { code: 'E2R1_PROVIDER_KEY_MISSING' });

    const sourcePath = path.resolve(args.get('db') || DEFAULT_SOURCES.find(candidate => fs.existsSync(candidate)) || '');
    const prepared = await preparePhaseDDatabase(sourcePath, fs.mkdtempSync(path.join(os.tmpdir(), 'e2r1-live-')));
    prepared.close();
    const runtime = await startPhaseDRuntime(prepared.databasePath, { internalSecret: `e2r1-${crypto.randomUUID()}` });
    const { runAiTaskControllerV2 } = require('../../api/services/aiTaskControllerV2.cjs');
    const { createTaskSessionStoreV2 } = require('../../api/services/aiTaskSessionV2.cjs');
    const { executeToolCall } = require('../../api/routes/ai/executor.cjs');
    const { fetchAiProvider } = require('../../api/services/aiProvider.cjs');
    const { projectMoneyFacts } = require('../../api/services/moneyFactProjection.cjs');

    globalThis.__PHASE_D_BASE_URL__ = runtime.baseUrl;
    globalThis.__PHASE_D_HEADERS__ = runtime.headers();
    const nativeProvider = async request => fetchAiProvider(request.messages, { tools: request.tools, toolChoice: request.toolChoice, signal: request.signal });

    const runs = [];
    try {
        for (const scenario of SCENARIOS) {
            const sessions = createTaskSessionStoreV2();
            let previousFocus = null;
            for (const rawStep of scenario.steps) {
                const step = { ...rawStep, suite: scenario.suite };
                const calls = [];
                const execute = async (toolName, toolArgs, options) => {
                    const receipt = await executeToolCall(toolName, toolArgs, options);
                    calls.push({ name: toolName, result: receipt });
                    return receipt;
                };
                const result = await withTimeout(
                    runAiTaskControllerV2(
                        { ownerKey: OWNER, requestId: crypto.randomUUID(), conversationId: `e2r1:${scenario.key}`, messages: [{ role: 'user', content: step.question }] },
                        { provider: nativeProvider, executeToolCall: execute, sessionStore: sessions },
                    ),
                    PER_RUN_TIMEOUT_MS,
                    `${scenario.key}:${step.question}`,
                );
                const facts = projectMoneyFacts(calls, { includeQueries: true });
                const evaluation = evaluateRun({ step, result, receipts: calls, facts, previousFocus });
                evaluation.scenario = scenario.key;
                runs.push(evaluation);
                const focus = result.task.facts.map(fact => (fact.key?.entityType && fact.key?.entityId ? `${fact.key.entityType}:${fact.key.entityId}` : null)).find(Boolean) || null;
                if (result.task.state === 'SUCCEEDED') previousFocus = result.task.goals.some(goal => goal.kind === 'RECIPE_COST_COMPARISON') ? null : focus;
            }
        }
    } finally {
        await runtime.close();
    }

    const of = suite => runs.filter(run => run.suite === suite);
    const count = predicate => runs.filter(predicate).length;
    const metrics = {
        runs: runs.length,
        comparisonRuns: of('COMPARISON').length,
        continuationRuns: of('CONTINUATION').length,
        unsafeDeliveredRuns: count(run => run.unsafe),
        wrongCanonicalBinding: count(run => run.wrongBinding),
        selfCalculatedMoney: count(run => run.selfCalculated),
        unexplainedBusinessRegression: count(run => run.regression),
        scenarioProblems: count(run => run.problems.length),
    };
    const evidence = {
        ticket: 'AI-NATIVE-PHASE-E2-R1-COVERAGE-WAVE-1-CLOSURE',
        generatedAt: new Date().toISOString(),
        head: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        provider: { requested: PROVIDER, model: providerConfig.model, apiKeyPresent: true },
        database: { source: prepared.sourcePath, clonePath: prepared.databasePath, cloneSha256: prepared.sha256, sourceTouched: false },
        metrics, runs,
    };
    const outPath = path.resolve(args.get('out') || path.join(root, 'logs/e2r1-live.json'));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ outPath, metrics, states: runs.map(run => `${run.scenario}:${run.state}`), problems: runs.flatMap(run => run.problems.map(problem => `${run.scenario}: ${problem}`)) }, null, 2)}\n`);
    if (metrics.unsafeDeliveredRuns || metrics.wrongCanonicalBinding || metrics.selfCalculatedMoney || metrics.unexplainedBusinessRegression) process.exitCode = 1;
}

main().catch(error => {
    process.stderr.write(`E2R1_LIVE_FAILED ${error.code || error.message}\n`);
    process.exitCode = 1;
});
