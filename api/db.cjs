/**
 * 数据库初始化 + 共享辅助函数
 */
const path = require('path');
const Database = require('better-sqlite3');

// ── SQLite 初始化 ──
const DB_PATH = path.join(__dirname, '..', 'pump.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('wal_checkpoint(TRUNCATE)'); // 启动时清理 WAL，避免 WAL 文件无限增长

// ── 自动建表 & 迁移 ──
db.exec(`
    CREATE TABLE IF NOT EXISTS pump_shell_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shell_model TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        parts_json TEXT DEFAULT '[]',
        created_at TEXT,
        updated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pst_model ON pump_shell_templates(shell_model);

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

    CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        spec TEXT,
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

    CREATE TABLE IF NOT EXISTS rotor_drawings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL UNIQUE,
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
`);

// seed 默认管理费
const existing = db.prepare('SELECT key FROM system_settings WHERE key = ?').get('management_fee');
if (!existing) {
    db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('management_fee', '5', new Date().toISOString());
}

// recipes 表新增结构化列（幂等 ALTER）
const recipeAlterColumns = [
    ['template_id', 'INTEGER'],
    ['coil_spec', "TEXT DEFAULT ''"],
    ['coil_sheets', 'INTEGER DEFAULT 0'],
    ['has_float', 'INTEGER DEFAULT 0'],
    ['float_wire', "TEXT DEFAULT ''"],
    ['has_cable', 'INTEGER DEFAULT 0'],
    ['cable_length', 'REAL DEFAULT 0'],
    ['cable_wire', "TEXT DEFAULT ''"],
    ['box_type', "TEXT DEFAULT ''"],
    ['extra_parts_json', "TEXT DEFAULT '[]'"],
    ['assembly_wage', 'REAL DEFAULT 0'],
    ['packing_wage', 'REAL DEFAULT 0'],
    ['painting_wage', 'REAL'],
    ['management_fee', 'REAL DEFAULT 0'],
    ['custom_barrel_length', 'REAL'],
];
for (const [col, type] of recipeAlterColumns) {
    try { db.exec(`ALTER TABLE recipes ADD COLUMN ${col} ${type}`); } catch { /* already exists */ }
}
try { db.exec(`ALTER TABLE parts ADD COLUMN remark TEXT DEFAULT ''`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN rotor_params_json TEXT DEFAULT '{}'`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN assembly_wage REAL DEFAULT 0`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN packing_wage REAL DEFAULT 0`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN painting_wage REAL`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE rotor_drawings ADD COLUMN linked_pump_model TEXT DEFAULT ''`); } catch { /* already exists */ }

// ── Row Adapters ──

function partRow(r) {
    if (!r) return r;
    return {
        Id: r.id, model: r.model, category: r.category, price: r.price,
        supplier: r.supplier, stock: r.stock, notes: r.remark || '',
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function recipeRow(r) {
    if (!r) return r;
    return {
        Id: r.id, name: r.name, spec: r.spec, parts_json: r.parts_json,
        saved_total_cost: r.saved_total_cost,
        saved_cost_details: r.saved_cost_details,
        template_id: r.template_id, coil_spec: r.coil_spec, coil_sheets: r.coil_sheets,
        has_float: r.has_float, float_wire: r.float_wire, has_cable: r.has_cable,
        cable_length: r.cable_length, cable_wire: r.cable_wire, box_type: r.box_type,
        custom_barrel_length: r.custom_barrel_length, extra_parts_json: r.extra_parts_json,
        assembly_wage: r.assembly_wage, packing_wage: r.packing_wage, painting_wage: r.painting_wage,
        management_fee: r.management_fee,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function templateRow(r) {
    if (!r) return r;
    return {
        Id: r.id, shell_model: r.shell_model, description: r.description || '',
        parts_json: r.parts_json || '[]', rotor_params_json: r.rotor_params_json || '{}',
        assembly_wage: r.assembly_wage || 0, packing_wage: r.packing_wage || 0,
        painting_wage: r.painting_wage != null ? r.painting_wage : null,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function orderRow(r) {
    if (!r) return r;
    return {
        Id: r.id, customerName: r.customer_name, contractNo: r.contract_no,
        remark: r.remark, status: r.status, itemsJson: r.items_json,
        purchaseListJson: r.purchase_list_json, todosJson: r.todos_json,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function coilRow(r) {
    if (!r) return r;
    return {
        Id: r.id, spec: r.spec, unitPrice: r.unit_price, sheets: r.sheets,
        wireWeight: r.wire_weight, copperBase: r.copper_base,
        coilFee: r.coil_fee, rotorFee: r.rotor_fee,
        cost: r.cost, defaultCapacitor: r.default_capacitor, defaultWireGauge: r.default_wire_gauge,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}

// ── 数据访问层 ──
function dbGetAllParts() { return db.prepare('SELECT * FROM parts').all().map(partRow); }
function dbGetAllRecipes() { return db.prepare('SELECT * FROM recipes').all().map(recipeRow); }
function dbGetAllOrders() { return db.prepare('SELECT * FROM orders').all().map(orderRow); }
function dbGetAllCoils() { return db.prepare('SELECT * FROM coils').all().map(coilRow); }
function dbGetAllTemplates() { return db.prepare('SELECT * FROM pump_shell_templates ORDER BY shell_model').all().map(templateRow); }

function extractPartFields(body) {
    return {
        model: body.model || '',
        category: body.category || '其他',
        price: body.price ?? 0,
        supplier: body.supplier || '-',
        stock: body.stock ?? 0,
        remark: body.notes || body.remark || '',
    };
}



// ⚠️ SYNC REQUIRED: 本组成本计算逻辑必须与 src/utils/costCalculator.ts 中的主逻辑保持高度一致！
// 若修改了精确匹配/回退机制，请务必同步修改前端代码。
function calculateRecipeCost(parts, partsCache, partsByModel) {
    let totalCost = 0;
    const details = [];
    const missingParts = [];
    parts.forEach(p => {
        const suppliers = partsByModel[p.model] || [];
        const match = suppliers.find(s => (s.supplier || '').trim() === (p.supplier || '').trim());
        let price = 0, source = '';
        if (match && p.supplier) { price = match.price; source = '精确匹配'; }
        else if (suppliers.length > 0) { const fb = suppliers.reduce((min, c) => c.price < min.price ? c : min, suppliers[0]); price = fb.price; source = '型号回退(取最低价)'; }
        else { missingParts.push(p.model); source = '未找到'; }
        const subtotal = price * p.qty;
        totalCost += subtotal;
        details.push({ name: p.name || p.model, model: p.model, supplier: p.supplier || '-', price: parseFloat(price).toFixed(2), qty: p.qty, subtotal: subtotal.toFixed(2), source });
    });
    return { totalCost: totalCost.toFixed(2), itemCount: parts.length, details, missingParts };
}

function getSetting(key) {
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
    return row ? row.value : null;
}
function setSetting(key, value) {
    const now = new Date().toISOString();
    db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, String(value), now);
}

/**
 * 安全执行 UPDATE — 列名经正则校验 + 表名走白名单
 * 从根源杜绝 SQL 注入：所有动态 UPDATE 必须走此函数
 * @param {string} table - 表名（需在白名单中）
 * @param {number} id - 记录 ID
 * @param {Record<string, any>} updates - { column_name: value }，undefined 值自动跳过
 */
const SAFE_TABLES = new Set(['parts', 'recipes', 'orders', 'coils', 'pump_shell_templates', 'system_settings', 'rotor_drawings']);
const SAFE_COL_RE = /^[a-z][a-z0-9_]*$/;

function safeUpdate(table, id, updates) {
    if (!SAFE_TABLES.has(table)) throw new Error(`safeUpdate: 非法表名 "${table}"`);
    const sets = [];
    const vals = [];
    for (const [col, val] of Object.entries(updates)) {
        if (val === undefined) continue;
        if (!SAFE_COL_RE.test(col)) throw new Error(`safeUpdate: 非法列名 "${col}"`);
        sets.push(`${col} = ?`);
        vals.push(val);
    }
    if (sets.length === 0) return;
    // 审计日志：记录更新前的值
    const oldRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    sets.push('updated_at = ?');
    vals.push(new Date().toISOString());
    vals.push(id);
    db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    // 异步写审计日志，不阻塞主逻辑
    try {
        writeAuditLog('UPDATE', table, id, oldRow ? JSON.stringify(oldRow) : null, JSON.stringify(updates));
    } catch { /* 审计日志写入失败不应阻断业务 */ }
}

/**
 * 订单字段更新助手 — 替代 ai.cjs 中 5 处 copy-paste 的订单更新样板
 * @param {number} orderId
 * @param {object} fields - { status?, items_json?, purchase_list_json?, todos_json? }
 */
function updateOrderFields(orderId, fields) {
    safeUpdate('orders', orderId, fields);
}

// ── P1.7: loadPartsData 缓存 ──
let _partsDataCache = null;
let _partsDataCacheTime = 0;
const PARTS_CACHE_TTL = 10_000; // 10秒缓存

function loadPartsData() {
    const now = Date.now();
    if (_partsDataCache && (now - _partsDataCacheTime) < PARTS_CACHE_TTL) {
        return _partsDataCache;
    }
    const records = db.prepare('SELECT * FROM parts').all();
    const partsCache = {};
    const partsByModel = {};
    records.forEach(record => {
        const model = record.model;
        const price = record.price || 0;
        const supplier = record.supplier || '-';
        partsCache[model] = { price, supplier, category: record.category || '其他' };
        if (!partsByModel[model]) partsByModel[model] = [];
        partsByModel[model].push({ id: record.id, supplier, price });
    });
    _partsDataCache = { partsCache, partsByModel };
    _partsDataCacheTime = now;
    return _partsDataCache;
}

/** 使 loadPartsData 缓存失效（写入零件后调用） */
function invalidatePartsCache() {
    _partsDataCache = null;
    _partsDataCacheTime = 0;
}

// ── P4.22: 审计日志 ──
const _auditStmt = db.prepare('INSERT INTO audit_log (action, table_name, record_id, old_value, new_value, user, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
function writeAuditLog(action, tableName, recordId, oldValue, newValue, user = 'system') {
    _auditStmt.run(action, tableName, recordId, oldValue, newValue, user, new Date().toISOString());
}

// ── P4.20: 数据库自动备份 ──
const fsDb = require('fs');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const MAX_BACKUPS = 7;

function runBackup() {
    try {
        if (!fsDb.existsSync(BACKUP_DIR)) fsDb.mkdirSync(BACKUP_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupPath = path.join(BACKUP_DIR, `pump_${stamp}.db`);
        db.exec(`VACUUM INTO '${backupPath.replace(/\\/g, '/')}'`);
        console.log(`[备份] 数据库已备份到 ${backupPath}`);
        // 清理旧备份，只保留最近 MAX_BACKUPS 个
        const files = fsDb.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('pump_') && f.endsWith('.db'))
            .sort().reverse();
        for (const old of files.slice(MAX_BACKUPS)) {
            fsDb.unlinkSync(path.join(BACKUP_DIR, old));
            console.log(`[备份] 已清理旧备份: ${old}`);
        }
    } catch (err) { console.error('[备份] 失败:', err.message); }
}

function scheduleBackup() {
    // 每天凌晨 3:00 北京时间备份
    const now = new Date();
    const target = new Date(now.getTime() + 8 * 3600 * 1000);
    target.setUTCHours(19, 0, 0, 0); // 03:00 BJT = 19:00 UTC (前一天)
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    const delay = target.getTime() - now.getTime();
    console.log(`[备份] 下次备份: ${target.toISOString()} (${(delay / 3600000).toFixed(1)}h 后)`);
    setTimeout(() => {
        runBackup();
        scheduleBackup();
    }, delay);
}
// 启动时立即备份一次，然后开始定时
runBackup();
scheduleBackup();

module.exports = {
    db,
    partRow, recipeRow, templateRow, orderRow, coilRow,
    dbGetAllParts, dbGetAllRecipes, dbGetAllOrders, dbGetAllCoils, dbGetAllTemplates,
    extractPartFields, loadPartsData, calculateRecipeCost,
    getSetting, setSetting,
    updateOrderFields, invalidatePartsCache, safeUpdate,
    writeAuditLog, runBackup,
};
