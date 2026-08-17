const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    AI_CAPABILITY_REGISTRY,
} = require('../api/capabilities/registry.cjs');
const {
    attachVerifiedFailureEvidence,
    attachVerifiedExecutionEvidence,
    buildReadFailureEvidence,
    buildReadExecutionEvidence,
    buildWriteExecutionEvidence,
    commandReceiptFrom,
    hasVerifiedToolEvidence,
    hasVerifiedWriteExecution,
    safeMissingBusinessEvidenceReply,
} = require('../api/services/aiExecutionEvidence.cjs');

function formalReceipt(capabilityId, overrides = {}) {
    return {
        operationId: 'formal-operation-1',
        capabilityId,
        status: 'completed',
        auditIds: [701],
        ...overrides,
    };
}

test('AI 统一证据门：只读工具必须取得本轮正式 API 结果', () => {
    assert.equal(buildReadExecutionEvidence([]).verified, false);
    assert.equal(buildReadExecutionEvidence([{
        method: 'GET',
        path: '/api/parts',
        ok: false,
    }]).verified, false);
    assert.deepEqual(buildReadExecutionEvidence([{
        method: 'GET',
        path: '/api/parts',
        result: [],
    }]), {
        verified: true,
        kind: 'formal_api_query',
        calls: [{ method: 'GET', path: '/api/parts' }],
    });
});

test('AI 统一证据门：正式查询后的未找到可如实回答，API 故障不能冒充负结果', () => {
    const capability = AI_CAPABILITY_REGISTRY.search_parts;
    const verifiedNegative = attachVerifiedFailureEvidence(
        capability,
        { success: false, error: '未找到零件：A' },
        [{ method: 'GET', path: '/api/parts?keyword=A', ok: true, result: [] }]
    );
    assert.equal(verifiedNegative.executionEvidence.kind, 'formal_api_query_failure');
    assert.equal(hasVerifiedToolEvidence([
        { name: 'search_parts', result: verifiedNegative },
    ]), true);
    const returnedNegative = attachVerifiedExecutionEvidence(
        capability,
        { success: false, error: '未找到零件：A' },
        [{ method: 'GET', path: '/api/parts?keyword=A', ok: true, result: [] }]
    );
    assert.equal(returnedNegative.executionEvidence.kind, 'formal_api_query_failure');

    assert.equal(buildReadFailureEvidence([{
        method: 'GET',
        path: '/api/parts?keyword=A',
        ok: false,
    }]).verified, false);

    const formalNotFound = buildReadFailureEvidence([{
        method: 'GET',
        path: '/api/orders/999999999',
        ok: false,
        outcome: 'not_found',
    }]);
    assert.equal(formalNotFound.verified, true);
    assert.deepEqual(formalNotFound.calls, [{
        method: 'GET',
        path: '/api/orders/999999999',
        outcome: 'not_found',
    }]);
    assert.equal(buildReadExecutionEvidence([{
        method: 'GET',
        path: '/api/orders/999999999',
        ok: false,
        outcome: 'not_found',
    }]).verified, false);
});

test('AI 统一证据门：写工具只接受登记能力对应的 operation/audit 回执', () => {
    const capability = AI_CAPABILITY_REGISTRY.create_order;
    const valid = buildWriteExecutionEvidence(capability, [{
        method: 'POST',
        path: '/api/orders',
        result: formalReceipt('orders.create'),
    }]);
    assert.equal(valid.verified, true);
    assert.equal(valid.receipts[0].capabilityId, 'orders.create');

    const wrongCapability = buildWriteExecutionEvidence(capability, [{
        method: 'POST',
        path: '/api/orders',
        result: formalReceipt('parts.create'),
    }]);
    assert.equal(wrongCapability.verified, false);
    assert.equal(wrongCapability.code, 'ai_write_evidence_missing');

    const missingAudit = buildWriteExecutionEvidence(capability, [{
        method: 'POST',
        path: '/api/orders',
        result: formalReceipt('orders.create', { auditIds: [] }),
    }]);
    assert.equal(missingAudit.verified, false);
});

