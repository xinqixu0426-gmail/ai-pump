const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const CATEGORY_RANK = {
    order_readiness: 0,
    business_risk: 1,
    data_quality: 2,
    rule_learning: 3,
    knowledge_health: 4,
};

function list(value) {
    return Array.isArray(value) ? value : [];
}

function text(value) {
    return String(value || '').trim();
}

function positiveCount(value, fallback = 1) {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? count : fallback;
}

function actionItem(input) {
    return {
        id: text(input.id),
        priority: PRIORITY_RANK[input.priority] === undefined ? 'low' : input.priority,
        category: text(input.category),
        categoryLabel: text(input.categoryLabel),
        title: text(input.title),
        detail: text(input.detail),
        action: text(input.action),
        owner: text(input.owner),
        path: text(input.path),
        count: positiveCount(input.count),
        entityType: text(input.entityType),
        entityId: text(input.entityId),
        sourceType: text(input.sourceType),
    };
}

function readinessItems(readiness = {}) {
    const verdictMeta = {
        blocked: { priority: 'critical', label: '数据阻塞' },
        waiting_materials: { priority: 'high', label: '待补料' },
        needs_review: { priority: 'high', label: '待复核' },
    };
    return list(readiness.items)
        .filter(item => verdictMeta[item.verdict])
        .map(item => {
            const orderId = Number(item.order?.id || 0);
            const meta = verdictMeta[item.verdict];
            const customer = text(item.order?.customerName) || '未命名客户';
            const nextAction = item.nextAction || {};
            const firstIssue = list(item.blockers)[0] || list(item.warnings)[0] || {};
            return actionItem({
                id: `order-readiness:${orderId}`,
                priority: meta.priority,
                category: 'order_readiness',
                categoryLabel: '订单准备',
                title: `订单 #${orderId} ${meta.label}`,
                detail: text(item.summary) || `${customer} 的订单需要处理。`,
                action: text(nextAction.title) || text(firstIssue.action) || '查看生产准备详情',
                owner: text(nextAction.owner) || (item.verdict === 'waiting_materials' ? '采购人员' : '业务负责人'),
                path: `/orders?orderId=${orderId}&view=readiness`,
                count: positiveCount(item.blockerCount || item.shortageCount || item.warningCount),
                entityType: 'order',
                entityId: orderId,
                sourceType: 'order_readiness',
            });
        });
}

function businessRiskItems(businessAlerts = {}) {
    return list(businessAlerts.alerts)
        .filter(alert => !(
            alert.scope === 'order'
            && /有\s*\d+\s*项待采购/.test(text(alert.title))
        ))
        .map((alert, index) => {
            const entityId = text(alert.entityId);
            const isOrder = alert.scope === 'order';
            return actionItem({
                id: `business-risk:${text(alert.scope) || 'general'}:${entityId || index}:${index}`,
                priority: alert.severity === 'high' ? 'high' : alert.severity === 'medium' ? 'medium' : 'low',
                category: 'business_risk',
                categoryLabel: '经营风险',
                title: alert.title,
                detail: alert.detail,
                action: alert.action,
                owner: isOrder ? '业务负责人' : '销售负责人',
                path: isOrder && entityId
                    ? `/orders?orderId=${entityId}&view=items`
                    : text(alert.path) || '/dashboard',
                entityType: text(alert.scope),
                entityId,
                sourceType: 'business_alert',
            });
        });
}

function dataQualityItems(quality = {}) {
    return list(quality.issues)
        .filter(issue => Number(issue.count || 0) > 0)
        .map(issue => actionItem({
            id: `data-quality:${text(issue.key)}`,
            priority: issue.severity === 'danger' ? 'high' : issue.severity === 'warning' ? 'medium' : 'low',
            category: 'data_quality',
            categoryLabel: '数据质量',
            title: `${text(issue.title)}（${Number(issue.count || 0)} 项）`,
            detail: text(issue.suggestion),
            action: '进入数据质量查看明细',
            owner: '资料管理员',
            path: '/dashboard?view=quality',
            count: issue.count,
            entityType: 'quality_issue',
            entityId: issue.key,
            sourceType: 'data_quality',
        }));
}

