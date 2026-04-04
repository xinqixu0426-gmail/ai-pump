/**
 * 自动转换 api.cjs: NocoDB → SQLite
 * 用法: node scripts/transform-api.cjs
 * 
 * 策略: 读取原文件，按区块替换，输出新文件
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'api.cjs'), 'utf-8');

// ── 1. 替换文件头部 (config + helpers) ──────────────

const OLD_HEADER = `/**
 * 水泵BOM成本查询API
 * 供N8N等外部系统调用
 */

try {
    process.loadEnvFile();
} catch (e) {
    // ignore if .env does not exist
}
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = 3002;  // API服务器端口

// NocoDB 配置
const NOCO_CONFIG = {
    baseUrl: process.env.VITE_NOCO_BASE_URL || 'http://localhost:8080',
    apiToken: process.env.VITE_NOCO_API_TOKEN || '',
    partsTable: process.env.VITE_NOCO_PARTS_TABLE || '',
    recipesTable: process.env.VITE_NOCO_RECIPES_TABLE || '',
    ordersTable: process.env.VITE_NOCO_ORDERS_TABLE || '',
    coilsTable: process.env.VITE_NOCO_COILS_TABLE || '',
    configTable: process.env.VITE_NOCO_CONFIG_TABLE || ''
};

// 中间件
app.use(cors());  // 允许跨域请求（N8N调用需要）
app.use(express.json());

/**
 * API请求封装
 */
