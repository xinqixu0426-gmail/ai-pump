const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { APPLICATION_TABLES } = require('../api/database/schema.cjs');
const {
    MIGRATIONS,
    addOrderFactoryFileLinks,
    repairOrderPackagingEstimates,
    repairRecipePackagingSnapshots,
    runMigrations,
} = require('../api/database/migrations.cjs');

const FIXED_NOW = '2026-07-25T00:00:00.000Z';

test('命名输入迁移只新增可空列，保留原型号、价格、库存且不接受非对象 JSON', () => {
    const db = new Database(':memory:');
    try {
        db.exec("CREATE TABLE parts (id INTEGER PRIMARY KEY, model TEXT, price REAL, stock REAL); INSERT INTO parts VALUES (1, '旧型号', 4.5, 9)");
        MIGRATIONS.find(migration => migration.version === 84).up(db);
        assert.deepEqual(db.prepare('SELECT * FROM parts').get(), { id: 1, model: '旧型号', price: 4.5, stock: 9, naming_json: null });
        for (const value of ['[]', 'null', '123', 'broken']) {
            assert.throws(() => db.prepare('INSERT INTO parts (naming_json) VALUES (?)').run(value));
        }
        assert.doesNotThrow(() => db.prepare('INSERT INTO parts (naming_json) VALUES (?)').run('{"ruleId":"packaging"}'));
    } finally { db.close(); }
});

function openMemoryDatabase() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    return db;
}

function createFirstVersionFixture(db) {
    db.exec(`
        CREATE TABLE pump_shell_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shell_model TEXT NOT NULL UNIQUE,
            description TEXT DEFAULT '',
            parts_json TEXT DEFAULT '[]',
            created_at TEXT,
            updated_at TEXT
        );
        CREATE UNIQUE INDEX idx_pst_model ON pump_shell_templates(shell_model);

        CREATE TABLE parts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model TEXT NOT NULL,
            category TEXT DEFAULT '其他',
            price REAL DEFAULT 0,
            supplier TEXT DEFAULT '-',
            stock INTEGER DEFAULT 0,
            remark TEXT DEFAULT '',
            created_at TEXT,
            updated_at TEXT
        );

        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            spec TEXT,
            parts_json TEXT DEFAULT '[]',
            saved_total_cost REAL DEFAULT 0,
            saved_cost_details TEXT DEFAULT '[]',
            created_at TEXT,
            updated_at TEXT
        );

        CREATE TABLE orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_name TEXT NOT NULL,
            contract_no TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            status TEXT DEFAULT '待采购',
            items_json TEXT DEFAULT '[]',
            purchase_list_json TEXT DEFAULT '[]',
            todos_json TEXT DEFAULT '[]',
            created_at TEXT,
            updated_at TEXT
        );

        CREATE TABLE coils (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            spec TEXT NOT NULL,
            sheets INTEGER NOT NULL,
            unit_price REAL DEFAULT 0,
            wire_weight REAL DEFAULT 0,
            copper_base REAL DEFAULT 0,
            coil_fee REAL DEFAULT 0,
            rotor_fee REAL DEFAULT 0,
            cost REAL DEFAULT 0,
            default_wire_gauge TEXT,
            default_capacitor TEXT,
            created_at TEXT,
            updated_at TEXT
        );

        INSERT INTO parts (
            model, category, price, supplier, stock, remark, created_at, updated_at
        ) VALUES (
            '550w牛皮纸箱', '包装', 5, '广发纸箱', 0, '', '${FIXED_NOW}', '${FIXED_NOW}'
        );
        INSERT INTO recipes (
            name, parts_json, saved_cost_details, created_at, updated_at
        ) VALUES (
            '旧配方',
            '[{"model":"6*205","dynamicRule":"longScrewByBarrelLength","longScrewExtraLength":25}]',
            '旧成本快照',
            '${FIXED_NOW}',
            '${FIXED_NOW}'
        );
        INSERT INTO orders (
            customer_name, status, created_at, updated_at
        ) VALUES ('旧客户', '已完成', '${FIXED_NOW}', '${FIXED_NOW}');
        INSERT INTO coils (
            spec, sheets, created_at, updated_at
        ) VALUES ('12', 120, '${FIXED_NOW}', '${FIXED_NOW}');
    `);
}

function normalizeDefault(value) {
    return value == null ? null : String(value).replace(/\s+/g, ' ').trim();
}

