const { getAiCapability } = require('../../capabilities/registry.cjs');
const { issueAiToolConfirmation } = require('../../services/aiToolConfirmation.cjs');
const {
    createInternalFetch,
    getJson,
    postJson,
} = require('./internalApiClient.cjs');
const { executeCostTool } = require('./executors/costExecutors.cjs');
const { executeQueryTool } = require('./executors/queryExecutors.cjs');
const { executeOrderTool } = require('./executors/orderExecutors.cjs');
const { executeRecipeTool } = require('./executors/recipeExecutors.cjs');
const { executeBusinessTool } = require('./executors/businessExecutors.cjs');
const {
    preparePartBatchCreate,
    preparePartPriceBatch,
    preparePartStockAdjustment,
} = require('../../services/aiPartExecution.cjs');
const {
    prepareCoilStockAdjustment,
} = require('../../services/aiCoilStockExecution.cjs');
const {
    attachVerifiedFailureEvidence,
    attachVerifiedExecutionEvidence,
} = require('../../services/aiExecutionEvidence.cjs');
const {
    validateAiToolArgs,
} = require('../../services/aiToolInputValidatorV2.cjs');

const TOOL_EXECUTORS = Object.freeze({
    cost: executeCostTool,
    query: executeQueryTool,
    order: executeOrderTool,
    recipe: executeRecipeTool,
    business: executeBusinessTool,
});

const WRITE_PREFLIGHTS = Object.freeze({
    adjust_coil_stock: prepareCoilStockAdjustment,
    adjust_part_stock: preparePartStockAdjustment,
    batch_create_parts: preparePartBatchCreate,
    batch_update_prices: preparePartPriceBatch,
});

