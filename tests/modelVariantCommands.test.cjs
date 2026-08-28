const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installBusinessChangeSchema } = require('./helpers/businessChangeSchema.cjs');
const {
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    executeModelVariantCreate,
    executeModelVariantDelete,
    executeModelVariantUpdate,
} = require('../api/services/modelVariantCommands.cjs');

function createFixture() {
    const db = new Database(':memory:');
    installBusinessChangeSchema(db);
    db.exec(`
        PRAGMA foreign_keys = ON;
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
        CREATE TABLE pump_shell_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shell_model TEXT,
            parts_json TEXT DEFAULT '[]',
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE pump_model_variants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model_name TEXT NOT NULL UNIQUE,
            template_id INTEGER NOT NULL,
            coil_spec TEXT DEFAULT '',
            coil_sheets INTEGER DEFAULT 0,
            coil_material TEXT DEFAULT '钢带',
            coil_slot_type TEXT DEFAULT '小眼',
            barrel_length REAL,
            long_screw_extra_length REAL DEFAULT 0,
            impeller_model TEXT DEFAULT '',
            impeller_thickness REAL,
            impeller_diameter REAL,
            impeller_blade_count INTEGER,
            note TEXT DEFAULT '',
            custom_fields_json TEXT DEFAULT '[]',
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT,
            FOREIGN KEY(template_id) REFERENCES pump_shell_templates(id)
        );
        CREATE TABLE parts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model TEXT,
            category TEXT,
            price REAL,
            supplier TEXT,
            stock REAL,
            remark TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
    `);
    db.prepare(`
        INSERT INTO pump_shell_templates (
            shell_model, parts_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?)
    `).run(
        '测试泵壳',
        JSON.stringify([
            {
                model: '6*170',
                name: '不锈钢长螺丝',
                supplier: '',
                qty: 4,
            },
        ]),
        '2026-08-03T03:00:00.000Z',
        '2026-08-03T03:00:00.000Z'
    );

    let sequence = 0;
    let invalidateCount = 0;
    function updatedAt() {
        sequence += 1;
        return new Date(Date.UTC(2026, 7, 3, 3, 0, sequence)).toISOString();
    }
    function writeAudit(table, recordId, context) {
        const result = db.prepare(`
            INSERT INTO audit_log (
                table_name, record_id, request_id,
                operation_id, capability_id, user
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            table,
            recordId,
            context?.requestId || null,
            context?.operationId || null,
            context?.capabilityId || null,
            context?.user || null
        );
        return Number(result.lastInsertRowid);
    }
    function safeInsert(table, values, context) {
        const columns = Object.keys(values);
        const result = db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
        return {
            ...result,
            auditId: writeAudit(
                table,
                Number(result.lastInsertRowid),
                context
            ),
        };
    }
    function safeUpdate(table, id, updates, context) {
        const columns = Object.keys(updates);
        const nextUpdatedAt = updatedAt();
        const result = db.prepare(`
            UPDATE ${table}
            SET ${columns.map(column => `${column} = ?`).join(', ')},
                updated_at = ?
            WHERE id = ?
        `).run(
            ...columns.map(column => updates[column]),
            nextUpdatedAt,
            id
        );
        return {
            ...result,
            auditId: writeAudit(table, id, context),
        };
    }
    function modelVariantRow(row) {
        if (!row) return row;
        return {
            id: row.id,
            modelName: row.model_name,
            templateId: row.template_id,
            coilSpec: row.coil_spec,
            coilSheets: row.coil_sheets,
            coilMaterial: row.coil_material,
            coilSlotType: row.coil_slot_type,
            barrelLength: row.barrel_length,
            longScrewExtraLength: row.long_screw_extra_length,
            note: row.note,
            customFieldsJson: row.custom_fields_json,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    function partRow(row) {
        if (!row) return row;
        return {
            id: row.id,
            model: row.model,
            category: row.category,
            price: row.price,
            supplier: row.supplier,
            stock: row.stock,
            notes: row.remark,
        };
    }

    return {
        db,
        dependencies: {
            db,
            safeInsert,
            safeUpdate,
            modelVariantRow,
            partRow,
            invalidatePartsCache() {
                invalidateCount += 1;
            },
        },
        getInvalidateCount() {
            return invalidateCount;
        },
    };
}

function commandContext(capabilityId, suffix) {
    return {
        capabilityId,
        actorKey: 'jwt:model-variant-test',
        idempotencyKey: `model-variant:command:${suffix}`,
        operationId: `model-variant-operation-${suffix}`,
        requestId: `model-variant-request-${suffix}`,
        warnings: [],
    };
}

function variantInput(overrides = {}) {
    return {
        modelName: 'V750 常用配置',
        templateId: 1,
        coilSpec: '12',
        coilSheets: 140,
        coilMaterial: '钢带',
        coilSlotType: '小眼',
        barrelLength: 200,
        longScrewExtraLength: 10,
        impellerModel: '120-8',
        note: '自动验收',
        customFieldsJson: JSON.stringify([
            { label: '地区', value: '测试' },
        ]),
        ...overrides,
    };
}

test('常用配置新增、长螺丝沉淀和 operation 回执原子提交且可安全重放', () => {
    const fixture = createFixture();
    const context = commandContext(CREATE_CAPABILITY_ID, 'create');
    const result = executeModelVariantCreate(
        fixture.dependencies,
        variantInput(),
        context
    );

    assert.equal(result.capabilityId, CREATE_CAPABILITY_ID);
    assert.equal(result.variant.modelName, 'V750 常用配置');
    assert.equal(
        fixture.db.prepare('SELECT model_name FROM pump_model_variants WHERE id = ?').get(result.variant.id).model_name,
        'V750 常用配置'
    );
    assert.equal(result.createdLongScrewParts.length, 1);
    assert.equal(result.createdLongScrewParts[0].model, '6*210');
    assert.equal(result.auditIds.length, 2);
    assert.equal(fixture.getInvalidateCount(), 1);
    assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM parts').get().count,
        1
    );

    const replay = executeModelVariantCreate(
        fixture.dependencies,
        variantInput(),
        context
    );
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.variant.id, result.variant.id);
    assert.equal(
        fixture.db.prepare(
            'SELECT COUNT(*) AS count FROM pump_model_variants'
        ).get().count,
        1
    );
    assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM parts').get().count,
        1
    );
});

test('常用配置修改和软删除使用资源版本并保留历史引用记录', () => {
    const fixture = createFixture();
    const created = executeModelVariantCreate(
        fixture.dependencies,
        variantInput({ barrelLength: null }),
        commandContext(CREATE_CAPABILITY_ID, 'version-create')
    );
    const originalVersion = created.variant.updatedAt;
    const updated = executeModelVariantUpdate(
        fixture.dependencies,
        created.variant.id,
        variantInput({
            barrelLength: 220,
            expectedUpdatedAt: originalVersion,
        }),
        commandContext(UPDATE_CAPABILITY_ID, 'version-update')
    );
    assert.equal(updated.variant.barrelLength, 220);
    assert.equal(updated.createdLongScrewParts[0].model, '6*230');
    assert.notEqual(updated.variant.updatedAt, originalVersion);

    assert.throws(
        () => executeModelVariantUpdate(
            fixture.dependencies,
            created.variant.id,
            variantInput({
                note: '过期覆盖',
                expectedUpdatedAt: originalVersion,
            }),
            commandContext(UPDATE_CAPABILITY_ID, 'stale-update')
        ),
        error => error?.code === 'resource_version_conflict'
    );

    const deleted = executeModelVariantDelete(
        fixture.dependencies,
        created.variant.id,
        { expectedUpdatedAt: updated.variant.updatedAt },
        commandContext(DELETE_CAPABILITY_ID, 'delete')
    );
    assert.equal(deleted.deleted, 1);
    assert.ok(
        fixture.db.prepare(`
            SELECT deleted_at
            FROM pump_model_variants
            WHERE id = ?
        `).get(created.variant.id).deleted_at
    );

    const replay = executeModelVariantDelete(
        fixture.dependencies,
        created.variant.id,
        { expectedUpdatedAt: updated.variant.updatedAt },
        commandContext(DELETE_CAPABILITY_ID, 'delete')
    );
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.modelVariantId, created.variant.id);
});

test('常用配置自动沉淀零件缺少强审计时整笔回滚', () => {
    const fixture = createFixture();
    const normalSafeInsert = fixture.dependencies.safeInsert;
    fixture.dependencies.safeInsert = (table, values, context) => {
        const write = normalSafeInsert(table, values, context);
        return table === 'parts' ? { ...write, auditId: null } : write;
    };

    assert.throws(
        () => executeModelVariantCreate(
            fixture.dependencies,
            variantInput(),
            commandContext(CREATE_CAPABILITY_ID, 'audit-rollback')
        ),
        error => error?.code === 'strong_audit_required'
    );
    assert.equal(
        fixture.db.prepare(
            'SELECT COUNT(*) AS count FROM pump_model_variants'
        ).get().count,
        0
    );
    assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM parts').get().count,
        0
    );
    assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations')
            .get().count,
        0
    );
    assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()
            .count,
        0
    );
});
