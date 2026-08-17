const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const {
    Client,
    StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/client');
const { parseMcpServiceTokens } = require('../api/services/environment.cjs');

const REQUIRED_TOOLS = Object.freeze([
    'get_all_recipes',
    'full_calculate',
    'compare_recipes',
    'explain_cost_change',
]);
const DEFAULT_VERIFY_URL = 'https://xuxinqi.xin/mcp';
const DEFAULT_INVALID_RECIPE_NAME = 'V750-大脚板-2寸';
const DEFAULT_REPORT_PATH = path.join('logs', 'mcp-production-cost-latest.json');

function roundDuration(startedAt) {
    return Math.round((performance.now() - startedAt) * 10) / 10;
}

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function resultBody(result) {
    const structured = result?.structuredContent ?? null;
    return structured?.data ?? structured;
}

function resultErrorCode(result) {
    const body = resultBody(result);
    return body?.code ?? body?.errorCode ?? null;
}

function resolveVerificationCredential(env = process.env) {
    const explicitToken = String(env.MCP_VERIFY_TOKEN || '').trim();
    if (explicitToken) {
        assert(explicitToken.length >= 32, 'MCP_VERIFY_TOKEN 至少需要 32 个字符');
        return {
            token: explicitToken,
            clientId: String(env.MCP_VERIFY_CLIENT_ID || 'explicit-verifier').trim(),
            source: 'MCP_VERIFY_TOKEN',
        };
    }

    const credentials = parseMcpServiceTokens(env);
    assert(credentials.length > 0, '未找到 MCP_VERIFY_TOKEN 或可用的 MCP 服务凭证');
    const preferredClientId = String(env.MCP_VERIFY_CLIENT_ID || '').trim();
    const selected = preferredClientId
        ? credentials.find(item => item.clientId === preferredClientId)
        : credentials[0];
    assert(selected, `MCP_VERIFY_CLIENT_ID 不存在: ${preferredClientId}`);
    return {
        token: selected.token,
        clientId: selected.clientId,
        source: 'MCP_SERVICE_TOKENS',
    };
}

function resolveVerificationUrl(env = process.env) {
    const url = new URL(String(env.MCP_VERIFY_URL || DEFAULT_VERIFY_URL).trim());
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    assert(url.protocol === 'https:' || (url.protocol === 'http:' && loopback), 'MCP_VERIFY_URL 必须使用 HTTPS，仅本机允许 HTTP');
    assert(url.pathname === '/mcp', 'MCP_VERIFY_URL 路径必须为 /mcp');
    return url;
}

async function timedToolCall(client, name, args) {
    const startedAt = performance.now();
    const result = await client.callTool({ name, arguments: args });
    return {
        result,
        roundTripMs: roundDuration(startedAt),
    };
}

function recipeOrder(recipes, env) {
    const preferredNames = [
        String(env.MCP_VERIFY_LEFT_RECIPE || 'v550-tokoy').trim(),
        String(env.MCP_VERIFY_RIGHT_RECIPE || 'v750-tokoy').trim(),
    ].filter(Boolean);
    const preferred = [];
    const remaining = [...recipes];
    for (const name of preferredNames) {
        const index = remaining.findIndex(recipe => (
            String(recipe.name || '').trim().toLowerCase() === name.toLowerCase()
        ));
        if (index >= 0) preferred.push(...remaining.splice(index, 1));
    }
    return [...preferred, ...remaining];
}

function recipePairs(recipes, maximum) {
    const pairs = [];
    for (let leftIndex = 0; leftIndex < recipes.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < recipes.length; rightIndex += 1) {
            pairs.push([recipes[leftIndex], recipes[rightIndex]]);
            if (pairs.length >= maximum) return pairs;
        }
    }
    return pairs;
}

function assertCompleteCostSide(side, label) {
    const totalCost = side?.totalCost ?? side?.cost;
    assert(Number.isFinite(Number(totalCost)), `${label} totalCost 缺失`);
    assert(Number.isFinite(Number(side?.partsCost)), `${label} partsCost 缺失`);
    assert(Number.isFinite(Number(side?.laborCost)), `${label} laborCost 缺失`);
    assert(
        Math.abs(roundMoney(Number(side.partsCost) + Number(side.laborCost)) - roundMoney(totalCost)) < 0.01,
        `${label} totalCost 不等于 partsCost + laborCost`
    );
}

