'use strict';
const { fixture: p3Fixture, formal } = require('./ontologyShadowFixture.cjs');
const { TraversalPolicyV1 } = require('../../api/ontology/traversalPolicy.cjs');
const { ontology } = require('../../api/ontology/contract.cjs');
function fixture(filename = ':memory:') {
    const db = p3Fixture(filename);
    // A separate clean composition fixture; frozen P3 fixtures/corpus stay unchanged.
    db.exec(`DELETE FROM recipes WHERE id IN (303,304);
        INSERT INTO recipes(id,name,template_id,coil_id,parts_json) VALUES
        (305,'Shadow配方乙',401,501,'[{"partId":601,"model":"Shadow零件甲","supplier":"供应甲"}]');
        INSERT INTO orders(id,contract_no,customer_id,customer_name,items_json) VALUES
        (103,'SHADOW-103',1,'Shadow客户甲','[{"recipeId":301},{"recipeId":305}]'),
        (104,'SHADOW-104',2,'Shadow空客户','[{"recipeId":305}]');`);
    return db;
}
const cases = [
    ['part_recipe_order', 'part', '601', ['101', '103', '104'], '零件ID 601用在哪些配方，这些配方又出现在哪些订单里？', '用着Shadow零件甲的配方都在哪些订单里？'],
    ['coil_recipe_order', 'coil', '501', ['101', '103', '104'], '线圈ID 501用在哪些配方，这些配方又出现在哪些订单里？', '用着12-120线圈的配方都在哪些订单里？'],
    ['template_recipe_order', 'template', '401', ['101', '103', '104'], '模板ID 401用在哪些配方，这些配方又出现在哪些订单里？', '用着Shadow模板甲的配方都在哪些订单里？'],
    ['customer_order_recipe', 'customer', '1', ['301', '305'], '客户ID 1的订单包含哪些配方？', 'Shadow客户甲都订了哪些产品？'],
    ['order_recipe_part', 'order', '103', ['601'], '订单ID 103里的配方使用哪些零件？', 'SHADOW-103订的产品都用了哪些配件？'],
    ['order_recipe_coil', 'order', '103', ['501'], '订单ID 103里的配方使用哪些线圈？', 'SHADOW-103订的产品都配了哪些线圈？'],
    ['order_recipe_template', 'order', '103', ['401'], '订单ID 103里的配方使用哪些泵壳模板？', 'SHADOW-103订的产品都配了哪些泵壳模板？'],
    ['quotation_customer_order', 'quotation', '701', ['101', '102', '103'], '报价ID 701所属客户有哪些订单？', '报价单701是哪家客户的，这家客户还有哪些订单？'],
];
const positives = cases.flatMap(([pathId, entityType, canonicalId, expected, ...questions]) => questions.map((question, i) => ({
    caseId: `${pathId}-${i + 1}`, pathId, root: { entityType, canonicalId }, expected, question,
    relationPath: TraversalPolicyV1.paths.find(p => p.pathId === pathId).relationPath,
})));
const negatives = [
    '查询Shadow零件甲', '哪些配方出现在哪些订单里？', '如果Shadow客户甲都订了哪些产品？',
    'Shadow客户甲可能影响哪些订单？', '删除SHADOW-103订的产品都用了哪些配件', '客户订单配方的工作原理是什么？',
    'Shadow客户甲历史上都订了哪些产品？', '与Shadow配方甲类似的订单有哪些？',
    '供应商甲供的零件用在哪些配方又在哪些订单里？', 'Shadow零件甲用在哪些配方？',
    '客户ID 999的订单包含哪些配方？', '用着不存在的零件的配方都在哪些订单里？',
    'Shadow客户甲的报价包含哪些配方？', '客户ID 1有哪些订单，订单又属于哪个客户？',
    '用着Shadow零件甲的配方都在哪些订单里；SHADOW-103订的产品都用了哪些配件？',
    '订单ID 103里的配方使用哪些零件；订单ID 104里的配方使用哪些零件？',
    '这个零件用在哪些配方，这些配方又出现在哪些订单里？', '它都订了哪些产品？',
    'Shadow客户甲和客户乙都订了哪些产品？', 'Shadow配方甲保存快照用的零件在哪些订单里？',
];
function verifiedTools() {
    return [
        ['search_parts', '/api/parts', { parts: [{ id: 601, model: 'Shadow零件甲' }], count: 1, filters: { keyword: '' } }],
        ['search_coils', '/api/coils', { data: [{ id: 501, spec: '12', sheets: 120 }], count: 1, filters: { keyword: '' } }],
        ['search_templates', '/api/templates', { data: [{ id: 401, shellModel: 'Shadow模板甲' }], count: 1, filters: { keyword: '' } }],
        ['search_customers', '/api/customers', { data: [{ id: 1, name: 'Shadow客户甲' }], count: 1, filters: { keyword: '' } }],
        ['search_quotations', '/api/quotations', { data: [{ id: 701, customerId: 1 }], count: 1, filters: { keyword: '' } }],
        ['get_all_recipes', '/api/recipes', { data: [
            { id: 301, name: 'Shadow配方甲', templateId: 401, coilId: 501, partsJson: '[{"partId":601}]' },
            { id: 302, name: 'Shadow空配方', templateId: null, coilId: null, partsJson: '[]' },
            { id: 305, name: 'Shadow配方乙', templateId: 401, coilId: 501, partsJson: '[{"partId":601}]' },
        ], count: 3, filters: { keyword: '', hasTechnicalFiles: null } }],
        ['get_recent_orders', '/api/orders', { data: [
            { id: 101, contractNo: 'SHADOW-101', customerId: 1, itemsJson: '[{"recipeId":301}]' },
            { id: 102, contractNo: 'SHADOW-102', customerId: 1, itemsJson: '[]' },
            { id: 103, contractNo: 'SHADOW-103', customerId: 1, itemsJson: '[{"recipeId":301},{"recipeId":305}]' },
            { id: 104, contractNo: 'SHADOW-104', customerId: 2, itemsJson: '[{"recipeId":305}]' },
        ], count: 4, filters: { keyword: '' } }],
    ].map(([name, path, result]) => ({ name, result: formal(path, result) }));
}
const realCorpus = [...positives, ...[
    ['pronoun', '这个客户都订了哪些产品？', 'customer_order_recipe'],
    ['missing', '客户ID 999的订单包含哪些配方？'],
    ['negative', '如果Shadow客户甲都订了哪些产品？'],
    ['unsupported', 'Shadow客户甲的报价包含哪些配方？'],
    ['ambiguous', '用着Shadow零件甲的配方都在哪些订单里；SHADOW-103订的产品都用了哪些配件？'],
].map(([caseId, question, pathId]) => ({ caseId, question, pathId, ...(pathId ? { root: { entityType: 'customer', canonicalId: '1' }, expected: ['301', '305'] } : {}) }))];
module.exports = { name: 'P5_RECONSTRUCTED_2HOP_CORPUS', fixture, positives, negatives, verifiedTools, realCorpus,
    families: [...new Set(TraversalPolicyV1.paths.flatMap(p => p.relationPath.map(id => ontology.relations.find(r => r.relationId === id).sourceId)))] };
