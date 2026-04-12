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
];
for (const [col, type] of recipeAlterColumns) {
    try { db.exec(`ALTER TABLE recipes ADD COLUMN ${col} ${type}`); } catch { /* already exists */ }
}
try { db.exec(`ALTER TABLE parts ADD COLUMN remark TEXT DEFAULT ''`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN rotor_params_json TEXT DEFAULT '{}'`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN assembly_wage REAL DEFAULT 0`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN packing_wage REAL DEFAULT 0`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN painting_wage REAL`); } catch { /* already exists */ }

// ── Row Adapters ──

function partRow(r) {
    if (!r) return r;
    return {
        Id: r.id, model: r.model, category: r.category, price: r.price, supplier: r.supplier, stock: r.stock,
        notes: r.remark || '',
        '型号': r.model, '类别': r.category, '单价': r.price, '供应商': r.supplier, '库存': r.stock, '备注': r.remark || '',
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function recipeRow(r) {
    if (!r) return r;
    return {
        Id: r.id, name: r.name, spec: r.spec, parts_json: r.parts_json,
        '配方名称': r.name, '规格': r.spec, '配件JSON': r.parts_json,
        saved_total_cost: r.saved_total_cost, '保存时总成本': r.saved_total_cost,
        saved_cost_details: r.saved_cost_details, '保存时成本明细': r.saved_cost_details,
        template_id: r.template_id || null,
        coil_spec: r.coil_spec || '', coil_sheets: r.coil_sheets || 0,
        has_float: r.has_float || 0, float_wire: r.float_wire || '',
        has_cable: r.has_cable || 0, cable_length: r.cable_length || 0, cable_wire: r.cable_wire || '',
        box_type: r.box_type || '', extra_parts_json: r.extra_parts_json || '[]',
        assembly_wage: r.assembly_wage || 0, packing_wage: r.packing_wage || 0,
        painting_wage: r.painting_wage != null ? r.painting_wage : null,
        management_fee: r.management_fee || 0,
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
        Id: r.id, '客户名称': r.customer_name, '合同号': r.contract_no, '备注': r.remark,
        '订单状态': r.status, '型号列表JSON': r.items_json,
        '采购清单JSON': r.purchase_list_json, '采购TodoJSON': r.todos_json,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function coilRow(r) {
    if (!r) return r;
    return {
        Id: r.id, '规格': r.spec, '单价': r.unit_price, '片数': r.sheets,
        '默认线重': r.wire_weight, '铜价基数': r.copper_base,
        '线圈加工费': r.coil_fee, '转子加工费': r.rotor_fee,
        '成本': r.cost, '默认电容_uf': r.default_capacitor, '默认线径': r.default_wire_gauge,
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
        model: body.model || body.型号 || '',
        category: body.category || body.类别 || '其他',
        price: body.price ?? body.单价 ?? 0,
        supplier: body.supplier || body.供应商 || '-',
        stock: body.stock ?? body.库存 ?? 0,
        remark: body.notes || body.remark || body.备注 || '',
    };
}



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
 * 订单字段更新助手 — 替代 ai.cjs 中 5 处 copy-paste 的订单更新样板
 * @param {number} orderId
 * @param {object} fields - { status?, items_json?, purchase_list_json?, todos_json? }
 */
function updateOrderFields(orderId, fields) {
    const sets = [];
    const vals = [];
    if (fields.status !== undefined) { sets.push('status = ?'); vals.push(fields.status); }
    if (fields.items_json !== undefined) { sets.push('items_json = ?'); vals.push(fields.items_json); }
    if (fields.purchase_list_json !== undefined) { sets.push('purchase_list_json = ?'); vals.push(fields.purchase_list_json); }
    if (fields.todos_json !== undefined) { sets.push('todos_json = ?'); vals.push(fields.todos_json); }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    vals.push(new Date().toISOString());
    vals.push(orderId);
    db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
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

module.exports = {
    db,
    partRow, recipeRow, templateRow, orderRow, coilRow,
    dbGetAllParts, dbGetAllRecipes, dbGetAllOrders, dbGetAllCoils, dbGetAllTemplates,
    extractPartFields, loadPartsData, calculateRecipeCost,
    getSetting, setSetting,
    updateOrderFields, invalidatePartsCache,
};
