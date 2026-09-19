const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    decorateFactoryExecutionPlanWithHistory,
    fingerprintFactoryExecutionPlan,
    listFactoryWorkflowRuns,
    recordFactoryWorkflowRun,
} = require('../api/services/factoryWorkflowHistory.cjs');

function createAccessors() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, { now: '2026-07-29T00:00:00.000Z' });
    return {
        db,
        safeInsert(table, values) {
            assert.equal(table, 'factory_workflow_runs');
            const columns = Object.keys(values);
            const placeholders = columns.map(() => '?').join(', ');
            return db.prepare(`
                INSERT INTO ${table} (${columns.join(', ')})
                VALUES (${placeholders})
            `).run(...columns.map(column => values[column]));
        },
    };
}

function quotationPlan(status = 'ready') {
    return {
        workflowType: 'quotation_to_order',
        status,
        subject: {
            type: 'quotation',
            id: 5,
            label: '报价 #5',
            path: '/quotations?quotationId=5',
        },
        metrics: { totalSteps: 1, executableSteps: 1 },
        steps: [{
            id: 'convert_quotation',
            title: '确认并将报价转为订单',
            reason: '报价已接受。',
            expectedResult: '创建唯一订单。',
            mode: 'confirmable',
            status: 'available',
            path: '/quotations?quotationId=5',
            dependsOn: [],
            canExecute: true,
            confirmation: {
                toolName: 'execute_factory_workflow_step',
                args: {
                    workflowType: 'quotation_to_order',
                    quotationId: 5,
                    actionId: 'convert_quotation',
                },
            },
        }],
    };
}

test('V8.4 执行历史：记录计划指纹、结果、复查和递增尝试次数', () => {
    const accessors = createAccessors();
    try {
        const plan = quotationPlan();
        const first = recordFactoryWorkflowRun({
            workflowType: 'quotation_to_order',
            subjectType: 'quotation',
            subjectId: 5,
            actionId: 'convert_quotation',
            toolName: 'execute_factory_workflow_step',
            status: 'failed',
            plan,
            recheck: plan,
            error: '预检失败',
            startedAt: '2026-07-29T01:00:00.000Z',
            completedAt: '2026-07-29T01:00:01.000Z',
        }, { dbAccessors: accessors });
        const second = recordFactoryWorkflowRun({
            workflowType: 'quotation_to_order',
            subjectType: 'quotation',
            subjectId: 5,
            actionId: 'convert_quotation',
            toolName: 'execute_factory_workflow_step',
            status: 'completed',
            plan,
            result: { orderId: 21 },
            recheck: { status: 'complete' },
            outcomeSummary: '已转为订单 #21',
            startedAt: '2026-07-29T01:01:00.000Z',
            completedAt: '2026-07-29T01:01:01.000Z',
        }, { dbAccessors: accessors });
        const history = listFactoryWorkflowRuns({
            workflowType: 'quotation_to_order',
            subjectId: 5,
        }, { dbAccessors: accessors });

        assert.equal(first.attemptNumber, 1);
        assert.equal(second.attemptNumber, 2);
        assert.equal(second.planFingerprint, fingerprintFactoryExecutionPlan(plan));
        assert.equal(second.result.orderId, 21);
        assert.equal(second.recheck.status, 'complete');
        assert.equal(history.metrics.completedCount, 1);
        assert.equal(history.metrics.failedCount, 1);
        assert.deepEqual(history.items.map(item => item.status), ['completed', 'failed']);
    } finally {
        accessors.db.close();
    }
});

test('V8.4 执行恢复：失败步骤仅在当前计划仍可执行时允许重试', () => {
    const accessors = createAccessors();
    try {
        const plan = quotationPlan();
        recordFactoryWorkflowRun({
            workflowType: 'quotation_to_order',
            subjectType: 'quotation',
            subjectId: 5,
            actionId: 'convert_quotation',
            toolName: 'execute_factory_workflow_step',
            status: 'failed',
            plan,
            recheck: plan,
            error: '临时错误',
        }, { dbAccessors: accessors });

        const decorated = decorateFactoryExecutionPlanWithHistory(plan, {
            dbAccessors: accessors,
        });
        assert.equal(decorated.executionHistory.latestAttempt.status, 'failed');
        assert.equal(decorated.executionHistory.recovery.state, 'retry_available');
        assert.deepEqual(
            decorated.executionHistory.recovery.recoverableActionIds,
            ['convert_quotation']
        );

        const blockedPlan = quotationPlan('needs_input');
        blockedPlan.steps[0] = {
            ...blockedPlan.steps[0],
            status: 'blocked',
            canExecute: false,
            confirmation: null,
        };
        const blocked = decorateFactoryExecutionPlanWithHistory(blockedPlan, {
            dbAccessors: accessors,
        });
        assert.equal(blocked.executionHistory.recovery.state, 'blocked');
        assert.deepEqual(blocked.executionHistory.recovery.recoverableActionIds, []);
    } finally {
        accessors.db.close();
    }
});

test('V8.4 执行恢复：同一计划版本已成功的写步骤被标记完成且不重复执行', () => {
    const accessors = createAccessors();
    try {
        const plan = quotationPlan();
        recordFactoryWorkflowRun({
            workflowType: 'quotation_to_order',
            subjectType: 'quotation',
            subjectId: 5,
            actionId: 'convert_quotation',
            toolName: 'execute_factory_workflow_step',
            status: 'completed',
            plan,
            result: { orderId: 21 },
            recheck: { status: 'complete' },
            outcomeSummary: '已转为订单 #21',
        }, { dbAccessors: accessors });

        const decorated = decorateFactoryExecutionPlanWithHistory(plan, {
            dbAccessors: accessors,
        });
        assert.equal(decorated.status, 'complete');
        assert.equal(decorated.steps[0].status, 'complete');
        assert.equal(decorated.steps[0].canExecute, false);
        assert.equal(decorated.steps[0].confirmation, null);
        assert.equal(decorated.metrics.executableSteps, 0);
        assert.equal(decorated.executionHistory.recovery.state, 'complete');
    } finally {
        accessors.db.close();
    }
});

test('V8.4 执行历史：拒绝未知工具和缺少业务对象的记录', () => {
    const accessors = createAccessors();
    try {
        assert.throws(() => recordFactoryWorkflowRun({
            workflowType: 'quotation_to_order',
            subjectId: 5,
            actionId: 'convert_quotation',
            toolName: 'unknown',
            status: 'completed',
            plan: quotationPlan(),
        }, { dbAccessors: accessors }), /工具不在允许范围/);
        assert.throws(() => recordFactoryWorkflowRun({
            workflowType: 'quotation_to_order',
            actionId: 'convert_quotation',
            toolName: 'execute_factory_workflow_step',
            status: 'completed',
            plan: {},
        }, { dbAccessors: accessors }), /缺少业务对象/);
    } finally {
        accessors.db.close();
    }
});
