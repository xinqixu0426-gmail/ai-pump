const { dbGetAllOrders } = require('../db.cjs');
const { formatBjt } = require('./dashboardBrief.cjs');

function parseJsonList(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function summarizeOrder(order) {
    if (!order) return null;
    const items = parseJsonList(order.itemsJson);
    const purchaseList = parseJsonList(order.purchaseListJson);
    const todos = parseJsonList(order.todosJson);
    const needToBuy = purchaseList.filter(item => Number(item.needToBuy || 0) > 0);
    const purchased = needToBuy.filter(item => item.purchased);
    const totalCost = items.reduce((sum, item) => sum + Number(item.unitCost || item.cost || 0) * Number(item.qty || 1), 0);
    const totalPrice = items.reduce((sum, item) => sum + Number(item.unitPrice || item.price || 0) * Number(item.qty || 1), 0);

    return {
        id: order.Id,
        customerName: order.customerName || '',
        contractNo: order.contractNo || '',
        remark: order.remark || '',
        status: order.status || '待采购',
        createdAt: order.CreatedAt || null,
        updatedAt: order.UpdatedAt || null,
        createdAtText: formatBjt(order.CreatedAt),
        updatedAtText: formatBjt(order.UpdatedAt),
        itemCount: items.length,
        purchaseItemCount: purchaseList.length,
        needToBuyCount: needToBuy.length,
        purchasedCount: purchased.length,
        todoCount: todos.length,
        openTodoCount: todos.filter(todo => !todo.done).length,
        totalCost,
        totalPrice,
        items: items.slice(0, 8).map(item => ({
            recipeName: item.recipeName || item.name || item.model || '',
            qty: Number(item.qty || 1),
            unitCost: Number(item.unitCost || item.cost || 0),
            unitPrice: Number(item.unitPrice || item.price || 0),
        })),
        purchaseList: purchaseList.slice(0, 8).map(item => ({
            name: item.name || '',
            model: item.model || '',
            supplier: item.supplier || '',
            needToBuy: Number(item.needToBuy || 0),
            purchased: Boolean(item.purchased),
        })),
        todos: todos.slice(0, 8).map(todo => ({
            supplier: todo.supplier || '',
            description: todo.description || '',
            done: Boolean(todo.done),
        })),
    };
}

function findOrderByKeyword(keyword) {
    const rawKeyword = String(keyword || '').trim();
    if (!rawKeyword) return { order: null, matches: [] };

    const orders = dbGetAllOrders();
    const normalized = normalizeText(rawKeyword);
    const numericId = /^\d+$/.test(rawKeyword) ? Number(rawKeyword) : null;

    let matches = [];
    if (numericId) {
        matches = orders.filter(order => Number(order.Id) === numericId);
    }
    if (matches.length === 0) {
        matches = orders.filter(order => {
            const haystack = [
                order.contractNo,
                order.customerName,
                order.remark,
                order.status,
                order.Id,
            ].map(normalizeText).join(' ');
            return haystack.includes(normalized);
        });
    }

    matches.sort((a, b) => String(b.UpdatedAt || '').localeCompare(String(a.UpdatedAt || '')));
    return { order: matches[0] || null, matches };
}

function buildOrderText(summary) {
    if (!summary) return '未找到订单';
    const title = summary.contractNo || `订单${summary.id}`;
    const lines = [
        `${title} | ${summary.customerName || '未填写客户'} | ${summary.status}`,
        `产品 ${summary.itemCount} 项，需采购 ${summary.needToBuyCount} 项，待办 ${summary.openTodoCount} 项`,
    ];
    if (summary.totalPrice > 0 || summary.totalCost > 0) {
        lines.push(`金额：成本 ${summary.totalCost.toFixed(2)}，出厂价 ${summary.totalPrice.toFixed(2)}`);
    }
    if (summary.items.length > 0) {
        lines.push(`产品：${summary.items.slice(0, 3).map(item => `${item.recipeName}x${item.qty}`).join('、')}`);
    }
    if (summary.purchaseList.length > 0) {
        lines.push(`采购：${summary.purchaseList.slice(0, 3).map(item => `${item.model || item.name}(${item.needToBuy})`).join('、')}`);
    }
    return lines.join('\n');
}

module.exports = {
    findOrderByKeyword,
    summarizeOrder,
    buildOrderText,
};