async function apiRequest(path, options = {}) {
    const url = \`\${NOCO_CONFIG.baseUrl}\${path}\`;
    const headers = {
        'xc-token': NOCO_CONFIG.apiToken,
        'Content-Type': 'application/json',
        ...options.headers
    };

    const response = await fetch(url, {
        ...options,
        headers
    });

    if (!response.ok) {
        throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
    }

    return await response.json();
}

/**
 * 递归分页抓取所有记录
 */
async function fetchAllRecords(tableId) {
    const PAGE_SIZE = 100;
    let offset = 0;
    const all = [];

    while (true) {
        const data = await apiRequest(\`/api/v2/tables/\${tableId}/records?limit=\${PAGE_SIZE}&offset=\${offset}\`);
        const list = data.list || [];
        if (list.length === 0) break;
        all.push(...list);
        if (list.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return all;
}

/**
 * 加载所有零件数据（用于成本计算）
 */
async function loadPartsData() {
    const records = await fetchAllRecords(NOCO_CONFIG.partsTable);

    const partsCache = {};
    const partsByModel = {};

    records.forEach(record => {
        const model = record.型号 || record.model;
        const category = record.类别 || record.category || '其他';
        const price = record.单价 || record.price || 0;
        const supplier = record.供应商 || record.supplier || '-';

        partsCache[model] = { price, supplier, category };

        if (!partsByModel[model]) {
            partsByModel[model] = [];
        }
        partsByModel[model].push({ id: record.Id, supplier, price });
    });

    return { partsCache, partsByModel };
}`;

const NEW_HEADER = `/**
 * 水泵BOM成本查询API
 * SQLite 版本 (迁移自 NocoDB)
 */

try {
    process.loadEnvFile();
} catch (e) {
    // ignore if .env does not exist
}
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3002;

// ── SQLite 初始化 ──
const DB_PATH = path.join(__dirname, 'pump.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 中间件
app.use(cors());
app.use(express.json());

// ── 通用辅助 ──

/** 将 row.id → row.Id (前端约定大写) + 中文字段兼容 */
function partRow(r) {
    if (!r) return r;
    return { Id: r.id, model: r.model, category: r.category, price: r.price, supplier: r.supplier, stock: r.stock,
             型号: r.model, 类别: r.category, 单价: r.price, 供应商: r.supplier, 库存: r.stock, 备注: r.remark || '',
             CreatedAt: r.created_at, UpdatedAt: r.updated_at };
}
function recipeRow(r) {
    if (!r) return r;
    return { Id: r.id, name: r.name, spec: r.spec, parts_json: r.parts_json,
             配方名称: r.name, 规格: r.spec, 配件JSON: r.parts_json,
             saved_total_cost: r.saved_total_cost, 保存时总成本: r.saved_total_cost,
             saved_cost_details: r.saved_cost_details, 保存时成本明细: r.saved_cost_details,
             CreatedAt: r.created_at, UpdatedAt: r.updated_at };
}
function orderRow(r) {
    if (!r) return r;
    return { Id: r.id, 客户名称: r.customer_name, 合同号: r.contract_no, 备注: r.remark,
             订单状态: r.status, 型号列表JSON: r.items_json,
             采购清单JSON: r.purchase_list_json, 采购TodoJSON: r.todos_json,
             CreatedAt: r.created_at, UpdatedAt: r.updated_at };
}
function coilRow(r) {
    if (!r) return r;
    return { Id: r.id, 规格: r.spec, 单价: r.unit_price, 片数: r.sheets,
             默认线重: r.wire_weight, 铜价基数: r.copper_base,
             线圈加工费: r.coil_fee, 转子加工费: r.rotor_fee,
             成本: r.cost, 默认电容_uf: r.default_capacitor, 默认线径: r.default_wire_gauge,
             CreatedAt: r.created_at, UpdatedAt: r.updated_at };
}

/** 兼容前端发送的中英文字段名 */
function extractPartFields(body) {
    return {
        model: body.model || body.型号 || '',
        category: body.category || body.类别 || '其他',
        price: body.price ?? body.单价 ?? 0,
        supplier: body.supplier || body.供应商 || '-',
        stock: body.stock ?? body.库存 ?? 0,
    };
}

// ── 数据访问层 (替代 NocoDB HTTP) ──

function dbGetAllParts() { return db.prepare('SELECT * FROM parts').all().map(partRow); }
function dbGetAllRecipes() { return db.prepare('SELECT * FROM recipes').all().map(recipeRow); }
function dbGetAllOrders() { return db.prepare('SELECT * FROM orders').all().map(orderRow); }
function dbGetAllCoils() { return db.prepare('SELECT * FROM coils').all().map(coilRow); }

/**
 * 加载所有零件数据（用于成本计算）— 同步
 */
function loadPartsData() {
    const records = db.prepare('SELECT * FROM parts').all();
    const partsCache = {};
    const partsByModel = {};
    records.forEach(record => {
        const model = record.model;
        const category = record.category || '其他';
        const price = record.price || 0;
        const supplier = record.supplier || '-';
        partsCache[model] = { price, supplier, category };
        if (!partsByModel[model]) partsByModel[model] = [];
        partsByModel[model].push({ id: record.id, supplier, price });
    });
    return { partsCache, partsByModel };
}`;

let result = src.replace(OLD_HEADER, NEW_HEADER);
console.log('[1/9] 文件头部已替换');

// ── 2. resolveWireFromStator ──
result = result.replace(
    /async function resolveWireFromStator\(statorSpec, statorSheets\) \{[\s\S]*?return record\?\.默认线径 \|\| null;[\s\S]*?\}/,
    `function resolveWireFromStator(statorSpec, statorSheets) {
    if (!statorSpec || !statorSheets) return null;
    try {
        const record = db.prepare('SELECT default_wire_gauge FROM coils WHERE spec = ? AND sheets = ? LIMIT 1').get(String(statorSpec), parseInt(statorSheets));
        return record?.default_wire_gauge || null;
    } catch { return null; }
}`
);
console.log('[2/9] resolveWireFromStator 已替换');

// ── 3. 替换所有 "await loadPartsData()" → "loadPartsData()" ──
result = result.replace(/await loadPartsData\(\)/g, 'loadPartsData()');
console.log('[3/9] await loadPartsData() → loadPartsData()');

// ── 4. 替换所有 "await resolveWireFromStator" → "resolveWireFromStator" ──
result = result.replace(/await resolveWireFromStator/g, 'resolveWireFromStator');
console.log('[4/9] await resolveWireFromStator → resolveWireFromStator');

// ── 5. 替换所有 fetchAllRecords(NOCO_CONFIG.xxxTable) ──
const tableMap = {
    'partsTable': { fn: 'dbGetAllParts', table: 'parts' },
    'recipesTable': { fn: 'dbGetAllRecipes', table: 'recipes' },
    'ordersTable': { fn: 'dbGetAllOrders', table: 'orders' },
    'coilsTable': { fn: 'dbGetAllCoils', table: 'coils' },
};
for (const [key, val] of Object.entries(tableMap)) {
    const pat = new RegExp(`await fetchAllRecords\\(NOCO_CONFIG\\.${key}\\)`, 'g');
    result = result.replace(pat, `${val.fn}()`);
}
// Also handle the non-await version
for (const [key, val] of Object.entries(tableMap)) {
    const pat = new RegExp(`fetchAllRecords\\(NOCO_CONFIG\\.${key}\\)`, 'g');
    result = result.replace(pat, `${val.fn}()`);
}
console.log('[5/9] fetchAllRecords → db 辅助函数');

// ── 6. 替换 apiRequest 中的 CRUD 操作 ──
// Parts CRUD
result = result.replace(
    /const record = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.partsTable\}\/records`, \{\s*method: 'POST',\s*body: JSON\.stringify\(req\.body\)\s*\}\);/,
    `const f = extractPartFields(req.body);
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO parts (model, category, price, supplier, stock, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(f.model, f.category, f.price, f.supplier, f.stock, now, now);
        const record = partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(info.lastInsertRowid));`
);

// Parts PATCH
result = result.replace(
    /\/\*\* PATCH \/api\/parts - 更新零件 \*\/\s*app\.patch\('\/api\/parts', async \(req, res\) => \{\s*try \{\s*const record = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.partsTable\}\/records`, \{\s*method: 'PATCH',\s*body: JSON\.stringify\(req\.body\)\s*\}\);/,
    `/** PATCH /api/parts - 更新零件 */
app.patch('/api/parts', async (req, res) => {
    try {
        const id = req.body.Id || req.body.id;
        const f = extractPartFields(req.body);
        const now = new Date().toISOString();
        const sets = [];
        const vals = [];
        if (req.body.model !== undefined || req.body.型号 !== undefined) { sets.push('model = ?'); vals.push(f.model); }
        if (req.body.category !== undefined || req.body.类别 !== undefined) { sets.push('category = ?'); vals.push(f.category); }
        if (req.body.price !== undefined || req.body.单价 !== undefined) { sets.push('price = ?'); vals.push(f.price); }
        if (req.body.supplier !== undefined || req.body.供应商 !== undefined) { sets.push('supplier = ?'); vals.push(f.supplier); }
        if (req.body.stock !== undefined || req.body.库存 !== undefined) { sets.push('stock = ?'); vals.push(f.stock); }
        sets.push('updated_at = ?'); vals.push(now); vals.push(id);
        db.prepare(\`UPDATE parts SET \${sets.join(', ')} WHERE id = ?\`).run(...vals);
        const record = partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(id));`
);