function tableSignature(db, table) {
    const columns = db.pragma(`table_info("${table}")`)
        .map((column) => ({
            name: column.name,
            type: String(column.type || '').toUpperCase(),
            notnull: Number(column.notnull),
            default: normalizeDefault(column.dflt_value),
            pk: Number(column.pk),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    const foreignKeys = db.pragma(`foreign_key_list("${table}")`)
        .map((fk) => ({
            table: fk.table,
            from: fk.from,
            to: fk.to,
            onUpdate: fk.on_update,
            onDelete: fk.on_delete,
        }))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const indexes = db.pragma(`index_list("${table}")`)
        .filter((index) => index.origin !== 'pk' && !index.name.startsWith('sqlite_autoindex_'))
        .map((index) => ({
            name: index.name,
            unique: Number(index.unique),
            partial: Number(index.partial),
            columns: db.pragma(`index_info("${index.name}")`).map((column) => column.name),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    const sql = String(db.prepare(`
        SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?
    `).get(table)?.sql || '').replace(/\s+/g, ' ').trim();
    return { columns, foreignKeys, indexes, sql };
}

function databaseSignature(db) {
    return Object.fromEntries(
        APPLICATION_TABLES.map((table) => [table, tableSignature(db, table)])
    );
}

test('数据库迁移：空库初始化到当前版本且重复执行无副作用', () => {
    const db = openMemoryDatabase();
    try {
        const first = runMigrations(db, { now: FIXED_NOW });
        const second = runMigrations(db, { now: FIXED_NOW });
        const rows = db.prepare(`
            SELECT version, name, checksum FROM schema_migrations ORDER BY version
        `).all();

        assert.deepEqual(first.appliedVersions, MIGRATIONS.map((migration) => migration.version));
        assert.deepEqual(second.appliedVersions, []);
        assert.equal(first.currentVersion, MIGRATIONS.at(-1).version);
        assert.equal(db.pragma('user_version', { simple: true }), first.currentVersion);
        assert.equal(rows.length, MIGRATIONS.length);
        assert.ok(rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum)));
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'knowledge_entries_fts'
        `).get());
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'knowledge_sync_runs'
        `).get());
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'knowledge_embeddings'
        `).get());
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'knowledge_vector_sync_runs'
        `).get());
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'factory_workflow_runs'
        `).get());
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'factory_files'
        `).get());
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'api_operations'
        `).get());
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'order_revisions'
        `).get());
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = 'idx_order_revisions_order'
        `).get());
        db.prepare(`
            INSERT INTO orders (customer_name, status, created_at, updated_at)
            VALUES ('修订不可变测试', '待确认', ?, ?)
        `).run(FIXED_NOW, FIXED_NOW);
        const orderId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
        db.prepare(`
            INSERT INTO order_revisions (
                order_id, revision_no, reason, before_snapshot_json,
                after_snapshot_json, change_summary_json, operation_id, actor, created_at
            ) VALUES (?, 1, '初始原因', '{}', '{}', '[]', 'immutable-test', 'system', ?)
        `).run(orderId, FIXED_NOW);
        assert.throws(
            () => db.prepare(`UPDATE order_revisions SET reason = '篡改' WHERE order_id = ?`).run(orderId),
            /order revisions are immutable/
        );
        assert.throws(
            () => db.prepare('DELETE FROM order_revisions WHERE order_id = ?').run(orderId),
            /order revisions are immutable/
        );
        assert.equal(
            db.prepare('SELECT reason FROM order_revisions WHERE order_id = ?').get(orderId).reason,
            '初始原因'
        );
        const cuttingCase = db.prepare(`
            SELECT config_json FROM ai_evaluation_cases
            WHERE case_key = 'cutting-shell-purpose-evidence'
        `).get();
        const cuttingConfig = JSON.parse(cuttingCase.config_json);
        assert.ok(cuttingConfig.requiredTerms.some(group => (
            group.includes('未明确记录')
            && group.includes('未记录')
            && group.includes('不能确认')
            && group.includes('系统未确认')
        )));
        const coilsSql = db.prepare(`
            SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'coils'
        `).get().sql;
        assert.match(
            coilsSql,
            /CHECK\(scheme_status IN \('official', 'testing', 'disabled'\)\)/
        );
        db.prepare(`
            INSERT INTO coils (
                spec, material, slot_type, sheets, scheme_status,
                created_at, updated_at
            ) VALUES ('disabled-test', '钢带', '小眼', 1, 'disabled', ?, ?)
        `).run(FIXED_NOW, FIXED_NOW);
        const auditColumns = new Set(db.pragma('table_info(audit_log)').map(column => column.name));
        assert.ok(auditColumns.has('request_id'));
        assert.ok(auditColumns.has('operation_id'));
        assert.ok(auditColumns.has('capability_id'));
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'factory_file_links'
        `).get());
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'order_requirement_summaries'
        `).get());
        const requirementSql = db.prepare(`
            SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'order_requirement_summaries'
        `).get().sql;
        assert.match(requirementSql, /CHECK\(status IN \('draft', 'confirmed'\)\)/);
        const requirementUniqueIndexes = db.pragma('index_list(order_requirement_summaries)')
            .filter(index => index.unique)
            .map(index => db.pragma(`index_info("${index.name}")`).map(column => column.name));
        assert.ok(requirementUniqueIndexes.some(columns => columns.length === 1 && columns[0] === 'order_id'));
        assert.equal(
            db.pragma('foreign_key_list(order_requirement_summaries)')
                .find(item => item.from === 'order_id')?.table,
            'orders'
        );
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'order_execution_records'
        `).get());
        const executionSql = db.prepare(`
            SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'order_execution_records'
        `).get().sql;
        assert.match(executionSql, /'pre_production', 'in_production', 'post_production'/);
        assert.match(executionSql, /CHECK\(status IN \('draft', 'confirmed'\)\)/);
        assert.equal(
            db.pragma('foreign_key_list(order_execution_records)')
                .find(item => item.from === 'order_id')?.table,
            'orders'
        );
        assert.ok(
            db.pragma('index_list(order_execution_records)')
                .some(index => index.name === 'idx_order_execution_records_order')
        );
        assert.equal(
            db.pragma('index_list(factory_file_links)')
                .find(index => index.name === 'idx_factory_file_links_active_unique')?.partial,
            1
        );
        const fileLinkSql = db.prepare(`
            SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'factory_file_links'
        `).get().sql;
        assert.match(fileLinkSql, /'order'/);
        assert.match(fileLinkSql, /'customer_requirement'/);
        assert.match(fileLinkSql, /'execution_evidence'/);
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'runtime_settings'
        `).get());
        for (const column of ['parsed_text', 'parsed_json', 'parser_error', 'parsed_at']) {
            assert.ok(db.pragma('table_info(factory_files)').some(item => item.name === column), column);
        }
        assert.ok(db.pragma('table_info(knowledge_documents)').some(column => column.name === 'file_id'));
        assert.ok(db.pragma('table_info(recipe_technical_files)').some(column => column.name === 'file_id'));
        assert.equal(db.prepare(`
            SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'idx_pst_model'
        `).get().count, 0);
    } finally {
        db.close();
    }
});

test('数据库迁移：恢复缺失的系统 AI 发布回归用例且不修改反馈用例', () => {
    const db = openMemoryDatabase();
    try {
        runMigrations(db, { now: FIXED_NOW });
        db.prepare(`DELETE FROM ai_evaluation_cases WHERE source_type = 'system'`).run();
        db.prepare(`
            INSERT INTO ai_evaluation_cases (
                case_key, title, category, question, evaluator_type, config_json,
                enabled, sort_order, source_type, review_status, confidence_score,
                created_at, updated_at
            ) VALUES (
                'feedback-preserved', '用户反馈用例', '反馈', '保留这条反馈',
                'rules', '{}', 0, 1000, 'feedback', 'pending', 70, ?, ?
            )
        `).run(FIXED_NOW, FIXED_NOW);

        const restoreMigration = MIGRATIONS.find(migration => migration.version === 47);
        const dataAwareMigration = MIGRATIONS.find(migration => migration.version === 48);
        const formalTechnicalFileMigration = MIGRATIONS.find(migration => migration.version === 49);
        const formalCoilQueryMigration = MIGRATIONS.find(migration => migration.version === 50);
        const dataAwareCoilQueryMigration = MIGRATIONS.find(migration => migration.version === 51);
        const equivalentCablePhrasingMigration = MIGRATIONS.find(migration => migration.version === 52);
        const explicitUnconfirmedCuttingMigration = MIGRATIONS.find(migration => migration.version === 53);
        const pollutedFeedbackRegressionMigration = MIGRATIONS.find(migration => migration.version === 54);
        const noExplicitCuttingMarkingMigration = MIGRATIONS.find(migration => migration.version === 55);
        const nonCoreReleaseCasesMigration = MIGRATIONS.find(migration => migration.version === 56);
        const systemReleaseCasesMigration = MIGRATIONS.find(migration => migration.version === 57);
        const manualSystemChecksMigration = MIGRATIONS.find(migration => migration.version === 59);
        const calibratedCuttingCheckMigration = MIGRATIONS.find(migration => migration.version === 60);
        const coilWindingProfileMigration = MIGRATIONS.find(migration => migration.version === 63);
        const enableCoreAiReleaseGateMigration = MIGRATIONS.find(migration => migration.version === 72);
        const restoreCoreAiReleaseCasesMigration = MIGRATIONS.find(migration => migration.version === 73);
        const configuredTemplateCostMigration = MIGRATIONS.find(migration => migration.version === 76);
        const directCableNoSplitMigration = MIGRATIONS.find(migration => migration.version === 77);
        const explicitSingleCuttingItemMigration = MIGRATIONS.find(migration => migration.version === 78);
        const configuredCostAnswerSummaryMigration = MIGRATIONS.find(migration => migration.version === 79);
        const completeCableSameItemMigration = MIGRATIONS.find(migration => migration.version === 81);
        const completeCableThisItemMigration = MIGRATIONS.find(migration => migration.version === 82);
        assert.ok(restoreMigration);
        assert.ok(dataAwareMigration);
        assert.ok(formalTechnicalFileMigration);
        assert.ok(formalCoilQueryMigration);
        assert.ok(dataAwareCoilQueryMigration);
        assert.ok(equivalentCablePhrasingMigration);
        assert.ok(explicitUnconfirmedCuttingMigration);
        assert.ok(pollutedFeedbackRegressionMigration);
        assert.ok(noExplicitCuttingMarkingMigration);
        assert.ok(nonCoreReleaseCasesMigration);
        assert.ok(systemReleaseCasesMigration);
        assert.ok(manualSystemChecksMigration);
        assert.ok(calibratedCuttingCheckMigration);
        assert.ok(coilWindingProfileMigration);
        assert.ok(enableCoreAiReleaseGateMigration);
        assert.ok(restoreCoreAiReleaseCasesMigration);
        assert.ok(configuredTemplateCostMigration);
        assert.ok(directCableNoSplitMigration);
        assert.ok(explicitSingleCuttingItemMigration);
        assert.ok(configuredCostAnswerSummaryMigration);
        assert.ok(completeCableSameItemMigration);
        assert.ok(completeCableThisItemMigration);
        db.prepare(`
            INSERT INTO ai_evaluation_cases (
                case_key, title, category, question, evaluator_type, config_json,
                enabled, sort_order, source_type, review_status,
                confidence_score, created_at, updated_at
            ) VALUES (
                'polluted-customer-count', '纠错回归：确定有18个客户？', '反馈',
                '确定有18个客户？', 'rules',
                '{"requiredTerms":[["18个"]]}', 1, 1001, 'feedback',
                'approved', 90, ?, ?
            )
        `).run(FIXED_NOW, FIXED_NOW);
        restoreMigration.up(db);
        restoreMigration.up(db);
        dataAwareMigration.up(db);
        dataAwareMigration.up(db);
        formalTechnicalFileMigration.up(db);
        formalTechnicalFileMigration.up(db);
        formalCoilQueryMigration.up(db);
        formalCoilQueryMigration.up(db);
        dataAwareCoilQueryMigration.up(db);
        dataAwareCoilQueryMigration.up(db);
        equivalentCablePhrasingMigration.up(db);
        equivalentCablePhrasingMigration.up(db);
        explicitUnconfirmedCuttingMigration.up(db);
        explicitUnconfirmedCuttingMigration.up(db);
        pollutedFeedbackRegressionMigration.up(db);
        pollutedFeedbackRegressionMigration.up(db);
        noExplicitCuttingMarkingMigration.up(db);
        noExplicitCuttingMarkingMigration.up(db);
        nonCoreReleaseCasesMigration.up(db);
        nonCoreReleaseCasesMigration.up(db);
        systemReleaseCasesMigration.up(db);
        systemReleaseCasesMigration.up(db);
        manualSystemChecksMigration.up(db);
        manualSystemChecksMigration.up(db);
        calibratedCuttingCheckMigration.up(db);
        calibratedCuttingCheckMigration.up(db);
        coilWindingProfileMigration.up(db);
        coilWindingProfileMigration.up(db);
        enableCoreAiReleaseGateMigration.up(db);
        enableCoreAiReleaseGateMigration.up(db);
        db.prepare(`
            UPDATE ai_evaluation_cases
            SET enabled = 0, release_gate_enabled = 0
            WHERE case_key = 'part-current-price'
        `).run();
        restoreCoreAiReleaseCasesMigration.up(db);
        restoreCoreAiReleaseCasesMigration.up(db);
        configuredTemplateCostMigration.up(db);
        configuredTemplateCostMigration.up(db);
        directCableNoSplitMigration.up(db);
        directCableNoSplitMigration.up(db);
        explicitSingleCuttingItemMigration.up(db);
        explicitSingleCuttingItemMigration.up(db);
        configuredCostAnswerSummaryMigration.up(db);
        configuredCostAnswerSummaryMigration.up(db);
        completeCableSameItemMigration.up(db);
        completeCableSameItemMigration.up(db);
        completeCableThisItemMigration.up(db);
        completeCableThisItemMigration.up(db);

        const systemCases = db.prepare(`
            SELECT case_key, enabled, release_gate_enabled, review_status, source_type
            FROM ai_evaluation_cases
            WHERE source_type = 'system'
            ORDER BY sort_order
        `).all();
        assert.deepEqual(
            systemCases.map(item => item.case_key),
            [
                'part-current-price',
                'coil-all-official-variants',
                'coil-winding-profile',
                'test-report-file-type',
                'test-report-ignore-template-points',
                'customer-quotation-display-order',
                'complete-cable-semantics',
                'cutting-shell-purpose-evidence',
                'configured-template-cost',
            ]
        );
        assert.ok(systemCases.every(item => (
            item.enabled === 1
            && item.release_gate_enabled === 1
            && item.review_status === 'approved'
            && item.source_type === 'system'
        )));
        const testReportCase = db.prepare(`
            SELECT config_json FROM ai_evaluation_cases
            WHERE case_key = 'test-report-file-type'
        `).get();
        assert.deepEqual(
            JSON.parse(testReportCase.config_json).prerequisite,
            {
                type: 'recipe_test_report',
                recipeName: 'V1600-3”-12-180',
            }
        );
        assert.deepEqual(
            JSON.parse(testReportCase.config_json).requiredTools,
            ['get_recipe_technical_files']
        );
        const coilCase = db.prepare(`
            SELECT config_json FROM ai_evaluation_cases
            WHERE case_key = 'coil-all-official-variants'
        `).get();
        assert.deepEqual(
            JSON.parse(coilCase.config_json),
            {
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
            }
        );
        const cableCase = db.prepare(`
            SELECT config_json FROM ai_evaluation_cases
            WHERE case_key = 'complete-cable-semantics'
        `).get();
        const cableRequiredTerms = JSON.parse(cableCase.config_json).requiredTerms[3];
        assert.ok(cableRequiredTerms.includes('共同组成一条'));
        assert.ok(cableRequiredTerms.includes('共同组成同一根'));
        assert.ok(cableRequiredTerms.includes('共同组成同一条'));
        assert.ok(cableRequiredTerms.includes('共同组成这一项'));
        assert.ok(cableRequiredTerms.includes('单一整体业务项'));
        assert.ok(cableRequiredTerms.includes('作为一条成品电缆'));
        assert.ok(JSON.parse(cableCase.config_json).requiredTerms[2].includes('不拆'));
        const windingCase = db.prepare(`
            SELECT enabled, release_gate_enabled, config_json
            FROM ai_evaluation_cases
            WHERE case_key = 'coil-winding-profile'
        `).get();
        const windingConfig = JSON.parse(windingCase.config_json);
        assert.equal(windingCase.enabled, 1);
        assert.equal(windingCase.release_gate_enabled, 1);
        assert.equal(windingConfig.fact.type, 'coil_winding_profile');
        assert.deepEqual(windingConfig.requiredTools, ['search_coils']);
        assert.deepEqual(windingConfig.requiredSourceTables, ['coils']);
        assert.ok(windingConfig.forbiddenTerms.includes('没有绕组数据字段'));
        const configuredCostCase = db.prepare(`
            SELECT question, enabled, release_gate_enabled, config_json
            FROM ai_evaluation_cases
            WHERE case_key = 'configured-template-cost'
        `).get();
        const configuredCostConfig = JSON.parse(configuredCostCase.config_json);
        assert.match(configuredCostCase.question, /V750-大脚板-2寸/);
        assert.equal(configuredCostCase.enabled, 1);
        assert.equal(configuredCostCase.release_gate_enabled, 1);
        assert.equal(configuredCostConfig.fact.type, 'configured_bom_cost');
        assert.deepEqual(configuredCostConfig.requiredTools, ['build_recipe_bom_draft']);
        assert.ok(configuredCostConfig.requiredTerms.some(group => group.includes('12-120')));
        assert.ok(configuredCostConfig.requiredTerms.some(group => group.includes('浮球')));
        const cuttingCase = db.prepare(`
            SELECT config_json FROM ai_evaluation_cases
            WHERE case_key = 'cutting-shell-purpose-evidence'
        `).get();
        assert.ok(
            JSON.parse(cuttingCase.config_json).requiredTerms[1].includes('系统未确认')
        );
        assert.ok(
            JSON.parse(cuttingCase.config_json).requiredTerms[1].includes('无明确标注')
        );
        assert.ok(
            JSON.parse(cuttingCase.config_json).requiredTerms[1].includes('只有1项明确标注')
        );
        assert.equal(
            JSON.parse(cuttingCase.config_json).requiredTerms.some(group => (
                group.includes('切边6mm长螺丝')
                || group.includes('外六角')
                || group.includes('外六角螺丝')
            )),
            false
        );
        assert.deepEqual(
            db.prepare(`
                SELECT title, enabled, review_status, confidence_score
                FROM ai_evaluation_cases
                WHERE case_key = 'feedback-preserved'
            `).get(),
            {
                title: '用户反馈用例',
                enabled: 0,
                review_status: 'pending',
                confidence_score: 70,
            }
        );
        assert.deepEqual(
            db.prepare(`
                SELECT enabled, review_status
                FROM ai_evaluation_cases
                WHERE case_key = 'polluted-customer-count'
            `).get(),
            {
                enabled: 0,
                review_status: 'rejected',
            }
        );
    } finally {
        db.close();
    }
});

test('数据库迁移：订单文件关联升级保留已有归档记录', () => {
    const db = openMemoryDatabase();
    try {
        db.exec(`
            CREATE TABLE factory_files (
                id INTEGER PRIMARY KEY
            );
            CREATE TABLE factory_file_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                target_type TEXT NOT NULL
                    CHECK(target_type IN ('customer', 'quotation', 'recipe', 'knowledge_document')),
                target_id INTEGER NOT NULL,
                relation_role TEXT NOT NULL DEFAULT 'attachment'
                    CHECK(relation_role IN ('attachment', 'technical_reference', 'quotation_source', 'knowledge_source')),
                title TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'manual'
                    CHECK(source IN ('manual', 'ai_chat', 'business_page')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT,
                FOREIGN KEY(file_id) REFERENCES factory_files(id)
            );
            INSERT INTO factory_files (id) VALUES (1);
            INSERT INTO factory_file_links (
                file_id, target_type, target_id, relation_role,
                title, note, source, created_at, updated_at
            ) VALUES (
                1, 'recipe', 9, 'technical_reference',
                '原技术资料', '', 'business_page', '${FIXED_NOW}', '${FIXED_NOW}'
            );
        `);

        addOrderFactoryFileLinks(db);

        const existing = db.prepare('SELECT * FROM factory_file_links WHERE id = 1').get();
        assert.equal(existing.title, '原技术资料');
        assert.doesNotThrow(() => db.prepare(`
            INSERT INTO factory_file_links (
                file_id, target_type, target_id, relation_role,
                title, note, source, created_at, updated_at
            ) VALUES (?, 'order', 12, 'customer_requirement', '', '', 'business_page', ?, ?)
        `).run(1, FIXED_NOW, FIXED_NOW));
        assert.deepEqual(db.pragma('foreign_key_check'), []);
    } finally {
        db.close();
    }
});

test('数据库迁移：v60 旧库无需预先存在订单修订表即可升级订单', () => {
    const db = openMemoryDatabase();
    try {
        db.exec(`
            CREATE TABLE customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                deleted_at TEXT
            );
            CREATE TABLE orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_name TEXT NOT NULL,
                contract_no TEXT DEFAULT '',
                remark TEXT DEFAULT '',
                status TEXT DEFAULT '待采购',
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
            INSERT INTO customers (name) VALUES ('旧客户');
            INSERT INTO orders (customer_name, created_at, updated_at)
            VALUES ('旧客户', '${FIXED_NOW}', '${FIXED_NOW}');
        `);

        const migration = MIGRATIONS.find((item) => item.version === 61);
        assert.ok(migration);
        migration.up(db);

        assert.equal(
            db.prepare(`SELECT customer_id AS customerId FROM orders`).get().customerId,
            1
        );
        assert.equal(
            db.prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'order_revisions'`).get(),
            undefined
        );
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema
            WHERE type = 'index' AND name = 'idx_orders_active_status_created'
        `).get());
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema
            WHERE type = 'index' AND name = 'idx_orders_customer'
        `).get());
        assert.deepEqual(db.pragma('foreign_key_check'), []);
    } finally {
        db.close();
    }
});

