const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFactoryExecutionPlan } = require('../api/services/factoryExecutionPlan.cjs');

test('V8 执行计划：订单可确认步骤只暴露受保护的订单动作执行器', () => {
    const plan = buildFactoryExecutionPlan({
        workflowType: 'order_readiness',
        orderId: 12,
    }, {
        source: {
            orderActionPlan: {
                generatedAt: '2026-07-29T00:00:00.000Z',
                order: { id: 12, customerName: '测试客户' },
                planStatus: 'ready_for_confirmation',
                summary: '订单 #12 可以继续确认。',
                steps: [{
                    id: 'confirm_order',
                    mode: 'confirmable',
                    status: 'available',
                    title: '确认订单',
                    expectedResult: '进入采购流程。',
                    evidenceCodes: ['order_not_confirmed'],
                }],
            },
        },
    });

    assert.equal(plan.status, 'ready');
    assert.equal(plan.metrics.executableSteps, 1);
    assert.equal(plan.steps[0].canExecute, true);
    assert.deepEqual(plan.steps[0].confirmation, {
        toolName: 'execute_order_readiness_action',
        args: { orderId: 12, actionId: 'confirm_order' },
    });
    assert.equal(plan.subject.label, '订单 #12 · 测试客户');
});

test('V8 执行计划：报价未接受时要求业务判断并阻塞转单', () => {
    const plan = buildFactoryExecutionPlan({
        workflowType: 'quotation_to_order',
        quotationId: 5,
    }, {
        source: {
            quotation: {
                id: 5,
                customerId: 2,
                status: '报价中',
                itemsJson: JSON.stringify([{ id: 'item-1' }]),
                convertedOrderId: null,
            },
            customerName: '菲律宾客户',
        },
    });

    assert.equal(plan.status, 'needs_input');
    assert.equal(plan.steps.find(item => item.id === 'validate_quotation').status, 'complete');
    assert.equal(plan.steps.find(item => item.id === 'accept_quotation').status, 'needs_input');
    assert.equal(plan.steps.find(item => item.id === 'convert_quotation').status, 'blocked');
    assert.equal(plan.metrics.executableSteps, 0);
});

test('V8 执行计划：已接受报价暴露受保护的跨模块执行器', () => {
    const plan = buildFactoryExecutionPlan({
        workflowType: 'quotation_to_order',
        quotationId: 6,
    }, {
        source: {
            quotation: {
                id: 6,
                customerId: 3,
                status: '已接受',
                itemsJson: JSON.stringify([{ id: 'item-1' }, { id: 'item-2' }]),
                convertedOrderId: null,
            },
            customerName: '测试客户',
        },
    });
    const conversion = plan.steps.find(item => item.id === 'convert_quotation');

    assert.equal(plan.status, 'ready');
    assert.equal(conversion.status, 'available');
    assert.equal(conversion.mode, 'confirmable');
    assert.equal(conversion.canExecute, true);
    assert.deepEqual(conversion.confirmation, {
        toolName: 'execute_factory_workflow_step',
        args: {
            workflowType: 'quotation_to_order',
            quotationId: 6,
            actionId: 'convert_quotation',
        },
    });
    assert.match(conversion.path, /quotationId=6/);
});

test('V8 执行计划：已转订单的报价直接完成并防止重复转单', () => {
    const plan = buildFactoryExecutionPlan({
        workflowType: 'quotation_to_order',
        quotationId: 7,
    }, {
        source: {
            quotation: {
                id: 7,
                customerId: 3,
                status: '已转订单',
                itemsJson: '[]',
                convertedOrderId: 88,
            },
            customerName: '测试客户',
        },
    });

    assert.equal(plan.status, 'complete');
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].status, 'complete');
    assert.match(plan.summary, /订单 #88/);
});

test('V8 执行计划：管理待办保留现有确认器且不引入负责人字段', () => {
    const plan = buildFactoryExecutionPlan({
        workflowType: 'management_action',
        actionId: 'order-readiness:12',
    }, {
        source: {
            managementCenter: {
                generatedAt: '2026-07-29T00:00:00.000Z',
                items: [{
                    id: 'order-readiness:12',
                    title: '订单 #12 待确认',
                    detail: '订单尚未确认。',
                    category: 'order_readiness',
                    sourceType: 'order_readiness',
                    resolution: {
                        mode: 'confirmable',
                        title: '确认订单',
                        expectedResult: '订单进入采购流程。',
                        path: '/orders?orderId=12&view=readiness',
                        canAiConfirm: true,
                        confirmation: {
                            toolName: 'execute_order_readiness_action',
                            args: { orderId: 12, actionId: 'confirm_order' },
                        },
                    },
                }],
            },
        },
    });

    assert.equal(plan.status, 'ready');
    assert.equal(plan.steps[0].canExecute, true);
    assert.equal(Object.hasOwn(plan.steps[0], 'owner'), false);
});

test('V8 执行计划：指定管理待办从完整集合查找而不受前三项队列限制', () => {
    const requested = {
        id: 'data-quality:supplier',
        title: '补齐供应商',
        detail: '有零件缺少供应商。',
        resolution: {
            mode: 'navigate',
            title: '补齐供应商信息',
            path: '/dashboard?view=quality',
        },
    };
    const plan = buildFactoryExecutionPlan({
        workflowType: 'management_action',
        actionId: requested.id,
    }, {
        source: {
            managementCenter: {
                items: [
                    { id: 'top-1', title: '前三事项一', resolution: { mode: 'navigate' } },
                    { id: 'top-2', title: '前三事项二', resolution: { mode: 'navigate' } },
                    { id: 'top-3', title: '前三事项三', resolution: { mode: 'navigate' } },
                    requested,
                ],
                executionQueue: {
                    items: [
                        { id: 'top-1', title: '前三事项一', resolution: { mode: 'navigate' } },
                        { id: 'top-2', title: '前三事项二', resolution: { mode: 'navigate' } },
                        { id: 'top-3', title: '前三事项三', resolution: { mode: 'navigate' } },
                    ],
                },
            },
        },
    });

    assert.equal(plan.status, 'action_required');
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].id, requested.id);
});

test('V8 执行计划：拒绝未知工作流和缺失业务ID', () => {
    assert.throws(
        () => buildFactoryExecutionPlan({ workflowType: 'unknown' }, { source: {} }),
        /workflowType/
    );
    assert.throws(
        () => buildFactoryExecutionPlan({ workflowType: 'order_readiness' }, { source: {} }),
        /orderId/
    );
});
