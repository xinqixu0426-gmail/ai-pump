const crypto = require('node:crypto');
const {
    acceptedContent,
    createRequestStateCodec,
    inputRequired,
    inputResponse,
} = require('@modelcontextprotocol/server');
const { getAiCapability } = require('../capabilities/registry.cjs');
const { executeToolCall } = require('../routes/ai/executor.cjs');
const { executeConfirmedAiTool } = require('../services/aiConfirmedToolExecution.cjs');
const { argsHash } = require('../services/aiToolConfirmation.cjs');
const { getMcpMaxResultBytes } = require('../services/environment.cjs');

const MAX_PENDING_WRITE_FLOWS = 2000;
const pendingWriteFlows = new Map();
const requestStateCodec = createRequestStateCodec({
    key: crypto.randomBytes(32),
    ttlSeconds: 15 * 60,
    bind: ctx => [
        ctx.mcpReq.method,
        ctx.http?.authInfo?.actor || ctx.http?.authInfo?.clientId || '',
    ].join('\0'),
});

const confirmationSchema = Object.freeze({
    type: 'object',
    properties: {
        confirm: {
            type: 'boolean',
            title: '确认执行',
            description: '仅在人工核对预览内容并同意执行后选择 true',
        },
    },
    required: ['confirm'],
    additionalProperties: false,
});

function mcpResult(payload, { isError = false } = {}) {
    return {
        ...(isError ? { isError: true } : {}),
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload,
    };
}

function writeError(code, message) {
    return mcpResult({ success: false, code, error: message }, { isError: true });
}

function boundedMcpResult(payload, options) {
    const maxResultBytes = options.maxResultBytes
        || getMcpMaxResultBytes(options.env || process.env);
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > maxResultBytes) {
        return mcpResult({
            success: true,
            data: {
                name: payload.data.name,
                capabilityId: payload.data.capabilityId,
                operationId: payload.data.operationId,
                confirmationOperationId: payload.data.confirmationOperationId,
                formalCapabilityIds: payload.data.formalCapabilityIds,
                formalOperationIds: payload.data.formalOperationIds,
                status: payload.data.status,
                auditId: payload.data.auditId,
                auditIds: payload.data.auditIds,
                idempotentReplay: payload.data.idempotentReplay,
                completedAt: payload.data.completedAt,
                resultTruncated: true,
            },
            mcp: payload.mcp,
        });
    }
    return mcpResult(payload);
}

function cleanupPendingWriteFlows(now = Date.now()) {
    for (const [flowId, flow] of pendingWriteFlows) {
        if (flow.expiresAtMs < now) pendingWriteFlows.delete(flowId);
    }
    while (pendingWriteFlows.size >= MAX_PENDING_WRITE_FLOWS) {
        const oldest = pendingWriteFlows.keys().next().value;
        if (!oldest) break;
        pendingWriteFlows.delete(oldest);
    }
}

function confirmationMessage(confirmation) {
    const rows = Array.isArray(confirmation.rows)
        ? confirmation.rows
            .slice(0, 20)
            .map(row => `${row.label || row.key || '项目'}：${String(row.value ?? '')}`)
            .join('\n')
        : '';
    return [
        confirmation.summary || `准备执行 ${confirmation.title || confirmation.toolName}`,
        rows,
        confirmation.warning || '请核对内容无误后再确认。',
        `操作号：${confirmation.operationId}`,
        `确认有效期至：${confirmation.expiresAt}`,
    ].filter(Boolean).join('\n');
}

async function startWriteFlow(name, args, ctx, options) {
    const prepare = options.executeToolCall || executeToolCall;
    const result = await prepare(name, args || {}, {
        allowWrite: false,
        caller: `mcp:${options.clientId || 'unknown'}`,
        confirmationSubject: options.actor,
    });
    if (!result?.requiresConfirmation || !result.confirmation?.confirmationToken) {
        return writeError(
            result?.code || 'mcp_write_preview_failed',
            result?.error || '正式 Preview 未签发可确认的写操作凭证'
        );
    }

    cleanupPendingWriteFlows();
    const flowId = crypto.randomUUID();
    const confirmation = result.confirmation;
    const expiresAtMs = Date.parse(confirmation.expiresAt);
    pendingWriteFlows.set(flowId, {
        actor: options.actor,
        confirmationArgs: confirmation.args || args || {},
        confirmationArgsHash: confirmation.argsHash,
        confirmationToken: confirmation.confirmationToken,
        expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + (5 * 60 * 1000),
        toolName: name,
    });
    const requestState = await requestStateCodec.mint({
        version: 1,
        kind: 'pump_mcp_write_confirmation',
        flowId,
        toolName: name,
        requestArgsHash: argsHash(args || {}),
    }, ctx);

    return inputRequired({
        inputRequests: {
            confirmation: inputRequired.elicit({
                message: confirmationMessage(confirmation),
                requestedSchema: confirmationSchema,
            }),
        },
        requestState,
    });
}

