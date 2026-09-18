'use strict';
const Database = require('better-sqlite3');
function fixture(filename = ':memory:') {
    const db = new Database(filename);
    require('../../api/database/migrations.cjs').runMigrations(db);
    db.exec(`
        INSERT INTO customers(id,name) VALUES(1,'Shadow客户甲'),(2,'Shadow空客户');
        INSERT INTO pump_shell_templates(id,shell_model) VALUES(401,'Shadow模板甲'),(402,'Shadow空模板');
        INSERT INTO coils(id,scheme_name,scheme_code,spec,material,sheets) VALUES
            (501,'Shadow线圈甲','SHADOW-501','12','冷轧',120),(502,'Shadow空线圈','SHADOW-502','13','冷轧',120);
        INSERT INTO parts(id,model,supplier) VALUES(601,'Shadow零件甲','供应甲'),(602,'Shadow空零件','供应乙');
        INSERT INTO recipes(id,name,template_id,coil_id,parts_json) VALUES
            (301,'Shadow配方甲',401,501,'[{"partId":601,"model":"Shadow零件甲","supplier":"供应甲"}]'),
            (302,'Shadow空配方',NULL,NULL,'[]'),
            (303,'Shadow旧配方',NULL,NULL,'[{"model":"旧零件"}]'),
            (304,'Shadow歧义配方',NULL,NULL,'[{"model":"重名零件","identityStatus":"ambiguous"}]');
        INSERT INTO orders(id,contract_no,customer_id,customer_name,items_json) VALUES
            (101,'SHADOW-101',1,'Shadow客户甲','[{"recipeId":301,"recipeName":"Shadow配方甲","qty":1,"unitPrice":3}]'),
            (102,'SHADOW-102',1,'Shadow客户甲','[]');
        INSERT INTO quotations(id,customer_id,status) VALUES(701,1,'报价中');
    `);
    return db;
}
const canonicalRoots = { customer: 1, order: 101, recipe: 301, part: 601, coil: 501, template: 401, quotation: 701 };
const formal = (path, data) => ({ success: true, ...data,
    executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path }] } });
const recipeDetail = (id = 301, parts = [{ partId: 601, model: 'Shadow零件甲', supplier: '供应甲' }]) => ({
    name: 'get_recipe_detail', args: { recipeName: 'Shadow配方甲' },
    result: formal(`/api/recipes/${id}`, { recipe: { id, name: 'Shadow配方甲', parts } }) });
