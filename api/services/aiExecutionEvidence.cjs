function normalizedAuditIds(value = {}) {
    const ids = [
        ...(Array.isArray(value.auditIds) ? value.auditIds : []),
        value.auditId,
    ].filter(id => id !== undefined && id !== null && id !== '');
    return [...new Set(ids.map(String))];
}

function commandReceiptFrom(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidates = [
        value,
        value.receipt,
        value.operation,
        value.data,
    ].filter(candidate => candidate && typeof candidate === 'object' && !Array.isArray(candidate));
    for (const candidate of candidates) {
        const auditIds = normalizedAuditIds(candidate);
        const operationStatus = candidate.operationStatus || candidate.status;
        if (
            typeof candidate.operationId === 'string'
            && candidate.operationId.trim()
            && typeof candidate.capabilityId === 'string'
            && candidate.capabilityId.trim()
            && operationStatus === 'completed'
            && auditIds.length > 0
        ) {
            return {
                operationId: candidate.operationId,
                capabilityId: candidate.capabilityId,
                status: operationStatus,
                auditIds,
                completedAt: candidate.completedAt || null,
                idempotentReplay: Boolean(candidate.idempotentReplay),
            };
        }
    }
    return null;
}

function apiCallEvidence(trace = []) {
    return trace.map(item => ({
        method: item.method,
        path: item.path,
        ok: item.ok !== false,
        outcome: item.outcome === 'not_found' ? 'not_found' : null,
        receipt: commandReceiptFrom(item.result),
    }));
}

function buildReadExecutionEvidence(trace = []) {
    const calls = apiCallEvidence(trace);
    if (calls.length === 0 || calls.some(call => !call.ok)) {
        return {
            verified: false,
            code: 'ai_read_evidence_missing',
            error: '业务查询没有取得本轮正式 API 结果，不能生成业务事实。',
        };
    }
    return {
        verified: true,
        kind: 'formal_api_query',
        calls: calls.map(call => ({
            method: call.method,
            path: call.path,
        })),
    };
}

function buildReadFailureEvidence(trace = []) {
    const calls = apiCallEvidence(trace);
    if (
        calls.length === 0
        || calls.some(call => !call.ok && call.outcome !== 'not_found')
    ) {
        return {
            verified: false,
            code: 'ai_read_evidence_missing',
            error: '业务查询未完成本轮正式 API 调用，不能生成业务事实。',
        };
    }
    return {
        verified: true,
        kind: 'formal_api_query_failure',
        calls: calls.map(call => ({
            method: call.method,
            path: call.path,
            ...(call.outcome ? { outcome: call.outcome } : {}),
        })),
    };
}

function buildWriteExecutionEvidence(capability, trace = []) {
    const formalCapabilityIds = new Set(capability?.formalCapabilityIds || []);
    const calls = apiCallEvidence(trace);
    const receipts = calls
        .map(call => call.receipt)
        .filter(Boolean);
    const matchingReceipts = receipts.filter(receipt => (
        formalCapabilityIds.has(receipt.capabilityId)
    ));
    if (matchingReceipts.length === 0) {
        return {
            verified: false,
            code: 'ai_write_evidence_missing',
            error: '正式业务 API 未返回与当前能力匹配的 operation/audit 回执，不能声明执行成功。',
            expectedCapabilityIds: [...formalCapabilityIds],
        };
    }
    return {
        verified: true,
        kind: 'formal_api_command',
        receipts: matchingReceipts,
        calls: calls.map(call => ({
            method: call.method,
            path: call.path,
            capabilityId: call.receipt?.capabilityId || null,
            operationId: call.receipt?.operationId || null,
        })),
    };
}

function attachVerifiedExecutionEvidence(capability, result, trace = []) {
    if (!result || result.requiresConfirmation) return result;
    if (result.success === false) {
        return attachVerifiedFailureEvidence(capability, result, trace);
    }
    const evidence = capability?.access === 'write'
        ? buildWriteExecutionEvidence(capability, trace)
        : buildReadExecutionEvidence(trace);
    if (!evidence.verified) {
        return {
            success: false,
            code: evidence.code,
            error: evidence.error,
            evidence,
        };
    }
    return {
        ...result,
        executionEvidence: evidence,
    };
}

function attachVerifiedFailureEvidence(capability, result, trace = []) {
    if (!result || result.success !== false || capability?.access === 'write') return result;
    const evidence = buildReadFailureEvidence(trace);
    if (!evidence.verified) return result;
    return {
        ...result,
        executionEvidence: evidence,
    };
}

function hasVerifiedWriteExecution(result) {
    return Boolean(
        result?.success !== false
        && result?.executionEvidence?.verified
        && result.executionEvidence.kind === 'formal_api_command'
        && Array.isArray(result.executionEvidence.receipts)
        && result.executionEvidence.receipts.length > 0
    );
}

function hasVerifiedExecution(result) {
    if (!result?.executionEvidence?.verified) return false;
    if (result.success === false) {
        return result.executionEvidence.kind === 'formal_api_query_failure';
    }
    return ['formal_api_query', 'formal_api_command'].includes(
        result.executionEvidence.kind
    );
}

function hasVerifiedToolEvidence(toolResults = []) {
    return (
        Array.isArray(toolResults)
        && toolResults.length > 0
        && toolResults.every(item => hasVerifiedExecution(item?.result))
    );
}

function safeMissingBusinessEvidenceReply(toolResults = []) {
    const errors = [...new Set(
        (toolResults || [])
            .map(item => String(item?.result?.error || '').trim())
            .filter(Boolean)
    )].slice(0, 3);
    const detail = errors.length > 0
        ? `\n\n${errors.map(error => `- ${error.slice(0, 200)}`).join('\n')}`
        : '';
    return `**本轮没有取得正式业务 API 的有效结果。**${detail}\n\n因此不能给出业务数据或执行成功结论；请重试。`;
}

module.exports = {
    attachVerifiedFailureEvidence,
    attachVerifiedExecutionEvidence,
    buildReadFailureEvidence,
    buildReadExecutionEvidence,
    buildWriteExecutionEvidence,
    commandReceiptFrom,
    hasVerifiedExecution,
    hasVerifiedToolEvidence,
    hasVerifiedWriteExecution,
    normalizedAuditIds,
    safeMissingBusinessEvidenceReply,
};