function publicWriteReceipt(receipt, capability) {
    const { executionEvidence, ...businessResult } = receipt.result || {};
    return {
        success: true,
        data: {
            ...receipt,
            result: businessResult,
        },
        mcp: {
            capabilityId: capability.capabilityId,
            operation: capability.operation,
            sourceOfTruth: capability.sourceOfTruth,
            dataMode: capability.dataMode,
            verified: executionEvidence?.verified === true,
            fetchedAt: new Date().toISOString(),
        },
    };
}

async function continueWriteFlow(name, args, ctx, state, options) {
    if (
        state?.version !== 1
        || state?.kind !== 'pump_mcp_write_confirmation'
        || state?.toolName !== name
        || typeof state?.flowId !== 'string'
    ) {
        return writeError('mcp_write_state_invalid', '写操作确认状态无效，请重新发起');
    }

    cleanupPendingWriteFlows();
    const flow = pendingWriteFlows.get(state.flowId);
    if (!flow || flow.expiresAtMs < Date.now()) {
        return writeError('mcp_write_confirmation_expired', '写操作确认已过期，请重新发起');
    }
    if (
        flow.actor !== options.actor
        || flow.toolName !== name
        || state.requestArgsHash !== argsHash(args || {})
    ) {
        return writeError('mcp_write_confirmation_mismatch', '写操作主体或参数与预览不一致');
    }

    const response = inputResponse(ctx.mcpReq.inputResponses, 'confirmation');
    if (response.kind !== 'elicit') {
        return writeError('mcp_write_confirmation_missing', '客户端没有返回人工确认结果');
    }
    if (response.action !== 'accept') {
        pendingWriteFlows.delete(state.flowId);
        return mcpResult({
            success: false,
            code: 'mcp_write_declined',
            error: '用户已取消写操作，未产生副作用',
        });
    }
    const accepted = acceptedContent(ctx.mcpReq.inputResponses, 'confirmation');
    if (accepted?.confirm !== true) {
        pendingWriteFlows.delete(state.flowId);
        return mcpResult({
            success: false,
            code: 'mcp_write_not_confirmed',
            error: '用户未明确同意执行，未产生副作用',
        });
    }

    const executeConfirmed = options.executeConfirmedAiTool || executeConfirmedAiTool;
    const receipt = await executeConfirmed({
        confirmationToken: flow.confirmationToken,
        subject: options.actor,
        expectedToolName: name,
        expectedArgs: flow.confirmationArgs,
        ...(options.executeToolCall ? { execute: options.executeToolCall } : {}),
        ...(options.hasVerifiedWriteExecution
            ? { verifyWriteExecution: options.hasVerifiedWriteExecution }
            : {}),
    });
    return boundedMcpResult(publicWriteReceipt(receipt, getAiCapability(name)), options);
}

async function executeMcpWriteTool(name, args, ctx, options = {}) {
    if (!options.scopes?.includes('mcp:write')) {
        return writeError('mcp_write_scope_required', '该服务身份没有 mcp:write 权限');
    }
    if (!Array.isArray(options.writeTools) || !options.writeTools.includes(name)) {
        return writeError('mcp_write_tool_not_allowed', '该服务身份未获授权使用此写工具');
    }
    try {
        const state = ctx.mcpReq.requestState();
        return state
            ? await continueWriteFlow(name, args, ctx, state, options)
            : await startWriteFlow(name, args, ctx, options);
    } catch (error) {
        return writeError(error.code || 'mcp_write_execution_failed', error.message);
    }
}

function resetMcpWriteFlowsForTests() {
    pendingWriteFlows.clear();
}

module.exports = {
    confirmationMessage,
    executeMcpWriteTool,
    resetMcpWriteFlowsForTests,
    verifyMcpRequestState: requestStateCodec.verify,
};
