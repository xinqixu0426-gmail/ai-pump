const { buildOrderReadinessContext } = require('./activeOrderReadiness.cjs');
const { buildOrderReadinessPlan } = require('./orderReadinessPlan.cjs');
const { buildManagementActionCenter } = require('./managementActionCenter.cjs');
const { decorateManagementActionCenter } = require('./managementActionLifecycle.cjs');
const { parsePositiveId, parseJsonArray } = require('./validation.cjs');

const WORKFLOW_TYPES = new Set([
    'order_readiness',
    'quotation_to_order',
    'management_action',
]);

const SAFEGUARDS = [
    '读取和检查步骤可以自动完成。',
    '业务写操作必须经过用户确认。',
    '执行写操作前必须重新读取最新数据并校验前置条件。',
    '如果数据或前置条件发生变化，停止执行并重新生成计划。',
];

function text(value) {
    return String(value || '').trim();
}

function list(value) {
    return Array.isArray(value) ? value : [];
}

function executionError(message, statusCode = 400) {
    const result = new Error(message);
    result.statusCode = statusCode;
    return result;
}

function normalizeStep(input) {
    return {
        id: text(input.id),
        sequence: Number(input.sequence || 0),
        title: text(input.title),
        reason: text(input.reason),
        expectedResult: text(input.expectedResult),
        mode: text(input.mode) || 'manual',
        status: text(input.status) || 'available',
        path: text(input.path),
        dependsOn: list(input.dependsOn),
        evidence: list(input.evidence),
        canExecute: Boolean(input.canExecute),
        confirmation: input.canExecute && input.confirmation
            ? {
                toolName: text(input.confirmation.toolName),
                args: input.confirmation.args && typeof input.confirmation.args === 'object'
                    ? input.confirmation.args
                    : {},
            }
            : null,
    };
}

function buildMetrics(steps) {
    return {
        totalSteps: steps.length,
        automaticSteps: steps.filter(item => item.mode === 'automatic').length,
        confirmableSteps: steps.filter(item => item.mode === 'confirmable' && item.status === 'available').length,
        executableSteps: steps.filter(item => item.canExecute && item.status === 'available').length,
        manualSteps: steps.filter(item => item.mode === 'manual' && item.status !== 'blocked').length,
        needsInputSteps: steps.filter(item => item.mode === 'needs_input' && item.status !== 'blocked').length,
        waitingSteps: steps.filter(item => item.status === 'waiting').length,
        blockedSteps: steps.filter(item => item.status === 'blocked').length,
        completedSteps: steps.filter(item => item.status === 'complete').length,
    };
}

function buildResult(input) {
    const steps = list(input.steps).map((item, index) => normalizeStep({
        ...item,
        sequence: index + 1,
    }));
    return {
        version: 1,
        generatedAt: input.generatedAt || new Date().toISOString(),
        workflowType: input.workflowType,
        goal: text(input.goal),
        status: input.status,
        summary: text(input.summary),
        subject: input.subject || null,
        metrics: buildMetrics(steps),
        steps,
        safeguards: SAFEGUARDS,
    };
}

function buildOrderPlan(input, source) {
    const orderId = parsePositiveId(input.orderId);
    if (!orderId) throw executionError('订单准备执行计划需要有效的 orderId');
    const actionPlan = source.orderActionPlan;
    if (!actionPlan) throw executionError('订单不存在', 404);
    const mappedSteps = list(actionPlan.steps).map(item => {
        const canExecute = item.mode === 'confirmable'
            && item.status === 'available'
            && ['confirm_order', 'generate_purchase_plan'].includes(item.id);
        return {
            ...item,
            evidence: item.evidenceCodes,
            canExecute,
            confirmation: canExecute ? {
                toolName: 'execute_order_readiness_action',
                args: { orderId, actionId: item.id },
            } : null,
        };
    });
    const statusMap = {
        complete: 'complete',
        not_applicable: 'not_applicable',
        ready_for_confirmation: 'ready',
        needs_resolution: 'blocked',
        waiting: 'waiting',
        action_required: 'action_required',
    };
    const order = actionPlan.order || {};
    return buildResult({
        workflowType: 'order_readiness',
        goal: input.goal || `处理订单 #${orderId} 的生产准备问题`,
        status: statusMap[actionPlan.planStatus] || 'action_required',
        summary: actionPlan.summary,
        subject: {
            type: 'order',
            id: orderId,
            label: `订单 #${orderId}${order.customerName ? ` · ${order.customerName}` : ''}`,
            path: `/orders?orderId=${orderId}&view=readiness`,
        },
        generatedAt: actionPlan.generatedAt,
        steps: mappedSteps,
    });
}

