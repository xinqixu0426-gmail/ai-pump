const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installBusinessChangeSchema } = require('./helpers/businessChangeSchema.cjs');
const { createPartsDataCache } = require('../api/services/partsDataCache.cjs');
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
            naming_json TEXT,
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
    db.exec(require('../api/database/schema.cjs').CANONICAL_TABLES_SQL);
    db.exec(require('../api/database/catalogSchema.cjs').CATALOG_IDENTITY_SCHEMA_SQL);
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
                remark: body.remark ?? body.notes ?? '',
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
                notes: row.remark,
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

test('内部正式改名提交立即刷新目录；幂等重放和审计失败不污染缓存', () => {
    const fixture = createFixture();
    const { db, dependencies } = fixture;
    try {
        const part = seedPart(fixture).part;
        const cache = createPartsDataCache(db);
        cache.read();
        const input = { model: '现名', price: 15, expectedUpdatedAt: part.updatedAt };
        const context = commandContext(UPDATE_CAPABILITY_ID, 'cache-rename');
        const renamed = executePartUpdate(dependencies, part.id, input, context).part;
        assert.equal(cache.read().partsByModel[part.model], undefined);
        assert.equal(cache.read().partsCache['现名'].price, 15);
        assert.equal(executePartUpdate(dependencies, part.id, input, context).idempotentReplay, true);
        assert.equal(cache.read().partsByModel['现名'][0].id, part.id);
        const failing = { ...dependencies, safeUpdate(...args) {
            const result = dependencies.safeUpdate(...args);
            assert.equal(cache.read().partsCache['现名'].price, 99);
            return { ...result, auditId: null };
        } };
        assert.throws(() => executePartUpdate(failing, part.id,
            { price: 99, expectedUpdatedAt: renamed.updatedAt },
            commandContext(UPDATE_CAPABILITY_ID, 'cache-rollback')), { code: 'strong_audit_required' });
        assert.equal(cache.read().partsCache['现名'].price, 15);
        assert.equal(db.prepare('SELECT stock FROM parts WHERE id = ?').get(part.id).stock, 5);
    } finally { db.close(); }
});

const namingInput = () => ({ category: '包装', supplier: '甲', stock: 3, price: 8,
    naming: { ruleId: 'packaging', spec: { kind: ' 纸箱 ', specification: '400*300*200', variant: '' } } });

test('被配方引用的零件不能通过 PATCH 或资料保存改名，其他资料仍可保存', () => {
    const fixture = createFixture();
    const { db, dependencies } = fixture;
    try {
        const part = seedPart(fixture).part;
        const snapshot = JSON.stringify([{ partId: part.id, model: part.model, supplier: part.supplier, qty: 2 }]);
        db.prepare('INSERT INTO recipes (name, parts_json) VALUES (?, ?)').run('引用配方', snapshot);
        const before = db.prepare('SELECT count(*) n FROM audit_log').get().n;
        const input = { model: 'NEW', stock: 8, expectedUpdatedAt: part.updatedAt };
        assert.throws(() => buildPartProfileSavePreview(dependencies, part.id, input, 'rename'), { code: 'PART_RENAME_REFERENCES_REQUIRE_MIGRATION' });
        assert.throws(() => executePartUpdate(dependencies, part.id, input, commandContext(UPDATE_CAPABILITY_ID, 'blocked-rename')), { code: 'PART_RENAME_REFERENCES_REQUIRE_MIGRATION' });
        assert.equal(db.prepare('SELECT count(*) n FROM audit_log').get().n, before);
        assert.equal(db.prepare('SELECT model FROM parts WHERE id = ?').get(part.id).model, part.model);
        executePartUpdate(dependencies, part.id, { price: 12, expectedUpdatedAt: part.updatedAt }, commandContext(UPDATE_CAPABILITY_ID, 'allowed-price'));
        assert.equal(db.prepare('SELECT parts_json FROM recipes').get().parts_json, snapshot);
    } finally { db.close(); }
});

