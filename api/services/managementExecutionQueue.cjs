const PRIORITY_BASE = {
    critical: 400,
    high: 300,
    medium: 200,
    low: 100,
};

const PRIORITY_LABEL = {
    critical: '紧急事项',
    high: '高优先级',
    medium: '普通优先级',
    low: '低优先级',
};

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;

function positiveInteger(value, fallback = 1) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

function durationMinutes(fromValue, toValue) {
    const from = new Date(fromValue || '').getTime();
    const to = new Date(toValue || '').getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
    return Math.floor((to - from) / 60000);
}

function durationHours(fromValue, toValue) {
    return Math.floor(durationMinutes(fromValue, toValue) / 60);
}

function durationScore(hours) {
    if (hours >= 24 * 7) return 24;
    if (hours >= 24 * 3) return 16;
    if (hours >= 24) return 10;
    if (hours >= 6) return 5;
    return 0;
}

function impactScore(count) {
    if (count >= 20) return 24;
    if (count >= 10) return 18;
    if (count >= 5) return 12;
    if (count >= 2) return 6;
    return 0;
}

function durationReason(minutes) {
    if (minutes >= 24 * 60) return `已持续 ${Math.floor(minutes / 1440)} 天`;
    if (minutes >= 60) return `已持续 ${Math.floor(minutes / 60)} 小时`;
    if (minutes >= 1) return `已持续 ${minutes} 分钟`;
    return '刚刚出现';
}

function scoreManagementAction(item, generatedAt) {
    const priority = Object.prototype.hasOwnProperty.call(PRIORITY_BASE, item?.priority)
        ? item.priority
        : 'low';
    const count = positiveInteger(item?.count);
    const occurrenceCount = positiveInteger(item?.lifecycle?.occurrenceCount);
    const minutes = durationMinutes(item?.lifecycle?.activeSince, generatedAt);
    const hours = Math.floor(minutes / 60);
    const breakdown = {
        priority: PRIORITY_BASE[priority],
        duration: durationScore(hours),
        recurrence: Math.min(36, Math.max(0, occurrenceCount - 1) * 12),
        impact: impactScore(count),
    };
    const reasons = [
        PRIORITY_LABEL[priority],
        durationReason(minutes),
    ];
    if (occurrenceCount > 1) reasons.push(`第 ${occurrenceCount} 次出现`);
    if (count > 1) reasons.push(`涉及 ${count} 项`);

    return {
        score: Object.values(breakdown).reduce((total, value) => total + value, 0),
        scoreBreakdown: breakdown,
        reasons,
    };
}

function buildManagementExecutionQueue(center = {}, options = {}) {
    const generatedAt = options.generatedAt || center.generatedAt || new Date().toISOString();
    const requestedLimit = Number(options.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;
    const ranked = (Array.isArray(center.items) ? center.items : [])
        .map((item, sourceIndex) => ({
            ...item,
            ...scoreManagementAction(item, generatedAt),
            sourceIndex,
        }))
        .sort((left, right) => (
            right.score - left.score
            || left.sourceIndex - right.sourceIndex
            || String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN')
        ));
    const items = ranked.slice(0, limit).map(({ sourceIndex: _sourceIndex, ...item }, index) => ({
        ...item,
        rank: index + 1,
        queueLevel: index === 0 ? 'now' : 'next',
        queueLabel: index === 0 ? '现在先处理' : '接着处理',
    }));
    const remainingCount = Math.max(0, ranked.length - items.length);

    return {
        generatedAt,
        limit,
        totalCount: ranked.length,
        remainingCount,
        summary: items.length === 0
            ? '当前没有需要处理的事项。'
            : `当前最先处理：${items[0].title}。队列按业务优先级、持续时间、重复次数和影响范围自动排序。`,
        items,
    };
}

module.exports = {
    DEFAULT_LIMIT,
    MAX_LIMIT,
    buildManagementExecutionQueue,
    durationHours,
    durationMinutes,
    scoreManagementAction,
};