function buildManagementPlan(input, source) {
    const center = source.managementCenter || {};
    const queueItems = list(center.executionQueue?.items);
    const allItems = list(center.items);
    const selected = input.actionId
        ? allItems.filter(item => item.id === input.actionId)
        : (queueItems.length > 0 ? queueItems : allItems).slice(0, 3);
    if (input.actionId && selected.length === 0) {
        return buildResult({
            workflowType: 'management_action',
            goal: input.goal || '处理指定管理待办',
            status: 'complete',
            summary: '指定待办当前已不存在，可能已经解决或不再满足触发条件。',
            subject: {
                type: 'management_action',
                id: input.actionId,
                label: '已解决的管理待办',
                path: '/dashboard?view=actions',
            },
            steps: [],
        });
    }
    const steps = selected.map(item => {
        const resolution = item.resolution || {};
        const modeMap = {
            navigate: 'manual',
            confirmable: 'confirmable',
            needs_input: 'needs_input',
            monitor: 'monitor',
        };
        const mode = modeMap[resolution.mode] || 'manual';
        const canExecute = Boolean(resolution.canAiConfirm && resolution.confirmation?.toolName);
        return {
            id: item.id,
            title: resolution.title || item.action || item.title,
            reason: list(item.reasons).join('；') || item.detail || item.title,
            expectedResult: resolution.expectedResult || '当前待办不再出现在管理行动中心。',
            mode,
            status: mode === 'monitor' ? 'waiting' : mode === 'needs_input' ? 'needs_input' : 'available',
            path: resolution.path || item.path,
            evidence: [item.category, item.sourceType].filter(Boolean),
            canExecute,
            confirmation: canExecute ? resolution.confirmation : null,
        };
    });
    const hasExecutable = steps.some(item => item.canExecute);
    const onlyWaiting = steps.length > 0 && steps.every(item => item.status === 'waiting');
    return buildResult({
        workflowType: 'management_action',
        goal: input.goal || (input.actionId ? '处理指定管理待办' : '按优先级处理当前管理待办'),
        status: steps.length === 0 ? 'complete' : hasExecutable ? 'ready' : onlyWaiting ? 'waiting' : 'action_required',
        summary: steps.length === 0
            ? '当前没有需要处理的管理待办。'
            : `已按当前优先级生成 ${steps.length} 个处理步骤；执行前仍会重新检查最新状态。`,
        subject: {
            type: 'management_action',
            id: input.actionId || 'priority_queue',
            label: input.actionId ? selected[0]?.title || '管理待办' : '当前优先管理事项',
            path: '/dashboard?view=actions',
        },
        generatedAt: center.generatedAt,
        steps,
    });
}

