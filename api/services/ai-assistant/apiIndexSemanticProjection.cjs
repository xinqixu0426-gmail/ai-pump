'use strict';

// Model-discovery projection only.  This is deliberately not a router, a
// second capability registry, or a place for business calculations.  It adds
// the fact boundary that the existing capability registry and formal API
// contracts already establish, so that a navigation domain is not mistaken
// for a fact authority.

const TOOL_BOUNDARIES = Object.freeze({
    search_business_changes: ['committed business-change history', ['business_change_event'], ['business_history'], ['current order/readiness state'], 'aggregate'],
    search_parts: ['catalog part discovery', ['part_identity', 'part_catalog_attribute'], ['catalog'], ['recipe cost', 'purchase status'], 'direct'],
    get_coil_specs: ['coil specification options', ['coil_identity', 'coil_specification'], ['coil'], ['full recipe cost', 'current inventory sufficiency'], 'direct'],
    search_coils: ['coil catalog discovery', ['coil_identity', 'coil_directory_cost'], ['coil', 'cost'], ['full recipe cost', 'purchase status'], 'aggregate'],
    calculate_coil_cost: ['formal coil cost preview', ['current_cost'], ['coil', 'cost'], ['full recipe cost', 'purchase status', 'inventory balance'], 'direct'],
    get_copper_price: ['current copper-price reference', ['copper_price'], ['coil', 'cost'], ['full recipe cost', 'purchase status'], 'direct'],
    get_factory_knowledge_detail: ['confirmed knowledge-record detail', ['knowledge_record'], ['knowledge'], ['current formal business state unless separately confirmed'], 'direct'],
    search_factory_knowledge: ['auxiliary knowledge retrieval', ['auxiliary_knowledge_retrieval'], ['knowledge', 'coil', 'catalog'], ['current inventory', 'current cost', 'current order or procurement status'], 'aggregate'],
    get_order_knowledge_package: ['order detail, confirmed knowledge, readiness, and linked source files', ['order_status', 'order_snapshot_recipe', 'order_line_quantity', 'readiness_status', 'shortage_quantity', 'purchase_status', 'source_file'], ['order', 'knowledge', 'file', 'procurement'], ['global purchase overview outside the returned order scope', 'unlinked file content'], 'aggregate', { source_file: 'factory_file_links', purchase_status: 'currentPurchasePlan', readiness_status: 'activeOrderReadiness' }],
    check_order_readiness: ['current order readiness and shortage/procurement state', ['readiness_status', 'shortage_line_count', 'required_quantity', 'available_quantity', 'shortage_quantity', 'purchase_status', 'purchase_quantity'], ['order', 'procurement', 'inventory'], ['global purchase collection', 'unrelated order detail'], 'aggregate', { readiness_status: 'activeOrderReadiness', shortage_line_count: 'activeOrderReadiness', required_quantity: 'activeOrderReadiness', available_quantity: 'parts+coils inventory', shortage_quantity: 'activeOrderReadiness+parts+coils inventory', purchase_status: 'currentPurchasePlan', purchase_quantity: 'currentPurchasePlan' }],
    get_order_detail: ['current formal order detail', ['order_status', 'order_customer_attribute', 'order_contract_number', 'order_snapshot_recipe', 'order_line_quantity'], ['order'], ['current readiness or procurement state unless separately returned'], 'direct'],
    get_recent_orders: ['recent formal order collection', ['order_status', 'order_collection'], ['order', 'procurement'], ['customer-complete history', 'current order readiness'], 'aggregate'],
    get_purchase_overview: ['formal purchase-task overview', ['purchase_status', 'purchase_quantity', 'purchase_quantity_ordered', 'purchase_quantity_received', 'purchase_quantity_stocked', 'purchase_pending_quantity', 'collection_completeness'], ['procurement', 'order'], ['order-specific shortage unless scope is formally bound', 'recipe cost'], 'aggregate', { purchase_status: 'currentPurchasePlan', purchase_quantity: 'currentPurchasePlan', purchase_quantity_ordered: 'currentPurchasePlan', purchase_quantity_received: 'currentPurchasePlan', purchase_quantity_stocked: 'currentPurchasePlan', purchase_pending_quantity: 'currentPurchasePlan', collection_completeness: 'purchasing.overview' }],
    get_quotation_detail: ['formal quotation detail', ['quotation_status', 'quotation_amount', 'quotation_customer'], ['quotation', 'customer'], ['customer-complete order history', 'current production readiness'], 'direct'],
    search_customer_history: ['formal customer quotation and order history', ['customer_identity', 'quotation_history', 'order_history', 'collection_completeness'], ['quotation', 'order', 'business_history', 'customer'], ['current order readiness', 'unbound customer history'], 'aggregate', { customer_identity: 'customers', quotation_history: 'quotations', order_history: 'orders', collection_completeness: 'customers+quotations+orders' }],
    search_customers: ['formal customer discovery', ['customer_identity', 'customer_collection'], ['quotation', 'customer'], ['customer quotation/order history without a history query'], 'aggregate'],
    search_quotations: ['formal quotation collection', ['quotation_status', 'quotation_collection'], ['quotation', 'customer'], ['customer-complete order history', 'current cost'], 'aggregate'],
    explain_cost_change: ['formal recipe cost difference', ['recipe_cost_difference'], ['cost', 'recipe', 'quotation'], ['current inventory', 'purchase status'], 'direct'],
    get_all_recipes: ['formal recipe collection', ['recipe_identity', 'recipe_collection'], ['recipe', 'catalog'], ['current cost or current inventory without a dedicated returned fact'], 'aggregate'],
    get_recipe_detail: ['formal recipe detail with optional complete current cost', ['recipe_identity', 'recipe_bom', 'current_cost'], ['recipe', 'cost', 'catalog'], ['current inventory status unless separately returned'], 'direct', { recipe_identity: 'recipeService', recipe_bom: 'recipeService', current_cost: 'costEngine' }],
    get_recipe_parts: ['formal recipe-to-material relations', ['recipe_bom', 'part_identity', 'coil_identity'], ['recipe', 'catalog', 'coil'], ['current inventory sufficiency', 'current cost'], 'aggregate'],
    get_recipe_technical_files: ['formal recipe technical-file links', ['recipe_identity', 'source_file'], ['recipe', 'file'], ['current cost', 'inventory sufficiency'], 'aggregate'],
    get_recipe_technical_profile: ['formal recipe technical profile', ['recipe_technical_profile'], ['recipe', 'catalog'], ['current cost', 'inventory sufficiency'], 'direct'],
    get_recipes_by_coil: ['formal recipes related to one coil', ['recipe_collection', 'coil_identity'], ['recipe', 'coil'], ['current cost', 'inventory sufficiency'], 'aggregate'],
    get_recipes_by_part: ['formal recipes related to one part', ['recipe_collection', 'part_identity'], ['recipe', 'catalog'], ['current cost', 'inventory sufficiency'], 'aggregate'],
    get_template_detail: ['formal pump-shell template detail', ['template_detail'], ['recipe', 'catalog'], ['current recipe cost', 'inventory sufficiency'], 'direct'],
    search_templates: ['formal pump-shell template discovery', ['template_collection'], ['recipe', 'catalog'], ['current recipe cost', 'inventory sufficiency'], 'aggregate'],
    compare_recipe_scenarios: ['formal scenario cost comparison', ['scenario_cost', 'scenario_cost_difference'], ['recipe', 'cost'], ['current inventory sufficiency', 'purchase status'], 'aggregate'],
    compare_recipes: ['formal recipe cost difference', ['recipe_cost_difference'], ['recipe', 'cost'], ['current inventory sufficiency', 'purchase status'], 'direct'],
    preview_profitability: ['formal profitability preview', ['current_cost', 'gross_profit_per_unit', 'gross_margin_on_sales'], ['recipe', 'cost', 'quotation'], ['current inventory sufficiency', 'purchase status'], 'direct'],
    preview_virtual_readiness: ['formal quantity-scoped virtual readiness preview', ['readiness_status', 'required_quantity', 'available_quantity', 'shortage_quantity', 'collection_completeness'], ['recipe', 'inventory'], ['current order readiness', 'inventory sufficiency without an explicit formal scenario quantity'], 'aggregate', { readiness_status: 'orderPlanning+activeOrderReadiness+parts+coils inventory', required_quantity: 'current_recipe_scenario_bom', available_quantity: 'parts+coils inventory', shortage_quantity: 'orderPlanning+parts+coils inventory', collection_completeness: 'inventory.virtual_readiness_preview' }],
});

