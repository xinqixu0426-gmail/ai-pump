'use strict';
const { ontology } = require('./contract.cjs');
const { deepFreeze } = require('./sources.cjs');
const entityMetadata = {
    // `resources` is the binding contract's provenance whitelist: a canonical root may only be
    // established by one of these formal reads, and the read's execution evidence must name its path.
    // ONT-P8L-FINAL Gate B adds the bounded identity read, which is the read the runtime executes
    // BEFORE binding to resolve a relation root name; it is internal-only and is never offered to the
    // model, so declaring it here does not widen the model's tool surface.
    recipe: { aliases: ['配方', '产品'], names: ['name'], resources: [{ tool: 'get_all_recipes', path: 'recipes', field: 'data' }, { tool: 'get_recipe_detail', path: 'recipes', field: 'recipe' }, { tool: 'resolve_recipe_identity', path: 'recipes/identity', field: 'data', alternatePaths: [{ path: 'entity-lookup', method: 'POST' }] }] },
    template: { aliases: ['泵壳模板', '模板'], names: ['shellModel'], resources: [{ tool: 'search_templates', path: 'templates', field: 'data' }, { tool: 'get_template_detail', path: 'templates', field: 'template' }] },
    coil: { aliases: ['线圈', '绕组'], names: ['schemeCode', 'schemeName'], composite: ['spec', 'sheets'], resources: [{ tool: 'search_coils', path: 'coils', field: 'data' }] },
    part: { aliases: ['零件', '配件'], names: ['model', 'name'], resources: [{ tool: 'search_parts', path: 'parts', field: 'parts' }, { tool: 'resolve_part_identity', path: 'entity-lookup', field: 'data', method: 'POST' }] },
    order: { aliases: ['订单', '合同'], names: ['contractNo'], resources: [{ tool: 'get_recent_orders', path: 'orders', field: 'data' }, { tool: 'get_order_detail', path: 'orders', field: 'order' }] },
    customer: { aliases: ['客户'], names: ['name'], resources: [{ tool: 'search_customers', path: 'customers', field: 'data' }, { tool: 'search_customer_history', path: 'customers', field: 'data.customer' }] },
    quotation: { aliases: ['报价单', '报价'], names: [], resources: [{ tool: 'search_quotations', path: 'quotations', field: 'data' }, { tool: 'get_quotation_detail', path: 'quotations', field: 'quotation' }] },
};
// Anchored grammars identify intent, never a business edge. The named root is checked against formal identities.
const expressions = {
    'recipe.uses_template': ['(?<root>.+?)的?(?:使用|用|用了|用的是|采用|配的)(?:哪个|什么|哪套)?(?:泵壳)?模板', '(?<root>.+?)的?(?:泵壳)?模板(?:是哪个|是什么|是哪套)'],
    'template.used_by_recipe': ['(?<root>.+?)(?:被哪些|给哪些)(?:配方|产品)(?:使用|用|用了)', '(?<root>.+?)(?:用在哪些|装在哪些)(?:配方|产品)(?:里)?'],
    'recipe.uses_coil': ['(?<root>.+?)(?:现在|当前)?的?(?:使用的?|用(?:了|的是|的)?|配的)(?:哪个|什么)?(?:线圈|绕组)(?:是哪个|是什么)?', '(?<root>.+?)(?<!用)(?<!使用)的(?:线圈|绕组)(?:是哪个|是什么)'],
    'coil.used_by_recipe': ['(?<root>.+?)(?:被哪些|给哪些)(?:配方|产品)(?:使用|用|用了)', '(?<root>.+?)(?:用在哪些|装在哪些)(?:配方|产品)(?:里)?'],
    'order.belongs_to_customer': ['(?<root>.+?)(?:详情，)?(?:属于哪个|属于什么|是哪个)(?:客户)(?:的)?', '(?<root>.+?)(?:是谁的|是哪家的)(?:订单)?'],
    'customer.has_order': ['(?<root>.+?)(?:有|有哪些|都有哪些)(?:订单|合同)', '(?<root>.+?)的(?:订单|合同)(?:有哪些|都有什么)'],
    'quotation.belongs_to_customer': ['(?<root>.+?)(?:详情，(?:它)?)?(?:属于哪个|属于什么|是哪个)(?:客户)(?:的)?', '(?<root>.+?)(?:是谁的|是哪家的)(?:报价单)?'],
    'customer.has_quotation': ['(?<root>.+?)(?:有|有哪些|都有哪些)(?:报价|报价单)', '(?<root>.+?)的(?:报价|报价单)(?:有哪些|都有什么)'],
    'order.contains_recipe': ['(?<root>.+?)(?:包含哪些|含哪些|有哪些)(?:配方|产品)', '(?<root>.+?)(?:订了哪些|下了哪些)(?:产品|配方)'],
    'recipe.contained_in_order': ['(?<root>.+?)(?:出现在哪些|包含在哪些|在哪些)(?:订单)(?:里)?', '(?<root>.+?)(?:哪些订单订了|被哪些订单订了)'],
    'recipe.contains_part': ['(?<root>.+?)的?(?:包含哪些|含哪些|配件明细|零件明细)(?:正式)?(?:零件|配件)?(?:有哪些)?', '(?<root>.+?)(?:用了哪些|使用哪些|需要哪些|配了哪些)(?:正式)?(?:零件|配件)'],
    'part.contained_in_recipe': ['(?<root>.+?)(?:被哪些|给哪些)(?:配方|产品)(?:使用|用|用了)', '(?<root>.+?)(?:用在哪个|用在哪些|装在哪个|装在哪些)(?:配方|产品)(?:里)?'],
};
const relationMetadata = ontology.relations.map(r => ({ relationId: r.relationId, fromType: r.fromType,
    toType: r.toType, expressions: expressions[r.relationId] }));
if (relationMetadata.some(r => !r.expressions?.length) || Object.keys(expressions).length !== ontology.relations.length) throw Error('BINDING_METADATA_INVALID');
if (Object.keys(entityMetadata).length !== ontology.entities.length || ontology.entities.some(e => !entityMetadata[e.type])) throw Error('BINDING_METADATA_INVALID');
const policy = { prefix: '^(?:帮我|请|查一下|看看|查询|查询一下|查查)?', suffix: '(?:呢|吗)?[？?。!！]*$',
    excluded: '(?:假设|假如|如果|类似|相关|可能|影响|为什么|原理|历史|快照|曾经|原来|创建|新增|删除|修改|更换|绑定|取消|不要|不使用|不属于|没用|未使用|没有使用)',
    pronouns: ['这个', '这个零件', '这个配件', '这个客户', '这个订单', '这个配方', '这个模板', '这个线圈', '这个报价单', '刚才那个配方', '它'],
};
module.exports = deepFreeze({ entityMetadata, relationMetadata, policy });