function ruleLearningItems(learningHealth = {}, candidates = []) {
    const grouped = new Map();
    for (const item of list(learningHealth.items).filter(entry => entry.needsRecheck)) {
        const recipeId = Number(item.recipeId || 0);
        if (!grouped.has(recipeId)) {
            grouped.set(recipeId, {
                recipeId,
                recipeName: text(item.recipeName) || `配方 #${recipeId}`,
                feedbackIds: [],
                reasons: [],
            });
        }
        const group = grouped.get(recipeId);
        group.feedbackIds.push(Number(item.feedbackId));
        if (item.reason && !group.reasons.includes(item.reason)) group.reasons.push(item.reason);
    }

    const items = [...grouped.values()].map(group => actionItem({
        id: `rule-learning:recipe:${group.recipeId}`,
        priority: 'medium',
        category: 'rule_learning',
        categoryLabel: '规则学习',
        title: `${group.recipeName} 有 ${group.feedbackIds.length} 条反馈待复核`,
        detail: group.reasons.join('；'),
        action: '按当前配方重新运行智能检查',
        owner: '配方管理员',
        path: `/recipes?recipeId=${group.recipeId}&feedbackIds=${group.feedbackIds.join(',')}&action=smart-check`,
        count: group.feedbackIds.length,
        entityType: 'recipe',
        entityId: group.recipeId,
        sourceType: 'rule_learning_health',
    }));

    const candidateRules = list(candidates).filter(candidate => candidate.status === 'candidate');
    const reviewRules = list(candidates).filter(candidate => candidate.status === 'approved' && candidate.needsReview);
    if (reviewRules.length > 0) {
        items.push(actionItem({
            id: 'rule-learning:approved-review',
            priority: 'high',
            category: 'rule_learning',
            categoryLabel: '规则学习',
            title: `${reviewRules.length} 条已批准规则需要复核`,
            detail: '规则出现新反例、模板漂移或内容过期证据，需要确认是否继续适用。',
            action: '进入数据质量复核规则证据',
            owner: '业务负责人',
            path: '/dashboard?view=quality',
            count: reviewRules.length,
            entityType: 'factory_rule',
            entityId: 'approved-review',
            sourceType: 'factory_rule_candidates',
        }));
    }
    if (candidateRules.length > 0) {
        items.push(actionItem({
            id: 'rule-learning:candidates',
            priority: 'medium',
            category: 'rule_learning',
            categoryLabel: '规则学习',
            title: `${candidateRules.length} 条候选业务规则待审核`,
            detail: '候选规则来自人工确认反馈，审核前不会作为正式工厂规则执行。',
            action: '进入数据质量审核候选规则',
            owner: '业务负责人',
            path: '/dashboard?view=quality',
            count: candidateRules.length,
            entityType: 'factory_rule',
            entityId: 'candidates',
            sourceType: 'factory_rule_candidates',
        }));
    }
    return items;
}

function knowledgeHealthItems(knowledgeHealth = {}) {
    return list(knowledgeHealth.issues).map(issue => actionItem({
        id: `knowledge-health:${text(issue.code)}`,
        priority: issue.severity === 'critical' ? 'critical' : 'high',
        category: 'knowledge_health',
        categoryLabel: '知识健康',
        title: issue.title,
        detail: issue.message,
        action: '进入知识库检查并按确认流程恢复',
        owner: '系统管理员',
        path: '/dashboard?view=knowledge',
        entityType: 'knowledge_sync',
        entityId: issue.code,
        sourceType: 'knowledge_health',
    }));
}

function loadDefaultSources() {
    const { buildActiveOrdersReadinessOverview } = require('./activeOrderReadiness.cjs');
    const { buildBusinessAlerts } = require('./businessAlerts.cjs');
    const { buildDataQualitySummary } = require('./qualitySummary.cjs');
    const {
        buildFactoryLearningHealth,
        listFactoryRuleCandidates,
    } = require('./factoryRuleCandidates.cjs');
    const { inspectKnowledgeOverview } = require('./knowledge.cjs');
    const { listKnowledgeSyncRuns } = require('./knowledgeSyncHistory.cjs');
    const { buildKnowledgeSyncHealth } = require('./knowledgeSyncHealth.cjs');

    const knowledgeOverview = inspectKnowledgeOverview();
    return {
        readiness: buildActiveOrdersReadinessOverview(),
        businessAlerts: buildBusinessAlerts(),
        quality: buildDataQualitySummary(),
        learningHealth: buildFactoryLearningHealth({ limit: 200 }),
        candidates: listFactoryRuleCandidates(),
        knowledgeHealth: buildKnowledgeSyncHealth({
            autoSync: knowledgeOverview.autoSync,
            pendingTotal: knowledgeOverview.stats.pendingTotal,
            history: listKnowledgeSyncRuns({ limit: 10 }),
        }),
    };
}

function buildManagementActionCenter(options = {}) {
    const sources = options.sources || loadDefaultSources();
    const generatedAt = (options.now || new Date()).toISOString();
    const items = [
        ...readinessItems(sources.readiness),
        ...businessRiskItems(sources.businessAlerts),
        ...dataQualityItems(sources.quality),
        ...ruleLearningItems(sources.learningHealth, sources.candidates),
        ...knowledgeHealthItems(sources.knowledgeHealth),
    ].sort((left, right) => {
        const priorityDifference = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
        if (priorityDifference !== 0) return priorityDifference;
        const categoryDifference = (CATEGORY_RANK[left.category] ?? 99) - (CATEGORY_RANK[right.category] ?? 99);
        if (categoryDifference !== 0) return categoryDifference;
        return left.title.localeCompare(right.title, 'zh-CN');
    });

    const countPriority = priority => items.filter(item => item.priority === priority).length;
    const categoryCounts = Object.fromEntries(
        Object.keys(CATEGORY_RANK).map(category => [
            category,
            items.filter(item => item.category === category).length,
        ])
    );
    const metrics = {
        total: items.length,
        critical: countPriority('critical'),
        high: countPriority('high'),
        medium: countPriority('medium'),
        low: countPriority('low'),
        attentionRequired: items.filter(item => item.priority !== 'low').length,
        categoryCounts,
    };
    const summary = items.length === 0
        ? '当前没有需要处理的管理待办。'
        : `当前有 ${items.length} 项管理待办，其中 ${metrics.critical} 项紧急、${metrics.high} 项高优先级、${metrics.medium} 项普通优先级。`;

    return { generatedAt, summary, metrics, items };
}

module.exports = {
    buildManagementActionCenter,
    readinessItems,
    businessRiskItems,
    dataQualityItems,
    ruleLearningItems,
    knowledgeHealthItems,
};