test('AI 统一证据门：兼容业务 status 覆盖时只认 operationStatus', () => {
    const receipt = commandReceiptFrom({
        ...formalReceipt('quality.rule_candidates.review'),
        status: 'approved',
        operationStatus: 'completed',
    });
    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.capabilityId, 'quality.rule_candidates.review');
});

test('AI 统一证据门：所有成功工具结果统一附加证据，缺证据统一降级失败', () => {
    const readCapability = AI_CAPABILITY_REGISTRY.search_parts;
    const readResult = attachVerifiedExecutionEvidence(
        readCapability,
        { success: true, parts: [] },
        [{ method: 'GET', path: '/api/parts', result: [] }]
    );
    assert.equal(readResult.executionEvidence.kind, 'formal_api_query');

    const writeCapability = AI_CAPABILITY_REGISTRY.create_order;
    const blocked = attachVerifiedExecutionEvidence(
        writeCapability,
        { success: true, order: { id: 9 } },
        [{ method: 'POST', path: '/api/orders', result: { id: 9 } }]
    );
    assert.equal(blocked.success, false);
    assert.equal(blocked.code, 'ai_write_evidence_missing');

    const verified = attachVerifiedExecutionEvidence(
        writeCapability,
        { success: true, order: { id: 9 } },
        [{
            method: 'POST',
            path: '/api/orders',
            result: formalReceipt('orders.create'),
        }]
    );
    assert.equal(hasVerifiedWriteExecution(verified), true);
});

test('AI 统一证据门：同一轮只要有一个未验证失败就不得生成业务结论', () => {
    const verified = {
        success: true,
        executionEvidence: {
            verified: true,
            kind: 'formal_api_query',
            calls: [{ method: 'GET', path: '/api/parts' }],
        },
    };
    assert.equal(hasVerifiedToolEvidence([
        { name: 'search_parts', result: verified },
        { name: 'search_orders', result: { success: false, error: 'API 失败' } },
    ]), false);
    assert.equal(hasVerifiedToolEvidence([
        { name: 'search_parts', result: verified },
    ]), true);
});

test('AI 统一证据门：失败回复只展示正式工具错误，不让模型补写结论', () => {
    const reply = safeMissingBusinessEvidenceReply([
        {
            name: 'get_recipe_technical_files',
            result: { success: false, error: '未找到配方：V1600' },
        },
    ]);
    assert.match(reply, /没有取得正式业务 API 的有效结果/);
    assert.match(reply, /未找到配方：V1600/);
    assert.match(reply, /不能给出业务数据或执行成功结论/);
});

test('AI 统一证据门：全部写工具都登记正式能力且确认路由强制验真', () => {
    const writes = Object.values(AI_CAPABILITY_REGISTRY)
        .filter(capability => capability.access === 'write');
    assert.ok(writes.length > 20);
    for (const capability of writes) {
        assert.ok(
            capability.formalCapabilityIds.length > 0,
            `${capability.toolName} 缺少正式能力映射`
        );
        assert.equal(capability.requiresConfirmation, true);
    }

    const chatRoute = fs.readFileSync(
        path.join(__dirname, '..', 'api/routes/ai/chat.cjs'),
        'utf8'
    );
    const confirmSection = chatRoute.slice(
        chatRoute.indexOf("router.post('/api/ai/confirm-tool'"),
        chatRoute.indexOf('/**\n * 通用 AI 对话处理函数')
    );
    assert.match(confirmSection, /executeConfirmedAiTool/);
    const executionService = fs.readFileSync(
        path.join(__dirname, '..', 'api/services/aiConfirmedToolExecution.cjs'),
        'utf8'
    );
    assert.match(executionService, /hasVerifiedWriteExecution/);
    assert.match(executionService, /ai_write_evidence_missing/);
    assert.match(executionService, /failAiToolConfirmation/);
});