test('数据库迁移：第一版历史库升级后与空库 Schema 语义一致', () => {
    const fresh = openMemoryDatabase();
    const legacy = openMemoryDatabase();
    try {
        runMigrations(fresh, { now: FIXED_NOW });
        createFirstVersionFixture(legacy);
        runMigrations(legacy, { now: FIXED_NOW });

        const legacySignature = databaseSignature(legacy);
        const freshSignature = databaseSignature(fresh);
        for (const table of APPLICATION_TABLES) {
            assert.deepEqual(legacySignature[table], freshSignature[table], table);
        }
        assert.equal(legacy.pragma('integrity_check', { simple: true }), 'ok');
        assert.deepEqual(legacy.pragma('foreign_key_check'), []);
        assert.equal(
            legacy.prepare(`SELECT status FROM orders WHERE customer_name = '旧客户'`).get().status,
            '已关闭'
        );
        assert.equal(
            legacy.prepare(`SELECT subcategory FROM parts WHERE model = '550w牛皮纸箱'`).get().subcategory,
            '外包装'
        );
        const coil = legacy.prepare('SELECT stator_variant_id, material, scheme_name FROM coils').get();
        assert.ok(coil.stator_variant_id > 0);
        assert.equal(coil.material, '钢带');
        assert.equal(coil.scheme_name, '正式方案');
    } finally {
        fresh.close();
        legacy.close();
    }
});

