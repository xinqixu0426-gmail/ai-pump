'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { listV5Capabilities } = require('../api/services/ai-v5/capabilityRegistry.cjs');
const { listV5EntityTypes } = require('../api/services/ai-v5/businessOntology.cjs');
const {
    DOMAIN_SEMANTICS,
    ENTITY_TYPE_SEMANTICS,
    OPERATION_SEMANTICS,
    validateTaskInterpreterSemantics,
} = require('../api/services/ai-v5/taskInterpreterSemantics.cjs');
const {
    createV5InterpreterInputEnvelope,
    validateV5InterpreterInputEnvelope,
} = require('../api/services/ai-v5/taskInterpreterInput.cjs');
const {
    V5_INTERPRETER_MODEL_SETTINGS,
    V5_TASK_INTERPRETER_INSTRUCTION,
    requestConfiguredInterpreterModel,
} = require('../api/services/ai-v5/taskInterpreter.cjs');

test('semantic taxonomy exactly covers current capability and ontology IDs', () => {
    assert.equal(validateTaskInterpreterSemantics(), true);
    assert.deepEqual(Object.keys(DOMAIN_SEMANTICS).sort(), [...new Set(listV5Capabilities().map(x => x.domain))].sort());
    assert.deepEqual(Object.keys(OPERATION_SEMANTICS).sort(), [...new Set(listV5Capabilities().map(x => x.operation))].sort());
    assert.deepEqual(Object.keys(ENTITY_TYPE_SEMANTICS).sort(), listV5EntityTypes().map(x => x.entityType).sort());
});

test('V1.1 instruction is general, exact-copy oriented, and exposes no Tool choice', () => {
    assert.match(V5_TASK_INTERPRETER_INSTRUCTION, /character-for-character/);
    assert.match(V5_TASK_INTERPRETER_INSTRUCTION, /never emit a near match/i);
    assert.match(V5_TASK_INTERPRETER_INSTRUCTION, /Do not emit toolName/);
    for (const frozenCaseText of ['800平刀', 'v750-tokoy-']) {
        assert.equal(V5_TASK_INTERPRETER_INSTRUCTION.includes(frozenCaseText), false);
    }
});

test('model request sends one tool-free deterministic JSON-mode call', async () => {
    let requestBody;
    const response = await requestConfiguredInterpreterModel([], {
        selected: { provider: 'deepseek', model: 'deepseek-v4-flash', config: {
            provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-only', baseUrl: 'https://example.invalid',
        } },
        fetchImpl: async (_url, options) => {
            requestBody = JSON.parse(options.body);
            return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
                status: 200, headers: { 'content-type': 'application/json' },
            });
        },
    });
    assert.equal(response.model, 'deepseek-v4-flash');
    assert.equal(requestBody.temperature, 0);
    assert.equal('top_p' in requestBody, false);
    assert.deepEqual(requestBody.response_format, { type: 'json_object' });
    assert.equal(requestBody.max_tokens, 512);
    assert.equal('tools' in requestBody, false);
    assert.deepEqual(V5_INTERPRETER_MODEL_SETTINGS.responseFormat, { type: 'json_object' });
});

test('safe pre-routing context envelope omits business IDs and is immutable', () => {
    const source = { rawUserRequest: 'safe request', pageContext: { resourceType: 'order', resourceId: 27, view: 'readiness' } };
    const created = createV5InterpreterInputEnvelope(source);
    assert.equal(validateV5InterpreterInputEnvelope(created), true);
    assert.deepEqual(created.safePreRoutingContext, { surfaceType: 'order', view: 'readiness' });
    assert.equal(JSON.stringify(created).includes('27'), false);
    assert.equal(Object.isFrozen(created), true);
    assert.equal(Object.isFrozen(created.safePreRoutingContext), true);
    assert.equal(source.pageContext.resourceId, 27);
});

test('missing context is explicit and allowed', () => {
    const created = createV5InterpreterInputEnvelope({ rawUserRequest: 'safe request', pageContext: null });
    assert.equal(created.safePreRoutingContext, null);
    assert.match(created.inputFingerprint, /^[a-f0-9]{64}$/);
});

for (const forbidden of [
    { selectedTool: 'unsafe' },
    { resolverResult: { id: 1 } },
    { normalizedEntity: 'unsafe' },
    { businessValue: 10 },
    { rawEntityId: 99 },
]) {
    test(`input envelope rejects downstream or business field ${Object.keys(forbidden)[0]}`, () => {
        assert.throws(() => createV5InterpreterInputEnvelope({
            rawUserRequest: 'safe request', pageContext: null, ...forbidden,
        }), /V5_INTERPRETER_INPUT_SCHEMA_INVALID/);
    });
}
