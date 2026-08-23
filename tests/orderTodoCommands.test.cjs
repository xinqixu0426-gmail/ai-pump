const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installBusinessChangeSchema } = require('./helpers/businessChangeSchema.cjs');
const {
    CAPABILITY_ID,
    executeOrderTodoToggle,
} = require('../api/services/orderTodoCommands.cjs');

function createFixture() {
    const db = new Database(':memory:');
    installBusinessChangeSchema(db);
    db.exec(`
        CREATE TABLE api_operations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation_id TEXT NOT NULL UNIQUE,
            capability_id TEXT NOT NULL,
            actor_key TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            request_id TEXT,
            status TEXT NOT NULL,
            response_json TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            expires_at TEXT NOT NULL,
            UNIQUE(actor_key, capability_id, idempotency_key)
        );
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            record_id INTEGER NOT NULL,
            changes_json TEXT NOT NULL
        );
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            customer_name TEXT,
            contract_no TEXT,
            remark TEXT,
            status TEXT,
            items_json TEXT,
            purchase_list_json TEXT,
            todos_json TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
    `);
    db.prepare(`
        INSERT INTO orders (
            id, customer_name, contract_no, status, items_json,
            purchase_list_json, todos_json, created_at, updated_at
        ) VALUES (1, '测试客户', 'TODO-1', '待采购', '[]', '[]', ?, ?, ?)
    `).run(
        JSON.stringify([{ id: 'todo-1', description: '采购', done: false }]),
        '2026-08-03T01:00:00.000Z',
        '2026-08-03T01:00:00.000Z'
    );
    let writeSeq = 0;
    const safeUpdate = (table, id, updates) => {
        assert.equal(table, 'orders');
        writeSeq += 1;
        const nextUpdatedAt = `2026-08-03T01:00:0${writeSeq}.000Z`;
        db.prepare(`
            UPDATE orders
            SET todos_json = ?, updated_at = ?
            WHERE id = ?
        `).run(updates.todos_json, nextUpdatedAt, id);
        const audit = db.prepare(`
            INSERT INTO audit_log (table_name, record_id, changes_json)
            VALUES (?, ?, ?)
        `).run(table, id, JSON.stringify(updates));
        return { auditId: Number(audit.lastInsertRowid) };
    };
    const orderRow = row => ({
        id: row.id,
        status: row.status,
        todosJson: row.todos_json,
        updatedAt: row.updated_at,
    });
    return {
        db,
        dependencies: { db, orderRow, safeUpdate },
    };
}

function commandContext(key) {
    return {
        actorKey: 'test:orders',
        capabilityId: CAPABILITY_ID,
        idempotencyKey: key,
        operationId: `${key}:operation`,
        requestId: `request:${key}`,
    };
}

test('订单待办命令：版本校验、强审计和幂等重放保持一致', () => {
    const fixture = createFixture();
    try {
        const input = {
            todoId: 'todo-1',
            done: true,
            expectedUpdatedAt: '2026-08-03T01:00:00.000Z',
        };
        const first = executeOrderTodoToggle(
            fixture.dependencies,
            1,
            input,
            commandContext('todo-toggle:test-0001')
        );
        assert.equal(first.capabilityId, CAPABILITY_ID);
        assert.equal(first.idempotentReplay, false);
        assert.equal(first.changes[0].to, true);
        assert.equal(first.auditIds.length, 1);
        assert.equal(JSON.parse(first.order.todosJson)[0].done, true);

        const replay = executeOrderTodoToggle(
            fixture.dependencies,
            1,
            input,
            commandContext('todo-toggle:test-0001')
        );
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.operationId, first.operationId);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count,
            1
        );

        assert.throws(
            () => executeOrderTodoToggle(
                fixture.dependencies,
                1,
                {
                    todoId: 'todo-1',
                    done: false,
                    expectedUpdatedAt: '2026-08-03T01:00:00.000Z',
                },
                commandContext('todo-toggle:test-0002')
            ),
            error => error.code === 'resource_version_conflict'
        );
    } finally {
        fixture.db.close();
    }
});

test('订单待办命令：未知待办兼容为空操作且不产生审计', () => {
    const fixture = createFixture();
    try {
        const result = executeOrderTodoToggle(
            fixture.dependencies,
            1,
            {
                todoId: 'missing',
                expectedUpdatedAt: '2026-08-03T01:00:00.000Z',
            },
            commandContext('todo-toggle:test-0003')
        );
        assert.equal(result.changes.length, 0);
        assert.equal(result.auditIds.length, 0);
        assert.equal(result.warnings.some(
            warning => warning.code === 'todo_not_found_noop'
        ), true);
    } finally {
        fixture.db.close();
    }
});
