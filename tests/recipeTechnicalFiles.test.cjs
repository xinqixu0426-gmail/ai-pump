const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    DELETE_CAPABILITY_ID,
    UPLOAD_CAPABILITY_ID,
    executeRecipeTechnicalFileDelete,
    executeRecipeTechnicalFileUpload,
    getRecipeTechnicalFileDownload,
    listRecipeTechnicalFiles,
} = require('../api/services/recipeTechnicalFiles.cjs');

const FIXED_AT = '2026-08-03T00:00:00.000Z';
const NEXT_AT = '2026-08-03T00:01:00.000Z';
const FILE_BUFFER = Buffer.from('fixture-xlsx');
const FILE_SHA = 'a'.repeat(64);

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
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE factory_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_name TEXT,
            mime_type TEXT,
            file_size INTEGER,
            file_sha256 TEXT,
            file_blob BLOB,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE recipe_technical_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id INTEGER NOT NULL,
            file_id INTEGER,
            original_name TEXT NOT NULL,
            mime_type TEXT,
            file_size INTEGER,
            file_sha256 TEXT NOT NULL,
            file_blob BLOB NOT NULL,
            report_type TEXT,
            summary_json TEXT,
            parsed_json TEXT,
            extracted_text TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        INSERT INTO recipes (id, updated_at) VALUES (1, '${FIXED_AT}');
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
        const columns = Object.keys(values).filter(
            column => values[column] !== undefined
        );
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
        const columns = Object.keys(updates).filter(
            column => updates[column] !== undefined
        );
        db.prepare(`
            UPDATE ${table}
            SET ${columns.map(column => `${column} = ?`).join(', ')},
                updated_at = ?
            WHERE id = ?
        `).run(
            ...columns.map(column => updates[column]),
            NEXT_AT,
            id
        );
        return {
            changes: 1,
            auditId: audit(table, id, context),
        };
    }

    function storeFactoryFile(input, options = {}) {
        const write = safeInsert('factory_files', {
            original_name: input.originalName,
            mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            file_size: input.buffer.length,
            file_sha256: FILE_SHA,
            file_blob: input.buffer,
            created_at: input.now,
            updated_at: input.now,
        }, options.auditContext);
        return {
            file: {
                id: Number(write.lastInsertRowid),
                originalName: input.originalName,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                fileSize: input.buffer.length,
                fileSha256: FILE_SHA,
            },
            deduplicated: false,
            auditIds: [write.auditId],
        };
    }

    const recipeTechnicalFileRow = row => ({
        id: Number(row.id),
        recipeId: Number(row.recipe_id),
        fileId: Number(row.file_id),
        originalName: row.original_name,
        mimeType: row.mime_type,
        fileSize: Number(row.file_size),
        fileSha256: row.file_sha256,
        reportType: row.report_type,
        summaryJson: row.summary_json,
        parsedJson: row.parsed_json,
        extractedText: row.extracted_text,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    });
    const dependencies = {
        db,
        inspectFactoryFile: input => ({
            originalName: input.originalName,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            fileSize: input.buffer.length,
            fileSha256: FILE_SHA,
        }),
        parsePumpTestReport: () => ({
            summary: { model: 'V750', testPointCount: 1 },
            parsed: {
                testPoints: [
                    { sequence: 1, flow: 0, head: 20, current: 2.1 },
                    { sequence: 2, flow: 10, head: 18, current: 2.4 },
                ],
            },
            extractedText: '型号：V750',
        }),
        recipeTechnicalFileRow,
        safeInsert,
        safeUpdate,
        storeFactoryFile,
    };
    return { db, dependencies };
}

function uploadContext(key = 'technical-upload:key-1') {
    return {
        actorKey: 'test:user',
        capabilityId: UPLOAD_CAPABILITY_ID,
        idempotencyKey: key,
        operationId: `operation:${key}`,
        requestId: `request:${key}`,
        warnings: [],
    };
}

function deleteContext(key = 'technical-delete:key-1') {
    return {
        actorKey: 'test:user',
        capabilityId: DELETE_CAPABILITY_ID,
        idempotencyKey: key,
        operationId: `operation:${key}`,
        requestId: `request:${key}`,
        warnings: [],
    };
}

function uploadInput(overrides = {}) {
    return {
        buffer: FILE_BUFFER,
        originalName: '性能测试.xlsx',
        mimeType: 'application/octet-stream',
        expectedUpdatedAt: FIXED_AT,
        ...overrides,
    };
}

test('配方技术档案 Query 只读返回摘要和原文件', () => {
    const { db, dependencies } = createFixture();
    const upload = executeRecipeTechnicalFileUpload(
        dependencies,
        1,
        uploadInput(),
        uploadContext()
    );
    const auditCount = db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count;
    const operationCount = db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count;

    const files = listRecipeTechnicalFiles(dependencies, 1);
    const download = getRecipeTechnicalFileDownload(
        dependencies,
        1,
        upload.technicalFile.id
    );

    assert.equal(files.length, 1);
    assert.equal(files[0].summary.model, 'V750');
    assert.deepEqual(files[0].testCurve, {
        dataBasis: 'measuredTestPoints',
        pointCount: 2,
        flowUnit: 'm3/h',
        headUnit: 'm',
        maxHead: 20,
        maxHeadAtFlow: 0,
        maxFlow: 10,
        headAtMaxFlow: 18,
        testPoints: [
            { sequence: 1, flow: 0, head: 20, current: 2.1 },
            { sequence: 2, flow: 10, head: 18, current: 2.4 },
        ],
    });
    assert.equal(download.originalName, '性能测试.xlsx');
    assert.deepEqual(download.buffer, FILE_BUFFER);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, auditCount);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, operationCount);
});

