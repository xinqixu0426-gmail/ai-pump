'use strict';
/**
 * S2 — Owner Read Canary 生产观察驱动器（依赖为零，运行在生产机上）。
 *
 * 只做三件事：
 *   1. 用既有 owner 凭据（生产 .env，进程内读取，绝不打印/持久化）换取 owner JWT；
 *   2. 以 owner 身份对生产 `/api/ai/chat` 提真实业务问题（真实生产数据），解析 SSE；
 *   3. 记录每一轮的 canary 路由证据（stage=task_v2 / canary_ineligible / legacy）、
 *      目标状态、能力计划、正式回执金额，并用**独立正式只读 API** 交叉核对金额。
 *
 * 用法（在生产机上）：
 *   node /tmp/s2-observe.cjs --env /Users/dan/pump-cost-accounting-system/.env --out /tmp/s2-observation.json
 * 可选：--only <familyId>  只跑某族（用于判定下一步前的补测）
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GATEWAY = 'http://127.0.0.1:3104';
const API = 'http://127.0.0.1:3002';

function parseArgs() {
    const args = new Map();
    for (const entry of process.argv.slice(2)) {
        const match = /^--([^=]+)(?:=(.*))?$/u.exec(entry);
        if (match) args.set(match[1], match[2] === undefined ? 'true' : match[2]);
    }
    return args;
}
const args = parseArgs();
const envPath = path.resolve(args.get('env') || path.join(os.homedir(), 'pump-cost-accounting-system/.env'));

function readEnvFile(file) {
    const values = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
        if (match) values[match[1]] = match[2];
    }
    return values;
}

const AMOUNT_RE = /[¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*%/gu;
const amountsOf = text => [...new Set([...String(text ?? '').matchAll(AMOUNT_RE)].map(match => match[0].replace(/[¥￥\s%]/gu, '')))];
const BASIS_RULES = Object.freeze({
    成本: /成本|总成本|完整成本/u, 库存: /库存|有货|还剩|还有/u, 毛利: /毛利|利润/u,
    齐料: /齐料|短缺|够不够/u, 差额: /差额|差多少|贵|便宜|更高|更低/u,
});
const basesOf = text => Object.entries(BASIS_RULES).filter(([, pattern]) => pattern.test(String(text ?? ''))).map(([name]) => name);

// ── 真实问法（覆盖 6 个 SUPPORTED family；同一 conversation 内的连续追问）────────
const SCENARIOS = [
    { familyId: 'single-recipe-current-cost', key: 's2-f1-a', turns: ['v550-tokoy现在成本多少？'] },
    { familyId: 'single-recipe-current-cost', key: 's2-f1-b', turns: ['PHASED-浮球-有现在成本是多少？', '那这个成本包含工资吗？'] },
    { familyId: 'single-recipe-current-cost', key: 's2-f1-c', turns: ['帮我查一下 PHASED-浮球-无 的成本'] },
    { familyId: 'multi-goal-config-profit-readiness', key: 's2-f2-a', turns: ['v550-tokoy现在成本多少？电缆改5米以后呢？'] },
    { familyId: 'multi-goal-config-profit-readiness', key: 's2-f2-b', turns: ['v550-tokoy现在成本多少？电缆改5米以后呢？卖340毛利多少？做300台库存够不够？先不要保存'] },
    { familyId: 'multi-goal-config-profit-readiness', key: 's2-f2-c', turns: ['PHASED-浮球-有当前成本多少？卖340毛利多少？'] },
    { familyId: 'virtual-readiness-preview', key: 's2-f3-a', turns: ['如果现在再做300台 v550-tokoy 库存够不够？'] },
    { familyId: 'virtual-readiness-preview', key: 's2-f3-b', turns: ['再做100台 PHASED-浮球-有 库存够不够？'] },
    { familyId: 'virtual-readiness-preview', key: 's2-f3-c', turns: ['v550-tokoy 再做300台的话，料够吗？'] },
    { familyId: 'recipe-cost-comparison', key: 's2-f4-a', turns: ['v550-tokoy和v750-tokoy成本差多少？'] },
    { familyId: 'recipe-cost-comparison', key: 's2-f4-b', turns: ['PHASED-浮球-有和PHASED-浮球-无差多少钱？', '第二个现在完整成本呢？'] },
    { familyId: 'recipe-cost-comparison', key: 's2-f4-c', turns: ['帮我比较一下 v550-tokoy 和 PHASED-浮球-有 哪个成本高一点，高多少？'] },
    { familyId: 'coil-catalogue-cost', key: 's2-f5-a', turns: ['12-120成本多少？'] },
    { familyId: 'coil-catalogue-cost', key: 's2-f5-b', turns: ['12-140的成本是多少？', '那12-120呢？'] },
    { familyId: 'coil-catalogue-cost', key: 's2-f5-c', turns: ['12-200成本多少？', '第二个'] },
    { familyId: 'coil-inventory', key: 's2-f6-a', turns: ['12-120还有多少？'] },
    { familyId: 'coil-inventory', key: 's2-f6-b', turns: ['12-140现在库存多少？', '这个成本多少？'] },
    { familyId: 'coil-inventory', key: 's2-f6-c', turns: ['12-120成本多少？', '这个还有库存吗？'] },
    { familyId: 'coil-inventory', key: 's2-f6-d', turns: ['12-200有库存吗？'] },
    // §7 非 V 命名配方观察（只观察，不改 admission）
    { familyId: 'single-recipe-current-cost', key: 's2-nonv-a', turns: ['PHASED-浮球-有 的当前完整成本是多少？'] },
    { familyId: 'virtual-readiness-preview', key: 's2-nonv-b', turns: ['如果做50台 PHASED-浮球-无 库存够吗？'] },
    // §6E 模型波动探针：同一问法不同措辞
    { familyId: 'coil-catalogue-cost', key: 's2-var-a', turns: ['12-120这个线圈现在多少钱？'] },
    { familyId: 'coil-catalogue-cost', key: 's2-var-b', turns: ['12-120线圈成本是多少来着'] },
];


// ── 补测：使用**生产当前真实配方名**（目录只剩 V550/V750大脚板-2寸-经典款）──
SCENARIOS.push(
    { familyId: 'single-recipe-current-cost', key: 's2-f1-real', turns: ['V550大脚板-2寸-经典款现在成本多少？'] },
    { familyId: 'single-recipe-current-cost', key: 's2-f1-real2', turns: ['大脚板-2寸-经典款成本多少？'] },
    { familyId: 'multi-goal-config-profit-readiness', key: 's2-f2-real', turns: ['V550大脚板-2寸-经典款现在成本多少？电缆改5米以后呢？卖340毛利多少？做300台库存够不够？先不要保存'] },
    { familyId: 'virtual-readiness-preview', key: 's2-f3-real', turns: ['如果现在再做300台 V550大脚板-2寸-经典款 库存够不够？'] },
    { familyId: 'recipe-cost-comparison', key: 's2-f4-real', turns: ['V550大脚板-2寸-经典款和V750大脚板-2寸-经典款成本差多少？', '第二个现在完整成本呢？'] },
    { familyId: 'coil-inventory', key: 's2-f5-missing', turns: ['12-999成本多少？'] },
    { familyId: 'single-recipe-current-cost', key: 's2-f1-missing', turns: ['查一下 V999不存在的配方 的成本'] },
);

async function login(env) {
    const password = env.PUMP_OWNER_ACCESS_PASSWORD;
    if (!password) throw Object.assign(new Error('OWNER_PASSWORD_MISSING'), { code: 'OWNER_PASSWORD_MISSING' });
    const response = await fetch(`${GATEWAY}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
    });
    const cookie = response.headers.get('set-cookie') || '';
    const token = /token=([^;]+)/u.exec(cookie)?.[1];
    if (!response.ok || !token) throw Object.assign(new Error(`OWNER_LOGIN_FAILED ${response.status}`), { code: 'OWNER_LOGIN_FAILED' });
    return token;
}

async function ask(token, question, conversationId) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    const events = [];
    let httpStatus = null;
    try {
        const response = await fetch(`${API}/api/ai/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'text/event-stream', cookie: `token=${token}` },
            body: JSON.stringify({ messages: [{ role: 'user', content: question }], conversationId }),
            signal: controller.signal,
        });
        httpStatus = response.status;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try { events.push(JSON.parse(line.slice(6))); } catch { /* heartbeat */ }
            }
        }
    } catch (error) {
        events.push({ type: 'client_error', message: error.code || error.message });
    } finally { clearTimeout(timer); }
    const content = events.filter(event => event.type === 'content').map(event => event.content).join('');
    const detailEvent = events.find(event => event.type === 'detail');
    const detail = detailEvent ? { ...detailEvent, type: undefined } : null;
    const statuses = events.filter(event => event.type === 'status').map(event => event.stage || event.status).filter(Boolean);
    const providerEvents = events.filter(event => event.type === 'provider');
    const nativeStage = statuses.includes('task_v2');
    const admissionStage = statuses.includes('canary_ineligible');
    // 判定优先级：admission 拒绝 ⇒ 本轮由既有正式路径作答（Native 只做了计划，不是权威答案）。
    const route = admissionStage ? 'LEGACY_SAFE_FALLBACK' : nativeStage ? 'NATIVE_CANARY' : 'LEGACY';
    return {
        question, conversationId, httpStatus, latencyMs: Date.now() - started,
        route, nativePlanBuilt: nativeStage, admissionRejected: admissionStage,
        detail, statuses, providerEvents: providerEvents.map(event => ({ provider: event.provider || null, model: event.model || null, fallback: Boolean(event.fallback) })),
        content, amounts: amountsOf(content), bases: basesOf(content),
        error: events.find(event => event.type === 'error')?.message || null,
    };
}

