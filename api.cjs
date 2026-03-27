/**
 * 水泵BOM成本查询API
 * 供N8N等外部系统调用
 */

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3002;  // API服务器端口

// NocoDB 配置
const NOCO_CONFIG = {
    baseUrl: 'http://localhost:8080',
    apiToken: '***REMOVED***',
    partsTable: 'mzsysnoaq7g36h9',
    recipesTable: 'm9pygo8pmn86kbk'
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
            `/api/v2/tables/m1pbr8kwo3e8un8/records?where=(规格,eq,${encodeURIComponent(statorSpec)})~and(片数,eq,${encodeURIComponent(statorSheets)})&limit=1`
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
 *   "statorSpec": "12",       // 线圈定子规格（用于查线圈表推导线径）
 *   "statorSheets": "160",    // 定子片数（配合规格查询线径）
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
        const { statorSpec, statorSheets, hasFloat, floatWire, hasCable, cableWire, cableLength, boxType } = req.body;

        const { partsByModel } = await loadPartsData();

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
    console.log(`========================================`);
});

