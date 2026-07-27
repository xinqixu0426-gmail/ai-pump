const crypto = require('node:crypto');
const {
    CANONICAL_INDEXES_SQL,
    CANONICAL_TABLES_SQL,
    CORE_CONSTRAINED_TABLES,
    LEGACY_COLUMN_UPGRADES,
    canonicalCreateTableSql,
    createKnowledgeFts,
} = require('./schema.cjs');
const { partSubcategory } = require('../services/packagingClassification.cjs');
const { normalizePackagingPart } = require('../services/packagingSemantics.cjs');
const { renderRecipeCostSnapshot } = require('../services/costEngine.cjs');

const MIGRATION_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
    )
`;

function quoteIdentifier(identifier) {
    if (!/^[a-z][a-z0-9_]*$/.test(identifier)) {
        throw new Error(`非法数据库标识符: ${identifier}`);
    }
    return `"${identifier}"`;
}

function tableExists(db, table) {
    return Boolean(db.prepare(`
        SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?
    `).get(table));
}

function columnNames(db, table) {
    if (!tableExists(db, table)) return new Set();
    return new Set(db.pragma(`table_info(${quoteIdentifier(table)})`).map((column) => column.name));
}

function addMissingLegacyColumns(db) {
    for (const [table, definitions] of Object.entries(LEGACY_COLUMN_UPGRADES)) {
        const existing = columnNames(db, table);
        for (const [column, definition] of definitions) {
            if (existing.has(column)) continue;
            db.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition}`);
            existing.add(column);
        }
    }
}

function backfillLegacyRecipes(db) {
    db.exec(`
        UPDATE recipes
        SET long_screw_extra_length = COALESCE((
            SELECT CAST(json_extract(item.value, '$.longScrewExtraLength') AS REAL)
            FROM json_each(recipes.parts_json) AS item
            WHERE json_extract(item.value, '$.dynamicRule') = 'longScrewByBarrelLength'
              AND json_type(item.value, '$.longScrewExtraLength') IN ('integer', 'real')
            LIMIT 1
        ), long_screw_extra_length, 0)
        WHERE (long_screw_extra_length IS NULL OR long_screw_extra_length = 0)
          AND json_valid(parts_json);

        UPDATE recipes
        SET packing_parts_json = json_array(
            json_object('model', box_type, 'supplier', '', 'qty', 1)
        )
        WHERE box_type IS NOT NULL
          AND TRIM(box_type) <> ''
          AND (packing_parts_json IS NULL OR packing_parts_json = '[]');
    `);
}

function backfillPackagingSubcategories(db) {
    const rows = db.prepare(`
        SELECT id, model, category, subcategory, supplier, remark
        FROM parts
        WHERE category = '包装' AND (subcategory IS NULL OR TRIM(subcategory) = '')
    `).all();
    const update = db.prepare(`
        UPDATE parts SET subcategory = ?, updated_at = COALESCE(updated_at, ?) WHERE id = ?
    `);
    const now = new Date().toISOString();
    rows.forEach((row) => update.run(partSubcategory(row.category, row.subcategory, row), now, row.id));
}

function normalizeScrewMetadata(db) {
    const rows = db.prepare(`
        SELECT id, remark FROM parts WHERE remark LIKE '%"screwPricing"%'
    `).all();
    const update = db.prepare('UPDATE parts SET remark = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    for (const row of rows) {
        let notes;
        try {
            notes = JSON.parse(row.remark || '{}');
        } catch {
            continue;
        }
        if (!notes?.screwPricing || typeof notes.screwPricing !== 'object') continue;
        const diameter = Number(notes.screwPricing.diameter);
        notes.screwPricing = {
            enabled: Boolean(notes.screwPricing.enabled),
            diameter: Number.isFinite(diameter) && diameter > 0 ? diameter : 6,
            modelPrefix: typeof notes.screwPricing.modelPrefix === 'string'
                ? notes.screwPricing.modelPrefix
                : undefined,
        };
        update.run(JSON.stringify(notes), now, row.id);
    }
}

