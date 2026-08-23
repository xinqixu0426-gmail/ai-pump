const path = require('node:path');
const { performance } = require('node:perf_hooks');
const {
    Client,
    StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/client');
const {
    evaluateProductionCostScenarios,
    resolveVerificationCredential,
    resolveVerificationUrl,
    writeReport,
} = require('./verify-mcp-production-cost.cjs');
const {
    MCP_READ_ONLY_TOOL_NAMES,
    MCP_WRITE_TOOL_NAMES,
} = require('../api/mcp/catalog.cjs');
const {
    getMcpWriteToolsForClient,
} = require('../api/services/environment.cjs');

const DEFAULT_REPORT_PATH = path.join('logs', 'mcp-production-read-latest.json');
const DEFAULT_COST_REPORT_PATH = path.join('logs', 'mcp-production-cost-latest.json');
const PRODUCTION_RATE_LIMIT_PER_MINUTE = 60;
const MAXIMUM_COST_TOOL_CALLS = 16;

function validateProductionToolDirectory(listed, credential, env) {
    const tools = Array.isArray(listed?.tools) ? listed.tools : [];
    const names = tools.map(tool => String(tool?.name || '').trim());
    assert(new Set(names).size === names.length, '生产 MCP 工具目录存在重复名称');

    const readToolSet = new Set(MCP_READ_ONLY_TOOL_NAMES);
    const writeToolSet = new Set(MCP_WRITE_TOOL_NAMES);
    const expectedWriteTools = getMcpWriteToolsForClient(credential.clientId, env);
    const expectedWriteSet = new Set(expectedWriteTools);

    for (const name of MCP_READ_ONLY_TOOL_NAMES) {
        const tool = tools.find(item => item.name === name);
        assert(tool, `生产 MCP 工具目录缺少只读工具 ${name}`);
        assert(tool.annotations?.readOnlyHint === true, `生产 MCP 只读工具 annotation 错误: ${name}`);
    }
    for (const tool of tools) {
        const name = String(tool?.name || '').trim();
        assert(readToolSet.has(name) || writeToolSet.has(name), `生产 MCP 工具目录出现未知工具 ${name || '(empty)'}`);
        if (readToolSet.has(name)) continue;
        assert(expectedWriteSet.has(name), `生产 MCP 工具目录暴露未授权写工具 ${name}`);
        assert(tool.annotations?.readOnlyHint === false, `生产 MCP 写工具 annotation 错误: ${name}`);
    }

    const actualWriteTools = MCP_WRITE_TOOL_NAMES.filter(name => names.includes(name));
    const expectedWriteDirectory = MCP_WRITE_TOOL_NAMES.filter(name => expectedWriteSet.has(name));
    assert(
        JSON.stringify(actualWriteTools) === JSON.stringify(expectedWriteDirectory),
        '生产 MCP 写工具目录与当前服务身份 allowlist 不一致'
    );
    assert(
        tools.length === MCP_READ_ONLY_TOOL_NAMES.length + expectedWriteTools.length,
        '生产 MCP 工具目录数量与授权契约不一致'
    );

    return {
        toolCount: tools.length,
        readToolCount: MCP_READ_ONLY_TOOL_NAMES.length,
        writeToolCount: actualWriteTools.length,
        writeTools: actualWriteTools,
        hiddenWriteToolCount: MCP_WRITE_TOOL_NAMES.length - actualWriteTools.length,
    };
}

const DOMAIN_SCENARIOS = Object.freeze([
    Object.freeze({
        id: 'inventory',
        label: '库存与物料',
        calls: Object.freeze([
            Object.freeze({ name: 'search_parts', args: Object.freeze({ limit: 1 }) }),
            Object.freeze({ name: 'search_coils', args: Object.freeze({}) }),
        ]),
    }),
    Object.freeze({
        id: 'recipes',
        label: '配方与泵壳模板',
        calls: Object.freeze([
            Object.freeze({ name: 'search_templates', args: Object.freeze({ limit: 1 }) }),
            Object.freeze({ name: 'get_all_recipes', args: Object.freeze({}) }),
            Object.freeze({
                name: 'get_recipe_detail',
                args: costReport => ({
                    recipeId: Number(costReport.scenarios.fullEstimateBindsRecipe.recipeId),
                    includeCurrentCost: true,
                }),
            }),
            Object.freeze({
                name: 'preview_recipe_cost',
                contract: 'current',
                args: costReport => ({
                    recipeId: Number(costReport.scenarios.fullEstimateBindsRecipe.recipeId),
                }),
            }),
            Object.freeze({
                name: 'preview_recipe_cost',
                contract: 'override',
                args: costReport => ({
                    recipeId: Number(costReport.scenarios.fullEstimateBindsRecipe.recipeId),
                    customBarrelLength: 180,
                }),
            }),
        ]),
    }),
    Object.freeze({
        id: 'commercial',
        label: '客户与报价',
        calls: Object.freeze([
            Object.freeze({ name: 'search_customers', args: Object.freeze({ limit: 1 }) }),
            Object.freeze({ name: 'search_quotations', args: Object.freeze({ limit: 1 }) }),
        ]),
    }),
    Object.freeze({
        id: 'orders',
        label: '订单与采购',
        calls: Object.freeze([
            Object.freeze({ name: 'get_recent_orders', args: Object.freeze({ limit: 1 }) }),
            Object.freeze({
                name: 'get_purchase_overview',
                args: Object.freeze({ limit: 10, pendingOnly: true }),
            }),
            Object.freeze({ name: 'get_order_readiness_overview', args: Object.freeze({}) }),
        ]),
    }),
    Object.freeze({
        id: 'management',
        label: '管理与数据质量',
        calls: Object.freeze([
            Object.freeze({ name: 'get_dashboard_summary', args: Object.freeze({}) }),
            Object.freeze({ name: 'get_business_alerts', args: Object.freeze({}) }),
            Object.freeze({ name: 'get_management_action_center', args: Object.freeze({}) }),
            Object.freeze({ name: 'get_data_quality_summary', args: Object.freeze({}) }),
        ]),
    }),
    Object.freeze({
        id: 'knowledge',
        label: '工厂知识',
        calls: Object.freeze([
            Object.freeze({ name: 'get_factory_knowledge_health', args: Object.freeze({}) }),
        ]),
    }),
    Object.freeze({
        id: 'drawings',
        label: '转子出图历史',
        calls: Object.freeze([
            Object.freeze({ name: 'get_rotor_drawing_history', args: Object.freeze({ limit: 1 }) }),
        ]),
    }),
    Object.freeze({
        id: 'businessChanges',
        label: '统一业务变更',
        calls: Object.freeze([
            Object.freeze({ name: 'search_business_changes', args: Object.freeze({ period: 'last7days', limit: 10 }) }),
        ]),
    }),
]);

const REPRESENTATIVE_CALL_NAMES = Object.freeze(
    DOMAIN_SCENARIOS.flatMap(domain => domain.calls.map(call => call.name))
);
const REPRESENTATIVE_TOOL_NAMES = Object.freeze([...new Set(REPRESENTATIVE_CALL_NAMES)]);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function roundDuration(startedAt) {
    return Math.round((performance.now() - startedAt) * 10) / 10;
}

function findCaseInsensitiveDuplicateKeys(value, pathPrefix = '$') {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) {
        return value.flatMap((item, index) => (
            findCaseInsensitiveDuplicateKeys(item, `${pathPrefix}[${index}]`)
        ));
    }
    const seen = new Map();
    const duplicates = [];
    for (const [key, child] of Object.entries(value)) {
        const normalized = key.toLowerCase();
        if (seen.has(normalized)) {
            duplicates.push(`${pathPrefix}.${seen.get(normalized)}/${key}`);
        } else {
            seen.set(normalized, key);
        }
        duplicates.push(...findCaseInsensitiveDuplicateKeys(child, `${pathPrefix}.${key}`));
    }
    return duplicates;
}

