const assert = require('node:assert/strict');
const test = require('node:test');
const {
    REPRESENTATIVE_TOOL_NAMES,
    evaluateRepresentativeReadDomains,
    runProductionReadVerification,
} = require('../scripts/verify-mcp-production-read.cjs');

const verificationEnv = Object.freeze({
    MCP_VERIFY_TOKEN: 'production-read-verifier-token-0123456789abcdef',
    MCP_VERIFY_URL: 'https://factory.example.com/mcp',
});

function costReport() {
    return {
        schemaVersion: 1,
        status: 'passed',
        generatedAt: '2026-08-17T00:00:00.000Z',
        protocolVersion: '2026-07-28',
        toolCount: 45,
        scenarios: {
            fullEstimateBindsRecipe: {
                status: 'passed',
                recipeId: 1,
                recipeName: 'v550-tokoy',
            },
            pumpShellNameFailsExplicitly: { status: 'passed' },
            comparisonUsesSameFullCostBasis: {
                status: 'passed',
                attemptedPairs: 1,
            },
        },
    };
}

function successfulResult(name, options = {}) {
    return {
        content: [{ type: 'text', text: '{}' }],
        structuredContent: {
            success: true,
            count: name === 'get_recent_orders' ? (options.orderCount ?? 0) : 1,
            data: name === 'get_recent_orders' ? [] : [{ id: 1 }],
            mcp: options.omitEvidence ? undefined : {
                capabilityId: `ai.${name}`,
                operation: 'query',
                sourceOfTruth: 'formalApi',
                dataMode: 'live',
                verified: true,
                fetchedAt: '2026-08-17T00:00:00.000Z',
            },
        },
    };
}

function createFakeClient(options = {}) {
    const calls = [];
    return {
        calls,
        getNegotiatedProtocolVersion: () => '2026-07-28',
        listTools: async () => ({
            tools: REPRESENTATIVE_TOOL_NAMES.map(name => ({ name })),
        }),
        callTool: async call => {
            calls.push(call);
            return successfulResult(call.name, {
                omitEvidence: call.name === options.omitEvidenceFor,
                orderCount: options.orderCount,
            });
        },
    };
}

test('生产 MCP 全领域只读验收：单连接覆盖代表工具且报告不含 token', async () => {
    const client = createFakeClient();
    const report = await runProductionReadVerification({
        client,
        env: verificationEnv,
        costEvaluator: async () => costReport(),
    });

    assert.equal(report.status, 'passed');
    assert.equal(report.toolDirectory.representativeToolCount, 16);
    assert.equal(report.requestBudget.maximumRequests, 33);
    assert.equal(report.requestBudget.actualRequests, 22);
    assert.equal(report.domains.orders.resourceSpecificCoverage.status, 'not_applicable');
    assert.deepEqual(client.calls.map(call => call.name), REPRESENTATIVE_TOOL_NAMES);
    assert.deepEqual(
        client.calls.find(call => call.name === 'get_recipe_detail').arguments,
        { recipeId: 1, includeCurrentCost: true }
    );
    assert.doesNotMatch(JSON.stringify(report), /production-read-verifier-token/);
});

test('生产 MCP 全领域只读验收：缺少执行证据必须失败', async () => {
    const client = createFakeClient({ omitEvidenceFor: 'get_dashboard_summary' });
    await assert.rejects(
        () => evaluateRepresentativeReadDomains(client, costReport()),
        /get_dashboard_summary 缺少已验证执行证据/
    );
});

test('生产 MCP 全领域只读验收：代表工具未进入目录必须失败', async () => {
    const client = createFakeClient();
    client.listTools = async () => ({
        tools: REPRESENTATIVE_TOOL_NAMES
            .filter(name => name !== 'get_factory_knowledge_health')
            .map(name => ({ name })),
    });
    await assert.rejects(
        () => evaluateRepresentativeReadDomains(client, costReport()),
        /MCP 工具目录缺少生产代表工具 get_factory_knowledge_health/
    );
});
