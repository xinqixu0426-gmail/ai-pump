const CANONICAL_TABLES_SQL = `
    CREATE TABLE IF NOT EXISTS pump_shell_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shell_model TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        parts_json TEXT DEFAULT '[]',
        rotor_params_json TEXT DEFAULT '{}',
        assembly_wage REAL DEFAULT 0,
        packing_wage REAL DEFAULT 0,
        painting_wage REAL,
        surface_treatment_mode TEXT DEFAULT 'none',
        surface_treatment_cost REAL,
        cost_mode TEXT DEFAULT 'components',
        bundle_cost REAL DEFAULT 0,
        bundle_note TEXT DEFAULT '',
        shell_components_json TEXT DEFAULT '[]',
        created_at TEXT,
        updated_at TEXT,
        CHECK(assembly_wage IS NULL OR assembly_wage >= 0),
        CHECK(packing_wage IS NULL OR packing_wage >= 0),
        CHECK(surface_treatment_cost IS NULL OR surface_treatment_cost >= 0),
        CHECK(bundle_cost IS NULL OR bundle_cost >= 0),
        CHECK(cost_mode IN ('components', 'bundle')),
        CHECK(surface_treatment_mode IN (
            'none', 'painting', 'electrophoresis',
            'electrophoresis_powder_coating', 'powder_coating', 'custom'
        ))
    );

    CREATE TABLE IF NOT EXISTS parts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        category TEXT DEFAULT '其他',
        subcategory TEXT DEFAULT '',
        price REAL DEFAULT 0,
        supplier TEXT DEFAULT '-',
        stock INTEGER DEFAULT 0,
        remark TEXT DEFAULT '',
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT,
        CHECK(price IS NULL OR price >= 0),
        CHECK(stock IS NULL OR stock >= 0)
    );

    CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        spec TEXT,
        parts_json TEXT DEFAULT '[]',
        saved_total_cost REAL DEFAULT 0,
        saved_cost_details TEXT DEFAULT '[]',
        template_id INTEGER,
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
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT,
        FOREIGN KEY(template_id) REFERENCES pump_shell_templates(id) ON DELETE SET NULL,
        FOREIGN KEY(model_variant_id) REFERENCES pump_model_variants(id) ON DELETE SET NULL,
        CHECK(saved_total_cost IS NULL OR saved_total_cost >= 0),
        CHECK(coil_sheets IS NULL OR coil_sheets >= 0),
        CHECK(has_float IN (0, 1)),
        CHECK(has_cable IN (0, 1)),
        CHECK(cable_length IS NULL OR cable_length >= 0),
        CHECK(assembly_wage IS NULL OR assembly_wage >= 0),
        CHECK(packing_wage IS NULL OR packing_wage >= 0),
        CHECK(surface_treatment_cost IS NULL OR surface_treatment_cost >= 0),
        CHECK(management_fee IS NULL OR management_fee >= 0),
        CHECK(long_screw_extra_length IS NULL OR long_screw_extra_length >= 0),
        CHECK(surface_treatment_mode IN (
            'none', 'painting', 'electrophoresis',
            'electrophoresis_powder_coating', 'powder_coating', 'custom'
        ))
    );

    CREATE TABLE IF NOT EXISTS orders (
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
        deleted_at TEXT,
        CHECK(status IN ('待确认', '待采购', '采购中', '采购完成', '已关闭', '已取消'))
    );

    CREATE TABLE IF NOT EXISTS stator_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        diameter_mm INTEGER NOT NULL,
        common_name TEXT DEFAULT '',
        material TEXT NOT NULL,
        slot_type TEXT NOT NULL DEFAULT '小眼',
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(diameter_mm, material, slot_type),
        CHECK(diameter_mm > 0),
        CHECK(material IN ('钢带', '冷轧')),
        CHECK(slot_type IN ('小眼', '国标眼'))
    );

    CREATE TABLE IF NOT EXISTS coils (
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
        FOREIGN KEY(stator_variant_id) REFERENCES stator_variants(id),
        CHECK(material IN ('钢带', '冷轧')),
        CHECK(slot_type IN ('小眼', '国标眼')),
        CHECK(sheets > 0),
        CHECK(scheme_status IN ('official', 'testing')),
        CHECK(unit_price IS NULL OR unit_price >= 0),
        CHECK(wire_weight IS NULL OR wire_weight >= 0),
        CHECK(copper_base IS NULL OR copper_base >= 0),
        CHECK(coil_fee IS NULL OR coil_fee >= 0),
        CHECK(rotor_fee IS NULL OR rotor_fee >= 0),
        CHECK(cost IS NULL OR cost >= 0)
    );

    CREATE TABLE IF NOT EXISTS rotor_drawings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL UNIQUE,
        drawing_name TEXT DEFAULT '',
        nl_input TEXT DEFAULT '',
        params_json TEXT DEFAULT '{}',
        fc_params_json TEXT DEFAULT '{}',
        status TEXT DEFAULT 'processing',
        file_url TEXT DEFAULT '',
        error TEXT DEFAULT '',
        linked_pump_model TEXT DEFAULT '',
        created_at TEXT,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        table_name TEXT,
        record_id INTEGER,
        old_value TEXT,
        new_value TEXT,
        user TEXT DEFAULT 'system',
        created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        contact_info TEXT DEFAULT '',
        default_margin REAL DEFAULT 0,
        remark TEXT DEFAULT '',
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT,
        CHECK(default_margin IS NULL OR default_margin >= 0)
    );

    CREATE TABLE IF NOT EXISTS quotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        status TEXT DEFAULT '报价中',
        items_json TEXT DEFAULT '[]',
        total_cost REAL DEFAULT 0,
        total_price REAL DEFAULT 0,
        remark TEXT DEFAULT '',
        converted_order_id INTEGER,
        converted_at TEXT,
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT,
        FOREIGN KEY(customer_id) REFERENCES customers(id),
        FOREIGN KEY(converted_order_id) REFERENCES orders(id) ON DELETE SET NULL,
        CHECK(status IN ('草稿', '报价中', '已接受', '已拒绝', '已转订单', '已过时')),
        CHECK(total_cost IS NULL OR total_cost >= 0),
        CHECK(total_price IS NULL OR total_price >= 0)
    );

    CREATE TABLE IF NOT EXISTS pump_model_variants (
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
        FOREIGN KEY(template_id) REFERENCES pump_shell_templates(id),
        CHECK(coil_sheets IS NULL OR coil_sheets >= 0),
        CHECK(barrel_length IS NULL OR barrel_length >= 0),
        CHECK(long_screw_extra_length IS NULL OR long_screw_extra_length >= 0)
    );

    CREATE TABLE IF NOT EXISTS knowledge_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_type TEXT NOT NULL,
        source_table TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_updated_at TEXT,
        title TEXT NOT NULL,
        summary TEXT DEFAULT '',
        content TEXT DEFAULT '',
        tags_json TEXT DEFAULT '[]',
        metadata_json TEXT DEFAULT '{}',
        search_text TEXT DEFAULT '',
        content_hash TEXT DEFAULT '',
        synced_at TEXT,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(source_table, source_id)
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_key TEXT NOT NULL DEFAULT 'admin',
        title TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        last_message_preview TEXT DEFAULT '',
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_conversation_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT DEFAULT '{}',
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id)
    );

    CREATE TABLE IF NOT EXISTS ai_answer_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL UNIQUE,
        rating TEXT NOT NULL CHECK(rating IN ('helpful', 'incorrect', 'outdated', 'missing_source')),
        note TEXT DEFAULT '',
        question_text TEXT DEFAULT '',
        answer_text TEXT DEFAULT '',
        sources_json TEXT DEFAULT '[]',
        diagnosis_json TEXT DEFAULT '{}',
        diagnosed_at TEXT,
        retest_answer_text TEXT DEFAULT '',
        retest_sources_json TEXT DEFAULT '[]',
        retested_at TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
        resolution_note TEXT DEFAULT '',
        resolved_at TEXT,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id),
        FOREIGN KEY(message_id) REFERENCES ai_conversation_messages(id)
    );

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

    CREATE TABLE IF NOT EXISTS recipe_technical_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT DEFAULT 'application/octet-stream',
        file_size INTEGER DEFAULT 0,
        file_sha256 TEXT NOT NULL,
        file_blob BLOB NOT NULL,
        report_type TEXT DEFAULT 'pump_performance_test',
        summary_json TEXT DEFAULT '{}',
        parsed_json TEXT DEFAULT '{}',
        extracted_text TEXT DEFAULT '',
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT,
        FOREIGN KEY(recipe_id) REFERENCES recipes(id)
    );

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
        support_count INTEGER NOT NULL DEFAULT 0,
        special_case_count INTEGER NOT NULL DEFAULT 0,
        ignored_count INTEGER NOT NULL DEFAULT 0,
        confidence_score REAL NOT NULL DEFAULT 0,
        learning_evidence_json TEXT DEFAULT '{}',
        learning_hash TEXT DEFAULT '',
        reviewed_learning_hash TEXT DEFAULT '',
        learning_updated_at TEXT,
        status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate', 'approved', 'rejected', 'stale')),
        review_note TEXT DEFAULT '',
        approved_at TEXT,
        created_at TEXT,
        updated_at TEXT
    );
`;

