const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    resetBusinessConfirmationsForTests,
} = require('../api/services/businessConfirmation.cjs');
const {
    createRotorExternalCommands,
} = require('../api/services/rotorExternalCommands.cjs');

function createFixture() {
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
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT,
            table_name TEXT,
            record_id INTEGER,
            operation_id TEXT,
            capability_id TEXT
        );
        CREATE TABLE rotor_drawings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL UNIQUE,
            drawing_name TEXT DEFAULT '',
            nl_input TEXT DEFAULT '',
            params_json TEXT DEFAULT '{}',
            fc_params_json TEXT DEFAULT '{}',
            status TEXT DEFAULT 'processing',
            file_url TEXT DEFAULT '',
            error TEXT DEFAULT '',
            linked_pump_model TEXT DEFAULT '',
            created_at TEXT,
            updated_at TEXT
        );
        INSERT INTO rotor_drawings (
            job_id, drawing_name, status, file_url, created_at, updated_at
        ) VALUES (
            'print-job-1', '待打印图纸', 'success',
            '/drawings/print-job-1.pdf',
            '2026-08-03T00:00:00.000Z',
            '2026-08-03T00:00:00.000Z'
        );
    `);

    function writeAuditLog(action, table, id, _oldValue, _newValue, _user, context) {
        return Number(db.prepare(`
            INSERT INTO audit_log (
                action, table_name, record_id, operation_id, capability_id
            ) VALUES (?, ?, ?, ?, ?)
        `).run(
            action,
            table,
            id,
            context?.operationId || null,
            context?.capabilityId || null
        ).lastInsertRowid);
    }

    function safeInsert(table, values, context) {
        const columns = Object.keys(values);
        const info = db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
        return {
            ...info,
            auditId: writeAuditLog(
                'INSERT',
                table,
                Number(info.lastInsertRowid),
                null,
                null,
                null,
                context
            ),
        };
    }

    function safeUpdate(table, id, updates, context) {
        const columns = Object.keys(updates);
        const info = db.prepare(`
            UPDATE ${table}
            SET ${columns.map(column => `${column} = ?`).join(', ')},
                updated_at = ?
            WHERE id = ?
        `).run(
            ...columns.map(column => updates[column]),
            new Date().toISOString(),
            id
        );
        return {
            ...info,
            auditId: writeAuditLog(
                'UPDATE',
                table,
                id,
                null,
                null,
                null,
                context
            ),
        };
    }

    return { db, safeInsert, safeUpdate, writeAuditLog };
}

function commandContext(idempotencyKey) {
    return {
        actorKey: 'user:test-session',
        idempotencyKey,
        operationId: 'ignored-operation-id',
        requestId: 'request-1',
        warnings: [],
    };
}

test.beforeEach(() => {
    resetBusinessConfirmationsForTests();
});

test('转子外部命令：出图 Preview 绑定参数且相同 key 不创建第二个任务', () => {
    const fixture = createFixture();
    let launches = 0;
    try {
        const service = createRotorExternalCommands({
            ...fixture,
            execFile: () => {
                launches += 1;
            },
            fileSystem: {
                existsSync: () => false,
                mkdirSync: () => {},
                copyFileSync: () => {},
                unlinkSync: () => {},
            },
            maxConcurrent: 1,
        });
        const preview = service.buildDrawPreview(
            {
                upper_bearing: '202',
                piece_count: 160,
                drawingName: 'V750',
            },
            'user:test-session'
        );
        const input = { confirmationToken: preview.confirmationToken };
        const first = service.executeDraw(
            input,
            commandContext(preview.suggestedIdempotencyKey),
            'user:test-session'
        );
        const replay = service.executeDraw(
            input,
            commandContext(preview.suggestedIdempotencyKey),
            'user:test-session'
        );

        assert.equal(first.status, 'accepted');
        assert.equal(replay.status, 'processing');
        assert.equal(replay.idempotentReplay, true);
        assert.equal(first.params.upper_bearing_dia, 15);
        assert.equal(launches, 1);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM rotor_drawings').get().count,
            2
        );
    } finally {
        fixture.db.close();
    }
});

test('转子外部命令：打印先审计且相同 key 不重复发送', () => {
    const fixture = createFixture();
    let printCalls = 0;
    try {
        const service = createRotorExternalCommands({
            ...fixture,
            platform: 'darwin',
            publicDir: 'C:\\controlled-public',
            fileSystem: {
                existsSync: () => true,
            },
            execFileSync: (program, args) => {
                assert.equal(program, 'lp');
                assert.equal(args.length, 1);
                printCalls += 1;
            },
        });
        const preview = service.buildPrintPreview(
            'print-job-1',
            'user:test-session'
        );
        const input = { confirmationToken: preview.confirmationToken };
        const first = service.executePrint(
            input,
            commandContext(preview.suggestedIdempotencyKey),
            'user:test-session'
        );
        const replay = service.executePrint(
            input,
            commandContext(preview.suggestedIdempotencyKey),
            'user:test-session'
        );

        assert.equal(first.status, 'completed');
        assert.equal(replay.status, 'completed');
        assert.equal(replay.idempotentReplay, true);
        assert.equal(printCalls, 1);
        assert.equal(
            fixture.db.prepare(
                "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'EXTERNAL_PRINT_REQUESTED'"
            ).get().count,
            1
        );
        assert.equal(
            fixture.db.prepare(
                "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'EXTERNAL_PRINT_COMPLETED'"
            ).get().count,
            1
        );
    } finally {
        fixture.db.close();
    }
});
