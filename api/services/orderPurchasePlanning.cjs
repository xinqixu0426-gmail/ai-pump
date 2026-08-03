const { ACTIVE_ORDERS_SQL } = require('./activeOrderReadiness.cjs');
const { buildBalancedOrderPlans } = require('./orderPlanning.cjs');

function loadDbAccessors() {
    return require('../db.cjs');
}

function buildCurrentBalancedPurchasePlans(options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const database = options.db || accessors.db;
    const records = options.records || database.prepare(ACTIVE_ORDERS_SQL).all();
    const parts = options.parts || accessors.dbGetAllParts();
    const coils = options.coils || accessors.dbGetAllCoils();
    const plans = buildBalancedOrderPlans(records, parts, { coilsCatalog: coils });
    return { records, plans };
}

function applyPurchasePlanView(order, plan) {
    if (!order || !plan) return order;
    return {
        ...order,
        purchaseListJson: JSON.stringify(plan.purchaseList || []),
    };
}

function listOrdersWithCurrentPurchasePlans(options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { plans } = buildCurrentBalancedPurchasePlans({
        ...options,
        dbAccessors: accessors,
    });
    return accessors.dbGetAllOrders().map(order => (
        applyPurchasePlanView(order, plans.get(Number(order.id)))
    ));
}

function getOrderWithCurrentPurchasePlan(id, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const database = options.db || accessors.db;
    const record = database.prepare(
        'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL'
    ).get(id);
    if (!record) return null;
    const { plans } = buildCurrentBalancedPurchasePlans({
        ...options,
        db: database,
        dbAccessors: accessors,
    });
    return applyPurchasePlanView(
        accessors.orderRow(record),
        plans.get(Number(record.id))
    );
}

function persistCurrentBalancedPurchasePlans(options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const database = options.db || accessors.db;
    const { records, plans } = buildCurrentBalancedPurchasePlans({
        ...options,
        db: database,
        dbAccessors: accessors,
    });
    const persist = database.transaction(() => {
        for (const record of records) {
            const plan = plans.get(record.id);
            if (!plan) continue;
            const nextJson = JSON.stringify(plan.purchaseList || []);
            if (nextJson !== String(record.purchase_list_json || '[]')) {
                accessors.safeUpdate('orders', record.id, { purchase_list_json: nextJson });
            }
        }
    });
    persist();
    return plans;
}

module.exports = {
    applyPurchasePlanView,
    buildCurrentBalancedPurchasePlans,
    getOrderWithCurrentPurchasePlan,
    listOrdersWithCurrentPurchasePlans,
    persistCurrentBalancedPurchasePlans,
};
