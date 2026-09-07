// A small financial-value check, independent of domains, plans and tool names.
// It prevents a resource ID or invented amount from being presented as money.
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
            if (/cost|price|amount|fee|wage|subtotal|diff/i.test(key) && (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)))) add(Number(value));
            return;
        }
        if (Array.isArray(value)) { for (const item of value) walk(item, key); return; }
        for (const [childKey, child] of Object.entries(value)) {
            if (childKey === 'value' && /成本|金额|单价|工资|费用/.test(String(value.label || '')) && typeof child === 'number') add(child);
            else walk(child, childKey);
        }
    }
    for (const item of toolResults) if (item?.result?.success !== false) walk(item.result);
    return values;
}

function formatMoneySummary(toolResults = []) {
    const { getAiCapability } = require('../capabilities/registry.cjs');
    const labels = { totalCost: '总成本', cost: '成本', costDiff: '成本差额（后者减前者）', totalDiff: '成本差额（后者减前者）', partsCost: '零件成本', laborCost: '人工成本' };
    const rows = [];
    const escape = value => String(value).replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
    function visit(value, label, depth = 0) {
        if (!value || typeof value !== 'object' || depth > 3) return;
        const name = value.name || value.recipeName || value.schemeCode || label;
        for (const [key, item] of Object.entries(value)) {
            if (labels[key] && /^-?\d+(?:\.\d+)?$/.test(String(item))) rows.push(`| ${escape(name)} | ${labels[key]} | ${escape(item)} |`);
            else if (item && typeof item === 'object' && !['executionEvidence', 'provenance', 'comparison'].includes(key)) visit(item, name, depth + 1);
        }
    }
    for (const item of toolResults) {
        const capability = getAiCapability(item.name);
        if (item.result?.success !== false && !item.result?.data?.requiresVariantSelection && capability?.operation === 'preview' && capability?.domains.includes('cost')) visit(item.result, capability.displayName);
    }
    if (!rows.length) return '';
    return `本轮正式查询金额如下（元）：\n\n| 对象 | 项目 | 金额 |\n|---|---|---:|\n${rows.slice(0, 12).join('\n')}\n\n完整计算明细见本轮工具结果。`;
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

module.exports = { monetaryValues, unsupportedMoneyInAnswer, formatMoneySummary };
