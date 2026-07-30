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

test('数据库迁移：第一版历史库升级后与空库 Schema 语义一致', () => {
    const fresh = openMemoryDatabase();
    const legacy = openMemoryDatabase();
    try {
        runMigrations(fresh, { now: FIXED_NOW });
        createFirstVersionFixture(legacy);
        runMigrations(legacy, { now: FIXED_NOW });

        assert.deepEqual(databaseSignature(legacy), databaseSignature(fresh));
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