function validateRecipeDetailContract(envelope, costReport) {
    const duplicates = findCaseInsensitiveDuplicateKeys(envelope?.recipe);
    assert(duplicates.length === 0, `get_recipe_detail 存在大小写重复键: ${duplicates.join(', ')}`);
    assert(envelope?.currentCost?.costBasis === 'currentFullCost', 'get_recipe_detail currentCost 不是 currentFullCost');
    assert(envelope?.currentCost?.sourceOfTruth === 'costEngine', 'get_recipe_detail currentCost 不是 costEngine');
    const expected = Number(costReport.scenarios.comparisonUsesSameFullCostBasis.left.totalCost);
    const actual = Number(envelope.currentCost.currentTotalCost);
    assert(Number.isFinite(actual), 'get_recipe_detail currentTotalCost 缺失');
    assert(Math.abs(actual - expected) < 0.01, 'get_recipe_detail 与 compare_recipes 当前完整成本不一致');
    return {
        canonicalKeys: true,
        costBasis: envelope.currentCost.costBasis,
        sourceOfTruth: envelope.currentCost.sourceOfTruth,
        currentTotalCost: actual,
        matchesComparison: true,
    };
}

function validateRecipeCostPreviewContract(envelope, costReport) {
    const currentCost = envelope?.data;
    assert(currentCost?.costBasis === 'currentFullCost', 'preview_recipe_cost 无覆盖结果不是 currentFullCost');
    assert(currentCost?.sourceOfTruth === 'costEngine', 'preview_recipe_cost 无覆盖结果不是 costEngine');
    const expected = Number(costReport.scenarios.comparisonUsesSameFullCostBasis.left.totalCost);
    const actual = Number(currentCost.currentTotalCost);
    assert(Number.isFinite(actual), 'preview_recipe_cost currentTotalCost 缺失');
    assert(Math.abs(actual - expected) < 0.01, 'preview_recipe_cost 与 compare_recipes 当前完整成本不一致');
    return {
        costBasis: currentCost.costBasis,
        sourceOfTruth: currentCost.sourceOfTruth,
        currentTotalCost: actual,
        matchesComparison: true,
    };
}

