'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createTaskCapabilityAdapterV2 } = require('../api/services/aiTaskCapabilityAdapterV2.cjs');
const { startAiHttpRuntime } = require('./helpers/ontologyHttpRuntimeFixture.cjs');

function span(messageRef, text, quote) {
    const start = text.indexOf(quote);
    if (start < 0) throw new Error('FIXTURE_SPAN_MISSING');
    return { messageRef, start, end: start + quote.length, text: quote };
}

function userSource(fieldPath, item) {
    return { fieldPath, kind: 'USER_SPAN', sourceRef: item.messageRef, pointer: null, span: item };
}

test('N2.1/N2.2 integration: real executor and isolated formal APIs create trusted query and preview receipts', async t => {
    const runtime = await startAiHttpRuntime();
    t.after(async () => runtime.close());
    // The ontology fixture deliberately contains identity-only records.  Give
    // its temporary database the complete, formal cost snapshots required by
    // the existing current-cost path; production data is never involved.
    runtime.db.prepare(`UPDATE recipes
        SET coil_spec = '12', coil_sheets = 120, coil_material = '冷轧', coil_slot_type = '小眼'
        WHERE id = 301`).run();
    runtime.db.prepare(`UPDATE coils
        SET scheme_status = 'official', pricing_mode = 'kit', kit_price = 20, cost = 20
        WHERE id = 501`).run();
    runtime.db.prepare('UPDATE parts SET price = 10 WHERE id = 601').run();
    const messageRef = 'msg:integration:1';
    const text = '查 Shadow配方甲，12-120线圈成本，然后查不存在的零件；比较 Shadow配方甲 原样配置；如果再做300台库存够不够？';
    const session = createTaskCapabilityAdapterV2({
        taskId: crypto.randomUUID(),
        planRevision: 1,
        sourceMessages: new Map([[messageRef, text]]),
    });

    const recipes = await session.executeCapability({
        toolName: 'get_all_recipes',
        args: { keyword: 'Shadow配方甲' },
        argumentSources: [userSource('/keyword', span(messageRef, text, 'Shadow配方甲'))],
    });
    assert.equal(recipes.status, 'VERIFIED');
    assert.equal(recipes.receipt.access, 'QUERY');
    assert.equal(recipes.result.executionEvidence.verified, true);
    assert.ok(recipes.result.executionEvidence.calls.some(call => call.path.startsWith('/api/recipes')));
    const binding = session.bindSubject({
        subjectKey: 'recipe_1', mention: 'Shadow配方甲', toolName: 'get_all_recipes', receiptId: recipes.receipt.receiptId,
    });
    assert.equal(binding.resolution, 'UNIQUE');
    assert.equal(binding.selected.entityId, '301');

    const coilSpan = span(messageRef, text, '12-120');
    const preview = await session.executeCapability({
        toolName: 'calculate_coil_cost',
        args: { spec: '12', sheets: 120 },
        argumentSources: [
            userSource('/spec', coilSpan),
            userSource('/sheets', coilSpan),
        ],
    });
    assert.equal(preview.status, 'VERIFIED');
    assert.equal(preview.receipt.access, 'PREVIEW');
    assert.equal(preview.result.executionEvidence.verified, true);
    assert.ok(preview.result.executionEvidence.calls.length >= 1);

    const missing = await session.executeCapability({
        toolName: 'search_parts',
        args: { keyword: 'does-not-exist-n2-1' },
        argumentSources: [userSource('/keyword', span(messageRef, text, '不存在的零件'))],
    });
    assert.equal(missing.status, 'VERIFIED');
    const notFound = session.bindSubject({
        subjectKey: 'part_1', mention: 'does-not-exist-n2-1', toolName: 'search_parts', receiptId: missing.receipt.receiptId,
    });
    assert.equal(notFound.resolution, 'NOT_FOUND');
    assert.equal(notFound.candidateSetComplete, true);

    const comparison = await session.executeCapability({
        toolName: 'compare_recipe_scenarios',
        args: {
            recipeId: 301,
            version: 1,
            baselinePolicy: 'CURRENT_REBUILT',
            scenarios: [{ scenarioKey: 'same', label: '原样', overrides: {} }],
        },
        argumentSources: [
            { fieldPath: '/recipeId', kind: 'FORMAL_RECEIPT', sourceRef: recipes.receipt.receiptId, pointer: '/result/data/0/id', span: null },
            { fieldPath: '/version', kind: 'FORMAL_POLICY', sourceRef: 'NATIVE_BASELINE_INHERITANCE_V1', pointer: null, span: null },
            { fieldPath: '/baselinePolicy', kind: 'FORMAL_POLICY', sourceRef: 'NATIVE_BASELINE_INHERITANCE_V1', pointer: null, span: null },
            userSource('/scenarios/0/scenarioKey', span(messageRef, text, '原样')),
            userSource('/scenarios/0/label', span(messageRef, text, '原样')),
            { fieldPath: '/scenarios/0/overrides', kind: 'BASELINE_INHERITANCE', sourceRef: 'NATIVE_BASELINE_INHERITANCE_V1', pointer: null, span: null },
        ],
    });
    assert.equal(comparison.status, 'VERIFIED', JSON.stringify(comparison.result));
    assert.equal(comparison.receipt.access, 'PREVIEW');
    assert.equal(comparison.receipt.readSetId, comparison.result.data.readSetId);
    assert.equal(comparison.result.executionEvidence.verified, true);
    assert.ok(comparison.result.executionEvidence.calls.some(call => call.path.includes('scenario-compare-preview')));
    const projected = session.projectCanonicalEntities({
        toolName: 'compare_recipe_scenarios', receiptId: comparison.receipt.receiptId,
    });
    assert.equal(projected[0].entityId, '301');

    runtime.db.prepare('UPDATE parts SET stock = 500 WHERE id = 601').run();
    runtime.db.prepare('UPDATE coils SET stock = 900 WHERE id = 501').run();
    const readiness = await session.executeCapability({
        toolName: 'preview_virtual_readiness',
        args: {
            version: 1,
            basisRef: {
                kind: 'RECIPE_SCENARIO', recipeId: 301,
                comparisonInput: { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [] },
                scenarioKey: 'base',
            },
            quantity: 300,
        },
        argumentSources: [
            { fieldPath: '/version', kind: 'FORMAL_POLICY', sourceRef: 'NATIVE_BASELINE_INHERITANCE_V1', pointer: null, span: null },
            { fieldPath: '/basisRef/kind', kind: 'FORMAL_POLICY', sourceRef: 'NATIVE_BASELINE_INHERITANCE_V1', pointer: null, span: null },
            { fieldPath: '/basisRef/recipeId', kind: 'FORMAL_RECEIPT', sourceRef: recipes.receipt.receiptId, pointer: '/result/data/0/id', span: null },
            { fieldPath: '/basisRef/comparisonInput/version', kind: 'FORMAL_POLICY', sourceRef: 'NATIVE_BASELINE_INHERITANCE_V1', pointer: null, span: null },
            { fieldPath: '/basisRef/comparisonInput/baselinePolicy', kind: 'FORMAL_POLICY', sourceRef: 'NATIVE_BASELINE_INHERITANCE_V1', pointer: null, span: null },
            { fieldPath: '/basisRef/comparisonInput/scenarios', kind: 'FORMAL_POLICY', sourceRef: 'VIRTUAL_READINESS_CURRENT_BASIS_V1', pointer: null, span: null },
            { fieldPath: '/basisRef/scenarioKey', kind: 'FORMAL_POLICY', sourceRef: 'VIRTUAL_READINESS_SCENARIO_KEY_V1', pointer: null, span: null },
            userSource('/quantity', span(messageRef, text, '300台')),
        ],
    });
    assert.equal(readiness.status, 'VERIFIED', JSON.stringify(readiness.result));
    assert.equal(readiness.receipt.access, 'PREVIEW');
    assert.equal(readiness.result.data.preview, true);
    assert.equal(readiness.result.data.inventoryBasis, 'CURRENT_STOCK_AFTER_ACTIVE_ORDER_RESERVATIONS');
    assert.ok(['READY', 'SHORTAGE', 'INCOMPLETE'].includes(readiness.result.data.status));
    assert.equal(readiness.result.executionEvidence.verified, true);
    assert.ok(readiness.result.executionEvidence.calls.some(call => call.path === '/api/inventory/virtual-readiness-preview'));
    const formalCallCount = recipes.result.executionEvidence.calls.length
        + preview.result.executionEvidence.calls.length
        + missing.result.executionEvidence.calls.length
        + comparison.result.executionEvidence.calls.length
        + readiness.result.executionEvidence.calls.length;
    assert.equal(formalCallCount, 7);
});
