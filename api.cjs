/**
 * 水泵BOM成本查询API
 * SQLite 版本 (迁移自 NocoDB)
 */

require('dotenv').config();
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
`);

// recipes 表新增结构化列（幂等 ALTER）
const recipeAlterColumns = [
    ['template_id', 'INTEGER'],
    ['coil_spec', 'TEXT DEFAULT \'\''],
    ['coil_sheets', 'INTEGER DEFAULT 0'],
    ['has_float', 'INTEGER DEFAULT 0'],
    ['float_wire', 'TEXT DEFAULT \'\''],
    ['has_cable', 'INTEGER DEFAULT 0'],
    ['cable_length', 'REAL DEFAULT 0'],
    ['cable_wire', 'TEXT DEFAULT \'\''],
    ['box_type', 'TEXT DEFAULT \'\''],
    ['extra_parts_json', 'TEXT DEFAULT \'[]\''],
];
for (const [col, type] of recipeAlterColumns) {
    try { db.exec(`ALTER TABLE recipes ADD COLUMN ${col} ${type}`); } catch { /* column already exists */ }
}

// parts 表新增 remark 列（幂等 ALTER）
try { db.exec(`ALTER TABLE parts ADD COLUMN remark TEXT DEFAULT ''`); } catch { /* column already exists */ }

// 中间件
app.use(cors());
app.use(express.json());

// ── 通用 SQLite 辅助 ──

/** Row adapters: SQLite英文列 → 前端期望的大写Id + 中文字段(兼容) */
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
        // 新增结构化字段
        template_id: r.template_id || null,
        coil_spec: r.coil_spec || '',
        coil_sheets: r.coil_sheets || 0,
        has_float: r.has_float || 0,
        float_wire: r.float_wire || '',
        has_cable: r.has_cable || 0,
        cable_length: r.cable_length || 0,
        cable_wire: r.cable_wire || '',
        box_type: r.box_type || '',
        extra_parts_json: r.extra_parts_json || '[]',
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function templateRow(r) {
    if (!r) return r;
    return {
        Id: r.id, shell_model: r.shell_model, description: r.description || '',
        parts_json: r.parts_json || '[]',
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


/** 将 SQLite row 的 id 映射为前端期望的 Id (大写) */
function withId(row) {
    if (!row) return row;
    return { Id: row.id, ...row };
}

/** 兼容前端发送的中英文字段名, 提取零件字段 */
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

        if (!partsByModel[model]) {
            partsByModel[model] = [];
        }
        partsByModel[model].push({ id: record.id, supplier, price });
    });

    return { partsCache, partsByModel };
}


/**
 * 计算配方成本
 */
function calculateRecipeCost(parts, partsCache, partsByModel) {
    let totalCost = 0;
    const details = [];
    const missingParts = [];

    parts.forEach(p => {
        const suppliers = partsByModel[p.model] || [];
        const match = suppliers.find(s => (s.supplier || '').trim() === (p.supplier || '').trim());
        let price = 0;
        let source = '';

        if (match && p.supplier) {
            price = match.price;
            source = '精确匹配';
        } else if (suppliers.length > 0) {
            // 如果没指定供应商或没匹配到，同一型号存在多家供应商时，自动选取单价最低的作为基准
            const fallback = suppliers.reduce((min, curr) => curr.price < min.price ? curr : min, suppliers[0]);
            price = fallback.price;
            source = '型号回退(取最低价)';
        } else {
            missingParts.push(p.model);
            source = '未找到';
        }

        const subtotal = price * p.qty;
        totalCost += subtotal;

        details.push({
            name: p.name || p.model,
            model: p.model,
            supplier: p.supplier || '-',
            price: parseFloat(price).toFixed(2),
            qty: p.qty,
            subtotal: subtotal.toFixed(2),
            source: source
        });
    });

    return {
        totalCost: totalCost.toFixed(2),
        itemCount: parts.length,
        details: details,
        missingParts: missingParts
    };
}

// ============================================
// API 端点
// ============================================

/**
 * GET /api/health
 * 健康检查端点（测试API是否运行）
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: '水泵BOM成本查询API运行中',
        timestamp: new Date().toISOString()
    });
});

/**
 * POST /api/cost/calculate
 * 成本计算端点 - 接收配方JSON，返回成本
 *
 * 请求体示例：
 * {
 *   "parts": [
 *     {"model": "201", "name": "轴承", "supplier": "张记配件", "qty": 2},
 *     {"model": "12双面", "name": "油封", "supplier": "李记五金", "qty": 1}
 *   ]
 * }
 */
app.post('/api/cost/calculate', async (req, res) => {
    try {
        const { parts } = req.body;

        if (!parts || !Array.isArray(parts) || parts.length === 0) {
            return res.status(400).json({
                success: false,
                error: '请求体必须包含 parts 数组'
            });
        }

        // 加载零件数据
        const { partsCache, partsByModel } = loadPartsData();

        // 计算成本
        const result = calculateRecipeCost(parts, partsCache, partsByModel);

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/cost/recipe/by-name
 * 按配方名称（泵壳型号）查询成本
 *
 * 注意：此路由必须在 /api/cost/recipe/:id 之前定义
 *
 * 示例：GET /api/cost/recipe/by-name?name=人民款370w-90机筒
 */
app.get('/api/cost/recipe/by-name', async (req, res) => {
    try {
        const recipeName = req.query.name;

        if (!recipeName) {
            return res.status(400).json({
                success: false,
                error: '请提供 name 查询参数'
            });
        }

        // 获取所有配方，然后在内存中匹配（避免URL编码问题）
        let allRecipes;
        try {
            allRecipes = dbGetAllRecipes();
        } catch (error) {
            console.error('DB Error:', error);
            return res.status(500).json({
                success: false,
                error: '获取配方失败: ' + error.message
            });
        }

        if (!allRecipes || allRecipes.length === 0) {
            return res.status(404).json({
                success: false,
                error: '数据库中没有配方'
            });
        }

        // 查找匹配的配方（支持部分匹配）
        const recipe = allRecipes.find(r => {
            const name = r.配方名称 || r.name || '';
            return name.includes(recipeName);
        });

        if (!recipe) {
            return res.status(404).json({
                success: false,
                error: `未找到名称包含 "${recipeName}" 的配方`
            });
        }

        const name = recipe.配方名称 || recipe.name;
        const spec = recipe.规格 || recipe.spec;
        const partsJson = recipe.配件JSON || recipe.parts_json || '[]';

        let parts = [];
        try {
            parts = JSON.parse(partsJson);
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: '配方配件JSON格式错误'
            });
        }

        // 加载零件数据并计算成本
        const { partsCache, partsByModel } = loadPartsData();
        const result = calculateRecipeCost(parts, partsCache, partsByModel);

        res.json({
            success: true,
            data: {
                recipeId: recipe.Id,
                recipeName: name,
                recipeSpec: spec,
                ...result
            }
        });

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/cost/recipe/:id
 * 按配方ID查询成本
 *
 * 示例：GET /api/cost/recipe/1
 */
app.get('/api/cost/recipe/:id', async (req, res) => {
    try {
        const recipeId = req.params.id;

        // 获取配方
        const data = { list: [recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(parseInt(recipeId)))].filter(Boolean) };

        if (!data.list || data.list.length === 0) {
            return res.status(404).json({
                success: false,
                error: `配方ID ${recipeId} 不存在`
            });
        }

        const recipe = data.list[0];
        const name = recipe.配方名称 || recipe.name;
        const spec = recipe.规格 || recipe.spec;
        const partsJson = recipe.配件JSON || recipe.parts_json || '[]';

        let parts = [];
        try {
            parts = JSON.parse(partsJson);
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: '配方配件JSON格式错误'
            });
        }

        // 加载零件数据并计算成本
        const { partsCache, partsByModel } = loadPartsData();
        const result = calculateRecipeCost(parts, partsCache, partsByModel);

        res.json({
            success: true,
            data: {
                recipeId: recipeId,
                recipeName: name,
                recipeSpec: spec,
                ...result
            }
        });

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 从线圈成本表查询默认线径
 * 按 (规格, 片数) 精确匹配
 */
function resolveWireFromStator(statorSpec, statorSheets) {
    if (!statorSpec || !statorSheets) return null;
    try {
        const record = db.prepare('SELECT default_wire_gauge FROM coils WHERE spec = ? AND sheets = ? LIMIT 1').get(String(statorSpec), parseInt(statorSheets));
        return record?.default_wire_gauge || null;
    } catch {
        return null;
    }
}

function resolveWire(dbWire, explicitWire) {
    // 1. 显式指定优先
    if (explicitWire) return explicitWire;
    // 2. 数据库查到的线径
    if (dbWire) return dbWire;
    // 3. 兜底
    return '0.55';
}

/**
 * 动态配置成本计算（浮球/电缆/包材）
 * POST /api/cost/dynamic-config
 * 
 * 请求体:
 * {
 *   "stator": "12-120",       // 定子规格-片数（简写，如"12-120"，自动拆分推导线径）
 *   "hasFloat": true,         // 是否带浮球（可选，默认 false）
 *   "floatWire": "0.55",      // 浮球线径，不传则由定子规格推导
 *   "hasCable": true,         // 是否带电缆（可选，传了 cableLength>0 也视为 true）
 *   "cableWire": "0.55",      // 电缆线径，不传则由定子规格推导
 *   "cableLength": 8,         // 电缆长度（米）
 *   "boxType": "纸箱-A"       // 包装箱型号（可选）
 * }
 */
app.post('/api/cost/dynamic-config', async (req, res) => {
    try {
        const { stator, statorSpec: rawSpec, statorSheets: rawSheets, hasFloat, floatWire, hasCable, cableWire, cableLength, boxType } = req.body;

        // 支持 "12-120" 简写格式
        let statorSpec = rawSpec;
        let statorSheets = rawSheets;
        if (stator && typeof stator === 'string' && stator.includes('-')) {
            const [s, sh] = stator.split('-');
            statorSpec = statorSpec || s.trim();
            statorSheets = statorSheets || sh.trim();
        }

        const { partsCache, partsByModel } = loadPartsData();

        // 从数据库查价的辅助函数（取同型号最低价）
        const getPrice = (model) => {
            const suppliers = partsByModel[model] || [];
            if (suppliers.length === 0) return 0;
            return suppliers.reduce((min, curr) => curr.price < min.price ? curr : min, suppliers[0]).price;
        };

        // 智能推导线径：先从线圈成本表按(规格,片数)查默认线径，查不到则兜底
        const dbWire = resolveWireFromStator(statorSpec, statorSheets);
        const resolvedWire = resolveWire(dbWire, cableWire || floatWire);

        let totalCost = 0;
        const details = [];

        // 浮球
        if (hasFloat) {
            const wire = floatWire || resolvedWire;
            const model = `浮球-线径${wire}`;
            const price = getPrice(model);
            const subtotal = price * 1;
            totalCost += subtotal;
            details.push({ name: '浮球', model, price: price.toFixed(2), qty: 1, subtotal: subtotal.toFixed(2) });
        }

        // 电缆（智能判断：显式 hasCable=true 或 cableLength>0 都算有电缆）
        const needCable = hasCable || (cableLength && Number(cableLength) > 0);
        if (needCable && cableLength && Number(cableLength) > 0) {
            const wire = cableWire || resolvedWire;
            const cableModel = `电缆-线径${wire}`;
            const cablePrice = getPrice(cableModel);
            const len = Number(cableLength);
            const cableSubtotal = cablePrice * len;
            totalCost += cableSubtotal;
            details.push({ name: '电缆线', model: cableModel, price: cablePrice.toFixed(2), qty: len, subtotal: cableSubtotal.toFixed(2) });

            const accModel = '电缆配件费';
            const accPrice = getPrice(accModel);
            totalCost += accPrice;
            details.push({ name: '电缆接头配件', model: accModel, price: accPrice.toFixed(2), qty: 1, subtotal: accPrice.toFixed(2) });
        }

        // 包材（支持模糊匹配：传"木箱"或"纸箱"时自动在包装类别中查找）
        if (boxType) {
            let matchedModel = boxType;
            let price = getPrice(boxType);

            // 如果精确匹配查不到价格，尝试在包装类别中模糊匹配
            if (price === 0) {
                const keyword = boxType.trim();
                // 遍历 partsCache 找所有包装类别中型号包含关键词的零件
                const candidates = [];
                for (const [model, info] of Object.entries(partsCache)) {
                    if (info.category === '包装' && model.includes(keyword)) {
                        candidates.push({ model, price: info.price });
                    }
                }
                if (candidates.length > 0) {
                    // 取最低价的那个
                    const best = candidates.reduce((min, c) => c.price < min.price ? c : min, candidates[0]);
                    matchedModel = best.model;
                    price = best.price;
                }
            }

            totalCost += price;
            const name = matchedModel.includes('木') ? '木箱' : '纸箱';
            details.push({ name, model: matchedModel, price: price.toFixed(2), qty: 1, subtotal: price.toFixed(2) });
        }

        res.json({
            success: true,
            data: {
                totalCost: totalCost.toFixed(2),
                itemCount: details.length,
                resolvedWire,
                details
            }
        });

    } catch (error) {
        console.error('Dynamic config API Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 一站式成本计算（供N8N简化调用）
 * POST /api/cost/full-calculate
 *
 * 一次调用完成三步：
 *   1. 按泵壳型号查配方成本 (等同 GET /api/cost/recipe/by-name)
 *   2. 按定子规格-片数查线圈转子成本 (查线圈成本表)
 *   3. 计算动态配置成本 (浮球/电缆/包材，等同 POST /api/cost/dynamic-config)
 *
 * 请求体：
 * {
 *   "pumphousing_model": "V750",   // 泵壳型号（用于查配方）
 *   "stator": "12-120",            // 定子规格-片数（用于查线圈成本+推导线径）
 *   "cableLength": 10,             // 电缆长度（米），可选
 *   "boxType": "木箱",              // 包材型号，可选，支持模糊匹配
 *   "hasFloat": true,              // 是否带浮球，可选
 *   "floatWire": "",               // 浮球线径，可选（不传则自动推导）
 *   "cableWire": ""                // 电缆线径，可选（不传则自动推导）
 * }
 */
app.post('/api/cost/full-calculate', async (req, res) => {
    try {
        const {
            pumphousing_model,
            stator,
            cableLength = 0,
            boxType = '',
            hasFloat = false,
            floatWire,
            cableWire
        } = req.body;

        const { partsCache, partsByModel } = loadPartsData();

        // 取同型号最低价
        const getPrice = (model) => {
            const suppliers = partsByModel[model] || [];
            if (suppliers.length === 0) return 0;
            return suppliers.reduce((min, curr) => curr.price < min.price ? curr : min, suppliers[0]).price;
        };

        const result = {
            recipeCost: null,
            statorCost: null,
            dynamicCost: null,
            totalCost: '0',
            breakdown: {}
        };

        let grandTotal = 0;

        // ── 步骤1: 配方成本 ──
        if (pumphousing_model) {
            try {
                const allRecipes = dbGetAllRecipes();
                const recipe = allRecipes.find(r => {
                    const name = r.配方名称 || r.name || '';
                    return name.includes(pumphousing_model);
                });

                if (recipe) {
                    const partsJson = recipe.配件JSON || recipe.parts_json || '[]';
                    let parts = [];
                    try { parts = JSON.parse(partsJson); } catch (e) { /* ignore */ }

                    const recipeCostResult = calculateRecipeCost(parts, partsCache, partsByModel);
                    result.recipeCost = {
                        recipeName: recipe.配方名称 || recipe.name,
                        recipeSpec: recipe.规格 || recipe.spec,
                        ...recipeCostResult
                    };
                    grandTotal += parseFloat(recipeCostResult.totalCost);
                } else {
                    result.recipeCost = { error: `未找到名称包含 "${pumphousing_model}" 的配方` };
                }
            } catch (e) {
                result.recipeCost = { error: '查询配方失败: ' + e.message };
            }
        }

        // ── 步骤2: 线圈转子成本 ──
        let statorSpec, statorSheets;
        if (stator && typeof stator === 'string' && stator.includes('-')) {
            const [s, sh] = stator.split('-');
            statorSpec = s.trim();
            statorSheets = sh.trim();
        }

        if (statorSpec && statorSheets) {
            try {
                // 查线圈成本表
                const statorRecord = coilRow(db.prepare('SELECT * FROM coils WHERE spec = ? AND sheets = ? LIMIT 1').get(statorSpec, parseInt(statorSheets)));

                if (statorRecord) {
                    const cost = parseFloat(statorRecord.成本 || statorRecord.cost || 0);
                    result.statorCost = {
                        spec: statorSpec,
                        sheets: statorSheets,
                        cost: cost.toFixed(2),
                        wireGauge: statorRecord.默认线径 || null,
                        source: '精确匹配'
                    };
                    grandTotal += cost;
                } else {
                    // 没精确匹配到——查同规格的基础数据以便参考
                    const baseRecords = db.prepare('SELECT * FROM coils WHERE spec = ? LIMIT 10').all(statorSpec).map(coilRow);

                    if (baseRecords.length > 0) {
                        // 取第一条作为基准获取单价等字段
                        const base = baseRecords[0];
                        const unitPrice = parseFloat(base.单价 || 0);
                        const wireWeight = parseFloat(base.线重 || 0);
                        const copperBase = parseFloat(base.铜价基数 || 0);
                        const coilFee = parseFloat(base.线圈加工费用 || 0);
                        const rotorFee = parseFloat(base.转子加工费用 || 0);
                        const sheets = parseInt(statorSheets);

                        const calculatedCost = unitPrice * sheets + wireWeight * copperBase + coilFee + rotorFee;

                        result.statorCost = {
                            spec: statorSpec,
                            sheets: statorSheets,
                            cost: calculatedCost.toFixed(2),
                            wireGauge: base.默认线径 || null,
                            source: '公式推算',
                            formula: `${unitPrice}×${sheets} + ${wireWeight}×${copperBase} + ${coilFee} + ${rotorFee}`
                        };
                        grandTotal += calculatedCost;
                    } else {
                        result.statorCost = { error: `未找到规格 ${statorSpec} 的线圈数据` };
                    }
                }
            } catch (e) {
                result.statorCost = { error: '查询线圈成本失败: ' + e.message };
            }
        }

        // ── 步骤3: 动态配置成本 (浮球/电缆/包材) ──
        const dbWire = statorSpec && statorSheets
            ? resolveWireFromStator(statorSpec, statorSheets)
            : null;
        const resolvedWire = resolveWire(dbWire, cableWire || floatWire);

        let dynamicTotal = 0;
        const dynamicDetails = [];

        // 浮球
        if (hasFloat) {
            const wire = floatWire || resolvedWire;
            const model = `浮球-线径${wire}`;
            const price = getPrice(model);
            dynamicTotal += price;
            dynamicDetails.push({ name: '浮球', model, price: price.toFixed(2), qty: 1, subtotal: price.toFixed(2) });
        }

        // 电缆
        if (cableLength && Number(cableLength) > 0) {
            const wire = cableWire || resolvedWire;
            const cableModel = `电缆-线径${wire}`;
            const cablePrice = getPrice(cableModel);
            const len = Number(cableLength);
            const cableSubtotal = cablePrice * len;
            dynamicTotal += cableSubtotal;
            dynamicDetails.push({ name: '电缆线', model: cableModel, price: cablePrice.toFixed(2), qty: len, subtotal: cableSubtotal.toFixed(2) });

            const accModel = '电缆配件费';
            const accPrice = getPrice(accModel);
            dynamicTotal += accPrice;
            dynamicDetails.push({ name: '电缆接头配件', model: accModel, price: accPrice.toFixed(2), qty: 1, subtotal: accPrice.toFixed(2) });
        }

        // 包材
        if (boxType) {
            let matchedModel = boxType;
            let price = getPrice(boxType);

            if (price === 0) {
                const keyword = boxType.trim();
                const candidates = [];
                for (const [model, info] of Object.entries(partsCache)) {
                    if (info.category === '包装' && model.includes(keyword)) {
                        candidates.push({ model, price: info.price });
                    }
                }
                if (candidates.length > 0) {
                    const best = candidates.reduce((min, c) => c.price < min.price ? c : min, candidates[0]);
                    matchedModel = best.model;
                    price = best.price;
                }
            }

            dynamicTotal += price;
            const name = matchedModel.includes('木') ? '木箱' : '纸箱';
            dynamicDetails.push({ name, model: matchedModel, price: price.toFixed(2), qty: 1, subtotal: price.toFixed(2) });
        }

        result.dynamicCost = {
            totalCost: dynamicTotal.toFixed(2),
            resolvedWire,
            details: dynamicDetails
        };
        grandTotal += dynamicTotal;

        // ── 汇总 ──
        result.totalCost = grandTotal.toFixed(2);
        result.breakdown = {
            recipeCost: result.recipeCost?.totalCost || '0',
            statorCost: result.statorCost?.cost || '0',
            dynamicCost: dynamicTotal.toFixed(2)
        };

        res.json({ success: true, data: result });

    } catch (error) {
        console.error('Full Calculate API Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// 铜价抓取 & 定时更新
// ============================================

/**
 * 从曲合期货网AJAX接口获取最新铜价
 * 返回 元/吨 的价格
 */
async function fetchCopperPrice() {
    const url = 'https://m.quheqihuo.com/dz/ajax/js_data_history.html?id=746&size=1';
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://m.quheqihuo.com/dz/js-d746.html'
        }
    });
    const json = await response.json();
    if (json.code !== 0 || !json.data || json.data.length === 0) {
        throw new Error('铜价数据获取失败: ' + JSON.stringify(json));
    }
    return json.data[0].price; // 元/吨
}

/**
 * 更新所有线圈记录的铜价基数，并重新计算成本
 * copperPricePerTon: 元/吨，需要转换成 元/千克 (÷1000)
 */
async function updateAllCoilsCopperPrice(copperPricePerTon) {
    const copperPricePerKg = (copperPricePerTon / 1000).toFixed(2);
    console.log(`[铜价更新] 获取铜价: ${copperPricePerTon} 元/吨 → ${copperPricePerKg} 元/千克`);
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
    console.log(`[铜价更新] 已更新 ${allCoils.length} 条线圈记录的铜价基数为 ${copperPricePerKg}`);
    return { copperPricePerTon, copperPricePerKg, updatedCount: allCoils.length };
}

/**
 * 执行铜价更新任务
 */
async function runCopperPriceUpdate() {
    try {
        const price = await fetchCopperPrice();
        const result = await updateAllCoilsCopperPrice(price);
        console.log('[铜价更新] 完成:', result);
        return result;
    } catch (err) {
        console.error('[铜价更新] 失败:', err.message);
        return null;
    }
}

/**
 * 定时任务：每天北京时间 15:00 更新铜价
 * 使用 setInterval 每分钟检查一次
 */
let lastCopperUpdateDate = '';
setInterval(() => {
    const now = new Date();
    // 转北京时间 (UTC+8)
    const bjHour = (now.getUTCHours() + 8) % 24;
    const bjMinute = now.getUTCMinutes();
    const dateKey = now.toISOString().slice(0, 10);

    // 每天15:00 (±1分钟窗口) 且今天没更新过
    if (bjHour === 15 && bjMinute === 0 && lastCopperUpdateDate !== dateKey) {
        lastCopperUpdateDate = dateKey;
        console.log('[定时任务] 触发每日铜价更新...');
        runCopperPriceUpdate();
    }
}, 60 * 1000); // 每分钟检查


// ── 手动触发铜价更新 ──
app.post('/api/copper-price/update', async (req, res) => {
    try {
        const result = await runCopperPriceUpdate();
        if (result) {
            res.json({ success: true, data: result });
        } else {
            res.status(500).json({ success: false, error: '铜价更新失败' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── 获取当前铜价 ──
app.get('/api/copper-price', async (req, res) => {
    try {
        const price = await fetchCopperPrice();
        // 同时获取数据库中的铜价基数
        const coils = dbGetAllCoils();
        const dbCopperPrice = coils.length > 0 ? coils[0].铜价基数 : null;
        res.json({
            success: true,
            data: {
                livePrice: price,                        // 元/吨 (实时)
                livePricePerKg: (price / 1000).toFixed(2), // 元/千克
                dbPrice: dbCopperPrice,                   // 数据库中的铜价基数
                lastUpdate: coils[0]?.UpdatedAt || null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// ============================================
// 线圈转子 CRUD API
// ============================================

/**
 * GET /api/coils - 获取所有线圈记录
 */
app.get('/api/coils', async (req, res) => {
    try {
        const coils = dbGetAllCoils();
        res.json({ success: true, data: coils });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/coils - 创建线圈记录
 */
app.post('/api/coils', async (req, res) => {
    try {
        const { 规格, 单价, 片数, 默认线重, 铜价基数, 线圈加工费, 转子加工费, 默认电容_uf, 默认线径 } = req.body;

        if (!规格 || !片数) {
            return res.status(400).json({ success: false, error: '规格和片数为必填项' });
        }

        const unitPrice = parseFloat(单价 || 0);
        const sheets = parseInt(片数);
        const wireWeight = parseFloat(默认线重 || 0);
        const copperBase = parseFloat(铜价基数 || 0);
        const coilFee = parseFloat(线圈加工费 || 0);
        const rotorFee = parseFloat(转子加工费 || 0);
        const cost = unitPrice * sheets + wireWeight * copperBase + coilFee + rotorFee;

        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO coils (spec, sheets, unit_price, wire_weight, copper_base, coil_fee, rotor_fee, cost, default_wire_gauge, default_capacitor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            规格, sheets, unitPrice, wireWeight, copperBase, coilFee, rotorFee, cost.toFixed(5), 默认线径 || null, 默认电容_uf || null, now, now
        );
        const record = coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(info.lastInsertRowid));

        res.json({ success: true, data: record });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH /api/coils/:id - 更新线圈记录
 */
app.patch('/api/coils/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const updates = { ...req.body, Id: id };

        // 如果更新了影响成本的字段，重新计算
        if (updates.单价 !== undefined || updates.片数 !== undefined ||
            updates.默认线重 !== undefined || updates.铜价基数 !== undefined ||
            updates.线圈加工费 !== undefined || updates.转子加工费 !== undefined) {

            // 获取当前记录以合并
            const current = coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(id));
            if (current) {
                const merged = { ...current, ...updates };
                const unitPrice = parseFloat(merged.单价 || 0);
                const sheets = parseInt(merged.片数 || 0);
                const wireWeight = parseFloat(merged.默认线重 || 0);
                const copperBase = parseFloat(merged.铜价基数 || 0);
                const coilFee = parseFloat(merged.线圈加工费 || 0);
                const rotorFee = parseFloat(merged.转子加工费 || 0);
                updates.成本 = (unitPrice * sheets + wireWeight * copperBase + coilFee + rotorFee).toFixed(5);
            }
        }

        const uId = updates.Id || updates.id;
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
        db.prepare(`UPDATE coils SET ${uSets.join(', ')} WHERE id = ?`).run(...uVals);
        const record = coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(uId));

        res.json({ success: true, data: record });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/coils/:id - 删除线圈记录
 */
app.delete('/api/coils/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        db.prepare('DELETE FROM coils WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// 零件 CRUD
// ============================================

/** GET /api/parts - 获取所有零件 */
app.get('/api/parts', async (req, res) => {
    try {
        const records = dbGetAllParts();
        res.json({ success: true, data: records });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** POST /api/parts - 创建零件 */
app.post('/api/parts', async (req, res) => {
    try {
        const f = extractPartFields(req.body);
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO parts (model, category, price, supplier, stock, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(f.model, f.category, f.price, f.supplier, f.stock, f.remark, now, now);
        const record = partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(info.lastInsertRowid));
        res.json({ success: true, data: record });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** PATCH /api/parts - 更新零件 */
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
        if (req.body.notes !== undefined || req.body.remark !== undefined || req.body.备注 !== undefined) { sets.push('remark = ?'); vals.push(f.remark); }
        sets.push('updated_at = ?'); vals.push(now); vals.push(id);
        db.prepare(`UPDATE parts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        const record = partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(id));
        res.json({ success: true, data: record });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** DELETE /api/parts - 删除零件 */
