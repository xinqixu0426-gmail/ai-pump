const assert = require('node:assert/strict');
const test = require('node:test');
const {
    MCP_READ_ONLY_TOOL_NAMES,
} = require('../api/mcp/catalog.cjs');
const {
    REPRESENTATIVE_CALL_NAMES,
    REPRESENTATIVE_TOOL_NAMES,
    evaluateRepresentativeReadDomains,
    runProductionReadVerification,
    validateProductionToolDirectory,
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
                left: { id: 1, name: 'v550-tokoy', totalCost: 272.18 },
            },
        },
    };
}

function successfulResult(name, options = {}) {
    const recipeDetail = name === 'get_recipe_detail'
        ? {
            recipe: {
                id: 1,
                name: 'v550-tokoy',
                ...(options.duplicateRecipeKeys ? { Id: 1 } : {}),
            },
            currentCost: {
                currentTotalCost: options.recipeDetailCurrentTotalCost ?? 272.18,
                costBasis: 'currentFullCost',
                sourceOfTruth: 'costEngine',
            },
        }
        : {};
    const overrideCurrentTotalCost = options.overrideMissingCurrentTotalCost
        ? undefined
        : (options.overrideCurrentTotalCost ?? 273.17);
    const data = name === 'get_recent_orders'
        ? []
        : name === 'preview_recipe_cost'
            ? options.overridePreview ? {
                recipeId: 1,
                currentTotalCost: overrideCurrentTotalCost,
                unitCost: options.overrideUnitCost ?? overrideCurrentTotalCost,
                costBasis: 'overridePreview',
                sourceOfTruth: 'costEngine',
                deprecatedFields: options.omitOverrideDeprecated
                    ? {}
                    : { unitCost: '兼容字段；请改用 currentTotalCost' },
            } : {
                recipeId: 1,
                currentTotalCost: options.previewCurrentTotalCost ?? 272.18,
                costBasis: 'currentFullCost',
                sourceOfTruth: 'costEngine',
            }
            : [{ id: 1 }];
    return {
        content: [{ type: 'text', text: '{}' }],
        structuredContent: {
            success: true,
            count: name === 'get_recent_orders' ? (options.orderCount ?? 0) : 1,
            data,
            ...recipeDetail,
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
            tools: [
                ...MCP_READ_ONLY_TOOL_NAMES.map(name => ({
                    name,
                    annotations: { readOnlyHint: true },
                })),
                ...(options.writeTools || []).map(name => ({
                    name,
                    annotations: { readOnlyHint: false },
                })),
                ...(options.extraTools || []),
            ],
        }),
        callTool: async call => {
            calls.push(call);
            return successfulResult(call.name, {
                omitEvidence: call.name === options.omitEvidenceFor,
                orderCount: options.orderCount,
                duplicateRecipeKeys: call.name === 'get_recipe_detail' && options.duplicateRecipeKeys,
                recipeDetailCurrentTotalCost: options.recipeDetailCurrentTotalCost,
                previewCurrentTotalCost: options.previewCurrentTotalCost,
                overridePreview: call.name === 'preview_recipe_cost'
                    && call.arguments.customBarrelLength !== undefined,
                overrideCurrentTotalCost: options.overrideCurrentTotalCost,
                overrideMissingCurrentTotalCost: options.overrideMissingCurrentTotalCost,
                overrideUnitCost: options.overrideUnitCost,
                omitOverrideDeprecated: options.omitOverrideDeprecated,
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
    assert.equal(report.toolDirectory.representativeToolCount, 17);
    assert.equal(report.toolDirectory.readToolCount, 45);
    assert.equal(report.toolDirectory.writeToolCount, 0);
    assert.deepEqual(report.toolDirectory.writeTools, []);
    assert.equal(report.requestBudget.maximumRequests, 35);
    assert.equal(report.requestBudget.actualRequests, 24);
    assert.equal(report.domains.orders.resourceSpecificCoverage.status, 'not_applicable');
    const recipeDetail = report.domains.recipes.tools.find(tool => tool.name === 'get_recipe_detail');
    assert.deepEqual(recipeDetail.contract, {
        canonicalKeys: true,
        costBasis: 'currentFullCost',
        sourceOfTruth: 'costEngine',
        currentTotalCost: 272.18,
        matchesComparison: true,
    });
    const recipePreview = report.domains.recipes.tools.find(tool => (
        tool.name === 'preview_recipe_cost' && tool.scenario === 'current'
    ));
    assert.deepEqual(recipePreview.contract, {
        costBasis: 'currentFullCost',
        sourceOfTruth: 'costEngine',
        currentTotalCost: 272.18,
        matchesComparison: true,
    });
    const recipeOverride = report.domains.recipes.tools.find(tool => (
        tool.name === 'preview_recipe_cost' && tool.scenario === 'override'
    ));
    assert.deepEqual(recipeOverride.contract, {
        costBasis: 'overridePreview',
        sourceOfTruth: 'costEngine',
        currentTotalCost: 273.17,
        compatibilityAliasMatches: true,
    });
    assert.deepEqual(client.calls.map(call => call.name), REPRESENTATIVE_CALL_NAMES);
    assert.deepEqual(
        client.calls.find(call => call.name === 'get_recipe_detail').arguments,
        { recipeId: 1, includeCurrentCost: true }
    );
    assert.deepEqual(
        client.calls.find(call => (
            call.name === 'preview_recipe_cost' && call.arguments.customBarrelLength !== undefined
        )).arguments,
        { recipeId: 1, customBarrelLength: 180 }
    );
    assert.doesNotMatch(JSON.stringify(report), /production-read-verifier-token/);
});

test('生产 MCP 全领域只读验收：允许当前身份显式授权的单个写工具但不调用它', async () => {
    const env = {
        ...verificationEnv,
        MCP_VERIFY_CLIENT_ID: 'canary-agent',
        MCP_WRITE_ENABLED: 'true',
        MCP_WRITE_CLIENT_IDS: 'canary-agent',
        MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({
            'canary-agent': ['sync_factory_knowledge'],
        }),
    };
    const client = createFakeClient({ writeTools: ['sync_factory_knowledge'] });
    const report = await runProductionReadVerification({
        client,
        env,
        costEvaluator: async () => costReport(),
    });

    assert.equal(report.toolDirectory.toolCount, 46);
    assert.equal(report.toolDirectory.readToolCount, 45);
    assert.equal(report.toolDirectory.writeToolCount, 1);
    assert.deepEqual(report.toolDirectory.writeTools, ['sync_factory_knowledge']);
    assert.equal(report.toolDirectory.hiddenWriteToolCount, 16);
    assert.deepEqual(client.calls.map(call => call.name), REPRESENTATIVE_CALL_NAMES);
});

test('生产 MCP 全领域只读验收：拒绝当前身份未授权或未知的目录工具', () => {
    const listed = writeTools => ({
        tools: [
            ...MCP_READ_ONLY_TOOL_NAMES.map(name => ({
                name,
                annotations: { readOnlyHint: true },
            })),
            ...writeTools,
        ],
    });
    const credential = { clientId: 'read-only-agent' };

    assert.throws(
        () => validateProductionToolDirectory(listed([{
            name: 'sync_factory_knowledge',
            annotations: { readOnlyHint: false },
        }]), credential, verificationEnv),
        /暴露未授权写工具/
    );
    assert.throws(
        () => validateProductionToolDirectory(listed([{
            name: 'unexpected_tool',
            annotations: { readOnlyHint: true },
        }]), credential, verificationEnv),
        /出现未知工具/
    );
});

test('生产 MCP 全领域只读验收：覆盖试算缺少 currentTotalCost 必须失败', async () => {
    const client = createFakeClient({ overrideMissingCurrentTotalCost: true });
    await assert.rejects(
        () => evaluateRepresentativeReadDomains(client, costReport()),
        /preview_recipe_cost 覆盖结果 currentTotalCost 缺失/
    );
});

test('生产 MCP 全领域只读验收：覆盖试算兼容别名不一致必须失败', async () => {
    const client = createFakeClient({ overrideUnitCost: 271.89 });
    await assert.rejects(
        () => evaluateRepresentativeReadDomains(client, costReport()),
        /兼容 unitCost 不等于 currentTotalCost/
    );
});

test('生产 MCP 全领域只读验收：配方明细存在大小写重复键必须失败', async () => {
    const client = createFakeClient({ duplicateRecipeKeys: true });
    await assert.rejects(
        () => evaluateRepresentativeReadDomains(client, costReport()),
        /get_recipe_detail 存在大小写重复键/
    );
});

test('生产 MCP 全领域只读验收：配方明细成本与正式对比口径不一致必须失败', async () => {
    const client = createFakeClient({ recipeDetailCurrentTotalCost: 271.89 });
    await assert.rejects(
        () => evaluateRepresentativeReadDomains(client, costReport()),
        /get_recipe_detail 与 compare_recipes 当前完整成本不一致/
    );
});

test('生产 MCP 全领域只读验收：无覆盖试算与正式对比口径不一致必须失败', async () => {
    const client = createFakeClient({ previewCurrentTotalCost: 271.89 });
    await assert.rejects(
        () => evaluateRepresentativeReadDomains(client, costReport()),
        /preview_recipe_cost 与 compare_recipes 当前完整成本不一致/
    );
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
