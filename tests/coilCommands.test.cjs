const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installBusinessChangeSchema } = require('./helpers/businessChangeSchema.cjs');
const {
    BATCH_UNIT_PRICE_CAPABILITY_ID,
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    buildCoilUnitPricePreview,
    executeCoilCreate,
    executeCoilDelete,
    executeCoilUnitPriceBatch,
    executeCoilUpdate,
} = require('../api/services/coilCommands.cjs');
const {
    assertCoilCanBeDeleted,
    assertCoilIdentityEditable,
} = require('../api/services/coilInventory.cjs');

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
        CREATE TABLE stator_variants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            diameter_mm INTEGER NOT NULL,
            common_name TEXT DEFAULT '',
            material TEXT NOT NULL,
            slot_type TEXT NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(diameter_mm, material, slot_type)
        );
        CREATE TABLE coils (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stator_variant_id INTEGER,
            spec TEXT NOT NULL,
            material TEXT,
            slot_type TEXT,
            sheets INTEGER NOT NULL,
            scheme_name TEXT,
            scheme_code TEXT NOT NULL,
            scheme_status TEXT,
            is_default INTEGER DEFAULT 0,
            rated_voltage_v INTEGER,
            rated_frequency_hz INTEGER,
            market TEXT DEFAULT '',
            scheme_family_code TEXT NOT NULL,
            pricing_mode TEXT DEFAULT 'calculated',
            kit_price REAL DEFAULT 0,
            unit_price REAL,
            wire_weight REAL,
            copper_base REAL,
            coil_fee REAL,
            rotor_fee REAL,
            cost REAL,
            stock INTEGER DEFAULT 0,
            default_wire_gauge TEXT,
            default_capacitor TEXT,
            main_wire_gauge TEXT,
            main_wire_data TEXT,
            aux_wire_gauge TEXT,
            aux_wire_data TEXT,
            created_at TEXT,
            updated_at TEXT,
            FOREIGN KEY(stator_variant_id) REFERENCES stator_variants(id)
        );
        CREATE TABLE coil_stock_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coil_id INTEGER,
            change_qty INTEGER,
            balance_after INTEGER,
            movement_type TEXT,
            reference_type TEXT,
            reference_id TEXT,
            note TEXT,
            created_at TEXT,
            FOREIGN KEY(coil_id) REFERENCES coils(id)
        );
    `);
    let version = 0;

    function nextUpdatedAt() {
        version += 1;
        return new Date(Date.UTC(2026, 7, 3, 2, 0, version)).toISOString();
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
        const columns = Object.keys(values);
        const result = db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
        return {
            ...result,
            auditId: writeAudit(table, Number(result.lastInsertRowid), context),
        };
    }

    function safeUpdate(table, id, updates, context) {
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

    function hardDelete(table, id, context) {
        const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
        return {
            ...result,
            auditId: writeAudit(table, id, context),
        };
    }

    function coilRow(row) {
        if (!row) return row;
        const variant = row.stator_variant_id
            ? db.prepare('SELECT * FROM stator_variants WHERE id = ?')
                .get(row.stator_variant_id)
            : null;
        return {
            id: row.id,
            statorVariantId: row.stator_variant_id,
            spec: row.spec,
            commonName: variant?.common_name || row.spec,
            diameterMm: variant?.diameter_mm || Number(row.spec),
            material: row.material,
            slotType: row.slot_type,
            sheets: row.sheets,
            schemeName: row.scheme_name,
            schemeCode: row.scheme_code,
            schemeStatus: row.scheme_status,
            isDefault: Boolean(row.is_default),
            ratedVoltageV: row.rated_voltage_v,
            ratedFrequencyHz: row.rated_frequency_hz,
            market: row.market,
            schemeFamilyCode: row.scheme_family_code,
            pricingMode: row.pricing_mode === 'kit' ? 'kit' : 'calculated',
            kitPrice: Number(row.kit_price || 0),
            unitPrice: row.unit_price,
            wireWeight: row.wire_weight,
            copperBase: row.copper_base,
            coilFee: row.coil_fee,
            rotorFee: row.rotor_fee,
            cost: row.cost,
            stock: row.stock,
            defaultWireGauge: row.default_wire_gauge,
            defaultCapacitor: row.default_capacitor,
            mainWireGauge: row.main_wire_gauge,
            mainWireData: row.main_wire_data,
            auxWireGauge: row.aux_wire_gauge,
            auxWireData: row.aux_wire_data,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    const dependencies = {
        db,
        safeInsert,
        safeUpdate,
        hardDelete,
        coilRow,
        listCoils() {
            return db.prepare('SELECT * FROM coils').all().map(coilRow);
        },
        assertCoilCanBeDeleted,
        assertCoilIdentityEditable,
    };
    return { db, dependencies };
}

function commandContext(capabilityId, suffix) {
    return {
        capabilityId,
        actorKey: 'jwt:coil-test',
        idempotencyKey: `coil:command:${suffix}`,
        operationId: `coil-operation-${suffix}`,
        requestId: `coil-request-${suffix}`,
        warnings: [],
    };
}

function coilInput(overrides = {}) {
    return {
        spec: '12',
        diameterMm: 120,
        material: '钢带',
        slotType: '小眼',
        sheets: 140,
        schemeName: '正式方案',
        schemeStatus: 'official',
        unitPrice: 0.4,
        wireWeight: 1.2,
        copperBase: 80,
        coilFee: 10,
        rotorFee: 5,
        defaultWireGauge: '0.75',
        defaultCapacitor: '16uf',
        ...overrides,
    };
}

test('线圈新增持久幂等，并允许同组合多套正式方案且保留唯一默认', () => {
    const fixture = createFixture();
    try {
        const first = executeCoilCreate(
            fixture.dependencies,
            coilInput(),
            commandContext(CREATE_CAPABILITY_ID, 'create-first')
        );
        assert.equal(first.coil.schemeName, '线圈-12-140片-钢带-小眼-正式方案');
        const secondContext = commandContext(CREATE_CAPABILITY_ID, 'create-second');
        const secondInput = coilInput({ schemeName: '新正式方案', wireWeight: 1.3 });
        const second = executeCoilCreate(
            fixture.dependencies,
            secondInput,
            secondContext
        );
        const replay = executeCoilCreate(
            fixture.dependencies,
            secondInput,
            secondContext
        );

        assert.equal(first.coil.cost, 167);
        assert.equal(second.coil.schemeStatus, 'official');
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.coil.id, second.coil.id);
        assert.equal(
            fixture.db.prepare('SELECT scheme_status FROM coils WHERE id = ?')
                .get(first.coil.id).scheme_status,
            'official'
        );
        assert.equal(first.coil.isDefault, true);
        assert.equal(second.coil.isDefault, false);
        assert.equal(second.auditIds.length, 1);
    } finally {
        fixture.db.close();
    }
});

test('线圈方案保存电气元数据并可原子切换唯一默认方案', () => {
    const fixture = createFixture();
    try {
        const first = executeCoilCreate(
            fixture.dependencies,
            coilInput({ schemeCode: 'COIL-12-140-CN', isDefault: true, ratedVoltageV: 220, ratedFrequencyHz: 50, market: '通用', schemeFamilyCode: '12-CN' }),
            commandContext(CREATE_CAPABILITY_ID, 'metadata-first')
        );
        const second = executeCoilCreate(
            fixture.dependencies,
            coilInput({ schemeCode: 'COIL-12-140-MY', schemeName: '马来西亚方案', ratedVoltageV: 240, ratedFrequencyHz: 50, market: '马来西亚', schemeFamilyCode: '12-MY' }),
            commandContext(CREATE_CAPABILITY_ID, 'metadata-second')
        );
        const updated = executeCoilUpdate(
            fixture.dependencies,
            second.coil.id,
            { isDefault: true, expectedUpdatedAt: second.coil.updatedAt },
            commandContext(UPDATE_CAPABILITY_ID, 'metadata-default-switch')
        );
        const rows = fixture.db.prepare('SELECT id, scheme_status, is_default FROM coils ORDER BY id').all();
        assert.deepEqual(rows, [
            { id: first.coil.id, scheme_status: 'official', is_default: 0 },
            { id: second.coil.id, scheme_status: 'official', is_default: 1 },
        ]);
        assert.equal(updated.coil.ratedVoltageV, 240);
        assert.equal(updated.coil.ratedFrequencyHz, 50);
        assert.equal(updated.coil.market, '马来西亚');
        assert.throws(
            () => executeCoilCreate(
                fixture.dependencies,
                coilInput({ ratedVoltageV: 0 }),
                commandContext(CREATE_CAPABILITY_ID, 'metadata-invalid-voltage')
            ),
            error => error.code === 'coil_voltage_invalid'
        );
    } finally {
        fixture.db.close();
    }
});

test('供应商套件价新增和模式切换由命令统一重算并拒绝空价格', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => executeCoilCreate(
                fixture.dependencies,
                coilInput({ pricingMode: 'kit', kitPrice: 0, unitPrice: undefined }),
                commandContext(CREATE_CAPABILITY_ID, 'kit-invalid')
            ),
            error => error.code === 'coil_kit_price_required'
        );
        assert.throws(
            () => executeCoilCreate(
                fixture.dependencies,
                coilInput({
                    pricingMode: 'kit',
                    kitPrice: 86.5,
                    unitPrice: undefined,
                    wireWeight: -0.1,
                }),
                commandContext(CREATE_CAPABILITY_ID, 'kit-invalid-reference')
            ),
            error => /wireWeight 必须是非负数字/.test(error.message)
        );

        const created = executeCoilCreate(
            fixture.dependencies,
            coilInput({
                pricingMode: 'kit',
                kitPrice: 86.5,
                unitPrice: undefined,
                wireWeight: 1.15,
                copperBase: 76.2,
                coilFee: 12,
                rotorFee: 13,
            }),
            commandContext(CREATE_CAPABILITY_ID, 'kit-create')
        );
        assert.equal(created.coil.pricingMode, 'kit');
        assert.equal(created.coil.kitPrice, 86.5);
        assert.equal(created.coil.unitPrice, 0);
        assert.equal(created.coil.wireWeight, 1.15);
        assert.equal(created.coil.copperBase, 76.2);
        assert.equal(created.coil.coilFee, 0);
        assert.equal(created.coil.rotorFee, 0);
        assert.equal(created.coil.cost, 86.5);

        const referenceUpdated = executeCoilUpdate(
            fixture.dependencies,
            created.coil.id,
            {
                wireWeight: 1.2,
                copperBase: 77,
                expectedUpdatedAt: created.coil.updatedAt,
            },
            commandContext(UPDATE_CAPABILITY_ID, 'kit-reference-update')
        );
        assert.equal(referenceUpdated.coil.wireWeight, 1.2);
        assert.equal(referenceUpdated.coil.copperBase, 77);
        assert.equal(referenceUpdated.coil.cost, 86.5);

        assert.throws(
            () => executeCoilUpdate(
                fixture.dependencies,
                created.coil.id,
                {
                    copperBase: -1,
                    expectedUpdatedAt: referenceUpdated.coil.updatedAt,
                },
                commandContext(UPDATE_CAPABILITY_ID, 'kit-invalid-reference-update')
            ),
            error => /copperBase 必须是非负数字/.test(error.message)
        );

        const referenceCleared = executeCoilUpdate(
            fixture.dependencies,
            created.coil.id,
            {
                wireWeight: 0,
                copperBase: 0,
                expectedUpdatedAt: referenceUpdated.coil.updatedAt,
            },
            commandContext(UPDATE_CAPABILITY_ID, 'kit-reference-clear')
        );
        assert.equal(referenceCleared.coil.wireWeight, 0);
        assert.equal(referenceCleared.coil.copperBase, 0);
        assert.equal(referenceCleared.coil.cost, 86.5);

        const emptyReference = executeCoilCreate(
            fixture.dependencies,
            coilInput({
                sheets: 141,
                schemeStatus: 'testing',
                pricingMode: 'kit',
                kitPrice: 70,
                unitPrice: undefined,
                wireWeight: undefined,
                copperBase: undefined,
                coilFee: undefined,
                rotorFee: undefined,
            }),
            commandContext(CREATE_CAPABILITY_ID, 'kit-empty-reference')
        );
        assert.equal(emptyReference.coil.wireWeight, 0);
        assert.equal(emptyReference.coil.copperBase, 0);
        assert.equal(emptyReference.coil.cost, 70);

        const updated = executeCoilUpdate(
            fixture.dependencies,
            created.coil.id,
            {
                pricingMode: 'calculated',
                unitPrice: 0.5,
                wireWeight: 1,
                copperBase: 80,
                coilFee: 5,
                rotorFee: 3,
                expectedUpdatedAt: referenceCleared.coil.updatedAt,
            },
            commandContext(UPDATE_CAPABILITY_ID, 'kit-to-calculated')
        );
        assert.equal(updated.coil.pricingMode, 'calculated');
        assert.equal(updated.coil.kitPrice, 0);
        assert.equal(updated.coil.cost, 158);
    } finally {
        fixture.db.close();
    }
});

test('线圈编辑和删除使用资源版本，并保留库存身份与追溯保护', () => {
    const fixture = createFixture();
    try {
        const created = executeCoilCreate(
            fixture.dependencies,
            coilInput({ schemeStatus: 'testing' }),
            commandContext(CREATE_CAPABILITY_ID, 'seed-edit')
        );
        const updated = executeCoilUpdate(
            fixture.dependencies,
            created.coil.id,
            {
                wireWeight: 1.5,
                expectedUpdatedAt: created.coil.updatedAt,
            },
            commandContext(UPDATE_CAPABILITY_ID, 'update')
        );
        assert.equal(updated.coil.cost, 191);

        assert.throws(
            () => executeCoilDelete(
                fixture.dependencies,
                created.coil.id,
                { expectedUpdatedAt: created.coil.updatedAt },
                commandContext(DELETE_CAPABILITY_ID, 'delete-stale')
            ),
            error => error.code === 'resource_version_conflict'
        );

        fixture.db.prepare('UPDATE coils SET stock = 2 WHERE id = ?')
            .run(created.coil.id);
        assert.throws(
            () => executeCoilUpdate(
                fixture.dependencies,
                created.coil.id,
                {
                    sheets: 160,
                    expectedUpdatedAt: updated.coil.updatedAt,
                },
                commandContext(UPDATE_CAPABILITY_ID, 'identity-frozen')
            ),
            /不能修改身份字段/
        );
        fixture.db.prepare('UPDATE coils SET stock = 0 WHERE id = ?')
            .run(created.coil.id);

        const deletedContext = commandContext(DELETE_CAPABILITY_ID, 'delete');
        const deletedInput = { expectedUpdatedAt: updated.coil.updatedAt };
        const deleted = executeCoilDelete(
            fixture.dependencies,
            created.coil.id,
            deletedInput,
            deletedContext
        );
        const replay = executeCoilDelete(
            fixture.dependencies,
            created.coil.id,
            deletedInput,
            deletedContext
        );
        assert.equal(deleted.deleted, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM coils').get().count,
            0
        );
    } finally {
        fixture.db.close();
    }
});

test('线圈批量改单片价绑定预览版本并支持稳定幂等重放', () => {
    const fixture = createFixture();
    try {
        const first = executeCoilCreate(
            fixture.dependencies,
            coilInput({ sheets: 140 }),
            commandContext(CREATE_CAPABILITY_ID, 'seed-price-a')
        );
        executeCoilCreate(
            fixture.dependencies,
            coilInput({ sheets: 160 }),
            commandContext(CREATE_CAPABILITY_ID, 'seed-price-b')
        );
        const request = {
            spec: '12',
            material: '钢带',
            slotType: '小眼',
            unitPrice: 0.5,
        };
        const preview = buildCoilUnitPricePreview(
            fixture.dependencies,
            request
        );
        assert.equal(preview.updatedCount, 2);
        assert.match(preview.previewHash, /^[a-f0-9]{64}$/);

        const input = { ...request, previewHash: preview.previewHash };
        const context = commandContext(
            BATCH_UNIT_PRICE_CAPABILITY_ID,
            'batch-price'
        );
        const receipt = executeCoilUnitPriceBatch(
            fixture.dependencies,
            input,
            context
        );
        fixture.db.prepare('UPDATE coils SET cost = 999 WHERE id = ?')
            .run(first.coil.id);
        const replay = executeCoilUnitPriceBatch(
            fixture.dependencies,
            input,
            context
        );
        assert.equal(receipt.updatedCount, 2);
        assert.equal(receipt.auditIds.length, 2);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.operationId, receipt.operationId);
    } finally {
        fixture.db.close();
    }
});

test('线圈批量改单片价只包含计算计价方案', () => {
    const fixture = createFixture();
    try {
        executeCoilCreate(
            fixture.dependencies,
            coilInput({ sheets: 140 }),
            commandContext(CREATE_CAPABILITY_ID, 'batch-calculated')
        );
        const kit = executeCoilCreate(
            fixture.dependencies,
            coilInput({
                sheets: 160,
                pricingMode: 'kit',
                kitPrice: 95,
                unitPrice: undefined,
            }),
            commandContext(CREATE_CAPABILITY_ID, 'batch-kit')
        );
        const preview = buildCoilUnitPricePreview(fixture.dependencies, {
            spec: '12',
            material: '钢带',
            slotType: '小眼',
            unitPrice: 0.6,
        });

        assert.equal(preview.updatedCount, 1);
        assert.equal(preview.updates.some(item => item.coilId === kit.coil.id), false);
        assert.equal(
            fixture.db.prepare('SELECT cost FROM coils WHERE id = ?').get(kit.coil.id).cost,
            95
        );
    } finally {
        fixture.db.close();
    }
});

test('线圈批量改单片价在预览漂移或强审计缺失时整批回滚', () => {
    const fixture = createFixture();
    try {
        const created = executeCoilCreate(
            fixture.dependencies,
            coilInput(),
            commandContext(CREATE_CAPABILITY_ID, 'seed-rollback')
        );
        const request = {
            spec: '12',
            material: '钢带',
            slotType: '小眼',
            unitPrice: 0.6,
        };
        const preview = buildCoilUnitPricePreview(
            fixture.dependencies,
            request
        );
        executeCoilUpdate(
            fixture.dependencies,
            created.coil.id,
            {
                coilFee: 11,
                expectedUpdatedAt: created.coil.updatedAt,
            },
            commandContext(UPDATE_CAPABILITY_ID, 'preview-drift')
        );
        assert.throws(
            () => executeCoilUnitPriceBatch(
                fixture.dependencies,
                { ...request, previewHash: preview.previewHash },
                commandContext(BATCH_UNIT_PRICE_CAPABILITY_ID, 'stale-preview')
            ),
            error => error.code === 'preview_changed'
        );
        assert.equal(
            fixture.db.prepare('SELECT unit_price FROM coils WHERE id = ?')
                .get(created.coil.id).unit_price,
            0.4
        );

        const auditPreview = buildCoilUnitPricePreview(
            fixture.dependencies,
            request
        );
        const originalSafeUpdate = fixture.dependencies.safeUpdate;
        fixture.dependencies.safeUpdate = (...args) => {
            const result = originalSafeUpdate(...args);
            return { ...result, auditId: null };
        };
        assert.throws(
            () => executeCoilUnitPriceBatch(
                fixture.dependencies,
                { ...request, previewHash: auditPreview.previewHash },
                commandContext(BATCH_UNIT_PRICE_CAPABILITY_ID, 'missing-audit')
            ),
            error => error.code === 'strong_audit_required'
        );
        assert.equal(
            fixture.db.prepare('SELECT unit_price FROM coils WHERE id = ?')
                .get(created.coil.id).unit_price,
            0.4
        );
    } finally {
        fixture.db.close();
    }
});
