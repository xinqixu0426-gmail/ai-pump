/**
 * 数据库初始化 + 共享辅助函数
 */
const path = require('path');
const Database = require('better-sqlite3');
const { createLogger } = require('./logger.cjs');
const { calculateRecipeCost: calculateRecipeCostFromEngine } = require('./services/costEngine.cjs');
const backupLogger = createLogger('backup');

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
        material TEXT DEFAULT '钢带',
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
        deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS quotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        status TEXT DEFAULT '报价中',
        items_json TEXT DEFAULT '[]',
        total_cost REAL DEFAULT 0,
        total_price REAL DEFAULT 0,
        remark TEXT DEFAULT '',
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS pump_model_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_name TEXT NOT NULL UNIQUE,
        template_id INTEGER NOT NULL,
        coil_spec TEXT DEFAULT '',
        coil_sheets INTEGER DEFAULT 0,
        coil_material TEXT DEFAULT '钢带',
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
        deleted_at TEXT
    );
`);

// seed 默认管理费
const existing = db.prepare('SELECT key FROM system_settings WHERE key = ?').get('management_fee');
if (!existing) {
    db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('management_fee', '5', new Date().toISOString());
}
const existingCoilMaterialPrices = db.prepare('SELECT key FROM system_settings WHERE key = ?').get('coil_material_prices');
if (!existingCoilMaterialPrices) {
    db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('coil_material_prices', JSON.stringify({ '钢带': 0.21, '冷轧800': 0.22, '其他材质': 0 }), new Date().toISOString());
}
const existingCableAccessories = db.prepare('SELECT key FROM system_settings WHERE key = ?').get('cable_accessories');
if (!existingCableAccessories) {
    const legacyCableAccessoryPart = db.prepare(`SELECT price FROM parts WHERE model = '电缆配件费' ORDER BY price LIMIT 1`).get();
    const cableParts = db.prepare(`SELECT remark FROM parts WHERE model LIKE '电缆-线径%' AND remark IS NOT NULL AND TRIM(remark) <> ''`).all();
    const inferred = {
        standard: { name: '普通铜套', fee: Number(legacyCableAccessoryPart?.price || 0) },
        xinjie: { name: '新界式', fee: 0 },
    };
    for (const part of cableParts) {
        try {
            const meta = JSON.parse(part.remark);
            for (const type of ['standard', 'xinjie']) {
                const name = meta?.cableAccessoryNames?.[type];
                const fee = Number(meta?.cableAccessoryFees?.[type] ?? (type === 'standard' ? meta?.cableAccessoryFee : undefined));
                if (typeof name === 'string' && name.trim()) inferred[type].name = name.trim();
                if (Number.isFinite(fee) && fee >= 0 && (fee > 0 || inferred[type].fee === 0)) inferred[type].fee = fee;
            }
            break;
        } catch { /* try next cable part */ }
    }
    db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('cable_accessories', JSON.stringify({
        standard: inferred.standard,
        xinjie: inferred.xinjie,
    }), new Date().toISOString());
}
if (!db.prepare('SELECT key FROM system_settings WHERE key = ?').get('float_accessory_delta')) {
    db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('float_accessory_delta', '0.6', new Date().toISOString());
}
if (!db.prepare('SELECT key FROM system_settings WHERE key = ?').get('aluminum_wire_price_per_kg')) {
    db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('aluminum_wire_price_per_kg', '0', new Date().toISOString());
}
if (!db.prepare('SELECT key FROM system_settings WHERE key = ?').get('usd_cny_rate')) {
    db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('usd_cny_rate', '0', new Date().toISOString());
}

// recipes 表新增结构化列（幂等 ALTER）
const recipeAlterColumns = [
    ['template_id', 'INTEGER'],
    ['coil_spec', "TEXT DEFAULT ''"],
    ['coil_sheets', 'INTEGER DEFAULT 0'],
    ['coil_material', "TEXT DEFAULT '钢带'"],
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
    ['model_variant_id', 'INTEGER'],
    ['impeller_model', "TEXT DEFAULT ''"],
    ['impeller_thickness', 'REAL'],
    ['impeller_diameter', 'REAL'],
    ['impeller_blade_count', 'INTEGER'],
    ['technical_data_json', "TEXT DEFAULT '{}'"],
];
for (const [col, type] of recipeAlterColumns) {
    try { db.exec(`ALTER TABLE recipes ADD COLUMN ${col} ${type}`); } catch { /* already exists */ }
}
try { db.exec(`ALTER TABLE parts ADD COLUMN remark TEXT DEFAULT ''`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN rotor_params_json TEXT DEFAULT '{}'`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN assembly_wage REAL DEFAULT 0`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN packing_wage REAL DEFAULT 0`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN painting_wage REAL`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN surface_treatment_mode TEXT DEFAULT 'none'`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN surface_treatment_cost REAL`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN cost_mode TEXT DEFAULT 'components'`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN bundle_cost REAL DEFAULT 0`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_shell_templates ADD COLUMN shell_components_json TEXT DEFAULT '[]'`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_model_variants ADD COLUMN long_screw_extra_length REAL DEFAULT 0`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE pump_model_variants ADD COLUMN custom_fields_json TEXT DEFAULT '[]'`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE rotor_drawings ADD COLUMN linked_pump_model TEXT DEFAULT ''`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE rotor_drawings ADD COLUMN drawing_name TEXT DEFAULT ''`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE coils ADD COLUMN material TEXT DEFAULT '钢带'`); } catch { /* already exists */ }
try { db.exec(`UPDATE coils SET material = '钢带' WHERE material IS NULL OR TRIM(material) = ''`); } catch { /* ignore */ }

try {
    const rows = db.prepare(`
        SELECT id, remark FROM parts
        WHERE remark LIKE '%"screwPricing"%'
    `).all();
    const updateRemark = db.prepare('UPDATE parts SET remark = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    for (const row of rows) {
        try {
            const notes = JSON.parse(row.remark || '{}');
            if (!notes?.screwPricing || typeof notes.screwPricing !== 'object') continue;
            const diameter = Number(notes.screwPricing.diameter);
            notes.screwPricing = {
                enabled: Boolean(notes.screwPricing.enabled),
                diameter: Number.isFinite(diameter) && diameter > 0 ? diameter : 6,
                modelPrefix: typeof notes.screwPricing.modelPrefix === 'string' ? notes.screwPricing.modelPrefix : undefined,
            };
            updateRemark.run(JSON.stringify(notes), now, row.id);
        } catch { /* skip invalid notes */ }
    }
} catch { /* ignore screw pricing cleanup */ }

// P0-2: 软删除列迁移（幂等）
for (const tbl of ['orders', 'recipes', 'parts']) {
    try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN deleted_at TEXT`); } catch { /* already exists */ }
}

