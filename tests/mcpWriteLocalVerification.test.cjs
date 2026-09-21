const assert = require('node:assert/strict');
const test = require('node:test');

const {
    MCP_POTENTIALLY_DESTRUCTIVE_TOOL_NAMES,
    MCP_WRITE_TOOL_NAMES,
    listMcpTools,
} = require('../api/mcp/catalog.cjs');
const { getAiCapability } = require('../api/capabilities/registry.cjs');
const { validateAiToolArgs } = require('../api/services/aiToolInputValidatorV2.cjs');
const {
    executeMcpWriteTool,
    resetMcpWriteFlowsForTests,
    verifyMcpRequestState,
} = require('../api/mcp/write.cjs');
const {
    MCP_PREVIOUSLY_ACCEPTED_WRITE_TOOL_NAMES,
    MCP_BATCH_WRITE_SCENARIOS,
    MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES,
    MCP_WRITE_ACCEPTANCE_CASES,
    acceptanceTestFiles,
} = require('../scripts/mcp-write-acceptance-manifest.cjs');

const ACTOR = 'mcp:local-write-acceptance:test-fingerprint';
const CLIENT_ID = 'local-write-acceptance';
const SCOPES = Object.freeze(['mcp:read', 'mcp:write']);

function context({ requestState, inputResponses } = {}) {
    return {
        mcpReq: {
            method: 'tools/call',
            requestState: () => requestState,
            inputResponses,
        },
        http: { authInfo: { actor: ACTOR, clientId: CLIENT_ID } },
    };
}

function prepareResult(name, args, sequence) {
    const suffix = String(sequence).padStart(12, '0');
    return {
        success: true,
        requiresConfirmation: true,
        confirmation: {
            capabilityId: getAiCapability(name).capabilityId,
            riskLevel: 'high',
            confirmationToken: `local-confirmation-${name}-${suffix}`,
            operationId: `11111111-1111-4111-8111-${suffix}`,
            argsHash: String(sequence % 10).repeat(64),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            toolName: name,
            args,
            title: name,
            summary: `准备执行 ${name}`,
            warning: '仅用于本地隔离验收。',
        },
    };
}

function receipt(name, sequence, idempotentReplay = false) {
    const capability = getAiCapability(name);
    return {
        name,
        result: {
            success: true,
            data: { localAcceptance: true },
            executionEvidence: {
                verified: true,
                kind: 'formal_api_command',
                receipts: [{ auditIds: [sequence] }],
            },
        },
        capabilityId: capability.capabilityId,
        operationId: `11111111-1111-4111-8111-${String(sequence).padStart(12, '0')}`,
        status: 'completed',
        changes: [{ type: 'local_acceptance', count: 1 }],
        warnings: [],
        auditId: sequence,
        auditIds: [sequence],
        idempotentReplay,
        completedAt: new Date().toISOString(),
    };
}

test('MCP 写工具本地验收清单与正式目录严格保持 18/18 一致', () => {
    const manifestNames = MCP_WRITE_ACCEPTANCE_CASES.map(item => item.name);
    assert.deepEqual(manifestNames, MCP_WRITE_TOOL_NAMES);
    assert.equal(new Set(manifestNames).size, 18);

    const tools = new Map(listMcpTools({ includeWrite: true }).map(tool => [tool.name, tool]));
    for (const item of MCP_WRITE_ACCEPTANCE_CASES) {
        const tool = tools.get(item.name);
        const capability = getAiCapability(item.name);
        assert.ok(tool, item.name);
        assert.equal(tool.annotations.readOnlyHint, false, item.name);
        assert.equal(
            tool.annotations.destructiveHint,
            MCP_POTENTIALLY_DESTRUCTIVE_TOOL_NAMES.includes(item.name),
            item.name
        );
        assert.equal(capability.access, 'write', item.name);
        assert.equal(capability.operation, 'command', item.name);
        assert.equal(capability.requiresConfirmation, true, item.name);
        assert.equal(capability.supportsPreview, true, item.name);
        assert.ok(Array.isArray(capability.formalCapabilityIds), item.name);
        assert.ok(capability.formalCapabilityIds.length > 0, item.name);
        assert.ok(item.businessTests.length > 0, item.name);
        assert.match(item.isolation, /in-memory|stub|temporary/i, item.name);
        assert.deepEqual(validateAiToolArgs(item.name, item.args), item.args, item.name);
    }
    assert.ok(acceptanceTestFiles().includes('tests/mcp.test.cjs'));
});

test('MCP 写工具批量验收范围精确分成既有验收基线9项和3场景候选9项', () => {
    const catalogNames = MCP_WRITE_ACCEPTANCE_CASES.map(item => item.name);
    const combined = [
        ...MCP_PREVIOUSLY_ACCEPTED_WRITE_TOOL_NAMES,
        ...MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES,
    ];
    assert.equal(MCP_PREVIOUSLY_ACCEPTED_WRITE_TOOL_NAMES.length, 9);
    assert.equal(MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES.length, 9);
    assert.equal(MCP_BATCH_WRITE_SCENARIOS.length, 3);
    assert.equal(new Set(combined).size, 18);
    assert.deepEqual(new Set(combined), new Set(catalogNames));
    assert.deepEqual(
        MCP_BATCH_WRITE_SCENARIOS.flatMap(scenario => scenario.tools),
        MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES
    );
    assert.deepEqual(
        MCP_BATCH_WRITE_SCENARIOS.map(scenario => scenario.id),
        ['order_and_workflow', 'file_archive', 'rotor_output']
    );
    assert.match(
        MCP_BATCH_WRITE_SCENARIOS.find(scenario => scenario.id === 'rotor_output')
            .productionBoundary,
        /physical printing is not an MCP capability/
    );
});

