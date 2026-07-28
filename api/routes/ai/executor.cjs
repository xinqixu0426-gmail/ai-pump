const { AI_TOOLS, WRITE_TOOLS } = require('./tools.cjs');
const { createInternalFetch } = require('./internalApiClient.cjs');
const { executeCostTool } = require('./executors/costExecutors.cjs');
const { executeQueryTool } = require('./executors/queryExecutors.cjs');
const { executeOrderTool } = require('./executors/orderExecutors.cjs');
const { executeRecipeTool } = require('./executors/recipeExecutors.cjs');
const { executeBusinessTool } = require('./executors/businessExecutors.cjs');

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
    execute_order_readiness_action: '执行订单处理步骤',
    create_recipe: '新建配方',
    delete_recipe: '删除配方',
    update_recipe: '修改配方',
    sync_factory_knowledge: '同步工厂知识库',
    set_recipe_analysis_feedback: '保存配方检查反馈',
    refresh_factory_rule_candidates: '归纳候选业务规则',
    review_factory_rule_candidate: '审核候选业务规则',
    restore_factory_rule_event: '恢复规则审核状态',
};

const LIVE_BUSINESS_TOOLS = new Set([
    'get_all_parts',
    'search_parts',
    'get_all_recipes',
    'query_recipe_cost_by_name',
    'query_recipe_cost_by_id',
    'preview_recipe_cost',
    'preview_pump_shell_cost',
    'calculate_coil_cost',
    'dynamic_config_cost',
    'full_calculate',
    'get_copper_price',
    'get_recent_orders',
    'get_order_detail',
    'check_order_readiness',
    'plan_order_readiness_actions',
    'search_customer_history',
    'get_dashboard_summary',
    'get_business_alerts',
    'get_data_quality_summary',
    'analyze_recipe_configuration',
    'get_factory_knowledge_health',
    'get_factory_rule_candidates',
    'get_factory_rule_impact',
    'get_factory_rule_compliance',
    'get_factory_rule_history',
]);

function attachReadProvenance(toolName, result) {
    if (!result || result.success === false || result.requiresConfirmation || result.provenance) return result;
    if (!LIVE_BUSINESS_TOOLS.has(toolName)) return result;
    return {
        ...result,
        provenance: {
            kind: 'live_business',
            label: '实时业务数据',
            fetchedAt: new Date().toISOString(),
        },
    };
}

function hasValue(value) {
    return value !== undefined && value !== null && value !== '';
}

function addRow(rows, label, value, suffix = '') {
    if (hasValue(value)) rows.push({ label, value: `${value}${suffix}` });
}

function previewItems(items, nameKey = 'recipeName') {
    if (!Array.isArray(items) || items.length === 0) return '';
    return items
        .slice(0, 5)
        .map(item => `${item[nameKey] || item.model || '项目'} x ${item.qty || 1}`)
        .join('，');
}

function buildConfirmationRows(toolName, args = {}) {
    const rows = [];

    switch (toolName) {
        case 'create_part':
        case 'update_part':
            addRow(rows, '型号', args.model);
            addRow(rows, '类别', args.category);
            addRow(rows, '供应商', args.supplier);
            addRow(rows, '单价', args.price, hasValue(args.price) ? ' 元' : '');
            addRow(rows, '库存', args.stock);
            addRow(rows, '库存变动', args.stockDelta);
            break;
        case 'delete_part':
            addRow(rows, '删除型号', args.model);
            break;
        case 'batch_update_prices':
            addRow(rows, '类别', args.category);
            addRow(rows, '百分比调整', args.percentChange, hasValue(args.percentChange) ? '%' : '');
            addRow(rows, '固定调整', args.absoluteChange, hasValue(args.absoluteChange) ? ' 元' : '');
            break;
        case 'create_order':
            addRow(rows, '客户', args.customerName);
            addRow(rows, '合同号', args.contractNo);
            addRow(rows, '状态', args.status);
            addRow(rows, '产品', previewItems(args.items));
            addRow(rows, '备注', args.remark);
            break;
        case 'delete_order':
        case 'generate_purchase_list':
            addRow(rows, '订单ID', args.orderId);
            break;
        case 'execute_order_readiness_action':
            addRow(rows, '订单ID', args.orderId);
            addRow(rows, '处理步骤', args.actionId === 'confirm_order'
                ? '确认订单并进入采购流程'
                : args.actionId === 'generate_purchase_plan'
                    ? '生成采购清单'
                    : args.actionId);
            break;
        case 'update_order_status':
            addRow(rows, '订单ID', args.orderId);
            addRow(rows, '新状态', args.status);
            break;
        case 'add_recipe_to_order':
        case 'remove_recipe_from_order':
        case 'update_order_item':
            addRow(rows, '订单ID', args.orderId);
            addRow(rows, '配方', args.recipeName);
            addRow(rows, '数量', args.qty);
            addRow(rows, '出厂价', args.unitPrice, hasValue(args.unitPrice) ? ' 元' : '');
            addRow(rows, '利润率', args.profitMargin);
            break;
        case 'create_recipe':
        case 'update_recipe':
            addRow(rows, '配方名称', args.name);
            addRow(rows, '规格', args.spec);
            addRow(rows, '零件', previewItems(args.parts, 'model'));
            break;
        case 'delete_recipe':
            addRow(rows, '删除配方', args.name);
            break;
        case 'set_recipe_analysis_feedback':
            addRow(rows, '配方ID', args.recipeId);
            addRow(rows, '提醒', args.findingKey);
            addRow(rows, '判断', args.decision);
            addRow(rows, '说明', args.note);
            break;
        case 'review_factory_rule_candidate':
            addRow(rows, '候选规则ID', args.candidateId);
            addRow(rows, '审核状态', args.status);
            addRow(rows, '审核说明', args.reviewNote);
            break;
        case 'restore_factory_rule_event':
            addRow(rows, '历史事件ID', args.eventId);
            addRow(rows, '恢复说明', args.restoreNote);
            break;
        default:
            Object.entries(args || {}).slice(0, 6).forEach(([key, value]) => addRow(rows, key, value));
    }

    return rows;
}

function buildWriteConfirmation(toolName, args) {
    const title = TOOL_LABELS[toolName] || toolName;
    const rows = buildConfirmationRows(toolName, args);
    return {
        success: true,
        requiresConfirmation: true,
        confirmation: {
            toolName,
            args: args || {},
            title,
            rows,
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
    
    // 内部网络获取助手，注入系统秘钥并复用标准 API 鉴权入口。
    const internalFetch = createInternalFetch();

    try {
        const costRes = await executeCostTool(toolName, args, internalFetch);
        if (costRes) return attachReadProvenance(toolName, costRes);

        const queryRes = await executeQueryTool(toolName, args, internalFetch);
        if (queryRes) return attachReadProvenance(toolName, queryRes);

        const orderRes = await executeOrderTool(toolName, args, internalFetch);
        if (orderRes) return attachReadProvenance(toolName, orderRes);

        const recipeRes = await executeRecipeTool(toolName, args, internalFetch);
        if (recipeRes) return attachReadProvenance(toolName, recipeRes);

        const businessRes = await executeBusinessTool(toolName, args, internalFetch);
        if (businessRes) return attachReadProvenance(toolName, businessRes);

        return { success: false, error: `未知工具: ${toolName}` };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { executeToolCall, buildWriteConfirmation };
