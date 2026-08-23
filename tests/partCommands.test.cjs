const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installBusinessChangeSchema } = require('./helpers/businessChangeSchema.cjs');
const {
    BATCH_CREATE_CAPABILITY_ID,
    BATCH_PRICE_CAPABILITY_ID,
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    buildPartBatchCreatePreview,
    buildPartPricePreview,
    executeConfirmedPartBatchCreate,
    executePartCreate,
    executePartDelete,
    executePartPriceBatch,
    executePartUpdate,
} = require('../api/services/partCommands.cjs');
const {
    resetBusinessConfirmationsForTests,
} = require('../api/services/businessConfirmation.cjs');

function createFixture() {
    const db = new Database(':memory:');
    installBusinessChangeSchema(db);
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
            table_name TEXT,
            record_id INTEGER,
            request_id TEXT,
            operation_id TEXT,
            capability_id TEXT,
            user TEXT
        );
        CREATE TABLE parts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model TEXT,
            category TEXT,
            subcategory TEXT DEFAULT '',
            price REAL,
            supplier TEXT,
            stock REAL,
            remark TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE pump_shell_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shell_model TEXT UNIQUE,
            updated_at TEXT
        );
    `);
    let version = 0;

    function nextUpdatedAt() {
        version += 1;
        return new Date(Date.UTC(2026, 7, 3, 0, 0, version)).toISOString();
    }

    function writeAudit(table, recordId, context) {
        const result = db.prepare(`
            INSERT INTO audit_log (
                table_name, record_id, request_id, operation_id, capability_id, user
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            table,
            recordId,
            context?.requestId || null,
            context?.operationId || null,
            context?.capabilityId || null,
            context?.user || 'system'
        );
        return Number(result.lastInsertRowid);
    }

    function safeInsert(table, values, context) {
        assert.equal(table, 'parts');
        const columns = Object.keys(values);
        const result = db.prepare(`
            INSERT INTO parts (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
        return {
            ...result,
            auditId: writeAudit(table, Number(result.lastInsertRowid), context),
        };
    }

    function safeUpdate(table, id, updates, context) {
        assert.ok(['parts', 'pump_shell_templates'].includes(table));
        const columns = Object.keys(updates);
        const updatedAt = nextUpdatedAt();
        const result = db.prepare(`
            UPDATE ${table}
            SET ${columns.map(column => `${column} = ?`).join(', ')}, updated_at = ?
            WHERE id = ?
        `).run(...columns.map(column => updates[column]), updatedAt, id);
        return {
            ...result,
            auditId: writeAudit(table, id, context),
        };
    }

    const dependencies = {
        db,
        extractPartFields(body) {
            return {
                model: body.model || '',
                category: body.category || '其他',
                subcategory: body.subcategory || '',
                price: body.price ?? 0,
                supplier: body.supplier || '-',
                stock: body.stock ?? 0,
                remark: body.notes || body.remark || '',
            };
        },
        partRow(row) {
            return {
                id: row.id,
                model: row.model,
                category: row.category,
                subcategory: row.subcategory,
                price: row.price,
                supplier: row.supplier,
                stock: row.stock,
                remark: row.remark,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                deletedAt: row.deleted_at,
            };
        },
        safeInsert,
        safeUpdate,
    };
    return { db, dependencies };
}

function commandContext(capabilityId, suffix) {
    return {
        capabilityId,
        actorKey: 'jwt:part-test',
        idempotencyKey: `part:command:${suffix}`,
        operationId: `part-operation-${suffix}`,
        requestId: `part-request-${suffix}`,
        warnings: [],
    };
}

function seedPart(fixture, model = 'P-1', price = 10) {
    return executePartCreate(
        fixture.dependencies,
        {
            model,
            category: '标准件',
            subcategory: '',
            price,
            supplier: '供应商A',
            stock: 5,
        },
        commandContext(CREATE_CAPABILITY_ID, `seed-${model}`)
    );
}

test('零件 CRUD 使用持久幂等、资源版本和强审计并保持软删除', () => {
    const fixture = createFixture();
    try {
        const context = commandContext(CREATE_CAPABILITY_ID, 'create');
        const input = {
            model: 'P-CREATE',
            category: '包装',
            subcategory: '外包装',
            price: 12.5,
            supplier: '供应商A',
            stock: 3,
        };
        const created = executePartCreate(fixture.dependencies, input, context);
        const replay = executePartCreate(fixture.dependencies, input, context);
        assert.equal(created.capabilityId, CREATE_CAPABILITY_ID);
        assert.equal(created.part.subcategory, '外包装');
        assert.ok(created.auditId);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.part.id, created.part.id);

        const updated = executePartUpdate(
            fixture.dependencies,
            created.part.id,
            {
                price: 13.5,
                expectedUpdatedAt: created.part.updatedAt,
            },
            commandContext(UPDATE_CAPABILITY_ID, 'update')
        );
        assert.equal(updated.part.price, 13.5);
        assert.ok(updated.auditId);

        assert.throws(
            () => executePartDelete(
                fixture.dependencies,
                created.part.id,
                { expectedUpdatedAt: created.part.updatedAt },
                commandContext(DELETE_CAPABILITY_ID, 'delete-stale')
            ),
            error => error.code === 'resource_version_conflict'
        );
        const deleted = executePartDelete(
            fixture.dependencies,
            created.part.id,
            { expectedUpdatedAt: updated.part.updatedAt },
            commandContext(DELETE_CAPABILITY_ID, 'delete')
        );
        assert.equal(deleted.deleted, 1);
        assert.ok(deleted.auditId);
        assert.ok(fixture.db.prepare('SELECT deleted_at FROM parts WHERE id = ?')
            .get(created.part.id).deleted_at);
    } finally {
        fixture.db.close();
    }
});

test('零件单项新增在正式命令事务内阻止重复身份并允许不同供应商', () => {
    const fixture = createFixture();
    try {
        const original = executePartCreate(
            fixture.dependencies,
            {
                model: 'IDENTITY-1',
                category: '轴承',
                price: 8,
                supplier: '供应商A',
                stock: 0,
            },
            commandContext(CREATE_CAPABILITY_ID, 'identity-original')
        );
        assert.throws(
            () => executePartCreate(
                fixture.dependencies,
                {
                    model: 'identity-1',
                    category: '油封',
                    price: 9,
                    supplier: '供应商a',
                    stock: 0,
                    duplicatePolicy: 'reject',
                },
                commandContext(CREATE_CAPABILITY_ID, 'identity-conflict')
            ),
            error => error.code === 'part_identity_conflict' && error.statusCode === 409
        );
        const otherSupplier = executePartCreate(
            fixture.dependencies,
            {
                model: 'IDENTITY-1',
                category: '轴承',
                price: 10,
                supplier: '供应商B',
                stock: 0,
                duplicatePolicy: 'reject',
            },
            commandContext(CREATE_CAPABILITY_ID, 'identity-other-supplier')
        );
        assert.notEqual(otherSupplier.part.id, original.part.id);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM parts WHERE model = ? COLLATE NOCASE AND deleted_at IS NULL')
                .get('IDENTITY-1').count,
            2
        );
        const confirmedDuplicate = executePartCreate(
            fixture.dependencies,
            {
                model: 'IDENTITY-1',
                category: '轴承',
                price: 11,
                supplier: '供应商A',
                stock: 0,
            },
            commandContext(CREATE_CAPABILITY_ID, 'identity-confirmed-duplicate')
        );
        assert.notEqual(confirmedDuplicate.part.id, original.part.id);
    } finally {
        fixture.db.close();
    }
});

test('泵壳零件型号修改与关联模板在同一命令内同步', () => {
    const fixture = createFixture();
    try {
        const created = executePartCreate(
            fixture.dependencies,
            {
                model: 'V750-DY款-圆底脚',
                category: '泵壳',
                price: 98,
                supplier: '供应商A',
                stock: 0,
            },
            commandContext(CREATE_CAPABILITY_ID, 'create-shell')
        );
        const templateId = Number(fixture.db.prepare(`
            INSERT INTO pump_shell_templates (shell_model, updated_at)
            VALUES (?, ?)
        `).run('V750-DY款-圆底脚', '2026-08-03T00:00:00.000Z').lastInsertRowid);

        const updated = executePartUpdate(
            fixture.dependencies,
            created.part.id,
            {
                model: 'V750-DY款-圆底脚-12',
                expectedUpdatedAt: created.part.updatedAt,
            },
            commandContext(UPDATE_CAPABILITY_ID, 'rename-shell')
        );

        assert.deepEqual(updated.linkedTemplateIds, [templateId]);
        assert.equal(
            fixture.db.prepare('SELECT shell_model FROM pump_shell_templates WHERE id = ?')
                .get(templateId).shell_model,
            'V750-DY款-圆底脚-12'
        );
        assert.equal(updated.auditIds.length, 2);
        assert.ok(updated.changes.some(change => (
            change.resourceType === 'pump_shell_template'
            && change.resourceId === templateId
            && change.field === 'shellModel'
        )));
    } finally {
        fixture.db.close();
    }
});

test('旧型号仍有其他有效泵壳零件时不迁移关联模板', () => {
    const fixture = createFixture();
    try {
        const created = executePartCreate(
            fixture.dependencies,
            {
                model: 'V750-DY款-圆底脚',
                category: '泵壳',
                price: 98,
                supplier: '供应商A',
                stock: 0,
            },
            commandContext(CREATE_CAPABILITY_ID, 'create-shared-shell-a')
        );
        executePartCreate(
            fixture.dependencies,
            {
                model: 'V750-DY款-圆底脚',
                category: '泵壳',
                price: 99,
                supplier: '供应商B',
                stock: 0,
            },
            commandContext(CREATE_CAPABILITY_ID, 'create-shared-shell-b')
        );
        const templateId = Number(fixture.db.prepare(`
            INSERT INTO pump_shell_templates (shell_model, updated_at)
            VALUES (?, ?)
        `).run('V750-DY款-圆底脚', '2026-08-03T00:00:00.000Z').lastInsertRowid);

        const updated = executePartUpdate(
            fixture.dependencies,
            created.part.id,
            {
                model: 'V750-DY款-圆底脚-12',
                expectedUpdatedAt: created.part.updatedAt,
            },
            commandContext(UPDATE_CAPABILITY_ID, 'rename-one-shared-shell')
        );

        assert.deepEqual(updated.linkedTemplateIds, []);
        assert.equal(
            fixture.db.prepare('SELECT shell_model FROM pump_shell_templates WHERE id = ?')
                .get(templateId).shell_model,
            'V750-DY款-圆底脚'
        );
        assert.equal(updated.auditIds.length, 1);
    } finally {
        fixture.db.close();
    }
});

test('零件批量调价预览绑定逐项版本并支持整批幂等重放', () => {
    const fixture = createFixture();
    try {
        const first = seedPart(fixture, 'P-A', 10);
        const second = seedPart(fixture, 'P-B', 20);
        const preview = buildPartPricePreview(fixture.dependencies, {
            updates: [
                { partId: first.part.id, price: 11, expectedUpdatedAt: first.part.updatedAt },
                { partId: second.part.id, price: 22, expectedUpdatedAt: second.part.updatedAt },
            ],
        });
        assert.equal(preview.capabilityId, BATCH_PRICE_CAPABILITY_ID);
        assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
        assert.equal(preview.changes.length, 2);

        const input = {
            updates: preview.updates,
            previewHash: preview.previewHash,
        };
        const context = commandContext(BATCH_PRICE_CAPABILITY_ID, 'prices');
        const receipt = executePartPriceBatch(fixture.dependencies, input, context);
        const replay = executePartPriceBatch(fixture.dependencies, input, context);
        fixture.db.prepare('UPDATE parts SET deleted_at = ? WHERE id = ?')
            .run('2026-08-03T01:00:00.000Z', first.part.id);
        const replayAfterDelete = executePartPriceBatch(
            fixture.dependencies,
            input,
            context
        );
        assert.equal(receipt.updatedCount, 2);
        assert.equal(receipt.auditIds.length, 2);
        assert.equal(receipt.parts[0].price, 11);
        assert.equal(receipt.parts[1].price, 22);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.operationId, receipt.operationId);
        assert.equal(replayAfterDelete.idempotentReplay, true);
        assert.equal(replayAfterDelete.operationId, receipt.operationId);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 3);
    } finally {
        fixture.db.close();
    }
});

test('零件批量新增：同型号不同供应商可建档，现有同供应商跳过并整批幂等', () => {
    resetBusinessConfirmationsForTests();
    const fixture = createFixture();
    const subject = 'jwt:part-batch-create';
    try {
        seedPart(fixture, 'SEAL-1', 1);
        const preview = buildPartBatchCreatePreview(
            fixture.dependencies,
            {
                parts: [
                    {
                        model: 'SEAL-1',
                        category: '油封',
                        price: 1,
                        supplier: '供应商A',
                        stock: 0,
                    },
                    {
                        model: 'SEAL-1',
                        category: '油封',
                        price: 1.2,
                        supplier: '供应商B',
                        stock: 0,
                    },
                    {
                        model: 'SEAL-2',
                        category: '油封',
                        price: 1.5,
                        supplier: '供应商A',
                        stock: 0,
                    },
                ],
            },
            subject
        );
        assert.equal(preview.capabilityId, BATCH_CREATE_CAPABILITY_ID);
        assert.equal(preview.preview, true);
        assert.equal(preview.requestedCount, 3);
        assert.equal(preview.createCount, 2);
        assert.equal(preview.skippedCount, 1);
        assert.match(preview.confirmationToken, /^[A-Za-z0-9_-]{40,128}$/);

        const context = commandContext(BATCH_CREATE_CAPABILITY_ID, 'batch-create');
        const input = { confirmationToken: preview.confirmationToken };
        const receipt = executeConfirmedPartBatchCreate(
            fixture.dependencies,
            input,
            context,
            subject
        );
        const replay = executeConfirmedPartBatchCreate(
            fixture.dependencies,
            input,
            context,
            subject
        );
        assert.equal(receipt.createdCount, 2);
        assert.equal(receipt.auditIds.length, 2);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) AS count FROM parts WHERE deleted_at IS NULL'
            ).get().count,
            3
        );
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) AS count FROM parts WHERE model = ? AND deleted_at IS NULL'
            ).get('SEAL-1').count,
            2
        );
    } finally {
        fixture.db.close();
        resetBusinessConfirmationsForTests();
    }
});

test('零件批量新增：预览后身份冲突或强审计缺失时整批回滚', () => {
    resetBusinessConfirmationsForTests();
    const fixture = createFixture();
    const subject = 'jwt:part-batch-create-conflict';
    try {
        const conflictPreview = buildPartBatchCreatePreview(
            fixture.dependencies,
            {
                parts: [
                    { model: 'BATCH-A', price: 1, supplier: 'S' },
                    { model: 'BATCH-B', price: 2, supplier: 'S' },
                ],
            },
            subject
        );
        fixture.dependencies.safeInsert('parts', {
            model: 'BATCH-A',
            category: '其他',
            subcategory: '',
            price: 1,
            supplier: 'S',
            stock: 0,
            remark: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }, {});
        assert.throws(
            () => executeConfirmedPartBatchCreate(
                fixture.dependencies,
                { confirmationToken: conflictPreview.confirmationToken },
                commandContext(BATCH_CREATE_CAPABILITY_ID, 'batch-conflict'),
                subject
            ),
            error => error.code === 'part_batch_snapshot_conflict'
        );
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) AS count FROM parts WHERE model = ?'
            ).get('BATCH-B').count,
            0
        );

        const auditPreview = buildPartBatchCreatePreview(
            fixture.dependencies,
            {
                parts: [
                    { model: 'BATCH-C', price: 3, supplier: 'S' },
                    { model: 'BATCH-D', price: 4, supplier: 'S' },
                ],
            },
            subject
        );
        const originalSafeInsert = fixture.dependencies.safeInsert;
        let inserts = 0;
        fixture.dependencies.safeInsert = (...args) => {
            inserts += 1;
            const result = originalSafeInsert(...args);
            return inserts === 2 ? { ...result, auditId: null } : result;
        };
        assert.throws(
            () => executeConfirmedPartBatchCreate(
                fixture.dependencies,
                { confirmationToken: auditPreview.confirmationToken },
                commandContext(BATCH_CREATE_CAPABILITY_ID, 'batch-audit'),
                subject
            ),
            error => error.code === 'strong_audit_required'
        );
        assert.equal(
            fixture.db.prepare(
                "SELECT COUNT(*) AS count FROM parts WHERE model IN ('BATCH-C', 'BATCH-D')"
            ).get().count,
            0
        );
    } finally {
        fixture.db.close();
        resetBusinessConfirmationsForTests();
    }
});

test('零件批量调价版本冲突或强审计缺失时不产生部分写入', () => {
    const fixture = createFixture();
    try {
        const seeded = seedPart(fixture, 'P-CONFLICT', 10);
        const preview = buildPartPricePreview(fixture.dependencies, {
            updates: [{
                partId: seeded.part.id,
                price: 15,
                expectedUpdatedAt: seeded.part.updatedAt,
            }],
        });
        executePartUpdate(
            fixture.dependencies,
            seeded.part.id,
            {
                remark: '版本变化',
                expectedUpdatedAt: seeded.part.updatedAt,
            },
            commandContext(UPDATE_CAPABILITY_ID, 'version-change')
        );
        assert.throws(
            () => executePartPriceBatch(
                fixture.dependencies,
                { updates: preview.updates, previewHash: preview.previewHash },
                commandContext(BATCH_PRICE_CAPABILITY_ID, 'stale-price')
            ),
            error => error.code === 'resource_version_conflict'
        );
        assert.equal(fixture.db.prepare('SELECT price FROM parts WHERE id = ?')
            .get(seeded.part.id).price, 10);

        const current = fixture.db.prepare('SELECT updated_at FROM parts WHERE id = ?')
            .get(seeded.part.id);
        const auditPreview = buildPartPricePreview(fixture.dependencies, {
            updates: [{
                partId: seeded.part.id,
                price: 18,
                expectedUpdatedAt: current.updated_at,
            }],
        });
        const originalSafeUpdate = fixture.dependencies.safeUpdate;
        fixture.dependencies.safeUpdate = (...args) => {
            const result = originalSafeUpdate(...args);
            return { ...result, auditId: null };
        };
        assert.throws(
            () => executePartPriceBatch(
                fixture.dependencies,
                {
                    updates: auditPreview.updates,
                    previewHash: auditPreview.previewHash,
                },
                commandContext(BATCH_PRICE_CAPABILITY_ID, 'missing-audit')
            ),
            error => error.code === 'strong_audit_required'
        );
        assert.equal(fixture.db.prepare('SELECT price FROM parts WHERE id = ?')
            .get(seeded.part.id).price, 10);
        assert.equal(fixture.db.prepare(`
            SELECT COUNT(*) AS count FROM api_operations
            WHERE idempotency_key IN ('part:command:stale-price', 'part:command:missing-audit')
        `).get().count, 0);
    } finally {
        fixture.db.close();
    }
});
