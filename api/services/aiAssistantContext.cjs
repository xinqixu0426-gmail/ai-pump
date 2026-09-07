const { estimateTextTokens } = require('./aiTokenBudget.cjs');

// Model-only views. The executor receipt, UI detail and identifier evidence stay intact.
const LIST_DETAILS = {
    get_recent_orders: 'get_order_detail',
    search_quotations: 'get_quotation_detail',
    get_all_recipes: 'get_recipe_detail',
};

function normalizeJsonFields(value) {
    if (Array.isArray(value)) return value.map(normalizeJsonFields);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
        if (/Json$/.test(key) && typeof child === 'string') {
            try { const parsed = JSON.parse(child); if (parsed && typeof parsed === 'object') child = parsed; } catch { /* Preserve malformed source verbatim. */ }
        }
        return [key, normalizeJsonFields(child)];
    }));
}

function modelResultView(name, result) {
    const detailTool = LIST_DETAILS[name];
    if (!detailTool || result?.success === false || !Array.isArray(result?.data)) return normalizeJsonFields(result);
    return {
        ...result,
        data: result.data.map(row => {
            const omittedFields = [];
            const summary = Object.fromEntries(Object.entries(row).filter(([key, value]) => {
                const omit = /Json$/.test(key) || (value !== null && typeof value === 'object') || (typeof value === 'string' && /^[\[{]/.test(value.trim()));
                if (omit) omittedFields.push(key);
                return !omit;
            }));
            return { ...summary, ...(omittedFields.length ? { omittedFields } : {}) };
        }),
        modelView: { kind: 'list_summary', detailTool, note: '列表仅用于列举与选择。嵌套明细未在此展示，不代表为空；需要配置、物料、采购、成本明细时按本行 ID 调用详情工具。完整原始回执保留在页面明细。' },
    };
}

function previousContext(previous, maxTokens = 4096) {
    if (!previous) return '';
    const view = { question: previous.question, toolResults: (previous.toolResults || []).map(item => ({ name: item.name, args: item.args, result: modelResultView(item.name, item.result) })) };
    if (estimateTextTokens(JSON.stringify(view)) > maxTokens) {
        // Never clip JSON or silently drop candidate IDs: explicitly require a fresh query.
        return '上一轮结果较大，本轮未携带旧明细。请结合对话重新查询目标与候选；不得猜测旧候选或复用旧金额。';
    }
    return `本会话上一轮查询摘要（仅用于引用；实时事实需本轮重查）：${JSON.stringify(view)}`;
}

function compactToolDescriptions(tools) {
    function schema(value) {
        if (Array.isArray(value)) return value.map(schema);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description').map(([key, child]) => [key, key === 'properties' || key === '$defs' || key === 'definitions' ? Object.fromEntries(Object.entries(child).map(([name, definition]) => [name, schema(definition)])) : schema(child)]));
    }
    return tools.map(tool => ({ ...tool, function: { ...tool.function, description: tool.function.description.split(/[。\n]/)[0].slice(0, 100), parameters: schema(tool.function.parameters) } }));
}

module.exports = { modelResultView, previousContext, normalizeJsonFields, compactToolDescriptions };