function validateRecipeCostOverrideContract(envelope) {
    const preview = envelope?.data;
    assert(preview?.costBasis === 'overridePreview', 'preview_recipe_cost 覆盖结果不是 overridePreview');
    assert(preview?.sourceOfTruth === 'costEngine', 'preview_recipe_cost 覆盖结果不是 costEngine');
    const actual = Number(preview.currentTotalCost);
    assert(Number.isFinite(actual), 'preview_recipe_cost 覆盖结果 currentTotalCost 缺失');
    assert(Math.abs(actual - Number(preview.unitCost)) < 0.01, 'preview_recipe_cost 覆盖结果兼容 unitCost 不等于 currentTotalCost');
    assert(
        String(preview.deprecatedFields?.unitCost || '').includes('currentTotalCost'),
        'preview_recipe_cost 覆盖结果缺少 unitCost 废弃说明'
    );
    return {
        costBasis: preview.costBasis,
        sourceOfTruth: preview.sourceOfTruth,
        currentTotalCost: actual,
        compatibilityAliasMatches: true,
    };
}

function returnedCount(envelope) {
    const candidates = [
        envelope?.queryReceipt?.returnedCount,
        envelope?.returnedCount,
        envelope?.count,
    ];
    for (const candidate of candidates) {
        if (Number.isFinite(Number(candidate))) return Number(candidate);
    }
    if (Array.isArray(envelope?.data)) return envelope.data.length;
    if (Array.isArray(envelope?.history)) return envelope.history.length;
    return null;
}