test('历史旁路绑定即使源名称已不匹配，也必须阻止直接改名', () => {
    const fixture = createFixture();
    const { db, dependencies } = fixture;
    try {
        const part = seedPart(fixture).part;
        const profile = db.prepare("INSERT INTO catalog_identity_profiles (part_id, created_at, updated_at) VALUES (?, 'now', 'now')").run(part.id);
        db.prepare(`INSERT INTO catalog_reference_bindings
            (source_type, source_id, source_version, source_path, source_hash, target_profile_id, target_spec_revision, created_at, updated_at)
            VALUES ('orderRevision', 1, 'old', '/parts/0', ?, ?, 1, 'now', 'now')`).run('a'.repeat(64), profile.lastInsertRowid);
        assert.throws(() => buildPartProfileSavePreview(dependencies, part.id, { model: 'NEW', stock: 5, expectedUpdatedAt: part.updatedAt }, 'rename'), { code: 'PART_RENAME_REFERENCES_REQUIRE_MIGRATION' });
        assert.equal(db.prepare('SELECT model FROM parts WHERE id = ?').get(part.id).model, part.model);
    } finally { db.close(); }
});

test('模板显式泵壳绑定不依赖模板与零件名称相同', () => {
    const fixture = createFixture();
    const { db, dependencies } = fixture;
    try {
        const part = seedPart(fixture).part;
        const template = db.prepare('INSERT INTO pump_shell_templates (shell_model) VALUES (?)').run('独立模板名');
        db.prepare("INSERT INTO catalog_template_shell_bindings (template_id, shell_part_id, created_at, updated_at) VALUES (?, ?, 'now', 'now')").run(template.lastInsertRowid, part.id);
        assert.throws(() => buildPartProfileSavePreview(dependencies, part.id, { model: 'NEW', stock: 5, expectedUpdatedAt: part.updatedAt }, 'rename'), { code: 'PART_RENAME_REFERENCES_REQUIRE_MIGRATION' });
    } finally { db.close(); }
});

test('改名预览绑定引用源快照，预览后新增引用不会留下半次保存', () => {
    const fixture = createFixture();
    const { db, dependencies } = fixture;
    try {
        const part = seedPart(fixture).part;
        const preview = buildPartProfileSavePreview(dependencies, part.id, { model: 'NEW', stock: 8, expectedUpdatedAt: part.updatedAt }, 'rename');
        assert.equal(preview.renameImpact.referenceCount, 0);
        assert.equal(preview.renameImpact.previousName, part.model);
        db.prepare('INSERT INTO recipes (name, parts_json) VALUES (?, ?)').run('新引用', JSON.stringify([{ model: part.model }]));
        assert.throws(() => executeConfirmedPartProfileSave(dependencies, part.id, { confirmationToken: preview.confirmationToken }, commandContext(PROFILE_SAVE_CAPABILITY_ID, 'new-reference'), 'rename'), { code: 'PART_RENAME_REFERENCES_REQUIRE_MIGRATION' });
        const saved = db.prepare('SELECT model, stock FROM parts WHERE id = ?').get(part.id);
        assert.deepEqual(saved, { model: part.model, stock: part.stock });
        assert.equal(db.prepare('SELECT count(*) n FROM api_operations WHERE capability_id = ?').get(PROFILE_SAVE_CAPABILITY_ID).n, 0);
    } finally { db.close(); }
});

test('改名拒绝缺少版本、同供应商撞名、不完整盘点和预览后源数据漂移', () => {
    const fixture = createFixture();
    const { db, dependencies } = fixture;
    try {
        const part = seedPart(fixture).part;
        const another = seedPart(fixture, 'OTHER').part;
        assert.throws(() => executePartUpdate(dependencies, part.id, { model: 'NEW' }, commandContext(UPDATE_CAPABILITY_ID, 'no-version')), { code: 'PART_RENAME_VERSION_REQUIRED' });
        assert.throws(() => buildPartProfileSavePreview(dependencies, part.id, { model: another.model, stock: 5, expectedUpdatedAt: part.updatedAt }, 'rename'), { code: 'PART_RENAME_NAME_CONFLICT' });
        const preview = buildPartProfileSavePreview(dependencies, part.id, { model: 'NEW', stock: 5, expectedUpdatedAt: part.updatedAt }, 'rename');
        seedPart(fixture, 'AFTER-PREVIEW');
        assert.throws(() => executeConfirmedPartProfileSave(dependencies, part.id, { confirmationToken: preview.confirmationToken }, commandContext(PROFILE_SAVE_CAPABILITY_ID, 'source-changed'), 'rename'), { code: 'PART_RENAME_SOURCE_CHANGED' });
        db.prepare('INSERT INTO recipes (name, parts_json) VALUES (?, ?)').run('损坏数据', '{broken');
        assert.throws(() => buildPartProfileSavePreview(dependencies, part.id, { model: 'NEW', stock: 5, expectedUpdatedAt: part.updatedAt }, 'rename'), { code: 'PART_RENAME_AUDIT_INCOMPLETE' });
    } finally { db.close(); }
});