test('数据库迁移：已应用迁移的名称或校验和变化时拒绝启动', () => {
    const db = openMemoryDatabase();
    try {
        runMigrations(db, { now: FIXED_NOW });
        db.prepare(`
            UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1
        `).run();
        assert.throws(
            () => runMigrations(db, { now: FIXED_NOW }),
            /迁移 1 校验失败/
        );
    } finally {
        db.close();
    }
});

test('数据库迁移：已发布的 Schema 68 墓碑保持兼容且不丢失历史连接记录', () => {
    const db = openMemoryDatabase();
    const historicalChecksum = '038317dbcec2a522535dd3ed835835762315415bc83420cf0bf11255b11d5fb2';
    try {
        runMigrations(db, { now: FIXED_NOW });
        const applied = db.prepare(`
            SELECT name, checksum FROM schema_migrations WHERE version = 68
        `).get();
        assert.deepEqual(applied, {
            name: 'external_cloud_connections',
            checksum: historicalChecksum,
        });

        db.prepare(`
            INSERT INTO external_connections (
                provider, external_user_id, external_user_name,
                scopes_json, access_token_encrypted, refresh_token_encrypted,
                metadata_json, created_at, updated_at
            ) VALUES ('wps', 'legacy-user', '历史个人账号', '["legacy"]',
                'encrypted-access', 'encrypted-refresh', '{}', ?, ?)
        `).run(FIXED_NOW, FIXED_NOW);

        const second = runMigrations(db, { now: FIXED_NOW });
        const currentVersion = MIGRATIONS.at(-1).version;
        assert.deepEqual(second.appliedVersions, []);
        assert.equal(second.currentVersion, currentVersion);
        assert.equal(db.pragma('user_version', { simple: true }), currentVersion);
        assert.deepEqual(
            db.prepare(`
                SELECT provider, external_user_id, external_user_name
                FROM external_connections
            `).get(),
            {
                provider: 'wps',
                external_user_id: 'legacy-user',
                external_user_name: '历史个人账号',
            }
        );
        assert.ok(db.prepare(`
            SELECT 1 FROM sqlite_schema
            WHERE type = 'index' AND name = 'idx_external_connections_active'
        `).get());

        db.prepare(`
            UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 68
        `).run();
        assert.throws(
            () => runMigrations(db, { now: FIXED_NOW }),
            /迁移 68 校验失败/
        );
    } finally {
        db.close();
    }
});

