const STATUS_UNCONFIRMED = '待确认';
const STATUS_PENDING = '待采购';
const STATUS_PURCHASING = '采购中';
const STATUS_PURCHASED = '采购完成';
const STATUS_CLOSED = '已关闭';

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

function financialTotals(orders) {
    const lockedTotalCost = roundMoney(orders.reduce((sum, order) => sum + order.lockedTotalCost, 0));
    const procurementVariance = roundMoney(orders.reduce((sum, order) => sum + order.procurementVariance, 0));
    const totalCost = roundMoney(lockedTotalCost + procurementVariance);
    const totalRevenue = roundMoney(orders.reduce((sum, order) => sum + order.totalPrice, 0));
    const totalProfit = roundMoney(totalRevenue - totalCost);
    return {
        totalCost,
        lockedTotalCost,
        procurementVariance,
        totalRevenue,
        totalProfit,
        profitRate: totalRevenue > 0 ? roundMoney((totalProfit / totalRevenue) * 100) : 0,
    };
}

function loadDbAccessors() {
    return require('../db.cjs');
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
    const lockedTotalCost = items.reduce((sum, item) => sum + Number(item.unitCost || 0) * Number(item.qty || 0), 0);
    const totalPrice = items.reduce((sum, item) => sum + Number(item.unitPrice || 0) * Number(item.qty || 0), 0);
    const comparablePurchases = purchaseList.filter(item => (
        item.purchasePriceRecorded === true
        && Number(item.referencePrice || 0) > 0
        && Number(item.orderedQty ?? (item.purchased ? (item.plannedQty ?? item.needToBuy ?? 0) : 0)) > 0
    ));
    const procurementReferenceCost = comparablePurchases.reduce((sum, item) => {
        const qty = Number(item.orderedQty ?? (item.purchased ? (item.plannedQty ?? item.needToBuy ?? 0) : 0));
        return sum + Number(item.referencePrice || 0) * qty;
    }, 0);
    const procurementActualCost = comparablePurchases.reduce((sum, item) => {
        const qty = Number(item.orderedQty ?? (item.purchased ? (item.plannedQty ?? item.needToBuy ?? 0) : 0));
        return sum + Number(item.purchasePrice || 0) * qty;
    }, 0);
    const procurementVariance = roundMoney(procurementActualCost - procurementReferenceCost);
    const totalCost = roundMoney(lockedTotalCost + procurementVariance);

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
        lockedTotalCost: roundMoney(lockedTotalCost),
        procurementReferenceCost: roundMoney(procurementReferenceCost),
        procurementActualCost: roundMoney(procurementActualCost),
        procurementVariance,
        totalCost,
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
            const plannedQty = Number(item.plannedQty ?? item.needToBuy ?? 0);
            const orderedQty = Number(item.orderedQty ?? (item.purchased ? plannedQty : 0));
            const needToBuy = Math.max(0, plannedQty - orderedQty);
            if (needToBuy <= 0) continue;

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
        subcategory: part.subcategory || '',
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
        purchaseItemCount: order.purchaseList.filter(item => Number(item.plannedQty ?? item.needToBuy ?? 0) > 0).length,
        purchasedItemCount: order.purchaseList.filter(item => {
            const plannedQty = Number(item.plannedQty ?? item.needToBuy ?? 0);
            return plannedQty > 0 && Number(item.stockedQty || 0) >= plannedQty;
        }).length,
        totalPrice: order.totalPrice,
        createdAt: order.createdAt,
    };
}

