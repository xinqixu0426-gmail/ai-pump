async function executeOrderReadinessAction(args = {}, dependencies = {}) {
    const {
        internalFetch,
        getJson,
        postJson,
        recordWorkflowRun,
    } = dependencies;
    const orderId = Number.parseInt(args.orderId, 10);
    const actionId = String(args.actionId || '').trim();
    if (!Number.isInteger(orderId) || orderId <= 0) {
        return { success: false, error: '订单ID无效' };
    }
    if (!['confirm_order', 'generate_purchase_plan'].includes(actionId)) {
        return { success: false, error: `不支持的订单处理步骤：${actionId}` };
    }
    const startedAt = new Date().toISOString();
    let currentPlan = null;
    try {
        currentPlan = await postJson(
            internalFetch,
            '/api/workbench/execution-plan',
            {
                workflowType: 'order_readiness',
                orderId,
                goal: `处理订单 #${orderId} 的生产准备问题`,
            },
            '执行前刷新订单计划失败'
        );
        const step = (Array.isArray(currentPlan.steps) ? currentPlan.steps : [])
            .find(item => item.id === actionId);
        if (!step || step.status !== 'available' || step.canExecute !== true) {
            throw new Error(`当前计划中的“${actionId}”步骤已不可执行，请按最新状态处理。`);
        }
        const readinessPlan = await getJson(
            internalFetch,
            `/api/orders/${orderId}/readiness-plan`,
            '执行前读取订单正式预览失败'
        );
        const command = readinessPlan.actions?.[actionId]
            || (Array.isArray(readinessPlan.steps)
                ? readinessPlan.steps.find(item => item.id === actionId)?.command
                : null);
        if (!command?.expectedUpdatedAt
            || !command?.previewHash
            || !command?.suggestedIdempotencyKey) {
            throw new Error('订单正式预览缺少版本、预览哈希或幂等键，已停止执行。');
        }
        const data = await postJson(
            internalFetch,
            `/api/orders/${orderId}/readiness-actions/${encodeURIComponent(actionId)}`,
            {
                expectedUpdatedAt: command.expectedUpdatedAt,
                previewHash: command.previewHash,
                idempotencyKey: command.suggestedIdempotencyKey,
            },
            '订单处理步骤执行失败'
        );
        const recorded = await recordWorkflowRun(internalFetch, {
            workflowType: 'order_readiness',
            subjectType: 'order',
            subjectId: orderId,
            actionId,
            toolName: 'execute_order_readiness_action',
            status: 'completed',
            plan: currentPlan,
            result: {
                orderId,
                orderStatus: data.order?.status || '',
                nextPlanStatus: data.nextPlan?.planStatus || '',
            },
            recheck: data.nextPlan || {},
            outcomeSummary: `订单 #${orderId} 已执行“${data.action?.title || actionId}”`,
            startedAt,
        });
        return {
            success: true,
            intent: 'order_readiness_action',
            message: `已执行：${data.action?.title || actionId}`,
            display: { mode: 'compact', title: '订单处理结果' },
            data: {
                ...data,
                executionRun: recorded.run,
                historyWarning: recorded.warning,
            },
        };
    } catch (error) {
        const fallbackPlan = currentPlan || {
            workflowType: 'order_readiness',
            subject: { type: 'order', id: orderId },
            steps: [],
        };
        const recorded = await recordWorkflowRun(internalFetch, {
            workflowType: 'order_readiness',
            subjectType: 'order',
            subjectId: orderId,
            actionId,
            toolName: 'execute_order_readiness_action',
            status: 'failed',
            plan: fallbackPlan,
            recheck: currentPlan || {},
            outcomeSummary: '订单处理步骤执行失败',
            error: error.message,
            startedAt,
        });
        return {
            success: false,
            error: error.message,
            data: {
                currentPlan,
                executionRun: recorded.run,
                historyWarning: recorded.warning,
            },
        };
    }
}

module.exports = {
    executeOrderReadinessAction,
};