test('数据库迁移：Schema 69 为历史线圈补充计算计价默认值和套件价约束', () => {
    const db = openMemoryDatabase();
    try {
        db.exec(`
            CREATE TABLE coils (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                spec TEXT NOT NULL,
                sheets INTEGER NOT NULL,
                cost REAL DEFAULT 0
            );
            INSERT INTO coils (spec, sheets, cost)
            VALUES ('历史规格', 120, 88);
        `);
        MIGRATIONS.find(migration => migration.version === 69).up(db);
        const columns = new Set(db.pragma('table_info(coils)').map(column => column.name));
        assert.equal(columns.has('pricing_mode'), true);
        assert.equal(columns.has('kit_price'), true);

        assert.deepEqual(
            db.prepare('SELECT pricing_mode, kit_price, cost FROM coils WHERE id = 1').get(),
            { pricing_mode: 'calculated', kit_price: 0, cost: 88 }
        );
        assert.throws(
            () => db.prepare(`
                UPDATE coils SET pricing_mode = 'unknown' WHERE id = ?
            `).run(1),
            /CHECK constraint failed/
        );
        assert.throws(
            () => db.prepare(`
                UPDATE coils SET kit_price = -1 WHERE id = ?
            `).run(1),
            /CHECK constraint failed/
        );
        assert.throws(
            () => db.prepare(`
                UPDATE coils SET pricing_mode = 'kit', kit_price = 0 WHERE id = 1
            `).run(),
            /kit price must be positive and equal cost/
        );
        assert.throws(
            () => db.prepare(`
                UPDATE coils SET pricing_mode = 'kit', kit_price = 5, cost = 4 WHERE id = 1
            `).run(),
            /kit price must be positive and equal cost/
        );
    } finally {
        db.close();
    }
});

