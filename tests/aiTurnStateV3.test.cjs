const test = require('node:test');
const assert = require('node:assert/strict');

const {
    aiTurnStatePrompt,
    buildAiTurnStateV3,
    normalizeAiTurnStateV3,
    resolvedEntityIds,
} = require('../api/services/aiTurnStateV3.cjs');

test('AI V3 轮次状态：只保留限长的正式实体和能力引用', () => {
    const state = normalizeAiTurnStateV3({
        version: 3,
        kind: 'agent_turn_state',
        resolvedEntities: [{
            entityType: 'order',
            id: 1,
            name: '邱焕',
            originalMention: '邱欢',
            confidence: 0.625,
            resolutionStatus: 'unique_candidate',
            ignored: 'unsafe',
        }],
        capabilities: ['get_order_detail', 'get_order_detail'],
        unexpected: 'ignored',
    });

    assert.deepEqual(state.resolvedEntities, [{
        entityType: 'order',
        id: 1,
        name: '邱焕',
        originalMention: '邱欢',
        confidence: 0.625,
        resolutionStatus: 'unique_candidate',
    }]);
    assert.deepEqual(state.capabilities, ['get_order_detail']);
    assert.deepEqual([...resolvedEntityIds(state, 'order')], [1]);
    assert.match(aiTurnStatePrompt(state), /邱焕/);
});

test('AI V3 轮次状态：由安全解析回执生成并在紧邻追问中延续', () => {
    const state = buildAiTurnStateV3([{
        name: 'get_order_detail',
        result: {
            success: true,
            resolutionReceipt: {
                version: 3,
                kind: 'entity_resolution',
                entityType: 'order',
                originalMention: '邱欢',
                status: 'unique_candidate',
                selected: { id: 1, name: '邱焕', score: 0.625, raw: { secret: true } },
            },
        },
    }]);
    assert.deepEqual(state.resolvedEntities, [{
        entityType: 'order',
        id: 1,
        name: '邱焕',
        originalMention: '邱欢',
        confidence: 0.625,
        resolutionStatus: 'unique_candidate',
    }]);
    assert.deepEqual(state.capabilities, ['get_order_detail']);

    const continued = buildAiTurnStateV3([{
        name: 'get_order_knowledge_package',
        result: { success: true },
    }], state);
    assert.deepEqual(continued.resolvedEntities, state.resolvedEntities);
    assert.deepEqual(continued.capabilities, [
        'get_order_detail',
        'get_order_knowledge_package',
    ]);
});

test('AI V3 轮次状态：无正式实体或能力时拒绝建立状态', () => {
    assert.equal(normalizeAiTurnStateV3({ version: 3, kind: 'agent_turn_state' }), null);
    assert.equal(normalizeAiTurnStateV3({ version: 2, kind: 'agent_turn_state' }), null);
});
