const { TERMINAL_ORDER_STATUSES, normalizePurchaseItem } = require('./orderWorkflow.cjs');
const { isPackagingEstimatePart } = require('./packagingEstimate.cjs');

const STEP_LABELS = {
    order: '订单状态',
    recipe: '配方与BOM',
    parts: '零件库存',
    coils: '线圈库存',
    procurement: '采购进度',
    cost: '成本与价格',
};

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
    return Math.round(finiteNumber(value) * 100) / 100;
}

function issue(code, severity, title, detail, action, path) {
    return { code, severity, title, detail, action, path };
}

function step(key, status, summary, issues = []) {
    return {
        key,
        label: STEP_LABELS[key],
        status,
        summary,
        issues,
    };
}

function recipeExists(item, recipesById, recipesByName) {
    const recipeId = Number(item?.recipeId || 0);
    if (recipeId > 0 && recipesById.has(recipeId)) return true;
    const name = String(item?.recipeName || '').trim();
    return Boolean(name && recipesByName.has(name));
}

function procurementStage(item, shortageQty) {
    if (shortageQty <= 0) return '库存已满足';
    const normalized = normalizePurchaseItem(item);
    if (normalized.plannedQty <= 0) return '未生成采购计划';
    if (normalized.orderedQty < normalized.plannedQty) return '待下单';
    if (normalized.receivedQty < normalized.orderedQty) return '待到货';
    if (normalized.stockedQty < normalized.receivedQty) return '待入库';
    return '库存仍不足';
}

function action(key, label, path, reason) {
    return { key, label, path, reason };
}

