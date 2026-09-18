'use strict';
const { deepFreeze } = require('./sources.cjs');
// Explicit business investigations, not permutations of connectable graph edges.
const paths = [
    { pathId: 'part_recipe_order', relationPath: ['part.contained_in_recipe', 'recipe.contained_in_order'], rationale: 'P0 recorded part → recipe → order investigation', expressions: ['(?<root>.+?)用在哪些配方[，,]?(?:这些配方又)?出现在哪些订单(?:里)?', '用着(?<root>.+?)的配方都在哪些订单里'] },
    { pathId: 'coil_recipe_order', relationPath: ['coil.used_by_recipe', 'recipe.contained_in_order'], rationale: 'P0 recorded coil → recipe → order investigation', expressions: ['(?<root>.+?)用在哪些配方[，,]?(?:这些配方又)?出现在哪些订单(?:里)?', '用着(?<root>.+?)的配方都在哪些订单里'] },
    { pathId: 'template_recipe_order', relationPath: ['template.used_by_recipe', 'recipe.contained_in_order'], rationale: 'Current shell-template recipes traced to saved order recipe IDs', expressions: ['(?<root>.+?)用在哪些配方[，,]?(?:这些配方又)?出现在哪些订单(?:里)?', '用着(?<root>.+?)的配方都在哪些订单里'] },
    { pathId: 'customer_order_recipe', relationPath: ['customer.has_order', 'order.contains_recipe'], rationale: 'Customer saved orders and their canonical product recipes', expressions: ['(?<root>.+?)的订单(?:包含|订了)哪些(?:配方|产品)', '(?<root>.+?)都订了哪些产品'] },
    { pathId: 'order_recipe_part', relationPath: ['order.contains_recipe', 'recipe.contains_part'], rationale: 'Saved order recipes investigated against current formal BOM', expressions: ['(?<root>.+?)里的配方(?:使用|用了)哪些(?:零件|配件)', '(?<root>.+?)订的产品都用了哪些配件'] },
    { pathId: 'order_recipe_coil', relationPath: ['order.contains_recipe', 'recipe.uses_coil'], rationale: 'Saved order recipes investigated against current coil configuration', expressions: ['(?<root>.+?)里的配方(?:使用|用了)哪些(?:线圈|绕组)', '(?<root>.+?)订的产品都配了哪些线圈'] },
    { pathId: 'order_recipe_template', relationPath: ['order.contains_recipe', 'recipe.uses_template'], rationale: 'Saved order recipes investigated against current shell templates', expressions: ['(?<root>.+?)里的配方(?:使用|用了)哪些(?:泵壳)?模板', '(?<root>.+?)订的产品都配了哪些泵壳模板'] },
    { pathId: 'quotation_customer_order', relationPath: ['quotation.belongs_to_customer', 'customer.has_order'], rationale: 'Quotation customer identified formally, then their saved orders', expressions: ['(?<root>.+?)所属客户有哪些订单', '(?<root>.+?)是哪家客户的[，,]?这家客户还有哪些订单'] },
];
const TraversalPolicyV1 = deepFreeze({ version: 1, ontologyVersion: 1, paths, permitsLoops: false, permitsDiscovery: false });
module.exports = { TraversalPolicyV1 };
