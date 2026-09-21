const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    RECORD_WORKFLOW_RUN_CAPABILITY_ID,
    executeRecordFactoryWorkflowRun,
} = require('../api/services/factoryWorkflowCommands.cjs');

function createFixture() {
    const db = new Database(':memory:');
    runMigrations(db, { now: '2026-08-03T00:00:00.000Z' });

    function writeAudit(action, table, recordId, context) {
        const info = db.prepare(`
            INSERT INTO audit_log (
                action, table_name, record_id, old_value, new_value,
                user, request_id, operation_id, capability_id, created_at
            ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
        `).run(
            action,
            table,
            recordId,
            context?.user || 'system',
            context?.requestId || null,
            context?.operationId || null,
            context?.capabilityId || null,
            '2026-08-03T00:00:00.000Z'
        );
        return Number(info.lastInsertRowid);
    }

    const dependencies = {
        db,
        safeInsert(table, values, context) {
            assert.equal(table, 'factory_workflow_runs');
            const columns = Object.keys(values);
            const info = db.prepare(`
                INSERT INTO ${table} (${columns.join(', ')})
                VALUES (${columns.map(() => '?').join(', ')})
            `).run(...columns.map(column => values[column]));
            return {
                ...info,
                auditId: writeAudit(
                    'INSERT',
                    table,
                    Number(info.lastInsertRowid),
                    context
                ),
            };
        },
        hardDelete(table, id, context) {
            const info = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
            return {
                ...info,
                auditId: writeAudit('DELETE', table, id, context),
            };
        },
    };
    return { db, dependencies };
}

function commandContext(suffix) {
    return {
        capabilityId: RECORD_WORKFLOW_RUN_CAPABILITY_ID,
        actorKey: 'internal:workflow-history-test',
        idempotencyKey: `workflow-history:command:${suffix}`,
        operationId: `workflow-history-operation-${suffix}`,
        requestId: `workflow-history-request-${suffix}`,
        warnings: [],
    };
}

function runInput() {
    return {
        workflowType: 'quotation_to_order',
        subjectType: 'quotation',
        subjectId: 5,
        actionId: 'convert_quotation',
        toolName: 'execute_factory_workflow_step',
        status: 'completed',
        plan: {
            workflowType: 'quotation_to_order',
            subject: { type: 'quotation', id: 5 },
            steps: [],
        },
        result: { orderId: 21 },
        recheck: { status: 'complete' },
        outcomeSummary: '报价 #5 已转为订单 #21',
    };
}

test('执行历史命令与 operation、审计原子提交且重试不重复记录', () => {
    const fixture = createFixture();
    try {
        const input = runInput();
        const context = commandContext('record');
        const result = executeRecordFactoryWorkflowRun(
            fixture.dependencies,
            input,
            context
        );
        assert.equal(
            result.capabilityId,
            RECORD_WORKFLOW_RUN_CAPABILITY_ID
        );
        assert.equal(result.executionRun.attemptNumber, 1);
        assert.equal(result.executionRun.result.orderId, 21);
        assert.equal(result.auditIds.length, 1);

        const replay = executeRecordFactoryWorkflowRun(
            fixture.dependencies,
            input,
            context
        );
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.executionRun.id, result.executionRun.id);
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) AS count FROM factory_workflow_runs'
            ).get().count,
            1
        );
        assert.equal(
            fixture.db.prepare(
                "SELECT COUNT(*) AS count FROM audit_log WHERE table_name = 'factory_workflow_runs'"
            ).get().count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('执行历史缺少强审计时记录和 operation 一并回滚', () => {
    const fixture = createFixture();
    try {
        fixture.dependencies.safeInsert = (table, values) => {
            const columns = Object.keys(values);
            const info = fixture.db.prepare(`
                INSERT INTO ${table} (${columns.join(', ')})
                VALUES (${columns.map(() => '?').join(', ')})
            `).run(...columns.map(column => values[column]));
            return { ...info, auditId: null };
        };
        assert.throws(
            () => executeRecordFactoryWorkflowRun(
                fixture.dependencies,
                runInput(),
                commandContext('audit-rollback')
            ),
            error => error?.code === 'strong_audit_required'
        );
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) AS count FROM factory_workflow_runs'
            ).get().count,
            0
        );
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) AS count FROM api_operations'
            ).get().count,
            0
        );
    } finally {
        fixture.db.close();
    }
});
