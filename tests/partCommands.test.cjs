const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installBusinessChangeSchema } = require('./helpers/businessChangeSchema.cjs');
const {
    BATCH_CREATE_CAPABILITY_ID,
    BATCH_DELETE_CAPABILITY_ID,
    BATCH_PRICE_CAPABILITY_ID,
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    PROFILE_SAVE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    buildPartBatchCreatePreview,
    buildPartBatchDeletePreview,
    buildPartDeletePreview,
    buildPartProfileSavePreview,
    buildPartPricePreview,
    executeConfirmedPartBatchCreate,
    executeConfirmedPartBatchDelete,
    executeConfirmedPartProfileSave,
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
        CREATE TABLE system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
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

    function setSetting(key, value, context) {
        const current = db.prepare(
            'SELECT key, value, updated_at FROM system_settings WHERE key = ?'
        ).get(key);
        const updatedAt = nextUpdatedAt();
        db.prepare(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(key, String(value), updatedAt);
        return {
            key,
            value: String(value),
            updatedAt,
            auditId: writeAudit('system_settings', null, context),
            created: !current,
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
        setSetting,
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
                {
                    expectedUpdatedAt: created.part.updatedAt,
                    previewHash: '0'.repeat(64),
                },
                commandContext(DELETE_CAPABILITY_ID, 'delete-stale')
            ),
            error => error.code === 'resource_version_conflict'
        );
        const deletePreview = buildPartDeletePreview(
            fixture.dependencies,
            created.part.id,
            { expectedUpdatedAt: updated.part.updatedAt }
        );
        assert.equal(deletePreview.preview, true);
        assert.equal(deletePreview.capabilityId, DELETE_CAPABILITY_ID);
        assert.equal(deletePreview.target.id, created.part.id);
        assert.equal(deletePreview.target.model, input.model);
        assert.equal(deletePreview.normalizedInput.expectedUpdatedAt, updated.part.updatedAt);
        assert.ok(deletePreview.previewHash);
        assert.equal(fixture.db.prepare('SELECT deleted_at FROM parts WHERE id = ?')
            .get(created.part.id).deleted_at, null);
        const deleted = executePartDelete(
            fixture.dependencies,
            created.part.id,
            {
                expectedUpdatedAt: updated.part.updatedAt,
                previewHash: deletePreview.previewHash,
            },
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

test('零件删除预览绑定版本和哈希，漂移或错误哈希时零副作用', () => {
    const fixture = createFixture();
    try {
        const seeded = seedPart(fixture, 'DELETE-PREVIEW-PART', 10);
        const preview = buildPartDeletePreview(
            fixture.dependencies,
            seeded.part.id,
            { expectedUpdatedAt: seeded.part.updatedAt }
        );
        assert.equal(preview.target.supplier, '供应商A');
        assert.equal(preview.impact.recipeSnapshotsChanged, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 1);

        assert.throws(
            () => executePartDelete(
                fixture.dependencies,
                seeded.part.id,
                {
                    expectedUpdatedAt: seeded.part.updatedAt,
                    previewHash: '0'.repeat(64),
                },
                commandContext(DELETE_CAPABILITY_ID, 'delete-bad-hash')
            ),
            error => error.code === 'preview_changed'
        );
        assert.equal(
            fixture.db.prepare('SELECT deleted_at FROM parts WHERE id = ?').get(seeded.part.id).deleted_at,
            null
        );
        assert.equal(
            fixture.db.prepare("SELECT COUNT(*) AS count FROM api_operations WHERE capability_id = 'parts.delete'").get().count,
            0
        );
    } finally {
        fixture.db.close();
    }
});

test('零件删除正式命令缺少版本或预览哈希时 fail-closed 且零副作用', () => {
    const fixture = createFixture();
    try {
        const seeded = seedPart(fixture, 'DELETE-REQUIRES-PREVIEW', 10);
        for (const [input, code] of [
            [{ previewHash: '0'.repeat(64) }, 'part_delete_version_required'],
            [{ expectedUpdatedAt: seeded.part.updatedAt }, 'part_delete_preview_required'],
        ]) {
            assert.throws(
                () => executePartDelete(
                    fixture.dependencies,
                    seeded.part.id,
                    input,
                    commandContext(DELETE_CAPABILITY_ID, `delete-missing-${code}`)
                ),
                error => error.code === code
            );
        }
        assert.equal(
            fixture.db.prepare('SELECT deleted_at FROM parts WHERE id = ?').get(seeded.part.id).deleted_at,
            null
        );
        assert.equal(
            fixture.db.prepare("SELECT COUNT(*) AS count FROM api_operations WHERE capability_id = 'parts.delete'").get().count,
            0
        );
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

test('零件资料整单保存将目标库存、资料和业务设置原子提交并安全重放', () => {
    resetBusinessConfirmationsForTests();
    const fixture = createFixture();
    try {
        fixture.db.prepare(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES ('float_accessory_delta', '1.5', '2026-08-01T00:00:00.000Z')
        `).run();
        const created = seedPart(fixture, 'PROFILE-1', 10);
        const preview = buildPartProfileSavePreview(
            fixture.dependencies,
            created.part.id,
            {
                model: 'PROFILE-1A',
                category: '浮球',
                price: 12,
                supplier: '供应商A',
                stock: 9,
                notes: '整单保存',
                expectedUpdatedAt: created.part.updatedAt,
                businessSettings: [{
                    key: 'float_accessory_delta',
                    value: '2.5',
                    expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
                }],
            },
            'jwt:part-test'
        );
        const context = {
            ...commandContext(PROFILE_SAVE_CAPABILITY_ID, 'profile-save'),
            idempotencyKey: preview.suggestedIdempotencyKey,
        };
        const saved = executeConfirmedPartProfileSave(
            fixture.dependencies,
            created.part.id,
            { confirmationToken: preview.confirmationToken },
            context,
            'jwt:part-test'
        );
        const replay = executeConfirmedPartProfileSave(
            fixture.dependencies,
            created.part.id,
            { confirmationToken: preview.confirmationToken },
            context,
            'jwt:part-test'
        );
        assert.equal(saved.part.model, 'PROFILE-1A');
        assert.equal(saved.part.stock, 9);
        assert.equal(saved.part.price, 12);
        assert.equal(saved.businessSettings[0].value, '2.5');
        assert.equal(saved.auditIds.length, 2);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare('SELECT stock FROM parts WHERE id = ?').get(created.part.id).stock,
            9
        );
        assert.equal(
            fixture.db.prepare("SELECT value FROM system_settings WHERE key = 'float_accessory_delta'").get().value,
            '2.5'
        );
    } finally {
        fixture.db.close();
        resetBusinessConfirmationsForTests();
    }
});

test('零件新建将表单业务设置同事务提交，设置失败时不留下零件或 operation', () => {
    const fixture = createFixture();
    try {
        fixture.db.prepare(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES ('cable_accessories', ?, '2026-08-01T00:00:00.000Z')
        `).run(JSON.stringify({
            standard: { name: '旧标准附件', fee: 1 },
            xinjie: { name: '旧鑫捷附件', fee: 2 },
        }));
        const nextCableAccessories = JSON.stringify({
            standard: { name: '新标准附件', fee: 3 },
            xinjie: { name: '新鑫捷附件', fee: 4 },
        });
        const input = {
            model: 'CREATE-WITH-SETTING',
            category: '电缆',
            price: 8,
            supplier: '供应商A',
            stock: 2,
            duplicatePolicy: 'reject',
            businessSettings: [{
                key: 'cable_accessories',
                value: nextCableAccessories,
                expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
            }],
        };
        const context = commandContext(CREATE_CAPABILITY_ID, 'create-with-setting');
        const created = executePartCreate(fixture.dependencies, input, context);
        const replay = executePartCreate(fixture.dependencies, input, context);
        assert.equal(created.part.model, input.model);
        assert.equal(created.businessSettings[0].value, nextCableAccessories);
        assert.equal(created.auditIds.length, 2);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM parts WHERE model = ?')
                .get(input.model).count,
            1
        );

        const failingDependencies = {
            ...fixture.dependencies,
            setSetting() {
                throw new Error('injected create setting failure');
            },
        };
        const failingInput = {
            ...input,
            model: 'CREATE-WITH-SETTING-ROLLBACK',
            businessSettings: [{
                ...input.businessSettings[0],
                expectedUpdatedAt: fixture.db.prepare(
                    "SELECT updated_at FROM system_settings WHERE key = 'cable_accessories'"
                ).get().updated_at,
            }],
        };
        assert.throws(
            () => executePartCreate(
                failingDependencies,
                failingInput,
                commandContext(CREATE_CAPABILITY_ID, 'create-setting-rollback')
            ),
            /injected create setting failure/
        );
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM parts WHERE model = ?')
                .get(failingInput.model).count,
            0
        );
        assert.equal(
            fixture.db.prepare("SELECT value FROM system_settings WHERE key = 'cable_accessories'").get().value,
            nextCableAccessories
        );
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) AS count FROM api_operations
                WHERE idempotency_key = 'part:command:create-setting-rollback'
            `).get().count,
            0
        );
    } finally {
        fixture.db.close();
    }
});

test('零件资料整单保存的设置写失败会回滚已经执行的零件更新', () => {
    resetBusinessConfirmationsForTests();
    const fixture = createFixture();
    try {
        fixture.db.prepare(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES ('float_accessory_delta', '1.5', '2026-08-01T00:00:00.000Z')
        `).run();
        const created = seedPart(fixture, 'PROFILE-ROLLBACK', 10);
        const preview = buildPartProfileSavePreview(
            fixture.dependencies,
            created.part.id,
            {
                model: created.part.model,
                category: '浮球',
                price: 15,
                supplier: created.part.supplier,
                stock: 11,
                expectedUpdatedAt: created.part.updatedAt,
                businessSettings: [{
                    key: 'float_accessory_delta',
                    value: '3.5',
                    expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
                }],
            },
            'jwt:part-test'
        );
        const failingDependencies = {
            ...fixture.dependencies,
            setSetting() {
                throw new Error('injected setting failure');
            },
        };
        assert.throws(
            () => executeConfirmedPartProfileSave(
                failingDependencies,
                created.part.id,
                { confirmationToken: preview.confirmationToken },
                {
                    ...commandContext(PROFILE_SAVE_CAPABILITY_ID, 'profile-rollback'),
                    idempotencyKey: preview.suggestedIdempotencyKey,
                },
                'jwt:part-test'
            ),
            /injected setting failure/
        );
        const current = fixture.db.prepare('SELECT price, stock FROM parts WHERE id = ?')
            .get(created.part.id);
        assert.deepEqual(current, { price: 10, stock: 5 });
        assert.equal(
            fixture.db.prepare("SELECT value FROM system_settings WHERE key = 'float_accessory_delta'").get().value,
            '1.5'
        );
    } finally {
        fixture.db.close();
        resetBusinessConfirmationsForTests();
    }
});

test('零件资料整单保存拒绝过期预览，资料写失败时设置和 operation 均不改变', () => {
    resetBusinessConfirmationsForTests();
    const fixture = createFixture();
    try {
        fixture.db.prepare(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES ('float_accessory_delta', '1.5', '2026-08-01T00:00:00.000Z')
        `).run();
        const created = seedPart(fixture, 'PROFILE-FAILURES', 10);
        const input = {
            model: created.part.model,
            category: '浮球',
            price: 15,
            supplier: created.part.supplier,
            stock: 11,
            expectedUpdatedAt: created.part.updatedAt,
            businessSettings: [{
                key: 'float_accessory_delta',
                value: '3.5',
                expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
            }],
        };
        const stalePreview = buildPartProfileSavePreview(
            fixture.dependencies,
            created.part.id,
            input,
            'jwt:part-test'
        );
        executePartUpdate(
            fixture.dependencies,
            created.part.id,
            { price: 12, expectedUpdatedAt: created.part.updatedAt },
            commandContext(UPDATE_CAPABILITY_ID, 'profile-stale-change')
        );
        assert.throws(
            () => executeConfirmedPartProfileSave(
                fixture.dependencies,
                created.part.id,
                { confirmationToken: stalePreview.confirmationToken },
                {
                    ...commandContext(PROFILE_SAVE_CAPABILITY_ID, 'profile-stale'),
                    idempotencyKey: stalePreview.suggestedIdempotencyKey,
                },
                'jwt:part-test'
            ),
            error => error.code === 'resource_version_conflict'
        );
        assert.deepEqual(
            fixture.db.prepare('SELECT price, stock FROM parts WHERE id = ?').get(created.part.id),
            { price: 12, stock: 5 }
        );
        assert.equal(
            fixture.db.prepare("SELECT value FROM system_settings WHERE key = 'float_accessory_delta'").get().value,
            '1.5'
        );

        const current = fixture.db.prepare('SELECT updated_at FROM parts WHERE id = ?')
            .get(created.part.id);
        const writeFailurePreview = buildPartProfileSavePreview(
            fixture.dependencies,
            created.part.id,
            { ...input, expectedUpdatedAt: current.updated_at },
            'jwt:part-test'
        );
        const failingDependencies = {
            ...fixture.dependencies,
            safeUpdate() {
                throw new Error('injected profile write failure');
            },
        };
        assert.throws(
            () => executeConfirmedPartProfileSave(
                failingDependencies,
                created.part.id,
                { confirmationToken: writeFailurePreview.confirmationToken },
                {
                    ...commandContext(PROFILE_SAVE_CAPABILITY_ID, 'profile-write-failure'),
                    idempotencyKey: writeFailurePreview.suggestedIdempotencyKey,
                },
                'jwt:part-test'
            ),
            /injected profile write failure/
        );
        assert.deepEqual(
            fixture.db.prepare('SELECT price, stock FROM parts WHERE id = ?').get(created.part.id),
            { price: 12, stock: 5 }
        );
        assert.equal(
            fixture.db.prepare("SELECT value FROM system_settings WHERE key = 'float_accessory_delta'").get().value,
            '1.5'
        );
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) AS count FROM api_operations
                WHERE idempotency_key IN (
                    'part:command:profile-stale',
                    'part:command:profile-write-failure'
                )
            `).get().count,
            0
        );
    } finally {
        fixture.db.close();
        resetBusinessConfirmationsForTests();
    }
});

test('零件批量删除先完整校验版本，冲突时整批零删除，成功后支持幂等重放', () => {
    resetBusinessConfirmationsForTests();
    const fixture = createFixture();
    try {
        const first = seedPart(fixture, 'DELETE-BATCH-1', 10);
        const second = seedPart(fixture, 'DELETE-BATCH-2', 11);
        const parts = [first.part, second.part].map(part => ({
            partId: part.id,
            expectedUpdatedAt: part.updatedAt,
        }));
        const stalePreview = buildPartBatchDeletePreview(
            fixture.dependencies,
            { parts },
            'jwt:part-test'
        );
        executePartUpdate(
            fixture.dependencies,
            second.part.id,
            { price: 12, expectedUpdatedAt: second.part.updatedAt },
            commandContext(UPDATE_CAPABILITY_ID, 'batch-delete-conflict')
        );
        assert.throws(
            () => executeConfirmedPartBatchDelete(
                fixture.dependencies,
                { confirmationToken: stalePreview.confirmationToken },
                {
                    ...commandContext(BATCH_DELETE_CAPABILITY_ID, 'batch-delete-stale'),
                    idempotencyKey: stalePreview.suggestedIdempotencyKey,
                },
                'jwt:part-test'
            ),
            error => error.code === 'resource_version_conflict'
        );
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM parts WHERE deleted_at IS NULL').get().count,
            2
        );

        const currentRows = fixture.db.prepare(
            'SELECT id, updated_at FROM parts WHERE deleted_at IS NULL ORDER BY id'
        ).all();
        const preview = buildPartBatchDeletePreview(
            fixture.dependencies,
            {
                parts: currentRows.map(row => ({
                    partId: row.id,
                    expectedUpdatedAt: row.updated_at,
                })),
            },
            'jwt:part-test'
        );
        const context = {
            ...commandContext(BATCH_DELETE_CAPABILITY_ID, 'batch-delete'),
            idempotencyKey: preview.suggestedIdempotencyKey,
        };
        const deleted = executeConfirmedPartBatchDelete(
            fixture.dependencies,
            { confirmationToken: preview.confirmationToken },
            context,
            'jwt:part-test'
        );
        const replay = executeConfirmedPartBatchDelete(
            fixture.dependencies,
            { confirmationToken: preview.confirmationToken },
            context,
            'jwt:part-test'
        );
        assert.equal(deleted.deletedCount, 2);
        assert.equal(deleted.auditIds.length, 2);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM parts WHERE deleted_at IS NULL').get().count,
            0
        );
    } finally {
        fixture.db.close();
        resetBusinessConfirmationsForTests();
    }
});
