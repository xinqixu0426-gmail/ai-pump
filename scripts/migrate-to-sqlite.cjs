/**
 * NocoDB JSON → SQLite 迁移脚本
 * 用法：node scripts/migrate-to-sqlite.cjs
 * 
 * 前置: 先运行 node scripts/db-export.cjs 生成 scripts/db-backup/*.json
 * 输出: 根目录生成 pump.db
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'pump.db');
const BACKUP_DIR = path.join(__dirname, 'db-backup');

// 如果已存在，先备份旧数据库
if (fs.existsSync(DB_PATH)) {
    const backup = DB_PATH + '.bak.' + Date.now();
    fs.copyFileSync(DB_PATH, backup);
    console.log(`⚠️  已存在的 pump.db 已备份为 ${path.basename(backup)}`);
    fs.unlinkSync(DB_PATH);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── 建表 ──────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS parts (
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

    CREATE INDEX IF NOT EXISTS idx_parts_model ON parts(model);
    CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category);

    CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        spec TEXT DEFAULT '',
        parts_json TEXT DEFAULT '[]',
        saved_total_cost REAL DEFAULT 0,
        saved_cost_details TEXT DEFAULT '[]',
        created_at TEXT,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
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

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

    CREATE TABLE IF NOT EXISTS coils (
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

    CREATE INDEX IF NOT EXISTS idx_coils_spec_sheets ON coils(spec, sheets);

    CREATE TABLE IF NOT EXISTS config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT
    );
`);

console.log('✅ 数据库表已创建\n');

// ── 读取备份数据 ──────────────────────────────────

function loadBackup(name) {
    const filePath = path.join(BACKUP_DIR, `${name}.json`);
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  跳过 ${name}（备份文件不存在）`);
        return [];
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ── 导入 Parts ────────────────────────────────────

const parts = loadBackup('parts');
if (parts.length > 0) {
    const insertPart = db.prepare(`
        INSERT INTO parts (id, model, category, price, supplier, stock, remark, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const importParts = db.transaction((records) => {
        for (const r of records) {
            insertPart.run(
                r.Id,
                r.型号 || '',
                r.类别 || '其他',
                r.单价 ?? 0,
                r.供应商 || '-',
                r.库存 ?? 0,
                r.备注 || '',
                r.CreatedAt || new Date().toISOString(),
                r.UpdatedAt || new Date().toISOString()
            );
        }
    });
    importParts(parts);
    console.log(`✅ parts: ${parts.length} 条记录已导入`);
}

// ── 导入 Recipes ──────────────────────────────────

const recipes = loadBackup('recipes');
if (recipes.length > 0) {
    const insertRecipe = db.prepare(`
        INSERT INTO recipes (id, name, spec, parts_json, saved_total_cost, saved_cost_details, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const importRecipes = db.transaction((records) => {
        for (const r of records) {
            insertRecipe.run(
                r.Id,
                r.配方名称 || r.name || '',
                r.规格 || r.spec || '',
                r.配件JSON || r.parts_json || '[]',
                r.保存时总成本 ?? r.saved_total_cost ?? 0,
                r.保存时成本明细 || r.saved_cost_details || '[]',
                r.CreatedAt || new Date().toISOString(),
                r.UpdatedAt || new Date().toISOString()
            );
        }
    });
    importRecipes(recipes);
    console.log(`✅ recipes: ${recipes.length} 条记录已导入`);
}

// ── 导入 Orders ───────────────────────────────────

const orders = loadBackup('orders');
if (orders.length > 0) {
    const insertOrder = db.prepare(`
        INSERT INTO orders (id, customer_name, contract_no, remark, status, items_json, purchase_list_json, todos_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const importOrders = db.transaction((records) => {
        for (const r of records) {
            insertOrder.run(
                r.Id,
                r.客户名称 || '',
                r.合同号 || '',
                r.备注 || '',
                r.订单状态 || '待采购',
                r.型号列表JSON || '[]',
                r.采购清单JSON || '[]',
                r.采购TodoJSON || '[]',
                r.CreatedAt || new Date().toISOString(),
                r.UpdatedAt || new Date().toISOString()
            );
        }
    });
    importOrders(orders);
    console.log(`✅ orders: ${orders.length} 条记录已导入`);
}

// ── 导入 Coils ────────────────────────────────────

const coils = loadBackup('coils');
if (coils.length > 0) {
    const insertCoil = db.prepare(`
        INSERT INTO coils (id, spec, sheets, unit_price, wire_weight, copper_base, coil_fee, rotor_fee, cost, default_wire_gauge, default_capacitor, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const importCoils = db.transaction((records) => {
        for (const r of records) {
            insertCoil.run(
                r.Id,
                r.规格 || '',
                parseInt(r.片数) || 0,
                parseFloat(r.单价) || 0,
                parseFloat(r.默认线重) || 0,
                parseFloat(r.铜价基数) || 0,
                parseFloat(r.线圈加工费) || 0,
                parseFloat(r.转子加工费) || 0,
                parseFloat(r.成本) || 0,
                r.默认线径 || null,
                r.默认电容_uf || null,
                r.CreatedAt || new Date().toISOString(),
                r.UpdatedAt || new Date().toISOString()
            );
        }
    });
    importCoils(coils);
    console.log(`✅ coils: ${coils.length} 条记录已导入`);
}

// ── 导入 Config ───────────────────────────────────

const config = loadBackup('config');
if (config.length > 0) {
    const insertConfig = db.prepare(`
        INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)
    `);
    const importConfig = db.transaction((records) => {
        for (const r of records) {
            if (r['ai-system-prompt']) {
                insertConfig.run('ai-system-prompt', r['ai-system-prompt']);
            }
        }
    });
    importConfig(config);
    console.log(`✅ config: ${config.length} 条记录已导入`);
}

// ── 验证 ──────────────────────────────────────────

console.log('\n📊 数据验证:');
const tables = ['parts', 'recipes', 'orders', 'coils', 'config'];
for (const t of tables) {
    const count = db.prepare(`SELECT count(*) as cnt FROM ${t}`).get();
    console.log(`   ${t}: ${count.cnt} 条`);
}

// 抽样检查
const samplePart = db.prepare('SELECT * FROM parts LIMIT 1').get();
if (samplePart) {
    console.log(`\n📋 Parts 抽样: id=${samplePart.id}, model="${samplePart.model}", price=${samplePart.price}, stock=${samplePart.stock}`);
}
const sampleRecipe = db.prepare('SELECT * FROM recipes LIMIT 1').get();
if (sampleRecipe) {
    console.log(`📋 Recipes 抽样: id=${sampleRecipe.id}, name="${sampleRecipe.name}", cost=${sampleRecipe.saved_total_cost}`);
}
const sampleCoil = db.prepare('SELECT * FROM coils LIMIT 1').get();
if (sampleCoil) {
    console.log(`📋 Coils 抽样: id=${sampleCoil.id}, spec="${sampleCoil.spec}", sheets=${sampleCoil.sheets}, cost=${sampleCoil.cost}`);
}

db.close();
console.log(`\n🎉 迁移完成！数据库文件: ${DB_PATH}`);
