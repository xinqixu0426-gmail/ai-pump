'use strict';
const C = require('./relationReadContract.cjs');

// Controlled DB-backed business read layer. SQL is fixed here, never supplied by a caller.
// These plans are adapter implementations, not relation IDs, endpoint/authority definitions.
const ENTITY_SQL = Object.freeze({
    customer: 'SELECT id,name FROM customers WHERE id=? AND deleted_at IS NULL',
    order: 'SELECT id,contract_no AS name,customer_id AS customerId,items_json AS lines FROM orders WHERE id=? AND deleted_at IS NULL',
    recipe: 'SELECT id,name,template_id AS templateId,coil_id AS coilId FROM recipes WHERE id=? AND deleted_at IS NULL',
    part: 'SELECT id,model AS name FROM parts WHERE id=? AND deleted_at IS NULL',
    coil: 'SELECT id,scheme_name AS name FROM coils WHERE id=?',
    template: 'SELECT id,shell_model AS name FROM pump_shell_templates WHERE id=? AND deleted_at IS NULL',
    quotation: 'SELECT id,customer_id AS customerId,status AS name FROM quotations WHERE id=? AND deleted_at IS NULL',
});
const FK_PLANS = Object.freeze({
    recipe_template: { field: 'templateId', count: 'SELECT COUNT(*) n FROM recipes WHERE template_id=? AND deleted_at IS NULL',
        page: 'SELECT id,name FROM recipes WHERE template_id=:id AND deleted_at IS NULL AND (:afterId IS NULL OR id<:afterId) ORDER BY id DESC LIMIT :limit' },
    recipe_coil: { field: 'coilId', count: 'SELECT COUNT(*) n FROM recipes WHERE coil_id=? AND deleted_at IS NULL',
        page: 'SELECT id,name FROM recipes WHERE coil_id=:id AND deleted_at IS NULL AND (:afterId IS NULL OR id<:afterId) ORDER BY id DESC LIMIT :limit' },
    quotation_customer: { field: 'customerId', count: 'SELECT COUNT(*) n FROM quotations WHERE customer_id=? AND deleted_at IS NULL',
        page: 'SELECT id,status AS name FROM quotations WHERE customer_id=:id AND deleted_at IS NULL AND (:afterId IS NULL OR id<:afterId) ORDER BY id DESC LIMIT :limit' },
});

function createCanonicalRelationQueries({ db }) {
    function getEntity(type, id) {
        if (!Object.hasOwn(ENTITY_SQL, type) || !Number.isSafeInteger(id) || id < 1) C.fail('RELATION_SOURCE_INVALID');
        return db.prepare(ENTITY_SQL[type]).get(id);
    }
    function savedRecipeId(line) {
        if (line.recipeId == null) C.fail(line.identityStatus === 'ambiguous' ? 'RELATION_AMBIGUOUS' : 'RELATION_REFERENCE_INCOMPLETE');
        if (!Number.isSafeInteger(line.recipeId) || line.recipeId < 1) C.fail('RELATION_REFERENCE_INCOMPLETE');
        return line.recipeId;
    }
    function orderRecipes(root, inverse, targetType, q) {
        const rows = inverse ? db.prepare('SELECT id,contract_no AS name,items_json AS lines FROM orders WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(C.SCAN_LIMIT + 1) : [root];
        if (rows.length > C.SCAN_LIMIT) C.fail('RELATION_SCAN_BOUND');
        const matched = new Map();
        for (const order of rows) {
            for (const line of C.parsedReferences(order.lines)) {
                const id = savedRecipeId(line);
                if (inverse) { if (id === root.id) matched.set(order.id, order); }
                else {
                    const target = getEntity(targetType, id);
                    if (!target) C.fail('RELATION_REFERENCE_INCOMPLETE');
                    matched.set(id, target);
                }
            }
        }
        const all = [...matched.values()].sort((a, b) => b.id - a.id);
        return { rows: all.filter(r => q.afterId === undefined || r.id < Number(q.afterId)).slice(0, q.pageSize + 1), total: all.length };
    }
    function readSource(relation, root, q) {
        const inverse = relation.direction === 'INVERSE';
        if (relation.sourceId === 'order_recipe') return orderRecipes(root, inverse, relation.toType, q);
        if (!Object.hasOwn(FK_PLANS, relation.sourceId)) C.fail('RELATION_SOURCE_UNAVAILABLE');
        const plan = FK_PLANS[relation.sourceId];
        if (inverse) return {
            rows: db.prepare(plan.page).all({ id: root.id, afterId: q.afterId === undefined ? null : Number(q.afterId), limit: q.pageSize + 1 }),
            total: db.prepare(plan.count).get(root.id).n,
        };
        const id = root[plan.field];
        if (id == null) return { rows: [], total: 0 };
        if (!Number.isSafeInteger(id) || id < 1) C.fail('RELATION_SOURCE_UNAVAILABLE');
        const target = getEntity(relation.toType, id);
        if (!target) C.fail('RELATION_SOURCE_UNAVAILABLE');
        return { rows: [target], total: 1 };
    }
    return { getEntity, readSource };
}

module.exports = { createCanonicalRelationQueries };
