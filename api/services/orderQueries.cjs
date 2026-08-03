const { parsePositiveId } = require('./validation.cjs');

class OrderQueryError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'OrderQueryError';
        this.statusCode = statusCode;
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

    function getAllOrders() {
        return listOrdersWithCurrentPurchasePlans();
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
        getOrderReadiness,
        getReadinessOverview,
        lookupOrders,
    };
}

module.exports = {
    OrderQueryError,
    createOrderQueries,
};
