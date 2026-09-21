const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    executeConfirmExecutionRecord,
    executeCreateExecutionDraft,
    executeDeleteExecutionRecord,
    executeRevokeExecutionRecord,
    executeUpdateExecutionDraft,
} = require('../api/services/orderExecutionRecordCommands.cjs');

function createFixture() {
    const db = new Database(':memory:');
    runMigrations(db, { now: '2026-08-03T09:00:00.000Z' });
    let tick = 0;
    const nextTime = () => `2026-08-03T09:00:${String(++tick).padStart(2, '0')}.000Z`;
    const audit = (action, table, id, context) => Number(db.prepare(`
        INSERT INTO audit_log (
            action, table_name, record_id, user, request_id,
            operation_id, capability_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        action,
        table,
        id,
        context?.user || 'test',
        context?.requestId || null,
        context?.operationId || null,
        context?.capabilityId || null,
        nextTime()
    ).lastInsertRowid);
    const dependencies = {
        db,
        safeInsert(table, values, context) {
            const columns = Object.keys(values).filter(key => values[key] !== undefined);
            const info = db.prepare(`
                INSERT INTO ${table} (${columns.join(', ')})
                VALUES (${columns.map(() => '?').join(', ')})
            `).run(...columns.map(key => values[key]));
            return {
                ...info,
                auditId: audit('INSERT', table, Number(info.lastInsertRowid), context),
            };
        },
        safeUpdate(table, id, values, context) {
            const columns = Object.keys(values).filter(key => values[key] !== undefined);
            const info = db.prepare(`
                UPDATE ${table}
                SET ${columns.map(key => `${key} = ?`).join(', ')}, updated_at = ?
                WHERE id = ?
            `).run(...columns.map(key => values[key]), nextTime(), id);
            return { ...info, auditId: audit('UPDATE', table, id, context) };
        },
        softDelete(table, id, context) {
            const info = db.prepare(`
                UPDATE ${table}
                SET deleted_at = ?, updated_at = ?
                WHERE id = ?
            `).run(nextTime(), nextTime(), id);
            return { ...info, auditId: audit('SOFT_DELETE', table, id, context) };
        },
    };
    const orderId = Number(db.prepare(`
        INSERT INTO orders (
            customer_name, contract_no, status, items_json,
            purchase_list_json, todos_json, created_at, updated_at
        ) VALUES ('客户B', 'HT-32', '待采购', '[]', '[]', '[]', ?, ?)
    `).run('2026-08-03T09:00:00.000Z', '2026-08-03T09:00:00.000Z').lastInsertRowid);
    return { db, dependencies, orderId };
}

function context(key) {
    return {
        actorKey: 'user:test',
        idempotencyKey: key,
        requestId: `request-${key}`,
    };
}

function draft(overrides = {}) {
    return {
        phase: 'pre_production',
        recordType: 'material_preparation',
        title: '物料准备完成',
        summaryText: '首批物料已经完成到厂检查。',
        occurredAt: '2026-08-03T09:00:00.000Z',
        sourceFileIds: [],
        ...overrides,
    };
}

test('执行档案命令：新建草稿持久幂等且不重复记录', () => {
    const fixture = createFixture();
    try {
        const first = executeCreateExecutionDraft(
            fixture.dependencies,
            fixture.orderId,
            draft(),
            context('execution-create-0001')
        );
        const replay = executeCreateExecutionDraft(
            fixture.dependencies,
            fixture.orderId,
            draft(),
            context('execution-create-0001')
        );
        assert.equal(first.capabilityId, 'orders.execution_records.create_draft');
        assert.equal(first.auditIds.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) count FROM order_execution_records').get().count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('执行档案命令：修改绑定版本，旧版本不写 operation', () => {
    const fixture = createFixture();
    try {
        const created = executeCreateExecutionDraft(
            fixture.dependencies,
            fixture.orderId,
            draft(),
            context('execution-create-0002')
        );
        const updated = executeUpdateExecutionDraft(
            fixture.dependencies,
            fixture.orderId,
            created.id,
            {
                ...draft({ summaryText: '第二版物料检查结果。' }),
                expectedUpdatedAt: created.updatedAt,
            },
            context('execution-update-0001')
        );
        assert.equal(updated.draftText, '第二版物料检查结果。');
        assert.throws(() => executeUpdateExecutionDraft(
            fixture.dependencies,
            fixture.orderId,
            created.id,
            {
                ...draft({ summaryText: '过期覆盖。' }),
                expectedUpdatedAt: created.updatedAt,
            },
            context('execution-update-0002')
        ), /已被其他操作修改/);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) count FROM api_operations').get().count,
            2
        );
    } finally {
        fixture.db.close();
    }
});

test('执行档案命令：确认与撤销保持草稿和确认事实分离', () => {
    const fixture = createFixture();
    try {
        const created = executeCreateExecutionDraft(
            fixture.dependencies,
            fixture.orderId,
            draft(),
            context('execution-create-0003')
        );
        const confirmed = executeConfirmExecutionRecord(
            fixture.dependencies,
            fixture.orderId,
            created.id,
            { expectedUpdatedAt: created.updatedAt },
            context('execution-confirm-0001')
        );
        assert.equal(confirmed.knowledgeStatus, 'confirmed');
        assert.equal(confirmed.auditIds.length, 1);
        const revoked = executeRevokeExecutionRecord(
            fixture.dependencies,
            fixture.orderId,
            created.id,
            { expectedUpdatedAt: confirmed.updatedAt },
            context('execution-revoke-0001')
        );
        assert.equal(revoked.knowledgeStatus, 'not_confirmed');
        assert.match(revoked.draftText, /到厂检查/);
    } finally {
        fixture.db.close();
    }
});

test('执行档案命令：删除需要强审计，缺失时草稿和 operation 一起回滚', () => {
    const fixture = createFixture();
    try {
        const created = executeCreateExecutionDraft(
            fixture.dependencies,
            fixture.orderId,
            draft(),
            context('execution-create-0004')
        );
        const dependencies = {
            ...fixture.dependencies,
            softDelete(table, id) {
                return fixture.db.prepare(`
                    UPDATE ${table}
                    SET deleted_at = ?, updated_at = ?
                    WHERE id = ?
                `).run(
                    '2026-08-03T09:30:00.000Z',
                    '2026-08-03T09:30:00.000Z',
                    id
                );
            },
        };
        assert.throws(() => executeDeleteExecutionRecord(
            dependencies,
            fixture.orderId,
            created.id,
            { expectedUpdatedAt: created.updatedAt },
            context('execution-delete-0001')
        ), /强审计记录不完整/);
        assert.equal(
            fixture.db.prepare(
                'SELECT deleted_at FROM order_execution_records WHERE id = ?'
            ).get(created.id).deleted_at,
            null
        );
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) count FROM api_operations').get().count,
            1
        );
    } finally {
        fixture.db.close();
    }
});