function attachReadProvenance(capability, result) {
    if (!result || result.success === false || result.requiresConfirmation || result.provenance) return result;
    if (!capability?.resultProvenance) return result;
    return {
        ...result,
        provenance: {
            ...capability.resultProvenance,
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
            addRow(rows, '型号', args.model);
            addRow(rows, '类别', args.category);
            addRow(rows, '供应商', args.supplier);
            addRow(rows, '单价', args.price, hasValue(args.price) ? ' 元' : '');
            addRow(rows, '库存', args.stock);
            break;
        case 'update_part':
            addRow(rows, '型号', args.model);
            addRow(rows, '类别', args.category);
            addRow(rows, '二级分类', args.subcategory);
            addRow(rows, '供应商', args.supplier);
            addRow(rows, '单价', args.price, hasValue(args.price) ? ' 元' : '');
            break;
        case 'batch_create_parts':
            addRow(rows, '新增数量', Array.isArray(args.parts) ? args.parts.length : 0);
            addRow(rows, '零件', previewItems(args.parts, 'model'));
            break;
        case 'adjust_part_stock':
            addRow(rows, '零件库存', Array.isArray(args.items)
                ? args.items.map(item => {
                    const change = Number(item.changeQty);
                    return `${item.model} ${change > 0 ? '+' : ''}${change} 件`;
                }).join('，')
                : '');
            addRow(rows, '备注', args.note);
            break;
        case 'adjust_coil_stock':
            addRow(rows, '线圈成品', Array.isArray(args.items)
                ? args.items.map(item => {
                    const dimensions = [item.material, item.slotType].filter(Boolean).join('/');
                    const change = Number(item.changeQty);
                    return `${item.model}${dimensions ? `（${dimensions}）` : ''} ${change > 0 ? '+' : ''}${change} 套`;
                }).join('，')
                : '');
            addRow(rows, '备注', args.note);
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
        case 'save_order_requirement_draft':
            addRow(rows, '订单ID', args.orderId);
            addRow(rows, '依据文件', Array.isArray(args.sourceFileIds) ? args.sourceFileIds.join('，') : '');
            addRow(rows, '客户要求草稿', args.summaryText);
            break;
        case 'save_order_execution_draft':
            addRow(rows, '订单ID', args.orderId);
            addRow(rows, '阶段', {
                pre_production: '生产前',
                in_production: '生产中',
                post_production: '生产后',
            }[args.phase] || args.phase);
            addRow(rows, '类型', args.recordType);
            addRow(rows, '标题', args.title);
            addRow(rows, '发生时间', args.occurredAt);
            addRow(rows, '依据文件', Array.isArray(args.sourceFileIds) ? args.sourceFileIds.join('，') : '');
            addRow(rows, '事实草稿', args.summaryText);
            break;
        case 'execute_order_readiness_action':
            addRow(rows, '订单ID', args.orderId);
            addRow(rows, '处理步骤', args.actionId === 'confirm_order'
                ? '确认订单并进入采购流程'
                : args.actionId === 'generate_purchase_plan'
                    ? '生成采购清单'
                    : args.actionId);
            break;
        case 'execute_factory_workflow_step':
            addRow(rows, '工作流', args.workflowType === 'quotation_to_order' ? '报价转订单' : args.workflowType);
            addRow(rows, '报价ID', args.quotationId);
            addRow(rows, '处理步骤', args.actionId === 'convert_quotation' ? '确认转单并检查新订单' : args.actionId);
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
            addRow(rows, '修改原因', args.reason);
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
        case 'archive_factory_file': {
            const targetLabels = {
                customer: '客户',
                quotation: '报价',
                order: '订单',
                recipe: '配方',
                recipe_analysis_feedback: '质量问题（配方检查）',
                ai_answer_feedback: '质量问题（AI回答）',
                knowledge_document: '知识库资料',
            };
            addRow(rows, '文件ID', args.fileId);
            addRow(rows, '归档到', targetLabels[args.targetType] || args.targetType);
            addRow(rows, '业务对象ID', args.targetId);
            addRow(rows, '标题', args.title);
            addRow(rows, '资料类型', args.documentType);
            addRow(rows, '说明', args.note);
            break;
        }
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

function buildWriteConfirmation(toolName, args, options = {}) {
    const capability = getAiCapability(toolName);
    const title = capability?.displayName || toolName;
    const rows = Array.isArray(options.confirmationRows)
        ? options.confirmationRows
        : buildConfirmationRows(toolName, args);
    const token = issueAiToolConfirmation({
        toolName,
        args: args || {},
        subject: options.confirmationSubject || 'internal:executor',
        executionContext: options.executionContext,
    });
    return {
        success: true,
        requiresConfirmation: true,
        confirmation: {
            capabilityId: capability?.capabilityId || null,
            riskLevel: capability?.riskLevel || 'high',
            confirmationToken: token.confirmationToken,
            operationId: token.operationId,
            argsHash: token.argsHash,
            resourceVersion: token.resourceVersion,
            expiresAt: token.expiresAt,
            toolName,
            args: args || {},
            title,
            rows,
            summary: `AI 准备执行「${title}」，确认后才会执行受保护业务动作。`,
            warning: '请核对内容无误后再确认。确认后可能写入业务数据或产生设备、文件等外部副作用。',
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

    const capability = getAiCapability(toolName);
    if (!capability) {
        return { success: false, error: `工具未登记到能力注册表，已拒绝执行: ${toolName}` };
    }
    try {
        args = validateAiToolArgs(toolName, args);
    } catch (error) {
        return {
            success: false,
            error: error.message,
            code: error.code || 'INVALID_AI_TOOL_INPUT',
            validation: {
                status: 'rejected',
                toolName,
                ...(error.details || {}),
            },
        };
    }
    let internalFetch = null;
    // 权限拦截：写操作需要 allowWrite=true
    if (capability.access === 'write' && !allowWrite) {
        const prepareWrite = WRITE_PREFLIGHTS[toolName];
        if (prepareWrite) {
            internalFetch = createInternalFetch({
                operationId: options.operationId,
                capabilityId: capability.capabilityId,
            });
            try {
                const prepared = await prepareWrite(args, {
                    internalFetch,
                    getJson,
                    postJson,
                });
                args = prepared.args;
                return buildWriteConfirmation(toolName, args, {
                    ...options,
                    confirmationRows: prepared.confirmationRows,
                    executionContext: prepared.executionContext,
                });
            } catch (error) {
                return {
                    success: false,
                    code: error.code || 'ai_write_preflight_failed',
                    error: error.message,
                    ...(error.details || {}),
                };
            }
        }
        return buildWriteConfirmation(toolName, args, options);
    }
    
    // 内部网络获取助手，注入系统秘钥并复用标准 API 鉴权入口。
    internalFetch ||= createInternalFetch({
        operationId: options.operationId,
        capabilityId: capability.capabilityId,
    });
    const executor = TOOL_EXECUTORS[capability.executorKey];
    if (!executor) {
        return {
            success: false,
            error: `能力未登记有效 executorKey，已拒绝执行: ${toolName}`,
        };
    }

    try {
        const result = await executor(toolName, args, internalFetch, {
            confirmationContext: options.confirmationContext,
        });
        if (!result) {
            return {
                success: false,
                error: `能力 executorKey 与实现不一致，已拒绝执行: ${toolName}`,
            };
        }
        const verifiedResult = attachVerifiedExecutionEvidence(
            capability,
            result,
            typeof internalFetch.getApiTrace === 'function'
                ? internalFetch.getApiTrace()
                : []
        );
        return attachReadProvenance(capability, verifiedResult);
    } catch (err) {
        return attachVerifiedFailureEvidence(
            capability,
            {
                success: false,
                code: err.code || null,
                error: err.message,
            },
            typeof internalFetch.getApiTrace === 'function'
                ? internalFetch.getApiTrace()
                : []
        );
    }
}

module.exports = { executeToolCall, buildWriteConfirmation };
