'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    V5_TASK_CLASS_CATALOG,
    V5_TASK_CLASS_CATALOG_VERSION,
    buildTaskClassCatalog,
    taskClassModelView,
    validateTaskClassCatalog,
} = require('../api/services/ai-v5/taskClassCatalog.cjs');
const {
    MAX_SEGMENT_COMBINATION,
    MAX_SOURCE_SPANS,
    createV5SourceSpanCatalog,
    validateSourceSpanCatalog,
} = require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const {
    parseProtocolV2,
    projectProtocolV2ToContractV1,
    validateProtocolV2,
    V5_TASK_INTERPRETER_PROTOCOL_VERSION,
} = require('../api/services/ai-v5/taskInterpreterProtocolV2.cjs');

function catalogFixture(source = '请查询800平刀库存') {
    const sourceCatalog = createV5SourceSpanCatalog(source);
    const taskClass = V5_TASK_CLASS_CATALOG.find(item => item.domain === 'catalog'
        && item.operation === 'read_inventory' && item.entityTypes.includes('part'));
    const span = sourceCatalog.spans.find(item => item.text === '800平刀');
    return { sourceCatalog, taskClass, span };
}

function protocolFixture(source = '请查询800平刀库存') {
    const { sourceCatalog, taskClass, span } = catalogFixture(source);
    return { sourceCatalog, value: {
        protocolVersion: 2,
        taskClassRef: taskClass.classRef,
        entitySelections: [{ slotRef: taskClass.entitySlots[0].slotRef, spanRef: span.spanRef }],
        needsClarification: false,
    } };
}

test('task class catalog is stable, valid, opaque and Tool-free', () => {
    assert.equal(V5_TASK_CLASS_CATALOG_VERSION, 1);
    assert.equal(validateTaskClassCatalog(), true);
    assert.deepEqual(buildTaskClassCatalog(), V5_TASK_CLASS_CATALOG);
    assert.ok(V5_TASK_CLASS_CATALOG.every(item => /^tc_\d{3}$/.test(item.classRef)));
    const view = taskClassModelView();
    assert.equal(JSON.stringify(view).includes('search_parts'), false);
    assert.equal(JSON.stringify(view).includes('preview_recipe_cost'), false);
});

test('source span catalog contains every required exact lexical identity as a string', () => {
    for (const value of ['v750-tokoy-', 'V750-A', '800平刀', 'abc-', '-a-', 'a/b', 'a.b', 'a_b', 'a+b', '800', '"800"']) {
        const catalog = createV5SourceSpanCatalog(value);
        assert.equal(catalog.status, 'READY', value);
        assert.equal(validateSourceSpanCatalog(value, catalog), true, value);
        assert.ok(catalog.spans.some(span => span.text === value), value);
        assert.ok(catalog.spans.every(span => typeof span.text === 'string'), value);
    }
});

test('source span references and ordering are deterministic for identical input', () => {
    const input = '对比V750-A与800平刀';
    assert.deepEqual(createV5SourceSpanCatalog(input), createV5SourceSpanCatalog(input));
    assert.equal(MAX_SOURCE_SPANS, 128);
    assert.equal(MAX_SEGMENT_COMBINATION, 6);
});

test('source spans are exact source slices and never split surrogate pairs', () => {
    const source = '查😀V750-A库存';
    const catalog = createV5SourceSpanCatalog(source);
    for (const span of catalog.spans) {
        assert.equal(source.slice(span.start, span.end), span.text);
        assert.equal(/[\uD800-\uDBFF]$/.test(source.slice(0, span.start)), false);
        assert.equal(/^[\uDC00-\uDFFF]/.test(source.slice(span.end)), false);
    }
});

test('oversized source catalog fails closed instead of truncating or growing unbounded', () => {
    const catalog = createV5SourceSpanCatalog(Array.from({ length: 160 }, (_, i) => `词${i}`).join('，'));
    assert.equal(catalog.status, 'SPAN_CATALOG_LIMIT');
    assert.deepEqual(catalog.spans, []);
});

test('Protocol V2 accepts only existing task class and source span refs', () => {
    const { sourceCatalog, value } = protocolFixture();
    const parsed = validateProtocolV2(value, sourceCatalog);
    assert.equal(parsed.protocolVersion, V5_TASK_INTERPRETER_PROTOCOL_VERSION);
    assert.equal(parsed.taskClassRef, value.taskClassRef);
    assert.deepEqual(parsed.sourceSpanRefs, [value.entitySelections[0].spanRef]);
});

test('Protocol V2 rejects invalid class, span and slot refs', () => {
    const { sourceCatalog, value } = protocolFixture();
    assert.throws(() => validateProtocolV2({ ...value, taskClassRef: 'tc_DOES_NOT_EXIST' }, sourceCatalog), /INVALID_TASK_CLASS_REF/);
    assert.throws(() => validateProtocolV2({ ...value, entitySelections: [{ ...value.entitySelections[0], spanRef: 'sp_DOES_NOT_EXIST' }] }, sourceCatalog), /INVALID_SPAN_REF/);
    assert.throws(() => validateProtocolV2({ ...value, entitySelections: [{ ...value.entitySelections[0], slotRef: 'slot_DOES_NOT_EXIST' }] }, sourceCatalog), /INVALID_ENTITY_SLOT_REF/);
});

test('model cannot submit altered candidate text or any free semantic or execution field', () => {
    const { sourceCatalog, value } = protocolFixture();
    for (const extra of [
        { candidateText: 'v750-tokoy' }, { domain: 'recipe' }, { operation: 'preview_cost' },
        { entityType: 'recipe' }, { toolName: 'preview_recipe_cost' }, { capabilityId: 'recipe.cost.preview' },
    ]) assert.throws(() => validateProtocolV2({ ...value, ...extra }, sourceCatalog), /PROTOCOL_V2_SCHEMA_INVALID/);
});

test('wrong but existing class is valid protocol and is not secretly corrected', () => {
    const { sourceCatalog, value } = protocolFixture();
    const wrongClass = V5_TASK_CLASS_CATALOG.find(item => item.domain === 'coil' && item.operation === 'read');
    const wrong = { ...value, taskClassRef: wrongClass.classRef,
        entitySelections: [{ slotRef: wrongClass.entitySlots[0].slotRef, spanRef: value.entitySelections[0].spanRef }] };
    const projected = projectProtocolV2ToContractV1(validateProtocolV2(wrong, sourceCatalog));
    assert.equal(projected.domain, 'coil');
    assert.equal(projected.operation, 'read');
    assert.equal(projected.entityCandidates[0].entityType, 'coil');
});

test('Protocol V2 projects selected refs into unchanged Contract V1 and exact source text', () => {
    const source = '请查询800平刀库存';
    const { sourceCatalog, value } = protocolFixture(source);
    const projected = projectProtocolV2ToContractV1(parseProtocolV2(JSON.stringify(value), sourceCatalog));
    assert.equal(projected.version, 1);
    assert.equal(projected.entityCandidates[0].candidateText, '800平刀');
    assert.equal(typeof projected.entityCandidates[0].candidateText, 'string');
});
