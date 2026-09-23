'use strict';
/**
 * S1 — SUPPORTED SCOPE STABILITY CLOSURE 真实执行器。
 *
 * 真实 DeepSeek + production-shaped 数据库只读副本 + 真实业务 HTTP 面：
 *   F. Owner 稳定性矩阵：6 个 SUPPORTED family × 10 个真实老板问法 = 60 轮
 *   G. 连续会话链（线圈链 4 轮 / 配方链 3 轮）
 *   H. 重复稳定性：15 条代表问法 × 3 次（每次新会话）
 *   L. Legacy / Native 事实对齐抽样（每族 2 条）
 *   M. fallback 观察（TIER1/TIER2 关键词分类 + 非正式金额启发式命中数）
 *
 * 判据全部由本轮正式回执推导；canary admission 与 dispatcher 使用同一函数：
 *   admission 不合格 → SAFE_FALLBACK（真实请求会走既有正式路径）。
 *
 * 安全：只读复制数据库；业务面只读；不部署；不写生产库；不打印凭据。
 *
 * 用法：node scripts/phase-s1/run-owner-stability-live.cjs [--env-file <path>] [--db <path>] [--out <path>]
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
const OWNER = 'phase-s1-owner';
const PER_RUN_TIMEOUT_MS = 240000;

// ── F：Owner 稳定性矩阵（每族 10 条：直接 3 / 口语 2 / 连续追问 2 / 歧义 1 / 缺数据 1 / 边界 1）──
const FAMILY_SCENARIOS = Object.freeze([
    {
        familyId: 'single-recipe-current-cost', suite: 'MATRIX',
        scenarios: [
            { key: 'f1-direct-a', turns: ['v550-tokoy现在成本多少？'] },
            { key: 'f1-direct-b', turns: ['PHASED-浮球-有当前成本是多少？'] },
            { key: 'f1-direct-c', turns: ['帮我查一下 PHASED-浮球-无 的成本'] },
            { key: 'f1-colloquial-a', turns: ['v550-tokoy现在做一套大概要多少钱？'] },
            { key: 'f1-colloquial-b', turns: ['PHASED-浮球-有现在成本高不高，大概多少'] },
            { key: 'f1-followup', turns: ['v550-tokoy现在成本多少？', '那这个成本包含工资吗？'] },
            { key: 'f1-boundary', turns: ['PHASED-浮球-无 的成本是多少来着'] },
            { key: 'f1-direct-d', turns: ['PHASED-浮球-有 的当前完整成本是多少？'] },
            { key: 'f1-missing', turns: ['查一下 V999不存在的配方 的成本'] },
        ],
    },
    {
        familyId: 'multi-goal-config-profit-readiness', suite: 'MATRIX',
        scenarios: [
            { key: 'f2-direct-a', turns: ['v550-tokoy现在成本多少？电缆改5米以后呢？'] },
            { key: 'f2-direct-b', turns: ['PHASED-浮球-有当前成本多少？卖340毛利多少？'] },
            { key: 'f2-direct-c', turns: ['v550-tokoy 如果做300台库存够不够？'] },
            { key: 'f2-colloquial-a', turns: ['v550-tokoy电缆改5米要多少钱，卖340能赚多少，先不要保存'] },
            { key: 'f2-colloquial-b', turns: ['PHASED-浮球-有现在成本多少，电缆改8米呢，做200台够料吗'] },
            { key: 'f2-followup', turns: ['v550-tokoy现在成本多少？电缆改5米以后呢？卖340毛利多少？做300台库存够不够？先不要保存'] },
            { key: 'f2-boundary', turns: ['v550-tokoy现在成本多少？电缆改5米以后呢？卖340呢？'] },
            { key: 'f2-direct-d', turns: ['PHASED-浮球-无现在成本多少？做500台库存够不够？'] },
            { key: 'f2-colloquial-c', turns: ['v550-tokoy 换电缆到8米，成本差多少，卖360能赚吗'] },
            { key: 'f2-missing', turns: ['V999不存在 电缆改5米成本多少，卖340毛利多少'] },
        ],
    },
    {
        familyId: 'virtual-readiness-preview', suite: 'MATRIX',
        scenarios: [
            { key: 'f3-direct-a', turns: ['如果现在再做300台 v550-tokoy 库存够不够？'] },
            { key: 'f3-direct-b', turns: ['再做100台 PHASED-浮球-有 库存够不够？'] },
            { key: 'f3-direct-c', turns: ['如果做500台 v550-tokoy 够料吗？'] },
            { key: 'f3-colloquial-a', turns: ['v550-tokoy 再做300台的话，料够吗？'] },
            { key: 'f3-colloquial-b', turns: ['PHASED-浮球-无 再来200台，缺什么料？'] },
            { key: 'f3-followup', turns: ['再做300台 v550-tokoy 库存够不够？', '那再做500台呢？'] },
            { key: 'f3-boundary', turns: ['再做1台 v550-tokoy 库存够不够？'] },
            { key: 'f3-direct-d', turns: ['如果做50台 PHASED-浮球-无 库存够吗？'] },
            { key: 'f3-missing', turns: ['再做300台 V999不存在的配方 库存够不够？'] },
        ],
    },
    {
        familyId: 'recipe-cost-comparison', suite: 'MATRIX',
        scenarios: [
            { key: 'f4-direct-a', turns: ['v550-tokoy和v750-tokoy成本差多少？'] },
            { key: 'f4-direct-b', turns: ['PHASED-浮球-有和PHASED-浮球-无差多少钱？'] },
            { key: 'f4-direct-c', turns: ['对比 v550-tokoy 和 PHASED-浮球-有 的成本'] },
            { key: 'f4-colloquial-a', turns: ['帮我比较一下 v550-tokoy 和 PHASED-浮球-有 哪个成本高一点，高多少？'] },
            { key: 'f4-colloquial-b', turns: ['v550-tokoy 比 PHASED-浮球-无 贵多少？'] },
            { key: 'f4-followup', turns: ['v550-tokoy和v750-tokoy成本差多少？', '第二个现在完整成本呢？'] },
            { key: 'f4-boundary', turns: ['PHASED-浮球-有和PHASED-浮球-有成本差多少？'] },
            { key: 'f4-direct-d', turns: ['PHASED-浮球-无和PHASED-浮球-有哪个成本高？'] },
            { key: 'f4-missing', turns: ['v550-tokoy和V999不存在的配方成本差多少？'] },
        ],
    },
    {
        familyId: 'coil-catalogue-cost', suite: 'MATRIX',
        scenarios: [
            { key: 'f5-direct-a', turns: ['12-120成本多少？'] },
            { key: 'f5-direct-b', turns: ['12-140的成本是多少？'] },
            { key: 'f5-direct-c', turns: ['帮我查12-140线圈成本'] },
            { key: 'f5-colloquial-a', turns: ['12-120这个线圈现在多少钱？'] },
            { key: 'f5-colloquial-b', turns: ['12-140现在做一套线圈要多少钱'] },
            { key: 'f5-followup', turns: ['12-120成本多少？', '那12-140呢？'] },
            { key: 'f5-ambiguous', turns: ['12-200现在是什么成本？'] },
            { key: 'f5-direct-d', turns: ['12-120这个方案的成本是多少？'] },
            { key: 'f5-missing', turns: ['12-999成本多少？'] },
        ],
    },
    {
        familyId: 'coil-inventory', suite: 'MATRIX',
        scenarios: [
            { key: 'f6-direct-a', turns: ['12-120还有多少？'] },
            { key: 'f6-direct-b', turns: ['12-140现在库存多少？'] },
            { key: 'f6-direct-c', turns: ['12-120的库存是多少？'] },
            { key: 'f6-colloquial-a', turns: ['12-120还有货吗？'] },
            { key: 'f6-colloquial-b', turns: ['12-140还剩多少？'] },
            { key: 'f6-followup', turns: ['12-120还有多少？', '那12-140呢？'] },
            { key: 'f6-ambiguous', turns: ['12-200有库存吗？'] },
            { key: 'f6-direct-d', turns: ['12-120现在有多少库存？'] },
            { key: 'f6-missing', turns: ['12-999有库存吗？'] },
        ],
    },
]);

// ── G：连续会话链 ─────────────────────────────────────────────────────
const CHAINS = Object.freeze([
    {
        key: 'chain-coil', suite: 'CHAIN',
        turns: [
            { question: '12-200成本多少？', expect: { state: 'WAITING_INPUT' } },
            { question: '第二个', expect: { predicate: 'coil.current_cost' } },
            { question: '这个还有库存吗？', expect: { predicate: 'inventory.coil', sameFocus: true } },
            { question: '12-140成本多少？', expect: { predicate: 'coil.current_cost', movedFocus: true } },
        ],
    },
    {
        key: 'chain-recipe', suite: 'CHAIN',
        turns: [
            { question: 'v550-tokoy和v750-tokoy差多少钱？', expect: { kind: 'RECIPE_COST_COMPARISON' } },
            { question: '第二个现在完整成本呢？', expect: { kind: 'CURRENT_COST' } },
            { question: '那第一个呢？', expect: { kind: 'CURRENT_COST', movedFocus: true } },
        ],
    },
]);

// ── H：重复稳定性（15 条 × 3 次，每次新会话）──────────────────────────
const REPEAT_QUESTIONS = Object.freeze([
    'v550-tokoy现在成本多少？',
    'PHASED-浮球-有当前成本是多少？',
    '帮我查一下 PHASED-浮球-无 的成本',
    '12-120成本多少？',
    '12-140的成本是多少？',
    '12-120还有多少？',
    '12-140现在库存多少？',
    '12-200有库存吗？',
    '12-200成本多少？',
    'v550-tokoy和v750-tokoy成本差多少？',
    'PHASED-浮球-有和PHASED-浮球-无差多少钱？',
    'v550-tokoy和PHASED-同名方案成本差多少？',
    'v550-tokoy现在成本多少？电缆改5米以后呢？',
    '如果现在再做300台 v550-tokoy 库存够不够？',
    'PHASED-浮球-有电缆改5米以后成本多少，卖340毛利多少',
]);

// ── L：Legacy / Native 事实对齐抽样（每族 2 条）────────────────────────
const PARITY_QUESTIONS = Object.freeze([
    'v550-tokoy现在成本多少？', 'PHASED-浮球-有当前成本是多少？',
    'v550-tokoy现在成本多少？电缆改5米以后呢？', 'PHASED-浮球-有当前成本多少？卖340毛利多少？',
    '如果现在再做300台 v550-tokoy 库存够不够？', '再做100台 PHASED-浮球-有 库存够不够？',
    'v550-tokoy和v750-tokoy成本差多少？', 'PHASED-浮球-有和PHASED-浮球-无差多少钱？',
    '12-120成本多少？', '12-140的成本是多少？',
    '12-120还有多少？', '12-140现在库存多少？',
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
const SMOKE = args.get('smoke') === 'true';
function withTimeout(promise, ms, label) {
    let timer = null;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`S1_TIMEOUT ${label}`), { code: 'S1_TIMEOUT' })), ms); })]).finally(() => { if (timer) clearTimeout(timer); });
}

// 业务金额只在答案里以 ¥ 金额或百分比形式交付（模板契约）；裸的两位小数是**规格**（如 2.65 螺丝），
// 不是业务声明，不能被当成金额来判定 unsafe。
const AMOUNT_RE = /[¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*%/gu;
// legacy 有时会用**档案历史快照**回答并自己声明「不是本轮实时结果」。这不是 Native 的价值冲突，
// 而是口径/完整性差异 —— 必须分开记录，不能算成业务回归。
const LEGACY_STALE_DISCLOSURE_RE = /(?:历史成本快照|不能作为本轮|未取得正式当前完整成本|保存的.{0,12}成本|历史报价|快照)/u;
const BASIS_KEYWORDS = Object.freeze({ 成本: /成本|总成本/u, 库存: /库存|有货|还剩/u, 毛利: /毛利|利润/u, 齐料: /齐料|够不够|缺料/u, 差额: /差额|差多少|贵多少|便宜多少|高多少|低多少/u });
function amountsOf(text) { return [...new Set([...String(text ?? '').matchAll(AMOUNT_RE)].map(match => match[0].replace(/[¥￥\s%]/gu, '')))]; }
function basesOf(text) { return Object.entries(BASIS_KEYWORDS).filter(([, pattern]) => pattern.test(String(text ?? ''))).map(([name]) => name); }
/**
 * 本轮全部正式回执里的数值叶子（含数字字符串）。
 * 判据是「回答里出现的金额能否在**本轮正式回执**里找到同值证据」——因此不按字段名过滤，
 * 否则 camelCase 的正式字段（currentTotalCost/shortageQty/grossProfitPerUnit…）会被漏掉，
 * 造成把完全合规的回答误判为 unsafe。
 */