test('数据库迁移：Schema 70 仅对唯一正式方案设默认并回填绑定', () => {
    const db = openMemoryDatabase();
    try {
        runMigrations(db, { now: FIXED_NOW });
        db.exec(`
            DELETE FROM recipes;
            DELETE FROM pump_model_variants;
            DELETE FROM coils;
            DROP INDEX IF EXISTS idx_coils_one_default_scheme;
            DROP INDEX IF EXISTS idx_coils_one_default_legacy_scheme;
        `);
        const templateId = Number(db.prepare(`
            INSERT INTO pump_shell_templates (shell_model, parts_json, created_at, updated_at)
            VALUES ('Schema70 测试泵壳', '[]', ?, ?)
        `).run(FIXED_NOW, FIXED_NOW).lastInsertRowid);
        const statorVariantId = Number(db.prepare(`
            INSERT INTO stator_variants (
                diameter_mm, common_name, material, slot_type, created_at, updated_at
            ) VALUES (13, '13', '钢带', '小眼', ?, ?)
        `).run(FIXED_NOW, FIXED_NOW).lastInsertRowid);
        const uniqueCoilId = Number(db.prepare(`
            INSERT INTO coils (
                stator_variant_id, spec, material, slot_type, sheets,
                scheme_code, scheme_status, is_default, scheme_family_code,
                created_at, updated_at
            ) VALUES (?, '13', '钢带', '小眼', 100,
                'COIL-S70-UNIQUE', 'official', 0, 'S70-UNIQUE', ?, ?)
        `).run(statorVariantId, FIXED_NOW, FIXED_NOW).lastInsertRowid);
        const ambiguousCoilIds = [
            Number(db.prepare(`
                INSERT INTO coils (
                    stator_variant_id, spec, material, slot_type, sheets,
                    scheme_code, scheme_status, is_default, scheme_family_code,
                    created_at, updated_at
                ) VALUES (NULL, '12', '钢带', '小眼', 200,
                    'COIL-S70-A', 'official', 0, 'S70-A', ?, ?)
            `).run(FIXED_NOW, FIXED_NOW).lastInsertRowid),
            Number(db.prepare(`
                INSERT INTO coils (
                    stator_variant_id, spec, material, slot_type, sheets,
                    scheme_code, scheme_status, is_default, scheme_family_code,
                    created_at, updated_at
                ) VALUES (NULL, '12', '钢带', '小眼', 200,
                    'COIL-S70-B', 'official', 0, 'S70-B', ?, ?)
            `).run(FIXED_NOW, FIXED_NOW).lastInsertRowid),
        ];
        const uniqueRecipeId = Number(db.prepare(`
            INSERT INTO recipes (
                name, parts_json, coil_spec, coil_sheets, coil_material, coil_slot_type,
                created_at, updated_at
            ) VALUES ('唯一方案配方', '[]', '13', 100, '钢带', '小眼', ?, ?)
        `).run(FIXED_NOW, FIXED_NOW).lastInsertRowid);
        const ambiguousRecipeId = Number(db.prepare(`
            INSERT INTO recipes (
                name, parts_json, coil_spec, coil_sheets, coil_material, coil_slot_type,
                created_at, updated_at
            ) VALUES ('歧义方案配方', '[]', '12', 200, '钢带', '小眼', ?, ?)
        `).run(FIXED_NOW, FIXED_NOW).lastInsertRowid);
        const ambiguousVariantId = Number(db.prepare(`
            INSERT INTO pump_model_variants (
                model_name, template_id, coil_spec, coil_sheets, coil_material,
                coil_slot_type, created_at, updated_at
            ) VALUES ('歧义常用配置', ?, '12', 200, '钢带', '小眼', ?, ?)
        `).run(templateId, FIXED_NOW, FIXED_NOW).lastInsertRowid);

        MIGRATIONS.find(migration => migration.version === 70).up(db);

        assert.equal(
            db.prepare('SELECT is_default FROM coils WHERE id = ?').get(uniqueCoilId).is_default,
            1
        );
        assert.ok(ambiguousCoilIds.every(id => (
            db.prepare('SELECT is_default FROM coils WHERE id = ?').get(id).is_default === 0
        )));
        assert.equal(
            db.prepare('SELECT coil_id FROM recipes WHERE id = ?').get(uniqueRecipeId).coil_id,
            uniqueCoilId
        );
        assert.equal(
            db.prepare('SELECT coil_id FROM recipes WHERE id = ?').get(ambiguousRecipeId).coil_id,
            null
        );
        assert.equal(
            db.prepare('SELECT coil_id FROM pump_model_variants WHERE id = ?').get(ambiguousVariantId).coil_id,
            null
        );

        db.prepare('UPDATE coils SET is_default = 1 WHERE id = ?').run(ambiguousCoilIds[0]);
        assert.throws(
            () => db.prepare('UPDATE coils SET is_default = 1 WHERE id = ?').run(ambiguousCoilIds[1]),
            /UNIQUE constraint failed/
        );
    } finally {
        db.close();
    }
});