function verifiedToolEvidence(name, result, roundTripMs) {
    const envelope = result?.structuredContent;
    assert(result?.isError !== true, `${name} 返回 MCP 错误`);
    assert(envelope && typeof envelope === 'object' && !Array.isArray(envelope), `${name} 缺少 structuredContent`);
    assert(envelope.success !== false, `${name} 返回业务失败: ${envelope.code || envelope.error || 'unknown_error'}`);
    assert(envelope.mcp?.verified === true, `${name} 缺少已验证执行证据`);
    assert(String(envelope.mcp.capabilityId || '').startsWith('ai.'), `${name} 缺少 capabilityId`);
    assert(['query', 'preview'].includes(envelope.mcp.operation), `${name} 不是只读 Query/Preview`);
    assert(String(envelope.mcp.sourceOfTruth || '').trim(), `${name} 缺少 sourceOfTruth`);
    assert(String(envelope.mcp.dataMode || '').trim(), `${name} 缺少 dataMode`);
    return {
        name,
        status: 'passed',
        clientRoundTripMs: roundTripMs,
        capabilityId: envelope.mcp.capabilityId,
        operation: envelope.mcp.operation,
        sourceOfTruth: envelope.mcp.sourceOfTruth,
        dataMode: envelope.mcp.dataMode,
        returnedCount: returnedCount(envelope),
    };
}

async function evaluateRepresentativeReadDomains(client, costReport, options = {}) {
    const listed = options.listedTools || await client.listTools();
    const toolNames = new Set((listed.tools || []).map(tool => tool.name));
    for (const required of REPRESENTATIVE_TOOL_NAMES) {
        assert(toolNames.has(required), `MCP 工具目录缺少生产代表工具 ${required}`);
    }

    const domains = {};
    for (const domain of DOMAIN_SCENARIOS) {
        const tools = [];
        for (const call of domain.calls) {
            const args = typeof call.args === 'function' ? call.args(costReport) : call.args;
            const startedAt = performance.now();
            const result = await client.callTool({ name: call.name, arguments: args });
            const evidence = verifiedToolEvidence(call.name, result, roundDuration(startedAt));
            evidence.scenario = call.contract || 'representative';
            if (call.name === 'get_recipe_detail') {
                evidence.contract = validateRecipeDetailContract(result.structuredContent, costReport);
            }
            if (call.name === 'preview_recipe_cost' && call.contract === 'current') {
                evidence.contract = validateRecipeCostPreviewContract(result.structuredContent, costReport);
            }
            if (call.name === 'preview_recipe_cost' && call.contract === 'override') {
                evidence.contract = validateRecipeCostOverrideContract(result.structuredContent);
            }
            tools.push(evidence);
        }
        domains[domain.id] = {
            status: 'passed',
            label: domain.label,
            tools,
        };
    }

    const recentOrders = domains.orders.tools.find(tool => tool.name === 'get_recent_orders');
    domains.orders.resourceSpecificCoverage = recentOrders?.returnedCount === 0
        ? {
            status: 'not_applicable',
            reason: '正式环境当前没有可供只读详情验收的订单；未创建测试订单',
        }
        : {
            status: 'covered_by_isolated_suite',
            reason: '生产矩阵只验收订单列表、采购总览和准备总览；订单详情由隔离全工具套件覆盖',
        };
    return domains;
}