// ── Row Adapters ──

function partRow(r) {
    if (!r) return r;
    return {
        id: r.id, Id: r.id, model: r.model, category: r.category, price: r.price,
        supplier: r.supplier, stock: r.stock, notes: r.remark || '',
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function recipeRow(r) {
    if (!r) return r;
    const surfaceTreatmentMode = r.surface_treatment_mode || (r.painting_wage != null ? 'painting' : 'none');
    const surfaceTreatmentCost = r.surface_treatment_cost != null
        ? r.surface_treatment_cost
        : (r.painting_wage != null ? r.painting_wage : 0);
    return {
        id: r.id, Id: r.id, name: r.name, spec: r.spec,
        partsJson: r.parts_json,
        savedTotalCost: r.saved_total_cost,
        savedCostDetails: r.saved_cost_details,
        templateId: r.template_id, coilSpec: r.coil_spec, coilSheets: r.coil_sheets,
        coilMaterial: r.coil_material || '钢带',
        coilWireWeight: r.coil_wire_weight,
        hasFloat: r.has_float, floatWire: r.float_wire, floatAccessoryType: r.float_accessory_type || 'standard', hasCable: r.has_cable,
        cableLength: r.cable_length, cableWire: r.cable_wire, cableAccessoryType: r.cable_accessory_type || 'standard', boxType: r.box_type,
        customBarrelLength: r.custom_barrel_length, extraPartsJson: r.extra_parts_json,
        modelVariantId: r.model_variant_id,
        impellerModel: r.impeller_model || '',
        impellerThickness: r.impeller_thickness,
        impellerDiameter: r.impeller_diameter,
        impellerBladeCount: r.impeller_blade_count,
        technicalDataJson: r.technical_data_json || '{}',
        packingPartsJson: r.packing_parts_json,
        assemblyWage: r.assembly_wage, packingWage: r.packing_wage, paintingWage: r.painting_wage,
        surfaceTreatmentMode,
        surfaceTreatmentCost,
        managementFee: r.management_fee,
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function templateRow(r) {
    if (!r) return r;
    return {
        id: r.id, Id: r.id, shellModel: r.shell_model, description: r.description || '',
        partsJson: r.parts_json || '[]', rotorParamsJson: r.rotor_params_json || '{}',
        shellComponentsJson: r.shell_components_json || '[]',
        assemblyWage: r.assembly_wage || 0, packingWage: r.packing_wage || 0,
        paintingWage: r.painting_wage != null ? r.painting_wage : null,
        surfaceTreatmentMode: r.surface_treatment_mode && !(r.surface_treatment_mode === 'none' && r.painting_wage != null)
            ? r.surface_treatment_mode
            : (r.painting_wage != null ? 'painting' : 'none'),
        surfaceTreatmentCost: r.surface_treatment_cost != null ? r.surface_treatment_cost : (r.painting_wage || 0),
        costMode: r.cost_mode || 'components', bundleCost: r.bundle_cost || 0,
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function modelVariantRow(r) {
    if (!r) return r;
    return {
        id: r.id,
        Id: r.id,
        modelName: r.model_name,
        templateId: r.template_id,
        coilSpec: r.coil_spec || '',
        coilSheets: r.coil_sheets || 0,
        coilMaterial: r.coil_material || '钢带',
        barrelLength: r.barrel_length,
        longScrewExtraLength: r.long_screw_extra_length || 0,
        impellerModel: r.impeller_model || '',
        impellerThickness: r.impeller_thickness,
        impellerDiameter: r.impeller_diameter,
        impellerBladeCount: r.impeller_blade_count,
        note: r.note || '',
        customFieldsJson: r.custom_fields_json || '[]',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        CreatedAt: r.created_at,
        UpdatedAt: r.updated_at,
    };
}
function orderRow(r) {
    if (!r) return r;
    return {
        id: r.id, Id: r.id, customerName: r.customer_name, contractNo: r.contract_no,
        remark: r.remark, status: r.status, itemsJson: r.items_json,
        purchaseListJson: r.purchase_list_json, todosJson: r.todos_json,
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function coilRow(r) {
    if (!r) return r;
    return {
        id: r.id, Id: r.id, spec: r.spec, material: r.material || '钢带', unitPrice: r.unit_price, sheets: r.sheets,
        wireWeight: r.wire_weight, copperBase: r.copper_base,
        coilFee: r.coil_fee, rotorFee: r.rotor_fee,
        cost: r.cost, defaultCapacitor: r.default_capacitor, defaultWireGauge: r.default_wire_gauge,
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function customerRow(r) {
    if (!r) return r;
    return {
        id: r.id, Id: r.id, name: r.name, contactInfo: r.contact_info, defaultMargin: r.default_margin, remark: r.remark,
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function quotationRow(r) {
    if (!r) return r;
    return {
        id: r.id, Id: r.id, customerId: r.customer_id, status: r.status, itemsJson: r.items_json,
        totalCost: r.total_cost, totalPrice: r.total_price, remark: r.remark,
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}

// ── 数据访问层 ──
function dbGetAllParts() { return db.prepare('SELECT * FROM parts WHERE deleted_at IS NULL').all().map(partRow); }
function dbGetAllRecipes() { return db.prepare('SELECT * FROM recipes WHERE deleted_at IS NULL').all().map(recipeRow); }
function dbGetAllOrders() { return db.prepare('SELECT * FROM orders WHERE deleted_at IS NULL').all().map(orderRow); }
function dbGetAllCoils() { return db.prepare('SELECT * FROM coils').all().map(coilRow); }
function dbGetAllTemplates() { return db.prepare('SELECT * FROM pump_shell_templates ORDER BY shell_model').all().map(templateRow); }
function dbGetAllModelVariants() { return db.prepare('SELECT * FROM pump_model_variants WHERE deleted_at IS NULL ORDER BY model_name').all().map(modelVariantRow); }
function dbGetAllCustomers() { return db.prepare('SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY id DESC').all().map(customerRow); }
function dbGetAllQuotations() { return db.prepare('SELECT * FROM quotations WHERE deleted_at IS NULL ORDER BY id DESC').all().map(quotationRow); }

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

// 兼容导出：成本计算本体位于 api/services/costEngine.cjs。
function calculateRecipeCost(parts, partsCache, partsByModel) {
    return calculateRecipeCostFromEngine(parts, partsCache, partsByModel, { getSetting });
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
const SAFE_TABLES = new Set(['parts', 'recipes', 'orders', 'coils', 'pump_shell_templates', 'pump_model_variants', 'system_settings', 'rotor_drawings', 'customers', 'quotations']);
const SAFE_COL_RE = /^[a-z][a-z0-9_]*$/;

function safeInsert(table, values) {
    if (!SAFE_TABLES.has(table)) throw new Error(`safeInsert: 非法表名 "${table}"`);
    const cols = [];
    const vals = [];
    for (const [col, val] of Object.entries(values || {})) {
        if (val === undefined) continue;
        if (!SAFE_COL_RE.test(col)) throw new Error(`safeInsert: 非法列名 "${col}"`);
        cols.push(col);
        vals.push(val);
    }
    if (cols.length === 0) throw new Error('safeInsert: 写入字段不能为空');
    const placeholders = cols.map(() => '?').join(', ');
    const info = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
    try {
        const recordId = Number(info.lastInsertRowid);
        const newRow = Number.isInteger(recordId) && recordId > 0
            ? db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(recordId)
            : values;
        writeAuditLog('INSERT', table, recordId || null, null, JSON.stringify(newRow || values));
    } catch { /* 审计日志写入失败不应阻断业务 */ }
    return info;
}

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

/**
 * 软删除 — 标记 deleted_at 而非物理删除
 * @param {string} table - 表名
 * @param {number} id - 记录 ID
 */
function softDelete(table, id) {
    if (!SAFE_TABLES.has(table)) throw new Error(`softDelete: 非法表名 "${table}"`);
    const now = new Date().toISOString();
    // 记录旧值到审计日志
    const oldRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!oldRow) throw new Error(`softDelete: 记录不存在 (${table}#${id})`);
    db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
    try {
        writeAuditLog('SOFT_DELETE', table, id, JSON.stringify(oldRow), null);
    } catch { /* 审计日志写入失败不应阻断业务 */ }
}

/**
 * 物理删除（用于暂未支持 deleted_at 的表），删除前写入审计日志
 */
function hardDelete(table, id) {
    if (!SAFE_TABLES.has(table)) throw new Error(`hardDelete: 非法表名 "${table}"`);
    const oldRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!oldRow) throw new Error(`hardDelete: 记录不存在 (${table}#${id})`);
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    try {
        writeAuditLog('DELETE', table, id, JSON.stringify(oldRow), null);
    } catch { /* 审计日志写入失败不应阻断业务 */ }
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
    const records = db.prepare('SELECT * FROM parts WHERE deleted_at IS NULL').all();
    const partsCache = {};
    const partsByModel = {};
    records.forEach(record => {
        const model = record.model;
        const price = record.price || 0;
        const supplier = record.supplier || '-';
        const notes = record.remark || '';
        const category = record.category || '其他';
        partsCache[model] = { price, supplier, category, notes };
        if (!partsByModel[model]) partsByModel[model] = [];
        partsByModel[model].push({ id: record.id, model, category, supplier, price, notes });
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

function nextBjtTime(hour, minute = 0) {
    const now = new Date();
    const utcMs = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        hour - 8,
        minute,
        0,
        0
    );
    let target = new Date(utcMs);
    if (target <= now) target = new Date(target.getTime() + 24 * 3600 * 1000);
    return target;
}

function runBackup() {
    try {
        if (!fsDb.existsSync(BACKUP_DIR)) fsDb.mkdirSync(BACKUP_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupPath = path.join(BACKUP_DIR, `pump_${stamp}.db`);
        // P0-3: 使用 better-sqlite3 backup() API 替代字符串拼接的 VACUUM INTO
        db.backup(backupPath)
            .then(() => {
                backupLogger.info(`数据库已备份到 ${backupPath}`);
                // 清理旧备份，只保留最近 MAX_BACKUPS 个
                const files = fsDb.readdirSync(BACKUP_DIR)
                    .filter(f => f.startsWith('pump_') && f.endsWith('.db'))
                    .sort().reverse();
                for (const old of files.slice(MAX_BACKUPS)) {
                    fsDb.unlinkSync(path.join(BACKUP_DIR, old));
                    backupLogger.info(`已清理旧备份: ${old}`);
                }
            })
            .catch(err => backupLogger.error(`失败: ${err.message}`));
    } catch (err) { backupLogger.error(`失败: ${err.message}`); }
}

function scheduleBackup() {
    // 每天凌晨 3:00 北京时间备份
    const now = new Date();
    const target = nextBjtTime(3);
    const delay = target.getTime() - now.getTime();
    backupLogger.info(`下次备份: ${target.toISOString()} (${(delay / 3600000).toFixed(1)}h 后)`);
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
    partRow, recipeRow, templateRow, modelVariantRow, orderRow, coilRow, customerRow, quotationRow,
    dbGetAllParts, dbGetAllRecipes, dbGetAllOrders, dbGetAllCoils, dbGetAllTemplates, dbGetAllModelVariants, dbGetAllCustomers, dbGetAllQuotations,
    extractPartFields, loadPartsData, calculateRecipeCost,
    getSetting, setSetting,
    updateOrderFields, invalidatePartsCache, safeInsert, safeUpdate, softDelete, hardDelete,
    nextBjtTime,
};
