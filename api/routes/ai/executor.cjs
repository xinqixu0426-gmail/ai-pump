const { AI_TOOLS, WRITE_TOOLS } = require('./tools.cjs');
const { executeCostTool } = require('./executors/costExecutors.cjs');
const { executeQueryTool } = require('./executors/queryExecutors.cjs');
const { executeOrderTool } = require('./executors/orderExecutors.cjs');
const { executeRecipeTool } = require('./executors/recipeExecutors.cjs');

const TOOL_LABELS = {
    create_part: '新建零件',
    update_part: '修改零件',
    delete_part: '删除零件',
    batch_update_prices: '批量调价',
    create_order: '新建订单',
    delete_order: '删除订单',
    update_order_status: '修改订单状态',
    add_recipe_to_order: '订单追加产品',
    remove_recipe_from_order: '订单移除产品',
    update_order_item: '修改订单产品',
    generate_purchase_list: '生成采购清单',
    create_recipe: '新建配方',
    delete_recipe: '删除配方',
    update_recipe: '修改配方',
};

function buildWriteConfirmation(toolName, args) {
    const title = TOOL_LABELS[toolName] || toolName;
    return {
        success: true,
        requiresConfirmation: true,
        confirmation: {
            toolName,
            args: args || {},
            title,
            summary: `AI 准备执行「${title}」，确认后才会写入数据库。`,
            warning: '请核对内容无误后再确认。确认后会立即执行写操作，并进入审计日志。',
        },
    };
}

/**
 * AI 工具执行器
 * @param {string} toolName
 * @param {object} args
 * @param {object} options
 * @param {boolean} options.allowWrite - 是否允许执行写操作（默认 false）
 */
async function executeToolCall(toolName, args, options = {}) {
    const { allowWrite = false } = options;
    
    // 权限拦截：写操作需要 allowWrite=true
    if (WRITE_TOOLS.has(toolName) && !allowWrite) {
        return buildWriteConfirmation(toolName, args);
    }
    
    // 内部网络获取助手，注入系统秘钥绕过鉴权锁
    const internalFetch = (url, opts = {}) => {
        const headers = opts.headers || {};
        headers['x-internal-secret'] = process.env.INTERNAL_SECRET || '';
        const port = process.env.PORT || 3002;
        return fetch(`http://localhost:${port}${url}`, { ...opts, headers });
    };

    try {
        const costRes = await executeCostTool(toolName, args, internalFetch);
        if (costRes) return costRes;

        const queryRes = await executeQueryTool(toolName, args, internalFetch);
        if (queryRes) return queryRes;

        const orderRes = await executeOrderTool(toolName, args, internalFetch);
        if (orderRes) return orderRes;

        const recipeRes = await executeRecipeTool(toolName, args, internalFetch);
        if (recipeRes) return recipeRes;

        return { success: false, error: `未知工具: ${toolName}` };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { executeToolCall, buildWriteConfirmation };
