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
const {
    executeRecipeTool,
    prepareRecipeDelete,
    prepareRecipeUpdate,
} = require('./executors/recipeExecutors.cjs');
const { executeBusinessTool } = require('./executors/businessExecutors.cjs');
const {
    preparePartBatchCreate,
    preparePartDelete,
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
    getAiToolInputSchema,
    validateAiToolArgs,
} = require('../../services/aiToolInputValidatorV2.cjs');
const { withToolSpan } = require('../../services/observability.cjs');

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
    delete_part: preparePartDelete,
    delete_recipe: prepareRecipeDelete,
    update_recipe: prepareRecipeUpdate,
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
            addRow(rows, '目录成本价', args.price, hasValue(args.price) ? ' 元' : '');
            addRow(rows, '库存', args.stock);
            break;
        case 'update_part':
            addRow(rows, '型号', args.model);
            addRow(rows, '类别', args.category);
            addRow(rows, '二级分类', args.subcategory);
            addRow(rows, '供应商', args.supplier);
            addRow(rows, '目录成本价', args.price, hasValue(args.price) ? ' 元' : '');
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
            addRow(rows, '产品明细ID', args.orderItemId);
            addRow(rows, '配方', args.recipeName);
            addRow(rows, '数量', args.qty);
            addRow(rows, '销售单价', args.unitPrice, hasValue(args.unitPrice) ? ' 元' : '');
            addRow(rows, '利润率', args.profitMargin);
            addRow(rows, '修改原因', args.reason);
            break;
        case 'create_recipe':
            addRow(rows, '成品型号', args.name);
            addRow(rows, '配置摘要', args.spec);
            addRow(rows, '零件', previewItems(args.parts, 'model'));
            break;
        case 'update_recipe':
            addRow(rows, '当前成品型号', args.recipeName);
            addRow(rows, '新成品型号', args.newName);
            addRow(rows, '新配置摘要', args.newSpec);
            addRow(rows, '清空配置摘要', args.clearSpec === true ? '是' : '');
            addRow(rows, '添加零件', previewItems(args.addParts, 'model'));
            addRow(rows, '移除零件', Array.isArray(args.removeParts) ? args.removeParts.join('，') : '');
            addRow(rows, '修改数量', previewItems(args.updateParts, 'model'));
            break;
        case 'delete_recipe':
            addRow(rows, '删除配方', args.recipeName);
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
            addRow(rows, '关联到业务资料', targetLabels[args.targetType] || args.targetType);
            addRow(rows, '业务对象编号', args.targetId);
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

const CONFIRMATION_FIELD_LABELS = Object.freeze({
    model: '型号',
    category: '类别',
    subcategory: '二级分类',
    price: '目录成本价',
    supplier: '供应商',
    stock: '初始库存',
    note: '备注',
    reason: '原因',
    status: '状态',
    quantity: '数量',
    qty: '数量',
});

function confirmationFieldLocked(key) {
    return /(?:^id$|Id$|Ids$|Version$|UpdatedAt$|Hash$|Token$|Key$)/.test(key);
}

function buildConfirmationEditableFields(toolName, args = {}) {
    const schema = getAiToolInputSchema(toolName);
    const properties = schema?.properties || {};
    const required = new Set(schema?.required || []);
    return Object.entries(properties)
        .filter(([key, fieldSchema]) => (
            ['string', 'number', 'integer', 'boolean'].includes(fieldSchema.type)
            || Object.hasOwn(args, key)
        ))
        .slice(0, 30)
        .map(([key, fieldSchema]) => ({
            key,
            label: CONFIRMATION_FIELD_LABELS[key]
                || String(fieldSchema.description || key).split(/[（，；。]/)[0]
                || key,
            type: ['string', 'number', 'integer', 'boolean'].includes(fieldSchema.type)
                ? fieldSchema.type
                : 'json',
            required: required.has(key),
            locked: confirmationFieldLocked(key),
            value: Object.hasOwn(args, key) ? args[key] : null,
            options: Array.isArray(fieldSchema.enum) ? fieldSchema.enum : undefined,
            description: fieldSchema.description || '',
        }));
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
            editableFields: buildConfirmationEditableFields(toolName, args || {}),
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
async function executeToolCallImplementation(toolName, args, options = {}) {
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
                signal: options.signal,
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
                if (options.signal?.aborted || error?.name === 'AbortError'
                    || ['AI_REQUEST_CANCELLED', 'AI_REQUEST_TIMEOUT'].includes(error?.code)) {
                    throw options.signal?.reason instanceof Error
                        ? options.signal.reason
                        : error;
                }
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
        signal: options.signal,
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
        if (options.signal?.aborted || err?.name === 'AbortError'
            || ['AI_REQUEST_CANCELLED', 'AI_REQUEST_TIMEOUT'].includes(err?.code)) {
            throw options.signal?.reason instanceof Error
                ? options.signal.reason
                : err;
        }
        return attachVerifiedFailureEvidence(
            capability,
            {
                success: false,
                code: err.code || null,
                statusCode: err.statusCode || null,
                formalApiOutcome: err.formalApiOutcome || null,
                error: err.message,
            },
            typeof internalFetch.getApiTrace === 'function'
                ? internalFetch.getApiTrace()
                : []
        );
    }
}

async function executeToolCall(toolName, args, options = {}) {
    const capability = getAiCapability(toolName);
    return withToolSpan({
        toolName,
        executorType: capability?.executorKey || 'unregistered',
        access: capability?.access || 'unknown',
        capability: capability?.capabilityId || null,
        operationId: options.operationId,
        args,
    }, () => executeToolCallImplementation(toolName, args, options));
}

module.exports = { executeToolCall, buildWriteConfirmation };