async function runProductionReadVerification(options = {}) {
    const env = options.env || process.env;
    const credential = resolveVerificationCredential(env);
    const url = resolveVerificationUrl(env);
    const client = options.client || new Client(
        { name: 'pump-production-read-verifier', version: '1.0.0' },
        { versionNegotiation: { mode: 'auto' } }
    );
    const ownsClient = !options.client;
    const costEvaluator = options.costEvaluator || evaluateProductionCostScenarios;
    try {
        if (ownsClient) {
            await client.connect(new StreamableHTTPClientTransport(url, {
                requestInit: {
                    headers: { Authorization: `Bearer ${credential.token}` },
                },
            }));
        }
        const listed = await client.listTools();
        const toolDirectory = validateProductionToolDirectory(listed, credential, env);
        const costReport = await costEvaluator(client, env, { listedTools: listed });
        costReport.endpoint = `${url.origin}${url.pathname}`;
        costReport.credential = {
            clientId: credential.clientId,
            source: credential.source,
        };

        try {
            const readDomains = await evaluateRepresentativeReadDomains(client, costReport, {
                listedTools: listed,
            });
            const attemptedPairs = Number(
                costReport.scenarios.comparisonUsesSameFullCostBasis.attemptedPairs || 0
            );
            const actualToolCalls = REPRESENTATIVE_CALL_NAMES.length + 4 + attemptedPairs;
            const maximumRequests = 1 + REPRESENTATIVE_CALL_NAMES.length + MAXIMUM_COST_TOOL_CALLS;
            assert(maximumRequests <= PRODUCTION_RATE_LIMIT_PER_MINUTE, '生产验收矩阵超过 MCP 限流预算');
            return {
                schemaVersion: 1,
                status: 'passed',
                generatedAt: new Date().toISOString(),
                endpoint: `${url.origin}${url.pathname}`,
                credential: {
                    clientId: credential.clientId,
                    source: credential.source,
                },
                protocolVersion: typeof client.getNegotiatedProtocolVersion === 'function'
                    ? client.getNegotiatedProtocolVersion()
                    : costReport.protocolVersion,
                toolDirectory: {
                    ...toolDirectory,
                    representativeToolCount: REPRESENTATIVE_TOOL_NAMES.length,
                },
                requestBudget: {
                    productionRateLimitPerMinute: PRODUCTION_RATE_LIMIT_PER_MINUTE,
                    maximumRequests,
                    actualRequests: 1 + actualToolCalls,
                    listRequests: 1,
                    toolCalls: actualToolCalls,
                },
                productionDataPolicy: {
                    readOnly: true,
                    createsFakeData: false,
                    mutatesProduction: false,
                    resourceSpecificEmptyDataIsNotFailure: true,
                },
                domains: {
                    cost: costReport,
                    ...readDomains,
                },
            };
        } catch (error) {
            error.costReport = costReport;
            throw error;
        }
    } finally {
        if (ownsClient) await client.close();
    }
}

async function main() {
    require('dotenv').config({ path: path.join(process.cwd(), '.env'), quiet: true });
    const reportPath = String(process.env.MCP_VERIFY_READ_REPORT || DEFAULT_REPORT_PATH).trim();
    const costReportPath = String(process.env.MCP_VERIFY_REPORT || DEFAULT_COST_REPORT_PATH).trim();
    try {
        const report = await runProductionReadVerification();
        const resolvedReportPath = writeReport(report, reportPath);
        writeReport(report.domains.cost, costReportPath);
        console.log(JSON.stringify({
            status: report.status,
            protocolVersion: report.protocolVersion,
            toolCount: report.toolDirectory.toolCount,
            readToolCount: report.toolDirectory.readToolCount,
            writeToolCount: report.toolDirectory.writeToolCount,
            writeTools: report.toolDirectory.writeTools,
            representativeToolCount: report.toolDirectory.representativeToolCount,
            actualRequests: report.requestBudget.actualRequests,
            domains: Object.fromEntries(Object.entries(report.domains).map(([key, value]) => [
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
        writeReport(error.costReport || failure, costReportPath);
        console.error(JSON.stringify({ ...failure, report: resolvedReportPath }, null, 2));
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    DEFAULT_REPORT_PATH,
    REPRESENTATIVE_CALL_NAMES,
    DOMAIN_SCENARIOS,
    REPRESENTATIVE_TOOL_NAMES,
    evaluateRepresentativeReadDomains,
    findCaseInsensitiveDuplicateKeys,
    runProductionReadVerification,
    validateProductionToolDirectory,
    validateRecipeDetailContract,
    validateRecipeCostPreviewContract,
    validateRecipeCostOverrideContract,
    verifiedToolEvidence,
};
