const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    executeFactoryFileDelete,
    executeFactoryFileParse,
    executeFactoryFileUpload,
} = require('../api/services/factoryFileLifecycleCommands.cjs');
const { requestHash } = require('../api/services/commandExecution.cjs');

function createFixture(overrides = {}) {
    const db = new Database(':memory:');
    runMigrations(db, { now: '2026-08-03T10:00:00.000Z' });
    let tick = 0;
    const nextTime = () => `2026-08-03T10:00:${String(++tick).padStart(2, '0')}.000Z`;
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
                SET ${columns.map(key => `${key} = ?`).join(', ')}
                WHERE id = ?
            `).run(...columns.map(key => values[key]), id);
            return { ...info, auditId: audit('UPDATE', table, id, context) };
        },
        softDelete(table, id, context) {
            const now = nextTime();
            const info = db.prepare(`
                UPDATE ${table}
                SET deleted_at = ?, updated_at = ?
                WHERE id = ?
            `).run(now, now, id);
            return {
                ...info,
                auditId: audit('SOFT_DELETE', table, id, context),
            };
        },
        ...overrides,
    };
    return { db, dependencies };
}

function context(key) {
    return {
        actorKey: 'user:file-test',
        idempotencyKey: key,
        operationId: `operation:${key}`,
        requestId: `request:${key}`,
        warnings: [],
    };
}

function textUpload(overrides = {}) {
    return {
        buffer: Buffer.from('技术参数：扬程 38m', 'utf8'),
        originalName: '技术参数.txt',
        mimeType: 'text/plain',
        sourceType: 'direct_upload',
        now: '2026-08-03T10:00:00.000Z',
        ...overrides,
    };
}

function seedAcceptedParseOperation(
    fixture,
    uploaded,
    commandContext,
    auditIds
) {
    const createdAt = '2026-08-03T10:40:00.000Z';
    const receipt = {
        id: uploaded.id,
        parserStatus: 'processing',
        operationId: commandContext.operationId,
        capabilityId: 'files.parse',
        status: 'accepted',
        resource: { type: 'factoryFile', ids: [uploaded.id] },
        changes: [{
            resourceType: 'factoryFile',
            resourceId: uploaded.id,
            field: 'parserStatus',
            from: 'pending',
            to: 'processing',
        }],
        warnings: [],
        auditId: auditIds[0] || null,
        auditIds,
        idempotentReplay: false,
        acceptedAt: createdAt,
        completedAt: null,
    };
    fixture.db.prepare(`
        INSERT INTO api_operations (
            operation_id, capability_id, actor_key, idempotency_key,
            request_hash, request_id, status, response_json,
            created_at, completed_at, expires_at
        ) VALUES (?, 'files.parse', ?, ?, ?, ?, 'pending', ?, ?, NULL, ?)
    `).run(
        commandContext.operationId,
        commandContext.actorKey,
        commandContext.idempotencyKey,
        requestHash({
            fileId: uploaded.id,
            expectedUpdatedAt: uploaded.updatedAt,
        }),
        commandContext.requestId,
        JSON.stringify(receipt),
        createdAt,
        '2026-11-01T10:40:00.000Z'
    );
}

test('文件生命周期：上传以内容摘要持久幂等且同一命令不重复累计', () => {
    const fixture = createFixture();
    try {
        const first = executeFactoryFileUpload(
            fixture.dependencies,
            textUpload(),
            context('file-upload-0001')
        );
        const replay = executeFactoryFileUpload(
            fixture.dependencies,
            textUpload(),
            context('file-upload-0001')
        );
        assert.equal(first.capabilityId, 'files.upload');
        assert.equal(first.deduplicated, false);
        assert.equal(first.auditIds.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) count FROM factory_files').get().count,
            1
        );
        assert.equal(
            fixture.db.prepare('SELECT duplicate_count FROM factory_files').get().duplicate_count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('文件生命周期：解析登记、解析结果和审计关联同一 operation', async () => {
    const fixture = createFixture();
    try {
        const uploaded = executeFactoryFileUpload(
            fixture.dependencies,
            textUpload({
                buffer: Buffer.from('型号,价格\\nV750,95', 'utf8'),
                originalName: '报价.csv',
                mimeType: 'text/csv',
            }),
            context('file-upload-0002')
        );
        fixture.dependencies.parseFactoryFile = async (id, options) => {
            const write = fixture.dependencies.safeUpdate(
                'factory_files',
                id,
                {
                    parser_status: 'parsed',
                    parsed_text: '型号,价格\\nV750,95',
                    parsed_json: JSON.stringify({ version: 'test-v1' }),
                    parser_error: '',
                    parsed_at: '2026-08-03T10:10:00.000Z',
                    updated_at: '2026-08-03T10:10:00.000Z',
                },
                options.auditContext
            );
            options.onWrite(write);
        };
        const parsed = await executeFactoryFileParse(
            fixture.dependencies,
            uploaded.id,
            { expectedUpdatedAt: uploaded.updatedAt },
            context('file-parse-0001')
        );
        const replay = await executeFactoryFileParse(
            fixture.dependencies,
            uploaded.id,
            { expectedUpdatedAt: uploaded.updatedAt },
            context('file-parse-0001')
        );
        assert.equal(parsed.capabilityId, 'files.parse');
        assert.equal(parsed.status, 'completed');
        assert.equal(parsed.parserStatus, 'parsed');
        assert.equal(parsed.auditIds.length, 2);
        assert.equal(replay.idempotentReplay, true);
        const auditOperations = fixture.db.prepare(`
            SELECT DISTINCT operation_id operationId
            FROM audit_log
            WHERE capability_id = 'files.parse'
        `).all();
        assert.deepEqual(auditOperations, [{ operationId: parsed.operationId }]);
    } finally {
        fixture.db.close();
    }
});

test('文件生命周期：解析失败回执可安全重放且不重复执行解析器', async () => {
    let parseCalls = 0;
    const fixture = createFixture();
    try {
        const uploaded = executeFactoryFileUpload(
            fixture.dependencies,
            textUpload({
                buffer: Buffer.from('型号,价格\\nV750,95', 'utf8'),
                originalName: '失败报价.csv',
            }),
            context('file-upload-0003')
        );
        fixture.dependencies.parseFactoryFile = async (id, options) => {
            parseCalls += 1;
            const write = fixture.dependencies.safeUpdate(
                'factory_files',
                id,
                {
                    parser_status: 'failed',
                    parser_error: '模拟解析失败',
                    parsed_at: '2026-08-03T10:20:00.000Z',
                    updated_at: '2026-08-03T10:20:00.000Z',
                },
                options.auditContext
            );
            options.onWrite(write);
            throw new Error('模拟解析失败');
        };
        await assert.rejects(
            executeFactoryFileParse(
                fixture.dependencies,
                uploaded.id,
                { expectedUpdatedAt: uploaded.updatedAt },
                context('file-parse-0002')
            ),
            /模拟解析失败/
        );
        await assert.rejects(
            executeFactoryFileParse(
                fixture.dependencies,
                uploaded.id,
                { expectedUpdatedAt: uploaded.updatedAt },
                context('file-parse-0002')
            ),
            /模拟解析失败/
        );
        assert.equal(parseCalls, 1);
        const operation = fixture.db.prepare(`
            SELECT status, response_json responseJson
            FROM api_operations
            WHERE capability_id = 'files.parse'
        `).get();
        assert.equal(operation.status, 'completed');
        assert.equal(JSON.parse(operation.responseJson).status, 'failed');
    } finally {
        fixture.db.close();
    }
});

test('文件生命周期：结果已落库但终态回执中断时可按同一 operation 恢复', async () => {
    const fixture = createFixture();
    try {
        const uploaded = executeFactoryFileUpload(
            fixture.dependencies,
            textUpload({
                buffer: Buffer.from('型号,价格\\nV750,95', 'utf8'),
                originalName: '恢复报价.csv',
                mimeType: 'text/csv',
            }),
            context('file-upload-recovery')
        );
        const parseContext = context('file-parse-recovery');
        const auditContext = {
            requireAudit: true,
            user: parseContext.actorKey,
            requestId: parseContext.requestId,
            operationId: parseContext.operationId,
            capabilityId: 'files.parse',
        };
        const processing = fixture.dependencies.safeUpdate(
            'factory_files',
            uploaded.id,
            {
                parser_status: 'processing',
                updated_at: '2026-08-03T10:40:00.000Z',
            },
            auditContext
        );
        const parsed = fixture.dependencies.safeUpdate(
            'factory_files',
            uploaded.id,
            {
                parser_status: 'parsed',
                parsed_text: '型号,价格\\nV750,95',
                parsed_json: JSON.stringify({
                    version: 'spreadsheet-v1',
                }),
                parsed_at: '2026-08-03T10:41:00.000Z',
                updated_at: '2026-08-03T10:41:00.000Z',
            },
            auditContext
        );
        seedAcceptedParseOperation(
            fixture,
            uploaded,
            parseContext,
            [processing.auditId, parsed.auditId]
        );

        const recovered = await executeFactoryFileParse(
            fixture.dependencies,
            uploaded.id,
            { expectedUpdatedAt: uploaded.updatedAt },
            parseContext
        );
        assert.equal(recovered.status, 'completed');
        assert.equal(recovered.parserStatus, 'parsed');
        assert.equal(recovered.idempotentReplay, true);
        assert.ok(recovered.warnings.some(
            warning => warning.code === 'parse_receipt_recovered'
        ));
        assert.equal(
            fixture.db.prepare(`
                SELECT status FROM api_operations
                WHERE operation_id = ?
            `).get(parseContext.operationId).status,
            'completed'
        );
    } finally {
        fixture.db.close();
    }
});

test('文件生命周期：解析锁超时后同一幂等键恢复执行而不新建 operation', async () => {
    let parseCalls = 0;
    const fixture = createFixture();
    try {
        const uploaded = executeFactoryFileUpload(
            fixture.dependencies,
            textUpload({
                buffer: Buffer.from('型号,价格\\nV750,95', 'utf8'),
                originalName: '超时恢复.csv',
                mimeType: 'text/csv',
            }),
            context('file-upload-stale')
        );
        const parseContext = context('file-parse-stale');
        const auditContext = {
            requireAudit: true,
            user: parseContext.actorKey,
            requestId: parseContext.requestId,
            operationId: parseContext.operationId,
            capabilityId: 'files.parse',
        };
        const processing = fixture.dependencies.safeUpdate(
            'factory_files',
            uploaded.id,
            {
                parser_status: 'processing',
                updated_at: '2020-01-01T00:00:00.000Z',
            },
            auditContext
        );
        seedAcceptedParseOperation(
            fixture,
            uploaded,
            parseContext,
            [processing.auditId]
        );
        fixture.dependencies.parseFactoryFile = async (id, options) => {
            parseCalls += 1;
            const write = fixture.dependencies.safeUpdate(
                'factory_files',
                id,
                {
                    parser_status: 'parsed',
                    parsed_text: '型号,价格\\nV750,95',
                    parsed_json: JSON.stringify({
                        version: 'spreadsheet-v1',
                    }),
                    parsed_at: '2026-08-03T10:50:00.000Z',
                    updated_at: '2026-08-03T10:50:00.000Z',
                },
                options.auditContext
            );
            options.onWrite(write);
        };

        const resumed = await executeFactoryFileParse(
            fixture.dependencies,
            uploaded.id,
            { expectedUpdatedAt: uploaded.updatedAt },
            parseContext
        );
        assert.equal(resumed.status, 'completed');
        assert.equal(resumed.idempotentReplay, true);
        assert.equal(parseCalls, 1);
        assert.equal(
            fixture.db.prepare(
                "SELECT COUNT(*) count FROM api_operations WHERE capability_id = 'files.parse'"
            ).get().count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('文件生命周期：删除检查版本和业务引用，成功时软删除带强审计', () => {
    const fixture = createFixture();
    try {
        const uploaded = executeFactoryFileUpload(
            fixture.dependencies,
            textUpload(),
            context('file-upload-0004')
        );
        assert.throws(() => executeFactoryFileDelete(
            fixture.dependencies,
            uploaded.id,
            { expectedUpdatedAt: '2026-08-03T09:59:59.000Z' },
            context('file-delete-0001')
        ), /已被其他操作修改/);
        fixture.db.prepare(`
            INSERT INTO knowledge_documents (
                title, document_type, file_id, metadata_json,
                created_at, updated_at
            ) VALUES ('技术资料', 'technical_note', ?, '{}', ?, ?)
        `).run(uploaded.id, uploaded.createdAt, uploaded.updatedAt);
        assert.throws(() => executeFactoryFileDelete(
            fixture.dependencies,
            uploaded.id,
            { expectedUpdatedAt: uploaded.updatedAt },
            context('file-delete-0002')
        ), /仍被业务资料引用/);
        fixture.db.prepare(
            'UPDATE knowledge_documents SET deleted_at = ? WHERE file_id = ?'
        ).run('2026-08-03T10:30:00.000Z', uploaded.id);
        const deleted = executeFactoryFileDelete(
            fixture.dependencies,
            uploaded.id,
            { expectedUpdatedAt: uploaded.updatedAt },
            context('file-delete-0003')
        );
        assert.equal(deleted.capabilityId, 'files.delete');
        assert.equal(deleted.deleted, true);
        assert.equal(deleted.auditIds.length, 1);
        assert.ok(fixture.db.prepare(
            'SELECT deleted_at FROM factory_files WHERE id = ?'
        ).get(uploaded.id).deleted_at);
    } finally {
        fixture.db.close();
    }
});
