const { ACTIVE_ORDERS_SQL } = require('./activeOrderReadiness.cjs');
const { buildBalancedOrderPlans, buildSavedBalancedOrderPlanViews } = require('./orderPlanning.cjs');
const { historicalPurchaseNameView } = require('./historicalPurchaseNames.cjs');

function loadDbAccessors() {
    return require('../db.cjs');
}

function buildCurrentPlans(options, buildPlans) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const database = options.db || accessors.db;
    const records = options.records || database.prepare(ACTIVE_ORDERS_SQL).all();
    const parts = options.parts || accessors.dbGetAllParts();
    const coils = options.coils || accessors.dbGetAllCoils();
    const plans = buildPlans(records, parts, { coilsCatalog: coils });
    return { records, plans };
}

function buildCurrentBalancedPurchasePlans(options = {}) {
    return buildCurrentPlans(options, buildBalancedOrderPlans);
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
    const database = options.db || accessors.db;
    return database.transaction(() => {
        const { plans } = buildCurrentPlans({
            ...options,
            dbAccessors: accessors,
        }, buildSavedBalancedOrderPlanViews);
        return accessors.dbGetAllOrders().map(order => (
            historicalPurchaseNameView(database, applyPurchasePlanView(order, plans.get(Number(order.id))))
        ));
    }).deferred();
}

function getOrderWithCurrentPurchasePlan(id, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const database = options.db || accessors.db;
    return database.transaction(() => {
        const record = database.prepare(
            'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL'
        ).get(id);
        if (!record) return null;
        const { plans } = buildCurrentPlans({
            ...options,
            db: database,
            dbAccessors: accessors,
        }, buildSavedBalancedOrderPlanViews);
        return historicalPurchaseNameView(database, applyPurchasePlanView(
            accessors.orderRow(record),
            plans.get(Number(record.id))
        ));
    }).deferred();
}

module.exports = {
    applyPurchasePlanView,
    buildCurrentBalancedPurchasePlans,
    getOrderWithCurrentPurchasePlan,
    listOrdersWithCurrentPurchasePlans,
};
