const crypto = require('node:crypto');
const {
    CANONICAL_INDEXES_SQL,
    CANONICAL_TABLES_SQL,
    COIL_INVENTORY_SCHEMA_SQL,
    COIL_STOCK_COLUMN_DEFINITION,
    CORE_CONSTRAINED_TABLES,
    LEGACY_COLUMN_UPGRADES,
    canonicalCreateTableSql,
    createKnowledgeFts,
} = require('./schema.cjs');
const { partSubcategory } = require('../services/packagingClassification.cjs');
const { normalizePackagingPart } = require('../services/packagingSemantics.cjs');
const { isPackagingEstimatePart } = require('../services/packagingEstimate.cjs');
const { renderRecipeCostSnapshot } = require('../services/costEngine.cjs');
const { buildFeedbackEvaluationProposal } = require('../services/aiRegressionCases.cjs');

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
    const hasCustomerForeignKey = db.pragma('foreign_key_list(orders)').some((fk) => (
        fk.table === 'customers' && fk.from === 'customer_id' && fk.to === 'id'
    ));
    return status?.dflt_value !== "'待确认'" || !hasCustomerForeignKey;
}

function coilsNeedRebuild(db) {
    return !db.pragma('foreign_key_list(coils)').some((fk) => (
        fk.table === 'stator_variants' && fk.from === 'stator_variant_id' && fk.to === 'id'
    ));
}

function rebuildOrders(db) {
    if (!ordersNeedRebuild(db)) return;
    const legacyColumns = columnNames(db, 'orders');
    const disposition = legacyColumns.has('inventory_disposition') ? 'inventory_disposition' : 'NULL';
    const dispositionAt = legacyColumns.has('inventory_disposition_at') ? 'inventory_disposition_at' : 'NULL';
    const dispositionNote = legacyColumns.has('inventory_disposition_note') ? 'inventory_disposition_note' : "''";
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
            inventory_disposition TEXT,
            inventory_disposition_at TEXT,
            inventory_disposition_note TEXT DEFAULT '',
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT,
            customer_id INTEGER,
            FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
            CHECK(status IN ('待确认', '待采购', '采购中', '采购完成', '已关闭', '已取消'))
        );
        INSERT INTO orders (
            id, customer_name, contract_no, remark, status,
            items_json, purchase_list_json, todos_json,
            purchase_completed_at, purchase_receipt_id,
            status_reason, status_changed_at, closed_at, cancelled_at,
            inventory_disposition, inventory_disposition_at, inventory_disposition_note,
            created_at, updated_at, deleted_at, customer_id
        )
        SELECT
            id, customer_name, contract_no, remark, status,
            items_json, purchase_list_json, todos_json,
            purchase_completed_at, purchase_receipt_id,
            status_reason, status_changed_at, closed_at, cancelled_at,
            ${disposition}, ${dispositionAt}, ${dispositionNote},
            created_at, updated_at, deleted_at, customer_id
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
    if (Array.isArray(value)) return value;
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

function repairOrderPackagingEstimates(db, options = {}) {
    if (!tableExists(db, 'orders') || !tableExists(db, 'recipes') || !tableExists(db, 'parts')) {
        return { repairedOrders: 0, repairedItems: 0 };
    }
    const catalog = db.prepare(`
        SELECT id, model, supplier, stock
        FROM parts
        WHERE deleted_at IS NULL AND category = '包装' AND subcategory = '外包装'
        ORDER BY id
    `).all();
    const catalogByIdentity = new Map(catalog.map(part => [packagingIdentity(part), part]));
    const catalogByModel = new Map();
    for (const part of catalog) {
        const entries = catalogByModel.get(part.model) || [];
        entries.push(part);
        catalogByModel.set(part.model, entries);
    }
    const recipes = new Map(db.prepare(`
        SELECT id, packing_parts_json
        FROM recipes
        WHERE deleted_at IS NULL
    `).all().map(row => [Number(row.id), row]));
    const rows = db.prepare(`
        SELECT id, items_json, purchase_list_json, todos_json
        FROM orders
        WHERE deleted_at IS NULL AND status NOT IN ('已关闭', '已取消')
        ORDER BY id
    `).all();
    const update = db.prepare(`
        UPDATE orders
        SET items_json = ?, purchase_list_json = ?, todos_json = ?, updated_at = ?
        WHERE id = ?
    `);
    const now = options.now || new Date().toISOString();
    let repairedOrders = 0;
    let repairedItems = 0;

    function resolveCatalogPart(part) {
        const exact = catalogByIdentity.get(packagingIdentity(part));
        if (exact) return exact;
        const sameModel = catalogByModel.get(String(part.model || '').trim()) || [];
        return sameModel.length === 1 ? sameModel[0] : null;
    }

    function resolveEstimate(item, estimate) {
        const recipe = recipes.get(Number(item.recipeId || 0));
        if (!recipe) return null;
        const estimateMaterial = normalizePackagingPart(estimate).packagingMaterial;
        const containers = parseJsonArray(recipe.packing_parts_json)
            .map(part => normalizePackagingPart(part))
            .filter(part => part.packingRole === 'container');
        const materialMatches = containers.filter(part => part.packagingMaterial === estimateMaterial);
        const candidates = materialMatches.length > 0 ? materialMatches : containers;
        if (candidates.length !== 1) return null;
        const selected = candidates[0];
        const catalogPart = resolveCatalogPart(selected);
        if (!catalogPart) return null;
        return {
            selected,
            catalogPart,
            targetKey: `part:${catalogPart.id}`,
        };
    }

    for (const row of rows) {
        const items = parseJsonArray(row.items_json);
        const replacements = new Map();
        const conflicts = new Set();
        for (const item of items) {
            for (const part of parseJsonArray(item.partsJson)) {
                if (!isPackagingEstimatePart(part)) continue;
                const resolved = resolveEstimate(item, part);
                if (!resolved) continue;
                const legacyKey = packagingIdentity(part);
                const existing = replacements.get(legacyKey);
                if (existing && existing.targetKey !== resolved.targetKey) {
                    conflicts.add(legacyKey);
                } else {
                    replacements.set(legacyKey, resolved);
                }
            }
        }
        for (const key of conflicts) replacements.delete(key);
        if (replacements.size === 0) continue;

        let itemChanges = 0;
        const nextItems = items.map(item => {
            const parts = parseJsonArray(item.partsJson);
            let changed = false;
            const nextParts = parts.map(part => {
                const resolved = replacements.get(packagingIdentity(part));
                if (!isPackagingEstimatePart(part) || !resolved) return part;
                changed = true;
                itemChanges += 1;
                return {
                    ...part,
                    model: resolved.selected.model,
                    name: `${resolved.selected.model}（${resolved.selected.packagingMaterial}）`,
                    supplier: resolved.catalogPart.supplier,
                    packagingMaterial: resolved.selected.packagingMaterial,
                    packingRole: 'container',
                    partId: resolved.catalogPart.id,
                    legacyEstimateModel: String(part.model || '').trim(),
                };
            });
            return changed ? { ...item, partsJson: JSON.stringify(nextParts) } : item;
        });
        if (itemChanges === 0) continue;

        const nextPurchaseList = parseJsonArray(row.purchase_list_json).map(part => {
            const resolved = replacements.get(packagingIdentity(part));
            if (!isPackagingEstimatePart(part) || !resolved) return part;
            return {
                ...part,
                model: resolved.selected.model,
                name: `${resolved.selected.model}（${resolved.selected.packagingMaterial}）`,
                supplier: resolved.catalogPart.supplier,
                actualSupplier: String(part.actualSupplier || '').trim() || resolved.catalogPart.supplier,
                currentStock: Number(resolved.catalogPart.stock || 0),
                partId: resolved.catalogPart.id,
                inventoryType: 'part',
                identityKey: resolved.targetKey,
                packagingMaterial: resolved.selected.packagingMaterial,
                packingRole: 'container',
                legacyEstimateModel: String(part.model || '').trim(),
            };
        });
        const nextTodos = parseJsonArray(row.todos_json).map(todo => {
            let description = String(todo.description || '');
            let supplier = String(todo.supplier || '').trim();
            for (const [legacyKey, resolved] of replacements) {
                const legacyModel = legacyKey.split('\u0000')[0];
                if (!description.includes(legacyModel)) continue;
                description = description.replaceAll(legacyModel, resolved.selected.model);
                supplier = supplier || resolved.catalogPart.supplier;
                if (supplier) description = description.replace('【】', `【${supplier}】`);
            }
            return { ...todo, description, supplier };
        });
        update.run(
            JSON.stringify(nextItems),
            JSON.stringify(nextPurchaseList),
            JSON.stringify(nextTodos),
            now,
            row.id
        );
        repairedOrders += 1;
        repairedItems += itemChanges;
    }
    return { repairedOrders, repairedItems };
}

function addOrderFactoryFileLinks(db) {
    const tableSql = String(db.prepare(`
        SELECT sql FROM sqlite_schema
        WHERE type = 'table' AND name = 'factory_file_links'
    `).get()?.sql || '');
    if (tableSql.includes("'order'") && tableSql.includes("'customer_requirement'")) return;

    db.exec(`
        DROP INDEX IF EXISTS idx_factory_file_links_file;
        DROP INDEX IF EXISTS idx_factory_file_links_target;
        DROP INDEX IF EXISTS idx_factory_file_links_active_unique;
        DROP TABLE IF EXISTS factory_file_links_v9;
        ALTER TABLE factory_file_links RENAME TO factory_file_links_v9;

        CREATE TABLE factory_file_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            target_type TEXT NOT NULL
                CHECK(target_type IN (
                    'customer',
                    'quotation',
                    'order',
                    'recipe',
                    'recipe_analysis_feedback',
                    'ai_answer_feedback',
                    'knowledge_document'
                )),
            target_id INTEGER NOT NULL,
            relation_role TEXT NOT NULL DEFAULT 'attachment'
                CHECK(relation_role IN (
                    'attachment',
                    'customer_requirement',
                    'technical_reference',
                    'quotation_source',
                    'quality_evidence',
                    'knowledge_source'
                )),
            title TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT 'manual'
                CHECK(source IN ('manual', 'ai_chat', 'business_page')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            FOREIGN KEY(file_id) REFERENCES factory_files(id)
        );

        INSERT INTO factory_file_links (
            id, file_id, target_type, target_id, relation_role,
            title, note, source, created_at, updated_at, deleted_at
        )
        SELECT
            id, file_id, target_type, target_id, relation_role,
            title, note, source, created_at, updated_at, deleted_at
        FROM factory_file_links_v9;

        DROP TABLE factory_file_links_v9;
        CREATE INDEX idx_factory_file_links_file
            ON factory_file_links(file_id, deleted_at, updated_at DESC);
        CREATE INDEX idx_factory_file_links_target
            ON factory_file_links(target_type, target_id, deleted_at, updated_at DESC);
        CREATE UNIQUE INDEX idx_factory_file_links_active_unique
            ON factory_file_links(file_id, target_type, target_id, relation_role)
            WHERE deleted_at IS NULL;
    `);
}

