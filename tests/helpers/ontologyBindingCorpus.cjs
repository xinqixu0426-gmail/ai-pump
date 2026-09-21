'use strict';
const { formal } = require('./ontologyShadowFixture.cjs');
const rows = {
    recipe: { id: 301, name: 'Shadow配方甲', templateId: 401, coilId: 501, partsJson: '[{"partId":601,"model":"Shadow零件甲"}]' },
    template: { id: 401, shellModel: 'Shadow模板甲' }, coil: { id: 501, schemeName: 'Shadow线圈甲', schemeCode: 'SHADOW-501', spec: '12', sheets: 120 },
    part: { id: 601, model: 'Shadow零件甲' }, order: { id: 101, contractNo: 'SHADOW-101', customerId: 1, itemsJson: '[{"recipeId":301}]' },
    customer: { id: 1, name: 'Shadow客户甲' }, quotation: { id: 701, customerId: 1 },
};
const resources = { recipe: ['get_all_recipes', 'recipes', 'data'], template: ['search_templates', 'templates', 'data'],
    coil: ['search_coils', 'coils', 'data'], part: ['search_parts', 'parts', 'parts'],
    order: ['get_recent_orders', 'orders', 'data'], customer: ['search_customers', 'customers', 'data'], quotation: ['search_quotations', 'quotations', 'data'] };
function toolFor(type, supplied = [rows[type]]) {
    const [name, path, field] = resources[type];
    return { name, result: formal(`/api/${path}`, { [field]: supplied, count: supplied.length,
        filters: type === 'recipe' ? { keyword: '', hasTechnicalFiles: null } : { keyword: '' } }) };
}
const positives = [
    ['recipe.uses_template', 'recipe', '配方ID 301使用哪个泵壳模板？', 'Shadow配方甲配的哪套模板？'],
    ['template.used_by_recipe', 'template', '模板ID 401被哪些配方使用？', 'Shadow模板甲用在哪些产品里？'],
    ['recipe.uses_coil', 'recipe', '配方ID 301使用哪个线圈？', 'Shadow配方甲配的什么绕组？'],
    ['coil.used_by_recipe', 'coil', '线圈ID 501被哪些配方使用？', '12-120线圈装在哪些产品里？'],
    ['order.belongs_to_customer', 'order', '订单ID 101属于哪个客户？', 'SHADOW-101是谁的订单？'],
    ['customer.has_order', 'customer', '客户ID 1有哪些订单？', 'Shadow客户甲都有哪些合同？'],
    ['quotation.belongs_to_customer', 'quotation', '报价ID 701属于哪个客户？', '报价单701是哪家的报价单？'],
    ['customer.has_quotation', 'customer', '客户ID 1有哪些报价？', 'Shadow客户甲的报价单都有什么？'],
    ['order.contains_recipe', 'order', '订单ID 101包含哪些配方？', 'SHADOW-101订了哪些产品？'],
    ['recipe.contained_in_order', 'recipe', '配方ID 301出现在哪些订单？', 'Shadow配方甲被哪些订单订了？'],
    ['recipe.contains_part', 'recipe', '配方ID 301使用哪些零件？', 'Shadow配方甲配了哪些配件？'],
    ['part.contained_in_recipe', 'part', '零件ID 601被哪些配方使用？', 'Shadow零件甲装在哪些产品里？'],
];
const negatives = [
    '查询Shadow零件甲', '哪些配方使用？', 'Shadow客户甲和客户乙有哪些订单？',
    'Shadow配方甲使用哪个模板；Shadow配方甲使用哪个线圈？', 'Shadow零件甲适配哪些产品？',
    '如果Shadow零件甲被哪些配方使用？', 'Shadow配方甲不使用哪些零件？', '修改Shadow配方甲使用的线圈',
    '线圈的工作原理是什么？', 'Shadow零件甲相关的配方有哪些？', '与Shadow配方甲类似的产品有哪些？',
    'Shadow零件甲可能影响哪些订单？', '搜索名称Shadow配方甲', 'Shadow配方甲历史上使用哪些零件？',
    'Shadow配方甲保存快照用了哪些配件？', '这个零件用在哪些配方？', '它属于哪个客户？',
    '不存在的配方用了哪些零件？', '客户ID 999有哪些订单？', '供应商甲有哪些配件？',
    '假设客户甲有哪些订单？', '删除客户甲有哪些订单？', 'Shadow配方甲为什么用了这些零件？',
    '帮我找Shadow零件甲的知识', '查询Shadow配方甲的成本',
];
module.exports = { rows, toolFor, positives, negatives };