function migrateCoilDomain(db) {
    const rows = db.prepare('SELECT * FROM coils ORDER BY id').all();
    const insertVariant = db.prepare(`
        INSERT INTO stator_variants (
            diameter_mm, common_name, material, slot_type, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const updateCoil = db.prepare(`
        UPDATE coils
        SET stator_variant_id = ?, material = ?, slot_type = ?,
            scheme_status = ?, scheme_name = ?, updated_at = ?
        WHERE id = ?
    `);
    const now = new Date().toISOString();

    for (const row of rows) {
        const rawSpec = String(row.spec || '').trim();
        const rawMaterial = String(row.material || '钢带').trim() || '钢带';
        const diameterMm = rawSpec === '12' ? 120 : Number.parseInt(rawSpec, 10);
        if (!Number.isInteger(diameterMm) || diameterMm <= 0) continue;

        const material = rawMaterial.includes('冷轧')
            ? '冷轧'
            : rawMaterial.includes('钢带') ? '钢带' : rawMaterial;
        const slotType = rawMaterial.includes('国标眼') || row.slot_type === '国标眼'
            ? '国标眼'
            : '小眼';
        let variant = db.prepare(`
            SELECT id FROM stator_variants
            WHERE diameter_mm = ? AND material = ? AND slot_type = ?
        `).get(diameterMm, material, slotType);
        if (!variant) {
            const info = insertVariant.run(diameterMm, rawSpec, material, slotType, now, now);
            variant = { id: Number(info.lastInsertRowid) };
        }
        updateCoil.run(
            variant.id,
            material,
            slotType,
            row.scheme_status || 'official',
            row.scheme_name || '正式方案',
            row.updated_at || now,
            row.id
        );
    }

    const duplicates = db.prepare(`
        SELECT stator_variant_id, sheets, MIN(id) AS keep_id
        FROM coils
        WHERE stator_variant_id IS NOT NULL AND scheme_status = 'official'
        GROUP BY stator_variant_id, sheets
        HAVING COUNT(*) > 1
    `).all();
    const demote = db.prepare(`
        UPDATE coils SET scheme_status = 'testing', updated_at = ?
        WHERE stator_variant_id = ? AND sheets = ?
          AND scheme_status = 'official' AND id <> ?
    `);
    duplicates.forEach((row) => demote.run(now, row.stator_variant_id, row.sheets, row.keep_id));
}

function ordersNeedRebuild(db) {
    const status = db.pragma('table_info(orders)').find((column) => column.name === 'status');
    return status?.dflt_value !== "'待确认'";
}

function coilsNeedRebuild(db) {
    return !db.pragma('foreign_key_list(coils)').some((fk) => (
        fk.table === 'stator_variants' && fk.from === 'stator_variant_id' && fk.to === 'id'
    ));
}

function rebuildOrders(db) {
    if (!ordersNeedRebuild(db)) return;
    db.exec(`
        DROP TABLE IF EXISTS orders_schema_legacy;
        ALTER TABLE orders RENAME TO orders_schema_legacy;
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_name TEXT NOT NULL,
            contract_no TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            status TEXT DEFAULT '待确认',
            items_json TEXT DEFAULT '[]',
            purchase_list_json TEXT DEFAULT '[]',
            todos_json TEXT DEFAULT '[]',
            purchase_completed_at TEXT,
            purchase_receipt_id TEXT,
            status_reason TEXT DEFAULT '',
            status_changed_at TEXT,
            closed_at TEXT,
            cancelled_at TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        INSERT INTO orders (
            id, customer_name, contract_no, remark, status,
            items_json, purchase_list_json, todos_json,
            purchase_completed_at, purchase_receipt_id,
            status_reason, status_changed_at, closed_at, cancelled_at,
            created_at, updated_at, deleted_at
        )
        SELECT
            id, customer_name, contract_no, remark, status,
            items_json, purchase_list_json, todos_json,
            purchase_completed_at, purchase_receipt_id,
            status_reason, status_changed_at, closed_at, cancelled_at,
            created_at, updated_at, deleted_at
        FROM orders_schema_legacy;
        DROP TABLE orders_schema_legacy;
    `);
}

function rebuildCoils(db) {
    if (!coilsNeedRebuild(db)) return;
    db.exec(`
        DROP INDEX IF EXISTS idx_coils_variant_sheets;
        DROP INDEX IF EXISTS idx_coils_one_official_scheme;
        DROP TABLE IF EXISTS coils_schema_legacy;
        ALTER TABLE coils RENAME TO coils_schema_legacy;
        CREATE TABLE coils (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stator_variant_id INTEGER,
            spec TEXT NOT NULL,
            material TEXT DEFAULT '钢带',
            slot_type TEXT DEFAULT '小眼',
            sheets INTEGER NOT NULL,
            scheme_name TEXT DEFAULT '',
            scheme_status TEXT DEFAULT 'official',
            unit_price REAL DEFAULT 0,
            wire_weight REAL DEFAULT 0,
            copper_base REAL DEFAULT 0,
            coil_fee REAL DEFAULT 0,
            rotor_fee REAL DEFAULT 0,
            cost REAL DEFAULT 0,
            default_wire_gauge TEXT,
            default_capacitor TEXT,
            main_wire_gauge TEXT DEFAULT '',
            main_wire_data TEXT DEFAULT '',
            aux_wire_gauge TEXT DEFAULT '',
            aux_wire_data TEXT DEFAULT '',
            created_at TEXT,
            updated_at TEXT,
            FOREIGN KEY(stator_variant_id) REFERENCES stator_variants(id)
        );
        INSERT INTO coils (
            id, stator_variant_id, spec, material, slot_type, sheets,
            scheme_name, scheme_status, unit_price, wire_weight, copper_base,
            coil_fee, rotor_fee, cost, default_wire_gauge, default_capacitor,
            main_wire_gauge, main_wire_data, aux_wire_gauge, aux_wire_data,
            created_at, updated_at
        )
        SELECT
            id, stator_variant_id, spec, material, slot_type, sheets,
            scheme_name, scheme_status, unit_price, wire_weight, copper_base,
            coil_fee, rotor_fee, cost, default_wire_gauge, default_capacitor,
            main_wire_gauge, main_wire_data, aux_wire_gauge, aux_wire_data,
            created_at, updated_at
        FROM coils_schema_legacy;
        DROP TABLE coils_schema_legacy;
    `);
}

function rebuildCoreTablesWithConstraints(db) {
    for (const table of CORE_CONSTRAINED_TABLES) {
        const target = `${table}_schema_v5`;
        db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(target)}`);
        db.exec(canonicalCreateTableSql(table, target));
        const sourceColumns = columnNames(db, table);
        const targetColumns = [...columnNames(db, target)];
        const missing = targetColumns.filter((column) => !sourceColumns.has(column));
        if (missing.length > 0) {
            throw new Error(`${table} 重建缺少来源列: ${missing.join(', ')}`);
        }
        const columnsSql = targetColumns.map(quoteIdentifier).join(', ');
        db.exec(`
            INSERT INTO ${quoteIdentifier(target)} (${columnsSql})
            SELECT ${columnsSql} FROM ${quoteIdentifier(table)}
        `);
    }

    for (const table of [...CORE_CONSTRAINED_TABLES].reverse()) {
        db.exec(`DROP TABLE ${quoteIdentifier(table)}`);
    }
    for (const table of CORE_CONSTRAINED_TABLES) {
        db.exec(`ALTER TABLE ${quoteIdentifier(`${table}_schema_v5`)} RENAME TO ${quoteIdentifier(table)}`);
    }

    const foreignKeyErrors = db.pragma('foreign_key_check');
    if (foreignKeyErrors.length > 0) {
        throw new Error(`核心表重建后存在 ${foreignKeyErrors.length} 条外键错误`);
    }
}

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function packagingIdentity(part = {}) {
    return `${String(part.model || '').trim()}\u0000${String(part.supplier || '').trim()}`;
}

