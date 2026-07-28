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