function receiptValues(receipts) {
    const values = new Set();
    const walk = (value, depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 5) return;
        for (const item of Object.values(value)) {
            if (typeof item === 'number' && Number.isFinite(item)) values.add(String(item));
            else if (typeof item === 'string' && /^-?\d+(?:\.\d+)?$/u.test(item.trim())) values.add(String(Number(item.trim())));
            else if (item && typeof item === 'object') walk(item, depth + 1);
        }
    };
    for (const receipt of receipts) walk(receipt.result);
    return values;
}
function receiptEntityIds(receipts) {
    const ids = new Set();
    for (const receipt of receipts) {
        const data = receipt.result?.data;
        if (Array.isArray(data)) for (const row of data) if (row && typeof row === 'object' && row.id !== undefined) ids.add(String(row.id));
    }
    return ids;
}
/**
 * 交付数字必须能回溯到**本轮正式回执的某个数值**，只允许展示层变换：
 *   ① 同值（含 1 分钱内取整，如 98.38753 → ¥98.39）
 *   ② 绝对值（方向用「增加/减少」表达，如正式 -4.35 → 「减少 ¥4.35」）
 *   ③ 比率转百分比（如 0.2129 → 21.29%）
 * 不允许任何**两个正式值之间的运算**（那才是自行相减）。
 */
