const { AI_TOOLS, WRITE_TOOLS } = require('./tools.cjs');
const { executeCostTool } = require('./executors/costExecutors.cjs');
const { executeQueryTool } = require('./executors/queryExecutors.cjs');
const { executeOrderTool } = require('./executors/orderExecutors.cjs');
const { executeRecipeTool } = require('./executors/recipeExecutors.cjs');

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
        return { success: false, error: `操作被拒绝："${toolName}" 是写操作，当前调用方没有写入权限。请通过系统管理界面执行此操作。` };
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

module.exports = { executeToolCall };
