const test = require('node:test');
const assert = require('node:assert/strict');
const {
    executePartDelete,
    preparePartDelete,
    resolvePartDeleteTarget,
} = require('../api/services/aiPartExecution.cjs');

const VERSION = '2026-08-28T00:00:00.000Z';
const TARGET = Object.freeze({
    id: 145,
    model: 'MCP-GRAY-PART-A',
    supplier: 'MCP-GRAY',
    category: 'MCP灰度验收',
    price: 1.01,
    stock: 0,
    updatedAt: VERSION,
});

function preview(overrides = {}) {
    return {
        preview: true,
        capabilityId: 'parts.delete',
        normalizedInput: { partId: TARGET.id, expectedUpdatedAt: VERSION },
        target: TARGET,
        previewHash: 'a'.repeat(64),
        changes: [{ resourceType: 'part', resourceId: TARGET.id, field: 'deletedAt' }],
        warnings: [],
        ...overrides,
    };
}

function confirmationContext(overrides = {}) {
    return {
        kind: 'part_delete_target',
        partId: TARGET.id,
        model: TARGET.model,
        supplier: TARGET.supplier,
        expectedUpdatedAt: VERSION,
        preview: preview(),
        ...overrides,
    };
}

test('零件删除目标按 partId/型号/供应商唯一绑定，歧义和不一致 fail-closed', () => {
    const parts = [TARGET, { ...TARGET, id: 146, supplier: 'OTHER' }];
    assert.equal(resolvePartDeleteTarget(parts, {
        partId: TARGET.id,
        model: TARGET.model,
        supplier: TARGET.supplier,
    }).id, TARGET.id);
    assert.throws(
        () => resolvePartDeleteTarget(parts, { model: TARGET.model }),
        error => error.code === 'part_delete_target_ambiguous'
            && error.details.candidates.length === 2
    );
    for (const args of [
        { model: '不存在' },
        { partId: 999, model: TARGET.model, supplier: TARGET.supplier },
        { partId: TARGET.id, model: TARGET.model, supplier: '错误供应商' },
    ]) {
        assert.throws(
            () => resolvePartDeleteTarget(parts, args),
            error => error.code === 'part_delete_target_not_found'
        );
    }
});

test('零件删除 preflight 在目标无版本、预览不完整或带 warning 时不签发确认', async () => {
    let previewCalls = 0;
    await assert.rejects(
        preparePartDelete({ model: TARGET.model }, {
            internalFetch: () => {},
            getJson: async () => [{ ...TARGET, updatedAt: undefined }],
            postJson: async () => { previewCalls += 1; },
        }),
        error => error.code === 'part_delete_version_missing'
    );
    assert.equal(previewCalls, 0);

    for (const formalPreview of [
        preview({ previewHash: '' }),
        preview({ warnings: [{ code: 'blocked', message: '阻断' }] }),
    ]) {
        await assert.rejects(
            preparePartDelete({ model: TARGET.model, supplier: TARGET.supplier }, {
                internalFetch: () => {},
                getJson: async () => [TARGET],
                postJson: async () => formalPreview,
            }),
            error => ['part_delete_preview_incomplete', 'part_delete_preview_warning'].includes(error.code)
        );
    }
});

test('零件删除执行只消费确认冻结目标并提交版本与 previewHash', async () => {
    const calls = [];
    const result = await executePartDelete(
        { partId: 999, model: '被篡改但不应重新解析' },
        {
            internalFetch: () => {},
            confirmationContext: confirmationContext(),
            deleteJson: async (_fetch, path, _message, body) => {
                calls.push({ path, body });
                return {
                    operationId: 'operation-delete-part',
                    status: 'completed',
                    auditIds: [2613],
                    partId: TARGET.id,
                    changes: [{ resourceType: 'part', resourceId: TARGET.id, field: 'deletedAt' }],
                };
            },
            getJson: async () => [],
        }
    );
    assert.equal(result.success, true);
    assert.deepEqual(calls, [{
        path: `/api/parts/${TARGET.id}`,
        body: { expectedUpdatedAt: VERSION, previewHash: 'a'.repeat(64) },
    }]);
    assert.equal(result.readback.visible, false);
});

test('零件删除回执不完整或正式回读仍可见时拒绝声明成功且不重复 DELETE', async () => {
    for (const scenario of ['receipt', 'readback']) {
        let deleteCalls = 0;
        let readbackCalls = 0;
        await assert.rejects(
            executePartDelete({}, {
                internalFetch: () => {},
                confirmationContext: confirmationContext(),
                deleteJson: async () => {
                    deleteCalls += 1;
                    if (scenario === 'receipt') return { status: 'completed', partId: TARGET.id };
                    return {
                        operationId: 'operation-delete-part',
                        status: 'completed',
                        auditIds: [2614],
                        partId: TARGET.id,
                        changes: [{ resourceType: 'part', resourceId: TARGET.id, field: 'deletedAt' }],
                    };
                },
                getJson: async () => {
                    readbackCalls += 1;
                    return [TARGET];
                },
            }),
            error => error.code === (scenario === 'receipt'
                ? 'part_delete_receipt_missing'
                : 'part_delete_readback_mismatch')
        );
        assert.equal(deleteCalls, 1);
        assert.equal(readbackCalls, scenario === 'receipt' ? 0 : 1);
    }
});
