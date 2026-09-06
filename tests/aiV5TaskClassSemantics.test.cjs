'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { listV5Capabilities } = require('../api/services/ai-v5/capabilityRegistry.cjs');
const {
    V5_TASK_CLASS_CATALOG,
    V5_TASK_CLASS_CATALOG_VERSION,
    V5_TASK_CLASS_SEMANTICS_VERSION,
    buildTaskClassCatalog,
    taskClassModelView,
    validateTaskClassCatalog,
} = require('../api/services/ai-v5/taskClassCatalog.cjs');
const {
    buildTaskClassSemanticView,
    discoverLocalAlternatives,
    validateTaskClassSemanticView,
} = require('../api/services/ai-v5/taskClassSemantics.cjs');

const FROZEN_CLASS_IDENTITY_HASH = '0149514aca7bbca5124ad069d6925e113209cb8c85f7f82cc7e9840d3b18ef02';

function identitySnapshot(catalog = V5_TASK_CLASS_CATALOG) {
    return catalog.map(item => ({
        classRef: item.classRef,
        domain: item.domain,
        operation: item.operation,
        entityTypes: item.entityTypes,
    }));
}

function hash(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

test('part semantic split appends one class and preserves 27 routing identities', () => {
    assert.equal(V5_TASK_CLASS_CATALOG_VERSION, 1);
    assert.equal(V5_TASK_CLASS_SEMANTICS_VERSION, '1.1');
    assert.equal(V5_TASK_CLASS_CATALOG.length, 28);
    assert.equal(hash(identitySnapshot(V5_TASK_CLASS_CATALOG.slice(0, 27))), FROZEN_CLASS_IDENTITY_HASH);
    assert.equal(validateTaskClassCatalog(), true);
    assert.deepEqual(buildTaskClassCatalog(), V5_TASK_CLASS_CATALOG);
});

test('every class has a compact primary meaning and valid deterministic local alternatives', () => {
    const semanticView = buildTaskClassSemanticView(V5_TASK_CLASS_CATALOG);
    assert.equal(validateTaskClassSemanticView(V5_TASK_CLASS_CATALOG, semanticView), true);
    assert.deepEqual(semanticView, buildTaskClassSemanticView(V5_TASK_CLASS_CATALOG));
    for (const item of semanticView) {
        assert.ok(item.primaryMeaning.length > 20, item.classRef);
        assert.equal(item.localAlternatives.some(value => value.classRef === item.classRef), false);
        assert.equal(new Set(item.localAlternatives.map(value => value.classRef)).size, item.localAlternatives.length);
    }
});

test('local sibling discovery is structural rather than a hard-coded class pair', () => {
    const coilCost = V5_TASK_CLASS_CATALOG.find(item => item.domain === 'coil' && item.operation === 'cost');
    const coilRead = V5_TASK_CLASS_CATALOG.find(item => item.domain === 'coil' && item.operation === 'read');
    const orderRead = V5_TASK_CLASS_CATALOG.find(item => item.domain === 'order' && item.operation === 'read');
    const orderReadiness = V5_TASK_CLASS_CATALOG.find(item => item.domain === 'order' && item.operation === 'read_readiness');
    assert.ok(discoverLocalAlternatives(coilCost, V5_TASK_CLASS_CATALOG).some(item => item.classRef === coilRead.classRef));
    assert.ok(discoverLocalAlternatives(coilRead, V5_TASK_CLASS_CATALOG).some(item => item.classRef === coilCost.classRef));
    assert.ok(discoverLocalAlternatives(orderRead, V5_TASK_CLASS_CATALOG).some(item => item.classRef === orderReadiness.classRef));
});

test('model-facing coil read and cost meanings express distinct result types', () => {
    const view = taskClassModelView();
    const coilCost = view.find(item => item.classRef === 'tc_003');
    const coilRead = view.find(item => item.classRef === 'tc_004');
    assert.match(coilCost.primaryMeaning, /monetary/i);
    assert.match(coilCost.primaryMeaning, /cost/i);
    assert.match(coilRead.primaryMeaning, /non-monetary/i);
    assert.match(coilRead.primaryMeaning, /factual state/i);
    assert.ok(coilCost.localAlternatives.some(item => item.classRef === coilRead.classRef && /non-monetary/i.test(item.useWhen)));
    assert.ok(coilRead.localAlternatives.some(item => item.classRef === coilCost.classRef && /monetary/i.test(item.useWhen)));
});

test('model-facing semantics expose neither Tool names nor frozen evaluation examples', () => {
    const serialized = JSON.stringify(taskClassModelView());
    const toolNames = listV5Capabilities().flatMap(item => item.allowedTools);
    assert.equal(toolNames.some(name => serialized.includes(name)), false);
    for (const forbidden of ['P06-', 'v750-tokoy-', '800平刀']) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
    }
});