const CANONICAL_INDEXES_SQL = `
    DROP INDEX IF EXISTS idx_pst_model;
    CREATE INDEX IF NOT EXISTS idx_knowledge_entries_type
        ON knowledge_entries(entry_type);
    CREATE INDEX IF NOT EXISTS idx_knowledge_entries_source
        ON knowledge_entries(source_table, source_id);
    CREATE INDEX IF NOT EXISTS idx_ai_conversations_owner_updated
        ON ai_conversations(owner_key, deleted_at, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_conversation_messages_conversation
        ON ai_conversation_messages(conversation_id, id);
    CREATE INDEX IF NOT EXISTS idx_ai_answer_feedback_status
        ON ai_answer_feedback(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_answer_feedback_conversation
        ON ai_answer_feedback(conversation_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_ai_evaluation_runs_owner
        ON ai_evaluation_runs(owner_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_evaluation_results_run
        ON ai_evaluation_results(run_id, case_id);
    CREATE INDEX IF NOT EXISTS idx_recipe_technical_files_recipe
        ON recipe_technical_files(recipe_id, deleted_at, id DESC);
    CREATE INDEX IF NOT EXISTS idx_recipe_analysis_feedback_recipe
        ON recipe_analysis_feedback(recipe_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_factory_rule_candidates_status
        ON factory_rule_candidates(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_coils_variant_sheets
        ON coils(stator_variant_id, sheets);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_coils_one_official_scheme
        ON coils(stator_variant_id, sheets)
        WHERE scheme_status = 'official';
    CREATE INDEX IF NOT EXISTS idx_parts_active_category
        ON parts(deleted_at, category, subcategory);
    CREATE INDEX IF NOT EXISTS idx_parts_active_identity
        ON parts(deleted_at, model, supplier);
    CREATE INDEX IF NOT EXISTS idx_recipes_active_updated
        ON recipes(deleted_at, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_recipes_template
        ON recipes(template_id);
    CREATE INDEX IF NOT EXISTS idx_recipes_model_variant
        ON recipes(model_variant_id);
    CREATE INDEX IF NOT EXISTS idx_orders_active_status_created
        ON orders(deleted_at, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_quotations_active_status_updated
        ON quotations(deleted_at, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quotations_customer
        ON quotations(customer_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_quotations_converted_order
        ON quotations(converted_order_id);
    CREATE INDEX IF NOT EXISTS idx_model_variants_template
        ON pump_model_variants(template_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created
        ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_record
        ON audit_log(table_name, record_id, created_at DESC);
`;