function repairRecipePackagingSnapshots(db) {
    const rows = db.prepare(`
        SELECT * FROM recipes
        WHERE deleted_at IS NULL
          AND packing_parts_json IS NOT NULL
          AND packing_parts_json <> '[]'
        ORDER BY id
    `).all();
    const update = db.prepare(`
        UPDATE recipes
        SET packing_parts_json = ?, parts_json = ?,
            saved_total_cost = ?, saved_cost_details = ?, updated_at = ?
        WHERE id = ?
    `);
    const now = new Date().toISOString();

    for (const row of rows) {
        const packingParts = parseJsonArray(row.packing_parts_json);
        const normalizedPacking = packingParts.map((part) => normalizePackagingPart(part));
        const materialCorrections = normalizedPacking.filter((part, index) => (
            part.packagingMaterial !== String(packingParts[index]?.packagingMaterial || '').trim()
        )).length;
        if (materialCorrections === 0) continue;

        const semanticsByIdentity = new Map(
            normalizedPacking.map((part) => [packagingIdentity(part), part])
        );
        const correctedParts = parseJsonArray(row.parts_json).map((part) => {
            const selected = semanticsByIdentity.get(packagingIdentity(part));
            if (!selected && !part?.packingRole && !part?.packagingMaterial) return part;
            return normalizePackagingPart({
                ...part,
                ...(selected ? {
                    packagingMaterial: selected.packagingMaterial,
                    packingRole: selected.packingRole,
                } : {}),
            }, { rewriteName: true });
        });
        const snapshot = renderRecipeCostSnapshot(correctedParts, {
            assemblyWage: row.assembly_wage,
            packingWage: row.packing_wage,
            surfaceTreatmentMode: row.surface_treatment_mode,
            surfaceTreatmentCost: row.surface_treatment_cost,
            managementFee: row.management_fee,
            coilMaterial: row.coil_material,
        });
        if (Math.abs(Number(row.saved_total_cost || 0) - snapshot.savedTotalCost) > 0.001) {
            throw new Error(`配方 ${row.id} 包装语义修复改变了历史保存成本`);
        }
        update.run(
            JSON.stringify(normalizedPacking),
            JSON.stringify(correctedParts),
            snapshot.savedTotalCost,
            snapshot.savedCostDetails,
            now,
            row.id
        );
    }
}

