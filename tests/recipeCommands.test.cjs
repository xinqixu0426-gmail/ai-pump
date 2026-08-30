const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installBusinessChangeSchema } = require('./helpers/businessChangeSchema.cjs');
const {
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    buildRecipeDeletePreview,
    buildRecipeSavePayloadDraft,
    executeRecipeCreate,
    executeRecipeDelete,
    executeRecipeUpdate,
} = require('../api/services/recipeCommands.cjs');

const FIXED_UPDATED_AT = '2026-08-02T00:00:00.000Z';
const NEXT_UPDATED_AT = '2026-08-02T00:01:00.000Z';

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
            price REAL,
            supplier TEXT,
            stock REAL,
            remark TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            spec TEXT,
            parts_json TEXT DEFAULT '[]',
            saved_total_cost REAL DEFAULT 0,
            saved_cost_details TEXT DEFAULT '',
            template_id INTEGER,
            coil_id INTEGER,
            coil_spec TEXT DEFAULT '',
            coil_sheets INTEGER DEFAULT 0,
            coil_material TEXT DEFAULT '钢带',
            coil_slot_type TEXT DEFAULT '小眼',
            coil_wire_weight REAL,
            has_float INTEGER DEFAULT 0,
            float_wire TEXT DEFAULT '',
            float_accessory_type TEXT DEFAULT 'standard',
            has_cable INTEGER DEFAULT 0,
            cable_length REAL DEFAULT 0,
            cable_wire TEXT DEFAULT '',
            cable_accessory_type TEXT DEFAULT 'standard',
            box_type TEXT DEFAULT '',
            extra_parts_json TEXT DEFAULT '[]',
            packing_parts_json TEXT DEFAULT '[]',
            assembly_wage REAL DEFAULT 0,
            packing_wage REAL DEFAULT 0,
            painting_wage REAL,
            surface_treatment_mode TEXT DEFAULT 'none',
            surface_treatment_cost REAL DEFAULT 0,
            management_fee REAL DEFAULT 0,
            custom_barrel_length REAL,
            long_screw_extra_length REAL DEFAULT 0,
            model_variant_id INTEGER,
            impeller_model TEXT DEFAULT '',
            impeller_thickness REAL,
            impeller_diameter REAL,
            impeller_blade_count INTEGER,
            technical_data_json TEXT DEFAULT '{}',
            configuration_policy_json TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE coils (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            spec TEXT NOT NULL,
            sheets INTEGER NOT NULL,
            material TEXT DEFAULT '钢带',
            slot_type TEXT DEFAULT '小眼',
            scheme_status TEXT DEFAULT 'official'
        );
        CREATE TABLE recipe_analysis_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id INTEGER,
            finding_type TEXT,
            decision TEXT
        );
        INSERT INTO parts (
            model, category, price, supplier, stock, remark, created_at, updated_at
        ) VALUES (
            'P-1', '标准件', 5, '供应商A', 10, '', '${FIXED_UPDATED_AT}', '${FIXED_UPDATED_AT}'
        );
        INSERT INTO coils (spec, sheets, material, slot_type, scheme_status)
        VALUES ('12', 140, '钢带', '小眼', 'official');
    `);

    function audit(table, id, context) {
        const info = db.prepare(`
            INSERT INTO audit_log (
                table_name, record_id, request_id, operation_id, capability_id, user
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            table,
            id,
            context?.requestId || null,
            context?.operationId || null,
            context?.capabilityId || null,
            context?.user || 'system'
        );
        return Number(info.lastInsertRowid);
    }

    function safeInsert(table, values, context) {
        assert.ok(['recipes', 'parts'].includes(table));
        const columns = Object.keys(values).filter(column => values[column] !== undefined);
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
        assert.equal(table, 'recipes');
        const columns = Object.keys(updates).filter(column => updates[column] !== undefined);
        db.prepare(`
            UPDATE recipes
            SET ${columns.map(column => `${column} = ?`).join(', ')}, updated_at = ?
            WHERE id = ?
        `).run(...columns.map(column => updates[column]), NEXT_UPDATED_AT, id);
        return {
            changes: 1,
            auditId: audit(table, id, context),
        };
    }

    const recipeRow = row => ({
        id: row.id,
        name: row.name,
        spec: row.spec,
        partsJson: row.parts_json,
        savedTotalCost: row.saved_total_cost,
        savedCostDetails: row.saved_cost_details,
        coilWireWeight: row.coil_wire_weight,
        coilId: row.coil_id,
        updatedAt: row.updated_at,
    });
    const partRow = row => ({
        id: row.id,
        model: row.model,
        category: row.category,
        price: row.price,
        supplier: row.supplier,
        stock: row.stock,
        updatedAt: row.updated_at,
    });
    const dependencies = {
        db,
        dbGetAllParts: () => db.prepare(`
            SELECT id, model, category, price, supplier, stock,
                   remark AS notes, created_at AS createdAt, updated_at AS updatedAt
            FROM parts WHERE deleted_at IS NULL
        `).all(),
        partRow,
        recipeRow,
        safeInsert,
        safeUpdate,
        buildRecipeBomDraft(input) {
            const parts = [...(input.optionalParts || []), ...(input.packingParts || [])]
                .map(selection => {
                    const matched = selection.partId
                        ? db.prepare('SELECT * FROM parts WHERE id = ?').get(selection.partId)
                        : db.prepare('SELECT * FROM parts WHERE model = ? AND supplier = ?').get(
                            selection.model,
                            selection.supplier || ''
                        );
                    if (!matched) return selection;
                    return {
                        ...selection,
                        partId: matched.id,
                        model: matched.model,
                        supplier: matched.supplier || '',
                        qty: Number(selection.qty || 1),
                        snapshotPrice: Number(matched.price || 0),
                    };
                });
            return { parts };
        },
        invalidatePartsCache() {},
        refreshFactoryRuleCandidates() {},
    };
    return { db, dependencies };
}

