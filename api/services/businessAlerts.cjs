function loadDbAccessors() {
    return require('../db.cjs');
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function daysBetween(dateText, now = new Date()) {
    const date = new Date(dateText || now);
    if (Number.isNaN(date.getTime())) return 0;
    return Math.floor((now.getTime() - date.getTime()) / 86400000);
}

function issue(severity, scope, entityId, title, detail, action, path, key) {
    return {
        severity,
        scope,
        entityId: entityId == null ? '' : String(entityId),
        title,
        detail,
        action,
        path,
        key: String(key || '').trim(),
    };
}

function customerName(customersById, id) {
    return customersById.get(Number(id)) || `客户 #${id || '-'}`;
}

function getMargin(item) {
    const unitCost = Number(item.unitCost || 0);
    const unitPrice = Number(item.unitPrice || 0);
    if (Number(item.margin || 0) > 0) return Number(item.margin);
    if (unitCost > 0 && unitPrice > 0) return unitPrice / unitCost;
    return 0;
}

function buildQuotationAlerts(quotations, customers, now) {
    const customersById = new Map(customers.map(customer => [Number(customer.id ?? customer.Id), customer.name || '未命名客户']));
    const alerts = [];

    quotations.forEach((quotation) => {
        const id = quotation.id ?? quotation.Id;
        const status = quotation.status || '报价中';
        const items = parseJsonArray(quotation.itemsJson);
        const ageDays = daysBetween(quotation.updatedAt || quotation.createdAt || quotation.CreatedAt, now);
        const name = customerName(customersById, quotation.customerId);

        if (status === '报价中' && ageDays >= 14) {
            alerts.push(issue(
                ageDays >= 30 ? 'high' : 'medium',
                'quotation',
                id,
                `报价 #${id} 已停留 ${ageDays} 天`,
                `${name} 的报价仍处于报价中，可能需要跟进、转为已过时或转订单。`,
                '跟进客户状态，避免有效报价长期悬空。',
                '/quotations',
                'stale'
            ));
        }

        if (items.length === 0 || Number(quotation.totalPrice || 0) <= 0) {
            alerts.push(issue('high', 'quotation', id, `报价 #${id} 金额异常`, `${name} 的报价没有有效明细或总价为 0。`, '检查报价明细和保存成本。', '/quotations', 'amount-invalid'));
        }

        items.forEach((item, index) => {
            const margin = getMargin(item);
            const unitCost = Number(item.unitCost || 0);
            const unitPrice = Number(item.unitPrice || 0);
            if (unitCost <= 0) {
                alerts.push(issue('high', 'quotation', id, `报价 #${id} 明细缺成本`, `${item.baseRecipeName || `第 ${index + 1} 行`} 的单位成本为 0。`, '重新试算或检查配方保存成本。', '/quotations', `item-${index}-missing-cost`));
            } else if (unitPrice < unitCost) {
                alerts.push(issue('high', 'quotation', id, `报价 #${id} 低于成本`, `${item.baseRecipeName || `第 ${index + 1} 行`} 单价 ${roundMoney(unitPrice)} 低于成本 ${roundMoney(unitCost)}。`, '确认是否特殊让利，否则调整报价单价。', '/quotations', `item-${index}-below-cost`));
            } else if (margin > 0 && margin < 1.05) {
                alerts.push(issue('medium', 'quotation', id, `报价 #${id} 利润偏薄`, `${item.baseRecipeName || `第 ${index + 1} 行`} 加价倍数为 ${roundMoney(margin)}。`, '确认客户折扣和最低利润要求。', '/quotations', `item-${index}-thin-margin`));
            }
        });
    });

    return alerts;
}

function buildOrderAlerts(orders, now) {
    const alerts = [];

    orders.forEach((order) => {
        const id = order.id ?? order.Id;
        const status = order.status || '待采购';
        const items = parseJsonArray(order.itemsJson);
        const purchaseList = parseJsonArray(order.purchaseListJson);
        const todos = parseJsonArray(order.todosJson);
        const ageDays = daysBetween(order.updatedAt || order.createdAt || order.CreatedAt, now);
        const titlePrefix = order.contractNo ? `${order.customerName || '未命名客户'} / ${order.contractNo}` : (order.customerName || `订单 #${id}`);

        if (status !== '已关闭' && status !== '已取消' && ageDays >= 14) {
            alerts.push(issue(
                ageDays >= 30 ? 'high' : 'medium',
                'order',
                id,
                `订单 #${id} 已停留 ${ageDays} 天`,
                `${titlePrefix} 仍未完成。`,
                '核对订单确认、采购、到货或入库是否卡住。',
                '/orders',
                'stale'
            ));
        }

        if (items.length === 0) {
            alerts.push(issue('high', 'order', id, `订单 #${id} 无产品明细`, `${titlePrefix} 没有产品明细。`, '检查订单明细或重新由报价转订单。', '/orders', 'empty-items'));
        }

        items.forEach((item, index) => {
            const unitCost = Number(item.unitCost || 0);
            const unitPrice = Number(item.unitPrice || 0);
            if (unitCost <= 0) {
                alerts.push(issue('high', 'order', id, `订单 #${id} 成本为 0`, `${item.recipeName || `第 ${index + 1} 行`} 的锁定成本为 0。`, '检查配方成本快照，避免利润统计失真。', '/orders', `item-${index}-missing-cost`));
            } else if (unitPrice < unitCost) {
                alerts.push(issue('high', 'order', id, `订单 #${id} 低于成本`, `${item.recipeName || `第 ${index + 1} 行`} 单价 ${roundMoney(unitPrice)} 低于成本 ${roundMoney(unitCost)}。`, '确认合同是否允许亏损交付。', '/orders', `item-${index}-below-cost`));
            }
        });

        const blockedPurchases = purchaseList.filter(item => {
            const plannedQty = Number(item.plannedQty ?? item.needToBuy ?? 0);
            const orderedQty = Number(item.orderedQty ?? (item.purchased ? plannedQty : 0));
            return plannedQty > orderedQty;
        });
        if (status !== '已关闭' && status !== '已取消' && blockedPurchases.length > 0) {
            const top = blockedPurchases.slice(0, 3).map(item => {
                const plannedQty = Number(item.plannedQty ?? item.needToBuy ?? 0);
                const orderedQty = Number(item.orderedQty ?? (item.purchased ? plannedQty : 0));
                return `${item.model || item.name} x${plannedQty - orderedQty}`;
            }).join('、');
            alerts.push(issue('medium', 'order', id, `订单 #${id} 有 ${blockedPurchases.length} 项待采购`, top || '存在未完成采购项。', '进入采购中心处理待采购物料。', '/purchase', 'purchase-pending'));
        }

        const openTodos = todos.filter(item => !item.done);
        if (status === '采购完成' && openTodos.length === 0) {
            alerts.push(issue('low', 'order', id, `订单 #${id} 可关闭`, `${titlePrefix} 的采购物料已全部入库。`, '确认业务事项无误后关闭订单。', '/orders', 'closable'));
        }
    });

    return alerts;
}

function buildBusinessAlerts(options = {}) {
    let db = options.dbAccessors || null;
    const getDb = () => {
        if (!db) db = loadDbAccessors();
        return db;
    };
    const now = options.now || new Date();
    const quotations = Object.prototype.hasOwnProperty.call(options, 'quotations') ? options.quotations : getDb().dbGetAllQuotations();
    const customers = Object.prototype.hasOwnProperty.call(options, 'customers') ? options.customers : getDb().dbGetAllCustomers();
    const orders = Object.prototype.hasOwnProperty.call(options, 'orders') ? options.orders : getDb().dbGetAllOrders();
    const alerts = [
        ...buildQuotationAlerts(quotations || [], customers || [], now),
        ...buildOrderAlerts(orders || [], now),
    ];
    const severityRank = { high: 3, medium: 2, low: 1 };
    alerts.sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || a.scope.localeCompare(b.scope));

    return {
        generatedAt: now.toISOString(),
        totals: {
            high: alerts.filter(item => item.severity === 'high').length,
            medium: alerts.filter(item => item.severity === 'medium').length,
            low: alerts.filter(item => item.severity === 'low').length,
            all: alerts.length,
        },
        alerts,
        topAlerts: alerts.slice(0, 8),
    };
}

module.exports = { buildBusinessAlerts };
