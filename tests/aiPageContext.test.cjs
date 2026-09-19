const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildAiPageContextNote,
    normalizeAiPageContext,
} = require('../api/services/aiPageContext.cjs');

test('AI 页面上下文：只接受已登记的订单资源和视图', () => {
    assert.deepEqual(normalizeAiPageContext({
        resourceType: 'order',
        resourceId: 12,
        view: 'readiness',
        path: '/anything',
    }), {
        resourceType: 'order',
        resourceId: 12,
        path: '/orders',
        view: 'readiness',
    });
    assert.equal(normalizeAiPageContext({ resourceType: 'recipe', resourceId: 12 }), null);
    assert.equal(normalizeAiPageContext({ resourceType: 'order', resourceId: 0 }), null);
    assert.equal(normalizeAiPageContext({ resourceType: 'order', resourceId: 'abc' }), null);
});

test('AI 页面上下文：只生成候选指代说明，不改写用户原话或充当事实', () => {
    const note = buildAiPageContextNote({
        resourceType: 'order',
        resourceId: 12,
        view: 'requirements',
    });
    assert.match(note, /订单 #12/);
    assert.match(note, /客户要求/);
    assert.match(note, /仅用于理解/);
    assert.match(note, /不得替代工具查询/);
});
