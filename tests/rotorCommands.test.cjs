const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    DELETE_CAPABILITY_ID,
    LINK_CAPABILITY_ID,
    RENAME_CAPABILITY_ID,
    SAVE_CAPABILITY_ID,
    executeRotorHistoryDelete,
    executeRotorHistoryLink,
    executeRotorHistoryRename,
    executeRotorParameterSave,
    resolveDrawingFile,
} = require('../api/services/rotorCommands.cjs');
const {
    getRotorJobStatus,
    listRotorHistory,
    rotorHistoryRow,
} = require('../api/services/rotorHistory.cjs');
const {
    buildFcParams,
    normalizeBearing,
} = require('../api/services/rotorParameters.cjs');

const FIXED_AT = '2026-08-03T01:00:00.000Z';
const NEXT_AT = '2026-08-03T01:01:00.000Z';

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
            status TEXT NOT NULL,
            response_json TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            expires_at TEXT NOT NULL,
            UNIQUE(actor_key, capability_id, idempotency_key)
        );
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            'job-1', '旧名称', 'success', '/drawings/job-1.pdf',
            '${FIXED_AT}', '${FIXED_AT}'
        );
    `);

    function audit(table, id, context) {
        const info = db.prepare(`
            INSERT INTO audit_log (
                table_name, record_id, operation_id, capability_id
            ) VALUES (?, ?, ?, ?)
        `).run(
            table,
            id,
            context?.operationId || null,
            context?.capabilityId || null
        );
        return Number(info.lastInsertRowid);
    }

    function safeInsert(table, values, context) {
        const columns = Object.keys(values);
        const info = db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
        return {
            ...info,
            auditId: audit(table, Number(info.lastInsertRowid), context),
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
            NEXT_AT,
            id
        );
        return { ...info, auditId: audit(table, id, context) };
    }

    function hardDelete(table, id, context) {
        const info = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
        return { ...info, auditId: audit(table, id, context) };
    }

    return {
        db,
        dependencies: {
            db,
            hardDelete,
            publicDir: 'C:\\pump\\public',
            rotorHistoryRow,
            safeInsert,
            safeUpdate,
        },
    };
}

function context(capabilityId, idempotencyKey) {
    return {
        actorKey: 'user:test',
        capabilityId,
        idempotencyKey,
        operationId: `operation:${idempotencyKey}`,
        requestId: `request:${idempotencyKey}`,
    };
}

test('转子参数：轴承别名、数值边界和总长计算集中在共享 service', () => {
    assert.equal(normalizeBearing('202-2RS'), '6202');
    const result = buildFcParams({
        upper_bearing: '202-2RS',
        lower_bearing: '6204-ZZ',
        piece_count: '160',
        bearing_span: '150',
        impeller_span: '80',
        impeller_depth: '9',
        thread_length: '20',
        drawingText: ' 第一行 \r\n 第二行 ',
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.fcParams.upper_bearing_dia, 15);
    assert.equal(result.fcParams.lower_bearing_dia, 20);
    assert.equal(result.fcParams._core_length, 80);
    assert.equal(result.fcParams._total_length, 270);
    assert.equal(result.fcParams._drawing_text, '第一行\n第二行');
});

test('转子暂存命令：业务写入、operation 与强审计原子提交且支持安全重放', () => {
    const fixture = createFixture();
    const input = {
        upper_bearing: '6202',
        piece_count: '160',
        drawingName: ' 1500W / 转子 ',
    };
    const command = context(SAVE_CAPABILITY_ID, 'rotor-save-0001');
    const first = executeRotorParameterSave(
        fixture.dependencies,
        input,
        command
    );
    const replay = executeRotorParameterSave(
        fixture.dependencies,
        input,
        command
    );

    assert.equal(first.status, 'completed');
    assert.equal(first.drawingName, '1500W _ 转子');
    assert.equal(replay.jobId, first.jobId);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM rotor_drawings').get().count,
        2
    );
    assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count,
        1
    );
});

test('转子历史命令：重命名与关联使用 expectedUpdatedAt 并返回新版本', () => {
    const fixture = createFixture();
    const renamed = executeRotorHistoryRename(
        fixture.dependencies,
        1,
        {
            drawingName: '新名称',
            expectedUpdatedAt: FIXED_AT,
        },
        context(RENAME_CAPABILITY_ID, 'rotor-rename-0001')
    );
    assert.equal(renamed.drawingName, '新名称');
    assert.equal(renamed.history.updatedAt, NEXT_AT);

    const linked = executeRotorHistoryLink(
        fixture.dependencies,
        1,
        {
            linkedPumpModel: '配方:V750',
            expectedUpdatedAt: NEXT_AT,
        },
        context(LINK_CAPABILITY_ID, 'rotor-link-0001')
    );
    assert.equal(linked.linkedPumpModel, '配方:V750');
    assert.equal(linked.history.linkedPumpModel, '配方:V750');
    assert.equal(linked.auditIds.length, 1);
});

test('转子历史命令：过期版本和复用不同请求的幂等键均拒绝执行', () => {
    const fixture = createFixture();
    assert.throws(
        () => executeRotorHistoryLink(
            fixture.dependencies,
            1,
            {
                linkedPumpModel: '订单:A',
                expectedUpdatedAt: '2026-08-02T00:00:00.000Z',
            },
            context(LINK_CAPABILITY_ID, 'rotor-link-0002')
        ),
        error => error.code === 'resource_version_conflict'
    );

    executeRotorHistoryLink(
        fixture.dependencies,
        1,
        { linkedPumpModel: '订单:A', expectedUpdatedAt: FIXED_AT },
        context(LINK_CAPABILITY_ID, 'rotor-link-0003')
    );
    assert.throws(
        () => executeRotorHistoryLink(
            fixture.dependencies,
            1,
            { linkedPumpModel: '订单:B', expectedUpdatedAt: NEXT_AT },
            context(LINK_CAPABILITY_ID, 'rotor-link-0003')
        ),
        error => error.code === 'idempotency_key_conflict'
    );
});

test('转子删除命令：先提交数据库事实，受控 PDF 清理失败只返回 warning', () => {
    const fixture = createFixture();
    fixture.dependencies.fileSystem = {
        existsSync: () => true,
        unlinkSync: () => {
            throw new Error('文件被占用');
        },
    };
    const result = executeRotorHistoryDelete(
        fixture.dependencies,
        1,
        { expectedUpdatedAt: FIXED_AT },
        context(DELETE_CAPABILITY_ID, 'rotor-delete-0001')
    );

    assert.equal(result.deleted, 1);
    assert.equal(result.fileCleanup, 'failed');
    assert.match(
        result.warnings.map(item => item.code).join(','),
        /rotor_file_cleanup_failed/
    );
    assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM rotor_drawings').get().count,
        0
    );
    assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count,
        1
    );
    assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count,
        1
    );
});

test('转子查询：状态在进程重启后回退数据库，文件解析拒绝目录穿越', () => {
    const fixture = createFixture();
    const status = getRotorJobStatus(fixture.db, 'job-1', new Map());
    assert.equal(status.status, 'success');
    assert.equal(status.fileUrl, '/drawings/job-1.pdf');
    assert.equal(listRotorHistory(fixture.db).length, 1);
    assert.equal(
        resolveDrawingFile('C:\\pump\\public', '/../secret.pdf'),
        null
    );
    assert.equal(
        resolveDrawingFile(
            'C:\\pump\\public',
            '/drawings/../../secret.pdf'
        ),
        null
    );
});