function freezeStrings(value) {
    return Object.freeze([...new Set(value || [])].sort());
}

function semanticBoundaryFor({ toolName, domains, sourceOfTruth, formalSources }) {
    const boundary = TOOL_BOUNDARIES[toolName];
    if (!boundary) throw new Error(`Missing model semantic boundary for indexed tool: ${toolName}`);
    const [primaryBusinessResponsibility, formalFactsProduced, overlappingBusinessDomains, factsItDoesNotEstablish, aggregateOrDirect, factAuthorityOverrides = {}] = boundary;
    const factAuthorities = Object.fromEntries(formalFactsProduced.map(fact => [fact, factAuthorityOverrides[fact] || sourceOfTruth]));
    return Object.freeze({
        primaryBusinessResponsibility,
        formalFactsProduced: freezeStrings(formalFactsProduced),
        factAuthorities: Object.freeze(factAuthorities),
        // The AI capability's sourceOfTruth stays authoritative.  Formal
        // capability sources remain visible as provenance when the capability
        // is an aggregate or delegates a calculation to another authority.
        sourceOfTruth,
        formalAuthorities: freezeStrings(formalSources.length ? formalSources : [sourceOfTruth]),
        overlappingBusinessDomains: freezeStrings([...domains, ...overlappingBusinessDomains]),
        factsItDoesNotEstablish: freezeStrings(factsItDoesNotEstablish),
        aggregateOrDirect,
    });
}

module.exports = { TOOL_BOUNDARIES, semanticBoundaryFor };
