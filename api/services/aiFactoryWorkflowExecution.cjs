function normalizeText(value) {
    return String(value || '').trim();
}

async function executeFactoryWorkflowStep(args = {}, dependencies = {}) {
    const {
        internalFetch,
        getJson,
        postJson,
        recordWorkflowRun,
    } = dependencies;
    const workflowType = normalizeText(args.workflowType);
    const quotationId = Number(args.quotationId);
    const actionId = normalizeText(args.actionId);
    if (workflowType !== 'quotation_to_order' || actionId !== 'convert_quotation') {
        return { success: false, error: '当前只支持执行报价转订单步骤' };
    }
    if (!Number.isInteger(quotationId) || quotationId <= 0) {
        return { success: false, error: '缺少有效的报价ID' };
    }

    const planInput = {
        workflowType,
        quotationId,
        goal: `将报价 #${quotationId} 转为订单并检查生产准备`,
    };
    const startedAt = new Date().toISOString();
    let currentPlan = null;
    let converted = null;
    try {
        currentPlan = await postJson(
            internalFetch,
            '/api/workbench/execution-plan',
            planInput,
            '执行前刷新工厂计划失败'
        );
        const step = (Array.isArray(currentPlan.steps) ? currentPlan.steps : [])
            .find(item => item.id === actionId);
        const confirmation = step?.confirmation;
        const confirmationArgs = confirmation?.args || {};
        if (
            !step
            || step.mode !== 'confirmable'
            || step.status !== 'available'
            || step.canExecute !== true
            || confirmation?.toolName !== 'execute_factory_workflow_step'
            || confirmationArgs.workflowType !== workflowType
            || Number(confirmationArgs.quotationId) !== quotationId
            || confirmationArgs.actionId !== actionId
        ) {
            const message = `当前计划中的“${actionId}”步骤已不可执行，请刷新计划后按最新状态处理。`;
            const recorded = await recordWorkflowRun(internalFetch, {
                workflowType,
                subjectType: 'quotation',
                subjectId: quotationId,
                actionId,
                toolName: 'execute_factory_workflow_step',
                status: 'failed',
                plan: currentPlan,
                recheck: currentPlan,
                outcomeSummary: '实时重验后拒绝执行',
                error: message,
                startedAt,
            });
            return {
                success: false,
                error: message,
                data: {
                    currentPlan,
                    executionRun: recorded.run,
                    historyWarning: recorded.warning,
                },
            };
        }

        const conversionDraft = await postJson(
            internalFetch,
            `/api/quotations/${quotationId}/order-draft`,
            {},
            '报价转订单预检失败'
        );
        converted = await postJson(
            internalFetch,
            `/api/quotations/${quotationId}/convert`,
            {
                expectedUpdatedAt: conversionDraft.expectedUpdatedAt,
                previewHash: conversionDraft.previewHash,
            },
            '报价转订单失败'
        );
        const orderId = Number(converted.order?.id || converted.order?.Id || 0);
        if (!orderId) throw new Error('报价已转单，但接口未返回有效订单ID');
        const nextPlan = await getJson(
            internalFetch,
            `/api/orders/${orderId}/readiness-plan`,
            '新订单生产准备检查失败'
        );
        const workflowPlan = await postJson(
            internalFetch,
            '/api/workbench/execution-plan',
            planInput,
            '转单后刷新工厂计划失败'
        );
        const recorded = await recordWorkflowRun(internalFetch, {
            workflowType,
            subjectType: 'quotation',
            subjectId: quotationId,
            actionId,
            toolName: 'execute_factory_workflow_step',
            status: 'completed',
            plan: currentPlan,
            result: {
                quotationId,
                orderId,
                orderStatus: converted.order?.status || '',
                nextPlanStatus: nextPlan.planStatus || '',
            },
            recheck: workflowPlan,
            outcomeSummary: `报价 #${quotationId} 已转为订单 #${orderId}`,
            startedAt,
        });
        return {
            success: true,
            intent: 'factory_workflow_action',
            summary: `报价 #${quotationId} 已转为订单 #${orderId}，并完成新订单生产准备检查。`,
            display: { mode: 'compact', title: '工厂工作流执行结果' },
            data: {
                action: {
                    id: actionId,
                    title: '确认转单并检查新订单',
                    executedAt: new Date().toISOString(),
                },
                quotation: converted.quotation,
                order: converted.order,
                nextPlan,
                workflowPlan,
                executionRun: recorded.run,
                historyWarning: recorded.warning,
            },
        };
    } catch (error) {
        let latestPlan = currentPlan;
        if (converted) {
            try {
                latestPlan = await postJson(
                    internalFetch,
                    '/api/workbench/execution-plan',
                    planInput,
                    '失败后刷新工厂计划失败'
                );
            } catch {
                // The conversion response remains authoritative for preventing retries.
            }
        }
        const fallbackPlan = currentPlan || {
            workflowType,
            subject: { type: 'quotation', id: quotationId },
            steps: [],
        };
        const writeCompleted = Boolean(converted);
        const recorded = await recordWorkflowRun(internalFetch, {
            workflowType,
            subjectType: 'quotation',
            subjectId: quotationId,
            actionId,
            toolName: 'execute_factory_workflow_step',
            status: writeCompleted ? 'completed' : 'failed',
            plan: fallbackPlan,
            result: writeCompleted ? {
                quotationId,
                orderId: Number(converted.order?.id || converted.order?.Id || 0),
                orderStatus: converted.order?.status || '',
            } : {},
            recheck: latestPlan || {},
            outcomeSummary: writeCompleted
                ? `报价 #${quotationId} 已完成转单，但后续复查未完整完成`
                : '报价转订单执行失败',
            error: error.message,
            startedAt,
        });
        if (writeCompleted) {
            return {
                success: true,
                intent: 'factory_workflow_action',
                summary: `报价 #${quotationId} 已完成转单，但后续检查失败：${error.message}`,
                display: { mode: 'compact', title: '工厂工作流执行结果' },
                data: {
                    action: {
                        id: actionId,
                        title: '确认转单',
                        executedAt: new Date().toISOString(),
                    },
                    quotation: converted.quotation,
                    order: converted.order,
                    workflowPlan: latestPlan,
                    followUpError: error.message,
                    executionRun: recorded.run,
                    historyWarning: recorded.warning,
                },
            };
        }
        return {
            success: false,
            error: error.message,
            data: {
                currentPlan: latestPlan,
                executionRun: recorded.run,
                historyWarning: recorded.warning,
            },
        };
    }
}

module.exports = {
    executeFactoryWorkflowStep,
};