const MIGRATIONS = Object.freeze([
    {
        version: 1,
        name: 'canonical_tables_and_legacy_columns',
        signature: 'canonical-tables-v1',
        up(db) {
            db.exec(CANONICAL_TABLES_SQL);
            addMissingLegacyColumns(db);
        },
    },
    {
        version: 2,
        name: 'legacy_data_backfills',
        signature: 'legacy-backfills-v1',
        up(db) {
            backfillLegacyRecipes(db);
            db.exec(`
                UPDATE orders SET status = '已关闭' WHERE status = '已完成';
                UPDATE coils SET material = '钢带'
                WHERE material IS NULL OR TRIM(material) = '';
            `);
            backfillPackagingSubcategories(db);
            normalizeScrewMetadata(db);
            migrateCoilDomain(db);
        },
    },
    {
        version: 3,
        name: 'canonicalize_orders_and_coils',
        signature: 'canonical-rebuild-orders-coils-v1',
        up(db) {
            rebuildOrders(db);
            rebuildCoils(db);
        },
    },
    {
        version: 4,
        name: 'canonical_indexes_and_fts',
        signature: 'canonical-indexes-fts-v1',
        up(db) {
            db.exec(CANONICAL_INDEXES_SQL);
            try {
                createKnowledgeFts(db);
            } catch {
                // FTS5 is optional; knowledge search falls back to LIKE.
            }
        },
    },
    {
        version: 5,
        name: 'core_constraints_and_foreign_keys',
        signature: 'core-constraints-foreign-keys-v1',
        foreignKeysOff: true,
        up(db) {
            rebuildCoreTablesWithConstraints(db);
        },
    },
    {
        version: 6,
        name: 'repair_packaging_snapshot_semantics',
        signature: 'repair-packaging-snapshots-v1',
        up(db) {
            repairRecipePackagingSnapshots(db);
        },
    },
    {
        version: 7,
        name: 'operational_and_audit_indexes',
        signature: 'operational-audit-indexes-v1',
        up(db) {
            db.exec(CANONICAL_INDEXES_SQL);
        },
    },
    {
        version: 8,
        name: 'recipe_analysis_feedback',
        signature: 'recipe-analysis-feedback-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS recipe_analysis_feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    recipe_id INTEGER NOT NULL,
                    finding_key TEXT NOT NULL,
                    finding_type TEXT NOT NULL,
                    decision TEXT NOT NULL CHECK(decision IN ('confirmed', 'ignored', 'special_case', 'review')),
                    note TEXT DEFAULT '',
                    finding_snapshot_json TEXT DEFAULT '{}',
                    created_at TEXT,
                    updated_at TEXT,
                    FOREIGN KEY(recipe_id) REFERENCES recipes(id),
                    UNIQUE(recipe_id, finding_key)
                );
                CREATE INDEX IF NOT EXISTS idx_recipe_analysis_feedback_recipe
                    ON recipe_analysis_feedback(recipe_id, updated_at DESC);
            `);
        },
    },
    {
        version: 9,
        name: 'factory_rule_candidates',
        signature: 'factory-rule-candidates-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS factory_rule_candidates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    rule_key TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    scope_type TEXT NOT NULL DEFAULT 'pump_shell_template',
                    scope_ref TEXT NOT NULL,
                    finding_key TEXT NOT NULL,
                    finding_type TEXT NOT NULL,
                    evidence_count INTEGER NOT NULL DEFAULT 0,
                    evidence_json TEXT DEFAULT '[]',
                    status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate', 'approved', 'rejected', 'stale')),
                    review_note TEXT DEFAULT '',
                    approved_at TEXT,
                    created_at TEXT,
                    updated_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_factory_rule_candidates_status
                    ON factory_rule_candidates(status, updated_at DESC);
            `);
        },
    },
    {
        version: 10,
        name: 'ai_answer_feedback',
        signature: 'ai-answer-feedback-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS ai_answer_feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id INTEGER NOT NULL,
                    message_id INTEGER NOT NULL UNIQUE,
                    rating TEXT NOT NULL CHECK(rating IN ('helpful', 'incorrect', 'outdated', 'missing_source')),
                    note TEXT DEFAULT '',
                    question_text TEXT DEFAULT '',
                    answer_text TEXT DEFAULT '',
                    sources_json TEXT DEFAULT '[]',
                    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
                    resolution_note TEXT DEFAULT '',
                    resolved_at TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id),
                    FOREIGN KEY(message_id) REFERENCES ai_conversation_messages(id)
                );
                CREATE INDEX IF NOT EXISTS idx_ai_answer_feedback_status
                    ON ai_answer_feedback(status, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_ai_answer_feedback_conversation
                    ON ai_answer_feedback(conversation_id, message_id);
            `);
        },
    },
    {
        version: 11,
        name: 'ai_answer_feedback_diagnosis_retest',
        signature: 'ai-answer-feedback-diagnosis-retest-v1',
        up(db) {
            const columns = new Set(db.pragma('table_info(ai_answer_feedback)').map(column => column.name));
            const additions = [
                ['diagnosis_json', "TEXT DEFAULT '{}'"],
                ['diagnosed_at', 'TEXT'],
                ['retest_answer_text', "TEXT DEFAULT ''"],
                ['retest_sources_json', "TEXT DEFAULT '[]'"],
                ['retested_at', 'TEXT'],
            ];
            for (const [column, definition] of additions) {
                if (!columns.has(column)) {
                    db.exec(`ALTER TABLE ai_answer_feedback ADD COLUMN ${column} ${definition}`);
                }
            }
        },
    },
]);

function migrationChecksum(migration) {
    return crypto
        .createHash('sha256')
        .update(`${migration.version}:${migration.name}:${migration.signature}`)
        .digest('hex');
}

function runMigrations(db, options = {}) {
    db.exec(MIGRATION_TABLE_SQL);
    const appliedRows = db.prepare(`
        SELECT version, name, checksum FROM schema_migrations ORDER BY version
    `).all();
    const knownVersions = new Set(MIGRATIONS.map((migration) => migration.version));
    const unknown = appliedRows.filter((row) => !knownVersions.has(row.version));
    if (unknown.length > 0) {
        throw new Error(`数据库版本高于当前代码: ${unknown.map((row) => row.version).join(', ')}`);
    }

    const applied = new Map(appliedRows.map((row) => [row.version, row]));
    const insert = db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
    `);
    const completed = [];

    for (const migration of MIGRATIONS) {
        const checksum = migrationChecksum(migration);
        const existing = applied.get(migration.version);
        if (existing) {
            if (existing.name !== migration.name || existing.checksum !== checksum) {
                throw new Error(`迁移 ${migration.version} 校验失败，已应用迁移不得修改`);
            }
            continue;
        }
        const foreignKeysEnabled = Boolean(db.pragma('foreign_keys', { simple: true }));
        if (migration.foreignKeysOff && foreignKeysEnabled) db.pragma('foreign_keys = OFF');
        try {
            const apply = db.transaction(() => {
                migration.up(db);
                insert.run(
                    migration.version,
                    migration.name,
                    checksum,
                    options.now || new Date().toISOString()
                );
                db.pragma(`user_version = ${migration.version}`);
            });
            apply.immediate();
        } finally {
            if (migration.foreignKeysOff && foreignKeysEnabled) db.pragma('foreign_keys = ON');
        }
        completed.push(migration.version);
    }

    const currentVersion = MIGRATIONS.at(-1)?.version || 0;
    if (Number(db.pragma('user_version', { simple: true })) !== currentVersion) {
        db.pragma(`user_version = ${currentVersion}`);
    }
    return { currentVersion, appliedVersions: completed };
}

module.exports = {
    MIGRATIONS,
    MIGRATION_TABLE_SQL,
    migrationChecksum,
    repairRecipePackagingSnapshots,
    runMigrations,
};