for (const [index, item] of MCP_WRITE_ACCEPTANCE_CASES.entries()) {
    test(`MCP 写工具本地验收：${item.name} 完成预览、绑定确认、执行、重放和拒绝`, async () => {
        resetMcpWriteFlowsForTests();
        const sequence = index + 1;
        const prepared = [];
        const executions = [];
        const options = {
            actor: ACTOR,
            clientId: CLIENT_ID,
            scopes: SCOPES,
            writeTools: [item.name],
            executeToolCall: async (name, args, callOptions) => {
                prepared.push({ name, args, callOptions });
                return prepareResult(name, args, sequence);
            },
            executeConfirmedAiTool: async input => {
                executions.push(input);
                return receipt(item.name, sequence, executions.length > 1);
            },
        };

        const unauthorized = await executeMcpWriteTool(
            item.name,
            item.args,
            context(),
            { ...options, scopes: ['mcp:read'] }
        );
        assert.equal(unauthorized.isError, true);
        assert.equal(unauthorized.structuredContent.code, 'mcp_write_scope_required');

        const unauthorizedTool = await executeMcpWriteTool(
            item.name,
            item.args,
            context(),
            { ...options, writeTools: [] }
        );
        assert.equal(unauthorizedTool.isError, true);
        assert.equal(unauthorizedTool.structuredContent.code, 'mcp_write_tool_not_allowed');

        const preview = await executeMcpWriteTool(item.name, item.args, context(), options);
        assert.equal(preview.resultType, 'input_required');
        assert.match(preview.requestState, /^v1\./);
        assert.equal(prepared.length, 1);
        assert.equal(prepared[0].callOptions.allowWrite, false);
        assert.equal(prepared[0].callOptions.confirmationSubject, ACTOR);

        const state = await verifyMcpRequestState(preview.requestState, context());
        assert.equal(state.toolName, item.name);
        const changedArgs = { ...item.args, __tampered: true };
        const mismatch = await executeMcpWriteTool(
            item.name,
            changedArgs,
            context({
                requestState: state,
                inputResponses: { confirmation: { action: 'accept', content: { confirm: true } } },
            }),
            options
        );
        assert.equal(mismatch.isError, true);
        assert.equal(mismatch.structuredContent.code, 'mcp_write_confirmation_mismatch');
        assert.equal(executions.length, 0);

        const acceptedContext = context({
            requestState: state,
            inputResponses: { confirmation: { action: 'accept', content: { confirm: true } } },
        });
        const executed = await executeMcpWriteTool(item.name, item.args, acceptedContext, options);
        assert.equal(executed.isError, undefined);
        assert.equal(executed.structuredContent.success, true);
        assert.equal(executed.structuredContent.data.status, 'completed');
        assert.equal(executed.structuredContent.mcp.verified, true);
        assert.equal(executions.length, 1);
        assert.equal(executions[0].expectedToolName, item.name);
        assert.deepEqual(executions[0].expectedArgs, item.args);

        const replayed = await executeMcpWriteTool(item.name, item.args, acceptedContext, options);
        assert.equal(replayed.structuredContent.data.idempotentReplay, true);
        assert.equal(executions.length, 2);

        const declinePreview = await executeMcpWriteTool(item.name, item.args, context(), options);
        const declineState = await verifyMcpRequestState(declinePreview.requestState, context());
        const declined = await executeMcpWriteTool(
            item.name,
            item.args,
            context({
                requestState: declineState,
                inputResponses: { confirmation: { action: 'decline' } },
            }),
            options
        );
        assert.equal(declined.isError, undefined);
        assert.equal(declined.structuredContent.code, 'mcp_write_declined');
        assert.equal(executions.length, 2);

        const declinedReplay = await executeMcpWriteTool(
            item.name,
            item.args,
            context({
                requestState: declineState,
                inputResponses: { confirmation: { action: 'accept', content: { confirm: true } } },
            }),
            options
        );
        assert.equal(declinedReplay.isError, true);
        assert.equal(declinedReplay.structuredContent.code, 'mcp_write_confirmation_expired');

        const falsePreview = await executeMcpWriteTool(item.name, item.args, context(), options);
        const falseState = await verifyMcpRequestState(falsePreview.requestState, context());
        const notConfirmed = await executeMcpWriteTool(
            item.name,
            item.args,
            context({
                requestState: falseState,
                inputResponses: { confirmation: { action: 'accept', content: { confirm: false } } },
            }),
            options
        );
        assert.equal(notConfirmed.isError, undefined);
        assert.equal(notConfirmed.structuredContent.code, 'mcp_write_not_confirmed');
        assert.equal(executions.length, 2);
    });
}
