const ACTION_LABELS = {
    repair_order_data: '修正订单产品与BOM',
    resolve_packaging_estimate: '选择正式外包装',
    repair_recipe_source: '恢复配方来源',
    resolve_part_inventory: '关联零件库存项目',
    resolve_coil_inventory: '完善线圈库存方案',
    review_order_cost_price: '复核订单成本与价格',
    confirm_order: '确认订单并进入采购流程',
    generate_purchase_plan: '生成采购清单',
    place_purchase_orders: '完成采购下单',
    track_purchase_arrival: '跟进采购到货',
    stock_received_materials: '完成到货入库',
    reconcile_inventory_shortage: '复核入库与库存差异',
};

function nowIso(now) {
    return (now || new Date()).toISOString();
}

function issueCount(findings, codes) {
    const codeSet = new Set(codes);
    return findings.filter(item => codeSet.has(item.code)).length;
}

function findingTitles(findings, codes) {
    const codeSet = new Set(codes);
    return findings
        .filter(item => codeSet.has(item.code))
        .map(item => String(item.title || ''))
        .filter(Boolean);
}

function createStep(id, options = {}) {
    return {
        id,
        sequence: 0,
        category: options.category || 'data',
        title: ACTION_LABELS[id] || options.title || id,
        reason: options.reason || '',
        expectedResult: options.expectedResult || '',
        priority: options.priority || 'required',
        mode: options.mode || 'manual',
        status: options.status || 'available',
        owner: options.owner || '管理员',
        path: options.path || '',
        dependsOn: Array.isArray(options.dependsOn) ? options.dependsOn : [],
        evidenceCodes: Array.isArray(options.evidenceCodes) ? options.evidenceCodes : [],
        itemCount: Number(options.itemCount || 0),
        ...(options.toolCall ? { toolCall: options.toolCall } : {}),
    };
}

function groupShortagesByStage(shortages) {
    return shortages.reduce((groups, item) => {
        const stage = String(item.procurementStage || '库存仍不足');
        if (!groups.has(stage)) groups.set(stage, []);
        groups.get(stage).push(item);
        return groups;
    }, new Map());
}