async function findComparablePair(client, recipes, env) {
    const configuredMaximum = Number.parseInt(env.MCP_VERIFY_MAX_PAIRS || '12', 10);
    const maximumPairs = Number.isInteger(configuredMaximum) && configuredMaximum > 0
        ? Math.min(12, configuredMaximum)
        : 12;
    const attempts = [];
    for (const [left, right] of recipePairs(recipeOrder(recipes, env), maximumPairs)) {
        const call = await timedToolCall(client, 'compare_recipes', {
            recipe1: left.name,
            recipe2: right.name,
        });
        const body = resultBody(call.result);
        attempts.push({
            left: left.name,
            right: right.name,
            roundTripMs: call.roundTripMs,
            errorCode: call.result?.isError ? resultErrorCode(call.result) : null,
        });
        if (!call.result?.isError && body?.costBasis === 'currentFullCost') {
            return { left, right, call, body, attempts };
        }
        if (resultErrorCode(call.result) !== 'RECIPE_COST_INCOMPLETE') {
            throw new Error(`compare_recipes 失败: ${resultErrorCode(call.result) || body?.error || 'unknown_error'}`);
        }
    }
    throw new Error(`未找到可用于生产成本对比验收的两个完整配方；已尝试 ${attempts.length} 组`);
}

async function evaluateProductionCostScenarios(client, env = process.env) {
    const listed = await client.listTools();
    const toolNames = new Set((listed.tools || []).map(tool => tool.name));
    for (const required of REQUIRED_TOOLS) {
        assert(toolNames.has(required), `MCP 工具目录缺少 ${required}`);
    }

    const recipesCall = await timedToolCall(client, 'get_all_recipes', {});
    assert(!recipesCall.result?.isError, 'get_all_recipes 调用失败');
    const recipes = resultBody(recipesCall.result);
    assert(Array.isArray(recipes) && recipes.length >= 2, '生产环境至少需要两个正式配方才能验收成本对比');

    const comparable = await findComparablePair(client, recipes, env);
    const { left, right, body: compared } = comparable;

    const fullCall = await timedToolCall(client, 'full_calculate', {
        recipeId: Number(left.id),
        hasFloat: false,
        cableLength: 0,
    });
    const full = resultBody(fullCall.result);
    assert(!fullCall.result?.isError, 'full_calculate 正式配方调用失败');
    assert(full?.sourceOfTruth === 'costEngine', 'full_calculate sourceOfTruth 不是 costEngine');
    assert(full?.costBasis === 'composedEstimate', 'full_calculate costBasis 不是 composedEstimate');
    assert(Number(full?.recipeCost?.recipeId) === Number(left.id), 'full_calculate 未绑定请求的正式配方');
    assert(!full?.recipeCost?.error, 'full_calculate 仍把配方错误内嵌在成功响应中');

    const invalidRecipeName = String(
        env.MCP_VERIFY_INVALID_RECIPE_NAME || DEFAULT_INVALID_RECIPE_NAME
    ).trim();
    const invalidCall = await timedToolCall(client, 'full_calculate', {
        pumphousing_model: invalidRecipeName,
    });
    const invalid = resultBody(invalidCall.result);
    assert(invalidCall.result?.isError === true, '泵壳模板名误作配方名时未整体失败');
    assert(
        resultErrorCode(invalidCall.result) === 'FULL_ESTIMATE_RECIPE_NOT_FOUND',
        '泵壳模板名误传未返回 FULL_ESTIMATE_RECIPE_NOT_FOUND'
    );

    const explainCall = await timedToolCall(client, 'explain_cost_change', {
        leftRecipeId: Number(left.id),
        rightRecipeId: Number(right.id),
    });
    const explained = resultBody(explainCall.result);
    assert(!explainCall.result?.isError, 'explain_cost_change 调用失败');
    assert(compared?.sourceOfTruth === 'costEngine', 'compare_recipes sourceOfTruth 不是 costEngine');
    assert(compared?.costBasis === 'currentFullCost', 'compare_recipes costBasis 不是 currentFullCost');
    assert(explained?.sourceOfTruth === 'costEngine', 'explain_cost_change sourceOfTruth 不是 costEngine');
    assert(explained?.costBasis === 'currentFullCost', 'explain_cost_change costBasis 不是 currentFullCost');
    assertCompleteCostSide(compared.recipe1, '配方1');
    assertCompleteCostSide(compared.recipe2, '配方2');
    assert(roundMoney(compared.recipe1.cost) === roundMoney(explained.left?.totalCost), '两工具的配方1总成本不一致');
    assert(roundMoney(compared.recipe2.cost) === roundMoney(explained.right?.totalCost), '两工具的配方2总成本不一致');
    assert(roundMoney(compared.costDiff) === roundMoney(explained.totalDiff), '两工具的总差额方向不一致');
    for (const row of compared.comparison || []) {
        assert(
            roundMoney(row.diff) === roundMoney(Number(row.amount2) - Number(row.amount1)),
            `成本明细 diff 方向不一致: ${row.name || row.key || 'unknown'}`
        );
    }

    return {
        schemaVersion: 1,
        status: 'passed',
        generatedAt: new Date().toISOString(),
        protocolVersion: typeof client.getNegotiatedProtocolVersion === 'function'
            ? client.getNegotiatedProtocolVersion()
            : null,
        toolCount: listed.tools.length,
        timingBoundary: {
            reportedMetric: 'clientRoundTripMs',
            serverDurationMs: null,
            serverDurationSource: 'API 日志 MCP 工具调用完成.durationMs',
            note: '本报告不把 generatedAt/fetchedAt 或 Agent 整轮时间冒充服务端耗时',
        },
        scenarios: {
            fullEstimateBindsRecipe: {
                status: 'passed',
                recipeId: full.recipeCost.recipeId,
                recipeName: full.recipeCost.recipeName,
                recipeCost: full.recipeCost.totalCost,
                totalCost: full.totalCost,
                costBasis: full.costBasis,
                sourceOfTruth: full.sourceOfTruth,
                clientRoundTripMs: fullCall.roundTripMs,
            },
            pumpShellNameFailsExplicitly: {
                status: 'passed',
                input: invalidRecipeName,
                errorCode: resultErrorCode(invalidCall.result),
                error: invalid?.error || null,
                clientRoundTripMs: invalidCall.roundTripMs,
            },
            comparisonUsesSameFullCostBasis: {
                status: 'passed',
                left: {
                    id: left.id,
                    name: left.name,
                    totalCost: compared.recipe1.cost,
                    partsCost: compared.recipe1.partsCost,
                    laborCost: compared.recipe1.laborCost,
                },
                right: {
                    id: right.id,
                    name: right.name,
                    totalCost: compared.recipe2.cost,
                    partsCost: compared.recipe2.partsCost,
                    laborCost: compared.recipe2.laborCost,
                },
                totalDiff: Number(compared.costDiff),
                costBasis: compared.costBasis,
                sourceOfTruth: compared.sourceOfTruth,
                detailCount: (compared.comparison || []).length,
                compareClientRoundTripMs: comparable.call.roundTripMs,
                explainClientRoundTripMs: explainCall.roundTripMs,
                attemptedPairs: comparable.attempts.length,
            },
        },
        missingPriceCoverage: {
            productionMutation: false,
            coverage: 'isolated automated test',
            expectedErrorCode: 'RECIPE_COST_INCOMPLETE',
        },
    };
}

