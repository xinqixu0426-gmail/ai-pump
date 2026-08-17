const assert = require('node:assert/strict');
const test = require('node:test');
const {
    REQUIRED_TOOLS,
    evaluateProductionCostScenarios,
    resolveVerificationCredential,
    resolveVerificationUrl,
    runProductionCostVerification,
} = require('../scripts/verify-mcp-production-cost.cjs');

function result(body, isError = false) {
    return {
        ...(isError ? { isError: true } : {}),
        content: [{ type: 'text', text: JSON.stringify(body) }],
        structuredContent: body,
    };
}

function mcpEvidence(name, dataMode = 'live') {
    return {
        capabilityId: `ai.${name}`,
        operation: 'query',
        sourceOfTruth: 'costEngine',
        dataMode,
        verified: true,
        fetchedAt: '2026-08-17T00:00:00.000Z',
    };
}

function createFakeClient(options = {}) {
    const calls = [];
    const compareDiff = options.compareDiff ?? 19.55;
    const detailDiff = options.detailDiff ?? 19.55;
    return {
        calls,
        getNegotiatedProtocolVersion: () => '2026-07-28',
        listTools: async () => ({
            tools: REQUIRED_TOOLS.map(name => ({ name })),
        }),
        callTool: async call => {
            calls.push(call);
            if (call.name === 'get_all_recipes') {
                return result({
                    success: true,
                    data: [
                        { id: 1, name: 'v550-tokoy' },
                        { id: 2, name: 'v750-tokoy' },
                    ],
                });
            }
            if (call.name === 'compare_recipes') {
                return result({
                    success: true,
                    sourceOfTruth: 'costEngine',
                    costBasis: 'currentFullCost',
                    recipe1: { name: 'v550-tokoy', cost: 272.18, partsCost: 251.18, laborCost: 21 },
                    recipe2: { name: 'v750-tokoy', cost: 291.73, partsCost: 270.73, laborCost: 21 },
                    costDiff: compareDiff.toFixed(2),
                    comparison: [{
                        name: '成本差异',
                        amount1: 272.18,
                        amount2: 291.73,
                        diff: detailDiff,
                    }],
                    mcp: mcpEvidence('compare_recipes', options.compareDataMode),
                });
            }
            if (call.name === 'full_calculate' && call.arguments.recipeId) {
                return result({
                    success: true,
                    data: {
                        sourceOfTruth: 'costEngine',
                        costBasis: 'composedEstimate',
                        recipeCost: {
                            recipeId: 1,
                            recipeName: 'v550-tokoy',
                            totalCost: '251.49',
                        },
                        totalCost: '251.49',
                    },
                });
            }
            if (call.name === 'full_calculate' && call.arguments.pumphousing_model) {
                return result({
                    success: false,
                    code: 'FULL_ESTIMATE_RECIPE_NOT_FOUND',
                    error: '泵壳模板名不是配方名',
                }, true);
            }
            if (call.name === 'explain_cost_change') {
                return result({
                    success: true,
                    data: {
                        sourceOfTruth: 'costEngine',
                        costBasis: 'currentFullCost',
                        left: { totalCost: 272.18 },
                        right: { totalCost: 291.73 },
                        totalDiff: 19.55,
                    },
                    mcp: mcpEvidence('explain_cost_change', options.explainDataMode),
                });
            }
            throw new Error(`unexpected tool call: ${call.name}`);
        },
    };
}

const verificationEnv = Object.freeze({
    MCP_VERIFY_TOKEN: 'production-verifier-token-0123456789abcdef',
    MCP_VERIFY_URL: 'https://factory.example.com/mcp',
});

test('生产 MCP 成本验收：三个只读场景共用正式口径且报告不含 token', async () => {
    const client = createFakeClient();
    const report = await runProductionCostVerification({ client, env: verificationEnv });

    assert.equal(report.status, 'passed');
    assert.equal(report.protocolVersion, '2026-07-28');
    assert.equal(report.scenarios.fullEstimateBindsRecipe.costBasis, 'composedEstimate');
    assert.equal(report.scenarios.pumpShellNameFailsExplicitly.errorCode, 'FULL_ESTIMATE_RECIPE_NOT_FOUND');
    assert.equal(report.scenarios.comparisonUsesSameFullCostBasis.totalDiff, 19.55);
    assert.equal(report.scenarios.comparisonUsesSameFullCostBasis.compareDataMode, 'live');
    assert.equal(report.scenarios.comparisonUsesSameFullCostBasis.explainDataMode, 'live');
    assert.equal(report.timingBoundary.serverDurationMs, null);
    assert.doesNotMatch(JSON.stringify(report), /production-verifier-token/);
    assert.deepEqual(client.calls.map(call => call.name), [
        'get_all_recipes',
        'compare_recipes',
        'full_calculate',
        'full_calculate',
        'explain_cost_change',
    ]);
});

test('生产 MCP 成本验收：同源成本对比工具不是 live 时必须失败', async () => {
    const client = createFakeClient({ compareDataMode: 'stable' });
    await assert.rejects(
        () => evaluateProductionCostScenarios(client, verificationEnv),
        /compare_recipes dataMode 不是 live/
    );
});

test('生产 MCP 成本验收：明细差额不是配方2减配方1时必须失败', async () => {
    const client = createFakeClient({ detailDiff: -19.55 });
    await assert.rejects(
        () => evaluateProductionCostScenarios(client, verificationEnv),
        /成本明细 diff 方向不一致/
    );
});

test('生产 MCP 成本验收：凭证优先显式环境变量并且 URL 只允许 HTTPS 或本机 HTTP', () => {
    const explicit = resolveVerificationCredential(verificationEnv);
    assert.equal(explicit.source, 'MCP_VERIFY_TOKEN');
    assert.equal(explicit.clientId, 'explicit-verifier');

    const service = resolveVerificationCredential({
        MCP_SERVICE_TOKENS: JSON.stringify({ verifier: 'service-verifier-token-0123456789abcdef' }),
    });
    assert.equal(service.source, 'MCP_SERVICE_TOKENS');
    assert.equal(service.clientId, 'verifier');

    assert.equal(resolveVerificationUrl({ MCP_VERIFY_URL: 'http://127.0.0.1:3002/mcp' }).href, 'http://127.0.0.1:3002/mcp');
    assert.throws(
        () => resolveVerificationUrl({ MCP_VERIFY_URL: 'http://factory.example.com/mcp' }),
        /HTTPS/
    );
});
