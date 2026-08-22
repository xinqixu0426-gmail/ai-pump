const test = require('node:test');
const assert = require('node:assert/strict');
const { getAiCapability } = require('../api/capabilities/registry.cjs');
const {
    getKnowledgeCompanionCall,
    normalizeKnowledgeCompanionToolCalls,
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

function toolCall(name, args = {}) {
    return {
        id: `call-${name}`,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
    };
}

const previousOrderState = {
    version: 3,
    kind: 'agent_turn_state',
    resolvedEntities: [{ entityType: 'order', id: 7, name: '邱焕' }],
    capabilities: ['get_recent_orders', 'get_order_knowledge_package'],
};

test('关联知识编排：紧邻追问把等价知识包调用规范化回本轮订单事实能力', () => {
    for (const plannedCapabilityName of [
        'get_order_detail',
        'check_order_readiness',
        'plan_order_readiness_actions',
    ]) {
        const [normalized] = normalizeKnowledgeCompanionToolCalls([
            toolCall('get_order_knowledge_package'),
        ], { plannedCapabilityName, turnState: previousOrderState });
        assert.equal(normalized.function.name, plannedCapabilityName);
        assert.deepEqual(JSON.parse(normalized.function.arguments), { orderQuery: '邱焕' });
    }
});

test('关联知识编排：规划知识包时可绑定上一轮唯一正式订单', () => {
    const [normalized] = normalizeKnowledgeCompanionToolCalls([
        toolCall('get_order_knowledge_package'),
    ], {
        plannedCapabilityName: 'get_order_knowledge_package',
        turnState: previousOrderState,
    });
    assert.equal(normalized.function.name, 'get_order_knowledge_package');
    assert.deepEqual(JSON.parse(normalized.function.arguments), { orderQuery: '邱焕' });
});

test('关联知识编排：正式环境旧状态可从知识包能力和唯一客户重新解析订单', () => {
    const [normalized] = normalizeKnowledgeCompanionToolCalls([
        toolCall('get_order_knowledge_package'),
    ], {
        plannedCapabilityName: 'get_order_detail',
        turnState: {
            version: 3,
            kind: 'agent_turn_state',
            resolvedEntities: [{ entityType: 'customer', id: 1, name: '邱焕' }],
            capabilities: ['get_recent_orders', 'get_order_knowledge_package'],
        },
    });
    assert.equal(normalized.function.name, 'get_order_detail');
    assert.deepEqual(JSON.parse(normalized.function.arguments), { orderQuery: '邱焕' });
});

test('关联知识编排：列表派生、多个上一轮订单和无关工具不扩大授权', () => {
    const listSubstitution = toolCall('get_order_knowledge_package');
    const [preservedListSubstitution] = normalizeKnowledgeCompanionToolCalls([
        listSubstitution,
    ], { plannedCapabilityName: 'get_recent_orders', turnState: previousOrderState });
    assert.deepEqual(preservedListSubstitution, listSubstitution);

    const unrelated = toolCall('search_parts');
    const [preservedUnrelated] = normalizeKnowledgeCompanionToolCalls([unrelated], {
        plannedCapabilityName: 'get_order_detail',
        turnState: previousOrderState,
    });
    assert.deepEqual(preservedUnrelated, unrelated);

    const [ambiguousOrderState] = normalizeKnowledgeCompanionToolCalls([
        toolCall('get_order_detail'),
    ], {
        plannedCapabilityName: 'get_order_detail',
        turnState: {
            ...previousOrderState,
            resolvedEntities: [
                { entityType: 'order', id: 7, name: '邱焕' },
                { entityType: 'order', id: 8, name: '叶总' },
            ],
        },
    });
    assert.deepEqual(JSON.parse(ambiguousOrderState.function.arguments), {});

    const explicitTarget = toolCall('get_order_knowledge_package', { orderId: 8 });
    const [preservedExplicitTarget] = normalizeKnowledgeCompanionToolCalls([
        explicitTarget,
    ], { plannedCapabilityName: 'get_order_detail', turnState: previousOrderState });
    assert.equal(preservedExplicitTarget.function.name, 'get_order_detail');
    assert.deepEqual(JSON.parse(preservedExplicitTarget.function.arguments), { orderId: 8 });

    const [reResolvedPreviousId] = normalizeKnowledgeCompanionToolCalls([
        toolCall('get_order_detail', { orderId: 7 }),
    ], { plannedCapabilityName: 'get_order_detail', turnState: previousOrderState });
    assert.deepEqual(JSON.parse(reResolvedPreviousId.function.arguments), {
        orderQuery: '邱焕',
    });

    const [unverifiedCustomerState] = normalizeKnowledgeCompanionToolCalls([
        toolCall('get_order_detail'),
    ], {
        plannedCapabilityName: 'get_order_detail',
        turnState: {
            version: 3,
            kind: 'agent_turn_state',
            resolvedEntities: [{ entityType: 'customer', id: 1, name: '邱焕' }],
            capabilities: ['get_recent_orders'],
        },
    });
    assert.deepEqual(JSON.parse(unverifiedCustomerState.function.arguments), {});
});
