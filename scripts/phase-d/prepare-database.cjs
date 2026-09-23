'use strict';
/**
 * PHASE D 数据准备：把**真实数据库的只读副本**复制到临时目录，做最小化脱敏，
 * 再补上本轮验收需要的 production-shaped 形态。
 *
 * 安全边界：
 *   - 只读打开来源（better-sqlite3 backup API，来源连接 readonly:true）；
 *   - 所有写入都发生在临时副本上；
 *   - 生产数据库与工作区 pump.db 都不会被打开为可写，也不会被修改。
 *
 * 补形态只在副本里进行，且全部使用 `PHASED-` 前缀，便于与真实业务数据区分：
 *   - 同价不同实体（D01）
 *   - 同名不同 canonical identity（D03，真实库本身已有同名线圈）
 *   - 库存数量与单价同值（D04）
 *   - 只差浮球的成对配方（A08 真实链路回放）
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const INVENTORY_TABLES = ['recipes', 'parts', 'coils', 'pump_shell_templates', 'customers', 'orders', 'quotations', 'stator_variants', 'coil_stock_movements'];

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** 复制来源数据库（只读打开）到临时目录。 */
async function copyDatabase(sourcePath, targetPath) {
    const resolvedSource = path.resolve(sourcePath);
    if (!fs.existsSync(resolvedSource)) {
        throw Object.assign(new Error(`PHASE_D_SOURCE_MISSING ${resolvedSource}`), { code: 'PHASE_D_SOURCE_MISSING' });
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const source = new Database(resolvedSource, { readonly: true, fileMustExist: true });
    try {
        await source.backup(targetPath);
    } finally {
        source.close();
    }
    return targetPath;
}

/** 最小化脱敏：客户名称/联系方式/备注。其余业务数值必须保持不变（parity 需要真实金额）。 */
function sanitize(db) {
    const columns = db.prepare('PRAGMA table_info(customers)').all().map(column => column.name);
    const updates = [];
    if (columns.includes('name')) updates.push("name = '客户-' || printf('%03d', id)");
    if (columns.includes('contact_info')) updates.push("contact_info = ''");
    if (columns.includes('remark')) updates.push("remark = ''");
    const affected = updates.length ? db.prepare(`UPDATE customers SET ${updates.join(', ')}`).run().changes : 0;
    return { customersMasked: affected };
}

function tableCounts(db) {
    const counts = {};
    for (const table of INVENTORY_TABLES) {
        const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
        if (!exists) continue;
        counts[table] = db.prepare(`SELECT COUNT(*) c FROM "${table}"`).get().c;
    }
    return counts;
}

function recipeColumns(db) {
    return db.prepare('PRAGMA table_info(recipes)').all().map(column => column.name);
}

/**
 * 补形态。全部使用真实表结构，值取自库内已有的真实配方（克隆后只改需要的字段），
 * 因此成本仍由正式 costEngine 重算，不是写死的金额。
 */
function augment(db) {
    const created = {};
    const columns = recipeColumns(db);
    const base = db.prepare('SELECT * FROM recipes WHERE deleted_at IS NULL ORDER BY id LIMIT 1').get();
    if (!base) throw Object.assign(new Error('PHASE_D_BASE_RECIPE_MISSING'), { code: 'PHASE_D_BASE_RECIPE_MISSING' });
    const insert = values => {
        const keys = Object.keys(values).filter(key => columns.includes(key));
        const info = db.prepare(`INSERT INTO recipes (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => values[key]));
        return Number(info.lastInsertRowid);
    };
    const cloneOf = name => {
        const next = { ...base };
        delete next.id;
        return { ...next, name, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null };
    };

    // A08：只差浮球的成对配方（其余配置完全相同）。
    const floatId = insert({ ...cloneOf('PHASED-浮球-有'), has_float: 1, spec: '12-120，带浮球，木箱，8米线' });
    const noFloatId = insert({ ...cloneOf('PHASED-浮球-无'), has_float: 0, float_wire: '', spec: '12-120，不带浮球，木箱，8米线' });
    created.floatPair = { withFloat: floatId, withoutFloat: noFloatId };

    // D01：两个配置完全相同、因此正式成本完全相同的方案（同价不同实体）。
    const twinA = insert({ ...cloneOf('PHASED-同价-甲'), spec: '12-120，带浮球，木箱，8米线（甲）' });
    const twinB = insert({ ...cloneOf('PHASED-同价-乙'), spec: '12-120，带浮球，木箱，8米线（乙）' });
    created.sameCostPair = { left: twinA, right: twinB };

    // D03：同名不同 canonical identity（同名，规格不同，因此成本不同）。
    const sameNameA = insert({ ...cloneOf('PHASED-同名方案'), spec: '12-120，带浮球，木箱，8米线' });
    const sameNameB = insert({ ...cloneOf('PHASED-同名方案'), spec: '12-140，带浮球，木箱，8米线' });
    created.sameNamePair = { left: sameNameA, right: sameNameB };

    // D04：库存数量与单价同值的零件（数值故意相同，语义完全不同）。
    const partColumns = db.prepare('PRAGMA table_info(parts)').all().map(column => column.name);
    const partInsert = values => {
        const keys = Object.keys(values).filter(key => partColumns.includes(key));
        const info = db.prepare(`INSERT INTO parts (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => values[key]));
        return Number(info.lastInsertRowid);
    };
    created.sameValuePart = partInsert({
        model: 'PHASED-同值件', category: '验收件', subcategory: '', price: 123, supplier: 'PHASED', stock: 123,
        remark: 'PHASE D 库存与单价同值', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
    });

    return created;
}

async function preparePhaseDDatabase(sourcePath, workDirectory) {
    const directory = workDirectory || fs.mkdtempSync(path.join(os.tmpdir(), 'phase-d-db-'));
    const target = path.join(directory, 'phase-d-clone.db');
    await copyDatabase(sourcePath, target);
    const db = new Database(target);
    try {
        db.pragma('journal_mode = WAL');
        const before = tableCounts(db);
        const sanitization = sanitize(db);
        const augmented = augment(db);
        const after = tableCounts(db);
        return {
            databasePath: target, directory, sourcePath: path.resolve(sourcePath),
            sha256: sha256File(target), sizeBytes: fs.statSync(target).size,
            tableCountsBefore: before, tableCountsAfter: after,
            sanitization, augmented,
            close: () => db.close(),
        };
    } catch (error) {
        db.close();
        throw error;
    }
}

module.exports = { preparePhaseDDatabase, copyDatabase, sanitize, augment, tableCounts, sha256File };
