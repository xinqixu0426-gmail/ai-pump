const VERDICT_PRIORITY = {
    blocked: 0,
    waiting_materials: 1,
    needs_review: 2,
    ready: 3,
    not_applicable: 4,
};

function list(value) {
    return Array.isArray(value) ? value : [];
}

function compactIssue(item = {}) {
    return {
        code: String(item.code || ''),
        title: String(item.title || ''),
        detail: String(item.detail || ''),
        action: String(item.action || ''),
        path: String(item.path || ''),
    };
}

function compactShortage(item = {}) {
    return {
        identityKey: String(item.identityKey || ''),
        model: String(item.model || item.name || ''),
        shortageQty: Number(item.shortageQty || 0),
        purchaseUnit: String(item.purchaseUnit || ''),
        procurementStage: String(item.procurementStage || ''),
        inventoryType: String(item.inventoryType || ''),
    };
}

function nextPlanStep(actionPlan = {}) {
    const steps = list(actionPlan.steps);
    const step = steps.find(item => item.status === 'available')
        || steps.find(item => item.status !== 'blocked');
    if (!step) return null;
    return {
        id: String(step.id || ''),
        sequence: Number(step.sequence || 0),
        title: String(step.title || ''),
        mode: String(step.mode || ''),
        status: String(step.status || ''),
        owner: String(step.owner || ''),
        path: String(step.path || ''),
        expectedResult: String(step.expectedResult || ''),
    };
}

function overviewItem(entry = {}) {
    const readiness = entry.readiness || {};
    const actionPlan = entry.actionPlan || {};
    const blockers = list(readiness.blockers);
    const warnings = list(readiness.warnings);
    const shortages = list(readiness.shortages);
    return {
        order: readiness.order || {},
        verdict: String(readiness.verdict || 'blocked'),
        canProduce: readiness.canProduce === true,
        summary: String(readiness.summary || ''),
        planStatus: String(actionPlan.planStatus || ''),
        metrics: readiness.metrics || {},
        blockerCount: blockers.length,
        warningCount: warnings.length,
        shortageCount: shortages.length,
        blockers: blockers.slice(0, 3).map(compactIssue),
        warnings: warnings.slice(0, 3).map(compactIssue),
        shortages: shortages.slice(0, 5).map(compactShortage),
        nextAction: nextPlanStep(actionPlan),
    };
}

function buildOrderReadinessOverview(entries = [], options = {}) {
    const generatedAt = (options.now || new Date()).toISOString();
    const items = list(entries)
        .map(overviewItem)
        .sort((left, right) => {
            const verdictDifference = (VERDICT_PRIORITY[left.verdict] ?? 99) - (VERDICT_PRIORITY[right.verdict] ?? 99);
            if (verdictDifference !== 0) return verdictDifference;
            return Number(right.order?.id || 0) - Number(left.order?.id || 0);
        });

    const metrics = {
        totalActiveOrders: items.length,
        ready: items.filter(item => item.verdict === 'ready').length,
        waitingMaterials: items.filter(item => item.verdict === 'waiting_materials').length,
        needsReview: items.filter(item => item.verdict === 'needs_review').length,
        blocked: items.filter(item => item.verdict === 'blocked').length,
        attentionRequired: items.filter(item => item.verdict !== 'ready' && item.verdict !== 'not_applicable').length,
    };
    const summary = metrics.totalActiveOrders === 0
        ? '当前没有需要检查的活动订单。'
        : `共检查 ${metrics.totalActiveOrders} 个活动订单：${metrics.ready} 个可生产，${metrics.waitingMaterials} 个待补料，${metrics.needsReview} 个待复核，${metrics.blocked} 个数据阻塞。`;

    return { generatedAt, summary, metrics, items };
}

module.exports = { buildOrderReadinessOverview };