test('数据库迁移：Schema 71 安全回填唯一 legacy 方案族且不猜测歧义记录', () => {
    const db = openMemoryDatabase();
    try {
        runMigrations(db, { now: FIXED_NOW });
        db.exec(`
            DELETE FROM recipes;
            DELETE FROM pump_model_variants;
            DELETE FROM coils;
        `);
        const templateId = Number(db.prepare(`
            INSERT INTO pump_shell_templates (shell_model, parts_json, created_at, updated_at)
            VALUES ('Schema71 测试泵壳', '[]', ?, ?)
        `).run(FIXED_NOW, FIXED_NOW).lastInsertRowid);
        const insertCoil = db.prepare(`
            INSERT INTO coils (
                spec, sheets, material, slot_type, scheme_code, scheme_status,
                scheme_family_code, pricing_mode, created_at, updated_at
            ) VALUES (?, ?, '钢带', '小眼', ?, 'official', ?, 'calculated', ?, ?)
        `);
        const boundCoilId = Number(insertCoil.run('14', 120, 'S71-14-120', 'LEGACY-14', FIXED_NOW, FIXED_NOW).lastInsertRowid);
        insertCoil.run('14', 160, 'S71-14-160', 'LEGACY-14', FIXED_NOW, FIXED_NOW);
        insertCoil.run('15', 120, 'S71-15-A', 'LEGACY-15-A', FIXED_NOW, FIXED_NOW);
        insertCoil.run('15', 160, 'S71-15-B', 'LEGACY-15-B', FIXED_NOW, FIXED_NOW);
        insertCoil.run('16', 140, 'S71-16-EXACT', 'LEGACY-16', FIXED_NOW, FIXED_NOW);

        const insertRecipe = db.prepare(`
            INSERT INTO recipes (
                name, parts_json, coil_id, coil_scheme_family_code,
                coil_spec, coil_sheets, coil_material, coil_slot_type,
                created_at, updated_at
            ) VALUES (?, '[]', ?, '', ?, ?, '钢带', '小眼', ?, ?)
        `);
        const boundRecipeId = Number(insertRecipe.run('已绑定精确方案', boundCoilId, '14', 120, FIXED_NOW, FIXED_NOW).lastInsertRowid);
        const uniqueLegacyRecipeId = Number(insertRecipe.run('唯一 legacy 外推', null, '14', 140, FIXED_NOW, FIXED_NOW).lastInsertRowid);
        const ambiguousLegacyRecipeId = Number(insertRecipe.run('多个 legacy 族', null, '15', 140, FIXED_NOW, FIXED_NOW).lastInsertRowid);
        const exactUnboundRecipeId = Number(insertRecipe.run('存在精确候选', null, '16', 140, FIXED_NOW, FIXED_NOW).lastInsertRowid);
        const variantId = Number(db.prepare(`
            INSERT INTO pump_model_variants (
                model_name, template_id, coil_scheme_family_code,
                coil_spec, coil_sheets, coil_material, coil_slot_type,
                created_at, updated_at
            ) VALUES ('唯一 legacy 常用配置', ?, '', '14', 140, '钢带', '小眼', ?, ?)
        `).run(templateId, FIXED_NOW, FIXED_NOW).lastInsertRowid);

        MIGRATIONS.find(migration => migration.version === 71).up(db);

        assert.equal(db.prepare('SELECT coil_scheme_family_code value FROM recipes WHERE id = ?').get(boundRecipeId).value, 'LEGACY-14');
        assert.equal(db.prepare('SELECT coil_scheme_family_code value FROM recipes WHERE id = ?').get(uniqueLegacyRecipeId).value, 'LEGACY-14');
        assert.equal(db.prepare('SELECT coil_scheme_family_code value FROM recipes WHERE id = ?').get(ambiguousLegacyRecipeId).value, '');
        assert.equal(db.prepare('SELECT coil_scheme_family_code value FROM recipes WHERE id = ?').get(exactUnboundRecipeId).value, '');
        assert.equal(db.prepare('SELECT coil_scheme_family_code value FROM pump_model_variants WHERE id = ?').get(variantId).value, 'LEGACY-14');
    } finally {
        db.close();
    }
});

test('数据库迁移：核心外键和 CHECK 约束阻止非法业务数据', () => {
    const db = openMemoryDatabase();
    try {
        runMigrations(db, { now: FIXED_NOW });
        assert.throws(
            () => db.prepare(`INSERT INTO parts (model, price, stock) VALUES ('坏零件', -1, 0)`).run(),
            /CHECK constraint failed/
        );
        assert.throws(
            () => db.prepare(`INSERT INTO orders (customer_name, status) VALUES ('客户', '任意状态')`).run(),
            /CHECK constraint failed/
        );
        assert.throws(
            () => db.prepare(`
                INSERT INTO quotations (customer_id, status) VALUES (999, '报价中')
            `).run(),
            /FOREIGN KEY constraint failed/
        );
    } finally {
        db.close();
    }
});

test('数据库迁移：包装语义修复重建明细但不改变历史保存成本', () => {
    const db = openMemoryDatabase();
    try {
        runMigrations(db, { now: FIXED_NOW });
        const wrongPacking = [{
            model: '850w上下泡沫',
            supplier: '山市泡沫厂',
            qty: 1,
            packagingMaterial: '纸箱',
        }];
        const wrongParts = [{
            model: '850w上下泡沫',
            name: '850w上下泡沫（纸箱）',
            supplier: '山市泡沫厂',
            qty: 1,
            snapshotPrice: 2.6,
            packagingMaterial: '纸箱',
        }];
        db.prepare(`
            INSERT INTO recipes (
                name, parts_json, packing_parts_json, saved_total_cost,
                saved_cost_details, assembly_wage, packing_wage,
                surface_treatment_mode, surface_treatment_cost, management_fee
            ) VALUES (?, ?, ?, 2.6, '旧明细', 0, 0, 'none', 0, 0)
        `).run('包装修复测试', JSON.stringify(wrongParts), JSON.stringify(wrongPacking));

        repairRecipePackagingSnapshots(db);
        const row = db.prepare(`
            SELECT parts_json, packing_parts_json, saved_total_cost, saved_cost_details
            FROM recipes WHERE name = '包装修复测试'
        `).get();
        const packing = JSON.parse(row.packing_parts_json)[0];
        const part = JSON.parse(row.parts_json)[0];
        assert.equal(packing.packagingMaterial, '泡沫');
        assert.equal(packing.packingRole, 'foam');
        assert.equal(part.name, '850w上下泡沫（泡沫）');
        assert.equal(row.saved_total_cost, 2.6);
        assert.match(row.saved_cost_details, /850w上下泡沫（泡沫）/);
    } finally {
        db.close();
    }
});