function buildOrderReadinessPlan(readiness = {}, options = {}) {
    const generatedAt = nowIso(options.now);
    const order = readiness.order || {};
    const orderId = Number(order.id || 0);
    const verdict = String(readiness.verdict || '');
    const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
    const warnings = Array.isArray(readiness.warnings) ? readiness.warnings : [];
    const shortages = Array.isArray(readiness.shortages) ? readiness.shortages : [];

    if (verdict === 'not_applicable') {
        return {
            generatedAt,
            order,
            readinessVerdict: verdict,
            planStatus: 'not_applicable',
            summary: `订单 #${orderId} 已结束，不生成处理方案。`,
            metrics: { totalSteps: 0, confirmableSteps: 0, manualSteps: 0, waitingSteps: 0, blockedSteps: 0 },
            steps: [],
        };
    }

    if (verdict === 'ready') {
        return {
            generatedAt,
            order,
            readinessVerdict: verdict,
            planStatus: 'complete',
            summary: `订单 #${orderId} 当前已满足生产准备条件，无需新增处理步骤。`,
            metrics: { totalSteps: 0, confirmableSteps: 0, manualSteps: 0, waitingSteps: 0, blockedSteps: 0 },
            steps: [],
        };
    }

    const steps = [];
    const blockingDependencies = [];
    const addBlockingStep = (step) => {
        steps.push(step);
        blockingDependencies.push(step.id);
    };

    const orderDataCodes = ['order_items_missing', 'invalid_order_quantity', 'order_bom_missing'];
    const orderDataCount = issueCount(blockers, orderDataCodes);
    if (orderDataCount > 0) {
        addBlockingStep(createStep('repair_order_data', {
            category: 'order',
            reason: findingTitles(blockers, orderDataCodes).join('；'),
            expectedResult: '订单产品数量有效，并且每项产品都保留可核对的BOM快照。',
            priority: 'blocking',
            mode: 'manual',
            owner: '订单管理员',
            path: '/orders',
            evidenceCodes: orderDataCodes,
            itemCount: orderDataCount,
        }));
    }

    const packagingCount = issueCount(blockers, ['packaging_estimate_unresolved']);
    if (packagingCount > 0) {
        addBlockingStep(createStep('resolve_packaging_estimate', {
            category: 'recipe',
            reason: findingTitles(blockers, ['packaging_estimate_unresolved']).join('；'),
            expectedResult: '订单外包装绑定到零件库中的具体型号和供应商，估算占位项不进入采购清单。',
            priority: 'blocking',
            mode: 'manual',
            owner: '订单管理员',
            path: '/orders',
            evidenceCodes: ['packaging_estimate_unresolved'],
            itemCount: packagingCount,
        }));
    }

    const recipeCount = issueCount(warnings, ['recipe_source_missing']);
    if (recipeCount > 0) {
        steps.push(createStep('repair_recipe_source', {
            category: 'recipe',
            reason: findingTitles(warnings, ['recipe_source_missing']).join('；'),
            expectedResult: '订单BOM快照能够追溯到当前有效配方。',
            priority: 'review',
            mode: 'manual',
            owner: '配方管理员',
            path: '/recipes',
            evidenceCodes: ['recipe_source_missing'],
            itemCount: recipeCount,
        }));
    }

    const partCount = issueCount(blockers, ['part_inventory_unresolved']);
    if (partCount > 0) {
        addBlockingStep(createStep('resolve_part_inventory', {
            category: 'inventory',
            reason: findingTitles(blockers, ['part_inventory_unresolved']).join('；'),
            expectedResult: '所有普通采购物料都关联到可追溯的零件库存项目。',
            priority: 'blocking',
            mode: 'manual',
            owner: '零件管理员',
            path: '/parts',
            evidenceCodes: ['part_inventory_unresolved'],
            itemCount: partCount,
        }));
    }

    const coilCount = issueCount(blockers, ['coil_inventory_unresolved']);
    if (coilCount > 0) {
        addBlockingStep(createStep('resolve_coil_inventory', {
            category: 'inventory',
            reason: findingTitles(blockers, ['coil_inventory_unresolved']).join('；'),
            expectedResult: '计算型线圈已经匹配到正式线圈方案和库存记录。',
            priority: 'blocking',
            mode: 'manual',
            owner: '线圈管理员',
            path: '/coils',
            evidenceCodes: ['coil_inventory_unresolved'],
            itemCount: coilCount,
        }));
    }

    const costCodes = ['locked_cost_missing', 'price_below_cost', 'margin_too_low'];
    const costCount = issueCount(warnings, costCodes);
    if (costCount > 0) {
        steps.push(createStep('review_order_cost_price', {
            category: 'cost',
            reason: findingTitles(warnings, costCodes).join('；'),
            expectedResult: '订单锁定成本和销售单价经过业务确认；需要调整时再明确目标价格。',
            priority: 'review',
            mode: 'needs_input',
            status: 'needs_input',
            owner: '业务负责人',
            path: '/orders',
            evidenceCodes: costCodes,
            itemCount: costCount,
        }));
    }

    if (issueCount(blockers, ['order_not_confirmed']) > 0) {
        const dependencies = [...blockingDependencies];
        steps.push(createStep('confirm_order', {
            category: 'order',
            reason: '订单仍处于待确认状态，正式采购前需要确认。',
            expectedResult: '订单离开“待确认”，并按实时采购进度进入“待采购”“采购中”或“采购完成”。',
            priority: 'required',
            mode: 'confirmable',
            status: dependencies.length > 0 ? 'blocked' : 'available',
            owner: 'AI',
            path: '/orders',
            dependsOn: dependencies,
            evidenceCodes: ['order_not_confirmed'],
            itemCount: 1,
            toolCall: {
                name: 'update_order_status',
                args: { orderId, status: '待采购' },
            },
        }));
        blockingDependencies.push('confirm_order');
    }

    const shortagesByStage = groupShortagesByStage(shortages);
    const procurementDependencies = [...blockingDependencies];
    const procurementDefinitions = [
        ['未生成采购计划', 'generate_purchase_plan', 'confirmable', 'AI', '生成并保存当前订单的采购清单。', {
            name: 'generate_purchase_list',
            args: { orderId },
        }],
        ['待下单', 'place_purchase_orders', 'manual', '采购人员', '缺料项目完成下单并记录采购数量。'],
        ['待到货', 'track_purchase_arrival', 'monitor', '采购人员', '跟进供应商交期，货物到达后登记到货。'],
        ['待入库', 'stock_received_materials', 'manual', '仓库人员', '已到货物料完成入库，库存成为可用数量。'],
        ['库存仍不足', 'reconcile_inventory_shortage', 'manual', '仓库人员', '核对入库记录、实际库存和订单需求差异。'],
    ];
    for (const [stage, id, mode, owner, expectedResult, toolCall] of procurementDefinitions) {
        const stageItems = shortagesByStage.get(stage) || [];
        if (stageItems.length === 0) continue;
        const dependencies = [...procurementDependencies];
        steps.push(createStep(id, {
            category: 'procurement',
            reason: `${stageItems.length} 项缺料处于“${stage}”：${stageItems.slice(0, 5).map(item => item.model).join('、')}`,
            expectedResult,
            priority: 'required',
            mode,
            status: dependencies.length > 0 ? 'blocked' : mode === 'monitor' ? 'waiting' : 'available',
            owner,
            path: '/purchase',
            dependsOn: dependencies,
            evidenceCodes: ['material_shortage'],
            itemCount: stageItems.length,
            ...(toolCall ? { toolCall } : {}),
        }));
    }

    const sequencedSteps = steps.map((item, index) => ({ ...item, sequence: index + 1 }));
    const metrics = {
        totalSteps: sequencedSteps.length,
        confirmableSteps: sequencedSteps.filter(item => item.mode === 'confirmable' && item.status === 'available').length,
        manualSteps: sequencedSteps.filter(item => (
            (item.mode === 'manual' || item.mode === 'needs_input') && item.status !== 'blocked'
        )).length,
        waitingSteps: sequencedSteps.filter(item => item.status === 'waiting').length,
        blockedSteps: sequencedSteps.filter(item => item.status === 'blocked').length,
    };
    const hasBlockingRepair = sequencedSteps.some(item => item.priority === 'blocking');
    const hasAvailableConfirmation = sequencedSteps.some(item => item.mode === 'confirmable' && item.status === 'available');
    const hasAvailableAction = sequencedSteps.some(item => ['manual', 'needs_input'].includes(item.mode) && item.status !== 'blocked');
    const hasWaiting = sequencedSteps.some(item => item.mode === 'monitor' && item.status !== 'blocked');
    let planStatus = 'action_required';
    if (hasBlockingRepair) planStatus = 'needs_resolution';
    else if (hasAvailableConfirmation) planStatus = 'ready_for_confirmation';
    else if (!hasAvailableAction && hasWaiting) planStatus = 'waiting';

    return {
        generatedAt,
        order,
        readinessVerdict: verdict,
        planStatus,
        summary: `订单 #${orderId} 生成 ${metrics.totalSteps} 个处理步骤：${metrics.confirmableSteps} 个可由AI发起确认，${metrics.manualSteps} 个需要人工处理，${metrics.waitingSteps} 个等待跟进，${metrics.blockedSteps} 个受前置步骤阻塞。`,
        metrics,
        steps: sequencedSteps,
    };
}

module.exports = { buildOrderReadinessPlan };