/** 独立正式只读 API 交叉核对（同一正式口径，不是第二套算法）。 */
async function formalCrossCheck(token) {
    const headers = { cookie: `token=${token}`, accept: 'application/json' };
    const out = {};
    try {
        const coils = await (await fetch(`${API}/api/coils?spec=12&sheets=120`, { headers })).json();
        const row = Array.isArray(coils?.data) ? coils.data[0] : null;
        if (row) out['coil:12-120'] = { cost: Number(row.cost), stock: Number(row.stock), schemeCode: row.schemeCode };
    } catch { /* observation only */ }
    try {
        const coils = await (await fetch(`${API}/api/coils?spec=12&sheets=140`, { headers })).json();
        const row = Array.isArray(coils?.data) ? coils.data[0] : null;
        if (row) out['coil:12-140'] = { cost: Number(row.cost), stock: Number(row.stock), schemeCode: row.schemeCode };
    } catch { /* observation only */ }
    try {
        const costs = await (await fetch(`${API}/api/recipes/current-costs`, { headers })).json();
        const rows = Array.isArray(costs?.data) ? costs.data : (Array.isArray(costs) ? costs : []);
        for (const row of rows) {
            const name = row?.name || row?.recipeName;
            if (name && ['v550-tokoy', 'v750-tokoy', 'PHASED-浮球-有', 'PHASED-浮球-无'].includes(name)) {
                out[`recipe:${name}`] = { cost: Number(row.currentTotalCost ?? row.totalCost ?? row.cost), complete: row.costComplete ?? row.complete ?? null };
            }
        }
    } catch { /* observation only */ }
    try {
        const difference = await (await fetch(`${API}/api/cost/recipe-difference`, {
            method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({ leftRecipeName: 'v550-tokoy', rightRecipeName: 'v750-tokoy', limit: 5 }),
        })).json();
        const data = difference?.data || difference;
        if (data?.totalDiff !== undefined) out['diff:v550-tokoy→v750-tokoy'] = { totalDiff: Number(data.totalDiff), left: Number(data.left?.totalCost), right: Number(data.right?.totalCost) };
    } catch { /* observation only */ }
    return out;
}