test('数据库迁移：活动订单外包装估算绑定正式包材并保留成本和采购进度', () => {
    const db = openMemoryDatabase();
    try {
        runMigrations(db, { now: FIXED_NOW });
        const part = db.prepare(`
            INSERT INTO parts (
                model, category, subcategory, price, supplier, stock, remark
            ) VALUES ('550w牛皮纸箱', '包装', '外包装', 5, '广发纸箱', 0, '')
        `).run();
        const recipe = db.prepare(`
            INSERT INTO recipes (
                name, parts_json, packing_parts_json, saved_total_cost, saved_cost_details
            ) VALUES (?, '[]', ?, 0, '[]')
        `).run('V750', JSON.stringify([{
            model: '550w牛皮纸箱',
            supplier: '广发纸箱',
            qty: 1,
            packagingMaterial: '牛皮纸箱',
            packingRole: 'container',
        }]));
        const estimate = {
            model: '外包装估算',
            name: '外包装估算（牛皮纸箱）',
            supplier: '',
            qty: 1,
            snapshotPrice: 4,
            packagingMaterial: '牛皮纸箱',
            costSource: 'manual',
        };
        const purchase = {
            model: '外包装估算',
            name: '外包装估算（牛皮纸箱）',
            supplier: '',
            plannedQty: 30,
            orderedQty: 30,
            receivedQty: 0,
            stockedQty: 0,
            purchased: true,
            identityKey: 'model:外包装估算|supplier:',
        };
        db.prepare(`
            INSERT INTO orders (
                customer_name, status, items_json, purchase_list_json, todos_json
            ) VALUES (?, '采购中', ?, ?, ?)
        `).run(
            '测试客户',
            JSON.stringify([{
                recipeId: Number(recipe.lastInsertRowid),
                recipeName: 'V750',
                qty: 30,
                unitCost: 200,
                unitPrice: 230,
                partsJson: JSON.stringify([estimate]),
            }]),
            JSON.stringify([purchase]),
            JSON.stringify([{
                id: 'todo-1',
                supplier: '',
                description: '联系【】采购：外包装估算×30',
                done: false,
            }])
        );

        const result = repairOrderPackagingEstimates(db, { now: FIXED_NOW });
        const row = db.prepare(`SELECT * FROM orders WHERE customer_name = '测试客户'`).get();
        const repairedPart = JSON.parse(JSON.parse(row.items_json)[0].partsJson)[0];
        const repairedPurchase = JSON.parse(row.purchase_list_json)[0];
        const repairedTodo = JSON.parse(row.todos_json)[0];

        assert.deepEqual(result, { repairedOrders: 1, repairedItems: 1 });
        assert.equal(repairedPart.model, '550w牛皮纸箱');
        assert.equal(repairedPart.partId, Number(part.lastInsertRowid));
        assert.equal(repairedPart.snapshotPrice, 4);
        assert.equal(repairedPurchase.partId, Number(part.lastInsertRowid));
        assert.equal(repairedPurchase.identityKey, `part:${part.lastInsertRowid}`);
        assert.equal(repairedPurchase.orderedQty, 30);
        assert.equal(repairedTodo.supplier, '广发纸箱');
        assert.match(repairedTodo.description, /550w牛皮纸箱/);
    } finally {
        db.close();
    }
});

test('数据库迁移：旧 AI 纠正规则升级为结构化规则并撤销历史自动批准', () => {
    const db = openMemoryDatabase();
    try {
        db.exec(`
            CREATE TABLE ai_answer_feedback (id INTEGER PRIMARY KEY);
            CREATE TABLE ai_evaluation_cases (
                id INTEGER PRIMARY KEY,
                source_type TEXT NOT NULL,
                source_feedback_id INTEGER,
                review_status TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                review_note TEXT DEFAULT '',
                reviewed_at TEXT,
                generation_note TEXT DEFAULT ''
            );
            CREATE TABLE factory_ai_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_feedback_id INTEGER UNIQUE,
                title TEXT NOT NULL,
                trigger_text TEXT NOT NULL DEFAULT '',
                instruction TEXT NOT NULL,
                scope_type TEXT NOT NULL DEFAULT 'global',
                priority INTEGER NOT NULL DEFAULT 100,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE knowledge_entries (
                id INTEGER PRIMARY KEY,
                source_table TEXT NOT NULL
            );
            CREATE TABLE knowledge_embeddings (
                id INTEGER PRIMARY KEY,
                entry_id INTEGER NOT NULL
            );
            INSERT INTO ai_answer_feedback (id) VALUES (8);
            INSERT INTO ai_evaluation_cases (
                id, source_type, source_feedback_id, review_status, enabled,
                review_note, reviewed_at, generation_note
            ) VALUES (
                18, 'feedback', 8, 'approved', 1, '',
                '2026-08-01T00:00:00.000Z', '证据足够，自动纳入回归'
            );
            INSERT INTO factory_ai_rules (
                source_feedback_id, title, trigger_text, instruction,
                scope_type, priority, status, created_at, updated_at
            ) VALUES (
                8, '旧规则', '附件是什么', '正确分类是性能测试报告。',
                'global', 100, 'active',
                '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
            );
            INSERT INTO knowledge_entries (id, source_table)
            VALUES (28, 'factory_ai_rules'), (29, 'parts');
            INSERT INTO knowledge_embeddings (id, entry_id)
            VALUES (38, 28), (39, 29);
        `);
        MIGRATIONS.find(migration => migration.version === 74).up(db);
        MIGRATIONS.find(migration => migration.version === 75).up(db);
        const rule = db.prepare('SELECT * FROM factory_ai_rules').get();
        const evaluationCase = db.prepare('SELECT * FROM ai_evaluation_cases WHERE id = 18').get();
        assert.equal(rule.scope_type, 'global');
        assert.equal(rule.domains_json, '[]');
        assert.equal(rule.rule_type, 'answer_correction');
        assert.equal(rule.rule_version, 1);
        assert.equal(rule.evaluation_case_id, 18);
        assert.equal(rule.conflict_key.length, 24);
        assert.equal(rule.conflict_group, `legacy:${rule.id}`);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM knowledge_entries WHERE source_table = 'factory_ai_rules'").get().count, 0);
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM knowledge_embeddings WHERE entry_id = 28').get().count, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM knowledge_entries WHERE source_table = 'parts'").get().count, 1);
        assert.equal(evaluationCase.review_status, 'pending');
        assert.equal(evaluationCase.enabled, 0);
        assert.equal(evaluationCase.reviewed_at, null);
        assert.match(evaluationCase.generation_note, /等待人工确认/);
    } finally {
        db.close();
    }
});