test('配方技术档案 Query 忽略模板汇总和无效点，只按真实曲线生成极值', () => {
    const { dependencies } = createFixture();
    dependencies.parsePumpTestReport = () => ({
        summary: { model: 'V750', testPointCount: 4 },
        parsed: {
            performance: {
                specified: { flow: '99m3/h', head: '99m' },
                measured: { flow: '88m3/h', head: '88m' },
            },
            testPoints: [
                { sequence: 1, flow: '0', head: '9.35' },
                { sequence: 2, flow: 17.67, head: 2.43, unitEfficiency: 16.13 },
                { sequence: 3, flow: 'bad', head: 50 },
                { sequence: 4, flow: 18, head: null },
            ],
        },
        extractedText: '测试曲线',
    });
    executeRecipeTechnicalFileUpload(
        dependencies,
        1,
        uploadInput(),
        uploadContext()
    );

    const [file] = listRecipeTechnicalFiles(dependencies, 1);

    assert.equal(file.testCurve.maxHead, 9.35);
    assert.equal(file.testCurve.maxHeadAtFlow, 0);
    assert.equal(file.testCurve.maxFlow, 17.67);
    assert.equal(file.testCurve.headAtMaxFlow, 2.43);
    assert.equal(file.testCurve.pointCount, 2);
    assert.equal(JSON.stringify(file.testCurve).includes('99'), false);
    assert.equal(JSON.stringify(file.testCurve).includes('88'), false);
});

test('配方技术档案上传使用版本、持久幂等、内容去重和强审计', () => {
    const { db, dependencies } = createFixture();
    const first = executeRecipeTechnicalFileUpload(
        dependencies,
        1,
        uploadInput(),
        uploadContext()
    );
    const replay = executeRecipeTechnicalFileUpload(
        dependencies,
        1,
        uploadInput(),
        uploadContext()
    );
    const duplicate = executeRecipeTechnicalFileUpload(
        dependencies,
        1,
        uploadInput(),
        uploadContext('technical-upload:key-2')
    );

    assert.equal(first.capabilityId, UPLOAD_CAPABILITY_ID);
    assert.equal(first.auditIds.length, 2);
    assert.equal(first.technicalFile.id, 1);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(duplicate.deduplicated, true);
    assert.equal(duplicate.technicalFile.id, first.technicalFile.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM factory_files').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_technical_files').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 2);
});

test('配方技术档案上传版本冲突不留下文件、附件、审计或 operation', () => {
    const { db, dependencies } = createFixture();

    assert.throws(
        () => executeRecipeTechnicalFileUpload(
            dependencies,
            1,
            uploadInput({ expectedUpdatedAt: '2026-08-02T00:00:00.000Z' }),
            uploadContext()
        ),
        error => error.code === 'resource_version_conflict'
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM factory_files').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_technical_files').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
});

test('配方技术档案删除使用文件版本、持久幂等和强审计', () => {
    const { db, dependencies } = createFixture();
    const upload = executeRecipeTechnicalFileUpload(
        dependencies,
        1,
        uploadInput(),
        uploadContext()
    );
    const result = executeRecipeTechnicalFileDelete(
        dependencies,
        1,
        upload.technicalFile.id,
        { expectedUpdatedAt: upload.technicalFile.updatedAt },
        deleteContext()
    );
    const replay = executeRecipeTechnicalFileDelete(
        dependencies,
        1,
        upload.technicalFile.id,
        { expectedUpdatedAt: upload.technicalFile.updatedAt },
        deleteContext()
    );

    assert.equal(result.capabilityId, DELETE_CAPABILITY_ID);
    assert.equal(result.deleted, 1);
    assert.equal(result.auditIds.length, 1);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(
        db.prepare('SELECT deleted_at FROM recipe_technical_files WHERE id = 1').get().deleted_at,
        result.deletedAt
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 3);
});

test('配方技术档案删除缺少强审计时整体回滚', () => {
    const { db, dependencies } = createFixture();
    const upload = executeRecipeTechnicalFileUpload(
        dependencies,
        1,
        uploadInput(),
        uploadContext()
    );
    const unsafeDependencies = {
        ...dependencies,
        safeUpdate(table, id, updates) {
            db.prepare(`
                UPDATE ${table}
                SET deleted_at = ?, updated_at = ?
                WHERE id = ?
            `).run(updates.deleted_at, NEXT_AT, id);
            return { changes: 1, auditId: null };
        },
    };

    assert.throws(
        () => executeRecipeTechnicalFileDelete(
            unsafeDependencies,
            1,
            upload.technicalFile.id,
            { expectedUpdatedAt: upload.technicalFile.updatedAt },
            deleteContext()
        ),
        error => error.code === 'strong_audit_required'
    );
    assert.equal(
        db.prepare('SELECT deleted_at FROM recipe_technical_files WHERE id = 1').get().deleted_at,
        null
    );
    assert.equal(
        db.prepare(`
            SELECT COUNT(*) AS count
            FROM api_operations
            WHERE capability_id = ?
        `).get(DELETE_CAPABILITY_ID).count,
        0
    );
});