function addOrderExecutionEvidenceFileRole(db) {
    const tableSql = String(db.prepare(`
        SELECT sql FROM sqlite_schema
        WHERE type = 'table' AND name = 'factory_file_links'
    `).get()?.sql || '');
    if (tableSql.includes("'execution_evidence'")) return;

    db.exec(`
        DROP INDEX IF EXISTS idx_factory_file_links_file;
        DROP INDEX IF EXISTS idx_factory_file_links_target;
        DROP INDEX IF EXISTS idx_factory_file_links_active_unique;
        DROP TABLE IF EXISTS factory_file_links_v10;
        ALTER TABLE factory_file_links RENAME TO factory_file_links_v10;

        CREATE TABLE factory_file_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            target_type TEXT NOT NULL
                CHECK(target_type IN (
                    'customer',
                    'quotation',
                    'order',
                    'recipe',
                    'recipe_analysis_feedback',
                    'ai_answer_feedback',
                    'knowledge_document'
                )),
            target_id INTEGER NOT NULL,
            relation_role TEXT NOT NULL DEFAULT 'attachment'
                CHECK(relation_role IN (
                    'attachment',
                    'customer_requirement',
                    'execution_evidence',
                    'technical_reference',
                    'quotation_source',
                    'quality_evidence',
                    'knowledge_source'
                )),
            title TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT 'manual'
                CHECK(source IN ('manual', 'ai_chat', 'business_page')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            FOREIGN KEY(file_id) REFERENCES factory_files(id)
        );

        INSERT INTO factory_file_links (
            id, file_id, target_type, target_id, relation_role,
            title, note, source, created_at, updated_at, deleted_at
        )
        SELECT
            id, file_id, target_type, target_id, relation_role,
            title, note, source, created_at, updated_at, deleted_at
        FROM factory_file_links_v10;

        DROP TABLE factory_file_links_v10;
        CREATE INDEX idx_factory_file_links_file
            ON factory_file_links(file_id, deleted_at, updated_at DESC);
        CREATE INDEX idx_factory_file_links_target
            ON factory_file_links(target_type, target_id, deleted_at, updated_at DESC);
        CREATE UNIQUE INDEX idx_factory_file_links_active_unique
            ON factory_file_links(file_id, target_type, target_id, relation_role)
            WHERE deleted_at IS NULL;
    `);
}

function createOrderRequirementSummariesTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS order_requirement_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL UNIQUE,
            draft_text TEXT NOT NULL DEFAULT '',
            confirmed_text TEXT NOT NULL DEFAULT '',
            source_file_ids_json TEXT NOT NULL DEFAULT '[]',
            confirmed_source_file_ids_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'draft'
                CHECK(status IN ('draft', 'confirmed')),
            confirmed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(order_id) REFERENCES orders(id)
        )
    `);
}

function repairOrderRequirementSummariesForeignKey(db) {
    if (!tableExists(db, 'order_requirement_summaries')) {
        createOrderRequirementSummariesTable(db);
        return;
    }
    const foreignKeys = db.pragma('foreign_key_list(order_requirement_summaries)');
    if (foreignKeys.some(item => item.from === 'order_id' && item.table === 'orders')) return;

    db.exec(`
        DROP TABLE IF EXISTS order_requirement_summaries_v10;
        ALTER TABLE order_requirement_summaries RENAME TO order_requirement_summaries_v10;
    `);
    createOrderRequirementSummariesTable(db);
    db.exec(`
        INSERT INTO order_requirement_summaries (
            id,
            order_id,
            draft_text,
            confirmed_text,
            source_file_ids_json,
            confirmed_source_file_ids_json,
            status,
            confirmed_at,
            created_at,
            updated_at
        )
        SELECT
            id,
            order_id,
            draft_text,
            confirmed_text,
            source_file_ids_json,
            confirmed_source_file_ids_json,
            status,
            confirmed_at,
            created_at,
            updated_at
        FROM order_requirement_summaries_v10;
        DROP TABLE order_requirement_summaries_v10;
    `);
}

function createOrderRevisionsTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS order_revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            revision_no INTEGER NOT NULL,
            reason TEXT NOT NULL,
            before_snapshot_json TEXT NOT NULL,
            after_snapshot_json TEXT NOT NULL,
            change_summary_json TEXT NOT NULL DEFAULT '[]',
            operation_id TEXT NOT NULL,
            actor TEXT NOT NULL DEFAULT 'system',
            created_at TEXT NOT NULL,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            UNIQUE(order_id, revision_no),
            UNIQUE(operation_id)
        );
        CREATE INDEX IF NOT EXISTS idx_order_revisions_order
            ON order_revisions(order_id, revision_no DESC);
    `);
}

function createOrderRevisionImmutabilityTriggers(db) {
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS order_revisions_no_update
        BEFORE UPDATE ON order_revisions
        BEGIN
            SELECT RAISE(ABORT, 'order revisions are immutable');
        END;
        CREATE TRIGGER IF NOT EXISTS order_revisions_no_delete
        BEFORE DELETE ON order_revisions
        BEGIN
            SELECT RAISE(ABORT, 'order revisions are immutable');
        END;
    `);
}

function repairOrderRevisionsForeignKey(db) {
    if (!tableExists(db, 'order_revisions')) {
        createOrderRevisionsTable(db);
        return;
    }
    const foreignKeys = db.pragma('foreign_key_list(order_revisions)');
    if (foreignKeys.some(item => item.from === 'order_id' && item.table === 'orders')) return;

    db.exec(`
        DROP INDEX IF EXISTS idx_order_revisions_order;
        DROP TABLE IF EXISTS order_revisions_v65;
        ALTER TABLE order_revisions RENAME TO order_revisions_v65;
    `);
    createOrderRevisionsTable(db);
    db.exec(`
        INSERT INTO order_revisions (
            id, order_id, revision_no, reason,
            before_snapshot_json, after_snapshot_json, change_summary_json,
            operation_id, actor, created_at
        )
        SELECT
            id, order_id, revision_no, reason,
            before_snapshot_json, after_snapshot_json, change_summary_json,
            operation_id, actor, created_at
        FROM order_revisions_v65;
        DROP TABLE order_revisions_v65;
    `);
}

function createOrderExecutionRecordsTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS order_execution_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            phase TEXT NOT NULL
                CHECK(phase IN ('pre_production', 'in_production', 'post_production')),
            record_type TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            draft_text TEXT NOT NULL DEFAULT '',
            occurred_at TEXT NOT NULL,
            source_file_ids_json TEXT NOT NULL DEFAULT '[]',
            confirmed_phase TEXT,
            confirmed_record_type TEXT NOT NULL DEFAULT '',
            confirmed_title TEXT NOT NULL DEFAULT '',
            confirmed_text TEXT NOT NULL DEFAULT '',
            confirmed_occurred_at TEXT,
            confirmed_source_file_ids_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'draft'
                CHECK(status IN ('draft', 'confirmed')),
            confirmed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            FOREIGN KEY(order_id) REFERENCES orders(id)
        );
        CREATE INDEX IF NOT EXISTS idx_order_execution_records_order
            ON order_execution_records(order_id, deleted_at, occurred_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_order_execution_records_confirmed
            ON order_execution_records(order_id, confirmed_at DESC)
            WHERE deleted_at IS NULL AND confirmed_text <> '';
    `);
}

