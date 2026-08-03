const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    beginPersistentExternalCommand,
    CommandExecutionError,
    executePersistentCommand,
    requestHash,
    updatePersistentExternalCommand,
} = require('../api/services/commandExecution.cjs');

function createOperationDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE api_operations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation_id TEXT NOT NULL,
            capability_id TEXT NOT NULL,
            actor_key TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            request_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            response_json TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            expires_at TEXT NOT NULL,
            UNIQUE(actor_key, capability_id, idempotency_key)
        );
    `);
    return db;
}

test('持久化命令：相同 key 和请求只返回已保存回执', () => {
    const db = createOperationDatabase();
    try {
        let executions = 0;
        const options = {
            db,
            capabilityId: 'inventory.test',
            actorKey: 'user:admin:test',
            idempotencyKey: 'test:operation:1',
            operationId: 'operation-1',
            requestId: 'request-1',
            input: { delta: 2, partId: 1 },
            now: new Date('2026-08-02T00:00:00.000Z'),
            execute: () => {
                executions += 1;
                return {
                    data: { updatedCount: 1 },
                    changes: [{ resourceId: 1, from: 3, to: 5 }],
                    auditIds: [9],
                };
            },
        };
        const first = executePersistentCommand(options);
        const replay = executePersistentCommand(options);
        assert.equal(executions, 1);
        assert.equal(first.operationId, 'operation-1');
        assert.equal(first.idempotentReplay, false);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.auditId, 9);
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 1);
    } finally {
        db.close();
    }
});

test('持久化命令：相同 key 不能替换请求参数', () => {
    const db = createOperationDatabase();
    try {
        const base = {
            db,
            capabilityId: 'inventory.test',
            actorKey: 'user:admin:test',
            idempotencyKey: 'test:operation:2',
            operationId: 'operation-2',
            requestId: 'request-2',
            now: new Date('2026-08-02T00:00:00.000Z'),
            execute: () => ({ changes: [], auditIds: [] }),
        };
        executePersistentCommand({ ...base, input: { delta: 1 } });
        assert.throws(
            () => executePersistentCommand({ ...base, input: { delta: 2 } }),
            error => (
                error instanceof CommandExecutionError
                && error.code === 'idempotency_key_conflict'
                && error.statusCode === 409
            )
        );
    } finally {
        db.close();
    }
});

test('持久化命令：规范化哈希不受对象字段顺序影响', () => {
    assert.equal(
        requestHash({ partId: 1, nested: { b: 2, a: 1 } }),
        requestHash({ nested: { a: 1, b: 2 }, partId: 1 })
    );
});

test('持久化命令：强审计数量不足时 operation 不得提交', () => {
    const db = createOperationDatabase();
    try {
        assert.throws(
            () => executePersistentCommand({
                db,
                capabilityId: 'workflow.test',
                actorKey: 'user:admin:test',
                idempotencyKey: 'test:operation:audit-count',
                operationId: 'operation-audit-count',
                input: { resourceId: 1 },
                execute: () => ({
                    changes: [{ resourceId: 1 }, { resourceId: 2 }],
                    auditIds: [11],
                    requiredAuditCount: 2,
                }),
            }),
            error => error.code === 'strong_audit_required' && error.statusCode === 500
        );
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        db.close();
    }
});

test('外部命令：先保存 accepted 回执，相同 key 重试不重复执行副作用', () => {
    const db = createOperationDatabase();
    try {
        let registrations = 0;
        const options = {
            db,
            capabilityId: 'drawings.test.external',
            actorKey: 'user:admin:test',
            idempotencyKey: 'external:operation:1',
            operationId: 'external-operation-1',
            input: { jobId: 'job-1' },
            execute: () => {
                registrations += 1;
                return {
                    data: { jobId: 'job-1' },
                    changes: [{ resourceId: 1, field: 'status', to: 'queued' }],
                    auditIds: [17],
                };
            },
        };
        const first = beginPersistentExternalCommand(options);
        const replay = beginPersistentExternalCommand(options);

        assert.equal(first.shouldExecute, true);
        assert.equal(first.receipt.status, 'accepted');
        assert.equal(replay.shouldExecute, false);
        assert.equal(replay.receipt.idempotentReplay, true);
        assert.equal(registrations, 1);
        assert.equal(
            db.prepare('SELECT status FROM api_operations').get().status,
            'pending'
        );
    } finally {
        db.close();
    }
});

test('外部命令：processing 回执可重放，终态保存 completedAt', () => {
    const db = createOperationDatabase();
    try {
        const options = {
            db,
            capabilityId: 'drawings.test.external',
            actorKey: 'user:admin:test',
            idempotencyKey: 'external:operation:2',
            operationId: 'external-operation-2',
            input: { jobId: 'job-2' },
            execute: () => ({ data: { jobId: 'job-2' } }),
        };
        beginPersistentExternalCommand(options);
        updatePersistentExternalCommand({
            db,
            operationId: 'external-operation-2',
            status: 'processing',
        });
        const replay = beginPersistentExternalCommand(options);
        assert.equal(replay.receipt.status, 'processing');

        const completed = updatePersistentExternalCommand({
            db,
            operationId: 'external-operation-2',
            status: 'completed',
            data: { fileUrl: '/drawings/job-2.pdf' },
            terminal: true,
            now: new Date('2026-08-03T02:00:00.000Z'),
        });
        assert.equal(completed.status, 'completed');
        assert.equal(completed.fileUrl, '/drawings/job-2.pdf');
        assert.equal(completed.completedAt, '2026-08-03T02:00:00.000Z');
        assert.equal(
            db.prepare('SELECT status FROM api_operations').get().status,
            'completed'
        );
    } finally {
        db.close();
    }
});
