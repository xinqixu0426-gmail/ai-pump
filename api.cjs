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

// 启动服务器（监听所有网络接口，允许外部访问）
app.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`水泵BOM成本查询API已启动`);
    console.log(`访问地址: http://localhost:${PORT}`);
    console.log(`========================================`);
    console.log(`可用端点:`);
    console.log(`  GET  /api/health                    - 健康检查`);
    console.log(`  POST /api/cost/calculate            - 计算成本（传parts数组）`);
    console.log(`  GET  /api/cost/recipe/:id           - 按配方ID查询成本`);
    console.log(`  GET  /api/cost/recipe/by-name?name=xxx - 按配方名称查询成本`);
    console.log(`========================================`);
});