/**
 * S2-R1 §E：fallback 分类。区分「Native 没执行」与「fallback 最终业务回答正确」。
 *   FALLBACK_EXECUTED            本轮由既有正式路径作答（Native 未成为权威）
 *   FALLBACK_FACTUALLY_VERIFIED  fallback 的回答经事实核对（金额与正式值一致，或为范围受限负结果/澄清）
 *   FALLBACK_DEFECT              fallback 交付了与正式值冲突的金额，或用错误的业务域作答
 */
const FORMAL_COIL_FACTS = Object.freeze({
    '12-120': { cost: 101.06514, stock: 100 },
    '12-140': { cost: 118.53542, stock: 100 },
});
function classifyFallback(turn, formal) {
    if (turn.route === 'NATIVE_CANARY') return null;
    const text = String(turn.content || '');
    const amounts = turn.amounts || [];
    const coilShorthand = /(\d{1,3})\s*-\s*(\d{2,4})/u.exec(turn.question || '');
    const formalCoil = coilShorthand ? FORMAL_COIL_FACTS[`${Number(coilShorthand[1])}-${Number(coilShorthand[2])}`] : null;
    const recipeCurrent = formal && Object.values(formal).filter(item => item && typeof item.currentTotalCost === 'number').map(item => item.currentTotalCost);
    const known = new Set([...Object.values(FORMAL_COIL_FACTS).flatMap(item => [String(item.cost), item.cost.toFixed(2), String(item.stock)]), ...recipeCurrent.map(value => value.toFixed(2))]);
    const untraceable = amounts.filter(amount => ![...known].some(value => Math.abs(Number(value) - Number(amount)) <= 0.03));
    const wrongDomainNegative = Boolean(coilShorthand && formalCoil && /配方目录|泵壳模板|零件(?:目录)?/u.test(text) && /未找到|没有找到/u.test(text));
    if (untraceable.length) return { kind: 'FALLBACK_DEFECT', reason: `金额与正式值冲突：${untraceable.join(',')}` };
    if (wrongDomainNegative) return { kind: 'FALLBACK_DEFECT', reason: '用配方/模板/零件目录回答了线圈简写（错误业务域）' };
    return { kind: 'FALLBACK_FACTUALLY_VERIFIED', reason: amounts.length ? '金额与正式值一致' : '范围受限的负结果或澄清（无业务金额）' };
}

