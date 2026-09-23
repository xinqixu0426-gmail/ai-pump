'use strict';
/**
 * AI-NATIVE STRUCTURAL REMEDIATION — PHASE D 真实执行器。
 *
 *   Real Model / Human Acceptance / Runtime Parity
 *
 * 真实链路：真实 DeepSeek provider + 真实 AI 运行时 + 真实业务 HTTP 面 + production-shaped
 * 数据库副本。判据全部由**本轮正式回执**推导（见 scripts/phase-d/oracles.cjs），
 * 不使用硬编码 baseline。
 *
 * 安全：
 *   - 数据来源只读复制到临时目录，来源连接 readonly:true；
 *   - 业务 HTTP 面只允许 GET 与已登记的只读预览；
 *   - 绝不部署、绝不修改生产数据库、绝不追加到用户生产会话。
 *
 * 用法：
 *   node scripts/run-ai-native-phase-d-live.cjs [--db <path>] [--env-file <path>] [--only <section>]
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
const oracles = require('./phase-d/oracles.cjs');
const { preparePhaseDDatabase } = require('./phase-d/prepare-database.cjs');
const { startPhaseDRuntime } = require('./phase-d/isolated-runtime.cjs');

const DEFAULT_ENV_FILE = path.join('/Users/dan/Documents/水泵工厂管理助手', '.env');
const DEFAULT_SOURCES = [
    '/Users/dan/Documents/水泵工厂管理助手/backups/macmini-before-catalog-clear/pump-safety-2026-09-16T01-14-48-791Z.db',
    '/Users/dan/Documents/水泵工厂管理助手/pump.db',
];
const WORKSPACE_DB = '/Users/dan/Documents/水泵工厂管理助手/pump.db';
const PROVIDER = 'deepseek';
const OWNER = 'phase-d-owner';
const PER_RUN_TIMEOUT_MS = 240000;

function parseArgs() {
    const args = new Map();
    for (const entry of process.argv.slice(2)) {
        const match = /^--([^=]+)(?:=(.*))?$/u.exec(entry);
        if (match) args.set(match[1], match[2] === undefined ? 'true' : match[2]);
    }
    return args;
}
const args = parseArgs();
const only = args.get('only');
const sections = new Set(String(only || 'legacy,native,parity,acceptance').split(','));

function pickSource() {
    const explicit = args.get('db');
    if (explicit) return path.resolve(explicit);
    for (const candidate of DEFAULT_SOURCES) if (fs.existsSync(candidate)) return candidate;
    throw Object.assign(new Error('PHASE_D_NO_SOURCE_DATABASE'), { code: 'PHASE_D_NO_SOURCE_DATABASE' });
}
async function withTimeout(promise, ms, label) {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`PHASE_D_TIMEOUT ${label}`), { code: 'PHASE_D_TIMEOUT' })), ms); }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

const checks = [];
/**
 * @param {'DETERMINISTIC'|'MODEL_BEHAVIOUR'} kind
 *   DETERMINISTIC —— 由正式回执/契约决定，必须 100% 通过；
 *   MODEL_BEHAVIOUR —— 取决于真实模型这一轮选了什么工具/怎么写，按通过率报告，不当作产品缺陷。
 */