function uniqueActions(actions) {
    const seen = new Set();
    return actions.filter(item => {
        if (seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
    });
}

function terminalReadiness(order, items, generatedAt) {
    const id = Number(order.id || 0);
    const status = String(order.status || '');
    return {
        generatedAt,
        order: {
            id,
            customerName: String(order.customerName || ''),
            contractNo: String(order.contractNo || ''),
            status,
            itemCount: items.length,
            totalUnits: items.reduce((sum, item) => sum + Math.max(0, finiteNumber(item.qty)), 0),
        },
        verdict: 'not_applicable',
        canProduce: false,
        summary: `订单 #${id} 已${status === '已取消' ? '取消' : '关闭'}，不再执行生产准备检查。`,
        metrics: {
            itemCount: items.length,
            totalUnits: items.reduce((sum, item) => sum + Math.max(0, finiteNumber(item.qty)), 0),
            materialLineCount: 0,
            shortageLineCount: 0,
            unresolvedLineCount: 0,
            totalLockedCost: 0,
            totalOrderPrice: 0,
            grossProfit: 0,
        },
        steps: [
            step('order', 'skipped', `订单状态为“${status}”，无需继续检查。`),
            ...['recipe', 'parts', 'coils', 'procurement', 'cost'].map(key => step(key, 'skipped', '未执行。')),
        ],
        shortages: [],
        blockers: [],
        warnings: [],
        recommendedActions: [],
    };
}

function buildOrderReadiness(options = {}) {
    const order = options.order || {};
    const plan = options.plan || {};
    const recipes = Array.isArray(options.recipes) ? options.recipes : [];
    const generatedAt = (options.now || new Date()).toISOString();
    const items = parseJsonArray(order.items ?? order.itemsJson);
    const purchaseList = Array.isArray(plan.purchaseList)
        ? plan.purchaseList
        : parseJsonArray(order.purchaseList ?? order.purchaseListJson);
    const orderId = Number(order.id || 0);
    const orderStatus = String(order.status || '待确认');

    if (TERMINAL_ORDER_STATUSES.has(orderStatus)) {
        return terminalReadiness(order, items, generatedAt);
    }

    const blockers = [];
    const warnings = [];
    const actions = [];
    const steps = [];

    const orderIssues = [];
    if (orderStatus === '待确认') {
        const item = issue(
            'order_not_confirmed',
            'high',
            '订单尚未确认',
            '订单仍处于待确认状态，不能作为正式生产依据。',
            '先核对并确认订单。',
            '/orders'
        );
        blockers.push(item);
        orderIssues.push(item.title);
        actions.push(action('confirm_order', '确认订单', '/orders', item.detail));
    }
    if (items.length === 0) {
        const item = issue(
            'order_items_missing',
            'high',
            '订单没有产品明细',
            '无法计算配方、物料和库存需求。',
            '补充订单产品明细。',
            '/orders'
        );
        blockers.push(item);
        orderIssues.push(item.title);
        actions.push(action('repair_order', '检查订单明细', '/orders', item.detail));
    }
    steps.push(step(
        'order',
        orderIssues.length > 0 ? 'fail' : 'pass',
        orderIssues.length > 0 ? orderIssues.join('；') : `订单状态“${orderStatus}”可继续检查。`,
        orderIssues
    ));

    const recipesById = new Map(recipes.map(recipe => [Number(recipe.id || 0), recipe]));
    const recipesByName = new Map(recipes.map(recipe => [String(recipe.name || '').trim(), recipe]));
    const recipeFailures = [];
    const recipeWarnings = [];
    items.forEach((item, index) => {
        const label = String(item.recipeName || `第 ${index + 1} 行`);
        const qty = finiteNumber(item.qty, -1);
        if (qty <= 0) {
            const finding = issue(
                'invalid_order_quantity',
                'high',
                `${label} 数量无效`,
                '订单产品数量必须大于 0。',
                '修正订单产品数量。',
                '/orders'
            );
            blockers.push(finding);
            recipeFailures.push(finding.title);
        }
        const parts = parseJsonArray(item.partsJson);
        if (parts.length === 0) {
            const finding = issue(
                'order_bom_missing',
                'high',
                `${label} 缺少BOM快照`,
                '没有订单BOM快照，无法核对零件和线圈需求。',
                '从有效配方重新生成订单明细。',
                '/orders'
            );
            blockers.push(finding);
            recipeFailures.push(finding.title);
        }
        const packagingEstimates = parts.filter(isPackagingEstimatePart);
        if (packagingEstimates.length > 0) {
            const finding = issue(
                'packaging_estimate_unresolved',
                'high',
                `${label} 外包装仍是估算项`,
                '成本估算占位项不能生成正式采购和库存记录。',
                '在配方或报价中选择具体外包装型号和供应商后重新生成订单明细。',
                '/orders'
            );
            blockers.push(finding);
            recipeFailures.push(finding.title);
            actions.push(action('resolve_packaging', '选择正式外包装', '/orders', finding.detail));
        }
        if (!recipeExists(item, recipesById, recipesByName)) {
            const finding = issue(
                'recipe_source_missing',
                'medium',
                `${label} 的来源配方不可追溯`,
                '订单快照仍被保留，但当前配方库中没有对应配方。',
                '核对配方是否被删除或改名。',
                '/recipes'
            );
            warnings.push(finding);
            recipeWarnings.push(finding.title);
            actions.push(action('review_recipes', '核对来源配方', '/recipes', finding.detail));
        }
    });
    const recipeStatus = recipeFailures.length > 0 ? 'fail' : recipeWarnings.length > 0 ? 'warning' : 'pass';
    steps.push(step(
        'recipe',
        recipeStatus,
        recipeFailures.length > 0
            ? `${recipeFailures.length} 项配方或BOM问题阻止检查。`
            : recipeWarnings.length > 0
                ? `BOM快照可用，但有 ${recipeWarnings.length} 项来源需要复核。`
                : `${items.length} 项产品均有有效配方来源和BOM快照。`,
        [...recipeFailures, ...recipeWarnings]
    ));

    const shortages = [];
    const unresolved = [];
    const unresolvedParts = [];
    const unresolvedCoils = [];
    for (const rawItem of purchaseList) {
        const item = normalizePurchaseItem(rawItem);
        const requiredQty = Math.max(0, finiteNumber(item.totalQty));
        const availableQty = Math.max(0, finiteNumber(item.currentStock));
        const shortageQty = Math.max(0, requiredQty - availableQty);
        const inventoryType = item.inventoryType === 'coil'
            ? 'coil'
            : item.inventoryType === 'none'
                ? 'none'
                : 'part';
        const row = {
            identityKey: String(item.identityKey || ''),
            model: String(item.model || item.name || ''),
            name: String(item.name || item.model || ''),
            supplier: String(item.supplier || ''),
            inventoryType,
            requiredQty,
            availableQty,
            shortageQty,
            purchaseUnit: String(item.purchaseUnit || ''),
            plannedQty: item.plannedQty,
            orderedQty: item.orderedQty,
            receivedQty: item.receivedQty,
            stockedQty: item.stockedQty,
            procurementStage: procurementStage(item, shortageQty),
        };
        if (shortageQty > 0) shortages.push(row);

        if (inventoryType === 'none') {
            const finding = issue(
                'coil_inventory_unresolved',
                'high',
                `${row.model} 没有正式线圈库存方案`,
                '该线圈是计算项，系统不能确认可用库存。',
                '建立正式线圈方案或人工确认线圈准备情况。',
                '/coils'
            );
            blockers.push(finding);
            unresolved.push(finding.title);
            unresolvedCoils.push(finding.title);
            actions.push(action('resolve_coils', '完善线圈方案', '/coils', finding.detail));
        } else if (inventoryType === 'part' && !item.partId) {
            const finding = issue(
                'part_inventory_unresolved',
                'high',
                `${row.model} 未关联零件库存`,
                '采购需求存在，但零件库中没有可追溯的库存项目。',
                '先在零件库中建立或关联该物料。',
                '/parts'
            );
            blockers.push(finding);
            unresolved.push(finding.title);
            unresolvedParts.push(finding.title);
            actions.push(action('resolve_parts', '完善零件库存项目', '/parts', finding.detail));
        }
    }

    const partLines = purchaseList.filter(item => item.inventoryType !== 'coil' && item.inventoryType !== 'none');
    const coilLines = purchaseList.filter(item => item.inventoryType === 'coil' || item.inventoryType === 'none');
    const partShortages = shortages.filter(item => item.inventoryType === 'part');
    const coilShortages = shortages.filter(item => item.inventoryType === 'coil' || item.inventoryType === 'none');
    steps.push(step(
        'parts',
        unresolvedParts.length > 0 ? 'fail' : partShortages.length > 0 ? 'warning' : 'pass',
        unresolvedParts.length > 0
            ? `${unresolvedParts.length} 项零件无法核对库存。`
            : partShortages.length > 0
                ? `${partShortages.length} 项零件库存不足。`
                : `${partLines.length} 项零件库存可覆盖当前订单。`,
        [...unresolvedParts, ...partShortages.map(item => `${item.model} 缺 ${item.shortageQty}${item.purchaseUnit}`)]
    ));
    steps.push(step(
        'coils',
        unresolvedCoils.length > 0 ? 'fail' : coilShortages.length > 0 ? 'warning' : 'pass',
        unresolvedCoils.length > 0
            ? `${unresolvedCoils.length} 项线圈无法核对正式库存。`
            : coilShortages.length > 0
                ? `${coilShortages.length} 项线圈库存不足。`
                : `${coilLines.length} 项线圈库存可覆盖当前订单。`,
        [...unresolvedCoils, ...coilShortages.map(item => `${item.model} 缺 ${item.shortageQty}${item.purchaseUnit || '套'}`)]
    ));

    if (shortages.length > 0) {
        actions.push(action('complete_procurement', '处理缺料采购', '/purchase', `${shortages.length} 项物料库存不足。`));
    }
    const stageCounts = shortages.reduce((counts, item) => {
        counts[item.procurementStage] = (counts[item.procurementStage] || 0) + 1;
        return counts;
    }, {});
    const stageSummary = Object.entries(stageCounts).map(([name, count]) => `${name} ${count} 项`).join('，');
    steps.push(step(
        'procurement',
        shortages.length > 0 ? 'warning' : 'pass',
        shortages.length > 0 ? `仍有 ${shortages.length} 项缺料：${stageSummary}。` : '当前订单没有待补库存缺口。',
        shortages.map(item => `${item.model}：${item.procurementStage}`)
    ));

    let totalLockedCost = 0;
    let totalOrderPrice = 0;
    const costIssues = [];
    items.forEach((item, index) => {
        const label = String(item.recipeName || `第 ${index + 1} 行`);
        const qty = Math.max(0, finiteNumber(item.qty));
        const unitCost = finiteNumber(item.unitCost);
        const unitPrice = finiteNumber(item.unitPrice);
        totalLockedCost += unitCost * qty;
        totalOrderPrice += unitPrice * qty;
        if (unitCost <= 0) {
            const finding = issue(
                'locked_cost_missing',
                'high',
                `${label} 缺少锁定成本`,
                '订单成本为 0，无法确认利润和成本口径。',
                '核对配方保存成本和订单成本快照。',
                '/orders'
            );
            warnings.push(finding);
            costIssues.push(finding.title);
            actions.push(action('review_cost', '核对订单成本', '/orders', finding.detail));
        } else if (unitPrice < unitCost) {
            const finding = issue(
                'price_below_cost',
                'high',
                `${label} 销售单价低于成本`,
                `销售单价 ${roundMoney(unitPrice)} 元低于锁定成本 ${roundMoney(unitCost)} 元。`,
                '确认是否允许亏损交付。',
                '/orders'
            );
            warnings.push(finding);
            costIssues.push(finding.title);
            actions.push(action('review_price', '复核订单价格', '/orders', finding.detail));
        } else if (unitPrice / unitCost < 1.05) {
            const finding = issue(
                'margin_too_low',
                'medium',
                `${label} 利润偏薄`,
                `销售单价与锁定成本的倍率为 ${(unitPrice / unitCost).toFixed(3)}。`,
                '确认客户折扣和最低利润要求。',
                '/orders'
            );
            warnings.push(finding);
            costIssues.push(finding.title);
            actions.push(action('review_price', '复核订单价格', '/orders', finding.detail));
        }
    });
    totalLockedCost = roundMoney(totalLockedCost);
    totalOrderPrice = roundMoney(totalOrderPrice);
    const grossProfit = roundMoney(totalOrderPrice - totalLockedCost);
    steps.push(step(
        'cost',
        costIssues.length > 0 ? 'warning' : 'pass',
        costIssues.length > 0
            ? `${costIssues.length} 项成本或价格风险需要确认。`
            : `锁定成本 ${totalLockedCost.toFixed(2)} 元，订单金额 ${totalOrderPrice.toFixed(2)} 元。`,
        costIssues
    ));

    let verdict = 'ready';
    if (blockers.length > 0) verdict = 'blocked';
    else if (shortages.length > 0) verdict = 'waiting_materials';
    else if (warnings.length > 0) verdict = 'needs_review';

    const summaries = {
        ready: `订单 #${orderId} 的生产准备检查通过，当前库存可覆盖 ${items.length} 项产品。`,
        waiting_materials: `订单 #${orderId} 当前不能直接生产：仍有 ${shortages.length} 项物料库存不足。`,
        needs_review: `订单 #${orderId} 的库存已满足，但有 ${warnings.length} 项业务风险需要确认。`,
        blocked: `订单 #${orderId} 暂不能判定可生产：有 ${blockers.length} 项状态或基础数据阻塞。`,
    };

    return {
        generatedAt,
        order: {
            id: orderId,
            customerName: String(order.customerName || ''),
            contractNo: String(order.contractNo || ''),
            status: orderStatus,
            itemCount: items.length,
            totalUnits: items.reduce((sum, item) => sum + Math.max(0, finiteNumber(item.qty)), 0),
        },
        verdict,
        canProduce: verdict === 'ready',
        summary: summaries[verdict],
        metrics: {
            itemCount: items.length,
            totalUnits: items.reduce((sum, item) => sum + Math.max(0, finiteNumber(item.qty)), 0),
            materialLineCount: purchaseList.length,
            shortageLineCount: shortages.length,
            unresolvedLineCount: unresolved.length,
            totalLockedCost,
            totalOrderPrice,
            grossProfit,
        },
        steps,
        shortages,
        blockers,
        warnings,
        recommendedActions: uniqueActions(actions),
    };
}

module.exports = { buildOrderReadiness };