// Parts DELETE
result = result.replace(
    /\/\*\* DELETE \/api\/parts - 删除零件 \*\/\s*app\.delete\('\/api\/parts', async \(req, res\) => \{\s*try \{\s*await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.partsTable\}\/records`, \{\s*method: 'DELETE',\s*body: JSON\.stringify\(req\.body\)\s*\}\);/,
    `/** DELETE /api/parts - 删除零件 */
app.delete('/api/parts', async (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        for (const item of items) { db.prepare('DELETE FROM parts WHERE id = ?').run(item.Id || item.id); }`
);

// Recipes CRUD
result = result.replace(
    /\/\*\* GET \/api\/recipes - 获取所有配方 \*\/\s*app\.get\('\/api\/recipes', async \(req, res\) => \{\s*try \{\s*const records = await fetchAllRecords\(NOCO_CONFIG\.recipesTable\);/,
    `/** GET /api/recipes - 获取所有配方 */
app.get('/api/recipes', async (req, res) => {
    try {
        const records = dbGetAllRecipes();`
);

// Recipe by ID
result = result.replace(
    /app\.get\('\/api\/recipes\/:id', async \(req, res\) => \{\s*try \{\s*const data = await apiRequest\(\s*`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.recipesTable\}\/records\?where=\(Id,eq,\$\{req\.params\.id\}\)`\s*\);\s*const record = data\.list\?\.\[0\];/,
    `app.get('/api/recipes/:id', async (req, res) => {
    try {
        const record = recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(parseInt(req.params.id)));`
);

// Recipe POST
result = result.replace(
    /\/\*\* POST \/api\/recipes - 创建配方 \*\/\s*app\.post\('\/api\/recipes', async \(req, res\) => \{\s*try \{\s*const record = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.recipesTable\}\/records`, \{\s*method: 'POST',\s*body: JSON\.stringify\(req\.body\)\s*\}\);/,
    `/** POST /api/recipes - 创建配方 */
app.post('/api/recipes', async (req, res) => {
    try {
        const b = req.body;
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO recipes (name, spec, parts_json, saved_total_cost, saved_cost_details, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            b.配方名称 || b.name || '', b.规格 || b.spec || '', b.配件JSON || b.parts_json || '[]',
            b.saved_total_cost ?? b.保存时总成本 ?? 0, b.saved_cost_details || b.保存时成本明细 || '[]', now, now
        );
        const record = recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(info.lastInsertRowid));`
);

// Recipe DELETE
result = result.replace(
    /\/\*\* DELETE \/api\/recipes - 删除配方 \*\/\s*app\.delete\('\/api\/recipes', async \(req, res\) => \{\s*try \{\s*await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.recipesTable\}\/records`, \{\s*method: 'DELETE',\s*body: JSON\.stringify\(req\.body\)\s*\}\);/,
    `/** DELETE /api/recipes - 删除配方 */
app.delete('/api/recipes', async (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        for (const item of items) { db.prepare('DELETE FROM recipes WHERE id = ?').run(item.Id || item.id); }`
);

// Recipe PATCH
result = result.replace(
    /\/\*\* PATCH \/api\/recipes - 更新配方 \*\/\s*app\.patch\('\/api\/recipes', async \(req, res\) => \{\s*try \{\s*const record = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.recipesTable\}\/records`, \{\s*method: 'PATCH',\s*body: JSON\.stringify\(req\.body\)\s*\}\);/,
    `/** PATCH /api/recipes - 更新配方 */
app.patch('/api/recipes', async (req, res) => {
    try {
        const b = req.body;
        const id = b.Id || b.id;
        const now = new Date().toISOString();
        const sets = []; const vals = [];
        if (b.配方名称 !== undefined || b.name !== undefined) { sets.push('name = ?'); vals.push(b.配方名称 || b.name); }
        if (b.规格 !== undefined || b.spec !== undefined) { sets.push('spec = ?'); vals.push(b.规格 || b.spec); }
        if (b.配件JSON !== undefined || b.parts_json !== undefined) { sets.push('parts_json = ?'); vals.push(b.配件JSON || b.parts_json); }
        if (b.saved_total_cost !== undefined || b.保存时总成本 !== undefined) { sets.push('saved_total_cost = ?'); vals.push(b.saved_total_cost ?? b.保存时总成本); }
        if (b.saved_cost_details !== undefined || b.保存时成本明细 !== undefined) { sets.push('saved_cost_details = ?'); vals.push(b.saved_cost_details || b.保存时成本明细); }
        sets.push('updated_at = ?'); vals.push(now); vals.push(id);
        if (sets.length > 1) db.prepare(\`UPDATE recipes SET \${sets.join(', ')} WHERE id = ?\`).run(...vals);
        const record = recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(id));`
);

// Orders GET all
result = result.replace(
    /\/\*\* GET \/api\/orders - 获取所有订单 \*\/\s*app\.get\('\/api\/orders', async \(req, res\) => \{\s*try \{\s*const records = await fetchAllRecords\(NOCO_CONFIG\.ordersTable\);/,
    `/** GET /api/orders - 获取所有订单 */
app.get('/api/orders', async (req, res) => {
    try {
        const records = dbGetAllOrders();`
);

// Order by ID
result = result.replace(
    /\/\*\* GET \/api\/orders\/:id - 获取单个订单 \*\/\s*app\.get\('\/api\/orders\/:id', async \(req, res\) => \{\s*try \{\s*const data = await apiRequest\(\s*`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.ordersTable\}\/records\?where=\(Id,eq,\$\{req\.params\.id\}\)`\s*\);\s*const record = data\.list\?\.\[0\];/,
    `/** GET /api/orders/:id - 获取单个订单 */
app.get('/api/orders/:id', async (req, res) => {
    try {
        const record = orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(req.params.id)));`
);

// Order POST
result = result.replace(
    /\/\*\* POST \/api\/orders - 创建订单 \*\/\s*app\.post\('\/api\/orders', async \(req, res\) => \{\s*try \{\s*const record = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.ordersTable\}\/records`, \{\s*method: 'POST',\s*body: JSON\.stringify\(req\.body\)\s*\}\);/,
    `/** POST /api/orders - 创建订单 */
app.post('/api/orders', async (req, res) => {
    try {
        const b = req.body;
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO orders (customer_name, contract_no, remark, status, items_json, purchase_list_json, todos_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            b.客户名称 || b.customer_name || '', b.合同号 || b.contract_no || '', b.备注 || b.remark || '',
            b.订单状态 || b.status || '待采购', b.型号列表JSON || b.items_json || '[]',
            b.采购清单JSON || b.purchase_list_json || '[]', b.采购TodoJSON || b.todos_json || '[]', now, now
        );
        const record = orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid));`
);

// Order PATCH
result = result.replace(
    /\/\*\* PATCH \/api\/orders - 更新订单 \*\/\s*app\.patch\('\/api\/orders', async \(req, res\) => \{\s*try \{\s*const record = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.ordersTable\}\/records`, \{\s*method: 'PATCH',\s*body: JSON\.stringify\(req\.body\)\s*\}\);/,
    `/** PATCH /api/orders - 更新订单 */
app.patch('/api/orders', async (req, res) => {
    try {
        const b = req.body;
        const id = b.Id || b.id;
        const now = new Date().toISOString();
        const sets = []; const vals = [];
        if (b.客户名称 !== undefined || b.customer_name !== undefined) { sets.push('customer_name = ?'); vals.push(b.客户名称 || b.customer_name); }
        if (b.合同号 !== undefined || b.contract_no !== undefined) { sets.push('contract_no = ?'); vals.push(b.合同号 || b.contract_no); }
        if (b.备注 !== undefined || b.remark !== undefined) { sets.push('remark = ?'); vals.push(b.备注 || b.remark); }
        if (b.订单状态 !== undefined || b.status !== undefined) { sets.push('status = ?'); vals.push(b.订单状态 || b.status); }
        if (b.型号列表JSON !== undefined || b.items_json !== undefined) { sets.push('items_json = ?'); vals.push(b.型号列表JSON || b.items_json); }
        if (b.采购清单JSON !== undefined || b.purchase_list_json !== undefined) { sets.push('purchase_list_json = ?'); vals.push(b.采购清单JSON || b.purchase_list_json); }
        if (b.采购TodoJSON !== undefined || b.todos_json !== undefined) { sets.push('todos_json = ?'); vals.push(b.采购TodoJSON || b.todos_json); }
        sets.push('updated_at = ?'); vals.push(now); vals.push(id);
        db.prepare(\`UPDATE orders SET \${sets.join(', ')} WHERE id = ?\`).run(...vals);
        const record = orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));`
);

// Order DELETE
result = result.replace(
    /\/\*\* DELETE \/api\/orders - 删除订单 \*\/\s*app\.delete\('\/api\/orders', async \(req, res\) => \{\s*try \{\s*await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.ordersTable\}\/records`, \{\s*method: 'DELETE',\s*body: JSON\.stringify\(req\.body\)\s*\}\);/,
    `/** DELETE /api/orders - 删除订单 */
app.delete('/api/orders', async (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        for (const item of items) { db.prepare('DELETE FROM orders WHERE id = ?').run(item.Id || item.id); }`
);

console.log('[6/9] CRUD 路由已替换');

// ── 7. 替换剩余的 apiRequest 调用 (executeToolCall + 其他) ──
// 这些是最复杂的——在 executeToolCall 和其他地方直接调用 apiRequest 的
// 用通用模式替换

// Recipe cost by-name route: already uses fetchAllRecords which is now dbGetAllRecipes
// Recipe cost by-id: uses apiRequest for single record query
result = result.replace(
    /const data = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.recipesTable\}\/records\?where=\(Id,eq,\$\{recipeId\}\)`\);/g,
    `const data = { list: [recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(parseInt(recipeId)))].filter(Boolean) };`
);

// Coils CRUD: POST
result = result.replace(
    /const record = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.coilsTable\}\/records`, \{\s*method: 'POST',\s*body: JSON\.stringify\(\{[\s\S]*?成本: cost\.toFixed\(5\)\s*\}\)\s*\}\);/,
    `const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO coils (spec, sheets, unit_price, wire_weight, copper_base, coil_fee, rotor_fee, cost, default_wire_gauge, default_capacitor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            规格, sheets, unitPrice, wireWeight, copperBase, coilFee, rotorFee, cost.toFixed(5), 默认线径 || null, 默认电容_uf || null, now, now
        );
        const record = coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(info.lastInsertRowid));`
);

// Coils PATCH: get current record
result = result.replace(
    /const data = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.coilsTable\}\/records\?where=\(Id,eq,\$\{id\}\)&limit=1`\);\s*const current = data\.list\?\.\[0\];/,
    `const current = coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(id));`
);

// Coils PATCH: update
result = result.replace(
    /const record = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.coilsTable\}\/records`, \{\s*method: 'PATCH',\s*body: JSON\.stringify\(updates\)\s*\}\);/g,
    `const uId = updates.Id || updates.id;
        const now2 = new Date().toISOString();
        const uSets = []; const uVals = [];
        if (updates.单价 !== undefined) { uSets.push('unit_price = ?'); uVals.push(updates.单价); }
        if (updates.片数 !== undefined) { uSets.push('sheets = ?'); uVals.push(updates.片数); }
        if (updates.默认线重 !== undefined) { uSets.push('wire_weight = ?'); uVals.push(updates.默认线重); }
        if (updates.铜价基数 !== undefined) { uSets.push('copper_base = ?'); uVals.push(updates.铜价基数); }
        if (updates.线圈加工费 !== undefined) { uSets.push('coil_fee = ?'); uVals.push(updates.线圈加工费); }
        if (updates.转子加工费 !== undefined) { uSets.push('rotor_fee = ?'); uVals.push(updates.转子加工费); }
        if (updates.成本 !== undefined) { uSets.push('cost = ?'); uVals.push(updates.成本); }
        if (updates.默认线径 !== undefined) { uSets.push('default_wire_gauge = ?'); uVals.push(updates.默认线径); }
        if (updates.默认电容_uf !== undefined) { uSets.push('default_capacitor = ?'); uVals.push(updates.默认电容_uf); }
        uSets.push('updated_at = ?'); uVals.push(now2); uVals.push(uId);
        db.prepare(\`UPDATE coils SET \${uSets.join(', ')} WHERE id = ?\`).run(...uVals);
        const record = coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(uId));`
);

// Coils DELETE
result = result.replace(
    /await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.coilsTable\}\/records`, \{\s*method: 'DELETE',\s*body: JSON\.stringify\(\[\{ Id: id \}\]\)\s*\}\);/,
    `db.prepare('DELETE FROM coils WHERE id = ?').run(id);`
);

// Stator query in full-calculate
result = result.replace(
    /const statorData = await apiRequest\(\s*`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.coilsTable\}\/records\?where=\(规格,eq,\$\{encodeURIComponent\(statorSpec\)\}\)~and\(片数,eq,\$\{encodeURIComponent\(statorSheets\)\}\)&limit=1`\s*\);\s*const statorRecord = statorData\.list\?\.\[0\];/,
    `const statorRecord = coilRow(db.prepare('SELECT * FROM coils WHERE spec = ? AND sheets = ? LIMIT 1').get(statorSpec, parseInt(statorSheets)));`
);

// Base data query in full-calculate
result = result.replace(
    /const baseData = await apiRequest\(\s*`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.coilsTable\}\/records\?where=\(规格,eq,\$\{encodeURIComponent\(statorSpec\)\}\)&limit=10`\s*\);\s*const baseRecords = baseData\.list \|\| \[\];/,
    `const baseRecords = db.prepare('SELECT * FROM coils WHERE spec = ? LIMIT 10').all(statorSpec).map(coilRow);`
);

// copper price: get copper from coils
result = result.replace(
    /const coils = await fetchAllRecords\(NOCO_CONFIG\.coilsTable\);/g,
    `const coils = dbGetAllCoils();`
);

console.log('[7/9] apiRequest 调用已替换');

// ── 8. updateAllCoilsCopperPrice ──
result = result.replace(
    /async function updateAllCoilsCopperPrice\(copperPricePerTon\) \{[\s\S]*?return \{ copperPricePerTon, copperPricePerKg, updatedCount: allCoils\.length \};\s*\}/,
    `async function updateAllCoilsCopperPrice(copperPricePerTon) {
    const copperPricePerKg = (copperPricePerTon / 1000).toFixed(2);
    console.log(\`[铜价更新] 获取铜价: \${copperPricePerTon} 元/吨 → \${copperPricePerKg} 元/千克\`);
    const allCoils = db.prepare('SELECT * FROM coils').all();
    const updateCoil = db.prepare('UPDATE coils SET copper_base = ?, cost = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    const batchUpdate = db.transaction((coils) => {
        for (const coil of coils) {
            const newCost = coil.unit_price * coil.sheets + coil.wire_weight * parseFloat(copperPricePerKg) + coil.coil_fee + coil.rotor_fee;
            updateCoil.run(copperPricePerKg, newCost.toFixed(5), now, coil.id);
        }
    });
    batchUpdate(allCoils);
    console.log(\`[铜价更新] 已更新 \${allCoils.length} 条线圈记录的铜价基数为 \${copperPricePerKg}\`);
    return { copperPricePerTon, copperPricePerKg, updatedCount: allCoils.length };
}`
);
console.log('[8/9] updateAllCoilsCopperPrice 已替换');

// ── 9. 替换 executeToolCall 中的所有 apiRequest 调用 ──
// 这些调用都使用中文字段名的模式

// Generic pattern: apiRequest(`/api/v2/tables/${NOCO_CONFIG.xxxTable}/records?where=(Id,eq,${...})&limit=1`)
// → db queries
result = result.replace(
    /const orderData = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.ordersTable\}\/records\?where=\(Id,eq,\$\{orderId\}\)&limit=1`\);/g,
    `const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };`
);

// Parts table queries in executeToolCall
result = result.replace(
    /const allParts = await fetchAllRecords\(NOCO_CONFIG\.partsTable\);/g,
    `const allParts = dbGetAllParts();`
);

// create_part in executeToolCall
result = result.replace(
    /\/\/ 1\. 发起创建请求\s*const createRes = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.partsTable\}\/records`, \{\s*method: 'POST',\s*body: JSON\.stringify\(body\)\s*\}\);/,
    `// 1. 发起创建请求
                const now = new Date().toISOString();
                const createRes = db.prepare('INSERT INTO parts (model, category, price, supplier, stock, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(model, category, price, supplier, stock, now, now);
                createRes.Id = createRes.lastInsertRowid;`
);

// create_part verify
result = result.replace(
    /const verify = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.partsTable\}\/records\?where=\(Id,eq,\$\{newId\}\)&limit=1`\);\s*if \(!verify\.list \|\| verify\.list\.length === 0\)/,
    `const verify = { list: [partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(newId))].filter(Boolean) };
                    if (!verify.list || verify.list.length === 0)`
);

// update_part PATCH
result = result.replace(
    /await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.partsTable\}\/records`, \{\s*method: 'PATCH',\s*body: JSON\.stringify\(updates\)\s*\}\);([\s\S]*?)const verify = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.partsTable\}\/records\?where=\(Id,eq,\$\{target\.Id\}\)&limit=1`\);/,
    `{
                    const uSets2 = []; const uVals2 = [];
                    if (updates['单价'] !== undefined) { uSets2.push('price = ?'); uVals2.push(updates['单价']); }
                    if (updates['库存'] !== undefined) { uSets2.push('stock = ?'); uVals2.push(updates['库存']); }
                    if (updates['供应商'] !== undefined) { uSets2.push('supplier = ?'); uVals2.push(updates['供应商']); }
                    if (updates['类别'] !== undefined) { uSets2.push('category = ?'); uVals2.push(updates['类别']); }
                    uSets2.push('updated_at = ?'); uVals2.push(new Date().toISOString()); uVals2.push(target.Id);
                    db.prepare(\`UPDATE parts SET \${uSets2.join(', ')} WHERE id = ?\`).run(...uVals2);
                }$1const verify = { list: [partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(target.Id))].filter(Boolean) };`
);

// create_order in executeToolCall  
result = result.replace(
    /const createRes = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.ordersTable\}\/records`, \{\s*method: 'POST',\s*body: JSON\.stringify\(body\)\s*\}\);/g,
    `const now_o = new Date().toISOString();
                const createRes = db.prepare('INSERT INTO orders (customer_name, contract_no, remark, status, items_json, purchase_list_json, todos_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
                    body['客户名称'] || body.customer_name || '', body['合同号'] || body.contract_no || '', body['备注'] || body.remark || '',
                    body['订单状态'] || body.status || '待采购', body['型号列表JSON'] || body.items_json || '[]',
                    body['采购清单JSON'] || body.purchase_list_json || '[]', body['采购TodoJSON'] || body.todos_json || '[]', now_o, now_o
                );
                createRes.Id = createRes.lastInsertRowid;`
);

// verify order
result = result.replace(
    /const verify = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.ordersTable\}\/records\?where=\(Id,eq,\$\{newId\}\)&limit=1`\);/g,
    `const verify = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(newId))].filter(Boolean) };`
);

// order PATCH in executeToolCall (update items, status, purchase list, etc.)
result = result.replace(
    /await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.ordersTable\}\/records`, \{\s*method: 'PATCH',\s*body: JSON\.stringify\(\{[\s\S]*?\}\)\s*\}\);/g,
    (match) => {
        // Extract the JSON object being patched
        const bodyMatch = match.match(/JSON\.stringify\((\{[\s\S]*?\})\)/);
        if (!bodyMatch) return match;
        // Generic order PATCH: extract fields from the object literal
        return `{
                    const _ob = ${bodyMatch[1]};
                    const _oId = _ob.Id || _ob.id;
                    const _oSets = []; const _oVals = [];
                    if (_ob.订单状态) { _oSets.push('status = ?'); _oVals.push(_ob.订单状态); }
                    if (_ob.型号列表JSON) { _oSets.push('items_json = ?'); _oVals.push(_ob.型号列表JSON); }
                    if (_ob.采购清单JSON) { _oSets.push('purchase_list_json = ?'); _oVals.push(_ob.采购清单JSON); }
                    if (_ob.采购TodoJSON) { _oSets.push('todos_json = ?'); _oVals.push(_ob.采购TodoJSON); }
                    _oSets.push('updated_at = ?'); _oVals.push(new Date().toISOString()); _oVals.push(_oId);
                    db.prepare(\`UPDATE orders SET \${_oSets.join(', ')} WHERE id = ?\`).run(..._oVals);
                }`;
    }
);

// order DELETE in executeToolCall
result = result.replace(
    /await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.ordersTable\}\/records`, \{\s*method: 'DELETE',\s*body: JSON\.stringify\(\[\{ Id: row\.Id \}\]\)\s*\}\);/g,
    `db.prepare('DELETE FROM orders WHERE id = ?').run(row.Id);`
);

// recipe CRUD in executeToolCall
result = result.replace(
    /const createRes = await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.recipesTable\}\/records`, \{ method: 'POST', body: JSON\.stringify\(body\) \}\);/g,
    `const now_r = new Date().toISOString();
                const createRes = db.prepare('INSERT INTO recipes (name, spec, parts_json, saved_total_cost, saved_cost_details, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
                    body.配方名称 || body.name, body.规格 || body.spec || '', body.配件JSON || body.parts_json || '[]',
                    body.saved_total_cost ?? 0, body.saved_cost_details || '[]', now_r, now_r
                );
                createRes.Id = createRes.lastInsertRowid;`
);

result = result.replace(
    /await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.recipesTable\}\/records`, \{\s*method: 'DELETE',\s*body: JSON\.stringify\(\[\{ Id: recipe\.Id \}\]\)\s*\}\);/g,
    `db.prepare('DELETE FROM recipes WHERE id = ?').run(recipe.Id);`
);

result = result.replace(
    /await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.recipesTable\}\/records`, \{ method: 'PATCH', body: JSON\.stringify\(patchBody\) \}\);/g,
    `{
                    const _rSets = []; const _rVals = [];
                    if (patchBody.配方名称) { _rSets.push('name = ?'); _rVals.push(patchBody.配方名称); }
                    if (patchBody.规格) { _rSets.push('spec = ?'); _rVals.push(patchBody.规格); }
                    if (patchBody.配件JSON) { _rSets.push('parts_json = ?'); _rVals.push(patchBody.配件JSON); }
                    if (patchBody.saved_total_cost !== undefined) { _rSets.push('saved_total_cost = ?'); _rVals.push(patchBody.saved_total_cost); }
                    if (patchBody.saved_cost_details) { _rSets.push('saved_cost_details = ?'); _rVals.push(patchBody.saved_cost_details); }
                    _rSets.push('updated_at = ?'); _rVals.push(new Date().toISOString()); _rVals.push(patchBody.Id);
                    db.prepare(\`UPDATE recipes SET \${_rSets.join(', ')} WHERE id = ?\`).run(..._rVals);
                }`
);

// batch_update_prices PATCH
result = result.replace(
    /await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.partsTable\}\/records`, \{ method: 'PATCH', body: JSON\.stringify\(u\) \}\);/g,
    `db.prepare('UPDATE parts SET price = ?, updated_at = ? WHERE id = ?').run(u.单价, new Date().toISOString(), u.Id);`
);

// delete_part in executeToolCall
result = result.replace(
    /await apiRequest\(`\/api\/v2\/tables\/\$\{NOCO_CONFIG\.partsTable\}\/records`, \{\s*method: 'DELETE',\s*body: JSON\.stringify\(\[\{ Id: target\.Id \}\]\)\s*\}\);/g,
    `db.prepare('DELETE FROM parts WHERE id = ?').run(target.Id);`
);

// loadSystemPromptFromDB
result = result.replace(
    /async function loadSystemPromptFromDB\(\) \{[\s\S]*?return null;\s*\}/,
    `async function loadSystemPromptFromDB() {
    try {
        const record = db.prepare("SELECT value FROM config WHERE key = 'ai-system-prompt'").get();
        if (record && record.value) {
            AI_SYSTEM_PROMPT = record.value;
            console.log('[AI] System prompt 已从数据库加载, 长度:', AI_SYSTEM_PROMPT.length);
            return 1;
        }
    } catch (err) {
        console.error('[AI] 加载 system prompt 失败:', err.message);
    }
    return null;
}`
);

// System prompt PUT
result = result.replace(
    /\/\/ 持久化到 NocoDB\s*if \(NOCO_CONFIG\.configTable\) \{[\s\S]*?^\s*\}/m,
    `// 持久化到 SQLite
        db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('ai-system-prompt', ?)").run(prompt);`
);

console.log('[9/9] executeToolCall + system prompt 已替换');

// ── 最后清理：检查是否还有残留的 NOCO_CONFIG / apiRequest / fetchAllRecords ──
const residual_noco = (result.match(/NOCO_CONFIG/g) || []).length;
const residual_api = (result.match(/apiRequest/g) || []).length;
const residual_fetch = (result.match(/fetchAllRecords/g) || []).length;

console.log(`\n📊 残留检查:`);
console.log(`   NOCO_CONFIG: ${residual_noco} 处`);
console.log(`   apiRequest: ${residual_api} 处`);
console.log(`   fetchAllRecords: ${residual_fetch} 处`);

if (residual_noco + residual_api + residual_fetch > 0) {
    console.log('\n⚠️  仍有残留引用，需要手动处理！');
    // 输出残留行
    const lines = result.split('\n');
    lines.forEach((line, i) => {
        if (line.includes('NOCO_CONFIG') || line.includes('apiRequest') || line.includes('fetchAllRecords')) {
            console.log(`   L${i+1}: ${line.trim().slice(0, 120)}`);
        }
    });
}

// 写入新文件
fs.writeFileSync(path.join(__dirname, '..', 'api.cjs'), result, 'utf-8');
console.log('\n✅ api.cjs 已更新为 SQLite 版本！');
