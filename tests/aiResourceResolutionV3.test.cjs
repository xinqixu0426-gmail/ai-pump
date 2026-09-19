const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildResourceClarificationReply,
    normalizeToolClarification,
    resolveUniqueResource,
} = require('../api/services/aiResourceResolutionV3.cjs');

test('AI V3 资源解析：关键词多候选返回结构化澄清而不是普通失败', () => {
    const result = resolveUniqueResource([
        { id: 2, name: 'v750-tokoy', spec: '12-140' },
        { id: 4, name: 'v750-普通', spec: '普通款' },
    ], {
        entityType: 'recipe',
        query: 'V750',
        nameKeys: ['name'],
    });

    assert.equal(result.code, 'AI_RESOURCE_AMBIGUOUS');
    assert.equal(result.requiresClarification, true);
    assert.equal(result.entityType, 'recipe');
    assert.equal(result.query, 'V750');
    assert.equal(result.clarification.version, 3);
    assert.deepEqual(result.clarification.candidates.map(item => item.label), [
        'v750-tokoy',
        'v750-普通',
    ]);
    assert.match(buildResourceClarificationReply(result.clarification), /回复序号、完整名称/);
});

test('AI V3 资源解析：现有订单候选失败可统一升级为澄清协议', () => {
    const clarification = normalizeToolClarification('get_order_detail', {
        success: false,
        error: '匹配到 2 个订单',
        candidates: [
            { id: 1, customerName: '客户甲', contractNo: 'HT-001', status: '采购中' },
            { id: 2, customerName: '客户甲', contractNo: 'HT-002', status: '待确认' },
        ],
    });

    assert.equal(clarification.entityType, 'order');
    assert.deepEqual(clarification.candidates.map(item => item.label), [
        'HT-001 · 客户甲',
        'HT-002 · 客户甲',
    ]);
});
