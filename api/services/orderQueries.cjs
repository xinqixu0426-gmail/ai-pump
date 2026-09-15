const { parsePositiveId } = require('./validation.cjs');
const { ORDER_STATUSES } = require('./orderWorkflow.cjs');
const { purchaseRowIdentity } = require('./purchaseIdentity.cjs');
const {
    normalizeOptionalBoolean,
    normalizeOptionalEnum,
    normalizeOptionalLimit,
    normalizeQueryText,
} = require('./queryValidation.cjs');

class OrderQueryError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'OrderQueryError';
        this.statusCode = statusCode;
    }
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function createOrderQueries({
    db,
    listOrdersWithCurrentPurchasePlans,
    getOrderWithCurrentPurchasePlan,
    buildActiveOrdersReadinessOverview,
    buildOrderReadinessContext,
} = {}) {
    if (!db || typeof db.prepare !== 'function') {
        throw new Error('订单查询服务缺少数据库依赖');
    }
    if (typeof listOrdersWithCurrentPurchasePlans !== 'function') {
        throw new Error('订单查询服务缺少订单列表查询');
    }
    if (typeof getOrderWithCurrentPurchasePlan !== 'function') {
        throw new Error('订单查询服务缺少订单详情查询');
    }
    if (typeof buildActiveOrdersReadinessOverview !== 'function') {
        throw new Error('订单查询服务缺少准备度总览');
    }
    if (typeof buildOrderReadinessContext !== 'function') {
        throw new Error('订单查询服务缺少准备度查询');
    }

    function getAllOrders(options = {}) {
        const status = normalizeOptionalEnum(options.status, '订单状态', ORDER_STATUSES);
        const customerName = normalizeQueryText(options.customerName, 'customerName').toLocaleLowerCase();
        const contractNo = normalizeQueryText(options.contractNo, 'contractNo').toLocaleLowerCase();
        const limit = normalizeOptionalLimit(options.limit);
        const source = listOrdersWithCurrentPurchasePlans();
        if (!status && !customerName && !contractNo && !limit) return source;
        const orders = source
            .filter(order => (
                (!status || String(order.status || '').trim().toLocaleLowerCase() === status)
                && (!customerName || String(order.customerName || '').toLocaleLowerCase().includes(customerName))
                && (!contractNo || String(order.contractNo || '').toLocaleLowerCase().includes(contractNo))
            ))
            .sort((left, right) => Number(right.id || 0) - Number(left.id || 0));
        return limit ? orders.slice(0, limit) : orders;
    }

    function getPurchaseOverview(options = {}) {
        const activeStatuses = new Set(['待采购', '采购中', '采购完成']);
        const activeOrders = getAllOrders().filter(order => activeStatuses.has(order.status));
        const tasksByKey = new Map();

        for (const order of activeOrders) {
            const purchaseList = parseJsonArray(order.purchaseList ?? order.purchaseListJson);
            for (const item of purchaseList) {
                const plannedQty = Number(item.plannedQty ?? item.needToBuy ?? 0) || 0;
                if (plannedQty <= 0) continue;
                const orderedQty = Number(item.orderedQty ?? (item.purchased ? plannedQty : 0)) || 0;
                const receivedQty = Number(item.receivedQty || 0);
                const stockedQty = Number(item.stockedQty || 0);
                const supplier = String(item.supplier || '').trim();
                const model = String(item.model || item.name || '').trim();
                const key = purchaseRowIdentity(item);
                const current = tasksByKey.get(key) || {
                    identityKey: key,
                    supplier,
                    supplierLabel: supplier || '未指定供应商',
                    model,
                    name: item.name || model,
                    purchaseUnit: item.purchaseUnit || '',
                    specification: item.specification || '',
                    plannedQty: 0,
                    orderedQty: 0,
                    receivedQty: 0,
                    stockedQty: 0,
                    pendingQty: 0,
                    orderIds: [],
                };
                current.plannedQty += plannedQty;
                current.orderedQty += orderedQty;
                current.receivedQty += receivedQty;
                current.stockedQty += stockedQty;
                current.pendingQty += Math.max(0, plannedQty - orderedQty);
                if (!current.orderIds.includes(order.id)) current.orderIds.push(order.id);
                tasksByKey.set(key, current);
            }
        }

        const supplier = normalizeQueryText(options.supplier, 'supplier').toLocaleLowerCase();
        const pendingOnly = normalizeOptionalBoolean(options.pendingOnly, 'pendingOnly') ?? false;
        const allTasks = [...tasksByKey.values()]
            .map(task => ({ ...task, orderCount: task.orderIds.length }))
            .filter(task => (
                (!supplier || task.supplierLabel.toLocaleLowerCase().includes(supplier))
                && (!pendingOnly || task.pendingQty > 0)
            ))
            .sort((left, right) => (
                Number(right.pendingQty > 0) - Number(left.pendingQty > 0)
                || right.pendingQty - left.pendingQty
                || left.supplierLabel.localeCompare(right.supplierLabel, 'zh-CN')
                || left.model.localeCompare(right.model, 'zh-CN')
            ));
        const requestedLimit = normalizeOptionalLimit(options.limit);
        const limit = requestedLimit ?? allTasks.length;
        const tasks = allTasks.slice(0, limit);
        const sum = field => allTasks.reduce((total, task) => total + task[field], 0);
        return {
            summary: {
                activeOrderCount: new Set(allTasks.flatMap(task => task.orderIds)).size,
                supplierCount: new Set(allTasks.map(task => task.supplierLabel)).size,
                taskCount: allTasks.length,
                pendingTaskCount: allTasks.filter(task => task.pendingQty > 0).length,
                plannedQty: sum('plannedQty'),
                orderedQty: sum('orderedQty'),
                receivedQty: sum('receivedQty'),
                stockedQty: sum('stockedQty'),
                pendingQty: sum('pendingQty'),
            },
            returnedCount: tasks.length,
            truncated: tasks.length < allTasks.length,
            filters: {
                supplier: String(options.supplier || '').trim(),
                pendingOnly,
                limit: limit === allTasks.length ? null : limit,
            },
            tasks,
        };
    }

    function getLatestRecipePrice(recipeName) {
        const orders = db.prepare(`
            SELECT items_json, customer_name, updated_at
            FROM orders
            WHERE deleted_at IS NULL
            ORDER BY updated_at DESC
        `).all();
        for (const row of orders) {
            let items;
            try {
                items = JSON.parse(row.items_json || '[]');
            } catch {
                continue;
            }
            if (!Array.isArray(items)) continue;
            for (const item of items) {
                if (item?.recipeName === recipeName && item.unitPrice > 0) {
                    return {
                        unitPrice: item.unitPrice,
                        unitCost: item.unitCost || 0,
                        profitMargin: item.profitMargin || 1.10,
                        customerName: row.customer_name,
                        date: row.updated_at,
                    };
                }
            }
        }
        return null;
    }

    function lookupOrders(rawQuery) {
        const query = String(rawQuery || '').trim();
        if (!query) {
            throw new OrderQueryError('请提供订单ID、客户名称或合同号');
        }
        const normalized = query.toLowerCase();
        const candidates = db.prepare(`
            SELECT id, customer_name, contract_no, status, updated_at
            FROM orders
            WHERE deleted_at IS NULL
            ORDER BY updated_at DESC, id DESC
        `).all().map(row => ({
            id: row.id,
            customerName: row.customer_name,
            contractNo: row.contract_no || '',
            status: row.status,
            updatedAt: row.updated_at,
        }));
        const exact = candidates.filter(order => (
            String(order.id) === query
            || order.contractNo.trim().toLowerCase() === normalized
            || String(order.customerName || '').trim().toLowerCase() === normalized
        ));
        const matches = exact.length > 0 ? exact : candidates.filter(order => (
            order.contractNo.toLowerCase().includes(normalized)
            || String(order.customerName || '').toLowerCase().includes(normalized)
        ));
        return matches.slice(0, 20);
    }

    function getReadinessOverview() {
        return buildActiveOrdersReadinessOverview();
    }

    function getOrderReadiness(rawOrderId) {
        const orderId = parsePositiveId(rawOrderId);
        if (!orderId) {
            throw new OrderQueryError('非法订单ID');
        }
        const record = db.prepare(`
            SELECT *
            FROM orders
            WHERE id = ? AND deleted_at IS NULL
        `).get(orderId);
        if (!record) {
            throw new OrderQueryError('订单不存在', 404);
        }
        return buildOrderReadinessContext(record).readiness;
    }

    function getOrder(rawOrderId) {
        const orderId = parsePositiveId(rawOrderId);
        if (!orderId) {
            throw new OrderQueryError('非法订单ID');
        }
        const order = getOrderWithCurrentPurchasePlan(orderId);
        if (!order) {
            throw new OrderQueryError('订单不存在', 404);
        }
        return order;
    }

    return {
        getAllOrders,
        getLatestRecipePrice,
        getOrder,
        getPurchaseOverview,
        getOrderReadiness,
        getReadinessOverview,
        lookupOrders,
    };
}

module.exports = {
    OrderQueryError,
    createOrderQueries,
};
