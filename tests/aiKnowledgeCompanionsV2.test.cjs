const test = require('node:test');
const assert = require('node:assert/strict');
const { getAiCapability } = require('../api/capabilities/registry.cjs');
const {
    getKnowledgeCompanionCall,
} = require('../api/services/aiKnowledgeCompanionsV2.cjs');

test('关联知识编排：单订单查询从能力注册表自动派生同目标知识包', () => {
    for (const source of [
        'get_order_detail',
        'check_order_readiness',
        'plan_order_readiness_actions',
    ]) {
        const capability = getAiCapability(source);
        assert.deepEqual(capability.knowledgeCompanion, {
            capabilityName: 'get_order_knowledge_package',
            argumentProjection: 'order_target',
        });
        assert.deepEqual(getKnowledgeCompanionCall(source, { orderQuery: '台州叶总' }), {
            sourceCapabilityName: source,
            capabilityName: 'get_order_knowledge_package',
            args: { orderQuery: '台州叶总' },
        });
    }
});

test('关联知识编排：无对应知识包的列表查询和缺少实体目标时不追加调用', () => {
    assert.equal(getKnowledgeCompanionCall('get_recent_orders', { status: '采购中' }, {
        count: 1,
        data: [{ id: 2 }],
    }), null);
    assert.equal(getKnowledgeCompanionCall('get_recent_orders', { customerName: '叶' }, {
        count: 2,
        data: [{ id: 2 }, { id: 3 }],
    }), null);
    assert.equal(getKnowledgeCompanionCall('get_order_detail', {}), null);
});

test('关联知识编排：具名订单列表模糊筛选唯一命中时按正式结果ID读取知识包', () => {
    assert.deepEqual(getKnowledgeCompanionCall('get_recent_orders', {
        customerName: '叶',
    }, {
        count: 1,
        data: [{ id: 2, customer: '台州叶总' }],
    }), {
        sourceCapabilityName: 'get_recent_orders',
        capabilityName: 'get_order_knowledge_package',
        args: { orderId: 2 },
    });
});