const realCorpus = [
    ['recipe-part', 'Shadow配方甲的配件明细有哪些？'],
    ['recipe-empty', 'Shadow空配方的配件明细有哪些？'],
    ['recipe-legacy', 'Shadow旧配方的配件明细有哪些？'],
    ['recipe-ambiguous', 'Shadow歧义配方的配件明细有哪些？'],
    ['recipe-missing', 'Shadow不存在配方的配件明细有哪些？'],
    ['coil-recipe', '12-120线圈被哪些配方使用？'],
    ['coil-empty', '13-120线圈被哪些配方使用？'],
    ['coil-missing', '99-999线圈被哪些配方使用？'],
    ['order-customer', '查询订单SHADOW-101详情，属于哪个客户？'],
    ['order-recipe', '订单SHADOW-101包含哪些配方？'],
    ['customer-order', 'Shadow客户甲有哪些订单？'],
    ['customer-quotation', 'Shadow客户甲有哪些报价？'],
    ['quotation-customer', '查询报价ID 701详情，它属于哪个客户？'],
    ['recipe-template', 'Shadow配方甲使用哪个泵壳模板？'],
    ['template-recipe', 'Shadow模板甲被哪些配方使用？'],
];
function deterministicCorpus() {
    const coil = (id = 501) => ({ name: 'search_coils', result: formal('/api/coils?spec=12&sheets=120', { data: [{ id }] }) });
    const recipes = { name: 'get_all_recipes', result: formal('/api/recipes', { data: [
        { id: 301, coilId: 501 }, { id: 302, coilId: null }, { id: 303, coilId: null }, { id: 304, coilId: null },
    ], count: 4, filters: { keyword: '', hasTechnicalFiles: null } }) };
    const order = (customerId = 1) => ({ name: 'get_order_detail', result: formal('/api/orders/101', { order: { id: 101, customerId } }) });
    const quote = { name: 'get_quotation_detail', result: formal('/api/quotations/701', { quotation: { id: 701, customerId: 1 } }) };
    const stale = recipeDetail(); stale.result.recipe.name = '已更名'; stale.result.recipe.parts[0].model = '旧显示名';
    const malformed = recipeDetail(); malformed.result.recipe.partsJson = '{bad';
    const unverified = recipeDetail(); unverified.result.executionEvidence.verified = false;
    const rootMissing = recipeDetail(); rootMissing.result.recipe.id = null; rootMissing.result.executionEvidence.calls[0].path = '/api/recipes/null';
    const filtered = structuredClone(recipes); filtered.result.filters.keyword = 'Shadow'; filtered.result.executionEvidence.calls[0].path += '?keyword=Shadow';
    const multi = coil(); multi.result.data.push({ id: 502 });
    return [
        ['recipe-populated', '', [recipeDetail()], 'MATCH'],
        ['recipe-empty', '', [recipeDetail(302, [])], 'MATCH'],
        ['recipe-stale-display', '', [stale], 'MATCH'],
        ['recipe-legacy', '', [recipeDetail(303, [{ model: '旧零件' }])], 'CURRENT_PATH_NOT_CANONICAL'],
        ['recipe-ambiguity', '', [recipeDetail(304, [{ model: '重名零件', identityStatus: 'ambiguous' }])], 'CURRENT_PATH_NOT_CANONICAL'],
        ['recipe-missing-root', '', [rootMissing], 'ROOT_IDENTITY_UNAVAILABLE'],
        ['recipe-unverified', '', [unverified], 'NOT_ELIGIBLE'],
        ['recipe-malformed-snapshot', '', [malformed], 'CURRENT_PATH_INCOMPLETE'],
        ['coil-inverse-populated', '线圈被哪些配方使用', [coil(), recipes], 'MATCH'],
        ['coil-inverse-empty', '线圈被哪些配方使用', [coil(502), recipes], 'MATCH'],
        ['coil-inverse-ambiguous', '线圈被哪些配方使用', [multi, recipes], 'NOT_ELIGIBLE'],
        ['coil-filtered-recipes', '线圈被哪些配方使用', [coil(), filtered], 'NOT_ELIGIBLE'],
        ['coil-no-relation-signal', '查询线圈', [coil(), recipes], 'NOT_ELIGIBLE'],
        ['order-customer', '', [order()], 'MATCH'],
        ['order-legacy-customer', '', [order(null)], 'CURRENT_PATH_NOT_CANONICAL'],
        ['quotation-customer', '', [quote], 'MATCH'],
        ['template-inverse-gap', '', [{ name: 'get_template_detail', result: formal('/api/templates/401', { template: { id: 401 } }) }], 'NOT_ELIGIBLE'],
        ['customer-order-gap', '', [{ name: 'search_customer_history', result: formal('/api/customers/1/history', { data: {} }) }], 'NOT_ELIGIBLE'],
        ['order-recipe-gap', '', [{ name: 'get_recent_orders', result: formal('/api/orders', { data: [{ id: 101 }] }) }], 'NOT_ELIGIBLE'],
        ['ontology-root-absent', '', [recipeDetail(999)], 'ONTOLOGY_UNAVAILABLE'],
        ['first-eligible-after-missing-root', '', [rootMissing, quote], 'MATCH'],
    ];
}
module.exports = { fixture, canonicalRoots, formal, recipeDetail, realCorpus, deterministicCorpus };
