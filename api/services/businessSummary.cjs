const { dbGetAllOrders, dbGetAllParts, dbGetAllRecipes } = require('../db.cjs');

const STATUS_PENDING = '待采购';
const STATUS_PURCHASING = '采购中';
const STATUS_COMPLETED = '已完成';

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function sameLocalDay(value, now = new Date()) {
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    return date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate();
}

function normalizeOrder(order) {
    const items = parseJsonArray(order.itemsJson);
    const purchaseList = parseJsonArray(order.purchaseListJson);
    const todos = parseJsonArray(order.todosJson);
    const totalCost = items.reduce((sum, item) => sum + Number(item.unitCost || 0) * Number(item.qty || 0), 0);
    const totalPrice = items.reduce((sum, item) => sum + Number(item.unitPrice || 0) * Number(item.qty || 0), 0);

    return {
        id: String(order.Id),
        numericId: Number(order.Id),
        customerName: order.customerName || '',
        contractNo: order.contractNo || '',
        remark: order.remark || '',
        status: order.status || STATUS_PENDING,
        items,
        purchaseList,
        todos,
        totalCost: roundMoney(totalCost),
        totalPrice: roundMoney(totalPrice),
        totalProfit: roundMoney(totalPrice - totalCost),
        createdAt: order.CreatedAt,
        updatedAt: order.UpdatedAt,
    };
}

function buildSupplierFocus(purchaseOrders) {
    const supplierMap = new Map();
    for (const order of purchaseOrders) {
        for (const item of order.purchaseList) {
            const needToBuy = Number(item.needToBuy || 0);
            if (needToBuy <= 0 || item.purchased) continue;

            const supplier = String(item.supplier || '').trim() || '未指定供应商';
            const current = supplierMap.get(supplier) || {
                supplier,
                pendingQty: 0,
                orderIds: new Set(),
            };
            current.pendingQty += needToBuy;
            current.orderIds.add(order.id);
            supplierMap.set(supplier, current);
        }
    }

    return [...supplierMap.values()]
        .sort((a, b) => b.pendingQty - a.pendingQty)
        .slice(0, 8)
        .map(item => ({
            supplier: item.supplier,
            pendingQty: roundMoney(item.pendingQty),
            orderCount: item.orderIds.size,
            orderIds: [...item.orderIds],
        }));
}

function summarizePart(part) {
    return {
        id: part.Id,
        model: part.model,
        category: part.category,
        supplier: part.supplier,
        price: Number(part.price || 0),
        stock: Number(part.stock || 0),
    };
}

function summarizeOrder(order) {
    return {
        id: order.numericId,
        customerName: order.customerName,
        contractNo: order.contractNo,
        status: order.status,
        itemCount: order.items.length,
        purchaseItemCount: order.purchaseList.filter(item => Number(item.needToBuy || 0) > 0).length,
        purchasedItemCount: order.purchaseList.filter(item => Number(item.needToBuy || 0) > 0 && item.purchased).length,
        totalPrice: order.totalPrice,
        createdAt: order.createdAt,
    };
}

function buildPendingPurchaseItems(purchaseOrders) {
    const map = new Map();
    for (const order of purchaseOrders) {
        for (const item of order.purchaseList) {
            const needToBuy = Number(item.needToBuy || 0);
            if (needToBuy <= 0 || item.purchased) continue;

            const supplier = String(item.supplier || '').trim() || '未指定供应商';
            const model = String(item.model || '').trim() || item.name || '未命名零件';
            const key = `${supplier}||${model}`;
            const current = map.get(key) || {
                key,
                supplier,
                model,
                name: item.name || model,
                needToBuy: 0,
                currentStock: Number(item.currentStock || 0),
                orderIds: new Set(),
                orders: [],
            };

            current.needToBuy += needToBuy;
            current.currentStock = Math.min(current.currentStock, Number(item.currentStock || 0));
            if (!current.orderIds.has(order.id)) {
                current.orderIds.add(order.id);
                current.orders.push({
                    id: order.numericId,
                    customerName: order.customerName,
                    contractNo: order.contractNo,
                });
            }
            map.set(key, current);
        }
    }

    return [...map.values()]
        .sort((a, b) => String(a.supplier).localeCompare(String(b.supplier), 'zh') || b.needToBuy - a.needToBuy)
        .slice(0, 80)
        .map(item => ({
            key: item.key,
            supplier: item.supplier,
            model: item.model,
            name: item.name,
            needToBuy: roundMoney(item.needToBuy),
            currentStock: item.currentStock,
            orderCount: item.orderIds.size,
            orders: item.orders,
        }));
}