function buildPendingPurchaseItems(purchaseOrders) {
    const map = new Map();
    for (const order of purchaseOrders) {
        for (const item of order.purchaseList) {
            const plannedQty = Number(item.plannedQty ?? item.needToBuy ?? 0);
            const orderedQty = Number(item.orderedQty ?? (item.purchased ? plannedQty : 0));
            const needToBuy = Math.max(0, plannedQty - orderedQty);
            if (needToBuy <= 0) continue;

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
    const accessors = options.dbAccessors || (
        options.orders && options.parts && options.recipes ? null : loadDbAccessors()
    );
    const orders = (options.orders || accessors.dbGetAllOrders()).map(normalizeOrder)
        .sort((a, b) => b.numericId - a.numericId);
    const parts = options.parts || accessors.dbGetAllParts();
    const recipes = options.recipes || accessors.dbGetAllRecipes();

    const validOrders = orders.filter(order => order.status !== '已取消');
    const confirmedOrders = validOrders.filter(order => order.status !== STATUS_UNCONFIRMED);
    const completedOrders = validOrders.filter(order => order.status === STATUS_CLOSED);
    const activeOrders = validOrders.filter(order => order.status !== STATUS_CLOSED);
    const purchaseOrders = activeOrders.filter(order =>
        order.purchaseList.some(item => {
            const plannedQty = Number(item.plannedQty ?? item.needToBuy ?? 0);
            return plannedQty > Number(item.orderedQty ?? (item.purchased ? plannedQty : 0));
        })
    );
    const readyToReceiveOrders = activeOrders.filter(order => {
        const needItems = order.purchaseList.filter(item => Number(item.plannedQty ?? item.needToBuy ?? 0) > 0);
        return needItems.length > 0 && needItems.some(item => (
            Number(item.receivedQty || 0) > Number(item.stockedQty || 0)
        ));
    });
    const todayOrders = orders.filter(order => sameLocalDay(order.createdAt, now));
    const outOfStockParts = parts.filter(part => Number(part.stock || 0) <= 0);
    const lowStockParts = parts.filter(part => Number(part.stock || 0) > 0 && Number(part.stock || 0) <= 5);

    const orderBookFinancials = financialTotals(validOrders);
    const expectedFinancials = financialTotals(confirmedOrders);
    const completedFinancials = financialTotals(completedOrders);

    const ordersByStatus = {
        [STATUS_PENDING]: orders.filter(order => order.status === STATUS_PENDING).length,
        [STATUS_PURCHASING]: orders.filter(order => order.status === STATUS_PURCHASING).length,
        [STATUS_PURCHASED]: orders.filter(order => order.status === STATUS_PURCHASED).length,
        [STATUS_CLOSED]: orders.filter(order => order.status === STATUS_CLOSED).length,
    };

    return {
        generatedAt: now.toISOString(),
        kpis: {
            totalOrders: orders.length,
            activeOrders: activeOrders.length,
            recipeCount: recipes.length,
            partCount: parts.length,
            totalCost: expectedFinancials.totalCost,
            totalRevenue: expectedFinancials.totalRevenue,
            totalProfit: expectedFinancials.totalProfit,
            lowStockPartCount: lowStockParts.length,
            outOfStockPartCount: outOfStockParts.length,
            todayOrderCount: todayOrders.length,
        },
        orders: {
            total: orders.length,
            active: activeOrders.length,
            pendingPurchase: ordersByStatus[STATUS_PENDING],
            purchasing: ordersByStatus[STATUS_PURCHASING],
            completed: ordersByStatus[STATUS_CLOSED],
            today: todayOrders.length,
            [STATUS_PENDING]: ordersByStatus[STATUS_PENDING],
            [STATUS_PURCHASING]: ordersByStatus[STATUS_PURCHASING],
            [STATUS_PURCHASED]: ordersByStatus[STATUS_PURCHASED],
            [STATUS_CLOSED]: ordersByStatus[STATUS_CLOSED],
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
            ...expectedFinancials,
            basis: 'confirmed_orders_locked_cost_plus_recorded_procurement_variance',
            orderBook: orderBookFinancials,
            completed: completedFinancials,
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
                    label: '待入库',
                    count: readyToReceiveOrders.length,
                    desc: '已有到货数量等待分批入库',
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
