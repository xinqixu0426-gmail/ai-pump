/**
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

const app = express();
const PORT = 3002;  // API服务器端口

// NocoDB 配置
const NOCO_CONFIG = {
    baseUrl: process.env.VITE_NOCO_BASE_URL || 'http://localhost:8080',
    apiToken: process.env.VITE_NOCO_API_TOKEN || '',
    partsTable: process.env.VITE_NOCO_PARTS_TABLE || '',
    recipesTable: process.env.VITE_NOCO_RECIPES_TABLE || '',
    coilsTable: process.env.VITE_NOCO_COILS_TABLE || ''
};

// 中间件
app.use(cors());  // 允许跨域请求（N8N调用需要）
app.use(express.json());

/**
 * API请求封装
 */
async function apiRequest(path, options = {}) {
    const url = `${NOCO_CONFIG.baseUrl}${path}`;
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
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
        const data = await apiRequest(`/api/v2/tables/${tableId}/records?limit=${PAGE_SIZE}&offset=${offset}`);
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
        const { partsCache, partsByModel } = await loadPartsData();

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

        // 从NocoDB获取所有配方，然后在内存中匹配（避免URL编码问题）
        let allRecipes;
        try {
            allRecipes = await fetchAllRecords(NOCO_CONFIG.recipesTable);
        } catch (error) {
            console.error('NocoDB Error:', error);
            return res.status(500).json({
                success: false,
                error: '从NocoDB获取配方失败: ' + error.message
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
        const { partsCache, partsByModel } = await loadPartsData();
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

        // 从NocoDB获取配方
        const data = await apiRequest(`/api/v2/tables/${NOCO_CONFIG.recipesTable}/records?where=(Id,eq,${recipeId})`);

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
        const { partsCache, partsByModel } = await loadPartsData();
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
async function resolveWireFromStator(statorSpec, statorSheets) {
    if (!statorSpec || !statorSheets) return null;
    try {
        const data = await apiRequest(
            `/api/v2/tables/${NOCO_CONFIG.coilsTable}/records?where=(规格,eq,${encodeURIComponent(statorSpec)})~and(片数,eq,${encodeURIComponent(statorSheets)})&limit=1`
        );
        const record = data.list?.[0];
        return record?.默认线径 || null;
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

        const { partsCache, partsByModel } = await loadPartsData();

        // 从数据库查价的辅助函数（取同型号最低价）
        const getPrice = (model) => {
            const suppliers = partsByModel[model] || [];
            if (suppliers.length === 0) return 0;
            return suppliers.reduce((min, curr) => curr.price < min.price ? curr : min, suppliers[0]).price;
        };

        // 智能推导线径：先从线圈成本表按(规格,片数)查默认线径，查不到则兜底
        const dbWire = await resolveWireFromStator(statorSpec, statorSheets);
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
 *   2. 按定子规格-片数查线圈转子成本 (查 NocoDB 线圈成本表)
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

        const { partsCache, partsByModel } = await loadPartsData();

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
                const allRecipes = await fetchAllRecords(NOCO_CONFIG.recipesTable);
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
                const statorData = await apiRequest(
                    `/api/v2/tables/${NOCO_CONFIG.coilsTable}/records?where=(规格,eq,${encodeURIComponent(statorSpec)})~and(片数,eq,${encodeURIComponent(statorSheets)})&limit=1`
                );
                const statorRecord = statorData.list?.[0];

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
                    const baseData = await apiRequest(
                        `/api/v2/tables/${NOCO_CONFIG.coilsTable}/records?where=(规格,eq,${encodeURIComponent(statorSpec)})&limit=10`
                    );
                    const baseRecords = baseData.list || [];

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
            ? await resolveWireFromStator(statorSpec, statorSheets)
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

    // 获取所有线圈记录
    const allCoils = await fetchAllRecords(NOCO_CONFIG.coilsTable);

    for (const coil of allCoils) {
        const unitPrice = parseFloat(coil.单价 || 0);
        const sheets = parseInt(coil.片数 || 0);
        const wireWeight = parseFloat(coil.默认线重 || 0);
        const coilFee = parseFloat(coil.线圈加工费 || 0);
        const rotorFee = parseFloat(coil.转子加工费 || 0);

        // 重新计算成本
        const newCost = unitPrice * sheets + wireWeight * parseFloat(copperPricePerKg) + coilFee + rotorFee;

        // 更新记录
        await apiRequest(`/api/v2/tables/${NOCO_CONFIG.coilsTable}/records`, {
            method: 'PATCH',
            body: JSON.stringify({
                Id: coil.Id,
                铜价基数: copperPricePerKg,
                成本: newCost.toFixed(5)
            })
        });
    }

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
        const coils = await fetchAllRecords(NOCO_CONFIG.coilsTable);
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
        const coils = await fetchAllRecords(NOCO_CONFIG.coilsTable);
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

        const record = await apiRequest(`/api/v2/tables/${NOCO_CONFIG.coilsTable}/records`, {
            method: 'POST',
            body: JSON.stringify({
                规格, 单价, 片数, 默认线重, 铜价基数, 线圈加工费, 转子加工费,
                默认电容_uf: 默认电容_uf || null,
                默认线径: 默认线径 || null,
                成本: cost.toFixed(5)
            })
        });

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
            const data = await apiRequest(`/api/v2/tables/${NOCO_CONFIG.coilsTable}/records?where=(Id,eq,${id})&limit=1`);
            const current = data.list?.[0];
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

        const record = await apiRequest(`/api/v2/tables/${NOCO_CONFIG.coilsTable}/records`, {
            method: 'PATCH',
            body: JSON.stringify(updates)
        });

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
        await apiRequest(`/api/v2/tables/${NOCO_CONFIG.coilsTable}/records`, {
            method: 'DELETE',
            body: JSON.stringify([{ Id: id }])
        });
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
        const allCoils = await fetchAllRecords(NOCO_CONFIG.coilsTable);
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
        const allCoils = await fetchAllRecords(NOCO_CONFIG.coilsTable);
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


// 启动服务器（监听所有网络接口，允许外部访问）
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
    console.log(`========================================`);

    // 启动时自动更新铜价
    console.log('[启动] 正在获取最新铜价...');
    runCopperPriceUpdate();
});

