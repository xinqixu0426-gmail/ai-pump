const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    BATCH_PRICE_CAPABILITY_ID,
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    buildPartPricePreview,
    executePartCreate,
    executePartDelete,
    executePartPriceBatch,
    executePartUpdate,
} = require('../api/services/partCommands.cjs');

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
        assert.equal(table, 'parts');
        const columns = Object.keys(updates);
        const updatedAt = nextUpdatedAt();
        const result = db.prepare(`
            UPDATE parts
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