const LEGACY_COLUMN_UPGRADES = {
    parts: [
        ['remark', "TEXT DEFAULT ''"],
        ['subcategory', "TEXT DEFAULT ''"],
        ['deleted_at', 'TEXT'],
    ],
    recipes: [
        ['template_id', 'INTEGER'],
        ['coil_spec', "TEXT DEFAULT ''"],
        ['coil_sheets', 'INTEGER DEFAULT 0'],
        ['coil_material', "TEXT DEFAULT '钢带'"],
        ['coil_slot_type', "TEXT DEFAULT '小眼'"],
        ['coil_wire_weight', 'REAL'],
        ['has_float', 'INTEGER DEFAULT 0'],
        ['float_wire', "TEXT DEFAULT ''"],
        ['float_accessory_type', "TEXT DEFAULT 'standard'"],
        ['has_cable', 'INTEGER DEFAULT 0'],
        ['cable_length', 'REAL DEFAULT 0'],
        ['cable_wire', "TEXT DEFAULT ''"],
        ['cable_accessory_type', "TEXT DEFAULT 'standard'"],
        ['box_type', "TEXT DEFAULT ''"],
        ['extra_parts_json', "TEXT DEFAULT '[]'"],
        ['packing_parts_json', "TEXT DEFAULT '[]'"],
        ['assembly_wage', 'REAL DEFAULT 0'],
        ['packing_wage', 'REAL DEFAULT 0'],
        ['painting_wage', 'REAL'],
        ['surface_treatment_mode', "TEXT DEFAULT 'none'"],
        ['surface_treatment_cost', 'REAL DEFAULT 0'],
        ['management_fee', 'REAL DEFAULT 0'],
        ['custom_barrel_length', 'REAL'],
        ['long_screw_extra_length', 'REAL DEFAULT 0'],
        ['model_variant_id', 'INTEGER'],
        ['impeller_model', "TEXT DEFAULT ''"],
        ['impeller_thickness', 'REAL'],
        ['impeller_diameter', 'REAL'],
        ['impeller_blade_count', 'INTEGER'],
        ['technical_data_json', "TEXT DEFAULT '{}'"],
        ['deleted_at', 'TEXT'],
    ],
    orders: [
        ['purchase_completed_at', 'TEXT'],
        ['purchase_receipt_id', 'TEXT'],
        ['status_reason', "TEXT DEFAULT ''"],
        ['status_changed_at', 'TEXT'],
        ['closed_at', 'TEXT'],
        ['cancelled_at', 'TEXT'],
        ['deleted_at', 'TEXT'],
    ],
    coils: [
        ['material', "TEXT DEFAULT '钢带'"],
        ['main_wire_gauge', "TEXT DEFAULT ''"],
        ['main_wire_data', "TEXT DEFAULT ''"],
        ['aux_wire_gauge', "TEXT DEFAULT ''"],
        ['aux_wire_data', "TEXT DEFAULT ''"],
        ['stator_variant_id', 'INTEGER'],
        ['slot_type', "TEXT DEFAULT '小眼'"],
        ['scheme_name', "TEXT DEFAULT ''"],
        ['scheme_status', "TEXT DEFAULT 'official'"],
    ],
    pump_shell_templates: [
        ['rotor_params_json', "TEXT DEFAULT '{}'"],
        ['assembly_wage', 'REAL DEFAULT 0'],
        ['packing_wage', 'REAL DEFAULT 0'],
        ['painting_wage', 'REAL'],
        ['surface_treatment_mode', "TEXT DEFAULT 'none'"],
        ['surface_treatment_cost', 'REAL'],
        ['cost_mode', "TEXT DEFAULT 'components'"],
        ['bundle_cost', 'REAL DEFAULT 0'],
        ['bundle_note', "TEXT DEFAULT ''"],
        ['shell_components_json', "TEXT DEFAULT '[]'"],
    ],
    pump_model_variants: [
        ['long_screw_extra_length', 'REAL DEFAULT 0'],
        ['custom_fields_json', "TEXT DEFAULT '[]'"],
        ['coil_slot_type', "TEXT DEFAULT '小眼'"],
    ],
    rotor_drawings: [
        ['linked_pump_model', "TEXT DEFAULT ''"],
        ['drawing_name', "TEXT DEFAULT ''"],
    ],
    quotations: [
        ['converted_order_id', 'INTEGER'],
        ['converted_at', 'TEXT'],
    ],
};

