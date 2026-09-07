// A small financial-value check, independent of domains, plans and tool names.
// It prevents a resource ID or invented amount from being presented as money.
const { hasVerifiedExecution } = require('./aiExecutionEvidence.cjs');

function monetaryValues(toolResults = []) {
    const values = new Set();
    function add(number) {
        if (!Number.isFinite(number)) return;
        values.add(String(number));
        values.add(String(Number(number.toFixed(2))));
        values.add(String(Number(Math.abs(number).toFixed(2))));
    }
    function walk(value, key = '') {
        if (!value || typeof value !== 'object') {
            if (/cost|price|amount|fee|wage|subtotal|diff|^copperBase$/i.test(key) && (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)))) add(Number(value));
            return;
        }
        if (Array.isArray(value)) { for (const item of value) walk(item, key); return; }
        for (const [childKey, child] of Object.entries(value)) {
            if (childKey === 'value' && /成本|金额|单价|工资|费用/.test(String(value.label || '')) && typeof child === 'number') add(child);
            else walk(child, childKey);
        }
    }
    for (const item of toolResults) if (item?.result?.success !== false && hasVerifiedExecution(item.result)) walk(item.result);
    return values;
}

function formatMoneySummary(toolResults = [], { includeQueries = false } = {}) {
    const { getAiCapability } = require('../capabilities/registry.cjs');
    const labels = { currentTotalCost: '当前总成本', totalCost: '总成本', cost: '档案成本', price: '目录单价', costDiff: '成本差额（后者减前者）', totalDiff: '成本差额（后者减前者）', partsCost: '零件成本', laborCost: '人工成本' };
    const rows = [];
    const configurations = [];
    const escape = value => String(value).replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
    function visit(value, label, depth = 0) {
        if (!value || typeof value !== 'object' || depth > 3) return;
        const name = [value.name || value.recipeName || value.model || value.schemeCode, value.spec && value.sheets ? `${value.spec}-${value.sheets}` : '', value.material, value.slotType].filter(Boolean).join(' / ') || label;
        for (const [key, item] of Object.entries(value)) {
            if (labels[key] && /^-?\d+(?:\.\d+)?$/.test(String(item))) rows.push(`| ${escape(name)} | ${labels[key]} | ${escape(item)} |`);
            else if (item && typeof item === 'object' && !['executionEvidence', 'provenance', 'comparison'].includes(key)) visit(item, name, depth + 1);
        }
    }
    for (const item of toolResults) {
        const capability = getAiCapability(item.name);
        if (item.result?.success !== false && hasVerifiedExecution(item.result) && !item.result?.data?.requiresVariantSelection && capability?.access === 'read' && (capability.operation === 'preview' || (includeQueries && capability.operation === 'query'))) {
            visit(item.result, capability.displayName);
            const data = item.result.data;
            if (data?.costPreview && Array.isArray(data.parts)) {
                const names = data.parts.slice(0, 50).map(part => [part.model, part.name].filter(Boolean).join('（') + (part.model && part.name ? '）' : ''));
                configurations.push(`正式配置：${names.map(escape).join('、')}${data.parts.length > 50 ? '；其余配置见明细' : ''}。`);
                if (data.costPreview.pricingComplete === false) configurations.push('配置尚未全部定价，当前金额不是完整报价。');
            }
        }
    }
    if (!rows.length) return '';
    return `本轮正式查询金额如下（元）：\n\n| 对象 | 项目 | 金额 |\n|---|---|---:|\n${rows.slice(0, 12).join('\n')}\n\n${configurations.join('\n\n')}${configurations.length ? '\n\n' : ''}完整计算明细见本轮工具结果。`;
}

function verifiedMissingTarget(result) {
    return Boolean(result?.success === false && result.code === 'AI_RESOURCE_NOT_FOUND'
        && result.query && result.entityType && hasVerifiedExecution(result)
        && result.executionEvidence.kind === 'formal_api_query_failure');
}

function verifiedEmptyQuery(result) {
    const receipt = result?.queryReceipt;
    return Boolean(result?.success === true && hasVerifiedExecution(result)
        && result.executionEvidence.kind === 'formal_api_query'
        && Array.isArray(result.data) && result.data.length === 0
        && receipt?.authoritative === true && receipt.totalCount === 0 && receipt.returnedCount === 0
        && receipt.truncated === false && receipt.possiblyTruncated === false);
}

function unfinishedReply(toolResults = [], reason = '本次查询预算已用完，尚未完成全部核实。') {
    const missing = [...new Set(toolResults.filter(item => verifiedMissingTarget(item.result))
        .map(item => String(item.result.error || `未找到目标：${item.result.query}`)))];
    const { getAiCapability } = require('../capabilities/registry.cjs');
    for (const item of toolResults.filter(item => verifiedEmptyQuery(item.result))) {
        const text = `${getAiCapability(item.name)?.displayName || item.name}：未找到匹配记录；查询条件 ${JSON.stringify(item.result.queryReceipt.appliedFilters || {})}。这只说明该查询范围没有记录。`;
        if (!missing.includes(text)) missing.push(text);
    }
    const evidence = missing.length ? `\n\n已核实：\n${missing.slice(0, 10).map(text => `- ${text}`).join('\n')}` : '';
    return `${reason}${evidence}\n\n已取得的正式结果保留在下方；其余问题可分批继续。`;
}

function missingPreviewTotals(answer, toolResults = []) {
    const { getAiCapability } = require('../capabilities/registry.cjs');
    const numbers = new Set((String(answer).match(/-?\d+(?:\.\d+)?/g) || []).map(Number));
    return toolResults.some(item => {
        if (!hasVerifiedExecution(item.result) || item.result.success === false || item.result.data?.requiresVariantSelection
            || getAiCapability(item.name)?.operation !== 'preview') return false;
        const data = item.result.data || item.result;
        const total = data.costPreview?.currentTotalCost ?? data.currentTotalCost ?? data.totalCost;
        if (total === undefined || total === null || !Number.isFinite(Number(total))) return false;
        return !numbers.has(Number(total)) && !numbers.has(Number(Number(total).toFixed(2)));
    });
}

function unsupportedMoneyInAnswer(answer, toolResults) {
    const values = monetaryValues(toolResults);
    const unsupported = new Set();
    const pattern = /[¥￥]\s*(-?\d[\d,]*(?:\.\d+)?)|(-?\d[\d,]*(?:\.\d+)?)\s*元/gu;
    for (const match of String(answer || '').matchAll(pattern)) {
        const value = Number((match[1] || match[2]).replaceAll(',', ''));
        if (!values.has(String(value))) unsupported.add(value);
    }
    return [...unsupported];
}

module.exports = { monetaryValues, unsupportedMoneyInAnswer, formatMoneySummary, verifiedMissingTarget, verifiedEmptyQuery, unfinishedReply, missingPreviewTotals };