function draftInput(overrides = {}) {
    return {
        form: {
            name: '测试配方',
            spec: 'V1',
            coilSheets: 10,
            coilMaterial: '钢带',
            coilSlotType: '小眼',
            coilWireWeight: 0.45,
            assemblyWage: 1,
            packingWage: 1,
            surfaceTreatmentMode: 'none',
            surfaceTreatmentCost: 0,
            managementFee: 0,
        },
        costDraft: {
            parts: [{
                model: 'P-1',
                name: '测试零件',
                supplier: '供应商A',
                qty: 1,
                snapshotPrice: 0.01,
            }],
            savedTotalCost: 999,
            savedCostDetails: '不可信调用方快照',
        },
        packingParts: [],
        optionalParts: [{ partId: 1, model: 'P-1', supplier: '供应商A', qty: 1 }],
        technicalData: {},
        ...overrides,
    };
}

function commandContext(capabilityId, suffix) {
    return {
        capabilityId,
        actorKey: 'jwt:test-session',
        idempotencyKey: `recipe:command:${suffix}`,
        operationId: `operation-${suffix}`,
        requestId: `request-${suffix}`,
        warnings: [],
    };
}

test('配方保存草稿由 costEngine 重建权威成本且保持只读', () => {
    const fixture = createFixture();
    try {
        const draft = buildRecipeSavePayloadDraft(fixture.dependencies, draftInput());
        assert.equal(draft.capabilityId, CREATE_CAPABILITY_ID);
        assert.equal(draft.savedTotalCost, 7);
        assert.notEqual(draft.savedCostDetails, '不可信调用方快照');
        assert.equal(draft.coilWireWeight, 0.45);
        assert.match(draft.previewHash, /^[a-f0-9]{64}$/);
        assert.match(draft.suggestedIdempotencyKey, /^recipe-create:/);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM recipes').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('配方正式保存拒绝未明确供应商的多候选普通零件', () => {
    const fixture = createFixture();
    try {
        fixture.db.prepare(`
            INSERT INTO parts (model, category, price, supplier, stock, remark, created_at, updated_at)
            VALUES ('P-1', '标准件', 4, '供应商B', 10, '', ?, ?)
        `).run(FIXED_UPDATED_AT, FIXED_UPDATED_AT);
        assert.throws(
            () => buildRecipeSavePayloadDraft(fixture.dependencies, draftInput({
                optionalParts: [{ model: 'P-1', supplier: '', qty: 1 }],
            })),
            error => error.code === 'BOM_PART_IDENTITY_AMBIGUOUS'
                && error.statusCode === 422
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM recipes').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('配方创建绑定预览、持久幂等和强审计并保持完整资源响应', () => {
    const fixture = createFixture();
    try {
        const draft = buildRecipeSavePayloadDraft(fixture.dependencies, draftInput());
        const context = commandContext(CREATE_CAPABILITY_ID, 'create');
        const first = executeRecipeCreate(fixture.dependencies, draft, context);
        const replay = executeRecipeCreate(fixture.dependencies, draft, context);

        assert.equal(first.recipe.name, '测试配方');
        assert.equal(first.recipe.spec, 'V1');
        assert.deepEqual(
            fixture.db.prepare('SELECT name, spec FROM recipes WHERE id = ?').get(first.recipe.id),
            { name: '测试配方', spec: 'V1' }
        );
        assert.equal(first.recipe.savedTotalCost, 7);
        assert.equal(first.recipe.coilWireWeight, 0.45);
        assert.equal(first.status, 'completed');
        assert.equal(first.auditIds.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM recipes').get().count, 1);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 1);
    } finally {
        fixture.db.close();
    }
});

test('配方填写线圈维度时必须绑定具体正式方案并持久保存 coilId', () => {
    const fixture = createFixture();
    try {
        const form = {
            ...draftInput().form,
            coilSpec: '12',
            coilSheets: 140,
        };
        assert.throws(
            () => buildRecipeSavePayloadDraft(
                fixture.dependencies,
                draftInput({ form })
            ),
            error => error.code === 'recipe_coil_selection_required'
                && error.statusCode === 409
        );
        const directPayload = buildRecipeSavePayloadDraft(
            fixture.dependencies,
            draftInput()
        );
        assert.throws(
            () => executeRecipeCreate(
                fixture.dependencies,
                {
                    ...directPayload,
                    coilId: null,
                    coilSpec: '12',
                    coilSheets: 140,
                },
                commandContext(CREATE_CAPABILITY_ID, 'direct-coil-binding-required')
            ),
            error => error.code === 'recipe_coil_selection_required'
                && error.statusCode === 409
        );

        const draft = buildRecipeSavePayloadDraft(
            fixture.dependencies,
            draftInput({ form: { ...form, coilId: 1 } })
        );
        const created = executeRecipeCreate(
            fixture.dependencies,
            draft,
            commandContext(CREATE_CAPABILITY_ID, 'explicit-coil-binding')
        );
        assert.equal(created.recipe.coilId, 1);
        assert.equal(
            fixture.db.prepare('SELECT coil_id FROM recipes WHERE id = ?').get(created.recipe.id).coil_id,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('配方创建拒绝被篡改的保存草稿并整体回滚', () => {
    const fixture = createFixture();
    try {
        const draft = buildRecipeSavePayloadDraft(fixture.dependencies, draftInput());
        assert.throws(
            () => executeRecipeCreate(
                fixture.dependencies,
                { ...draft, name: '被篡改配方' },
                commandContext(CREATE_CAPABILITY_ID, 'preview-conflict')
            ),
            error => error.code === 'preview_changed' && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM recipes').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('配方更新使用当前版本、预览绑定和持久幂等', () => {
    const fixture = createFixture();
    try {
        const createDraft = buildRecipeSavePayloadDraft(fixture.dependencies, draftInput());
        const created = executeRecipeCreate(
            fixture.dependencies,
            createDraft,
            commandContext(CREATE_CAPABILITY_ID, 'seed')
        );
        const recipeId = created.recipe.id;
        const updateDraft = buildRecipeSavePayloadDraft(
            fixture.dependencies,
            draftInput({
                recipeId,
                expectedUpdatedAt: created.recipe.updatedAt,
                form: {
                    ...draftInput().form,
                    name: '修改后配方',
                    assemblyWage: 2,
                },
            })
        );
        assert.equal(updateDraft.capabilityId, UPDATE_CAPABILITY_ID);
        assert.equal(updateDraft.expectedUpdatedAt, created.recipe.updatedAt);
        assert.equal(updateDraft.savedTotalCost, 8);

        const context = commandContext(UPDATE_CAPABILITY_ID, 'update');
        const first = executeRecipeUpdate(
            fixture.dependencies,
            recipeId,
            updateDraft,
            context
        );
        const replay = executeRecipeUpdate(
            fixture.dependencies,
            recipeId,
            updateDraft,
            context
        );
        assert.equal(first.recipe.name, '修改后配方');
        assert.equal(first.recipe.spec, 'V1');
        assert.equal(first.recipe.savedTotalCost, 8);
        assert.equal(first.recipe.updatedAt, NEXT_UPDATED_AT);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM recipes').get().count, 1);
    } finally {
        fixture.db.close();
    }
});

test('配方更新版本冲突时不写业务表、审计或 operation', () => {
    const fixture = createFixture();
    try {
        const createDraft = buildRecipeSavePayloadDraft(fixture.dependencies, draftInput());
        const created = executeRecipeCreate(
            fixture.dependencies,
            createDraft,
            commandContext(CREATE_CAPABILITY_ID, 'seed-conflict')
        );
        const beforeAuditCount = fixture.db.prepare(
            'SELECT COUNT(*) AS count FROM audit_log'
        ).get().count;
        assert.throws(
            () => executeRecipeUpdate(
                fixture.dependencies,
                created.recipe.id,
                {
                    ...createDraft,
                    expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
                },
                commandContext(UPDATE_CAPABILITY_ID, 'version-conflict')
            ),
            error => error.code === 'resource_version_conflict'
                && error.statusCode === 409
        );
        assert.equal(
            fixture.db.prepare('SELECT name FROM recipes WHERE id = ?')
                .get(created.recipe.id).name,
            '测试配方'
        );
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count,
            beforeAuditCount
        );
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) AS count FROM api_operations
                WHERE capability_id = ?
            `).get(UPDATE_CAPABILITY_ID).count,
            0
        );
    } finally {
        fixture.db.close();
    }
});

test('配方删除预览绑定正式目标和版本且不产生任何写副作用', () => {
    const fixture = createFixture();
    try {
        const createDraft = buildRecipeSavePayloadDraft(fixture.dependencies, draftInput());
        const created = executeRecipeCreate(
            fixture.dependencies,
            createDraft,
            commandContext(CREATE_CAPABILITY_ID, 'seed-delete-preview')
        );
        const before = Object.fromEntries([
            'recipes',
            'audit_log',
            'api_operations',
            'business_change_events',
        ].map(table => [
            table,
            fixture.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
        ]));

        const preview = buildRecipeDeletePreview(
            fixture.dependencies,
            created.recipe.id,
            { expectedUpdatedAt: created.recipe.updatedAt }
        );

        assert.equal(preview.preview, true);
        assert.equal(preview.capabilityId, DELETE_CAPABILITY_ID);
        assert.deepEqual(preview.normalizedInput, {
            recipeId: created.recipe.id,
            expectedUpdatedAt: created.recipe.updatedAt,
        });
        assert.equal(preview.target.name, created.recipe.name);
        assert.equal(preview.target.partsCount, 1);
        assert.equal(
            preview.target.savedTotalCost,
            created.recipe.savedTotalCost
        );
        assert.equal(preview.impact.deleteMode, 'soft_delete');
        assert.equal(preview.impact.partsChanged, 0);
        assert.equal(preview.impact.inventoryChanged, false);
        assert.deepEqual(preview.warnings, []);
        assert.ok(preview.previewHash);
        for (const [table, count] of Object.entries(before)) {
            assert.equal(
                fixture.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
                count,
                `${table} 被删除预览意外写入`
            );
        }
        assert.equal(
            fixture.db.prepare('SELECT deleted_at FROM recipes WHERE id = ?')
                .get(created.recipe.id).deleted_at,
            null
        );
        assert.throws(
            () => buildRecipeDeletePreview(
                fixture.dependencies,
                created.recipe.id,
                { expectedUpdatedAt: '2026-08-01T00:00:00.000Z' }
            ),
            error => error.code === 'resource_version_conflict' && error.statusCode === 409
        );
        assert.throws(
            () => buildRecipeDeletePreview(fixture.dependencies, 999999, {}),
            error => error.code === 'recipe_not_found' && error.statusCode === 404
        );
    } finally {
        fixture.db.close();
    }
});

test('配方删除使用版本、持久幂等和强审计并保持软删除', () => {
    const fixture = createFixture();
    try {
        const createDraft = buildRecipeSavePayloadDraft(fixture.dependencies, draftInput());
        const created = executeRecipeCreate(
            fixture.dependencies,
            createDraft,
            commandContext(CREATE_CAPABILITY_ID, 'seed-delete')
        );
        const context = commandContext(DELETE_CAPABILITY_ID, 'delete');
        const preview = buildRecipeDeletePreview(
            fixture.dependencies,
            created.recipe.id,
            { expectedUpdatedAt: created.recipe.updatedAt }
        );
        const input = {
            expectedUpdatedAt: created.recipe.updatedAt,
            previewHash: preview.previewHash,
        };
        const first = executeRecipeDelete(
            fixture.dependencies,
            created.recipe.id,
            input,
            context
        );
        const replay = executeRecipeDelete(
            fixture.dependencies,
            created.recipe.id,
            input,
            context
        );

        assert.equal(first.deleted, 1);
        assert.equal(first.recipeId, created.recipe.id);
        assert.equal(first.status, 'completed');
        assert.equal(first.auditIds.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.ok(fixture.db.prepare(
            'SELECT deleted_at FROM recipes WHERE id = ?'
        ).get(created.recipe.id).deleted_at);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count,
            2
        );
    } finally {
        fixture.db.close();
    }
});

test('配方删除预览哈希不匹配时保持有效且不留下 operation 或审计', () => {
    const fixture = createFixture();
    try {
        const createDraft = buildRecipeSavePayloadDraft(fixture.dependencies, draftInput());
        const created = executeRecipeCreate(
            fixture.dependencies,
            createDraft,
            commandContext(CREATE_CAPABILITY_ID, 'seed-delete-preview-conflict')
        );
        const auditCountBefore = fixture.db.prepare(
            'SELECT COUNT(*) AS count FROM audit_log'
        ).get().count;
        assert.throws(
            () => executeRecipeDelete(
                fixture.dependencies,
                created.recipe.id,
                {
                    expectedUpdatedAt: created.recipe.updatedAt,
                    previewHash: 'f'.repeat(64),
                },
                commandContext(DELETE_CAPABILITY_ID, 'delete-preview-conflict')
            ),
            error => error.code === 'preview_changed' && error.statusCode === 409
        );
        assert.equal(
            fixture.db.prepare('SELECT deleted_at FROM recipes WHERE id = ?')
                .get(created.recipe.id).deleted_at,
            null
        );
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count,
            auditCountBefore
        );
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) AS count FROM api_operations
                WHERE capability_id = ?
            `).get(DELETE_CAPABILITY_ID).count,
            0
        );
    } finally {
        fixture.db.close();
    }
});

test('配方删除版本冲突时保持有效且不留下 operation', () => {
    const fixture = createFixture();
    try {
        const createDraft = buildRecipeSavePayloadDraft(fixture.dependencies, draftInput());
        const created = executeRecipeCreate(
            fixture.dependencies,
            createDraft,
            commandContext(CREATE_CAPABILITY_ID, 'seed-delete-conflict')
        );
        assert.throws(
            () => executeRecipeDelete(
                fixture.dependencies,
                created.recipe.id,
                { expectedUpdatedAt: '2026-08-01T00:00:00.000Z' },
                commandContext(DELETE_CAPABILITY_ID, 'delete-version-conflict')
            ),
            error => error.code === 'resource_version_conflict'
                && error.statusCode === 409
        );
        assert.equal(
            fixture.db.prepare('SELECT deleted_at FROM recipes WHERE id = ?')
                .get(created.recipe.id).deleted_at,
            null
        );
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) AS count FROM api_operations
                WHERE capability_id = ?
            `).get(DELETE_CAPABILITY_ID).count,
            0
        );
    } finally {
        fixture.db.close();
    }
});