function buildQuotationPlan(input, source) {
    const quotationId = parsePositiveId(input.quotationId);
    if (!quotationId) throw executionError('报价转订单执行计划需要有效的 quotationId');
    const quotation = source.quotation;
    if (!quotation) throw executionError('报价单不存在', 404);
    const customerName = text(source.customerName);
    const items = parseJsonArray(quotation.itemsJson);
    const path = `/quotations?quotationId=${quotationId}`;
    if (quotation.convertedOrderId || quotation.status === '已转订单') {
        const orderId = Number(quotation.convertedOrderId || 0);
        return buildResult({
            workflowType: 'quotation_to_order',
            goal: input.goal || `将报价 #${quotationId} 转为订单`,
            status: 'complete',
            summary: `报价 #${quotationId} 已转为订单${orderId ? ` #${orderId}` : ''}，不会重复转单。`,
            subject: {
                type: 'quotation',
                id: quotationId,
                label: `报价 #${quotationId}${customerName ? ` · ${customerName}` : ''}`,
                path,
            },
            steps: [{
                id: 'quotation_already_converted',
                title: '确认报价已完成转单',
                reason: '数据库已记录对应订单，防止重复创建。',
                expectedResult: '保留唯一的报价与订单关联。',
                mode: 'automatic',
                status: 'complete',
                path: orderId ? `/orders?orderId=${orderId}` : path,
                evidence: ['convertedOrderId', 'quotationStatus'],
            }],
        });
    }

    const missing = [];
    if (!quotation.customerId || !customerName) missing.push('有效客户');
    if (items.length === 0) missing.push('报价明细');
    const dataBlocked = missing.length > 0;
    const accepted = quotation.status === '已接受';
    const steps = [{
        id: 'validate_quotation',
        title: '核对报价基础数据',
        reason: dataBlocked ? `缺少：${missing.join('、')}` : `已识别客户和 ${items.length} 项报价明细。`,
        expectedResult: '报价关联有效客户，并且至少包含一项可转订单明细。',
        mode: 'automatic',
        status: dataBlocked ? 'blocked' : 'complete',
        path,
        evidence: ['customerId', 'itemsJson', 'quotationStatus'],
    }];
    if (!accepted) {
        steps.push({
            id: 'accept_quotation',
            title: '确认客户接受报价',
            reason: `报价当前状态为“${quotation.status || '未知'}”，只有“已接受”才能转订单。`,
            expectedResult: '报价状态由业务判断更新为“已接受”。',
            mode: 'needs_input',
            status: dataBlocked ? 'blocked' : 'needs_input',
            path,
            dependsOn: dataBlocked ? ['validate_quotation'] : [],
            evidence: ['quotationStatus'],
        });
    }
    const conversionDependencies = [
        ...(dataBlocked ? ['validate_quotation'] : []),
        ...(!accepted ? ['accept_quotation'] : []),
    ];
    steps.push({
        id: 'convert_quotation',
        title: '确认并将报价转为订单',
        reason: accepted
            ? '报价已接受；确认后由 AI 通过现有事务转单接口执行，并立即检查新订单。'
            : '等待报价完成客户接受确认。',
        expectedResult: '事务内创建唯一订单，并回写报价的订单关联，不能重复转单。',
        mode: 'confirmable',
        status: conversionDependencies.length > 0 ? 'blocked' : 'available',
        path,
        dependsOn: conversionDependencies,
        evidence: ['quotationStatus', 'convertedOrderId'],
        canExecute: conversionDependencies.length === 0,
        confirmation: conversionDependencies.length === 0 ? {
            toolName: 'execute_factory_workflow_step',
            args: {
                workflowType: 'quotation_to_order',
                quotationId,
                actionId: 'convert_quotation',
            },
        } : null,
    });
    steps.push({
        id: 'check_created_order',
        title: '检查新订单生产准备状态',
        reason: '转单后需要按最新库存、BOM、采购进度和成本价格重新检查。',
        expectedResult: '新订单得到可生产、待补料、待复核或数据阻塞的实时结论。',
        mode: 'automatic',
        status: 'blocked',
        path: '/orders',
        dependsOn: ['convert_quotation'],
        evidence: ['orderReadiness'],
    });
    return buildResult({
        workflowType: 'quotation_to_order',
        goal: input.goal || `将报价 #${quotationId} 转为订单并检查生产准备`,
        status: dataBlocked ? 'blocked' : accepted ? 'ready' : 'needs_input',
        summary: dataBlocked
            ? `报价 #${quotationId} 缺少转单所需资料，需先补齐${missing.join('、')}。`
            : accepted
                ? `报价 #${quotationId} 已满足转单前置条件；可由 AI 发起确认，确认后事务转单并立即检查新订单准备状态。`
                : `报价 #${quotationId} 需先确认客户是否接受，再进入转单。`,
        subject: {
            type: 'quotation',
            id: quotationId,
            label: `报价 #${quotationId}${customerName ? ` · ${customerName}` : ''}`,
            path,
        },
        steps,
    });
}

function loadDefaultSource(input, options = {}) {
    const accessors = options.dbAccessors || require('../db.cjs');
    const database = options.db || accessors.db;
    if (input.workflowType === 'order_readiness') {
        const orderId = parsePositiveId(input.orderId);
        if (!orderId) return {};
        const record = database.prepare('SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL').get(orderId);
        if (!record) return {};
        const context = buildOrderReadinessContext(record, { dbAccessors: accessors, db: database });
        return {
            orderActionPlan: buildOrderReadinessPlan(context.readiness),
        };
    }
    if (input.workflowType === 'quotation_to_order') {
        const quotationId = parsePositiveId(input.quotationId);
        if (!quotationId) return {};
        const row = database.prepare('SELECT * FROM quotations WHERE id = ? AND deleted_at IS NULL').get(quotationId);
        if (!row) return {};
        const quotation = accessors.quotationRow(row);
        const customer = quotation.customerId
            ? database.prepare('SELECT name FROM customers WHERE id = ? AND deleted_at IS NULL').get(quotation.customerId)
            : null;
        return { quotation, customerName: customer?.name || '' };
    }
    return {
        managementCenter: decorateManagementActionCenter(buildManagementActionCenter()),
    };
}

function buildFactoryExecutionPlan(input = {}, options = {}) {
    const workflowType = text(input.workflowType);
    if (!WORKFLOW_TYPES.has(workflowType)) {
        throw executionError('workflowType 仅支持 order_readiness、quotation_to_order 或 management_action');
    }
    const normalized = { ...input, workflowType };
    const source = options.source || loadDefaultSource(normalized, options);
    if (workflowType === 'order_readiness') return buildOrderPlan(normalized, source);
    if (workflowType === 'quotation_to_order') return buildQuotationPlan(normalized, source);
    return buildManagementPlan(normalized, source);
}

module.exports = {
    SAFEGUARDS,
    WORKFLOW_TYPES,
    buildFactoryExecutionPlan,
};