test('规格命名新增生成型号、保存命名输入、幂等并拒绝同供应商重复', () => {
    const { db, dependencies } = createFixture();
    try {
        const input = namingInput();
        const context = commandContext(CREATE_CAPABILITY_ID, 'named-create');
        const created = executePartCreate(dependencies, input, context);
        assert.equal(created.part.model, '纸箱-400*300*200');
        const stored = db.prepare('SELECT * FROM parts WHERE id = ?').get(created.part.id);
        assert.deepEqual(JSON.parse(stored.naming_json), { ruleId: 'packaging', ruleVersion: 1, spec: { kind: '纸箱', specification: '400*300*200' } });
        assert.equal(stored.stock, 3);
        assert.equal(stored.price, 8);
        assert.equal(executePartCreate(dependencies, input, context).idempotentReplay, true);
        assert.throws(() => executePartCreate(dependencies, { ...input, duplicatePolicy: 'allow' }, commandContext(CREATE_CAPABILITY_ID, 'duplicate-named')), { code: 'part_identity_conflict' });
        executePartCreate(dependencies, { ...input, supplier: '乙' }, commandContext(CREATE_CAPABILITY_ID, 'other-supplier'));
        assert.equal(db.prepare('SELECT count(*) n FROM parts').get().n, 2);
    } finally { db.close(); }
});

test('规格命名拒绝伪造型号、错分类、缺规格、未开放规则，失败不落库', () => {
    const { db, dependencies } = createFixture();
    try {
        const invalid = [
            [{ ...namingInput(), model: '自己改的名称' }, 'PART_NAMING_MODEL_MISMATCH'],
            [{ ...namingInput(), category: '配件' }, 'PART_NAMING_CATEGORY_MISMATCH'],
            [{ ...namingInput(), naming: { ruleId: 'packaging', spec: { kind: '纸箱' } } }, 'NAMING_SPEC_INVALID'],
            [{ category: '电容', naming: { ruleId: 'capacitor', spec: { capacitanceUf: 20 } } }, 'PART_NAMING_RULE_NOT_READY'],
            [{ ...namingInput(), naming: null }, 'NAMING_INPUT_INVALID'],
        ];
        for (const [input, code] of invalid) {
            assert.throws(() => executePartCreate(dependencies, input, commandContext(CREATE_CAPABILITY_ID, code)), { code });
        }
        assert.equal(db.prepare('SELECT count(*) n FROM parts').get().n, 0);
        assert.equal(db.prepare('SELECT count(*) n FROM audit_log').get().n, 0);
        assert.equal(db.prepare('SELECT count(*) n FROM api_operations').get().n, 0);
    } finally { db.close(); }
});

test('普通 PATCH 和资料保存不能绕过规格名称保护，价格库存可正常保存', () => {
    const { db, dependencies } = createFixture();
    try {
        const part = executePartCreate(dependencies, namingInput(), commandContext(CREATE_CAPABILITY_ID, 'named-update')).part;
        for (const updates of [{ model: '手写名称' }, { category: '皮垫' }, { naming: null }, { naming: { ruleId: 'packaging', spec: { kind: '纸箱', specification: '别的规格' } } }]) {
            assert.throws(() => executePartUpdate(dependencies, part.id, updates, commandContext(UPDATE_CAPABILITY_ID, JSON.stringify(updates))));
            assert.throws(() => buildPartProfileSavePreview(dependencies, part.id, { ...updates, stock: 4, expectedUpdatedAt: part.updatedAt }, 'test'));
        }
        const preview = buildPartProfileSavePreview(dependencies, part.id, { model: part.model, price: 9, stock: 4, expectedUpdatedAt: part.updatedAt }, 'test');
        const receipt = executeConfirmedPartProfileSave(dependencies, part.id, { confirmationToken: preview.confirmationToken }, commandContext(PROFILE_SAVE_CAPABILITY_ID, 'named-profile'), 'test');
        assert.equal(receipt.part.model, part.model);
        assert.equal(receipt.part.price, 9);
        assert.equal(receipt.part.stock, 4);
        assert.ok(db.prepare('SELECT naming_json FROM parts WHERE id = ?').get(part.id).naming_json);
        const legacy = seedPart({ db, dependencies }).part;
        assert.throws(() => executePartUpdate(dependencies, legacy.id, { naming: namingInput().naming }, commandContext(UPDATE_CAPABILITY_ID, 'legacy-adopt')), { code: 'PART_NAMING_ADOPTION_REQUIRED' });
    } finally { db.close(); }
});

