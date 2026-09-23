'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
    MAX_RECEIPT_RESULT_BYTES,
    buildCapabilityDescriptorV2,
    createTaskCapabilityAdapterV2,
    readJsonPointer,
} = require('../api/services/aiTaskCapabilityAdapterV2.cjs');

const taskId = () => crypto.randomUUID();
const message = 'V550 电缆改成5米';
const span = { messageRef: 'msg-1', start: 9, end: 10, text: '5' };
const source = (fieldPath, kind, sourceRef, pointer = null, sourceSpan = null) => ({
    fieldPath, kind, sourceRef, pointer, span: sourceSpan,
});
const verified = result => ({ success: true, ...result, executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/test' }] } });
const fakeExecutor = async (toolName, args) => {
    if (toolName === 'get_all_recipes') return verified({
        count: 1, queryReceipt: { authoritative: true, truncated: false, possiblyTruncated: false },
        data: [{ id: 13, name: 'V550', updatedAt: '2026-09-22T00:00:00.000Z' }],
    });
    if (toolName === 'search_coils') return verified({
        count: 2, queryReceipt: { authoritative: true, truncated: false, possiblyTruncated: false },
        data: [{ id: 21, schemeName: '12-200 A', schemeCode: 'A' }, { id: 22, schemeName: '12-200 B', schemeCode: 'B' }],
    });
    if (toolName === 'search_parts') return verified({
        count: 0, queryReceipt: { authoritative: true, truncated: false, possiblyTruncated: false }, parts: [],
    });
    if (toolName === 'preview_recipe_cost') return verified({ data: { recipeId: args.recipeId, recipeName: 'V550' } });
    return { success: false, code: 'FAKE_FAILURE', error: 'formal failure' };
};

function adapter(options = {}) {
    return createTaskCapabilityAdapterV2({
        taskId: taskId(), planRevision: 1,
        sourceMessages: new Map([['msg-1', message]]),
        executeToolCall: fakeExecutor,
        ...options,
    });
}

test('N2.1 capability descriptor projects the existing registry without a second registry', () => {
    const query = buildCapabilityDescriptorV2('get_all_recipes');
    const preview = buildCapabilityDescriptorV2('preview_recipe_cost');
    const command = buildCapabilityDescriptorV2('adjust_part_stock');
    assert.equal(query.access, 'QUERY');
    assert.equal(preview.access, 'PREVIEW');
    assert.equal(command.access, 'COMMAND');
    assert.deepEqual(query.formalCapabilityIds, ['recipes.list']);
    assert.ok(preview.supportedOverrideFields.includes('cableLength'));
    assert.throws(() => buildCapabilityDescriptorV2('not_a_tool'), /CAPABILITY_NOT_REGISTERED/);
    assert.throws(() => buildCapabilityDescriptorV2('get_all_recipes', {
        tools: [{ function: { name: 'get_all_recipes', parameters: { type: 'object', properties: {} } } }],
        getAiCapability: () => ({ toolName: 'get_all_recipes', access: 'read', operation: 'mystery' }),
    }), /CAPABILITY_CLASSIFICATION_INVALID/);
});

test('N2.1 trusted formal receipt is generated only after an actual executor result and binds pointer values', async () => {
    const session = adapter();
    const first = await session.executeCapability({ toolName: 'get_all_recipes', args: {}, argumentSources: [] });
    assert.equal(first.status, 'VERIFIED');
    assert.match(first.receipt.receiptId, /^[0-9a-f-]{36}$/u);
    assert.equal(first.receipt.origin, 'SERVER_EXECUTOR');
    assert.equal(first.receipt.argsHash.length, 64);
    const preview = await session.executeCapability({
        toolName: 'preview_recipe_cost',
        args: { recipeId: 13, overrides: { cableLength: 5 } },
        argumentSources: [
            source('/recipeId', 'FORMAL_RECEIPT', first.receipt.receiptId, '/result/data/0/id'),
            source('/overrides/cableLength', 'USER_SPAN', 'msg-1', null, span),
        ],
    });
    assert.equal(preview.status, 'VERIFIED');
    assert.throws(() => session.validateRequest({
        toolName: 'preview_recipe_cost', args: { recipeId: 13 }, argumentSources: [
            source('/recipeId', 'FORMAL_RECEIPT', first.receipt.receiptId, '/result/data/0/name'),
        ],
    }), /FORMAL_RECEIPT_VALUE_MISMATCH/);
});

test('N2.1 rejects missing, duplicate, extra and invalid UTF-16 leaf provenance', async () => {
    const session = adapter();
    const first = await session.executeCapability({ toolName: 'get_all_recipes', args: {}, argumentSources: [] });
    const formal = source('/recipeId', 'FORMAL_RECEIPT', first.receipt.receiptId, '/result/data/0/id');
    assert.throws(() => session.validateRequest({ toolName: 'preview_recipe_cost', args: { recipeId: 13, overrides: { cableLength: 5 } }, argumentSources: [formal] }), /ARGUMENT_SOURCE_MISSING/);
    assert.throws(() => session.validateRequest({ toolName: 'preview_recipe_cost', args: { recipeId: 13 }, argumentSources: [formal, formal] }), /ARGUMENT_SOURCE_DUPLICATE/);
    assert.throws(() => session.validateRequest({ toolName: 'preview_recipe_cost', args: { recipeId: 13 }, argumentSources: [formal, source('/missing', 'FORMAL_POLICY', 'NATIVE_BASELINE_INHERITANCE_V1')] }), /ARGUMENT_SOURCE_EXTRA/);
    assert.throws(() => session.validateRequest({ toolName: 'preview_recipe_cost', args: { recipeId: 13, overrides: { cableLength: 5 } }, argumentSources: [formal, source('/overrides/cableLength', 'USER_SPAN', 'msg-1', null, { ...span, end: 12, text: '5' })] }), /SOURCE_SPAN_TEXT_MISMATCH/);
});

test('N2.1 accepts only the fixed server policy provenance identifiers', async () => {
    const session = adapter();
    const first = await session.executeCapability({ toolName: 'get_all_recipes', args: {}, argumentSources: [] });
    const recipe = source('/recipeId', 'FORMAL_RECEIPT', first.receipt.receiptId, '/result/data/0/id');
    const inherited = source('/overrides/cableLength', 'BASELINE_INHERITANCE', 'NATIVE_BASELINE_INHERITANCE_V1');
    const proposal = session.validateRequest({
        toolName: 'preview_recipe_cost', args: { recipeId: 13, overrides: { cableLength: 5 } },
        argumentSources: [recipe, inherited],
    });
    assert.equal(proposal.descriptor.access, 'PREVIEW');
    assert.throws(() => session.validateRequest({
        toolName: 'preview_recipe_cost', args: { recipeId: 13, overrides: { cableLength: 5 } },
        argumentSources: [recipe, source('/overrides/cableLength', 'FORMAL_POLICY', 'AI_DEFAULT')],
    }), /FORMAL_POLICY_UNSUPPORTED/);
});

test('N2.1 rejects forged, foreign and stale receipt provenance', async () => {
    const one = adapter({ taskId: 'task-one' });
    const two = adapter({ taskId: 'task-two' });
    const receipt = (await one.executeCapability({ toolName: 'get_all_recipes', args: {}, argumentSources: [] })).receipt;
    assert.throws(() => two.validateRequest({ toolName: 'preview_recipe_cost', args: { recipeId: 13 }, argumentSources: [source('/recipeId', 'FORMAL_RECEIPT', receipt.receiptId, '/result/data/0/id')] }), /FORMAL_RECEIPT_UNTRUSTED/);
    assert.throws(() => one.validateRequest({ toolName: 'preview_recipe_cost', args: { recipeId: 13 }, argumentSources: [source('/recipeId', 'FORMAL_RECEIPT', '00000000-0000-4000-8000-000000000000', '/result/data/0/id')] }), /FORMAL_RECEIPT_UNTRUSTED/);
    const stale = adapter({ planRevision: 2 });
    assert.throws(() => stale.validateRequest({ toolName: 'preview_recipe_cost', args: { recipeId: 13 }, argumentSources: [source('/recipeId', 'FORMAL_RECEIPT', receipt.receiptId, '/result/data/0/id')] }), /FORMAL_RECEIPT_UNTRUSTED/);
    const externallyMutableCopy = one.getTrustedReceipts();
    externallyMutableCopy.set('forged-server-origin', { receiptId: 'forged-server-origin', taskId: 'task-one', planRevision: 1, origin: 'SERVER_EXECUTOR' });
    assert.throws(() => one.getTrustedReceipt('forged-server-origin'), /FORMAL_RECEIPT_UNTRUSTED/);
});

test('N2.1 enforces override boundaries, coil snapshot dependency and forbids Task V2 commands', async () => {
    const session = adapter();
    const receipt = (await session.executeCapability({ toolName: 'get_all_recipes', args: {}, argumentSources: [] })).receipt;
    const id = source('/recipeId', 'FORMAL_RECEIPT', receipt.receiptId, '/result/data/0/id');
    assert.throws(() => session.validateRequest({ toolName: 'preview_recipe_cost', args: { recipeId: 13, overrides: { copperPrice: 95 } }, argumentSources: [id, source('/overrides/copperPrice', 'USER_SPAN', 'msg-1', null, span)] }), /INVALID_AI_TOOL_INPUT|UNSUPPORTED_OVERRIDE_FIELD/);
    assert.throws(() => session.validateRequest({ toolName: 'preview_recipe_cost', args: { recipeId: 13, overrides: { coilSheets: 200 } }, argumentSources: [id, source('/overrides/coilSheets', 'USER_SPAN', 'msg-1', null, span)] }), /COIL_SHEETS_REQUIRES_COIL_ID/);
    assert.throws(() => session.validateRequest({ toolName: 'adjust_part_stock', args: { items: [{ model: 'X', changeQty: 1 }] }, argumentSources: [] }), /TASK_V2_COMMAND_NOT_ENABLED/);
});

test('N2.1 canonical projection and completeness never select incomplete or multiple candidates', async () => {
    const session = adapter();
    const recipes = await session.executeCapability({ toolName: 'get_all_recipes', args: {}, argumentSources: [] });
    const unique = session.bindSubject({ subjectKey: 'recipe_1', mention: 'V550', toolName: 'get_all_recipes', receiptId: recipes.receipt.receiptId });
    assert.equal(unique.resolution, 'UNIQUE');
    const coils = await session.executeCapability({ toolName: 'search_coils', args: {}, argumentSources: [] });
    const multiple = session.bindSubject({ subjectKey: 'coil_1', mention: '12-200', toolName: 'search_coils', receiptId: coils.receipt.receiptId });
    assert.equal(multiple.resolution, 'MULTIPLE');
    assert.equal(multiple.selected, null);
    const parts = await session.executeCapability({ toolName: 'search_parts', args: {}, argumentSources: [] });
    const absent = session.bindSubject({ subjectKey: 'part_1', mention: 'Missing', toolName: 'search_parts', receiptId: parts.receipt.receiptId });
    assert.equal(absent.resolution, 'NOT_FOUND');
    const incomplete = adapter({ executeToolCall: async () => verified({ count: 0, queryReceipt: { authoritative: true, truncated: true, possiblyTruncated: false }, parts: [] }) });
    const incompleteReceipt = await incomplete.executeCapability({ toolName: 'search_parts', args: {}, argumentSources: [] });
    const unresolved = incomplete.bindSubject({ subjectKey: 'part_2', mention: 'Unknown', toolName: 'search_parts', receiptId: incompleteReceipt.receipt.receiptId });
    assert.equal(unresolved.resolution, 'UNRESOLVED');
    assert.equal(unresolved.candidateSetComplete, false);
    const truncatedOne = adapter({ executeToolCall: async () => verified({
        count: 1,
        queryReceipt: { authoritative: true, truncated: true, possiblyTruncated: false },
        data: [{ id: 31, schemeName: '12-200 incomplete' }],
    }) });
    const truncatedReceipt = await truncatedOne.executeCapability({ toolName: 'search_coils', args: {}, argumentSources: [] });
    const truncatedBinding = truncatedOne.bindSubject({
        subjectKey: 'coil_2', mention: '12-200', toolName: 'search_coils', receiptId: truncatedReceipt.receipt.receiptId,
    });
    assert.equal(truncatedBinding.resolution, 'UNRESOLVED');
    assert.equal(truncatedBinding.selected, null);
    assert.equal(truncatedBinding.candidateSetComplete, false);
});

test('N2.1 accepts a selected multiple candidate only through trusted user choice', async () => {
    const session = adapter({ trustedChoices: { choice_21: { value: '21' } } });
    const coils = await session.executeCapability({ toolName: 'search_coils', args: {}, argumentSources: [] });
    const selected = session.bindSubject({
        subjectKey: 'coil_1', mention: '12-200', toolName: 'search_coils', receiptId: coils.receipt.receiptId,
        choiceId: 'choice_21',
    });
    assert.equal(selected.resolution, 'SELECTED');
    assert.equal(selected.selectionBasis, 'USER_CHOICE');
    assert.equal(selected.selected.entityId, '21');
});

test('N2.1 pointer reader rejects prototype paths and distinguishes missing from null', () => {
    assert.equal(readJsonPointer({ a: { b: null } }, '/a/b'), null);
    assert.throws(() => readJsonPointer({ a: {} }, '/a/b'), /JSON_POINTER_MISSING/);
    assert.throws(() => readJsonPointer({ a: [] }, '/a/0'), /JSON_POINTER_OUT_OF_RANGE/);
    assert.throws(() => readJsonPointer({}, '/__proto__/x'), /JSON_POINTER_FORBIDDEN_TOKEN/);
});

test('N2.1 receipt hashes are canonical and failure never erases prior success', async () => {
    const session = adapter();
    const first = await session.executeCapability({ toolName: 'get_all_recipes', args: {}, argumentSources: [] });
    const again = await session.executeCapability({ toolName: 'get_all_recipes', args: {}, argumentSources: [] });
    assert.equal(first.receipt.argsHash, again.receipt.argsHash);
    assert.equal(first.receipt.sourceHash, again.receipt.sourceHash);
    const failed = await session.executeCapability({ toolName: 'get_copper_price', args: {}, argumentSources: [] });
    assert.equal(failed.status, 'UNVERIFIED_EXECUTOR_RESULT');
    assert.throws(() => session.projectCanonicalEntities({ toolName: 'get_all_recipes', receiptId: 'not-a-receipt' }), /FORMAL_RECEIPT_UNTRUSTED/);
    assert.equal(session.getTrustedReceipt(first.receipt.receiptId).receiptId, first.receipt.receiptId);
    const huge = adapter({ executeToolCall: async () => verified({ data: { payload: 'x'.repeat(MAX_RECEIPT_RESULT_BYTES) } }) });
    await assert.rejects(() => huge.executeCapability({ toolName: 'get_all_recipes', args: {}, argumentSources: [] }), /RECEIPT_RESULT_LIMIT/);
});