app.delete('/api/parts', async (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        for (const item of items) { db.prepare('DELETE FROM parts WHERE id = ?').run(item.Id || item.id); }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// 配方 CRUD 代理
// ============================================

/** GET /api/recipes - 获取所有配方 */
app.get('/api/recipes', async (req, res) => {
    try {
        const records = dbGetAllRecipes();
        res.json({ success: true, data: records });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** GET /api/recipes/:id - 获取单个配方 */
app.get('/api/recipes/:id', async (req, res) => {
    try {
        const record = recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(parseInt(req.params.id)));
        if (!record) return res.status(404).json({ success: false, error: '配方不存在' });
        res.json({ success: true, data: record });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** POST /api/recipes - 创建配方 */
app.post('/api/recipes', async (req, res) => {
    try {
        const b = req.body;
        const now = new Date().toISOString();
        const info = db.prepare(`INSERT INTO recipes (
            name, spec, parts_json, saved_total_cost, saved_cost_details,
            template_id, coil_spec, coil_sheets,
            has_float, float_wire, has_cable, cable_length, cable_wire,
            box_type, extra_parts_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            b.name || b.配方名称 || '',
            b.spec || b.规格 || '',
            b.parts_json || b.配件JSON || '[]',
            b.saved_total_cost ?? b.保存时总成本 ?? 0,
            b.saved_cost_details || b.保存时成本明细 || '[]',
            b.template_id || null,
            b.coil_spec || '',
            b.coil_sheets || 0,
            b.has_float || 0,
            b.float_wire || '',
            b.has_cable || 0,
            b.cable_length || 0,
            b.cable_wire || '',
            b.box_type || '',
            b.extra_parts_json || '[]',
            now, now
        );
        const record = recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(info.lastInsertRowid));
        res.json({ success: true, data: record });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** DELETE /api/recipes - 删除配方 */
app.delete('/api/recipes', async (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        for (const item of items) { db.prepare('DELETE FROM recipes WHERE id = ?').run(item.Id || item.id); }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** PATCH /api/recipes - 更新配方 */
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
        // 新增结构化字段
        if (b.template_id !== undefined) { sets.push('template_id = ?'); vals.push(b.template_id); }
        if (b.coil_spec !== undefined) { sets.push('coil_spec = ?'); vals.push(b.coil_spec); }
        if (b.coil_sheets !== undefined) { sets.push('coil_sheets = ?'); vals.push(b.coil_sheets); }
        if (b.has_float !== undefined) { sets.push('has_float = ?'); vals.push(b.has_float); }
        if (b.float_wire !== undefined) { sets.push('float_wire = ?'); vals.push(b.float_wire); }
        if (b.has_cable !== undefined) { sets.push('has_cable = ?'); vals.push(b.has_cable); }
        if (b.cable_length !== undefined) { sets.push('cable_length = ?'); vals.push(b.cable_length); }
        if (b.cable_wire !== undefined) { sets.push('cable_wire = ?'); vals.push(b.cable_wire); }
        if (b.box_type !== undefined) { sets.push('box_type = ?'); vals.push(b.box_type); }
        if (b.extra_parts_json !== undefined) { sets.push('extra_parts_json = ?'); vals.push(b.extra_parts_json); }
        sets.push('updated_at = ?'); vals.push(now); vals.push(id);
        if (sets.length > 1) db.prepare(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        const record = recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(id));
        res.json({ success: true, data: record });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// 泵壳模板 CRUD
// ============================================

/** GET /api/templates - 获取所有泵壳模板 */
app.get('/api/templates', async (req, res) => {
    try {
        const records = dbGetAllTemplates();
        res.json({ success: true, data: records });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** GET /api/templates/:id - 获取单个模板 */
app.get('/api/templates/:id', async (req, res) => {
    try {
        const record = templateRow(db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(parseInt(req.params.id)));
        if (!record) return res.status(404).json({ success: false, error: '模板不存在' });
        res.json({ success: true, data: record });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** GET /api/templates/:id/cost - 模板实时成本预览 */
app.get('/api/templates/:id/cost', async (req, res) => {
    try {
        const tpl = db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(parseInt(req.params.id));
        if (!tpl) return res.status(404).json({ success: false, error: '模板不存在' });

        let tplParts = [];
        try { tplParts = JSON.parse(tpl.parts_json || '[]'); } catch { /* ignore */ }

        const { partsCache, partsByModel } = loadPartsData();
        const result = calculateRecipeCost(tplParts.map(p => ({ ...p, supplier: '' })), partsCache, partsByModel);

        res.json({
            success: true,
            data: {
                templateId: tpl.id,
                shellModel: tpl.shell_model,
                ...result
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** GET /api/templates/:id/recipes - 引用此模板的所有配方 */
app.get('/api/templates/:id/recipes', async (req, res) => {
    try {
        const records = db.prepare('SELECT * FROM recipes WHERE template_id = ?').all(parseInt(req.params.id)).map(recipeRow);
        res.json({ success: true, data: records });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** POST /api/templates - 创建泵壳模板 */
app.post('/api/templates', async (req, res) => {
    try {
        const { shell_model, description, parts_json } = req.body;
        if (!shell_model) return res.status(400).json({ success: false, error: '泵壳型号为必填项' });

        const now = new Date().toISOString();
        const pJson = typeof parts_json === 'string' ? parts_json : JSON.stringify(parts_json || []);
        const info = db.prepare('INSERT INTO pump_shell_templates (shell_model, description, parts_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
            shell_model, description || '', pJson, now, now
        );
        const record = templateRow(db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(info.lastInsertRowid));
        res.json({ success: true, data: record });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint')) {
            return res.status(409).json({ success: false, error: `泵壳型号 "${req.body.shell_model}" 已存在` });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

/** PATCH /api/templates/:id - 更新模板 */
app.patch('/api/templates/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const b = req.body;
        const now = new Date().toISOString();
        const sets = []; const vals = [];
        if (b.shell_model !== undefined) { sets.push('shell_model = ?'); vals.push(b.shell_model); }
        if (b.description !== undefined) { sets.push('description = ?'); vals.push(b.description); }
        if (b.parts_json !== undefined) {
            const pJson = typeof b.parts_json === 'string' ? b.parts_json : JSON.stringify(b.parts_json);
            sets.push('parts_json = ?'); vals.push(pJson);
        }
        sets.push('updated_at = ?'); vals.push(now); vals.push(id);
        if (sets.length > 1) db.prepare(`UPDATE pump_shell_templates SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        const record = templateRow(db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(id));
        if (!record) return res.status(404).json({ success: false, error: '模板不存在' });
        res.json({ success: true, data: record });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint')) {
            return res.status(409).json({ success: false, error: `泵壳型号已存在` });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

/** DELETE /api/templates/:id - 删除模板 */
app.delete('/api/templates/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        // 检查是否有配方引用此模板
        const refs = db.prepare('SELECT COUNT(*) as cnt FROM recipes WHERE template_id = ?').get(id);
        if (refs.cnt > 0) {
            return res.status(409).json({ success: false, error: `有 ${refs.cnt} 个配方引用此模板，无法删除` });
        }
        db.prepare('DELETE FROM pump_shell_templates WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// 订单 CRUD 代理
// ============================================

/** GET /api/orders - 获取所有订单 */
app.get('/api/orders', async (req, res) => {
    try {
        const records = dbGetAllOrders();
        res.json({ success: true, data: records });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** GET /api/orders/:id - 获取单个订单 */
app.get('/api/orders/:id', async (req, res) => {
    try {
        const record = orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(req.params.id)));
        if (!record) return res.status(404).json({ success: false, error: '订单不存在' });
        res.json({ success: true, data: record });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** POST /api/orders - 创建订单 */
app.post('/api/orders', async (req, res) => {
    try {
        const b = req.body;
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO orders (customer_name, contract_no, remark, status, items_json, purchase_list_json, todos_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            b.客户名称 || b.customer_name || '', b.合同号 || b.contract_no || '', b.备注 || b.remark || '',
            b.订单状态 || b.status || '待采购', b.型号列表JSON || b.items_json || '[]',
            b.采购清单JSON || b.purchase_list_json || '[]', b.采购TodoJSON || b.todos_json || '[]', now, now
        );
        const record = orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid));
        res.json({ success: true, data: record });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** PATCH /api/orders - 更新订单 */
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
        db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        const record = orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
        res.json({ success: true, data: record });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/** DELETE /api/orders - 删除订单 */
app.delete('/api/orders', async (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        for (const item of items) { db.prepare('DELETE FROM orders WHERE id = ?').run(item.Id || item.id); }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// ============================================
// 线圈转子成本计算（支持插值）
// ============================================

/**
 * POST /api/coils/calculate
 * 
 * 请求体:
 * {
 *   "spec": "12",           // 定子规格
 *   "sheets": 130,          // 片数（可能不在数据库中）
 *   "wireWeight": null,     // 客户指定线重（可选，不传则用默认/插值）
 *   "copperPrice": null     // 铜价基数覆盖（可选，不传则用数据库中的）
 * }
 */
app.post('/api/coils/calculate', async (req, res) => {
    try {
        const { spec, sheets, wireWeight: customerWireWeight, copperPrice: customCopperPrice } = req.body;

        if (!spec || !sheets) {
            return res.status(400).json({ success: false, error: '规格和片数为必填项' });
        }

        const targetSheets = parseInt(sheets);

        // 获取同规格的所有记录，按片数排序
        const allCoils = dbGetAllCoils();
        const specCoils = allCoils
            .filter(c => String(c.规格).trim() === String(spec).trim())
            .sort((a, b) => parseInt(a.片数) - parseInt(b.片数));

        if (specCoils.length === 0) {
            return res.status(404).json({ success: false, error: `未找到规格 "${spec}" 的线圈数据` });
        }

        // 尝试精确匹配
        const exactMatch = specCoils.find(c => parseInt(c.片数) === targetSheets);

        let unitPrice, wireWeight, copperBase, coilFee, rotorFee, wireGauge, capacitor, source;

        if (exactMatch) {
            // 精确匹配
            unitPrice = parseFloat(exactMatch.单价 || 0);
            wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(exactMatch.默认线重 || 0);
            copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(exactMatch.铜价基数 || 0);
            coilFee = parseFloat(exactMatch.线圈加工费 || 0);
            rotorFee = parseFloat(exactMatch.转子加工费 || 0);
            wireGauge = exactMatch.默认线径 || null;
            capacitor = exactMatch.默认电容_uf || null;
            source = '精确匹配';
        } else {
            // 插值计算
            // 找到相邻的两个片数记录
            let lower = null, upper = null;

            for (let i = 0; i < specCoils.length; i++) {
                const s = parseInt(specCoils[i].片数);
                if (s < targetSheets) lower = specCoils[i];
                if (s > targetSheets && !upper) upper = specCoils[i];
            }

            if (lower && upper) {
                // 两端都有，线性插值
                const lowerSheets = parseInt(lower.片数);
                const upperSheets = parseInt(upper.片数);
                const ratio = (targetSheets - lowerSheets) / (upperSheets - lowerSheets);

                unitPrice = parseFloat(lower.单价 || 0); // 同规格单价一样
                const interpolatedWireWeight = parseFloat(lower.默认线重 || 0) +
                    (parseFloat(upper.默认线重 || 0) - parseFloat(lower.默认线重 || 0)) * ratio;
                wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(interpolatedWireWeight.toFixed(4));
                copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(lower.铜价基数 || 0);
                // 线圈加工费和转子加工费也插值
                coilFee = parseFloat(lower.线圈加工费 || 0) +
                    (parseFloat(upper.线圈加工费 || 0) - parseFloat(lower.线圈加工费 || 0)) * ratio;
                rotorFee = parseFloat(lower.转子加工费 || 0) +
                    (parseFloat(upper.转子加工费 || 0) - parseFloat(lower.转子加工费 || 0)) * ratio;
                wireGauge = lower.默认线径 || upper.默认线径 || null;
                capacitor = null;
                source = `插值(${lowerSheets}片↔${upperSheets}片, ratio=${ratio.toFixed(3)})`;
            } else if (lower) {
                // 超出上限，用最大片数的参数
                unitPrice = parseFloat(lower.单价 || 0);
                wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(lower.默认线重 || 0);
                copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(lower.铜价基数 || 0);
                coilFee = parseFloat(lower.线圈加工费 || 0);
                rotorFee = parseFloat(lower.转子加工费 || 0);
                wireGauge = lower.默认线径 || null;
                capacitor = null;
                source = `外推(基于${parseInt(lower.片数)}片)`;
            } else if (upper) {
                // 低于下限，用最小片数的参数
                unitPrice = parseFloat(upper.单价 || 0);
                wireWeight = customerWireWeight != null ? parseFloat(customerWireWeight) : parseFloat(upper.默认线重 || 0);
                copperBase = customCopperPrice != null ? parseFloat(customCopperPrice) : parseFloat(upper.铜价基数 || 0);
                coilFee = parseFloat(upper.线圈加工费 || 0);
                rotorFee = parseFloat(upper.转子加工费 || 0);
                wireGauge = upper.默认线径 || null;
                capacitor = null;
                source = `外推(基于${parseInt(upper.片数)}片)`;
            }
        }

        const totalCost = unitPrice * targetSheets + wireWeight * copperBase + coilFee + rotorFee;

        res.json({
            success: true,
            data: {
                spec,
                sheets: targetSheets,
                unitPrice,
                wireWeight,
                copperBase,
                coilFee: parseFloat(coilFee.toFixed(2)),
                rotorFee: parseFloat(rotorFee.toFixed(2)),
                wireGauge,
                capacitor,
                totalCost: parseFloat(totalCost.toFixed(2)),
                formula: `${unitPrice}×${targetSheets} + ${wireWeight}×${copperBase} + ${coilFee.toFixed(2)} + ${rotorFee.toFixed(2)}`,
                source,
                isCustomWireWeight: customerWireWeight != null
            }
        });

    } catch (error) {
        console.error('Coil Calculate API Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/coils/specs - 获取所有可用规格列表
 */
app.get('/api/coils/specs', async (req, res) => {
    try {
        const allCoils = dbGetAllCoils();
        const specsMap = {};
        allCoils.forEach(c => {
            const spec = c.规格;
            if (!specsMap[spec]) {
                specsMap[spec] = { spec, unitPrice: c.单价, sheets: [], count: 0 };
            }
            specsMap[spec].sheets.push(parseInt(c.片数));
            specsMap[spec].count++;
        });
        // 排序 sheets
        Object.values(specsMap).forEach(s => s.sheets.sort((a, b) => a - b));

        res.json({ success: true, data: Object.values(specsMap) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// ============================================
// AI 智能助手
// ============================================

const AI_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'query_recipe_cost_by_name',
            description: '通过配方名称查询最新成本。当用户说"V750的成本是多少"时使用',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '配方名称或泵壳型号' }
                },
                required: ['name']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'query_recipe_cost_by_id',
            description: '通过配方ID查成本',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'number', description: '配方ID' }
                },
                required: ['id']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'full_calculate',
            description: '一站式BOM综合计算（配方+线圈+浮球+电缆+包材）。当用户提到完整报价、总成本时使用',
            parameters: {
                type: 'object',
                properties: {
                    pumphousing_model: { type: 'string', description: '泵壳型号' },
                    stator: { type: 'string', description: '定子规格-片数，如"12-120"' },
                    hasFloat: { type: 'boolean', description: '是否带浮球' },
                    cableLength: { type: 'number', description: '电缆长度（米）' },
                    boxType: { type: 'string', description: '包装类型' },
                    floatWire: { type: 'string', description: '浮球线径（可选）' },
                    cableWire: { type: 'string', description: '电缆线径（可选）' }
                },
                required: ['pumphousing_model']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_copper_price',
            description: '获取实时铜价（元/吨、元/千克）',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'calculate_coil_cost',
            description: '计算线圈转子成本（支持插值）。用户说"12-140的线圈成本"时，拆分为spec=12,sheets=140',
            parameters: {
                type: 'object',
                properties: {
                    spec: { type: 'string', description: '定子规格' },
                    sheets: { type: 'number', description: '片数' },
                    wireWeight: { type: 'number', description: '自定义线重（可选）' }
                },
                required: ['spec', 'sheets']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_coil_specs',
            description: '获取数据库中所有可用的线圈规格及其片数列表',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_all_recipes',
            description: '获取所有配方列表',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_all_parts',
            description: '获取所有零件列表',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'dynamic_config_cost',
            description: '计算动态配置成本（浮球、电缆、包材）',
            parameters: {
                type: 'object',
                properties: {
                    stator: { type: 'string', description: '定子规格-片数' },
                    hasFloat: { type: 'boolean' },
                    cableLength: { type: 'number' },
                    boxType: { type: 'string' },
                    floatWire: { type: 'string' },
                    cableWire: { type: 'string' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_recent_orders',
            description: '获取最近的订单列表',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: '返回的订单数量，默认10' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_part',
            description: '新建/录入零件到数据库。当用户说"新建零件""添加零件""录入一个叫XX的零件"时使用',
            parameters: {
                type: 'object',
                properties: {
                    model: { type: 'string', description: '型号/名称' },
                    category: { type: 'string', description: '类别（如 轴承、螺丝、密封件、电容 等），默认"其他"' },
                    price: { type: 'number', description: '单价（元）' },
                    supplier: { type: 'string', description: '供应商名称，默认"-"' },
                    stock: { type: 'number', description: '初始库存数量，默认0' }
                },
                required: ['model', 'price']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_order',
            description: '新建订单。当用户说"新建订单""下一个订单""给XX客户开个订单"时使用。可以直接附带要生产的产品。',
            parameters: {
                type: 'object',
                properties: {
                    customerName: { type: 'string', description: '客户名称' },
                    contractNo: { type: 'string', description: '合同号（可选）' },
                    remark: { type: 'string', description: '备注（可选）' },
                    status: { type: 'string', description: '订单状态：待采购/采购中/已完成，默认"待采购"' },
                    items: {
                        type: 'array',
                        description: '要包含在订单中的产品配方列表（可选）',
                        items: {
                            type: 'object',
                            properties: {
                                recipeName: { type: 'string', description: '配方名称（尽量精确）' },
                                qty: { type: 'number', description: '需要的数量' }
                            },
                            required: ['recipeName', 'qty']
                        }
                    }
                },
                required: ['customerName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'add_recipe_to_order',
            description: '向已存在的订单中追加配方/产品。当用户说"给订单XX加一台YY"时使用',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单的ID号码' },
                    recipeName: { type: 'string', description: '要添加的配方名称或泵壳型号' },
                    qty: { type: 'number', description: '数量' }
                },
                required: ['orderId', 'recipeName', 'qty']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_part',
            description: '修改零件信息（价格、库存、供应商等）。当用户说"把XX零件的价格改成YY""XX的库存加10"时使用',
            parameters: {
                type: 'object',
                properties: {
                    model: { type: 'string', description: '要修改的零件型号/名称（用于查找）' },
                    price: { type: 'number', description: '新的单价（可选）' },
                    stock: { type: 'number', description: '新的库存数量（可选）' },
                    stockDelta: { type: 'number', description: '库存增减数量，正数增加负数减少（可选，与stock二选一）' },
                    supplier: { type: 'string', description: '新的供应商（可选）' },
                    category: { type: 'string', description: '新的类别（可选）' }
                },
                required: ['model']
            }
        }
    },
    // ── 第一组：订单全生命周期 ──
    {
        type: 'function',
        function: {
            name: 'get_order_detail',
            description: '查看某个订单的完整详情（含配方列表、采购清单、TODO）。当用户说"看看订单5""订单5的详情"时使用',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID' }
                },
                required: ['orderId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_order_status',
            description: '修改订单状态。当用户说"把订单5改成采购中""订单5完成了"时使用',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID' },
                    status: { type: 'string', description: '新状态：待采购/采购中/已完成' }
                },
                required: ['orderId', 'status']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'remove_recipe_from_order',
            description: '从订单中移除某个配方/产品。当用户说"把订单5里的V750删掉"时使用',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID' },
                    recipeName: { type: 'string', description: '要移除的配方名称' }
                },
                required: ['orderId', 'recipeName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_order_item',
            description: '修改订单中某个配方的数量或出厂价。当用户说"把订单5里V750改成3台"或"V750出厂价改成120"时使用',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID' },
                    recipeName: { type: 'string', description: '要修改的配方名称' },
                    qty: { type: 'number', description: '新数量（可选）' },
                    unitPrice: { type: 'number', description: '新出厂价（可选）' },
                    profitMargin: { type: 'number', description: '新利润率倍数如1.15（可选）' }
                },
                required: ['orderId', 'recipeName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'generate_purchase_list',
            description: '为订单生成采购清单和采购TODO。自动汇总所有配方零件需求、扣减库存、按供应商分组。当用户说"生成订单5的采购清单"时使用',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '订单ID' }
                },
                required: ['orderId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_order',
            description: '彻底删除一个订单。当用户说"删掉订单5"时使用',
            parameters: {
                type: 'object',
                properties: {
                    orderId: { type: 'number', description: '要删除的订单ID' }
                },
                required: ['orderId']
            }
        }
    },
    // ── 第二组：配方管理 ──
    {
        type: 'function',
        function: {
            name: 'create_recipe',
            description: '新建配方。当用户说"新建配方XX"时使用。零件可用简化格式如 [{model:"201轴承",qty:2}]，后端会自动匹配完整信息',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '配方名称' },
                    spec: { type: 'string', description: '规格（如1寸、1.5寸）' },
                    parts: {
                        type: 'array',
                        description: '零件列表',
                        items: {
                            type: 'object',
                            properties: {
                                model: { type: 'string', description: '零件型号' },
                                qty: { type: 'number', description: '数量' }
                            },
                            required: ['model', 'qty']
                        }
                    }
                },
                required: ['name']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_recipe',
            description: '删除配方。当用户说"删掉配方XX"时使用',
            parameters: {
                type: 'object',
                properties: {
                    recipeName: { type: 'string', description: '要删除的配方名称' }
                },
                required: ['recipeName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_recipe',
            description: '修改配方信息（名称、规格、增减零件）。当用户说"把V750配方里的XX换成YY"或"给V750配方加个零件"时使用',
            parameters: {
                type: 'object',
                properties: {
                    recipeName: { type: 'string', description: '要修改的配方名称（用于查找）' },
                    newName: { type: 'string', description: '新名称（可选）' },
                    newSpec: { type: 'string', description: '新规格（可选）' },
                    addParts: {
                        type: 'array',
                        description: '要添加的零件（可选）',
                        items: {
                            type: 'object',
                            properties: { model: { type: 'string' }, qty: { type: 'number' } },
                            required: ['model', 'qty']
                        }
                    },
                    removeParts: {
                        type: 'array',
                        description: '要移除的零件型号列表（可选）',
                        items: { type: 'string' }
                    },
                    updateParts: {
                        type: 'array',
                        description: '要修改数量的零件（可选）',
                        items: {
                            type: 'object',
                            properties: { model: { type: 'string' }, qty: { type: 'number' } },
                            required: ['model', 'qty']
                        }
                    }
                },
                required: ['recipeName']
            }
        }
    },
    // ── 第三组：数据分析与辅助 ──
    {
        type: 'function',
        function: {
            name: 'compare_recipes',
            description: '对比两个配方的BOM和成本差异。当用户说"对比V750和V550"时使用',
            parameters: {
                type: 'object',
                properties: {
                    recipe1: { type: 'string', description: '配方1名称' },
                    recipe2: { type: 'string', description: '配方2名称' }
                },
                required: ['recipe1', 'recipe2']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_parts',
            description: '按关键词或类别搜索零件。当用户说"找所有密封件""有没有叫XX的零件"时使用',
            parameters: {
                type: 'object',
                properties: {
                    keyword: { type: 'string', description: '搜索关键词（模糊匹配型号/名称）' },
                    category: { type: 'string', description: '按类别筛选（可选）' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_part',
            description: '删除一个零件。当用户说"删掉零件XX"时使用',
            parameters: {
                type: 'object',
                properties: {
                    model: { type: 'string', description: '要删除的零件型号' }
                },
                required: ['model']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'batch_update_prices',
            description: '按类别批量调整零件价格。当用户说"把所有轴承涨价10%""密封件统一降2元"时使用',
            parameters: {
                type: 'object',
                properties: {
                    category: { type: 'string', description: '零件类别' },
                    percentChange: { type: 'number', description: '百分比变化（如10表示涨10%，-5表示降5%）' },
                    absoluteChange: { type: 'number', description: '绝对值变化（如2表示涨2元，-1表示降1元），与percentChange二选一' }
                },
                required: ['category']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_dashboard_summary',
            description: '获取运营数据汇总（订单统计、配方数量、零件数量、成本/利润等）。当用户说"最近的运营数据""系统概况"时使用',
            parameters: { type: 'object', properties: {} }
        }
    }
];

let AI_SYSTEM_PROMPT = `你是水泵BOM管理系统的智能助手，专门帮助用户查询成本、配方、零件、铜价、线圈数据，以及执行数据库写操作。

你的能力：
1. 查询配方成本（按名称或ID）
2. 一站式BOM综合计算（配方+线圈+浮球+电缆+包材）
3. 查询实时铜价
4. 计算线圈转子成本（支持插值）
5. 查看可用的线圈规格
6. 列出所有配方或零件
7. 计算动态配置成本（浮球/电缆/包材单独计算）
8. 查看最近的订单列表
9. 新建/录入零件（直接写入数据库，会回读验证）
10. 新建订单（客户名称必填，可选直接带上需要生产的配方和数量）
11. 修改零件信息（改价格、调库存、换供应商等）
12. 向已有订单中追加新配方（需订单ID、配方名称、数量）

数据库写操作规则：
- 所有写操作（新建、修改）都会回读验证，确认数据真正入库后才报告成功
- 如果验证失败，如实告诉用户失败原因
- 向订单挂载配方时，会自动抓取该配方的零件JSON并用当前最新零件价格动态核算UnitCost写入订单条目

线圈转子简写格式：
- 用户习惯用"规格-片数"的简写，如"12-140"表示规格12、片数140
- 收到这类格式时，自动拆分为 spec 和 sheets 参数调用 calculate_coil_cost

回答规则：
- 用简体中文回答
- 【重要】查询到的原始数据已经在前端以结构化表格/卡片自动展示给用户了，你不需要重复列出详细数据！
- 你只需给出简短的总结、解读或补充说明即可
- 金额保留2位小数，单位为「元」
- 如果查询失败，说明原因并建议替代方案
- 保持专业但友好的语气
- 不要编造数据，所有数据必须来自 function calling 的实际返回`;

/**
 * 从数据库加载 system prompt
 */
async function loadSystemPromptFromDB() {
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
}

/**
 * AI 工具执行器
 */
async function executeToolCall(toolName, args) {
    try {
        switch (toolName) {
            case 'query_recipe_cost_by_name': {
                const response = await fetch(`http://localhost:${PORT}/api/cost/recipe/by-name?name=${encodeURIComponent(args.name)}`);
                return await response.json();
            }

            case 'query_recipe_cost_by_id': {
                const response = await fetch(`http://localhost:${PORT}/api/cost/recipe/${args.id}`);
                return await response.json();
            }

            case 'full_calculate': {
                const response = await fetch(`http://localhost:${PORT}/api/cost/full-calculate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(args)
                });
                return await response.json();
            }

            case 'get_copper_price': {
                const response = await fetch(`http://localhost:${PORT}/api/copper-price`);
                return await response.json();
            }

            case 'calculate_coil_cost': {
                const response = await fetch(`http://localhost:${PORT}/api/coils/calculate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ spec: args.spec, sheets: args.sheets, wireWeight: args.wireWeight || null })
                });
                return await response.json();
            }

            case 'get_coil_specs': {
                const allCoils = dbGetAllCoils();
                const specsMap = {};
                allCoils.forEach(c => {
                    const spec = c.规格;
                    if (!specsMap[spec]) specsMap[spec] = { spec, unitPrice: c.单价, sheets: [], count: 0 };
                    specsMap[spec].sheets.push(parseInt(c.片数));
                    specsMap[spec].count++;
                });
                Object.values(specsMap).forEach(s => s.sheets.sort((a, b) => a - b));
                return { success: true, data: Object.values(specsMap) };
            }

            case 'get_all_recipes': {
                const recipes = dbGetAllRecipes();
                const summary = recipes.map(r => ({
                    id: r.Id,
                    name: r.配方名称 || r.name,
                    spec: r.规格 || r.spec,
                    savedCost: r.saved_total_cost || r.保存时总成本 || 0
                }));
                return { success: true, data: summary };
            }

            case 'get_all_parts': {
                const parts = dbGetAllParts();
                const summary = parts.map(p => ({
                    id: p.Id,
                    model: p.型号 || p.model,
                    category: p.类别 || p.category,
                    price: p.单价 || p.price,
                    supplier: p.供应商 || p.supplier,
                    stock: p.库存 || p.stock || 0
                }));
                return { success: true, data: summary };
            }

            case 'dynamic_config_cost': {
                const response = await fetch(`http://localhost:${PORT}/api/cost/dynamic-config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(args)
                });
                return await response.json();
            }

            case 'get_recent_orders': {
                const limit = args.limit || 10;
                const allOrders = dbGetAllOrders();
                const recentOrders = allOrders.sort((a, b) => b.Id - a.Id).slice(0, limit);
                const formattedOrders = recentOrders.map(o => ({
                    id: o.Id,
                    customer: o.客户名称 || o.customerName || '未知',
                    contract: o.合同号 || o.contractNo || '-',
                    status: o.订单状态 || o.status || '未知',
                    createdAt: o.CreatedAt || o.created_at || new Date().toISOString()
                }));
                return { success: true, data: formattedOrders };
            }

            case 'create_part': {
                const { model, category = '其他', price, supplier = '-', stock = 0 } = args;
                if (!model || price === undefined) {
                    return { success: false, error: '缺少必要参数：型号或单价' };
                }
                const body = {
                    '型号': model,
                    '类别': category,
                    '单价': price,
                    '供应商': supplier,
                    '库存': stock
                };

                // 1. 发起创建请求
                const now = new Date().toISOString();
                const createRes = db.prepare('INSERT INTO parts (model, category, price, supplier, stock, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(model, category, price, supplier, stock, now, now);
                createRes.Id = createRes.lastInsertRowid;

                const newId = createRes?.Id || createRes?.id;
                if (!newId) {
                    return { success: false, error: '数据库未返回有效ID，录入可能失败。返回内容: ' + JSON.stringify(createRes).slice(0, 200) };
                }

                // 2. 回读验证：确认记录真的写入了数据库
                try {
                    const verify = { list: [partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(newId))].filter(Boolean) };
                    if (!verify.list || verify.list.length === 0) {
                        return { success: false, error: `数据库返回了ID=${newId}，但回读验证失败，记录不存在` };
                    }
                    const saved = verify.list[0];
                    return {
                        success: true,
                        message: '零件新建成功（已验证入库）',
                        part: {
                            '型号': saved.型号 || model,
                            '类别': saved.类别 || category,
                            '单价': saved.单价 || price,
                            '供应商': saved.供应商 || supplier,
                            '库存': saved.库存 ?? stock
                        },
                        id: newId
                    };
                } catch (verifyErr) {
                    return { success: false, error: `创建请求已发送(ID=${newId})，但回读验证异常: ${verifyErr.message}` };
                }
            }

            case 'create_order': {
                const { customerName, contractNo = '', remark = '', status = '待采购', items = [] } = args;
                if (!customerName) {
                    return { success: false, error: '缺少必要参数：客户名称' };
                }

                let orderItems = [];
                if (items && items.length > 0) {
                    const allRecipes = dbGetAllRecipes();
                    const { partsCache, partsByModel } = loadPartsData();

                    for (const reqItem of items) {
                        const recipe = allRecipes.find(r => (r.配方名称 || r.name) === reqItem.recipeName || r.Id === Number(reqItem.recipeName) || (r.配方名称 || '').includes(reqItem.recipeName));
                        if (recipe) {
                            const partsJson = recipe.配件JSON || recipe.parts_json || '[]';
                            let parts = [];
                            try { parts = JSON.parse(partsJson); } catch (e) { }
                            const costRes = calculateRecipeCost(parts, partsCache, partsByModel);
                            const unitCost = parseFloat(costRes.totalCost || 0);
                            const profitMargin = 1.10;
                            const unitPrice = Math.round(unitCost * profitMargin * 100) / 100;
                            orderItems.push({
                                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + orderItems.length,
                                recipeId: recipe.Id,
                                recipeName: recipe.配方名称 || recipe.name,
                                spec: recipe.规格 || recipe.spec,
                                qty: reqItem.qty || 1,
                                partsJson: partsJson,
                                unitCost: unitCost,
                                profitMargin: profitMargin,
                                unitPrice: unitPrice
                            });
                        }
                    }
                }

                const body = {
                    '客户名称': customerName,
                    '合同号': contractNo,
                    '备注': remark,
                    '订单状态': status,
                    '型号列表JSON': JSON.stringify(orderItems),
                    '采购清单JSON': '[]',
                    '采购TodoJSON': '[]'
                };
                const now_o = new Date().toISOString();
                const createRes = db.prepare('INSERT INTO orders (customer_name, contract_no, remark, status, items_json, purchase_list_json, todos_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
                    body['客户名称'] || body.customer_name || '', body['合同号'] || body.contract_no || '', body['备注'] || body.remark || '',
                    body['订单状态'] || body.status || '待采购', body['型号列表JSON'] || body.items_json || '[]',
                    body['采购清单JSON'] || body.purchase_list_json || '[]', body['采购TodoJSON'] || body.todos_json || '[]', now_o, now_o
                );
                createRes.Id = createRes.lastInsertRowid;
                const newId = createRes?.Id || createRes?.id;
                if (!newId) {
                    return { success: false, error: '数据库未返回有效ID，订单创建可能失败' };
                }
                // 回读验证
                try {
                    const verify = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(newId))].filter(Boolean) };
                    if (!verify.list || verify.list.length === 0) {
                        return { success: false, error: `数据库返回了ID=${newId}，但回读验证失败` };
                    }
                    return {
                        success: true,
                        message: '订单新建成功（已验证入库）',
                        order: {
                            id: newId,
                            customerName,
                            contractNo,
                            remark,
                            status,
                            items: orderItems
                        }
                    };
                } catch (verifyErr) {
                    return { success: false, error: `创建请求已发送(ID=${newId})，但回读验证异常: ${verifyErr.message}` };
                }
            }

            case 'add_recipe_to_order': {
                const { orderId, recipeName, qty = 1 } = args;

                // 1. 获取配方
                const allRecipes = dbGetAllRecipes();
                const recipe = allRecipes.find(r => (r.配方名称 || r.name) === recipeName || r.Id === Number(recipeName) || (r.配方名称 || '').includes(recipeName));
                if (!recipe) return { success: false, error: '找不到匹配的配方: ' + recipeName };

                // 2. 获取订单
                let orderRow;
                try {
                    const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
                    orderRow = orderData.list?.[0];
                } catch (e) { }
                if (!orderRow) return { success: false, error: '找不到订单ID: ' + orderId };

                // 3. 更新型号列表
                let itemsList = [];
                try { itemsList = JSON.parse(orderRow.型号列表JSON || '[]'); } catch (e) { }

                const partsJson = recipe.配件JSON || recipe.parts_json || '[]';
                let parts = [];
                try { parts = JSON.parse(partsJson); } catch (e) { }
                const { partsCache, partsByModel } = loadPartsData();
                const recipeCostResult = calculateRecipeCost(parts, partsCache, partsByModel);
                const unitCost = parseFloat(recipeCostResult.totalCost || 0);

                const profitMargin = 1.10;
                const finalUnitPrice = Math.round(unitCost * profitMargin * 100) / 100;

                itemsList.push({
                    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                    recipeId: recipe.Id,
                    recipeName: recipe.配方名称 || recipe.name,
                    spec: recipe.规格 || recipe.spec,
                    qty: qty,
                    partsJson: partsJson,
                    unitCost: unitCost,
                    profitMargin: profitMargin,
                    unitPrice: finalUnitPrice
                });

                // 4. 更新到数据库
                {
                    const _ob = {
                        Id: orderRow.Id,
                        型号列表JSON: JSON.stringify(itemsList)
                    };
                    const _oId = _ob.Id || _ob.id;
                    const _oSets = []; const _oVals = [];
                    if (_ob.订单状态) { _oSets.push('status = ?'); _oVals.push(_ob.订单状态); }
                    if (_ob.型号列表JSON) { _oSets.push('items_json = ?'); _oVals.push(_ob.型号列表JSON); }
                    if (_ob.采购清单JSON) { _oSets.push('purchase_list_json = ?'); _oVals.push(_ob.采购清单JSON); }
                    if (_ob.采购TodoJSON) { _oSets.push('todos_json = ?'); _oVals.push(_ob.采购TodoJSON); }
                    _oSets.push('updated_at = ?'); _oVals.push(new Date().toISOString()); _oVals.push(_oId);
                    db.prepare(`UPDATE orders SET ${_oSets.join(', ')} WHERE id = ?`).run(..._oVals);
                }

                return {
                    success: true,
                    message: `成功向订单${orderId}追加配方：${recipe.配方名称 || recipe.name}(数量: ${qty})`,
                    orderId,
                    itemName: recipe.配方名称 || recipe.name,
                    qty,
                    itemCost: unitCost,
                    itemPrice: finalUnitPrice
                };
            }

            case 'update_part': {
                const { model, price, stock, stockDelta, supplier, category } = args;
                if (!model) {
                    return { success: false, error: '缺少必要参数：零件型号' };
                }
                // 先查找该零件
                const allParts = dbGetAllParts();
                const target = allParts.find(p => (p.型号 || p.model || '') === model);
                if (!target) {
                    return { success: false, error: `未找到型号为"${model}"的零件` };
                }

                const updates = { Id: target.Id };
                const changes = [];
                if (price !== undefined) {
                    updates['单价'] = price;
                    changes.push(`单价: ${target.单价 || target.price} → ${price}`);
                }
                if (stock !== undefined) {
                    updates['库存'] = stock;
                    changes.push(`库存: ${target.库存 || target.stock || 0} → ${stock}`);
                } else if (stockDelta !== undefined) {
                    const currentStock = Number(target.库存 || target.stock || 0);
                    const newStock = Math.max(0, currentStock + stockDelta);
                    updates['库存'] = newStock;
                    changes.push(`库存: ${currentStock} → ${newStock} (${stockDelta > 0 ? '+' : ''}${stockDelta})`);
                }
                if (supplier !== undefined) {
                    updates['供应商'] = supplier;
                    changes.push(`供应商: ${target.供应商 || target.supplier} → ${supplier}`);
                }
                if (category !== undefined) {
                    updates['类别'] = category;
                    changes.push(`类别: ${target.类别 || target.category} → ${category}`);
                }

                if (changes.length === 0) {
                    return { success: false, error: '没有指定任何要修改的字段' };
                }

                {
                    const uSets2 = []; const uVals2 = [];
                    if (updates['单价'] !== undefined) { uSets2.push('price = ?'); uVals2.push(updates['单价']); }
                    if (updates['库存'] !== undefined) { uSets2.push('stock = ?'); uVals2.push(updates['库存']); }
                    if (updates['供应商'] !== undefined) { uSets2.push('supplier = ?'); uVals2.push(updates['供应商']); }
                    if (updates['类别'] !== undefined) { uSets2.push('category = ?'); uVals2.push(updates['类别']); }
                    uSets2.push('updated_at = ?'); uVals2.push(new Date().toISOString()); uVals2.push(target.Id);
                    db.prepare(`UPDATE parts SET ${uSets2.join(', ')} WHERE id = ?`).run(...uVals2);
                }

                // 回读验证
                try {
                    const verify = { list: [partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(target.Id))].filter(Boolean) };
                    if (!verify.list || verify.list.length === 0) {
                        return { success: false, error: '回读验证失败，记录不存在' };
                    }
                    const saved = verify.list[0];
                    return {
                        success: true,
                        message: '零件修改成功（已验证）',
                        part: {
                            id: target.Id,
                            '型号': saved.型号 || model,
                            '类别': saved.类别,
                            '单价': saved.单价,
                            '供应商': saved.供应商,
                            '库存': saved.库存
                        },
                        changes
                    };
                } catch (verifyErr) {
                    return { success: false, error: `修改请求已发送，但回读验证异常: ${verifyErr.message}` };
                }
            }

            // ── 第一组：订单全生命周期 ──

            case 'get_order_detail': {
                const { orderId } = args;
                const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
                const row = orderData.list?.[0];
                if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
                let items = []; try { items = JSON.parse(row.型号列表JSON || '[]'); } catch (e) { }
                let purchaseList = []; try { purchaseList = JSON.parse(row.采购清单JSON || '[]'); } catch (e) { }
                let todos = []; try { todos = JSON.parse(row.采购TodoJSON || '[]'); } catch (e) { }
                // 计算汇总
                let totalCost = 0, totalPrice = 0;
                for (const it of items) { totalCost += (it.unitCost || 0) * (it.qty || 0); totalPrice += (it.unitPrice || 0) * (it.qty || 0); }
                return {
                    success: true,
                    order: {
                        id: row.Id,
                        customerName: row.客户名称,
                        contractNo: row.合同号 || '',
                        remark: row.备注 || '',
                        status: row.订单状态 || '待采购',
                        items,
                        purchaseList,
                        todos,
                        totalCost: Math.round(totalCost * 100) / 100,
                        totalPrice: Math.round(totalPrice * 100) / 100,
                        totalProfit: Math.round((totalPrice - totalCost) * 100) / 100,
                        createdAt: row.CreatedAt,
                        updatedAt: row.UpdatedAt
                    }
                };
            }

            case 'update_order_status': {
                const { orderId, status } = args;
                const validStatuses = ['待采购', '采购中', '已完成'];
                if (!validStatuses.includes(status)) return { success: false, error: `无效状态: ${status}，可选: ${validStatuses.join('/')}` };
                const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
                const row = orderData.list?.[0];
                if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
                const oldStatus = row.订单状态 || '待采购';
                {
                    const _ob = { Id: row.Id, 订单状态: status };
                    const _oId = _ob.Id || _ob.id;
                    const _oSets = []; const _oVals = [];
                    if (_ob.订单状态) { _oSets.push('status = ?'); _oVals.push(_ob.订单状态); }
                    if (_ob.型号列表JSON) { _oSets.push('items_json = ?'); _oVals.push(_ob.型号列表JSON); }
                    if (_ob.采购清单JSON) { _oSets.push('purchase_list_json = ?'); _oVals.push(_ob.采购清单JSON); }
                    if (_ob.采购TodoJSON) { _oSets.push('todos_json = ?'); _oVals.push(_ob.采购TodoJSON); }
                    _oSets.push('updated_at = ?'); _oVals.push(new Date().toISOString()); _oVals.push(_oId);
                    db.prepare(`UPDATE orders SET ${_oSets.join(', ')} WHERE id = ?`).run(..._oVals);
                }
                return { success: true, message: `订单${orderId}状态已更新`, orderId, oldStatus, newStatus: status, customerName: row.客户名称 };
            }

            case 'remove_recipe_from_order': {
                const { orderId, recipeName } = args;
                const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
                const row = orderData.list?.[0];
                if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
                let items = []; try { items = JSON.parse(row.型号列表JSON || '[]'); } catch (e) { }
                const before = items.length;
                items = items.filter(it => !(it.recipeName || '').includes(recipeName));
                if (items.length === before) return { success: false, error: `订单${orderId}中未找到包含\"${recipeName}\"的配方` };
                {
                    const _ob = { Id: row.Id, 型号列表JSON: JSON.stringify(items) };
                    const _oId = _ob.Id || _ob.id;
                    const _oSets = []; const _oVals = [];
                    if (_ob.订单状态) { _oSets.push('status = ?'); _oVals.push(_ob.订单状态); }
                    if (_ob.型号列表JSON) { _oSets.push('items_json = ?'); _oVals.push(_ob.型号列表JSON); }
                    if (_ob.采购清单JSON) { _oSets.push('purchase_list_json = ?'); _oVals.push(_ob.采购清单JSON); }
                    if (_ob.采购TodoJSON) { _oSets.push('todos_json = ?'); _oVals.push(_ob.采购TodoJSON); }
                    _oSets.push('updated_at = ?'); _oVals.push(new Date().toISOString()); _oVals.push(_oId);
                    db.prepare(`UPDATE orders SET ${_oSets.join(', ')} WHERE id = ?`).run(..._oVals);
                }
                return { success: true, message: `已从订单${orderId}中移除\"${recipeName}\"`, orderId, removed: before - items.length, remaining: items.length };
            }

            case 'update_order_item': {
                const { orderId, recipeName, qty, unitPrice, profitMargin } = args;
                const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
                const row = orderData.list?.[0];
                if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
                let items = []; try { items = JSON.parse(row.型号列表JSON || '[]'); } catch (e) { }
                const item = items.find(it => (it.recipeName || '').includes(recipeName));
                if (!item) return { success: false, error: `订单${orderId}中未找到\"${recipeName}\"` };
                const changes = [];
                if (qty !== undefined) { changes.push(`数量: ${item.qty} → ${qty}`); item.qty = qty; }
                if (unitPrice !== undefined) { changes.push(`出厂价: ${item.unitPrice} → ${unitPrice}`); item.unitPrice = unitPrice; }
                if (profitMargin !== undefined) {
                    changes.push(`利润率: ${item.profitMargin} → ${profitMargin}`);
                    item.profitMargin = profitMargin;
                    if (unitPrice === undefined) { item.unitPrice = Math.round(item.unitCost * profitMargin * 100) / 100; changes.push(`出厂价自动调整为: ${item.unitPrice}`); }
                }
                if (changes.length === 0) return { success: false, error: '没有指定要修改的字段' };
                {
                    const _ob = { Id: row.Id, 型号列表JSON: JSON.stringify(items) };
                    const _oId = _ob.Id || _ob.id;
                    const _oSets = []; const _oVals = [];
                    if (_ob.订单状态) { _oSets.push('status = ?'); _oVals.push(_ob.订单状态); }
                    if (_ob.型号列表JSON) { _oSets.push('items_json = ?'); _oVals.push(_ob.型号列表JSON); }
                    if (_ob.采购清单JSON) { _oSets.push('purchase_list_json = ?'); _oVals.push(_ob.采购清单JSON); }
                    if (_ob.采购TodoJSON) { _oSets.push('todos_json = ?'); _oVals.push(_ob.采购TodoJSON); }
                    _oSets.push('updated_at = ?'); _oVals.push(new Date().toISOString()); _oVals.push(_oId);
                    db.prepare(`UPDATE orders SET ${_oSets.join(', ')} WHERE id = ?`).run(..._oVals);
                }
                return { success: true, message: `订单${orderId}中\"${item.recipeName}\"已更新`, orderId, recipeName: item.recipeName, changes };
            }

            case 'generate_purchase_list': {
                const { orderId } = args;
                const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
                const row = orderData.list?.[0];
                if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
                let items = []; try { items = JSON.parse(row.型号列表JSON || '[]'); } catch (e) { }
                if (items.length === 0) return { success: false, error: '订单中没有任何配方，无法生成采购清单' };

                const allParts = dbGetAllParts();
                const partIndex = {};
                const partByModel = {};
                allParts.forEach(p => {
                    const m = (p.型号 || p.model || '').trim();
                    const s = (p.供应商 || p.supplier || '').trim();
                    if (m) { partIndex[`${m}|${s}`] = p; if (!partByModel[m]) partByModel[m] = p; }
                });

                // 汇总零件需求
                const merged = {};
                for (const item of items) {
                    let parts = []; try { parts = JSON.parse(item.partsJson || '[]'); } catch (e) { continue; }
                    for (const rp of parts) {
                        const key = rp.model;
                        if (merged[key]) { merged[key].totalQty += rp.qty * item.qty; }
                        else { merged[key] = { model: rp.model, name: rp.name || rp.model, supplier: rp.supplier || '', totalQty: rp.qty * item.qty }; }
                    }
                }

                const purchaseList = [];
                for (const [, m] of Object.entries(merged)) {
                    const dbPart = partIndex[`${m.model}|${m.supplier}`] || partByModel[m.model] || null;
                    const currentStock = Number(dbPart?.库存 ?? dbPart?.stock ?? 0);
                    const needToBuy = Math.max(0, m.totalQty - currentStock);
                    purchaseList.push({ model: m.model, name: m.name, supplier: m.supplier, totalQty: m.totalQty, currentStock, needToBuy, purchased: false, partId: dbPart?.Id });
                }
                purchaseList.sort((a, b) => a.supplier.localeCompare(b.supplier));

                // 生成 TODO
                const bySupplier = {};
                for (const p of purchaseList) {
                    if (p.needToBuy <= 0) continue;
                    if (!bySupplier[p.supplier]) bySupplier[p.supplier] = [];
                    bySupplier[p.supplier].push(p);
                }
                const todos = [];
                for (const [supplier, parts] of Object.entries(bySupplier)) {
                    const detail = parts.map(p => `${p.model}×${p.needToBuy}`).join(', ');
                    todos.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), supplier, description: `联系【${supplier}】采购：${detail}`, done: false });
                }

                // 写入订单
                {
                    const _ob = { Id: row.Id, 采购清单JSON: JSON.stringify(purchaseList), 采购TodoJSON: JSON.stringify(todos) };
                    const _oId = _ob.Id || _ob.id;
                    const _oSets = []; const _oVals = [];
                    if (_ob.订单状态) { _oSets.push('status = ?'); _oVals.push(_ob.订单状态); }
                    if (_ob.型号列表JSON) { _oSets.push('items_json = ?'); _oVals.push(_ob.型号列表JSON); }
                    if (_ob.采购清单JSON) { _oSets.push('purchase_list_json = ?'); _oVals.push(_ob.采购清单JSON); }
                    if (_ob.采购TodoJSON) { _oSets.push('todos_json = ?'); _oVals.push(_ob.采购TodoJSON); }
                    _oSets.push('updated_at = ?'); _oVals.push(new Date().toISOString()); _oVals.push(_oId);
                    db.prepare(`UPDATE orders SET ${_oSets.join(', ')} WHERE id = ?`).run(..._oVals);
                }

                return {
                    success: true,
                    message: `订单${orderId}采购清单已生成`,
                    orderId,
                    purchaseList,
                    todos,
                    summary: { totalParts: purchaseList.length, needToBuy: purchaseList.filter(p => p.needToBuy > 0).length, suppliers: [...new Set(purchaseList.filter(p => p.needToBuy > 0).map(p => p.supplier))] }
                };
            }

            case 'delete_order': {
                const { orderId } = args;
                const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
                const row = orderData.list?.[0];
                if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
                db.prepare('DELETE FROM orders WHERE id = ?').run(row.Id);
                return { success: true, message: `订单${orderId}已删除`, orderId, customerName: row.客户名称 };
            }

            // ── 第二组：配方管理 ──

            case 'create_recipe': {
                const { name, spec = '', parts = [] } = args;
                if (!name) return { success: false, error: '缺少配方名称' };

                // 解析零件：自动匹配零件库
                const allParts = dbGetAllParts();
                const recipeParts = [];
                for (const p of parts) {
                    const dbPart = allParts.find(dp => (dp.型号 || dp.model || '') === p.model || (dp.型号 || '').includes(p.model));
                    recipeParts.push({
                        model: p.model,
                        name: dbPart ? (dbPart.型号 || dbPart.model || p.model) : p.model,
                        supplier: dbPart ? (dbPart.供应商 || dbPart.supplier || '-') : '-',
                        qty: p.qty,
                        snapshotPrice: dbPart ? Number(dbPart.单价 || dbPart.price || 0) : 0
                    });
                }

                const { partsCache, partsByModel } = loadPartsData();
                const costRes = calculateRecipeCost(recipeParts, partsCache, partsByModel);

                const body = {
                    配方名称: name,
                    规格: spec,
                    配件JSON: JSON.stringify(recipeParts),
                    saved_total_cost: parseFloat(costRes.totalCost || 0),
                    saved_cost_details: JSON.stringify(costRes.details || [])
                };
                const now_r = new Date().toISOString();
                const createRes = db.prepare('INSERT INTO recipes (name, spec, parts_json, saved_total_cost, saved_cost_details, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
                    body.配方名称 || body.name, body.规格 || body.spec || '', body.配件JSON || body.parts_json || '[]',
                    body.saved_total_cost ?? 0, body.saved_cost_details || '[]', now_r, now_r
                );
                createRes.Id = createRes.lastInsertRowid;
                const newId = createRes?.Id || createRes?.id;
                if (!newId) return { success: false, error: '配方创建失败' };
                return { success: true, message: `配方\"${name}\"创建成功`, recipe: { id: newId, name, spec, partsCount: recipeParts.length, totalCost: costRes.totalCost } };
            }

            case 'delete_recipe': {
                const { recipeName } = args;
                const allRecipes = dbGetAllRecipes();
                const recipe = allRecipes.find(r => (r.配方名称 || r.name) === recipeName || (r.配方名称 || '').includes(recipeName));
                if (!recipe) return { success: false, error: '找不到配方: ' + recipeName };
                db.prepare('DELETE FROM recipes WHERE id = ?').run(recipe.Id);
                return { success: true, message: `配方\"${recipe.配方名称 || recipeName}\"已删除`, recipeName: recipe.配方名称 || recipeName };
            }

            case 'update_recipe': {
                const { recipeName, newName, newSpec, addParts = [], removeParts = [], updateParts = [] } = args;
                const allRecipes = dbGetAllRecipes();
                const recipe = allRecipes.find(r => (r.配方名称 || r.name) === recipeName || (r.配方名称 || '').includes(recipeName));
                if (!recipe) return { success: false, error: '找不到配方: ' + recipeName };

                let parts = []; try { parts = JSON.parse(recipe.配件JSON || recipe.parts_json || '[]'); } catch (e) { }
                const changes = [];

                // 移除零件
                if (removeParts.length > 0) {
                    const before = parts.length;
                    parts = parts.filter(p => !removeParts.some(rm => p.model === rm || (p.model || '').includes(rm)));
                    changes.push(`移除了${before - parts.length}个零件`);
                }
                // 修改零件数量
                for (const up of updateParts) {
                    const found = parts.find(p => p.model === up.model || (p.model || '').includes(up.model));
                    if (found) { changes.push(`${found.model}: 数量 ${found.qty} → ${up.qty}`); found.qty = up.qty; }
                }
                // 添加零件
                if (addParts.length > 0) {
                    const allPartsDb = dbGetAllParts();
                    for (const ap of addParts) {
                        const dbPart = allPartsDb.find(dp => (dp.型号 || dp.model || '') === ap.model || (dp.型号 || '').includes(ap.model));
                        parts.push({
                            model: ap.model,
                            name: dbPart ? (dbPart.型号 || dbPart.model || ap.model) : ap.model,
                            supplier: dbPart ? (dbPart.供应商 || dbPart.supplier || '-') : '-',
                            qty: ap.qty,
                            snapshotPrice: dbPart ? Number(dbPart.单价 || dbPart.price || 0) : 0
                        });
                        changes.push(`添加了 ${ap.model} × ${ap.qty}`);
                    }
                }

                const patchBody = { Id: recipe.Id, 配件JSON: JSON.stringify(parts) };
                if (newName) { patchBody.配方名称 = newName; changes.push(`名称: ${recipe.配方名称} → ${newName}`); }
                if (newSpec) { patchBody.规格 = newSpec; changes.push(`规格: ${recipe.规格} → ${newSpec}`); }

                // 重新计算成本
                const { partsCache: pc, partsByModel: pbm } = loadPartsData();
                const costRes = calculateRecipeCost(parts, pc, pbm);
                patchBody.saved_total_cost = parseFloat(costRes.totalCost || 0);
                patchBody.saved_cost_details = JSON.stringify(costRes.details || []);

                if (changes.length === 0) return { success: false, error: '没有指定任何修改' };
                {
                    const _rSets = []; const _rVals = [];
                    if (patchBody.配方名称) { _rSets.push('name = ?'); _rVals.push(patchBody.配方名称); }
                    if (patchBody.规格) { _rSets.push('spec = ?'); _rVals.push(patchBody.规格); }
                    if (patchBody.配件JSON) { _rSets.push('parts_json = ?'); _rVals.push(patchBody.配件JSON); }
                    if (patchBody.saved_total_cost !== undefined) { _rSets.push('saved_total_cost = ?'); _rVals.push(patchBody.saved_total_cost); }
                    if (patchBody.saved_cost_details) { _rSets.push('saved_cost_details = ?'); _rVals.push(patchBody.saved_cost_details); }
                    _rSets.push('updated_at = ?'); _rVals.push(new Date().toISOString()); _rVals.push(patchBody.Id);
                    db.prepare(`UPDATE recipes SET ${_rSets.join(', ')} WHERE id = ?`).run(..._rVals);
                }
                return { success: true, message: `配方\"${recipe.配方名称}\"修改成功`, recipeName: newName || recipe.配方名称, partsCount: parts.length, newCost: costRes.totalCost, changes };
            }

            // ── 第三组：数据分析与辅助 ──

            case 'compare_recipes': {
                const { recipe1, recipe2 } = args;
                const allRecipes = dbGetAllRecipes();
                const r1 = allRecipes.find(r => (r.配方名称 || r.name) === recipe1 || (r.配方名称 || '').includes(recipe1));
                const r2 = allRecipes.find(r => (r.配方名称 || r.name) === recipe2 || (r.配方名称 || '').includes(recipe2));
                if (!r1) return { success: false, error: '找不到配方: ' + recipe1 };
                if (!r2) return { success: false, error: '找不到配方: ' + recipe2 };

                const { partsCache: pc, partsByModel: pbm } = loadPartsData();
                let p1 = []; try { p1 = JSON.parse(r1.配件JSON || r1.parts_json || '[]'); } catch (e) { }
                let p2 = []; try { p2 = JSON.parse(r2.配件JSON || r2.parts_json || '[]'); } catch (e) { }
                const cost1 = calculateRecipeCost(p1, pc, pbm);
                const cost2 = calculateRecipeCost(p2, pc, pbm);

                // BOM对比
                const allModels = [...new Set([...p1.map(p => p.model), ...p2.map(p => p.model)])];
                const comparison = allModels.map(model => {
                    const in1 = p1.find(p => p.model === model);
                    const in2 = p2.find(p => p.model === model);
                    return { model, qty1: in1?.qty || 0, qty2: in2?.qty || 0, onlyIn: in1 && !in2 ? recipe1 : (!in1 && in2 ? recipe2 : '两者共有') };
                });

                return {
                    success: true,
                    recipe1: { name: r1.配方名称, spec: r1.规格, cost: cost1.totalCost, partsCount: p1.length },
                    recipe2: { name: r2.配方名称, spec: r2.规格, cost: cost2.totalCost, partsCount: p2.length },
                    costDiff: (parseFloat(cost1.totalCost) - parseFloat(cost2.totalCost)).toFixed(2),
                    comparison
                };
            }

            case 'search_parts': {
                const { keyword, category } = args;
                const allParts = dbGetAllParts();
                let results = allParts;
                if (keyword) { results = results.filter(p => (p.型号 || p.model || '').includes(keyword) || (p.类别 || p.category || '').includes(keyword) || (p.供应商 || p.supplier || '').includes(keyword)); }
                if (category) { results = results.filter(p => (p.类别 || p.category || '') === category || (p.类别 || p.category || '').includes(category)); }
                return {
                    success: true,
                    count: results.length,
                    parts: results.slice(0, 30).map(p => ({ id: p.Id, model: p.型号 || p.model, category: p.类别 || p.category, price: p.单价 || p.price, supplier: p.供应商 || p.supplier, stock: p.库存 || p.stock || 0 }))
                };
            }

            case 'delete_part': {
                const { model } = args;
                const allParts = dbGetAllParts();
                const target = allParts.find(p => (p.型号 || p.model || '') === model);
                if (!target) return { success: false, error: '找不到零件: ' + model };
                db.prepare('DELETE FROM parts WHERE id = ?').run(target.Id);
                return { success: true, message: `零件\"${model}\"已删除`, model };
            }

            case 'batch_update_prices': {
                const { category, percentChange, absoluteChange } = args;
                if (percentChange === undefined && absoluteChange === undefined) return { success: false, error: '需要指定percentChange或absoluteChange' };
                const allParts = dbGetAllParts();
                const targets = allParts.filter(p => (p.类别 || p.category || '') === category || (p.类别 || p.category || '').includes(category));
                if (targets.length === 0) return { success: false, error: `没有找到类别包含\"${category}\"的零件` };

                const updates = [];
                const details = [];
                for (const p of targets) {
                    const oldPrice = Number(p.单价 || p.price || 0);
                    let newPrice;
                    if (percentChange !== undefined) { newPrice = Math.round(oldPrice * (1 + percentChange / 100) * 100) / 100; }
                    else { newPrice = Math.round((oldPrice + absoluteChange) * 100) / 100; }
                    if (newPrice < 0) newPrice = 0;
                    updates.push({ Id: p.Id, 单价: newPrice });
                    details.push({ model: p.型号 || p.model, oldPrice, newPrice });
                }

                // PATCH 支持批量
                for (const u of updates) {
                    db.prepare('UPDATE parts SET price = ?, updated_at = ? WHERE id = ?').run(u.单价, new Date().toISOString(), u.Id);
                }

                return {
                    success: true,
                    message: `已批量更新${targets.length}个\"${category}\"类零件的价格`,
                    category,
                    count: targets.length,
                    changeType: percentChange !== undefined ? `${percentChange > 0 ? '+' : ''}${percentChange}%` : `${absoluteChange > 0 ? '+' : ''}${absoluteChange}元`,
                    details
                };
            }

            case 'get_dashboard_summary': {
                const allOrders = dbGetAllOrders();
                const allRecipes = dbGetAllRecipes();
                const allParts = dbGetAllParts();

                const statusCount = { 待采购: 0, 采购中: 0, 已完成: 0 };
                let totalOrderCost = 0, totalOrderPrice = 0;
                for (const o of allOrders) {
                    const s = o.订单状态 || '待采购';
                    if (statusCount[s] !== undefined) statusCount[s]++;
                    let items = []; try { items = JSON.parse(o.型号列表JSON || '[]'); } catch (e) { }
                    for (const it of items) { totalOrderCost += (it.unitCost || 0) * (it.qty || 0); totalOrderPrice += (it.unitPrice || 0) * (it.qty || 0); }
                }

                return {
                    success: true,
                    summary: {
                        orders: { total: allOrders.length, ...statusCount },
                        recipes: { total: allRecipes.length },
                        parts: { total: allParts.length },
                        financials: {
                            totalCost: Math.round(totalOrderCost * 100) / 100,
                            totalRevenue: Math.round(totalOrderPrice * 100) / 100,
                            totalProfit: Math.round((totalOrderPrice - totalOrderCost) * 100) / 100
                        }
                    }
                };
            }

            default:
                return { success: false, error: `未知工具: ${toolName}` };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── AI Chat SSE 端点 ──
app.post('/api/ai/chat', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (type, payload) => {
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    };

    try {
        const { messages } = req.body;
        send('status', { status: 'thinking', message: '正在理解您的问题...' });

        let currentMessages = [
            { role: 'system', content: AI_SYSTEM_PROMPT },
            ...messages
        ];

        const apiKey = process.env.DEEPSEEK_API_KEY;
        const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
        let maxRounds = 5;
        let done = false;

        while (!done && maxRounds-- > 0) {
            const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model,
                    messages: currentMessages,
                    tools: AI_TOOLS,
                    stream: false
                })
            });

            if (!aiRes.ok) {
                const text = await aiRes.text();
                send('error', { message: `DeepSeek API 错误: ${aiRes.status} ${text.slice(0, 200)}` });
                return res.end();
            }

            const data = await aiRes.json();
            if (data.error) {
                send('error', { message: data.error.message || 'API 调用失败' });
                return res.end();
            }

            const msg = data.choices[0].message;
            currentMessages.push({
                role: 'assistant',
                content: msg.content || "",
                tool_calls: msg.tool_calls
            });

            if (msg.tool_calls && msg.tool_calls.length > 0) {
                for (const tc of msg.tool_calls) {
                    const funcName = tc.function.name;
                    send('status', { status: 'calling', message: `正在调用: ${funcName}...` });

                    let args = {};
                    try { args = JSON.parse(tc.function.arguments); } catch (e) { /* ignore */ }

                    send('tool_call', { name: funcName, args });
                    const result = await executeToolCall(funcName, args);
                    send('tool_result', { name: funcName, result });

                    currentMessages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        name: funcName,
                        content: JSON.stringify(result)
                    });
                }
            } else {
                send('content', { content: msg.content || '' });
                send('done', {});
                done = true;
            }
        }

        if (!done) {
            send('error', { message: '工具调用轮次超限' });
        }
        res.end();
    } catch (err) {
        send('error', { message: err.message });
        res.end();
    }
});

// ── System Prompt 读取/修改 ──
app.get('/api/ai/system-prompt', (req, res) => {
    res.json({ success: true, data: AI_SYSTEM_PROMPT });
});

app.put('/api/ai/system-prompt', async (req, res) => {
    try {
        const { prompt } = req.body;
        AI_SYSTEM_PROMPT = prompt;

        // 持久化到 SQLite
        db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('ai-system-prompt', ?)").run(prompt);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});



const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── 阿里云 NLS Token 自动获取与缓存 ──
let nlsTokenCache = { token: '', expireTime: 0 };

/**
 * 使用 AccessKey 签名调用阿里云 CreateToken API
 * 自动缓存，过期前 1 小时自动刷新
 */
async function getNlsToken() {
    const now = Date.now();
    // 未过期且距过期还有 1 小时以上，直接用缓存
    if (nlsTokenCache.token && nlsTokenCache.expireTime - now > 3600000) {
        return nlsTokenCache.token;
    }

    const accessKeyId = process.env.ALI_ACCESS_KEY_ID;
    const accessKeySecret = process.env.ALI_ACCESS_KEY_SECRET;
    if (!accessKeyId || !accessKeySecret) {
        throw new Error('未配置 ALI_ACCESS_KEY_ID / ALI_ACCESS_KEY_SECRET');
    }

    // 构造签名参数
    const params = {
        Action: 'CreateToken',
        Version: '2019-02-28',
        Format: 'JSON',
        AccessKeyId: accessKeyId,
        SignatureMethod: 'HMAC-SHA1',
        Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        SignatureVersion: '1.0',
        SignatureNonce: crypto.randomUUID(),
    };

    // 按 key 排序
    const sortedKeys = Object.keys(params).sort();
    const canonicalized = sortedKeys
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
        .join('&');

    // 待签名字符串: GET&%2F&<url-encoded canonicalized>
    const stringToSign = `GET&${encodeURIComponent('/')}&${encodeURIComponent(canonicalized)}`;

    // HMAC-SHA1 签名
    const signature = crypto
        .createHmac('sha1', accessKeySecret + '&')
        .update(stringToSign)
        .digest('base64');

    const url = `https://nls-meta.cn-shanghai.aliyuncs.com/?${canonicalized}&Signature=${encodeURIComponent(signature)}`;

    console.log('[ASR] 正在获取 NLS Token...');
    const response = await fetch(url);
    const result = await response.json();

    if (result.Token) {
        nlsTokenCache = {
            token: result.Token.Id,
            expireTime: result.Token.ExpireTime * 1000, // 秒转毫秒
        };
        const expiresIn = Math.round((nlsTokenCache.expireTime - Date.now()) / 3600000);
        console.log(`[ASR] NLS Token 获取成功, 有效期约 ${expiresIn} 小时`);
        return nlsTokenCache.token;
    } else {
        console.error('[ASR] Token 获取失败:', result);
        throw new Error(result.Message || 'NLS Token 获取失败');
    }
}

/**
 * POST /api/voice/asr
 * 语音识别端点 — 接收音频文件，调阿里云一句话识别 REST API
 * 自动获取和刷新 NLS Token
 */
app.post('/api/voice/asr', upload.single('audio'), async (req, res) => {
    try {
        const appKey = process.env.ALI_ASR_APPKEY;
        if (!appKey) {
            return res.json({ success: false, error: '未配置 ALI_ASR_APPKEY' });
        }

        if (!req.file) {
            return res.json({ success: false, error: '未收到音频文件' });
        }

        const token = await getNlsToken();
        const audioBuffer = req.file.buffer;
        const format = req.body.format || 'pcm';
        const sampleRate = parseInt(req.body.sampleRate) || 16000;

        console.log(`[ASR] 收到音频: ${req.file.originalname}, 大小: ${audioBuffer.length} bytes, 格式: ${format}`);

        // 阿里云一句话识别 REST API (非 Flash 版本)
        const url = `https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/asr?appkey=${appKey}&format=${format}&sample_rate=${sampleRate}&enable_punctuation_prediction=true&enable_inverse_text_normalization=true`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'X-NLS-Token': token,
                'Content-Type': 'application/octet-stream',
            },
            body: audioBuffer,
        });

        const result = await response.json();

        if (result.status === 20000000) {
            const text = result.result || '';
            console.log(`[ASR] 识别结果: "${text}"`);
            res.json({ success: true, text });
        } else {
            console.error('[ASR] 阿里云返回错误:', result);
            res.json({ success: false, error: result.message || '识别失败', detail: result });
        }
    } catch (err) {
        console.error('[ASR] 错误:', err.message);
        res.json({ success: false, error: err.message });
    }
});

// ── Siri + 快捷指令专用端点 ──────────────────────────────

const SIRI_TOKEN = process.env.SIRI_API_TOKEN || '';

// ── Siri 结果存储（内存，5分钟 TTL） ──
const siriResults = new Map();
const SIRI_RESULT_TTL = 5 * 60 * 1000; // 5 minutes

// 每分钟清理过期结果
setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of siriResults) {
        if (now - entry.createdAt > SIRI_RESULT_TTL) siriResults.delete(id);
    }
}, 60000);

/**
 * Siri 鉴权中间件
 * 如果 .env 中设置了 SIRI_API_TOKEN，则要求请求头携带 X-Siri-Token
 * 未设置时跳过鉴权（开发模式）
 */
function siriAuth(req, res, next) {
    if (!SIRI_TOKEN) return next(); // 未配置 token 则跳过
    const token = req.headers['x-siri-token'];
    if (token !== SIRI_TOKEN) {
        return res.status(401).json({ success: false, error: '鉴权失败' });
    }
    next();
}

// ── Siri 结果页面静态文件 + API ──
app.use('/public', express.static(path.join(__dirname, 'public')));

// 重定向: /siri-result?id=xxx → /public/siri-result.html?id=xxx
app.get('/siri-result', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'siri-result.html'));
});

// 获取存储的 Siri 结果
app.get('/api/siri/result/:id', (req, res) => {
    const entry = siriResults.get(req.params.id);
    if (!entry) {
        return res.json({ success: false, error: '结果不存在或已过期（5分钟）' });
    }
    res.json({ success: true, data: entry.data });
});

/**
 * POST /api/siri/chat
 * Siri + 快捷指令语音对话端点
 *
 * Siri 自带 Apple STT，快捷指令直接发文字过来，不需要 ASR。
 *
 * 请求体：
 * {
 *   "text": "V750的成本是多少",
 *   "project": "pump",             // pump | cad（路由到不同后端）
 *   "context": []                  // 可选: 多轮对话历史
 * }
 *
 * 响应：
 * {
 *   "success": true,
 *   "speech": "V750总成本853.50元",  // 朗读文字（简短、口语化）
 *   "content": "...",               // AI 完整回复
 *   "toolResults": [...]            // 结构化数据
 * }
 */
app.post('/api/siri/chat', siriAuth, async (req, res) => {
    try {
        const { text, project, context } = req.body;
        if (!text || !text.trim()) {
            return res.json({ success: false, speech: '没有收到你说的话', error: '文字内容为空' });
        }

        const targetProject = (project || 'pump').toLowerCase();
        console.log(`[Siri] 收到请求: project=${targetProject}, text="${text}"`);

        // ── CAD 项目：转发到 Python API ──
        if (targetProject === 'cad') {
            try {
                const cadApiUrl = process.env.CAD_API_URL || 'http://localhost:5000';
                const cadRes = await fetch(`${cadApiUrl}/api/siri/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, context: context || [] }),
                });
                const cadData = await cadRes.json();
                console.log('[Siri] CAD API 返回:', cadData.success);
                return res.json(cadData);
            } catch (err) {
                console.error('[Siri] CAD API 转发失败:', err.message);
                return res.json({ success: false, speech: 'CAD服务暂时不可用', error: err.message });
            }
        }

        // ── PumpDB 项目：本地处理 ──
        const toolResults = [];

        // 为 Siri 场景增加 system prompt 后缀：要求首句输出口语化摘要
        const siriPromptSuffix = `\n\n【当前为 Siri 语音模式】\n回复规则调整：\n- 你的回复会被 Siri 朗读给用户听，所以必须口语化、简洁\n- 回复的第一句话必须是对结果的一句话总结（会被提取为 speech 字段）\n- 不要使用 markdown 格式、表格、列表符号\n- 金额直接说"xxx元"，不要用特殊符号\n- 如果有多个数据，只说最关键的2-3个数字`;

        const messages = context && context.length > 0
            ? [...context, { role: 'user', content: text }]
            : [{ role: 'user', content: text }];

        let currentMessages = [
            { role: 'system', content: AI_SYSTEM_PROMPT + siriPromptSuffix },
            ...messages
        ];

        const apiKey = process.env.DEEPSEEK_API_KEY;
        const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
        let maxRounds = 5;
        let done = false;
        let finalContent = '';

        while (!done && maxRounds-- > 0) {
            const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model,
                    messages: currentMessages,
                    tools: AI_TOOLS,
                    stream: false
                })
            });

            if (!aiRes.ok) {
                const errText = await aiRes.text();
                console.error('[Siri] DeepSeek API 错误:', aiRes.status);
                return res.json({ success: false, speech: 'AI服务暂时不可用，请稍后再试', error: `LLM API 错误: ${aiRes.status}` });
            }

            const data = await aiRes.json();
            if (data.error) {
                return res.json({ success: false, speech: 'AI服务出错了', error: data.error.message || 'API 错误' });
            }

            const msg = data.choices[0].message;
            currentMessages.push({
                role: 'assistant',
                content: msg.content || "",
                tool_calls: msg.tool_calls
            });

            if (msg.tool_calls && msg.tool_calls.length > 0) {
                for (const tc of msg.tool_calls) {
                    const funcName = tc.function.name;
                    console.log(`[Siri] 调用工具: ${funcName}`);

                    let args = {};
                    try { args = JSON.parse(tc.function.arguments); } catch (e) { }

                    const result = await executeToolCall(funcName, args);
                    const viewType = VIEW_TYPE_MAP[funcName] || 'action_result';

                    toolResults.push({ name: funcName, view_type: viewType, result });

                    currentMessages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        name: funcName,
                        content: JSON.stringify(result)
                    });
                }
            } else {
                finalContent = msg.content || '';
                done = true;
            }
        }

        // 提取 speech：取 AI 回复的第一句话（句号或换行前）
        const speech = finalContent
            .split(/[。\n]/)[0]
            .replace(/[*#`\-]/g, '')
            .trim() || finalContent.slice(0, 100);

        // 保存结果并生成 URL
        const resultId = crypto.randomUUID();
        siriResults.set(resultId, {
            createdAt: Date.now(),
            data: { speech, content: finalContent, toolResults, query: text, timestamp: new Date().toISOString() }
        });
        const resultUrl = `${req.protocol}://${req.get('host')}/siri-result?id=${resultId}`;

        console.log(`[Siri] 完成, speech="${speech}", 工具调用: ${toolResults.length} 次, resultUrl=${resultUrl}`);
        res.json({
            success: true,
            speech,
            content: finalContent,
            toolResults,
            resultUrl,
        });
    } catch (err) {
        console.error('[Siri] 错误:', err.message);
        res.json({ success: false, speech: '处理出错了，请再试一次', error: err.message });
    }
});


app.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`水泵BOM成本查询API已启动`);
    console.log(`访问地址: http://localhost:${PORT}`);
    console.log(`========================================`);
    console.log(`可用端点:`);
    console.log(`  GET  /api/health                        - 健康检查`);
    console.log(`  POST /api/cost/calculate                - 计算成本（传parts数组）`);
    console.log(`  GET  /api/cost/recipe/:id               - 按配方ID查询成本`);
    console.log(`  GET  /api/cost/recipe/by-name?name=xxx  - 按配方名称查询成本`);
    console.log(`  POST /api/cost/dynamic-config           - 动态配置成本（浮球/电缆/包材）`);
    console.log(`  POST /api/cost/full-calculate           - 一站式成本计算（推荐N8N用）`);
    console.log(`  GET  /api/copper-price                  - 获取实时铜价`);
    console.log(`  POST /api/copper-price/update           - 手动触发铜价更新`);
    console.log(`  GET  /api/coils                         - 获取所有线圈数据`);
    console.log(`  POST /api/coils                         - 新增线圈记录`);
    console.log(`  PATCH /api/coils/:id                    - 更新线圈记录`);
    console.log(`  DELETE /api/coils/:id                   - 删除线圈记录`);
    console.log(`  POST /api/coils/calculate               - 线圈成本计算（支持插值）`);
    console.log(`  GET  /api/coils/specs                   - 获取可用规格列表`);
    console.log(`  POST /api/ai/chat                       - AI智能助手（SSE）`);
    console.log(`  GET  /api/ai/system-prompt              - 获取System Prompt`);
    console.log(`  PUT  /api/ai/system-prompt              - 修改System Prompt`);
    console.log(`  POST /api/voice/asr                     - 语音识别(阿里云ASR)`);
    console.log(`  POST /api/siri/chat                     - Siri快捷指令对话`);
    console.log(`========================================`);

    // 启动时自动更新铜价
    console.log('[启动] 正在获取最新铜价...');
    runCopperPriceUpdate();

    // 加载 AI System Prompt
    console.log('[启动] 正在加载 AI System Prompt...');
    loadSystemPromptFromDB();
});