const PRESENTATION_TRANSFORMS = Object.freeze([
    (formal, value) => Math.abs(formal - value) < 0.005,
    (formal, value) => Math.abs(Number(formal.toFixed(2)) - value) < 0.005,
    (formal, value) => Math.abs(Math.abs(formal) - value) < 0.005,
    (formal, value) => Math.abs(Number(Math.abs(formal).toFixed(2)) - value) < 0.005,
    (formal, value) => Math.abs(formal * 100 - value) < 0.02,
    (formal, value) => Math.abs(Number((formal * 100).toFixed(2)) - value) < 0.02,
]);
const traceable = (numbers, formal) => numbers.filter(number => ![...formal].some(value => {
    const formalValue = Number(value);
    return Number.isFinite(formalValue) && PRESENTATION_TRANSFORMS.some(transform => transform(formalValue, Number(number)));
}));

function judge({ suite, familyId, scenarioKey, question, result, receipts, previousFocus, expect = {} }) {
    const admission = result.canaryAdmission || { eligible: false, reason: 'NO_ADMISSION' };
    const facts = result.task.facts || [];
    const kinds = result.task.goals.map(goal => goal.kind);
    const predicates = facts.map(fact => fact.key?.predicate);
    const entityIds = facts.map(fact => (fact.key?.entityType && fact.key?.entityId ? `${fact.key.entityType}:${fact.key.entityId}` : null)).filter(Boolean);
    const bareIds = facts.map(fact => fact.key?.entityId).filter(Boolean);
    const answer = result.answer?.content || '';
    const numbers = amountsOf(answer);
    const formal = receiptValues(receipts);
    const entityCandidates = receiptEntityIds(receipts);
    const problems = [];
    // 正式负结果（对象不存在）是**正确**结果，不是失败；计划未进入任何准入族则是**安全回退**。
    const negative = facts.some(fact => fact.evidenceState === 'VERIFIED_NEGATIVE')
        || result.task.goals.some(goal => goal.blockers.some(item => /NOT_FOUND|NOT_PROPOSED|ENTITY_UNAVAILABLE/u.test(item.code)));
    let outcome;
    if (admission.eligible !== true) outcome = kinds.length && kinds.every(kind => kind === 'OTHER') ? 'OUT_OF_ADMISSION_SCOPE' : 'SAFE_FALLBACK';
    else if (result.task.state === 'SUCCEEDED') outcome = 'NATIVE_SUCCEEDED';
    else if (result.task.state === 'WAITING_INPUT') outcome = 'WAITING_INPUT';
    else if (result.task.state === 'PARTIAL') outcome = 'PARTIAL';
    else if (negative) outcome = 'NEGATIVE_RESULT';
    else outcome = 'FAILED';

    if (expect.state && result.task.state !== expect.state) problems.push(`state=${result.task.state} expected=${expect.state}`);
    if (expect.kind && !kinds.includes(expect.kind)) problems.push(`missing goal ${expect.kind} (got ${kinds.join('/')})`);
    if (expect.predicate && !predicates.includes(expect.predicate)) problems.push(`missing fact ${expect.predicate}`);
    if (expect.sameFocus && previousFocus && bareIds.length && bareIds.some(id => id !== previousFocus)) problems.push(`focus moved ${previousFocus} → ${bareIds.join('/')}`);
    if (expect.movedFocus && previousFocus && bareIds.includes(previousFocus)) problems.push(`focus did not move from ${previousFocus}`);
    if (outcome === 'NATIVE_SUCCEEDED' && !facts.length) problems.push('SUCCEEDED without any formal fact');
    if (outcome === 'NATIVE_SUCCEEDED' && !receipts.length) problems.push('SUCCEEDED without any formal receipt');
    if (outcome === 'NATIVE_SUCCEEDED' && !entityCandidates.size && bareIds.length) problems.push('facts without receipt-backed candidates');
    const untraceable = numbers.length ? traceable(numbers, formal) : [];
    const wrongBinding = facts.filter(fact => fact.key?.entityId && entityCandidates.size && !entityCandidates.has(String(fact.key.entityId))).map(fact => fact.key.entityId);
    const selfCalculated = basesOf(answer).includes('差额') ? traceable(numbers, formal) : [];

    return {
        suite, familyId, scenarioKey, question, outcome, state: result.task.state,
        admission: { eligible: admission.eligible === true, reason: admission.reason, decision: admission.decision },
        kinds, predicates, entityIds, questions: result.task.questions.map(item => item.reasonCode),
        tools: receipts.map(receipt => receipt.name), answer, amounts: numbers,
        formalValues: [...formal].slice(0, 400), formalEntityIds: [...entityCandidates].slice(0, 100),
        problems,
        unsafe: untraceable.length ? `untraceable: ${untraceable.join(',')}` : null,
        wrongBinding: wrongBinding.length ? `facts bound outside receipt candidates: ${wrongBinding.join(',')}` : null,
        selfCalculated: selfCalculated.length ? `difference not from receipt: ${selfCalculated.join(',')}` : null,
        regression: untraceable.length ? `contradicts formal receipt: ${untraceable.join(',')}` : null,
        factCount: facts.length,
    };
}