const COIL_STOCK_COLUMN_DEFINITION = 'INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0)';
const COIL_INVENTORY_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS coil_stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        coil_id INTEGER NOT NULL,
        change_qty INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        movement_type TEXT NOT NULL,
        reference_type TEXT DEFAULT '',
        reference_id TEXT DEFAULT '',
        note TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(coil_id) REFERENCES coils(id),
        CHECK(change_qty <> 0),
        CHECK(balance_after >= 0)
    );
    CREATE INDEX IF NOT EXISTS idx_coil_stock_movements_coil_created
        ON coil_stock_movements(coil_id, created_at DESC);
`;

const APPLICATION_TABLES = Object.freeze([
    'ai_answer_feedback',
    'ai_conversation_messages',
    'ai_conversations',
    'ai_evaluation_cases',
    'ai_evaluation_results',
    'ai_evaluation_runs',
    'audit_log',
    'coil_stock_movements',
    'coils',
    'config',
    'customers',
    'factory_rule_candidates',
    'knowledge_entries',
    'orders',
    'parts',
    'pump_model_variants',
    'pump_shell_templates',
    'quotations',
    'recipe_analysis_feedback',
    'recipe_technical_files',
    'recipes',
    'rotor_drawings',
    'stator_variants',
    'system_settings',
]);

const CORE_CONSTRAINED_TABLES = Object.freeze([
    'pump_shell_templates',
    'parts',
    'recipes',
    'orders',
    'stator_variants',
    'coils',
    'customers',
    'quotations',
    'pump_model_variants',
]);

function canonicalCreateTableSql(table, targetTable = table) {
    if (!CORE_CONSTRAINED_TABLES.includes(table)) {
        throw new Error(`没有可重建的核心表定义: ${table}`);
    }
    if (!/^[a-z][a-z0-9_]*$/.test(targetTable)) {
        throw new Error(`非法目标表名: ${targetTable}`);
    }
    const marker = `CREATE TABLE IF NOT EXISTS ${table} (`;
    const start = CANONICAL_TABLES_SQL.indexOf(marker);
    if (start < 0) throw new Error(`找不到核心表定义: ${table}`);
    const bodyStart = start + marker.length;
    const end = CANONICAL_TABLES_SQL.indexOf('\n    );', bodyStart);
    if (end < 0) throw new Error(`核心表定义不完整: ${table}`);
    return `CREATE TABLE ${targetTable} (${CANONICAL_TABLES_SQL.slice(bodyStart, end)}\n    )`;
}

function createKnowledgeFts(db) {
    const existing = db.prepare(`
        SELECT sql FROM sqlite_schema
        WHERE type = 'table' AND name = 'knowledge_entries_fts'
    `).get();
    if (existing?.sql && /\bcontent\s*=/i.test(existing.sql)) {
        db.exec('DROP TABLE knowledge_entries_fts');
    }
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_entries_fts USING fts5(
            entry_id UNINDEXED,
            title,
            summary,
            content,
            tags
        );
    `);
}

module.exports = {
    APPLICATION_TABLES,
    CANONICAL_INDEXES_SQL,
    CANONICAL_TABLES_SQL,
    COIL_INVENTORY_SCHEMA_SQL,
    COIL_STOCK_COLUMN_DEFINITION,
    CORE_CONSTRAINED_TABLES,
    LEGACY_COLUMN_UPGRADES,
    canonicalCreateTableSql,
    createKnowledgeFts,
};
