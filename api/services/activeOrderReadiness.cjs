const { buildOrderPlan, buildBalancedOrderPlans } = require('./orderPlanning.cjs');
const { buildOrderReadiness } = require('./orderReadiness.cjs');
const { buildOrderReadinessPlan } = require('./orderReadinessPlan.cjs');
const { buildOrderReadinessOverview } = require('./orderReadinessOverview.cjs');
const { parseJsonArray } = require('./validation.cjs');

const ACTIVE_ORDERS_SQL = `
    SELECT * FROM orders
    WHERE deleted_at IS NULL AND status NOT IN ('已关闭', '已取消')
    ORDER BY created_at, id
`;

function loadDbAccessors() {
    return require('../db.cjs');
}

function buildOrderReadinessContext(record, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const database = options.db || accessors.db;
    const records = options.records || database.prepare(ACTIVE_ORDERS_SQL).all();
    const parts = options.parts || accessors.dbGetAllParts();
    const coils = options.coils || accessors.dbGetAllCoils();
    const recipes = options.recipes || accessors.dbGetAllRecipes();
    const plans = options.plans || buildBalancedOrderPlans(records, parts, { coilsCatalog: coils });
    const plan = plans.get(Number(record.id)) || buildOrderPlan(
        parseJsonArray(record.items_json),
        parts,
        { coilsCatalog: coils }
    );
    const readiness = buildOrderReadiness({
        order: accessors.orderRow(record),
        plan,
        recipes,
    });
    return { plan, readiness };
}

function buildActiveOrdersReadinessOverview(options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const database = options.db || accessors.db;
    const records = options.records || database.prepare(ACTIVE_ORDERS_SQL).all();
    const parts = options.parts || accessors.dbGetAllParts();
    const coils = options.coils || accessors.dbGetAllCoils();
    const recipes = options.recipes || accessors.dbGetAllRecipes();
    const plans = buildBalancedOrderPlans(records, parts, { coilsCatalog: coils });
    const entries = records.map(record => {
        const { readiness } = buildOrderReadinessContext(record, {
            dbAccessors: accessors,
            db: database,
            records,
            parts,
            coils,
            recipes,
            plans,
        });
        return {
            readiness,
            actionPlan: buildOrderReadinessPlan(readiness),
        };
    });
    return buildOrderReadinessOverview(entries, { now: options.now });
}

module.exports = {
    ACTIVE_ORDERS_SQL,
    buildActiveOrdersReadinessOverview,
    buildOrderReadinessContext,
};