function buildBusinessSummary(options = {}) {
    const now = options.now || new Date();
    const orders = (options.orders || dbGetAllOrders()).map(normalizeOrder)
        .sort((a, b) => b.numericId - a.numericId);
    const parts = options.parts || dbGetAllParts();
    const recipes = options.recipes || dbGetAllRecipes();

    const activeOrders = orders.filter(order => order.status !== STATUS_COMPLETED);
    const purchaseOrders = activeOrders.filter(order =>
        order.purchaseList.some(item => Number(item.needToBuy || 0) > 0 && !item.purchased)
    );
    const readyToReceiveOrders = activeOrders.filter(order => {
        const needItems = order.purchaseList.filter(item => Number(item.needToBuy || 0) > 0);
        return needItems.length > 0 && needItems.every(item => item.purchased);
    });
    const todayOrders = orders.filter(order => sameLocalDay(order.createdAt, now));
    const outOfStockParts = parts.filter(part => Number(part.stock || 0) <= 0);
    const lowStockParts = parts.filter(part => Number(part.stock || 0) > 0 && Number(part.stock || 0) <= 5);

    const totalCost = roundMoney(orders.reduce((sum, order) => sum + order.totalCost, 0));
    const totalRevenue = roundMoney(orders.reduce((sum, order) => sum + order.totalPrice, 0));
    const totalProfit = roundMoney(totalRevenue - totalCost);

    const ordersByStatus = {
        [STATUS_PENDING]: orders.filter(order => order.status === STATUS_PENDING).length,
        [STATUS_PURCHASING]: orders.filter(order => order.status === STATUS_PURCHASING).length,
        [STATUS_COMPLETED]: orders.filter(order => order.status === STATUS_COMPLETED).length,
    };

    return {
        generatedAt: now.toISOString(),
        kpis: {
            totalOrders: orders.length,
            activeOrders: activeOrders.length,
            recipeCount: recipes.length,
            partCount: parts.length,
            totalCost,
            totalRevenue,
            totalProfit,
            lowStockPartCount: lowStockParts.length,
            outOfStockPartCount: outOfStockParts.length,
            todayOrderCount: todayOrders.length,
        },
        orders: {
            total: orders.length,
            active: activeOrders.length,
            pendingPurchase: ordersByStatus[STATUS_PENDING],
            purchasing: ordersByStatus[STATUS_PURCHASING],
            completed: ordersByStatus[STATUS_COMPLETED],
            today: todayOrders.length,
            [STATUS_PENDING]: ordersByStatus[STATUS_PENDING],
            [STATUS_PURCHASING]: ordersByStatus[STATUS_PURCHASING],
            [STATUS_COMPLETED]: ordersByStatus[STATUS_COMPLETED],
            latest: orders.slice(0, 8).map(order => ({
                id: order.numericId,
                customerName: order.customerName,
                contractNo: order.contractNo,
                status: order.status,
                itemCount: order.items.length,
                totalPrice: order.totalPrice,
                createdAt: order.createdAt,
            })),
        },
        recipes: {
            total: recipes.length,
        },
        parts: {
            total: parts.length,
            lowStock: lowStockParts.length,
            outOfStock: outOfStockParts.length,
        },
        financials: {
            totalCost,
            totalRevenue,
            totalProfit,
            profitRate: totalRevenue > 0 ? roundMoney((totalProfit / totalRevenue) * 100) : 0,
        },
        workbench: {
            items: [
                {
                    key: 'pending_purchase',
                    label: '待采购',
                    count: purchaseOrders.length,
                    desc: '订单中仍有未采购零件',
                    path: '/purchase',
                    severity: 'warning',
                },
                {
                    key: 'ready_to_receive',
                    label: '可确认入库',
                    count: readyToReceiveOrders.length,
                    desc: '采购项已标记完成，等待入库确认',
                    path: '/orders',
                    severity: 'success',
                },
                {
                    key: 'out_of_stock_parts',
                    label: '缺货零件',
                    count: outOfStockParts.length,
                    desc: `另有 ${lowStockParts.length} 个低库存零件`,
                    path: '/parts',
                    severity: 'danger',
                },
                {
                    key: 'today_orders',
                    label: '今日新增订单',
                    count: todayOrders.length,
                    desc: '今天录入或转化的订单',
                    path: '/orders',
                    severity: 'info',
                },
            ],
            supplierFocus: buildSupplierFocus(purchaseOrders),
            pendingPurchaseItems: buildPendingPurchaseItems(purchaseOrders),
            readyToReceiveOrders: readyToReceiveOrders.slice(0, 20).map(summarizeOrder),
            todayOrders: todayOrders.slice(0, 20).map(summarizeOrder),
            lowStockParts: lowStockParts.slice(0, 20).map(summarizePart),
            outOfStockParts: outOfStockParts.slice(0, 20).map(summarizePart),
        },
    };
}

module.exports = { buildBusinessSummary };