function repairOrderExecutionRecordsForeignKey(db) {
    if (!tableExists(db, 'order_execution_records')) {
        createOrderExecutionRecordsTable(db);
        return;
    }
    const foreignKeys = db.pragma('foreign_key_list(order_execution_records)');
    if (foreignKeys.some(item => item.from === 'order_id' && item.table === 'orders')) return;

    db.exec(`
        DROP INDEX IF EXISTS idx_order_execution_records_order;
        DROP INDEX IF EXISTS idx_order_execution_records_confirmed;
        DROP TABLE IF EXISTS order_execution_records_v10;
        ALTER TABLE order_execution_records RENAME TO order_execution_records_v10;
    `);
    createOrderExecutionRecordsTable(db);
    db.exec(`
        INSERT INTO order_execution_records (
            id,
            order_id,
            phase,
            record_type,
            title,
            draft_text,
            occurred_at,
            source_file_ids_json,
            confirmed_phase,
            confirmed_record_type,
            confirmed_title,
            confirmed_text,
            confirmed_occurred_at,
            confirmed_source_file_ids_json,
            status,
            confirmed_at,
            created_at,
            updated_at,
            deleted_at
        )
        SELECT
            id,
            order_id,
            phase,
            record_type,
            title,
            draft_text,
            occurred_at,
            source_file_ids_json,
            confirmed_phase,
            confirmed_record_type,
            confirmed_title,
            confirmed_text,
            confirmed_occurred_at,
            confirmed_source_file_ids_json,
            status,
            confirmed_at,
            created_at,
            updated_at,
            deleted_at
        FROM order_execution_records_v10;
        DROP TABLE order_execution_records_v10;
    `);
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
    {
        version: 12,
        name: 'ai_knowledge_regression_suite',
        signature: 'ai-knowledge-regression-suite-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS ai_evaluation_cases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    case_key TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    category TEXT NOT NULL,
                    question TEXT NOT NULL,
                    evaluator_type TEXT NOT NULL DEFAULT 'rules',
                    config_json TEXT DEFAULT '{}',
                    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT,
                    updated_at TEXT
                );
                CREATE TABLE IF NOT EXISTS ai_evaluation_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    owner_key TEXT NOT NULL DEFAULT 'admin',
                    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
                    total_count INTEGER NOT NULL DEFAULT 0,
                    passed_count INTEGER NOT NULL DEFAULT 0,
                    failed_count INTEGER NOT NULL DEFAULT 0,
                    review_count INTEGER NOT NULL DEFAULT 0,
                    started_at TEXT,
                    completed_at TEXT,
                    created_at TEXT,
                    updated_at TEXT
                );
                CREATE TABLE IF NOT EXISTS ai_evaluation_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id INTEGER NOT NULL,
                    case_id INTEGER NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('passed', 'failed', 'review')),
                    answer_text TEXT DEFAULT '',
                    tool_results_json TEXT DEFAULT '[]',
                    sources_json TEXT DEFAULT '[]',
                    checks_json TEXT DEFAULT '[]',
                    error_text TEXT DEFAULT '',
                    created_at TEXT,
                    updated_at TEXT,
                    FOREIGN KEY(run_id) REFERENCES ai_evaluation_runs(id),
                    FOREIGN KEY(case_id) REFERENCES ai_evaluation_cases(id),
                    UNIQUE(run_id, case_id)
                );
                CREATE INDEX IF NOT EXISTS idx_ai_evaluation_runs_owner
                    ON ai_evaluation_runs(owner_key, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_ai_evaluation_results_run
                    ON ai_evaluation_results(run_id, case_id);
            `);
            const now = new Date().toISOString();
            const insert = db.prepare(`
                INSERT OR IGNORE INTO ai_evaluation_cases (
                    case_key, title, category, question, evaluator_type,
                    config_json, enabled, sort_order, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'rules', ?, 1, ?, ?, ?)
            `);
            const cases = [
                ['part-current-price', '零件价格使用当前值', '价格', '查询800平刀切割泵壳目前的单价，并说明数据来源。', {
                    expectedMode: 'live_business',
                    requiredTools: ['search_parts'],
                    fact: { type: 'part_price', model: '800平刀切割泵壳' },
                }],
                ['coil-all-official-variants', '线圈规格返回全部正式方案', '线圈', '查询12-220线圈的全部正式方案，列出材质、槽眼和成本。', {
                    requiredTerms: [['钢带'], ['小眼'], ['冷轧'], ['国标眼']],
                    requiredTools: ['search_factory_knowledge'],
                    requiredSourceTables: ['coils'],
                }],
                ['test-report-file-type', '测试报告不能标成图纸', '技术档案', 'V1600-3”-12-180配方技术档案中的Excel附件是什么资料？', {
                    requiredTerms: [['性能测试报告', '测试报告']],
                    forbiddenTerms: ['参考图纸', '工程图'],
                    requiredSourceTables: ['recipes'],
                }],
                ['test-report-ignore-template-points', '测试模板规定点不作为结论', '技术档案', '总结V1600-3”-12-180性能测试报告中的有效测试数据。', {
                    forbiddenTerms: ['规定点', '实测点', '偏差'],
                    requiredTerms: [['测试点'], ['流量'], ['扬程']],
                    requiredSourceTables: ['recipes'],
                }],
                ['customer-quotation-display-order', '客户报价不暴露内部序号', '报价', '查询客户邱焕现有的全部报价，按第1份、第2份这样的展示顺序列出。', {
                    requiredTools: ['search_customer_history'],
                    fact: { type: 'customer_quotation_count', customerName: '邱焕', forbidInternalIds: true },
                }],
                ['complete-cable-semantics', '电缆按成品整体解释', '配方', '说明配方里的电缆线材、长度、插头和规格费用之间是什么关系。', {
                    requiredTerms: [['成品电缆'], ['整体', '一体']],
                    forbiddenTerms: ['电缆配件费单独', '拆开计算'],
                }],
            ];
            cases.forEach((item, index) => insert.run(
                item[0], item[1], item[2], item[3], JSON.stringify(item[4]), (index + 1) * 10, now, now
            ));
        },
    },
    {
        version: 13,
        name: 'refine_knowledge_regression_cases',
        signature: 'remove-negated-drawing-false-positive-and-strengthen-cable-case',
        up(db) {
            const now = new Date().toISOString();
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = 'test-report-file-type'
            `).run(JSON.stringify({
                requiredTerms: [['性能测试报告', '测试报告']],
                forbiddenTerms: ['参考图纸'],
                requiredSourceTables: ['recipes'],
            }), now);
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET question = ?, config_json = ?, updated_at = ?
                WHERE case_key = 'complete-cable-semantics'
            `).run(
                '说明配方里的线材、长度、插头和规格费用如何共同组成成品电缆，是否应该拆成两个收费项目。',
                JSON.stringify({
                    requiredTerms: [
                        ['成品电缆'],
                        ['整体', '一体'],
                        ['不拆分', '不能拆分', '不得拆分', '不应拆分', '不应该拆分', '不拆成', '不能拆成', '不得拆成'],
                    ],
                    requiredTools: ['search_factory_knowledge'],
                    requiredSourceTables: ['business_rules'],
                }),
                now
            );
        },
    },
    {
        version: 14,
        name: 'strengthen_knowledge_regression_prompts',
        signature: 'require-exact-cable-rule-search-and-hide-template-field-names',
        up(db) {
            const now = new Date().toISOString();
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET question = ?, updated_at = ?
                WHERE case_key = 'test-report-ignore-template-points'
            `).run(
                '总结V1600-3”-12-180性能测试报告中的有效测试数据。只展示逐条测试点数据，不要提到被忽略的模板字段名称。',
                now
            );
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET question = ?, updated_at = ?
                WHERE case_key = 'complete-cable-semantics'
            `).run(
                '先使用 search_factory_knowledge 按“成品电缆”查询 business_rule，再说明线材、长度、插头和规格费用如何共同组成成品电缆，是否应该拆成两个收费项目。',
                now
            );
        },
    },
    {
        version: 15,
        name: 'accept_equivalent_cable_wording',
        signature: 'accept-not-should-split-into-wording',
        up(db) {
            const row = db.prepare(`
                SELECT config_json FROM ai_evaluation_cases
                WHERE case_key = 'complete-cable-semantics'
            `).get();
            if (!row) return;
            const config = JSON.parse(row.config_json || '{}');
            const groups = Array.isArray(config.requiredTerms) ? config.requiredTerms : [];
            if (Array.isArray(groups[2]) && !groups[2].includes('不应该拆成')) {
                groups[2].push('不应该拆成');
            }
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = 'complete-cable-semantics'
            `).run(JSON.stringify({ ...config, requiredTerms: groups }), new Date().toISOString());
        },
    },
    {
        version: 16,
        name: 'make_cable_evaluation_semantic',
        signature: 'separate-negative-conclusion-from-single-item-wording',
        up(db) {
            const row = db.prepare(`
                SELECT config_json FROM ai_evaluation_cases
                WHERE case_key = 'complete-cable-semantics'
            `).get();
            if (!row) return;
            const config = JSON.parse(row.config_json || '{}');
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = 'complete-cable-semantics'
            `).run(JSON.stringify({
                ...config,
                requiredTerms: [
                    ['成品电缆'],
                    ['整体', '一体'],
                    ['不应该', '不宜', '不能', '不得', '不应'],
                    ['一个业务项', '一个计费项目', '一项成品电缆', '一个收费项目'],
                ],
            }), new Date().toISOString());
        },
    },
    {
        version: 17,
        name: 'accept_cable_single_item_relationship',
        signature: 'match-single-item-relationship-with-intervening-subject',
        up(db) {
            const row = db.prepare(`
                SELECT config_json FROM ai_evaluation_cases
                WHERE case_key = 'complete-cable-semantics'
            `).get();
            if (!row) return;
            const config = JSON.parse(row.config_json || '{}');
            const groups = Array.isArray(config.requiredTerms) ? config.requiredTerms : [];
            groups[3] = ['共同组成一个', '同属一个', '属于一个', '作为一个', '一个计费项目', '一项成品电缆', '一个收费项目'];
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = 'complete-cable-semantics'
            `).run(JSON.stringify({ ...config, requiredTerms: groups }), new Date().toISOString());
        },
    },
    {
        version: 18,
        name: 'add_coil_inventory_ledger',
        signature: 'add-coil-stock-and-traceable-movements',
        up(db) {
            if (!columnNames(db, 'coils').has('stock')) {
                db.exec(`ALTER TABLE coils ADD COLUMN stock ${COIL_STOCK_COLUMN_DEFINITION}`);
            }
            db.exec(COIL_INVENTORY_SCHEMA_SQL);
        },
    },
    {
        version: 19,
        name: 'factory_rule_learning_evidence',
        signature: 'factory-rule-learning-evidence-v3',
        up(db) {
            const columns = columnNames(db, 'factory_rule_candidates');
            const additions = [
                ['support_count', 'INTEGER NOT NULL DEFAULT 0'],
                ['special_case_count', 'INTEGER NOT NULL DEFAULT 0'],
                ['ignored_count', 'INTEGER NOT NULL DEFAULT 0'],
                ['confidence_score', 'REAL NOT NULL DEFAULT 0'],
                ['learning_evidence_json', "TEXT DEFAULT '{}'"],
                ['learning_hash', "TEXT DEFAULT ''"],
                ['reviewed_learning_hash', "TEXT DEFAULT ''"],
                ['learning_updated_at', 'TEXT'],
            ];
            for (const [column, definition] of additions) {
                if (!columns.has(column)) {
                    db.exec(`ALTER TABLE factory_rule_candidates ADD COLUMN ${column} ${definition}`);
                }
            }
            db.exec(`
                UPDATE factory_rule_candidates
                SET support_count = evidence_count,
                    confidence_score = CASE WHEN evidence_count >= 2 THEN 1 ELSE 0 END
                WHERE support_count = 0 AND evidence_count > 0
            `);
        },
    },
    {
        version: 20,
        name: 'factory_rule_lifecycle_events',
        signature: 'factory-rule-lifecycle-events-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS factory_rule_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    candidate_id INTEGER NOT NULL,
                    rule_key TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    previous_status TEXT,
                    new_status TEXT,
                    actor TEXT NOT NULL DEFAULT 'system',
                    note TEXT DEFAULT '',
                    snapshot_json TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(candidate_id) REFERENCES factory_rule_candidates(id)
                );
                CREATE INDEX IF NOT EXISTS idx_factory_rule_events_candidate
                    ON factory_rule_events(candidate_id, created_at DESC, id DESC);
                CREATE INDEX IF NOT EXISTS idx_factory_rule_events_created
                    ON factory_rule_events(created_at DESC, id DESC);
                INSERT INTO factory_rule_events(
                    candidate_id, rule_key, event_type, previous_status,
                    new_status, actor, note, snapshot_json, created_at
                )
                SELECT candidate.id, candidate.rule_key, 'baseline', NULL,
                       candidate.status, 'system', '升级时记录当前规则状态', '{}',
                       COALESCE(candidate.updated_at, candidate.created_at, CURRENT_TIMESTAMP)
                FROM factory_rule_candidates candidate
                WHERE NOT EXISTS (
                    SELECT 1 FROM factory_rule_events event
                    WHERE event.candidate_id = candidate.id
                );
            `);
        },
    },
    {
        version: 21,
        name: 'knowledge_sync_run_history',
        signature: 'knowledge-sync-run-history-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS knowledge_sync_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    mode TEXT NOT NULL CHECK(mode IN ('automatic', 'flush', 'manual')),
                    status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
                    trigger_sources_json TEXT DEFAULT '[]',
                    source_count INTEGER NOT NULL DEFAULT 0 CHECK(source_count >= 0),
                    attempt INTEGER NOT NULL DEFAULT 1 CHECK(attempt >= 1),
                    total_count INTEGER NOT NULL DEFAULT 0 CHECK(total_count >= 0),
                    inserted_count INTEGER NOT NULL DEFAULT 0 CHECK(inserted_count >= 0),
                    updated_count INTEGER NOT NULL DEFAULT 0 CHECK(updated_count >= 0),
                    unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK(unchanged_count >= 0),
                    deleted_count INTEGER NOT NULL DEFAULT 0 CHECK(deleted_count >= 0),
                    fts_enabled INTEGER NOT NULL DEFAULT 0 CHECK(fts_enabled IN (0, 1)),
                    duration_ms INTEGER NOT NULL DEFAULT 0 CHECK(duration_ms >= 0),
                    error_text TEXT DEFAULT '',
                    started_at TEXT NOT NULL,
                    completed_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_sync_runs_created
                    ON knowledge_sync_runs(created_at DESC, id DESC);
                CREATE INDEX IF NOT EXISTS idx_knowledge_sync_runs_status
                    ON knowledge_sync_runs(status, created_at DESC, id DESC);
            `);
        },
    },
    {
        version: 22,
        name: 'knowledge_external_documents',
        signature: 'knowledge-external-documents-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS knowledge_documents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    document_type TEXT NOT NULL DEFAULT 'technical_note'
                        CHECK(document_type IN ('technical_note', 'pump_performance_test', 'drawing', 'spreadsheet', 'other')),
                    title TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    content_text TEXT DEFAULT '',
                    tags_json TEXT DEFAULT '[]',
                    original_name TEXT DEFAULT '',
                    mime_type TEXT DEFAULT 'application/octet-stream',
                    file_size INTEGER NOT NULL DEFAULT 0 CHECK(file_size >= 0),
                    file_sha256 TEXT DEFAULT '',
                    file_blob BLOB,
                    parser_status TEXT NOT NULL DEFAULT 'not_applicable'
                        CHECK(parser_status IN ('not_applicable', 'parsed', 'metadata_only')),
                    extracted_text TEXT DEFAULT '',
                    metadata_json TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_documents_type
                    ON knowledge_documents(document_type, deleted_at, updated_at DESC);
            `);
        },
    },
    {
        version: 23,
        name: 'knowledge_vector_storage',
        signature: 'knowledge-vector-storage-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS knowledge_embeddings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entry_id INTEGER NOT NULL,
                    model TEXT NOT NULL,
                    dimensions INTEGER NOT NULL CHECK(dimensions > 0),
                    content_hash TEXT NOT NULL,
                    embedding BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(entry_id, model),
                    FOREIGN KEY(entry_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_model
                    ON knowledge_embeddings(model, dimensions);
                CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_hash
                    ON knowledge_embeddings(model, content_hash);
            `);
        },
    },
    {
        version: 24,
        name: 'knowledge_vector_sync_history',
        signature: 'knowledge-vector-sync-history-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS knowledge_vector_sync_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
                    model TEXT NOT NULL,
                    dimensions INTEGER NOT NULL CHECK(dimensions > 0),
                    total_count INTEGER NOT NULL DEFAULT 0 CHECK(total_count >= 0),
                    inserted_count INTEGER NOT NULL DEFAULT 0 CHECK(inserted_count >= 0),
                    updated_count INTEGER NOT NULL DEFAULT 0 CHECK(updated_count >= 0),
                    unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK(unchanged_count >= 0),
                    deleted_count INTEGER NOT NULL DEFAULT 0 CHECK(deleted_count >= 0),
                    failed_count INTEGER NOT NULL DEFAULT 0 CHECK(failed_count >= 0),
                    pending_count INTEGER NOT NULL DEFAULT 0 CHECK(pending_count >= 0),
                    duration_ms INTEGER NOT NULL DEFAULT 0 CHECK(duration_ms >= 0),
                    error_text TEXT DEFAULT '',
                    started_at TEXT NOT NULL,
                    completed_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_vector_sync_runs_created
                    ON knowledge_vector_sync_runs(created_at DESC, id DESC);
                CREATE INDEX IF NOT EXISTS idx_knowledge_vector_sync_runs_status
                    ON knowledge_vector_sync_runs(status, created_at DESC, id DESC);
            `);
        },
    },
    {
        version: 25,
        name: 'cutting_shell_evidence_regression',
        signature: 'cutting-shell-purpose-must-use-explicit-evidence-v1',
        up(db) {
            const now = new Date().toISOString();
            db.prepare(`
                INSERT OR IGNORE INTO ai_evaluation_cases (
                    case_key, title, category, question, evaluator_type,
                    config_json, enabled, sort_order, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'rules', ?, 1, ?, ?, ?)
            `).run(
                'cutting-shell-purpose-evidence',
                '切割用途不得由语义候选推断',
                '知识检索',
                '切割杂草用的泵壳是哪一个？系统中有哪些明确标注的切割专用配件？',
                JSON.stringify({
                    requiredTerms: [
                        ['800平刀切割泵壳'],
                        ['系统未记录', '没有记录', '未明确标注', '无法确认'],
                    ],
                    forbiddenTerms: [
                        'SPA系列切割泵壳',
                        'SPA 2叶切割泵壳',
                        'SPA 3叶切割泵壳',
                        '专门为切割工况设计',
                    ],
                    requiredTools: ['search_factory_knowledge'],
                    requiredSourceTables: ['parts'],
                }),
                70,
                now,
                now
            );
        },
    },
    {
        version: 26,
        name: 'strengthen_cutting_shell_regression',
        signature: 'cutting-shell-rule-and-fastener-semantics-v1',
        up(db) {
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = 'cutting-shell-purpose-evidence'
            `).run(JSON.stringify({
                requiredTerms: [
                    ['800平刀切割泵壳'],
                    ['系统未记录', '没有记录', '未明确标注', '无法确认'],
                    ['切边6mm长螺丝'],
                    ['外六角', '外六角螺丝'],
                ],
                forbiddenTerms: [
                    'SPA系列切割泵壳',
                    'SPA 2叶切割泵壳',
                    'SPA 3叶切割泵壳',
                    '专门为切割工况设计',
                    '全套含刀',
                ],
                requiredTools: ['search_factory_knowledge'],
                requiredSourceTables: ['parts', 'business_rules'],
            }), new Date().toISOString());
        },
    },
    {
        version: 27,
        name: 'accept_equivalent_regression_phrasing',
        signature: 'knowledge-regression-equivalent-phrasing-v1',
        up(db) {
            const now = new Date().toISOString();
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = 'complete-cable-semantics'
            `).run(JSON.stringify({
                requiredTerms: [
                    ['成品电缆'],
                    ['整体', '一体'],
                    ['不应该', '不宜', '不能', '不得', '不应'],
                    [
                        '共同组成一个',
                        '共同构成',
                        '一个整体业务项',
                        '同属一个',
                        '属于一个',
                        '作为一个',
                        '一个计费项目',
                        '一项成品电缆',
                        '一个收费项目',
                    ],
                ],
                requiredTools: ['search_factory_knowledge'],
                requiredSourceTables: ['business_rules'],
            }), now);
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = 'cutting-shell-purpose-evidence'
            `).run(JSON.stringify({
                requiredTerms: [
                    ['800平刀切割泵壳'],
                    ['系统未记录', '系统未明确记录', '没有记录', '未明确标注', '无法确认'],
                    ['切边6mm长螺丝'],
                    ['外六角', '外六角螺丝'],
                ],
                forbiddenTerms: [
                    'SPA系列切割泵壳',
                    'SPA 2叶切割泵壳',
                    'SPA 3叶切割泵壳',
                    '专门为切割工况设计',
                    '全套含刀',
                ],
                requiredTools: ['search_factory_knowledge'],
                requiredSourceTables: ['parts', 'business_rules'],
            }), now);
        },
    },
    {
        version: 28,
        name: 'align_cutting_regression_with_rule_authority',
        signature: 'cutting-regression-business-rule-authority-v1',
        up(db) {
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = 'cutting-shell-purpose-evidence'
            `).run(JSON.stringify({
                requiredTerms: [
                    ['800平刀切割泵壳'],
                    ['系统未记录', '系统未明确记录', '没有记录', '没有明确记录', '未明确标注', '无法确认'],
                    ['切边6mm长螺丝'],
                    ['外六角', '外六角螺丝'],
                ],
                forbiddenTerms: [
                    'SPA系列切割泵壳',
                    'SPA 2叶切割泵壳',
                    'SPA 3叶切割泵壳',
                    '专门为切割工况设计',
                    '全套含刀',
                ],
                requiredTools: ['search_factory_knowledge'],
                requiredSourceTables: ['business_rules'],
            }), new Date().toISOString());
        },
    },
    {
        version: 29,
        name: 'management_action_lifecycle',
        signature: 'management-action-lifecycle-events-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS management_action_lifecycles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action_key TEXT NOT NULL UNIQUE,
                    status TEXT NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active', 'resolved')),
                    category TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    entity_type TEXT DEFAULT '',
                    entity_id TEXT DEFAULT '',
                    title TEXT NOT NULL,
                    priority TEXT NOT NULL
                        CHECK(priority IN ('critical', 'high', 'medium', 'low')),
                    occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK(occurrence_count >= 1),
                    first_seen_at TEXT NOT NULL,
                    active_since TEXT NOT NULL,
                    resolved_at TEXT,
                    last_reopened_at TEXT,
                    snapshot_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS management_action_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    lifecycle_id INTEGER NOT NULL,
                    event_type TEXT NOT NULL
                        CHECK(event_type IN ('appeared', 'resolved', 'reopened')),
                    occurred_at TEXT NOT NULL,
                    snapshot_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(lifecycle_id) REFERENCES management_action_lifecycles(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_management_action_lifecycles_status
                    ON management_action_lifecycles(status, updated_at DESC, id DESC);
                CREATE INDEX IF NOT EXISTS idx_management_action_lifecycles_category
                    ON management_action_lifecycles(category, status, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_management_action_events_lifecycle
                    ON management_action_events(lifecycle_id, occurred_at DESC, id DESC);
                CREATE INDEX IF NOT EXISTS idx_management_action_events_occurred
                    ON management_action_events(occurred_at DESC, id DESC);
            `);
        },
    },
    {
        version: 30,
        name: 'factory_workflow_execution_history',
        signature: 'factory-workflow-execution-history-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS factory_workflow_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workflow_type TEXT NOT NULL
                        CHECK(workflow_type IN ('order_readiness', 'quotation_to_order', 'management_action')),
                    subject_type TEXT NOT NULL,
                    subject_id TEXT NOT NULL,
                    action_id TEXT NOT NULL,
                    tool_name TEXT NOT NULL
                        CHECK(tool_name IN ('execute_order_readiness_action', 'execute_factory_workflow_step')),
                    status TEXT NOT NULL
                        CHECK(status IN ('completed', 'failed')),
                    attempt_number INTEGER NOT NULL DEFAULT 1 CHECK(attempt_number >= 1),
                    plan_fingerprint TEXT NOT NULL,
                    plan_json TEXT NOT NULL DEFAULT '{}',
                    result_json TEXT NOT NULL DEFAULT '{}',
                    recheck_json TEXT NOT NULL DEFAULT '{}',
                    outcome_summary TEXT DEFAULT '',
                    error_text TEXT DEFAULT '',
                    started_at TEXT NOT NULL,
                    completed_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_factory_workflow_runs_subject
                    ON factory_workflow_runs(workflow_type, subject_id, created_at DESC, id DESC);
                CREATE INDEX IF NOT EXISTS idx_factory_workflow_runs_action
                    ON factory_workflow_runs(workflow_type, subject_id, action_id, created_at DESC, id DESC);
                CREATE INDEX IF NOT EXISTS idx_factory_workflow_runs_status
                    ON factory_workflow_runs(status, created_at DESC, id DESC);
            `);
        },
    },
    {
        version: 31,
        name: 'unified_factory_file_objects',
        signature: 'unified-factory-file-objects-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS factory_files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    original_name TEXT NOT NULL,
                    extension TEXT NOT NULL,
                    detected_type TEXT NOT NULL
                        CHECK(detected_type IN ('pdf', 'spreadsheet', 'image', 'text')),
                    mime_type TEXT NOT NULL,
                    file_size INTEGER NOT NULL CHECK(file_size > 0),
                    file_sha256 TEXT NOT NULL UNIQUE,
                    file_blob BLOB NOT NULL,
                    parser_status TEXT NOT NULL DEFAULT 'pending'
                        CHECK(parser_status IN ('pending', 'processing', 'parsed', 'metadata_only', 'failed')),
                    source_type TEXT NOT NULL DEFAULT 'direct_upload'
                        CHECK(source_type IN ('direct_upload', 'knowledge_document', 'recipe_technical_file')),
                    duplicate_count INTEGER NOT NULL DEFAULT 1 CHECK(duplicate_count >= 1),
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
            `);

            if (!columnNames(db, 'knowledge_documents').has('file_id')) {
                db.exec('ALTER TABLE knowledge_documents ADD COLUMN file_id INTEGER REFERENCES factory_files(id)');
            }
            if (!columnNames(db, 'recipe_technical_files').has('file_id')) {
                db.exec('ALTER TABLE recipe_technical_files ADD COLUMN file_id INTEGER REFERENCES factory_files(id)');
            }

            const insertFile = db.prepare(`
                INSERT OR IGNORE INTO factory_files (
                    original_name, extension, detected_type, mime_type,
                    file_size, file_sha256, file_blob, parser_status,
                    source_type, duplicate_count, metadata_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
            `);
            const findFile = db.prepare('SELECT id FROM factory_files WHERE file_sha256 = ?');
            const updateKnowledgeDocument = db.prepare(
                'UPDATE knowledge_documents SET file_id = ? WHERE id = ?'
            );
            const updateRecipeFile = db.prepare(
                'UPDATE recipe_technical_files SET file_id = ? WHERE id = ?'
            );
            const fileShape = (originalName, mimeType) => {
                const match = String(originalName || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
                const extension = match?.[1] || '';
                if (extension === '.pdf') return { extension, detectedType: 'pdf', mimeType: 'application/pdf' };
                if (['.xls', '.xlsx', '.csv'].includes(extension)) {
                    return {
                        extension,
                        detectedType: 'spreadsheet',
                        mimeType: mimeType || (extension === '.csv'
                            ? 'text/csv'
                            : extension === '.xls'
                                ? 'application/vnd.ms-excel'
                                : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
                    };
                }
                if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
                    return { extension, detectedType: 'image', mimeType: mimeType || 'application/octet-stream' };
                }
                return { extension: extension || '.txt', detectedType: 'text', mimeType: mimeType || 'text/plain' };
            };
            const migrateRows = ({
                rows,
                sourceType,
                update,
                parserStatus,
            }) => {
                for (const row of rows) {
                    if (!Buffer.isBuffer(row.file_blob) || row.file_blob.length === 0) continue;
                    const sha256 = crypto.createHash('sha256').update(row.file_blob).digest('hex');
                    const shape = fileShape(row.original_name, row.mime_type);
                    const createdAt = row.created_at || new Date().toISOString();
                    const updatedAt = row.updated_at || createdAt;
                    insertFile.run(
                        row.original_name || `历史文件-${row.id}${shape.extension}`,
                        shape.extension,
                        shape.detectedType,
                        shape.mimeType,
                        row.file_blob.length,
                        sha256,
                        row.file_blob,
                        parserStatus(row),
                        sourceType,
                        JSON.stringify({ migratedFrom: sourceType, legacyId: row.id }),
                        createdAt,
                        updatedAt
                    );
                    const file = findFile.get(sha256);
                    if (file) update.run(file.id, row.id);
                }
            };

            migrateRows({
                rows: db.prepare(`
                    SELECT id, original_name, mime_type, file_blob, parser_status, created_at, updated_at
                    FROM knowledge_documents
                    WHERE file_blob IS NOT NULL AND length(file_blob) > 0
                `).all(),
                sourceType: 'knowledge_document',
                update: updateKnowledgeDocument,
                parserStatus: row => ['parsed', 'metadata_only'].includes(row.parser_status)
                    ? row.parser_status
                    : 'pending',
            });
            migrateRows({
                rows: db.prepare(`
                    SELECT id, original_name, mime_type, file_blob, created_at, updated_at
                    FROM recipe_technical_files
                    WHERE file_blob IS NOT NULL AND length(file_blob) > 0
                `).all(),
                sourceType: 'recipe_technical_file',
                update: updateRecipeFile,
                parserStatus: () => 'parsed',
            });

            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_factory_files_type
                    ON factory_files(detected_type, deleted_at, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_factory_files_hash
                    ON factory_files(file_sha256);
                CREATE INDEX IF NOT EXISTS idx_knowledge_documents_file
                    ON knowledge_documents(file_id);
                CREATE INDEX IF NOT EXISTS idx_recipe_technical_files_file
                    ON recipe_technical_files(file_id);
            `);
        },
    },
    {
        version: 32,
        name: 'runtime_system_settings',
        signature: 'runtime-system-settings-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS runtime_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    setting_key TEXT NOT NULL UNIQUE,
                    setting_value TEXT NOT NULL,
                    is_secret INTEGER NOT NULL DEFAULT 0 CHECK(is_secret IN (0, 1)),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_settings_updated
                    ON runtime_settings(updated_at DESC, id DESC);
            `);
        },
    },
    {
        version: 33,
        name: 'factory_file_parsed_content',
        signature: 'factory-file-parsed-content-v1',
        up(db) {
            const columns = columnNames(db, 'factory_files');
            if (!columns.has('parsed_text')) {
                db.exec(`ALTER TABLE factory_files ADD COLUMN parsed_text TEXT NOT NULL DEFAULT ''`);
            }
            if (!columns.has('parsed_json')) {
                db.exec(`ALTER TABLE factory_files ADD COLUMN parsed_json TEXT NOT NULL DEFAULT '{}'`);
            }
            if (!columns.has('parser_error')) {
                db.exec(`ALTER TABLE factory_files ADD COLUMN parser_error TEXT NOT NULL DEFAULT ''`);
            }
            if (!columns.has('parsed_at')) {
                db.exec('ALTER TABLE factory_files ADD COLUMN parsed_at TEXT');
            }
        },
    },
    {
        version: 34,
        name: 'factory_file_business_links',
        signature: 'factory-file-business-links-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS factory_file_links (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_id INTEGER NOT NULL,
                    target_type TEXT NOT NULL
                        CHECK(target_type IN (
                            'customer',
                            'quotation',
                            'recipe',
                            'recipe_analysis_feedback',
                            'ai_answer_feedback',
                            'knowledge_document'
                        )),
                    target_id INTEGER NOT NULL,
                    relation_role TEXT NOT NULL DEFAULT 'attachment'
                        CHECK(relation_role IN (
                            'attachment',
                            'technical_reference',
                            'quotation_source',
                            'quality_evidence',
                            'knowledge_source'
                        )),
                    title TEXT NOT NULL DEFAULT '',
                    note TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL DEFAULT 'manual'
                        CHECK(source IN ('manual', 'ai_chat', 'business_page')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT,
                    FOREIGN KEY(file_id) REFERENCES factory_files(id)
                );
                CREATE INDEX IF NOT EXISTS idx_factory_file_links_file
                    ON factory_file_links(file_id, deleted_at, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_factory_file_links_target
                    ON factory_file_links(target_type, target_id, deleted_at, updated_at DESC);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_factory_file_links_active_unique
                    ON factory_file_links(file_id, target_type, target_id, relation_role)
                    WHERE deleted_at IS NULL;
            `);
        },
    },
    {
        version: 35,
        name: 'resolve_active_order_packaging_estimates',
        signature: 'resolve-active-order-packaging-estimates-from-unique-recipe-container-v1',
        up(db) {
            repairOrderPackagingEstimates(db);
        },
    },
    {
        version: 36,
        name: 'order_factory_file_links',
        signature: 'order-factory-file-links-and-customer-requirement-role-v1',
        foreignKeysOff: true,
        up(db) {
            addOrderFactoryFileLinks(db);
        },
    },
    {
        version: 37,
        name: 'order_requirement_summaries',
        signature: 'order-requirement-draft-confirmed-knowledge-boundary-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS order_requirement_summaries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER NOT NULL UNIQUE,
                    draft_text TEXT NOT NULL DEFAULT '',
                    confirmed_text TEXT NOT NULL DEFAULT '',
                    source_file_ids_json TEXT NOT NULL DEFAULT '[]',
                    confirmed_source_file_ids_json TEXT NOT NULL DEFAULT '[]',
                    status TEXT NOT NULL DEFAULT 'draft'
                        CHECK(status IN ('draft', 'confirmed')),
                    confirmed_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(order_id) REFERENCES orders(id)
                );
            `);
        },
    },
    {
        version: 38,
        name: 'repair_order_requirement_summary_order_fk',
        signature: 'repair-order-requirement-summary-order-foreign-key-v1',
        foreignKeysOff: true,
        up(db) {
            repairOrderRequirementSummariesForeignKey(db);
        },
    },
    {
        version: 39,
        name: 'order_execution_records',
        signature: 'order-execution-fact-timeline-confirmed-knowledge-boundary-and-fk-repair-v1',
        foreignKeysOff: true,
        up(db) {
            createOrderExecutionRecordsTable(db);
            repairOrderExecutionRecordsForeignKey(db);
        },
    },
    {
        version: 40,
        name: 'order_execution_evidence_file_role',
        signature: 'order-execution-evidence-file-relation-role-v1',
        foreignKeysOff: true,
        up(db) {
            addOrderExecutionEvidenceFileRole(db);
        },
    },
    {
        version: 41,
        name: 'factory_ai_correction_rules',
        signature: 'general-ai-correction-rules-from-user-feedback-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS factory_ai_rules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_feedback_id INTEGER UNIQUE,
                    title TEXT NOT NULL,
                    trigger_text TEXT NOT NULL DEFAULT '',
                    instruction TEXT NOT NULL,
                    scope_type TEXT NOT NULL DEFAULT 'global'
                        CHECK(scope_type IN ('global')),
                    priority INTEGER NOT NULL DEFAULT 100,
                    status TEXT NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active', 'disabled')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(source_feedback_id) REFERENCES ai_answer_feedback(id)
                );
                CREATE INDEX IF NOT EXISTS idx_factory_ai_rules_status_priority
                    ON factory_ai_rules(status, priority DESC, updated_at DESC);
            `);
        },
    },
    {
        version: 42,
        name: 'ai_feedback_regression_cases',
        signature: 'feedback-correction-to-reviewed-regression-case-v1',
        up(db) {
            const columns = new Set(db.pragma('table_info(ai_evaluation_cases)').map(column => column.name));
            const additions = {
                source_type: "TEXT NOT NULL DEFAULT 'system' CHECK(source_type IN ('system', 'feedback'))",
                source_feedback_id: 'INTEGER',
                review_status: "TEXT NOT NULL DEFAULT 'approved' CHECK(review_status IN ('pending', 'approved', 'rejected'))",
                confidence_score: 'INTEGER NOT NULL DEFAULT 100',
                generation_note: "TEXT DEFAULT ''",
                proposal_hash: "TEXT DEFAULT ''",
                review_note: "TEXT DEFAULT ''",
                reviewed_at: 'TEXT',
            };
            for (const [column, definition] of Object.entries(additions)) {
                if (!columns.has(column)) {
                    db.exec(`ALTER TABLE ai_evaluation_cases ADD COLUMN ${column} ${definition}`);
                }
            }
            db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_evaluation_cases_feedback
                    ON ai_evaluation_cases(source_feedback_id)
                    WHERE source_feedback_id IS NOT NULL;
            `);
            const now = new Date().toISOString();
            const insert = db.prepare(`
                INSERT INTO ai_evaluation_cases (
                    case_key, title, category, question, evaluator_type, config_json,
                    enabled, sort_order, source_type, source_feedback_id, review_status,
                    confidence_score, generation_note, proposal_hash, review_note,
                    reviewed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'rules', ?, ?, ?, 'feedback', ?, ?, ?, ?, ?, '', ?, ?, ?)
            `);
            const feedbackRows = db.prepare(`
                SELECT feedback.*, learning_rule.status AS learning_rule_status
                FROM ai_answer_feedback AS feedback
                JOIN factory_ai_rules AS learning_rule
                  ON learning_rule.source_feedback_id = feedback.id
                WHERE feedback.rating = 'incorrect'
            `).all();
            for (const feedback of feedbackRows) {
                if (db.prepare(
                    'SELECT 1 FROM ai_evaluation_cases WHERE source_feedback_id = ?'
                ).get(feedback.id)) continue;
                const proposal = buildFeedbackEvaluationProposal(feedback);
                insert.run(
                    proposal.caseKey,
                    proposal.title,
                    proposal.category,
                    proposal.question,
                    JSON.stringify(proposal.config),
                    proposal.enabled && feedback.learning_rule_status === 'active' ? 1 : 0,
                    1000 + feedback.id,
                    feedback.id,
                    proposal.reviewStatus,
                    proposal.confidenceScore,
                    proposal.generationNote,
                    proposal.proposalHash,
                    proposal.reviewStatus === 'approved' ? now : null,
                    now,
                    now
                );
            }
        },
    },
    {
        version: 43,
        name: 'api_command_operations',
        signature: 'persistent-idempotency-resource-version-and-strong-audit-linkage-v1',
        up(db) {
            const auditColumns = columnNames(db, 'audit_log');
            const auditAdditions = {
                request_id: 'TEXT',
                operation_id: 'TEXT',
                capability_id: 'TEXT',
            };
            for (const [column, definition] of Object.entries(auditAdditions)) {
                if (!auditColumns.has(column)) {
                    db.exec(`ALTER TABLE audit_log ADD COLUMN ${quoteIdentifier(column)} ${definition}`);
                }
            }
            db.exec(`
                CREATE TABLE IF NOT EXISTS api_operations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    operation_id TEXT NOT NULL,
                    capability_id TEXT NOT NULL,
                    actor_key TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    request_hash TEXT NOT NULL,
                    request_id TEXT,
                    status TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending', 'completed')),
                    response_json TEXT,
                    created_at TEXT NOT NULL,
                    completed_at TEXT,
                    expires_at TEXT NOT NULL,
                    UNIQUE(actor_key, capability_id, idempotency_key)
                );
                CREATE INDEX IF NOT EXISTS idx_audit_log_operation
                    ON audit_log(operation_id, id);
                CREATE INDEX IF NOT EXISTS idx_api_operations_expiry
                    ON api_operations(expires_at);
                CREATE INDEX IF NOT EXISTS idx_api_operations_operation
                    ON api_operations(operation_id, capability_id);
            `);
        },
    },
    {
        version: 44,
        name: 'allow_disabled_coil_scheme_status',
        signature: 'coil-scheme-status-official-testing-disabled-v1',
        foreignKeysOff: true,
        up(db) {
            const sql = String(db.prepare(`
                SELECT sql FROM sqlite_schema
                WHERE type = 'table' AND name = 'coils'
            `).get()?.sql || '');
            if (/scheme_status IN \('official', 'testing', 'disabled'\)/.test(sql)) {
                return;
            }
            db.exec(`
                DROP INDEX IF EXISTS idx_coils_variant_sheets;
                DROP INDEX IF EXISTS idx_coils_one_official_scheme;
                DROP TABLE IF EXISTS coils_scheme_status_v44;
                CREATE TABLE coils_scheme_status_v44 (
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
                    stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
                    FOREIGN KEY(stator_variant_id) REFERENCES stator_variants(id),
                    CHECK(material IN ('钢带', '冷轧')),
                    CHECK(slot_type IN ('小眼', '国标眼')),
                    CHECK(sheets > 0),
                    CHECK(scheme_status IN ('official', 'testing', 'disabled')),
                    CHECK(unit_price IS NULL OR unit_price >= 0),
                    CHECK(wire_weight IS NULL OR wire_weight >= 0),
                    CHECK(copper_base IS NULL OR copper_base >= 0),
                    CHECK(coil_fee IS NULL OR coil_fee >= 0),
                    CHECK(rotor_fee IS NULL OR rotor_fee >= 0),
                    CHECK(cost IS NULL OR cost >= 0)
                );
                INSERT INTO coils_scheme_status_v44 (
                    id, stator_variant_id, spec, material, slot_type, sheets,
                    scheme_name, scheme_status, unit_price, wire_weight,
                    copper_base, coil_fee, rotor_fee, cost,
                    default_wire_gauge, default_capacitor,
                    main_wire_gauge, main_wire_data,
                    aux_wire_gauge, aux_wire_data,
                    created_at, updated_at, stock
                )
                SELECT
                    id, stator_variant_id, spec, material, slot_type, sheets,
                    scheme_name, scheme_status, unit_price, wire_weight,
                    copper_base, coil_fee, rotor_fee, cost,
                    default_wire_gauge, default_capacitor,
                    main_wire_gauge, main_wire_data,
                    aux_wire_gauge, aux_wire_data,
                    created_at, updated_at, stock
                FROM coils;
                DROP TABLE coils;
                ALTER TABLE coils_scheme_status_v44 RENAME TO coils;
                CREATE INDEX idx_coils_variant_sheets
                    ON coils(stator_variant_id, sheets);
                CREATE UNIQUE INDEX idx_coils_one_official_scheme
                    ON coils(stator_variant_id, sheets)
                    WHERE scheme_status = 'official';
            `);
            const foreignKeyErrors = db.pragma('foreign_key_check');
            if (foreignKeyErrors.length > 0) {
                throw new Error(
                    `线圈状态约束迁移后存在 ${foreignKeyErrors.length} 条外键错误`
                );
            }
        },
    },
    {
        version: 45,
        name: 'accept_equivalent_cutting_evidence_wording',
        signature: 'cutting-regression-accept-unqualified-not-explicitly-recorded-v1',
        up(db) {
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = 'cutting-shell-purpose-evidence'
            `).run(JSON.stringify({
                requiredTerms: [
                    ['800平刀切割泵壳'],
                    [
                        '系统未记录',
                        '系统未明确记录',
                        '没有记录',
                        '没有明确记录',
                        '未明确记录',
                        '未明确标注',
                        '无法确认',
                    ],
                    ['切边6mm长螺丝'],
                    ['外六角', '外六角螺丝'],
                ],
                forbiddenTerms: [
                    'SPA系列切割泵壳',
                    'SPA 2叶切割泵壳',
                    'SPA 3叶切割泵壳',
                    '专门为切割工况设计',
                    '全套含刀',
                ],
                requiredTools: ['search_factory_knowledge'],
                requiredSourceTables: ['business_rules'],
            }), new Date().toISOString());
        },
    },
    {
        version: 46,
        name: 'accept_clear_cutting_evidence_uncertainty',
        signature: 'cutting-regression-accept-clear-uncertainty-phrases-v1',
        up(db) {
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = 'cutting-shell-purpose-evidence'
            `).run(JSON.stringify({
                requiredTerms: [
                    ['800平刀切割泵壳'],
                    [
                        '系统未记录',
                        '系统未明确记录',
                        '没有记录',
                        '没有明确记录',
                        '没有其他明确标注',
                        '未记录',
                        '未明确记录',
                        '未明确标注',
                        '无明确记录',
                        '当前无明确',
                        '不能确认',
                        '无法确认',
                    ],
                    ['切边6mm长螺丝'],
                    ['外六角', '外六角螺丝'],
                ],
                forbiddenTerms: [
                    'SPA系列切割泵壳',
                    'SPA 2叶切割泵壳',
                    'SPA 3叶切割泵壳',
                    '专门为切割工况设计',
                    '全套含刀',
                ],
                requiredTools: ['search_factory_knowledge'],
                requiredSourceTables: ['business_rules'],
            }), new Date().toISOString());
        },
    },
    {
        version: 47,
        name: 'restore_system_ai_evaluation_cases',
        signature: 'restore-canonical-system-ai-release-gate-cases-v1',
        up(db) {
            const now = new Date().toISOString();
            const upsert = db.prepare(`
                INSERT INTO ai_evaluation_cases (
                    case_key, title, category, question, evaluator_type, config_json,
                    enabled, sort_order, source_type, review_status, confidence_score,
                    reviewed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'rules', ?, 1, ?, 'system', 'approved', 100, ?, ?, ?)
                ON CONFLICT(case_key) DO UPDATE SET
                    title = excluded.title,
                    category = excluded.category,
                    question = excluded.question,
                    evaluator_type = excluded.evaluator_type,
                    config_json = excluded.config_json,
                    enabled = excluded.enabled,
                    sort_order = excluded.sort_order,
                    review_status = excluded.review_status,
                    confidence_score = excluded.confidence_score,
                    reviewed_at = excluded.reviewed_at,
                    updated_at = excluded.updated_at
                WHERE ai_evaluation_cases.source_type = 'system'
            `);
            const cases = [
                ['part-current-price', '零件价格使用当前值', '价格',
                    '查询800平刀切割泵壳目前的单价，并说明数据来源。', {
                        expectedMode: 'live_business',
                        requiredTools: ['search_parts'],
                        fact: { type: 'part_price', model: '800平刀切割泵壳' },
                    }],
                ['coil-all-official-variants', '线圈规格返回全部正式方案', '线圈',
                    '查询12-220线圈的全部正式方案，列出材质、槽眼和成本。', {
                        requiredTerms: [['钢带'], ['小眼'], ['冷轧'], ['国标眼']],
                        requiredTools: ['search_factory_knowledge'],
                        requiredSourceTables: ['coils'],
                    }],
                ['test-report-file-type', '测试报告不能标成图纸', '技术档案',
                    'V1600-3”-12-180配方技术档案中的Excel附件是什么资料？', {
                        requiredTerms: [['性能测试报告', '测试报告']],
                        forbiddenTerms: ['参考图纸'],
                        requiredSourceTables: ['recipes'],
                    }],
                ['test-report-ignore-template-points', '测试模板规定点不作为结论', '技术档案',
                    '总结V1600-3”-12-180性能测试报告中的有效测试数据。只展示逐条测试点数据，不要提到被忽略的模板字段名称。', {
                        forbiddenTerms: ['规定点', '实测点', '偏差'],
                        requiredTerms: [['测试点'], ['流量'], ['扬程']],
                        requiredSourceTables: ['recipes'],
                    }],
                ['customer-quotation-display-order', '客户报价不暴露内部序号', '报价',
                    '查询客户邱焕现有的全部报价，按第1份、第2份这样的展示顺序列出。', {
                        requiredTools: ['search_customer_history'],
                        fact: {
                            type: 'customer_quotation_count',
                            customerName: '邱焕',
                            forbidInternalIds: true,
                        },
                    }],
                ['complete-cable-semantics', '电缆按成品整体解释', '配方',
                    '先使用 search_factory_knowledge 按“成品电缆”查询 business_rule，再说明线材、长度、插头和规格费用如何共同组成成品电缆，是否应该拆成两个收费项目。', {
                        requiredTerms: [
                            ['成品电缆'],
                            ['整体', '一体'],
                            ['不应该', '不宜', '不能', '不得', '不应'],
                            [
                                '共同组成一个',
                                '共同构成',
                                '一个整体业务项',
                                '同属一个',
                                '属于一个',
                                '作为一个',
                                '一个计费项目',
                                '一项成品电缆',
                                '一个收费项目',
                            ],
                        ],
                        requiredTools: ['search_factory_knowledge'],
                        requiredSourceTables: ['business_rules'],
                    }],
                ['cutting-shell-purpose-evidence', '切割用途不得由语义候选推断', '知识检索',
                    '切割杂草用的泵壳是哪一个？系统中有哪些明确标注的切割专用配件？', {
                        requiredTerms: [
                            ['800平刀切割泵壳'],
                            [
                                '系统未记录',
                                '系统未明确记录',
                                '没有记录',
                                '没有明确记录',
                                '没有其他明确标注',
                                '未记录',
                                '未明确记录',
                                '未明确标注',
                                '无明确记录',
                                '当前无明确',
                                '不能确认',
                                '无法确认',
                            ],
                            ['切边6mm长螺丝'],
                            ['外六角', '外六角螺丝'],
                        ],
                        forbiddenTerms: [
                            'SPA系列切割泵壳',
                            'SPA 2叶切割泵壳',
                            'SPA 3叶切割泵壳',
                            '专门为切割工况设计',
                            '全套含刀',
                        ],
                        requiredTools: ['search_factory_knowledge'],
                        requiredSourceTables: ['business_rules'],
                    }],
            ];
            cases.forEach((item, index) => upsert.run(
                item[0],
                item[1],
                item[2],
                item[3],
                JSON.stringify(item[4]),
                (index + 1) * 10,
                now,
                now,
                now
            ));
        },
    },
    {
        version: 48,
        name: 'data_aware_system_ai_evaluation_cases',
        signature: 'system-ai-release-gate-validates-unavailable-production-fixtures-v1',
        up(db) {
            const now = new Date().toISOString();
            const update = db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = ? AND source_type = 'system'
            `);
            update.run(JSON.stringify({
                prerequisite: {
                    type: 'recipe_test_report',
                    recipeName: 'V1600-3”-12-180',
                },
                unavailableTerms: [
                    '未找到',
                    '没有找到',
                    '未记录',
                    '没有记录',
                    '无法确认',
                    '尚未归档',
                ],
                requiredTerms: [['性能测试报告', '测试报告']],
                forbiddenTerms: ['参考图纸'],
                requiredTools: ['search_factory_knowledge'],
                requiredSourceTables: ['recipes'],
            }), now, 'test-report-file-type');
            update.run(JSON.stringify({
                prerequisite: {
                    type: 'recipe_test_report',
                    recipeName: 'V1600-3”-12-180',
                },
                unavailableTerms: [
                    '未找到',
                    '没有找到',
                    '未记录',
                    '没有记录',
                    '无法提供',
                    '尚未归档',
                ],
                forbiddenTerms: ['规定点', '实测点', '偏差'],
                requiredTerms: [['测试点'], ['流量'], ['扬程']],
                requiredTools: ['search_factory_knowledge'],
                requiredSourceTables: ['recipes'],
            }), now, 'test-report-ignore-template-points');
        },
    },
    {
        version: 49,
        name: 'formal_recipe_technical_file_ai_evaluation',
        signature: 'system-ai-release-gate-uses-formal-recipe-technical-files-api-v1',
        up(db) {
            const now = new Date().toISOString();
            const update = db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = ? AND source_type = 'system'
            `);
            update.run(JSON.stringify({
                prerequisite: {
                    type: 'recipe_test_report',
                    recipeName: 'V1600-3”-12-180',
                },
                unavailableTerms: [
                    '未找到',
                    '没有找到',
                    '未记录',
                    '没有记录',
                    '无法确认',
                    '尚未归档',
                ],
                requiredTerms: [['性能测试报告', '测试报告']],
                forbiddenTerms: ['参考图纸'],
                requiredTools: ['get_recipe_technical_files'],
                requiredSourceTables: ['recipes'],
            }), now, 'test-report-file-type');
            update.run(JSON.stringify({
                prerequisite: {
                    type: 'recipe_test_report',
                    recipeName: 'V1600-3”-12-180',
                },
                unavailableTerms: [
                    '未找到',
                    '没有找到',
                    '未记录',
                    '没有记录',
                    '无法提供',
                    '尚未归档',
                ],
                forbiddenTerms: ['规定点', '实测点', '偏差'],
                requiredTerms: [['测试点'], ['流量'], ['扬程']],
                requiredTools: ['get_recipe_technical_files'],
                requiredSourceTables: ['recipes'],
            }), now, 'test-report-ignore-template-points');
        },
    },
    {
        version: 50,
        name: 'formal_coil_query_ai_evaluation',
        signature: 'system-ai-release-gate-uses-formal-live-coil-query-v1',
        up(db) {
            const now = new Date().toISOString();
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = ? AND source_type = 'system'
            `).run(JSON.stringify({
                expectedMode: 'live_business',
                requiredTerms: [['钢带'], ['小眼'], ['冷轧'], ['国标眼']],
                requiredTools: ['search_coils'],
                requiredSourceTables: ['coils'],
            }), now, 'coil-all-official-variants');
        },
    },
    {
        version: 51,
        name: 'data_aware_formal_coil_ai_evaluation',
        signature: 'system-ai-release-gate-validates-unavailable-formal-coil-fixture-v1',
        up(db) {
            const now = new Date().toISOString();
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = ? AND source_type = 'system'
            `).run(JSON.stringify({
                prerequisite: {
                    type: 'coil_variants',
                    spec: '12',
                    sheets: 220,
                },
                unavailableTerms: [
                    '未找到',
                    '没有找到',
                    '未查到',
                    '暂无',
                    '没有可列出',
                ],
                expectedMode: 'live_business',
                requiredTerms: [['钢带'], ['小眼'], ['冷轧'], ['国标眼']],
                requiredTools: ['search_coils'],
                requiredSourceTables: ['coils'],
            }), now, 'coil-all-official-variants');
        },
    },
    {
        version: 52,
        name: 'accept_equivalent_complete_cable_phrasing',
        signature: 'system-ai-release-gate-accepts-equivalent-complete-cable-wording-v1',
        up(db) {
            const now = new Date().toISOString();
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = ? AND source_type = 'system'
            `).run(JSON.stringify({
                requiredTerms: [
                    ['成品电缆'],
                    ['整体', '一体'],
                    ['不应该', '不宜', '不能', '不得', '不应'],
                    [
                        '共同组成一个',
                        '共同组成一条',
                        '共同构成',
                        '一个整体业务项',
                        '单一整体业务项',
                        '单一业务项',
                        '同属一个',
                        '属于一个',
                        '作为一个',
                        '作为一条成品电缆',
                        '一个计费项目',
                        '一项成品电缆',
                        '一个收费项目',
                    ],
                ],
                requiredTools: ['search_factory_knowledge'],
                requiredSourceTables: ['business_rules'],
            }), now, 'complete-cable-semantics');
        },
    },
    {
        version: 53,
        name: 'accept_explicit_unconfirmed_cutting_evidence_phrasing',
        signature: 'system-ai-cutting-evidence-accepts-system-unconfirmed-v1',
        up(db) {
            const row = db.prepare(`
                SELECT config_json
                FROM ai_evaluation_cases
                WHERE case_key = ? AND source_type = 'system'
            `).get('cutting-shell-purpose-evidence');
            if (!row) return;

            const config = JSON.parse(row.config_json || '{}');
            const uncertaintyTerms = Array.isArray(config.requiredTerms)
                ? config.requiredTerms.find(group => (
                    Array.isArray(group)
                    && (group.includes('不能确认') || group.includes('无法确认'))
                ))
                : null;
            if (!uncertaintyTerms || uncertaintyTerms.includes('系统未确认')) return;

            uncertaintyTerms.push('系统未确认');
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = ? AND source_type = 'system'
            `).run(
                JSON.stringify(config),
                new Date().toISOString(),
                'cutting-shell-purpose-evidence'
            );
        },
    },
    {
        version: 54,
        name: 'disable_polluted_customer_count_feedback_regression',
        signature: 'disable-feedback-regression-derived-from-polluted-customer-count-v1',
        up(db) {
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET enabled = 0,
                    review_status = 'rejected',
                    updated_at = ?
                WHERE source_type = 'feedback'
                  AND enabled = 1
                  AND (
                      source_feedback_id = 6
                      OR title = '纠错回归：确定有18个客户？'
                  )
                  AND config_json LIKE '%18个%'
            `).run(new Date().toISOString());
        },
    },
    {
        version: 55,
        name: 'accept_no_explicit_cutting_accessory_marking',
        signature: 'system-ai-cutting-evidence-accepts-no-explicit-marking-v1',
        up(db) {
            const row = db.prepare(`
                SELECT config_json
                FROM ai_evaluation_cases
                WHERE case_key = ? AND source_type = 'system'
            `).get('cutting-shell-purpose-evidence');
            if (!row) return;

            const config = JSON.parse(row.config_json || '{}');
            const uncertaintyTerms = Array.isArray(config.requiredTerms)
                ? config.requiredTerms.find(group => (
                    Array.isArray(group)
                    && (group.includes('系统未明确记录') || group.includes('没有明确记录'))
                ))
                : null;
            if (!uncertaintyTerms || uncertaintyTerms.includes('无明确标注')) return;

            uncertaintyTerms.push('无明确标注');
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = ? AND source_type = 'system'
            `).run(
                JSON.stringify(config),
                new Date().toISOString(),
                'cutting-shell-purpose-evidence'
            );
        },
    },
    {
        version: 56,
        name: 'disable_non_core_system_ai_release_cases',
        signature: 'disable-non-core-system-ai-release-cases-after-data-cleanup-v1',
        up(db) {
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET enabled = 0,
                    review_status = 'rejected',
                    updated_at = ?
                WHERE source_type = 'system'
                  AND case_key IN (
                      'customer-quotation-display-order',
                      'cutting-shell-purpose-evidence'
                  )
            `).run(new Date().toISOString());
        },
    },
    {
        version: 57,
        name: 'disable_system_ai_release_cases',
        signature: 'disable-all-system-ai-release-cases-after-production-data-cleanup-v1',
        up(db) {
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET enabled = 0,
                    review_status = 'rejected',
                    updated_at = ?
                WHERE source_type = 'system'
            `).run(new Date().toISOString());
        },
    },
    {
        version: 58,
        name: 'quotation_attachment_summary_drafts',
        signature: 'quotation-attachment-summary-drafts-v1',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS quotation_attachment_summaries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    quotation_id INTEGER NOT NULL UNIQUE,
                    draft_text TEXT NOT NULL DEFAULT '',
                    source_file_ids_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(quotation_id) REFERENCES quotations(id)
                );
            `);
        },
    },
    {
        version: 59,
        name: 'separate_manual_ai_checks_from_release_gate',
        signature: 'manual-system-ai-checks-enabled-release-gate-opt-in-v1',
        up(db) {
            const columns = new Set(
                db.pragma('table_info(ai_evaluation_cases)').map(column => column.name)
            );
            if (!columns.has('release_gate_enabled')) {
                db.exec(`
                    ALTER TABLE ai_evaluation_cases
                    ADD COLUMN release_gate_enabled INTEGER NOT NULL DEFAULT 1
                        CHECK(release_gate_enabled IN (0, 1));
                `);
            }
            db.prepare(`
                UPDATE ai_evaluation_cases
                SET enabled = 1,
                    release_gate_enabled = 0,
                    review_status = 'approved',
                    updated_at = ?
                WHERE source_type = 'system'
            `).run(new Date().toISOString());
        },
    },
    {
        version: 60,
        name: 'calibrate_ai_governance_cutting_accessory_check',
        signature: 'cutting-check-accepts-explicit-no-dedicated-accessory-v1',
        up(db) {
            const row = db.prepare(`
                SELECT config_json
                FROM ai_evaluation_cases
                WHERE case_key = ? AND source_type = 'system'
            `).get('cutting-shell-purpose-evidence');
            if (!row) return;

            const config = JSON.parse(row.config_json || '{}');
            const requiredTerms = Array.isArray(config.requiredTerms) ? config.requiredTerms : [];
            const calibratedTerms = requiredTerms.filter(group => {
                const terms = Array.isArray(group) ? group : [group];
                return !terms.includes('切边6mm长螺丝')
                    && !terms.includes('外六角')
                    && !terms.includes('外六角螺丝');
            });
            if (calibratedTerms.length === requiredTerms.length) return;
            config.requiredTerms = calibratedTerms;

            db.prepare(`
                UPDATE ai_evaluation_cases
                SET config_json = ?, updated_at = ?
                WHERE case_key = ? AND source_type = 'system'
            `).run(
                JSON.stringify(config),
                new Date().toISOString(),
                'cutting-shell-purpose-evidence'
            );
        },
    },
    {
        version: 61,
        name: 'orders_stable_customer_identity',
        signature: 'orders-customer-id-backfill-and-index-v1',
        foreignKeysOff: true,
        up(db) {
            const columns = columnNames(db, 'orders');
            if (!columns.has('customer_id')) {
                db.exec(`
                    ALTER TABLE orders
                    ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT;
                `);
            }
            // 当前权威 Schema 已包含下一版订单关闭字段；在重建整表前先补齐，
            // 使从 60 及更早版本顺序升级时仍能完成 v61 的约束重建。
            if (!columns.has('inventory_disposition')) {
                db.exec(`ALTER TABLE orders ADD COLUMN inventory_disposition TEXT;`);
            }
            if (!columns.has('inventory_disposition_at')) {
                db.exec(`ALTER TABLE orders ADD COLUMN inventory_disposition_at TEXT;`);
            }
            if (!columns.has('inventory_disposition_note')) {
                db.exec(`ALTER TABLE orders ADD COLUMN inventory_disposition_note TEXT DEFAULT '';`);
            }
            db.exec(`
                UPDATE orders
                SET customer_id = (
                    SELECT customers.id
                    FROM customers
                    WHERE TRIM(customers.name) = TRIM(orders.customer_name)
                    ORDER BY CASE WHEN customers.deleted_at IS NULL THEN 0 ELSE 1 END, customers.id
                    LIMIT 1
                )
                WHERE customer_id IS NULL
                  AND EXISTS (
                    SELECT 1 FROM customers
                    WHERE TRIM(customers.name) = TRIM(orders.customer_name)
                );
            `);
            rebuildOrders(db);
            db.exec(CANONICAL_INDEXES_SQL);
            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_orders_customer
                    ON orders(customer_id, deleted_at, created_at);
            `);
        },
    },
    {
        version: 62,
        name: 'order_inventory_disposition_on_close',
        signature: 'order-close-inventory-disposition-v1',
        foreignKeysOff: true,
        up(db) {
            const columns = columnNames(db, 'orders');
            if (!columns.has('inventory_disposition')) {
                db.exec(`ALTER TABLE orders ADD COLUMN inventory_disposition TEXT;`);
            }
            if (!columns.has('inventory_disposition_at')) {
                db.exec(`ALTER TABLE orders ADD COLUMN inventory_disposition_at TEXT;`);
            }
            if (!columns.has('inventory_disposition_note')) {
                db.exec(`ALTER TABLE orders ADD COLUMN inventory_disposition_note TEXT DEFAULT '';`);
            }
            rebuildOrders(db);
            db.exec(CANONICAL_INDEXES_SQL);
        },
    },
    {
        version: 63,
        name: 'coil_winding_profile_ai_evaluation',
        signature: 'system-ai-check-validates-live-coil-winding-profile-v1',
        up(db) {
            const now = new Date().toISOString();
            db.prepare(`
                INSERT INTO ai_evaluation_cases (
                    case_key, title, category, question, evaluator_type, config_json,
                    enabled, release_gate_enabled, sort_order, source_type,
                    review_status, confidence_score, reviewed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'rules', ?, 1, 0, ?, 'system', 'approved', 100, ?, ?, ?)
                ON CONFLICT(case_key) DO UPDATE SET
                    title = excluded.title,
                    category = excluded.category,
                    question = excluded.question,
                    evaluator_type = excluded.evaluator_type,
                    config_json = excluded.config_json,
                    enabled = excluded.enabled,
                    release_gate_enabled = excluded.release_gate_enabled,
                    sort_order = excluded.sort_order,
                    review_status = excluded.review_status,
                    confidence_score = excluded.confidence_score,
                    reviewed_at = excluded.reviewed_at,
                    updated_at = excluded.updated_at
                WHERE ai_evaluation_cases.source_type = 'system'
            `).run(
                'coil-winding-profile',
                '线圈绕组档案使用当前已保存值',
                '线圈',
                '查询12-120线圈档案中已设置的绕组数据，按匹配方案列出主线线径、主线绕组数据、副线线径和副线绕组数据。',
                JSON.stringify({
                    prerequisite: {
                        type: 'coil_variants',
                        spec: '12',
                        sheets: 120,
                    },
                    unavailableTerms: ['未找到', '没有找到', '未查到', '暂无', '没有可列出'],
                    expectedMode: 'live_business',
                    requiredTools: ['search_coils'],
                    requiredSourceTables: ['coils'],
                    forbiddenTerms: ['没有绕组数据字段', '不存在绕组数据字段'],
                    fact: {
                        type: 'coil_winding_profile',
                        spec: '12',
                        sheets: 120,
                        unavailableTerms: ['未填写绕组数据', '未设置绕组数据', '暂无绕组数据'],
                    },
                }),
                25,
                now,
                now,
                now
            );
        },
    },
    {
        version: 64,
        name: 'recipe_configuration_policy',
        signature: 'template-and-recipe-configuration-policy-json-v1',
        up(db) {
            const templateColumns = columnNames(db, 'pump_shell_templates');
            if (!templateColumns.has('configuration_policy_json')) {
                db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN configuration_policy_json TEXT;`);
            }
            const recipeColumns = columnNames(db, 'recipes');
            if (!recipeColumns.has('configuration_policy_json')) {
                db.exec(`ALTER TABLE recipes ADD COLUMN configuration_policy_json TEXT;`);
            }
        },
    },
    {
        version: 65,
        name: 'order_revision_history',
        signature: 'order-edit-revision-snapshots-v1',
        foreignKeysOff: true,
        up(db) {
            createOrderRevisionsTable(db);
            repairOrderRevisionsForeignKey(db);
        },
    },
    {
        version: 66,
        name: 'immutable_order_revisions',
        signature: 'reject-order-revision-update-delete-v1',
        up(db) {
            createOrderRevisionImmutabilityTriggers(db);
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
    const selectAppliedVersion = db.prepare(`
        SELECT version, name, checksum FROM schema_migrations WHERE version = ?
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
        let appliedNow = false;
        try {
            const apply = db.transaction(() => {
                const concurrent = selectAppliedVersion.get(migration.version);
                if (concurrent) {
                    if (concurrent.name !== migration.name || concurrent.checksum !== checksum) {
                        throw new Error(`迁移 ${migration.version} 校验失败，已应用迁移不得修改`);
                    }
                    return;
                }
                migration.up(db);
                insert.run(
                    migration.version,
                    migration.name,
                    checksum,
                    options.now || new Date().toISOString()
                );
                db.pragma(`user_version = ${migration.version}`);
                appliedNow = true;
            });
            apply.immediate();
        } finally {
            if (migration.foreignKeysOff && foreignKeysEnabled) db.pragma('foreign_keys = ON');
        }
        if (appliedNow) completed.push(migration.version);
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
    addOrderExecutionEvidenceFileRole,
    addOrderFactoryFileLinks,
    createOrderExecutionRecordsTable,
    migrationChecksum,
    repairOrderExecutionRecordsForeignKey,
    repairOrderRevisionsForeignKey,
    repairOrderRequirementSummariesForeignKey,
    repairOrderPackagingEstimates,
    repairRecipePackagingSnapshots,
    runMigrations,
};
