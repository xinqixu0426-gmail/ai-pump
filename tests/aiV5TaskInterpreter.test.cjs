'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    V5_TASK_INTERPRETER_PROMPT_VERSION,
    V5_TASK_INTERPRETER_VERSION,
    validateV5TaskInterpretation,
} = require('../api/services/ai-v5/taskInterpretationContract.cjs');
const {
    anchorEntityCandidate,
    anchorInterpretationEntities,
} = require('../api/services/ai-v5/sourceAnchoredEntity.cjs');
const {
    V5_INTERPRETER_RETRY_COUNT,
    interpretV5Task,
} = require('../api/services/ai-v5/taskInterpreter.cjs');

function interpretation(overrides = {}) {
    return {
        version: 1,
        domain: 'catalog',
        operation: 'read_inventory',
        entityCandidates: [{ entityType: 'part', candidateText: '800平刀' }],
        needsClarification: false,
        reasonCodes: ['INTERPRETATION_COMPLETE'],
        ...overrides,
    };
}

function fakeResponse(value, usage = null) {
    return async (messages, options) => {
        assert.equal(messages.length, 2);
        assert.equal(messages[0].role, 'system');
        assert.equal(messages[1].role, 'user');
        assert.equal(options.tools, undefined);
        return {
            content: typeof value === 'string' ? value : JSON.stringify(value),
            usage,
            provider: 'test-provider',
            model: 'test-interpreter',
        };
    };
}

test('Task Interpreter and prompt contracts are version 1 with retry zero', () => {
    assert.equal(V5_TASK_INTERPRETER_VERSION, 1);
    assert.equal(V5_TASK_INTERPRETER_PROMPT_VERSION, 1);
    assert.equal(V5_INTERPRETER_RETRY_COUNT, 0);
});

test('valid structural interpretation passes strict validation', async () => {
    const result = await interpretV5Task('请查800平刀库存', {
        selected: { provider: 'test-provider', model: 'test-interpreter' },
        modelRequest: fakeResponse(interpretation()),
    });
    assert.equal(result.status, 'VALID');
    assert.equal(result.modelCalls, 1);
    assert.equal(result.interpretation.entityCandidates[0].candidateText, '800平刀');
});

test('invalid JSON fails closed', async () => {
    const result = await interpretV5Task('fixture', {
        selected: { provider: 'test-provider', model: 'test-interpreter' },
        modelRequest: fakeResponse('{not-json'),
    });
    assert.equal(result.status, 'INVALID');
    assert.equal(result.reasonCode, 'INTERPRETATION_JSON_INVALID');
});

for (const [name, overrides, reason] of [
    ['unknown domain', { domain: 'whatever' }, 'INTERPRETATION_DOMAIN_INVALID'],
    ['unknown operation', { operation: 'something' }, 'INTERPRETATION_OPERATION_INVALID'],
    ['unknown entity type', { entityCandidates: [{ entityType: 'unknown_type', candidateText: 'fixture' }] }, 'INTERPRETATION_ENTITY_TYPE_INVALID'],
]) {
    test(`${name} fails closed`, async () => {
        const result = await interpretV5Task('fixture', {
            selected: { provider: 'test-provider', model: 'test-interpreter' },
            modelRequest: fakeResponse(interpretation(overrides)),
        });
        assert.equal(result.status, 'INVALID');
        assert.equal(result.reasonCode, reason);
    });
}

test('model Tool field is rejected by strict top-level schema', async () => {
    const result = await interpretV5Task('fixture', {
        selected: { provider: 'test-provider', model: 'test-interpreter' },
        modelRequest: fakeResponse({ ...interpretation(), toolName: 'search_parts' }),
    });
    assert.equal(result.status, 'INVALID');
    assert.equal(result.reasonCode, 'INTERPRETATION_SCHEMA_INVALID');
});

test('model error is contained without leaking its message', async () => {
    const result = await interpretV5Task('fixture', {
        selected: { provider: 'test-provider', model: 'test-interpreter' },
        modelRequest: async () => { throw new Error('P15_SECRET_MODEL_ERROR_SENTINEL'); },
    });
    assert.equal(result.status, 'ERROR');
    assert.equal(JSON.stringify(result).includes('P15_SECRET_MODEL_ERROR_SENTINEL'), false);
});

test('interpreter timeout is independent and returns a safe outcome', async () => {
    const result = await interpretV5Task('fixture', {
        selected: { provider: 'test-provider', model: 'test-interpreter' },
        modelRequest: () => new Promise(() => {}),
        timeoutMs: 10,
    });
    assert.equal(result.status, 'TIMEOUT');
    assert.equal(result.reasonCode, 'SHADOW_INTERPRETER_TIMEOUT');
});

test('source anchoring preserves punctuation, case, CJK and numeric-like strings exactly', () => {
    const values = ['v750-tokoy-', 'V750-A', '800平刀', 'abc-', '-a-', 'a/b', 'a.b', 'a_b', 'a+b', '800'];
    for (const value of values) {
        const source = `请查询【${value}】当前信息`;
        const anchored = anchorEntityCandidate(source, { entityType: 'part', candidateText: value });
        assert.equal(anchored.status, 'ANCHORED');
        assert.equal(anchored.rawMention, value);
        assert.equal(typeof anchored.rawMention, 'string');
    }
});

test('altered, absent and duplicate entity candidates fail exact source anchoring', () => {
    assert.equal(anchorEntityCandidate('查询v750-tokoy-成本', {
        entityType: 'recipe', candidateText: 'v750-tokoy',
    }).status, 'INVALID_ENTITY_REFERENCE');
    assert.equal(anchorEntityCandidate('查询其他内容', {
        entityType: 'recipe', candidateText: 'absent',
    }).status, 'INVALID_ENTITY_REFERENCE');
    assert.equal(anchorEntityCandidate('a-a和a-a', {
        entityType: 'part', candidateText: 'a-a',
    }).status, 'AMBIGUOUS_ENTITY_REFERENCE');
});

test('multiple entities are independently anchored and any failure invalidates the group', () => {
    const anchored = anchorInterpretationEntities('对比V750-A和800平刀', {
        entityCandidates: [
            { entityType: 'part', candidateText: 'V750-A' },
            { entityType: 'part', candidateText: '800平刀' },
        ],
    });
    assert.equal(anchored.valid, true);
    const failed = anchorInterpretationEntities('只包含V750-A', {
        entityCandidates: [
            { entityType: 'part', candidateText: 'V750-A' },
            { entityType: 'part', candidateText: '800平刀' },
        ],
    });
    assert.equal(failed.valid, false);
});

test('validator cannot be bypassed with a domain-operation mismatch', () => {
    assert.throws(() => validateV5TaskInterpretation(interpretation({
        domain: 'coil', operation: 'read_inventory',
    })), error => error.reasonCode === 'INTERPRETATION_DOMAIN_OPERATION_INVALID');
});