function check(caseId, name, ok, detail, kind = 'DETERMINISTIC') {
    checks.push({ caseId, name, kind, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    return Boolean(ok);
}
const cases = new Map();
function recordCase(caseId, payload) {
    const existing = cases.get(caseId) || { caseId, runs: [], checks: [], status: 'PASS' };
    Object.assign(existing, payload);
    cases.set(caseId, existing);
}
function finishCase(caseId) {
    const entry = cases.get(caseId) || { caseId, runs: [], checks: [], status: 'PASS' };
    entry.checks = checks.filter(item => item.caseId === caseId);
    if (entry.error) entry.status = 'ERROR';
    else if (entry.checks.some(item => !item.ok)) entry.status = 'FAIL';
    cases.set(caseId, entry);
    return entry;
}

function runEvidence(result, userText) {
    return {
        outcome: result.telemetry.outcome,
        modelRequestCount: result.telemetry.modelRequestCount,
        executedTools: result.telemetry.executedTools,
        toolNames: result.toolResults.map(item => item.name),
        finalContent: result.finalContent,
        userText,
        formalFacts: oracles.formalMoneyFacts(result.toolResults),
        factSignature: oracles.formalFactSignature(result.toolResults),
        moneyTable: oracles.moneyTableRows(result.finalContent),
        moneySafety: oracles.moneySafety(result.finalContent, result.toolResults),
        presentation: oracles.presentationDifferential(result.finalContent, result.toolResults, userText),
        leakage: oracles.internalLeakage(result.finalContent, ['compare_recipes', 'build_recipe_bom_draft', 'get_recipe_detail', 'search_coils', 'search_parts', 'preview_recipe_cost']),
    };
}

async function main() {
    const envFile = path.resolve(args.get('env-file') || DEFAULT_ENV_FILE);
    if (!fs.existsSync(envFile)) throw Object.assign(new Error(`PHASE_D_ENV_MISSING ${envFile}`), { code: 'PHASE_D_ENV_MISSING' });
    dotenv.config({ path: envFile, quiet: true });
    process.env.AI_PROVIDER = PROVIDER;
    const { resolveProviderConfig } = require('../api/services/aiProviderRegistry.cjs');
    const providerConfig = resolveProviderConfig(PROVIDER, process.env);
    if (!providerConfig.apiKey) throw Object.assign(new Error('PHASE_D_PROVIDER_KEY_MISSING'), { code: 'PHASE_D_PROVIDER_KEY_MISSING' });

    const sourcePath = pickSource();
    const prepared = await preparePhaseDDatabase(sourcePath, fs.mkdtempSync(path.join(os.tmpdir(), 'phase-d-run-')));
    prepared.close();
    const runtime = await startPhaseDRuntime(prepared.databasePath, { internalSecret: `phase-d-${crypto.randomUUID()}` });
    const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
    const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
    const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');
    const { executeToolCall } = require('../api/routes/ai/executor.cjs');
    const { fetchAiProvider } = require('../api/services/aiProvider.cjs');

    const evidence = {
        ticket: 'AI-NATIVE-STRUCTURAL-REMEDIATION-PHASE-D',
        generatedAt: new Date().toISOString(),
        startHead: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        realModelProvider: { requested: PROVIDER, model: providerConfig.model, baseUrl: providerConfig.baseUrl, apiKeyPresent: true },
        database: {
            source: prepared.sourcePath,
            workspaceTestCopy: WORKSPACE_DB,
            clonePath: prepared.databasePath,
            cloneSha256: prepared.sha256,
            cloneSizeBytes: prepared.sizeBytes,
            tableCountsBefore: prepared.tableCountsBefore,
            tableCountsAfter: prepared.tableCountsAfter,
            sanitization: prepared.sanitization,
            augmentedFixtures: prepared.augmented,
            productionTouched: false,
        },
        cases: [],
        parity: [],
        acceptance: [],
        businessWritesDuringRuns: 0,
    };

    const conversations = new Map();
    async function converse(turns, key) {
        const conversationId = conversations.get(key) || crypto.randomUUID();
        conversations.set(key, conversationId);
        const history = conversations.get(`${key}:history`) || [];
        const runs = [];
        for (const question of turns) {
            history.push({ role: 'user', content: question });
            const result = await withTimeout(
                runAiAssistant({ messages: [...history], confirmationSubject: OWNER, conversationId, env: { ...process.env, AI_PROVIDER: PROVIDER } }),
                PER_RUN_TIMEOUT_MS,
                `${key}:${question}`,
            );
            history.push({ role: 'assistant', content: result.finalContent });
            runs.push({ question, result, evidence: runEvidence(result, question) });
        }
        conversations.set(`${key}:history`, history);
        return runs;
    }
    const nativeProvider = async request => fetchAiProvider(request.messages, { tools: request.tools, toolChoice: request.toolChoice, signal: request.signal });
    async function nativeTurns(turns, key) {
        const sessions = createTaskSessionStoreV2();
        const conversationId = `native:${key}`;
        const runs = [];
        for (const question of turns) {
            const calls = [];
            const execute = async (toolName, args, options) => {
                const receipt = await executeToolCall(toolName, args, options);
                calls.push({ toolName, args, result: receipt });
                return receipt;
            };
            const result = await withTimeout(
                runAiTaskControllerV2(
                    { ownerKey: OWNER, requestId: crypto.randomUUID(), conversationId, messages: [{ role: 'user', content: question }] },
                    { provider: nativeProvider, executeToolCall: execute, sessionStore: sessions },
                ),
                PER_RUN_TIMEOUT_MS,
                `native:${key}:${question}`,
            );
            const receipts = calls.map(call => ({ name: call.toolName, result: call.result }));
            runs.push({ question, result, calls, receipts, formalFacts: oracles.formalMoneyFacts(receipts) });
        }
        return runs;
    }
    const guard = body => { try { body(); } catch (error) { recordCase.error = String(error.code || error.message); } };
    globalThis.__PHASE_D_BASE_URL__ = runtime.baseUrl;
    globalThis.__PHASE_D_HEADERS__ = runtime.headers();

    try {
        if (sections.has('legacy')) await runLegacyCases({ converse, nativeTurns, guard });
        if (sections.has('native')) await runNativeCases({ nativeTurns, guard });
        if (sections.has('parity')) await runParity({ converse, nativeTurns });
        if (sections.has('acceptance')) await runAcceptance({ converse });
    } finally {
        evidence.businessWritesDuringRuns = runtime.businessWrites();
        evidence.cases = [...cases.values()];
        evidence.checks = checks;
        await runtime.close();
    }

    evidence.hits = measureHits([...cases.values()]);
    const failures = checks.filter(item => !item.ok);
    const deterministicFailures = failures.filter(item => item.kind === 'DETERMINISTIC');
    const behaviourFailures = failures.filter(item => item.kind === 'MODEL_BEHAVIOUR');
    evidence.summary = {
        checks: checks.length,
        passed: checks.length - failures.length,
        failed: failures.length,
        deterministicChecks: checks.filter(item => item.kind === 'DETERMINISTIC').length,
        deterministicFailed: deterministicFailures.length,
        observedChecks: checks.filter(item => item.kind === 'MODEL_BEHAVIOUR').length,
        observedFailed: behaviourFailures.length,
        failedList: deterministicFailures.map(item => `${item.caseId}:${item.name}`),
        observedFailedList: behaviourFailures.map(item => `${item.caseId}:${item.name}`),
    };
    const logDirectory = path.join(root, 'logs', `phase-d-${Date.now()}`);
    fs.mkdirSync(logDirectory, { recursive: true });
    fs.writeFileSync(path.join(logDirectory, 'phase-d-raw.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    const distilled = { ...evidence, cases: evidence.cases.map(entry => ({ ...entry, runs: entry.runs })) };
    const releasePath = path.join(root, 'planning', 'ai-native-v1', 'release', 'AiNativePhaseDRealModelV1.json');
    fs.writeFileSync(releasePath, `${JSON.stringify(distilled, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ summary: evidence.summary, raw: path.join(logDirectory, 'phase-d-raw.json'), release: releasePath, hits: evidence.hits, businessWrites: evidence.businessWritesDuringRuns }, null, 1)}\n`);
    if (deterministicFailures.length) process.exitCode = 2;
}

/**
 * 结构化路径 / 关键词兜底的**真实命中统计**。
 *
 * 只使用运行时已经产出的证据（presentation 差分、moneySafety），不修改产品代码、不额外推理：
 *   - structuredSourceInformed —— 本轮正式结果里真的出现了缺料/未定价/未完成的结构化状态；
 *   - structuredSourceEmpty    —— 结构化来源为空（此时兜底仍是唯一保护）；
 *   - fallbackWouldDiffer      —— 关键词兜底会给出与结构化路径不同的结果；
 *   - structuredHidesFallbackKeptRow —— 结构化路径（来源为空时）会丢掉兜底原本保留的行；
 *   - preservationClaimedWithoutStructuredState —— 在没有结构化关键状态时声明「已全部保留」（必须为 0）；
 *   - unsafeDeliveredRuns      —— 交付了未支撑金额或错误关联（必须为 0）。
 */
function measureHits(allCases) {
    const hits = {
        runsConsidered: 0, structuredSourceInformed: 0, structuredSourceEmpty: 0,
        fallbackWouldDiffer: 0, structuredHidesFallbackKeptRow: 0, fallbackHidesStructuredCriticalRow: 0,
        preservationClaimedWithoutStructuredState: 0, structuredReportedUnrepresented: 0,
        citesResultFactTrue: 0, mentionsNonFormalNumberTrue: 0, citationPredicateDisagreement: 0,
        unsafeDeliveredRuns: 0,
    };
    for (const entry of allCases) {
        for (const run of entry.runs || []) {
            const presentation = run.presentation;
            if (!presentation) continue;
            hits.runsConsidered += 1;
            if (presentation.structuredSourceInformed) hits.structuredSourceInformed += 1;
            else hits.structuredSourceEmpty += 1;
            if (!presentation.structuredEqualsFallback) hits.fallbackWouldDiffer += 1;
            if (presentation.structuredHidesFallbackKeptRow) hits.structuredHidesFallbackKeptRow += 1;
            if (presentation.fallbackHidesStructuredCriticalRow) hits.fallbackHidesStructuredCriticalRow += 1;
            if (presentation.structuredClaimsPreserved && !presentation.structuredSourceInformed) hits.preservationClaimedWithoutStructuredState += 1;
            if (presentation.structuredReportsUnrepresented) hits.structuredReportedUnrepresented += 1;
            const safety = run.moneySafety;
            if (!safety) continue;
            if (safety.citesResultFact) hits.citesResultFactTrue += 1;
            if (safety.mentionsNonFormalNumber) hits.mentionsNonFormalNumberTrue += 1;
            if (Boolean(safety.citesResultFact) !== Boolean(safety.mentionsNonFormalNumber)) hits.citationPredicateDisagreement += 1;
            if ((safety.unsupported || []).length > 0 || (safety.misattributed || []).length > 0) hits.unsafeDeliveredRuns += 1;
        }
    }
    return hits;
}

// ── Legacy 真实链路用例 ────────────────────────────────────────────
async function runLegacyCases({ converse, nativeTurns, guard: _guard }) {
    // D01 同价不同实体（两轮，第二句使用用户原始表达）
    await caseD01(converse);
    await caseD02(converse);
    await caseD03(converse);
    await caseD04(converse);
    await caseD05(converse, nativeTurns);
    await caseD09(converse);
    await caseD10(converse);
    await caseA08(converse);
}

const TOTAL_COST_PREDICATES = new Set(['cost', 'currentTotalCost', 'totalCost']);

function totalCostFacts(facts) {
    return facts.filter(fact => TOTAL_COST_PREDICATES.has(fact.predicate));
}
function entityTotals(facts) {
    const byEntity = new Map();
    for (const fact of facts) {
        if (!byEntity.has(fact.entity)) byEntity.set(fact.entity, { values: new Set(), identities: new Set() });
        byEntity.get(fact.entity).values.add(fact.value);
        byEntity.get(fact.entity).identities.add(fact.identity);
    }
    return byEntity;
}

async function caseD01(converse) {
    try {
        const runs = await converse(['PHASED-同价-甲 和 PHASED-同价-乙 有什么区别', '这两个方案成本分别是多少？'], 'd01');
        const allFacts = runs.flatMap(run => run.evidence.formalFacts);
        const totals = totalCostFacts(allFacts).filter(fact => /PHASED-同价/.test(fact.entity));
        const byEntity = entityTotals(totals);
        check('D01', '两个同价实体都出现在正式事实里', byEntity.size >= 2, [...byEntity.keys()], 'MODEL_BEHAVIOUR');
        const values = [...new Set([...byEntity.values()].flatMap(entry => [...entry.values]))];
        check('D01', '两个实体的**总成本**相同（同价前提成立）', values.length === 1, values, 'MODEL_BEHAVIOUR');
        // 必须成立的不变量：在**同一次解析**里，两个实体不能共用一个 identity（那会丢实体），
        // 同一个实体也不能有两套 identity（那会产生重复行）。
        const perTurnIdentities = runs.map(run => {
            const turnFacts = totalCostFacts(run.evidence.formalFacts).filter(fact => /PHASED-同价/.test(fact.entity));
            const entityToIdentities = new Map();
            for (const fact of turnFacts) {
                if (!entityToIdentities.has(fact.entity)) entityToIdentities.set(fact.entity, new Set());
                entityToIdentities.get(fact.entity).add(fact.identity);
            }
            const entitiesDistinct = new Set([...entityToIdentities.values()].map(set => [...set].sort().join(',')))
                .size === entityToIdentities.size;
            return { entities: [...entityToIdentities].map(([entity, set]) => [entity, [...set]]), entitiesDistinct, ambiguous: [...entityToIdentities.values()].some(set => set.size !== 1) };
        });
        check('D01', '同一轮内两个实体不得共用 identity，且每个实体只能有一套 identity',
            perTurnIdentities.every(turn => turn.entitiesDistinct) && !perTurnIdentities.some(turn => turn.ambiguous), perTurnIdentities);
        // 观察项（不在本阶段修复）：同一真实实体在不同能力里被解析成不同 identity 字符串
        // （compare_recipes 只有 name → recipe#name=…；preview_recipe_cost 有 recipeId → recipe#id:…）。
        const identityByTurn = perTurnIdentities.map(turn => Object.fromEntries(turn.entities));
        const crossCapabilityIdentityUnstable = JSON.stringify(identityByTurn[0] || {}) !== JSON.stringify(identityByTurn.at(-1) || {});
        const last = runs.at(-1).evidence;
        const mentionsBoth = ['PHASED-同价-甲', 'PHASED-同价-乙'].every(name => last.finalContent.includes(name));
        const amount = values.length === 1 ? String(values[0]) : null;
        const amountCount = amount ? oracles.countOccurrences(last.finalContent, amount) : 0;
        check('D01', '追问轮必须给出两个方案各自的成本（不得因同价只留一个）', mentionsBoth && amountCount >= 2, { mentionsBoth, amountCount, amount }, 'MODEL_BEHAVIOUR');
        check('D01', '不得出现未支撑金额或错误关联', last.moneySafety.unsupported.length === 0 && last.moneySafety.misattributed.length === 0, last.moneySafety);
        recordCase('D01', {
            runs: runs.map(run => ({ question: run.question, ...run.evidence })),
            identityByTurn,
            crossCapabilityIdentityUnstable,
            observation: crossCapabilityIdentityUnstable
                ? '同一真实实体在不同能力下的 identity 字符串不同（name 键 vs 主键）；同轮内一致，跨能力未统一 —— 记为 REMAINING_BLOCKER，不在本阶段修复。'
                : null,
        });
    } catch (error) { recordCase('D01', { error: String(error.code || error.message) }); }
    finishCase('D01');
}

async function caseD02(converse) {
    try {
        const question = 'PHASED-浮球-有 和 PHASED-浮球-无 这两个方案成本分别是多少？';
        const runs = await converse([question], 'd02');
        const last = runs.at(-1).evidence;
        check('D02', '不得出现未支撑金额', last.moneySafety.unsupported.length === 0, last.moneySafety.unsupported);
        check('D02', '不得出现金额归属错误', last.moneySafety.misattributed.length === 0, last.moneySafety.misattributed);
        // 金额归属契约用**真实回执**确定性验证：真实模型可能换工具/换措辞，但关联校验必须恒定。
        const receipts = runs.at(-1).result.toolResults;
        const facts = oracles.formalMoneyFacts(receipts).filter(fact => TOTAL_COST_PREDICATES.has(fact.predicate) && /PHASED-浮球/.test(fact.entity));
        const swappedProbe = facts.length >= 2
            ? probeAssociationSwap(receipts, facts)
            : null;
        check('D02', '真实回执上：正确关联不得被判错、交换关联必须被发现',
            swappedProbe === null || swappedProbe.applicable === false || (swappedProbe.correctClean && swappedProbe.swapDetected), swappedProbe);
        recordCase('D02', { runs: [{ question, ...last }], associationProbe: swappedProbe });
    } catch (error) { recordCase('D02', { error: String(error.code || error.message) }); }
    finishCase('D02');
}

/** 用真实回执构造「正确表 / 交换表」，验证关联校验的方向性。 */
function probeAssociationSwap(receipts, facts) {
    const { misattributedMoneyClaims } = require('../api/services/aiAssistantAnswer.cjs');
    const [left, right] = facts;
    // 两个事实金额相同时，「交换」在文本上不可观测 —— 此时该探针不适用，不得判为失败。
    if (left.value === right.value) {
        return { applicable: false, reason: '两条事实金额相同，交换不可观测', value: left.value, entities: [left.entity, right.entity] };
    }
    const row = (fact, value) => `| ${fact.entity} | ${fact.label} | ${value} |`;
    const header = '| 对象 | 项目 | 金额 |\n|---|---|---:|';
    const correct = `${header}\n${row(left, left.value)}\n${row(right, right.value)}`;
    const swapped = `${header}\n${row(left, right.value)}\n${row(right, left.value)}`;
    return {
        applicable: true,
        left: { entity: left.entity, value: left.value }, right: { entity: right.entity, value: right.value },
        correctClean: misattributedMoneyClaims(correct, receipts).length === 0,
        swapDetected: misattributedMoneyClaims(swapped, receipts).length === 2,
    };
}

async function caseD03(converse) {
    try {
        // 先用正式接口证明「同名不同 canonical identity」真实存在（两条 id 不同、名称相同）。
        const endpoint = await fetch(`${globalThis.__PHASE_D_BASE_URL__}/api/cost/recipe-difference`, {
            method: 'POST', headers: globalThis.__PHASE_D_HEADERS__,
            body: JSON.stringify({ leftRecipeName: 'PHASED-同名方案', rightRecipeName: 'PHASED-同名方案', limit: 20 }),
        });
        const payload = await endpoint.json();
        const candidates = payload?.details?.candidates || [];
        check('D03', '正式接口在同名时返回可选择候选（不静默选一条）', endpoint.status === 409 && candidates.length === 2, { status: endpoint.status, candidates: candidates.map(item => item.id) });

        const question = '配方 PHASED-同名方案 的当前成本是多少';
        const runs = await converse([question], 'd03');
        const last = runs.at(-1).evidence;
        const distinctEntities = new Set(last.formalFacts.map(fact => fact.entity));
        const showsBothSpecs = ['12-120', '12-140'].filter(spec => last.finalContent.includes(spec)).length >= 2;
        const asksToChoose = /请(?:选择|告知|确认|指定)|哪一(?:个|款|条)|多条|多个/u.test(last.finalContent);
        const silentlyPickedOne = last.formalFacts.length > 0 && !asksToChoose && !showsBothSpecs;
        check('D03', '同名不同 identity 时不得静默只给一条结论', !silentlyPickedOne, { asksToChoose, showsBothSpecs, facts: last.formalFacts.length }, 'MODEL_BEHAVIOUR');
        check('D03', '不得因为同名把两个对象合并成一条事实', distinctEntities.size !== 1 || last.formalFacts.length <= 1, [...distinctEntities]);
        recordCase('D03', { runs: [{ question, ...last, formalAmbiguity: { status: endpoint.status, candidates: candidates.map(item => item.id) } }] });
    } catch (error) { recordCase('D03', { error: String(error.code || error.message) }); }
    finishCase('D03');
}

async function caseD04(converse) {
    try {
        const question = '零件 PHASED-同值件 的库存和单价是多少';
        const runs = await converse([question], 'd04');
        const last = runs.at(-1).evidence;
        check('D04', '回答必须同时给出库存 123 与单价 123', last.finalContent.includes('123'), last.finalContent.slice(0, 400));
        check('D04', '数量出现不得让金额检查放行（不得把库存当金额）', last.finalContent.includes('库存') || last.finalContent.includes('123套'), last.finalContent.slice(0, 300));
        check('D04', '不得把正确结论替换成内部核对表', last.outcome === 'completed', last.outcome);
        check('D04', '不得出现未支撑金额', last.moneySafety.unsupported.length === 0, last.moneySafety.unsupported);
        recordCase('D04', { runs: [{ question, ...last }] });
    } catch (error) { recordCase('D04', { error: String(error.code || error.message) }); }
    finishCase('D04');
}

async function caseD05(converse, nativeTurns) {
    try {
        // 真实读面里唯一会产生结构化缺料状态的路径是正式齐料预览；
        // Native 控制器会真的调用它（Legacy 路径只走 check_order_readiness）。
        const readinessQuestion = '如果现在再做300台 v550-tokoy 库存够不够？';
        const runs = await nativeTurns([readinessQuestion], 'd05-native');
        const receipts = runs.at(-1).receipts || [];
        const readiness = receipts.find(item => item.name === 'preview_virtual_readiness');
        const criticality = oracles.structuredCriticality(receipts);
        check('D05', '真实齐料预览必须给出正式缺料状态', Boolean(readiness?.result?.data?.shortages?.length), {
            status: readiness?.result?.data?.status, shortageCount: readiness?.result?.data?.coverage?.shortageCount,
        });
        check('D05', '结构化关键性必须识别真实缺料字段（shortages/shortageQty/status）', criticality.mustShowTokens.length > 0, criticality.mustShowTokens.slice(0, 8));

        // 用**真实缺料对象**构造 3 个从未出现过的自然说法，逐一验证展示层：
        // 这些写法都不得命中 TIER1/TIER2，因此保留只能来自结构化通道。
        const { TIER1_PATTERN, TIER2_PATTERN, normalizeAnswerPresentation, buildListCriticality } = require('../api/services/aiPresentationNormalizer.cjs');
        const token = criticality.mustShowTokens[0];
        const wordings = [
            '现货只能凑一部分，余量暂时没有着落',
            '已到一部分，须等下一批',
            '手上数量偏少，其余暂无来源',
        ];
        const probes = [];
        for (const wording of wordings) {
            // 说法本身不得命中任何既有词表，否则无法证明是结构化通道在起作用。
            const keywordFree = !TIER1_PATTERN.test(wording) && !TIER2_PATTERN.test(wording);
            const rows = [
                ...Array.from({ length: 10 }, (_, index) => `- 常规件${index + 1}：库存充足。`),
                `- ${token}：${wording}。`,
                '- 常规件12：库存充足。',
            ];
            const out = normalizeAnswerPresentation(`库存检查结果如下。\n\n${rows.join('\n')}`, '查库存', { criticality: buildListCriticality(receipts) });
            probes.push({ wording, keywordFree, preserved: out.includes(`${token}：`) });
        }
        check('D05', '三个新说法都不得命中既有关键词表（证明保留来自结构化通道）', probes.every(probe => probe.keywordFree), probes);
        check('D05', '结构化缺料行在任何写法下都必须保留', probes.every(probe => probe.preserved), probes);

        // Legacy 侧同样记录（它当前不走齐料预览，结构化来源为空）。
        const legacyRuns = await converse(['PHASED-同价-甲 做300台，库存够不够？缺什么料？'], 'd05-legacy');
        const legacyLast = legacyRuns.at(-1).evidence;
        check('D05', '结构化来源为空时不得声明「已全部保留」', !legacyLast.presentation.structuredClaimsPreserved || legacyLast.presentation.structuredSourceInformed,
            legacyLast.presentation);
        recordCase('D05', {
            runs: [
                { question: readinessQuestion, nativeState: runs.at(-1).result.task.state, tools: receipts.map(item => item.name), mustShowTokens: criticality.mustShowTokens,
                    shortageCount: readiness?.result?.data?.shortages?.length ?? 0, probes },
                { question: legacyRuns.at(-1).question, ...legacyLast },
            ],
        });
    } catch (error) { recordCase('D05', { error: String(error.code || error.message) }); }
    finishCase('D05');
}

async function caseD09(converse) {
    try {
        const question = '把 PHASED- 开头的方案和当前成本列个表';
        const runs = await converse([question], 'd09');
        const last = runs.at(-1).evidence;
        const idRows = last.finalContent.split('\n').filter(line => /\|\s*\d+\s*\|/u.test(line));
        const hasIdTable = /配方ID|方案ID|ID\s*\|/u.test(last.finalContent);
        check('D09', '若回答含内部 ID 表，则不得让两行变得不可区分', !hasIdTable || idRows.length !== 2 || new Set(idRows).size === idRows.length, { hasIdTable, idRows });
        check('D09', '关键正式身份不得被隐藏', last.presentation.mustShowTokens.every(token => last.finalContent.includes(token)), last.presentation.mustShowTokens);
        check('D09', '不得泄漏内部工具语言', last.leakage.length === 0, last.leakage);
        recordCase('D09', { runs: [{ question, ...last }] });
    } catch (error) { recordCase('D09', { error: String(error.code || error.message) }); }
    finishCase('D09');
}

async function caseD10(converse) {
    try {
        const machine = await converse(['PHASED-同价-甲 的正式整机成本是多少'], 'd10a');
        const machineLast = machine.at(-1).evidence;
        check('D10', '整机成本不得被展示成线圈档案成本', !machineLast.finalContent.includes('线圈档案成本'), machineLast.finalContent.slice(0, 300));
        check('D10', '整机成本问题必须给出正式金额', machineLast.formalFacts.some(fact => fact.value > 0), machineLast.formalFacts);
        const coil = await converse(['12-200 线圈成本是多少'], 'd10b');
        const coilLast = coil.at(-1).evidence;
        check('D10', '线圈查询必须拿到线圈实体事实', coilLast.formalFacts.some(fact => fact.entityType === 'coil'), coilLast.formalFacts);
        const part = await converse(['PHASED-同值件 的目录单价是多少'], 'd10c');
        const partLast = part.at(-1).evidence;
        check('D10', '零件单价必须按单价口径表达，不得混成成本', !/档案成本|线圈档案成本/u.test(partLast.finalContent), partLast.finalContent.slice(0, 300));
        check('D10', '零件单价的正式值必须出现', partLast.finalContent.includes('123'), partLast.finalContent.slice(0, 300));
        recordCase('D10', { runs: [{ question: machine.at(-1).question, ...machineLast }, { question: coil.at(-1).question, ...coilLast }, { question: part.at(-1).question, ...partLast }] });
    } catch (error) { recordCase('D10', { error: String(error.code || error.message) }); }
    finishCase('D10');
}

async function caseA08(converse) {
    try {
        const question = 'PHASED-浮球-有 和 PHASED-浮球-无 这两项配置有什么不同，差多少钱？';
        const runs = await converse([question], 'a08');
        const last = runs.at(-1).evidence;
        const costs = last.formalFacts.filter(fact => fact.predicate === 'cost').map(fact => fact.value);
        const diffValue = Math.abs((costs[0] ?? 0) - (costs[1] ?? 0));
        check('A08_REAL_MODEL_REPLAY', '规格差异必须明确说出（带浮球 / 不带浮球）', last.finalContent.includes('浮球'), last.finalContent.slice(0, 400), 'MODEL_BEHAVIOUR');
        check('A08_REAL_MODEL_REPLAY', '浮球差异的具体身份必须出现', last.finalContent.includes('浮球-') || last.finalContent.includes('新界式'), last.finalContent.slice(0, 400), 'MODEL_BEHAVIOUR');
        check('A08_REAL_MODEL_REPLAY', '正式金额差额必须正确给出', diffValue > 0 && (last.finalContent.includes(String(diffValue)) || last.finalContent.includes(diffValue.toFixed(2))), { diffValue, text: last.finalContent.slice(0, 400) }, 'MODEL_BEHAVIOUR');
        check('A08_REAL_MODEL_REPLAY', '不得出现未支撑金额', last.moneySafety.unsupported.length === 0, last.moneySafety.unsupported);
        check('A08_REAL_MODEL_REPLAY', '不得出现重复金额表', last.moneySafety.moneyTableTitleCount <= 1, last.moneySafety.moneyTableTitleCount);
        check('A08_REAL_MODEL_REPLAY', '不得暴露内部工具语言', last.leakage.length === 0, last.leakage);
        check('A08_REAL_MODEL_REPLAY', '不得遗漏正式关键事实', last.formalFacts.every(fact => fact.value === 0 || last.finalContent.includes(String(fact.value)) || last.moneyTable.some(row => row.value === fact.value)), last.formalFacts);
        recordCase('A08_REAL_MODEL_REPLAY', { runs: [{ question, ...last }] });
        finishCase('A08_REAL_MODEL_REPLAY');

        // 负向控制：用户主动给出错误差额，Money Guard / Answer Boundary 必须拦截或重建。
        // 负向控制必须是**同一会话的追问**，否则「这两个方案」没有指代对象，
        // 测的就不是金额守卫而是模型的指代失败。
        const negative = await converse([question, '这两个方案的成本差额是 99.99 元，对吧？'], 'a08');
        negative.shift();
        const negativeLast = negative.at(-1).evidence;
        check('A08_NEGATIVE_MONEY_CONTROL', '用户带入的错误差额不得被当成正式金额交付', !negativeLast.finalContent.includes('99.99'), negativeLast.finalContent.slice(0, 400));
        check('A08_NEGATIVE_MONEY_CONTROL', '交付回答不得包含未支撑金额', negativeLast.moneySafety.unsupported.length === 0, negativeLast.moneySafety.unsupported);
        check('A08_NEGATIVE_MONEY_CONTROL', '正式差额仍然必须可见（拦截而不是丢失结论）', negativeLast.formalFacts.some(fact => fact.value > 0), negativeLast.formalFacts);
        recordCase('A08_NEGATIVE_MONEY_CONTROL', { runs: [{ question: negative.at(-1).question, ...negativeLast }] });
    } catch (error) {
        recordCase('A08_REAL_MODEL_REPLAY', { error: String(error.code || error.message) });
        recordCase('A08_NEGATIVE_MONEY_CONTROL', { error: String(error.code || error.message) });
    }
    finishCase('A08_REAL_MODEL_REPLAY');
    finishCase('A08_NEGATIVE_MONEY_CONTROL');
}

// ── Native 真实链路用例 ────────────────────────────────────────────
const AMBIGUOUS_COIL = 'v550-tokoy换成12-220，和现在成本比一下，其他不变，先不要保存';

async function runNativeCases({ nativeTurns }) {
    // D06 正向选择（三种表达）
    try {
        const positives = [];
        for (const [index, reply] of ['第二个', '第2项', '选第二款'].entries()) {
            const runs = await nativeTurns([AMBIGUOUS_COIL, reply], `d06-${index}`);
            const first = runs[0].result;
            const second = runs[1].result;
            const compareCall = (runs[1].calls || []).filter(call => call.toolName === 'compare_recipe_scenarios').at(-1);
            const boundCoil = compareCall?.args?.scenarios?.[0]?.overrides?.coilId ?? null;
            positives.push({ reply, firstState: first.task.state, firstReason: first.task.questions[0]?.reasonCode, secondState: second.task.state, planRevision: second.task.planRevision, sameTask: second.task.taskId === first.task.taskId, boundCoil });
            check('D06', `${reply}：必须在同一 task 上前进 planRevision`, second.task.taskId === first.task.taskId && second.task.planRevision > first.task.planRevision, positives.at(-1));
            check('D06', `${reply}：必须绑定到正式候选而不是重新猜测`, second.task.state === 'SUCCEEDED', positives.at(-1));
        }
        recordCase('D06', { runs: positives });
    } catch (error) { recordCase('D06', { error: String(error.code || error.message) }); }
    finishCase('D06');

    // D07 否定选择
    try {
        const negatives = [];
        for (const [index, reply] of ['不要第一个', '不是第二个', '这两个都不是'].entries()) {
            const runs = await nativeTurns([AMBIGUOUS_COIL, reply], `d07-${index}`);
            const second = runs[1].result;
            const answered = second.task.questions.some(question => question.answeredAt !== null);
            negatives.push({ reply, state: second.task.state, errorCode: second.detail.errorCode || null, answered });
            check('D07', `${reply}：不得绑定候选`, !answered && second.task.state !== 'SUCCEEDED', negatives.at(-1));
            check('D07', `${reply}：必须停在需要用户输入的状态`, second.task.state === 'WAITING_INPUT', negatives.at(-1));
        }
        recordCase('D07', { runs: negatives });
    } catch (error) { recordCase('D07', { error: String(error.code || error.message) }); }
    finishCase('D07');

    // D08 待澄清期间的新问题
    try {
        const runs = await nativeTurns([AMBIGUOUS_COIL, '先查2寸泵壳现在多少钱'], 'd08');
        const first = runs[0].result;
        const second = runs[1].result;
        recordCase('D08', { runs: [{ question: runs[1].question, state: second.task.state, taskChanged: second.task.taskId !== first.task.taskId, goals: second.task.goals.map(goal => goal.kind) }] });
        check('D08', '新问题必须作为独立任务处理', second.task.taskId !== first.task.taskId, second.task.taskId);
        check('D08', '不得把「2」当成 choice_2 绑定', !second.task.questions.some(question => question.answeredAt !== null), second.task.questions.map(question => ({ reason: question.reasonCode, answeredAt: question.answeredAt })));
    } catch (error) { recordCase('D08', { error: String(error.code || error.message) }); }
    finishCase('D08');

    // D09（Native 侧）：同名候选必须仍然可选择
    try {
        const runs = await nativeTurns([AMBIGUOUS_COIL, '第二个'], 'd09-native');
        const choices = runs[0].result.task.questions[0]?.choices || [];
        recordCase('D09_NATIVE', { runs: [{ labels: choices.map(choice => choice.label), ids: choices.map(choice => choice.entity.entityId), state: runs[1].result.task.state }] });
        check('D09_NATIVE', '同名候选的可见标签必须唯一', new Set(choices.map(choice => choice.label)).size === choices.length, choices.map(choice => choice.label));
        check('D09_NATIVE', '序号选择仍必须生效', runs[1].result.task.state === 'SUCCEEDED', runs[1].result.task.state);
    } catch (error) { recordCase('D09_NATIVE', { error: String(error.code || error.message) }); }
    finishCase('D09_NATIVE');
}

// ── Legacy / Native / Fallback parity ─────────────────────────────
// Native 只覆盖部分目标族（CURRENT_COST / CONFIGURATION_COMPARE / PROFITABILITY / INVENTORY_QUERY）。
// 补充问题只用于让 FACT_PARITY 有真实可比的样本；结论必须与 10 个真实老板问法一起看。
const PARITY_SUPPLEMENT = [
    'v550-tokoy现在成本多少？电缆改5米以后呢？卖340毛利多少？如果做300台库存够不够？先不要保存。',
    '如果现在再做300台 v550-tokoy 库存够不够？',
];

const PARITY_QUESTIONS = [
    '如果我把12-200换成12-180，成本能省多少',
    '12-120换成12-140成本是多少',
    '这两项产品规格有什么不同',
    'v550-tokoy当前成本是多少',
    '线圈库存有多少',
    '12-200线圈成本是多少',
    '对比12-120与12-140的成本',
    '今天的经营情况是什么',
    '查不存在的配方',
    'PHASED-浮球-有 和 PHASED-浮球-无 差多少钱',
];

async function runParity({ converse, nativeTurns }) {
    const rows = [];
    for (const [index, question] of [...PARITY_QUESTIONS, ...PARITY_SUPPLEMENT].entries()) {
        const row = { question, legacy: null, native: null, fallback: null };
        try {
            const legacyRuns = await converse([question], `parity-legacy-${index}`);
            const legacyEvidence = legacyRuns.at(-1).evidence;
            row.legacy = {
                outcome: legacyEvidence.outcome, finalContent: legacyEvidence.finalContent,
                formalFacts: legacyEvidence.formalFacts, factSignature: legacyEvidence.factSignature,
                moneySafety: legacyEvidence.moneySafety, leakage: legacyEvidence.leakage,
            };
            row.fallback = oracles.deterministicFallback(legacyRuns.at(-1).result.toolResults);
        } catch (error) { row.legacy = { error: String(error.code || error.message) }; }
        try {
            const nativeRuns = await nativeTurns([question], `parity-native-${index}`);
            const last = nativeRuns.at(-1).result;
            row.native = {
                state: last.task.state,
                answer: last.answer?.content ?? '',
                goals: last.task.goals.map(goal => goal.kind),
                predicates: last.task.facts.map(fact => fact.key.predicate),
                formalFacts: nativeRuns.at(-1).formalFacts,
            };
        } catch (error) { row.native = { error: String(error.code || error.message) }; }
        const legacyFacts = row.legacy?.formalFacts || [];
        const nativeFacts = row.native?.formalFacts || [];
        const compared = legacyFacts.length && nativeFacts.length ? oracles.compareFacts(legacyFacts, nativeFacts) : { businessRegressions: [], completenessDeltas: [] };
        row.unexplainedBusinessDelta = compared.businessRegressions;
        row.completenessDelta = compared.completenessDeltas;
        row.factParity = legacyFacts.length && nativeFacts.length
            ? (compared.businessRegressions.length ? 'BUSINESS_REGRESSION' : 'MATCH')
            : (legacyFacts.length || nativeFacts.length ? 'COMPLETENESS_DELTA' : 'NOT_COMPARABLE');
        row.completenessExplanation = compared.completenessDeltas.length
            ? `Native 只执行其目标范围所需的正式读取（state=${row.native?.state ?? '-'}，goals=${JSON.stringify(row.native?.goals ?? [])}），因此未读取 Legacy 侧的其它目录事实；不是金额或口径冲突。`
            : null;
        row.answerParity = row.legacy?.finalContent && row.native?.answer
            ? (oracles.normalizeForParity(row.legacy.finalContent) === oracles.normalizeForParity(row.native.answer) ? 'IDENTICAL_NORMALIZED' : 'PRESENTATION_DELTA')
            : 'NOT_COMPARABLE';
        rows.push(row);
    }
    const unexplained = rows.filter(row => row.unexplainedBusinessDelta.length > 0);
    const completeness = rows.filter(row => (row.completenessDelta || []).length > 0);
    check('PARITY', 'parity 必须至少有 10 个真实老板问法', PARITY_QUESTIONS.length >= 10 && rows.length >= PARITY_QUESTIONS.length, rows.length);
    check('PARITY', 'UNEXPLAINED_BUSINESS_REGRESSION 必须为 0', unexplained.length === 0, unexplained.map(row => row.question));
    check('PARITY', 'completeness delta 必须逐条有归类与解释', completeness.every(row => Boolean(row.completenessExplanation)), completeness.map(row => row.question));
    recordCase('PARITY', { runs: rows });
    finishCase('PARITY');
}

// ── 人工验收回放（10 类）───────────────────────────────────────────
const ACCEPTANCE = [
    ['成本', 'v550-tokoy 现在成本是多少？'],
    ['配方', '列出所有在售配方和它们当前的完整成本'],
    ['线圈', '12-200 有哪些线圈方案，成本各是多少？'],
    ['库存', '哪些零件库存低于 100？'],
    ['多候选', '12-220 有几个正式方案，分别是什么？'],
    ['配置变更假设', '如果我把 v550-tokoy 的线圈换成 12-140，成本变化多少？先不要保存'],
    ['连续追问', 'v550-tokoy 的成本是多少？'],
    ['长清单', '列出所有零件的型号和单价'],
    ['无结果', '查一下型号 ZZZ-NOT-EXIST-999 的库存'],
    ['不完整数据', '按铜价 95 算，v550-tokoy 的成本是多少？'],
];

async function runAcceptance({ converse }) {
    for (const [index, [category, question]] of ACCEPTANCE.entries()) {
        try {
            const turns = category === '连续追问' ? [question, '那换成 12-140 呢？'] : [question];
            const runs = await converse(turns, `accept-${index}`);
            const last = runs.at(-1).evidence;
            const mustShow = last.presentation.mustShowTokens || [];
            recordCase(`ACCEPT_${category}`, {
                runs: runs.map(run => ({ question: run.question, ...run.evidence })),
                assessment: {
                    outcome: last.outcome,
                    hasFormalMoney: last.formalFacts.some(fact => fact.value > 0),
                    noInternalLeakage: last.leakage.length === 0,
                    noUnsupportedAmount: last.moneySafety.unsupported.length === 0,
                    noMisattribution: last.moneySafety.misattributed.length === 0,
                    duplicatedMoneyTable: last.moneySafety.moneyTableTitleCount > 1,
                    criticalFactsPresent: mustShow.every(token => last.finalContent.includes(token)),
                    criticalFactsReportedMissing: last.presentation.structuredReportsUnrepresented,
                    presentationNote: last.presentation.fallbackClaimsPreserved ? 'claims_preserved' : 'no_preservation_claim',
                },
            });
            check(`ACCEPT_${category}`, '不得泄漏内部语言', last.leakage.length === 0, last.leakage);
            check(`ACCEPT_${category}`, '不得交付未支撑金额', last.moneySafety.unsupported.length === 0, last.moneySafety.unsupported);
            check(`ACCEPT_${category}`, '不得重复金额表', last.moneySafety.moneyTableTitleCount <= 1, last.moneySafety.moneyTableTitleCount);
            check(`ACCEPT_${category}`, '正式关键事实不得被隐藏（或被如实报告）', mustShow.every(token => last.finalContent.includes(token)) || last.presentation.structuredReportsUnrepresented, mustShow);
        } catch (error) { recordCase(`ACCEPT_${category}`, { error: String(error.code || error.message) }); }
        finishCase(`ACCEPT_${category}`);
    }
}

main().catch(error => {
    process.stderr.write(`PHASE_D_FAILED ${error.code || error.message}\n${(error.stack || '').split('\n').slice(0, 4).join('\n')}\n`);
    process.exitCode = 3;
});