async function main() {
    const envFile = path.resolve(args.get('env-file') || DEFAULT_ENV_FILE);
    if (!fs.existsSync(envFile)) throw Object.assign(new Error(`S1_ENV_MISSING ${envFile}`), { code: 'S1_ENV_MISSING' });
    dotenv.config({ path: envFile, quiet: true });
    process.env.AI_PROVIDER = PROVIDER;
    const { resolveProviderConfig } = require('../../api/services/aiProviderRegistry.cjs');
    const providerConfig = resolveProviderConfig(PROVIDER, process.env);
    if (!providerConfig.apiKey) throw Object.assign(new Error('S1_PROVIDER_KEY_MISSING'), { code: 'S1_PROVIDER_KEY_MISSING' });

    const sourcePath = path.resolve(args.get('db') || DEFAULT_SOURCES.find(candidate => fs.existsSync(candidate)) || '');
    const prepared = await preparePhaseDDatabase(sourcePath, fs.mkdtempSync(path.join(os.tmpdir(), 's1-live-')));
    prepared.close();
    const runtime = await startPhaseDRuntime(prepared.databasePath, { internalSecret: `s1-${crypto.randomUUID()}` });
    const { runAiTaskControllerV2 } = require('../../api/services/aiTaskControllerV2.cjs');
    const { createTaskSessionStoreV2 } = require('../../api/services/aiTaskSessionV2.cjs');
    const { executeToolCall } = require('../../api/routes/ai/executor.cjs');
    const { fetchAiProvider } = require('../../api/services/aiProvider.cjs');
    const { runAiAssistant } = require('../../api/services/aiAssistantRuntime.cjs');
    const { TIER1_PATTERN, TIER2_PATTERN } = require('../../api/services/aiPresentationNormalizer.cjs');
    const { unsupportedMoneyInAnswer } = require('../../api/services/aiAssistantAnswer.cjs');

    globalThis.__PHASE_D_BASE_URL__ = runtime.baseUrl;
    globalThis.__PHASE_D_HEADERS__ = runtime.headers();
    const nativeProvider = async request => fetchAiProvider(request.messages, { tools: request.tools, toolChoice: request.toolChoice, signal: request.signal });

    const runs = [];
    const legacyRuns = [];
    const nativeTurn = async (question, conversationKey, sessions) => {
        const calls = [];
        const execute = async (toolName, toolArgs, options) => {
            const receipt = await executeToolCall(toolName, toolArgs, options);
            calls.push({ name: toolName, result: receipt });
            return receipt;
        };
        const result = await withTimeout(
            runAiTaskControllerV2(
                { ownerKey: OWNER, requestId: crypto.randomUUID(), conversationId: conversationKey, messages: [{ role: 'user', content: question }] },
                { provider: nativeProvider, executeToolCall: execute, sessionStore: sessions },
            ),
            PER_RUN_TIMEOUT_MS, `${conversationKey}:${question}`,
        );
        return { result, receipts: calls };
    };
    const runScenario = async (scenario, suite, familyId) => {
        const sessions = createTaskSessionStoreV2();
        let previousFocus = null;
        for (const turn of scenario.turns) {
            const question = typeof turn === 'string' ? turn : turn.question;
            const expect = typeof turn === 'string' ? {} : (turn.expect || {});
            const { result, receipts } = await nativeTurn(question, `s1:${suite}:${scenario.key}`, sessions);
            const judgement = judge({ suite, familyId, scenarioKey: scenario.key, question, result, receipts, previousFocus, expect });
            runs.push(judgement);
            const focus = result.task.facts.map(fact => fact.key?.entityId).find(Boolean) || null;
            if (result.task.state === 'SUCCEEDED' && !result.task.goals.some(goal => goal.kind === 'RECIPE_COST_COMPARISON')) previousFocus = focus;
        }
    };

    // §F 结构自检：每个 SUPPORTED family 必须正好 10 个真实问法（60 轮）
    for (const family of FAMILY_SCENARIOS) {
        const turns = family.scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0);
        if (turns !== 10) throw Object.assign(new Error(`S1_MATRIX_SIZE ${family.familyId}=${turns}`), { code: 'S1_MATRIX_SIZE' });
    }
    if (FAMILY_SCENARIOS.length !== 6) throw Object.assign(new Error('S1_MATRIX_FAMILIES'), { code: 'S1_MATRIX_FAMILIES' });

    const matrixScenarios = SMOKE ? FAMILY_SCENARIOS.map(family => ({ familyId: family.familyId, scenario: family.scenarios[0] })) : null;
    const chains = SMOKE ? CHAINS.slice(0, 1) : CHAINS;
    const repeatQuestions = SMOKE ? REPEAT_QUESTIONS.slice(0, 1) : REPEAT_QUESTIONS;
    const parityQuestions = SMOKE ? PARITY_QUESTIONS.slice(0, 1) : PARITY_QUESTIONS;

    try {
        if (SMOKE) for (const item of matrixScenarios) await runScenario(item.scenario, 'MATRIX', item.familyId);
        else for (const family of FAMILY_SCENARIOS) for (const scenario of family.scenarios) await runScenario(scenario, 'MATRIX', family.familyId);
        for (const chain of chains) await runScenario({ key: chain.key, turns: chain.turns }, 'CHAIN', null);
        // H：重复稳定性（15 × 3，新会话）
        for (const question of repeatQuestions) {
            for (let attempt = 0; attempt < 3; attempt += 1) {
                await runScenario({ key: `repeat:${question}:${attempt}`, turns: [question] }, 'REPEAT', null);
            }
        }
        // L：Legacy / Native 事实对齐（Native 结果复用上面的执行，这里只跑 legacy）
        for (const question of parityQuestions) {
            const history = [{ role: 'user', content: question }];
            const legacy = await withTimeout(
                runAiAssistant({ messages: history, confirmationSubject: OWNER, conversationId: `s1:parity:${crypto.randomUUID()}`, env: { ...process.env, AI_PROVIDER: PROVIDER } }),
                PER_RUN_TIMEOUT_MS, `parity:${question}`,
            );
            const content = legacy.finalContent || '';
            legacyRuns.push({
                question, content, amounts: amountsOf(content), bases: basesOf(content),
                tier: TIER1_PATTERN.test(content) ? 'DECISION_CRITICAL' : TIER2_PATTERN.test(content) ? 'DIRECT_SUPPORT' : 'NONE',
                nonFormalMoney: Boolean(unsupportedMoneyInAnswer(content)),
                staleDisclosure: LEGACY_STALE_DISCLOSURE_RE.test(content),
                fallbackType: legacy.telemetry?.businessSemanticEnforcement?.fallbackType || null,
            });
        }
    } finally {
        const businessWrites = runtime.businessWrites();
        await runtime.close();

        // 「Native 命中」= 通过 canary admission 的轮次（未准入的族按设计走既有路径）。
        const native = runs.filter(run => run.admission.eligible === true);
        const count = predicate => runs.filter(predicate).length;
        const byFamily = {};
        for (const familyId of FAMILY_SCENARIOS.map(family => family.familyId)) {
            const familyRuns = runs.filter(run => run.familyId === familyId);
            byFamily[familyId] = {
                runs: familyRuns.length,
                succeeded: familyRuns.filter(run => run.outcome === 'NATIVE_SUCCEEDED').length,
                waitingInput: familyRuns.filter(run => run.outcome === 'WAITING_INPUT').length,
                partial: familyRuns.filter(run => run.outcome === 'PARTIAL').length,
                negativeResult: familyRuns.filter(run => run.outcome === 'NEGATIVE_RESULT').length,
                fallback: familyRuns.filter(run => run.outcome === 'SAFE_FALLBACK' || run.outcome === 'OUT_OF_ADMISSION_SCOPE').length,
                failed: familyRuns.filter(run => run.outcome === 'FAILED').length,
            };
        }
        // 重复稳定性：同一条问法 3 次的（目标 / 主体 / 事实 / 金额）是否一致
        const repeatGroups = repeatQuestions.map(question => runs.filter(run => run.scenarioKey?.startsWith(`repeat:${question}:`)));
        const stable = (group, pick) => new Set(group.map(pick)).size === 1;
        const repeat = {
            cases: repeatQuestions.length,
            runs: repeatGroups.reduce((sum, group) => sum + group.length, 0),
            goalStable: repeatGroups.filter(group => stable(group, run => [...run.kinds].sort().join(','))).length,
            subjectStable: repeatGroups.filter(group => stable(group, run => [...run.entityIds].sort().join(','))).length,
            factStable: repeatGroups.filter(group => stable(group, run => [...run.predicates].sort().join(','))).length,
            planStable: repeatGroups.filter(group => stable(group, run => [...run.tools].sort().join(','))).length,
            valueStable: repeatGroups.filter(group => stable(group, run => [...run.amounts].sort().join(','))).length,
        };
        // 事实对齐：以 Native 的金额/口径与 legacy 对比
        const parity = parityQuestions.map((question, index) => {
            const nativeRun = runs.find(run => run.question === question && run.outcome === 'NATIVE_SUCCEEDED');
            const legacy = legacyRuns[index];
            const nativeAmounts = nativeRun ? nativeRun.amounts : null;
            const nativeBases = basesOf(nativeRun?.answer);
            // 判据按**金额集合**比较（顺序与措辞不计）：
            //   有共同金额（1 分钱内）→ 一致；
            //   无共同金额且两侧声称同一口径 → VALUE_CONFLICT；
            //   无共同金额且口径不同/legacy 自述为历史快照 → BASIS_DELTA（口径/完整性差异，单独记录）。
            const shareAmount = (left, right) => left.some(a => right.some(b => Math.abs(Number(a) - Number(b)) <= 0.02));
            const sharedAmount = shareAmount(nativeAmounts || [], legacy.amounts);
            const basisOverlap = nativeBases.some(base => legacy.bases.includes(base));
            const roundingDelta = Boolean(nativeAmounts?.length && legacy.amounts.length && !sharedAmount
                && nativeAmounts.some(a => legacy.amounts.some(b => Math.abs(Number(a) - Number(b)) <= 0.03)));
            const valueConflict = Boolean(nativeRun && nativeAmounts?.length && legacy.amounts.length && !sharedAmount && basisOverlap && !legacy.staleDisclosure);
            const basisConflict = Boolean(nativeRun && nativeBases.length && legacy.bases.length && !basisOverlap && !legacy.staleDisclosure
                && nativeAmounts?.length && legacy.amounts.length && nativeAmounts.some(a => legacy.amounts.some(b => Math.abs(Number(a) - Number(b)) <= 0.02)));
            return {
                question, nativeState: nativeRun?.state || null, nativeAmounts, legacyAmounts: legacy.amounts,
                completenessDelta: Boolean(nativeRun) !== Boolean(legacy.amounts.length),
                basisDelta: Boolean(nativeRun && (legacy.staleDisclosure || (nativeAmounts?.length && legacy.amounts.length && !sharedAmount && !basisOverlap))),
                roundingDelta,
                legacyStaleDisclosure: legacy.staleDisclosure,
                valueConflict, basisConflict,
            };
        });
        const metrics = {
            totalOwnerCanaryRuns: runs.length,
            nativeSucceeded: native.filter(run => run.outcome === 'NATIVE_SUCCEEDED').length,
            waitingInput: native.filter(run => run.outcome === 'WAITING_INPUT').length,
            partial: native.filter(run => run.outcome === 'PARTIAL').length,
            negativeResult: native.filter(run => run.outcome === 'NEGATIVE_RESULT').length,
            safeFallback: runs.filter(run => run.outcome === 'SAFE_FALLBACK').length,
            outOfAdmissionScope: runs.filter(run => run.outcome === 'OUT_OF_ADMISSION_SCOPE').length,
            failed: native.filter(run => run.outcome === 'FAILED').length,
            supportedFamilyHitRate: native.length ? Number((native.length / runs.length).toFixed(4)) : 0,
            correctCanonicalBindRate: runs.filter(run => run.factCount > 0).length
                ? Number((runs.filter(run => run.factCount > 0 && !run.wrongBinding).length / runs.filter(run => run.factCount > 0).length).toFixed(4)) : null,
            formalFactDeliveryRate: native.filter(run => run.outcome === 'NATIVE_SUCCEEDED' || run.outcome === 'PARTIAL').length
                ? Number((native.filter(run => run.outcome === 'NATIVE_SUCCEEDED' || run.outcome === 'PARTIAL').filter(run => run.factCount > 0).length
                    / native.filter(run => run.outcome === 'NATIVE_SUCCEEDED' || run.outcome === 'PARTIAL').length).toFixed(4)) : null,
            repeatStabilityRate: repeat.cases ? Number((repeat.valueStable / repeat.cases).toFixed(4)) : null,
            businessWrites,
            unsafeDeliveredRuns: count(run => run.unsafe),
            wrongCanonicalBinding: count(run => run.wrongBinding),
            selfCalculatedMoney: count(run => run.selfCalculated),
            unexplainedBusinessRegression: count(run => run.regression),
            writeAdmission: runs.filter(run => run.admission.eligible === true && run.admission.reason === 'WRITE_BEARING_REQUEST').length,
        };
        const evidence = {
            ticket: 'AI-NATIVE-S1-SUPPORTED-SCOPE-STABILITY',
            generatedAt: new Date().toISOString(),
            head: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
            provider: { requested: PROVIDER, model: providerConfig.model, apiKeyPresent: true },
            database: { source: prepared.sourcePath, clonePath: prepared.databasePath, cloneSha256: prepared.sha256, sourceTouched: false },
            metrics,
            byFamily,
            repeat,
            parity: {
                sample: parity,
                valueConflict: parity.filter(item => item.valueConflict).length,
                basisConflict: parity.filter(item => item.basisConflict).length,
                completenessDelta: parity.filter(item => item.completenessDelta).length,
                basisDelta: parity.filter(item => item.basisDelta).length,
                roundingDelta: parity.filter(item => item.roundingDelta).length,
                legacyStaleDisclosure: parity.filter(item => item.legacyStaleDisclosure).length,
            },
            fallbackObservation: {
                legacyRuns: legacyRuns.length,
                tier1Tier2: { present: true, decisionCriticalHits: legacyRuns.filter(run => run.tier === 'DECISION_CRITICAL').length, directSupportHits: legacyRuns.filter(run => run.tier === 'DIRECT_SUPPORT').length },
                answerMentionsNonFormalNumber: { present: true, hits: legacyRuns.filter(run => run.nonFormalMoney).length },
                // 启发式命中 = 它确实拦下了一个非正式金额声明（例如把档案历史快照当成当前成本）。
                fallbackPreventedRegression: legacyRuns.filter(run => run.nonFormalMoney).length,
                fallbackNeverNeeded: legacyRuns.filter(run => !run.nonFormalMoney && run.tier === 'NONE').length,
                semanticFallbackTypes: [...new Set(legacyRuns.map(run => run.fallbackType).filter(Boolean))],
                redundancyCandidates: legacyRuns.length > 0 && legacyRuns.every(run => !run.nonFormalMoney && run.tier === 'NONE')
                    ? ['answerMentionsNonFormalNumber', 'TIER1/TIER2'] : [],
            },
            runs,
            legacyRuns,
        };
        const outPath = path.resolve(args.get('out') || path.join(root, 'logs/s1-owner-stability-live.json'));
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
        process.stdout.write(`${JSON.stringify({ outPath, metrics, byFamily, repeat, parity: { valueConflict: evidence.parity.valueConflict, basisConflict: evidence.parity.basisConflict, completenessDelta: evidence.parity.completenessDelta, basisDelta: evidence.parity.basisDelta, legacyStaleDisclosure: evidence.parity.legacyStaleDisclosure }, fallbackObservation: evidence.fallbackObservation, problems: runs.flatMap(run => run.problems.map(problem => `${run.scenarioKey}: ${problem}`)) }, null, 2)}\n`);
        if (metrics.businessWrites || metrics.unsafeDeliveredRuns || metrics.wrongCanonicalBinding || metrics.selfCalculatedMoney || metrics.unexplainedBusinessRegression || metrics.writeAdmission) process.exitCode = 1;
    }
}

main().catch(error => {
    process.stderr.write(`S1_LIVE_FAILED ${error.code || error.message}\n`);
    process.exitCode = 1;
});
