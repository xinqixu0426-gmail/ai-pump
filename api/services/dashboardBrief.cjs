const {
    dbGetAllParts,
    dbGetAllRecipes,
    dbGetAllTemplates,
    dbGetAllOrders,
} = require('../db.cjs');

const BJT_TIME_ZONE = 'Asia/Shanghai';

function dateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('zh-CN', {
        timeZone: BJT_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function formatBjt(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: BJT_TIME_ZONE,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
}

function parseJsonList(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function createdToday(row, todayKey) {
    return dateKey(row?.CreatedAt) === todayKey;
}

function isDoneStatus(status) {
    const text = String(status || '');
    return text.includes('完成') || text.includes('已完成') || text.toLowerCase().includes('done');
}

function isPurchaseStatus(status) {
    const text = String(status || '');
    return text.includes('采购') || text.includes('待采') || text.toLowerCase().includes('purchase');
}

function compactPart(part) {
    return {
        id: part.Id,
        model: part.model,
        category: part.category,
        supplier: part.supplier,
        stock: Number(part.stock || 0),
        price: Number(part.price || 0),
        createdAt: part.CreatedAt || null,
        createdAtText: formatBjt(part.CreatedAt),
    };
}

function compactRecipe(recipe) {
    return {
        id: recipe.Id,
        name: recipe.name,
        spec: recipe.spec,
        savedTotalCost: Number(recipe.saved_total_cost || 0),
        createdAt: recipe.CreatedAt || null,
        createdAtText: formatBjt(recipe.CreatedAt),
    };
}

function compactTemplate(template) {
    return {
        id: template.Id,
        shellModel: template.shell_model,
        description: template.description,
        createdAt: template.CreatedAt || null,
        createdAtText: formatBjt(template.CreatedAt),
    };
}

function compactOrder(order) {
    const items = parseJsonList(order.itemsJson);
    const purchaseList = parseJsonList(order.purchaseListJson);
    const todos = parseJsonList(order.todosJson);
    return {
        id: order.Id,
        customerName: order.customerName,
        contractNo: order.contractNo,
        status: order.status,
        itemCount: items.length,
        purchaseItemCount: purchaseList.length,
        todoCount: todos.length,
        createdAt: order.CreatedAt || null,
        createdAtText: formatBjt(order.CreatedAt),
    };
}

function buildDashboardBrief(options = {}) {
    const todayKey = options.dateKey || dateKey(new Date());
    const limit = Number(options.limit || 8);
    const parts = dbGetAllParts();
    const recipes = dbGetAllRecipes();
    const templates = dbGetAllTemplates();
    const orders = dbGetAllOrders();

    const newParts = parts.filter(part => createdToday(part, todayKey)).map(compactPart).slice(0, limit);
    const newRecipes = recipes.filter(recipe => createdToday(recipe, todayKey)).map(compactRecipe).slice(0, limit);
    const newTemplates = templates.filter(template => createdToday(template, todayKey)).map(compactTemplate).slice(0, limit);

    const outOfStockParts = parts
        .filter(part => Number(part.stock || 0) <= 0)
        .sort((a, b) => String(a.category || '').localeCompare(String(b.category || ''), 'zh'))
        .map(compactPart)
        .slice(0, limit);

    const lowStockParts = parts
        .filter(part => Number(part.stock || 0) > 0 && Number(part.stock || 0) <= 5)
        .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0))
        .map(compactPart)
        .slice(0, limit);

    const pendingOrders = orders
        .filter(order => !isDoneStatus(order.status))
        .map(compactOrder)
        .slice(0, limit);

    const purchaseOrders = orders
        .filter(order => {
            const purchaseList = parseJsonList(order.purchaseListJson);
            const todos = parseJsonList(order.todosJson);
            return isPurchaseStatus(order.status) || purchaseList.length > 0 || todos.length > 0;
        })
        .map(compactOrder)
        .slice(0, limit);

    return {
        date: todayKey,
        generatedAt: new Date().toISOString(),
        generatedAtText: formatBjt(new Date()),
        summary: {
            partCount: parts.length,
            recipeCount: recipes.length,
            templateCount: templates.length,
            orderCount: orders.length,
            newPartCount: parts.filter(part => createdToday(part, todayKey)).length,
            newRecipeCount: recipes.filter(recipe => createdToday(recipe, todayKey)).length,
            newTemplateCount: templates.filter(template => createdToday(template, todayKey)).length,
            lowStockCount: parts.filter(part => Number(part.stock || 0) > 0 && Number(part.stock || 0) <= 5).length,
            outOfStockCount: parts.filter(part => Number(part.stock || 0) <= 0).length,
            pendingOrderCount: orders.filter(order => !isDoneStatus(order.status)).length,
            purchaseOrderCount: orders.filter(order => {
                const purchaseList = parseJsonList(order.purchaseListJson);
                const todos = parseJsonList(order.todosJson);
                return isPurchaseStatus(order.status) || purchaseList.length > 0 || todos.length > 0;
            }).length,
        },
        newParts,
        newRecipes,
        newTemplates,
        lowStockParts,
        outOfStockParts,
        pendingOrders,
        purchaseOrders,
    };
}

function buildBriefText(brief) {
    const s = brief.summary;
    const lines = [
        `业务简报 ${brief.date}`,
        `今日新增：零件 ${s.newPartCount}，配方 ${s.newRecipeCount}，模板 ${s.newTemplateCount}`,
        `库存提醒：缺货 ${s.outOfStockCount}，低库存 ${s.lowStockCount}`,
        `订单提醒：未完成 ${s.pendingOrderCount}，待采购/采购中 ${s.purchaseOrderCount}`,
    ];
    if (brief.purchaseOrders.length > 0) {
        lines.push(`优先关注：${brief.purchaseOrders.slice(0, 3).map(o => o.contractNo || o.customerName || `订单${o.id}`).join('、')}`);
    } else if (brief.lowStockParts.length > 0) {
        lines.push(`优先关注：${brief.lowStockParts.slice(0, 3).map(p => `${p.model}(${p.stock})`).join('、')}`);
    }
    return lines.join('\n');
}

module.exports = {
    buildDashboardBrief,
    buildBriefText,
    dateKey,
    formatBjt,
};