test('批量命名沿用冻结预览，不采纳执行时替换规格，审计失败全部回滚', () => {
    const { db, dependencies } = createFixture();
    try {
        const subject = 'named-batch';
        const preview = buildPartBatchCreatePreview(dependencies, { parts: [namingInput()] }, subject);
        const receipt = executeConfirmedPartBatchCreate(dependencies, { confirmationToken: preview.confirmationToken, parts: [{ model: '伪造' }] }, commandContext(BATCH_CREATE_CAPABILITY_ID, 'named-batch'), subject);
        assert.equal(receipt.parts[0].model, '纸箱-400*300*200');
        assert.ok(db.prepare('SELECT naming_json FROM parts WHERE id = ?').get(receipt.parts[0].id).naming_json);
        const countBefore = db.prepare('SELECT count(*) n FROM audit_log').get().n;
        assert.throws(() => executePartCreate({ ...dependencies, safeInsert(...args) {
            dependencies.safeInsert(...args);
            throw new Error('模拟审计失败');
        } }, { ...namingInput(), supplier: '丙' }, commandContext(CREATE_CAPABILITY_ID, 'named-rollback')), /模拟审计失败/);
        assert.equal(db.prepare('SELECT count(*) n FROM parts').get().n, 1);
        assert.equal(db.prepare('SELECT count(*) n FROM audit_log').get().n, countBefore);
    } finally { db.close(); }
});

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
            remark: '规范零件说明',
            notes: '旧字段不应覆盖规范字段',
        };
        const created = executePartCreate(fixture.dependencies, input, context);
        const replay = executePartCreate(fixture.dependencies, input, context);
        assert.equal(created.capabilityId, CREATE_CAPABILITY_ID);
        assert.equal(created.part.subcategory, '外包装');
        assert.equal(created.part.remark, '规范零件说明');
        assert.equal(created.part.notes, '规范零件说明');
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

test('泵壳被模板引用时拒绝旧名称级联改写', () => {
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

        assert.throws(() => executePartUpdate(
            fixture.dependencies,
            created.part.id,
            {
                model: 'V750-DY款-圆底脚-12',
                expectedUpdatedAt: created.part.updatedAt,
            },
            commandContext(UPDATE_CAPABILITY_ID, 'rename-shell')
        ), { code: 'PART_RENAME_REFERENCES_REQUIRE_MIGRATION' });

        assert.equal(fixture.db.prepare('SELECT shell_model FROM pump_shell_templates WHERE id = ?').get(templateId).shell_model, 'V750-DY款-圆底脚');
        assert.equal(fixture.db.prepare('SELECT model FROM parts WHERE id = ?').get(created.part.id).model, created.part.model);
    } finally {
        fixture.db.close();
    }
});

test('同名多供应商泵壳不能绕过模板依赖保护', () => {
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

        assert.throws(() => executePartUpdate(
            fixture.dependencies,
            created.part.id,
            {
                model: 'V750-DY款-圆底脚-12',
                expectedUpdatedAt: created.part.updatedAt,
            },
            commandContext(UPDATE_CAPABILITY_ID, 'rename-one-shared-shell')
        ), { code: 'PART_RENAME_REFERENCES_REQUIRE_MIGRATION' });

        assert.equal(fixture.db.prepare('SELECT shell_model FROM pump_shell_templates WHERE id = ?').get(templateId).shell_model, 'V750-DY款-圆底脚');
        assert.equal(fixture.db.prepare('SELECT model FROM parts WHERE id = ?').get(created.part.id).model, created.part.model);
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