function writeReport(report, reportPath = DEFAULT_REPORT_PATH) {
    const resolved = path.resolve(reportPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return resolved;
}

async function runProductionCostVerification(options = {}) {
    const env = options.env || process.env;
    const credential = resolveVerificationCredential(env);
    const url = resolveVerificationUrl(env);
    const client = options.client || new Client(
        { name: 'pump-production-cost-verifier', version: '1.0.0' },
        { versionNegotiation: { mode: 'auto' } }
    );
    const ownsClient = !options.client;
    try {
        if (ownsClient) {
            await client.connect(new StreamableHTTPClientTransport(url, {
                requestInit: {
                    headers: { Authorization: `Bearer ${credential.token}` },
                },
            }));
        }
        const report = await evaluateProductionCostScenarios(client, env);
        report.endpoint = `${url.origin}${url.pathname}`;
        report.credential = {
            clientId: credential.clientId,
            source: credential.source,
        };
        return report;
    } finally {
        if (ownsClient) await client.close();
    }
}

async function main() {
    require('dotenv').config({ path: path.join(process.cwd(), '.env'), quiet: true });
    const reportPath = String(process.env.MCP_VERIFY_REPORT || DEFAULT_REPORT_PATH).trim();
    try {
        const report = await runProductionCostVerification();
        const resolvedReportPath = writeReport(report, reportPath);
        console.log(JSON.stringify({
            status: report.status,
            protocolVersion: report.protocolVersion,
            toolCount: report.toolCount,
            scenarios: Object.fromEntries(Object.entries(report.scenarios).map(([key, value]) => [
                key,
                value.status,
            ])),
            report: resolvedReportPath,
        }, null, 2));
    } catch (error) {
        const failure = {
            schemaVersion: 1,
            status: 'failed',
            generatedAt: new Date().toISOString(),
            error: error.message,
        };
        const resolvedReportPath = writeReport(failure, reportPath);
        console.error(JSON.stringify({ ...failure, report: resolvedReportPath }, null, 2));
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    DEFAULT_INVALID_RECIPE_NAME,
    DEFAULT_VERIFY_URL,
    REQUIRED_TOOLS,
    evaluateProductionCostScenarios,
    recipeOrder,
    recipePairs,
    resolveVerificationCredential,
    resolveVerificationUrl,
    resultBody,
    runProductionCostVerification,
    writeReport,
};