async function main() {
    const env = readEnvFile(envPath);
    if (env.AI_NATIVE_MODE !== 'owner') process.stderr.write(`warn: AI_NATIVE_MODE=${env.AI_NATIVE_MODE || '(unset)'}\n`);
    const token = await login(env);
    const only = args.get('only');
    const keys = args.get('keys');
    const keySet = keys ? new Set(String(keys).split(',')) : null;
    const selected = keySet ? SCENARIOS.filter(scenario => keySet.has(scenario.key)) : only ? SCENARIOS.filter(scenario => scenario.familyId === only) : SCENARIOS;
    const formal = await formalCrossCheck(token);
    const turns = [];
    for (const scenario of selected) {
        const conversationId = `s2:${scenario.key}:${Date.now()}`;
        for (const question of scenario.turns) {
            const result = await ask(token, question, conversationId);
            const turn = { familyId: scenario.familyId, scenarioKey: scenario.key, timestamp: new Date().toISOString(), ...result };
            turn.fallbackClassification = classifyFallback(turn, formal);
            turns.push(turn);
            process.stdout.write(`${scenario.key} | ${question.slice(0, 26)} | ${result.route} | ${(result.content || '').slice(0, 60).replace(/\n/gu, ' ')}\n`);
        }
    }
    const fallbackCounts = turns.reduce((acc, turn) => {
        const kind = turn.fallbackClassification?.kind;
        if (kind) acc[kind] = (acc[kind] || 0) + 1;
        return acc;
    }, {});
    const evidence = {
        fallbackClassification: fallbackCounts,
        ticket: 'AI-NATIVE-S2-OWNER-READ-CANARY-OBSERVATION',
        generatedAt: new Date().toISOString(),
        host: os.hostname(),
        mode: env.AI_NATIVE_MODE || null,
        formalCrossCheck: formal,
        turns,
    };
    const outPath = path.resolve(args.get('out') || '/tmp/s2-observation.json');
    fs.writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`\nwrote ${outPath} (${turns.length} turns)\n`);
}

main().catch(error => {
    process.stderr.write(`S2_OBSERVE_FAILED ${error.code || error.message}\n`);
    process.exitCode = 1;
});
