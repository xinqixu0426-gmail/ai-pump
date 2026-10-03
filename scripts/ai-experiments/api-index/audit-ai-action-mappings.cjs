#!/usr/bin/env node
// Reviewed Phase A2 mapping proposals; this script never mutates runtime registries.
const fs = require('node:fs');
const path = require('node:path');
const { getAiCapability, getBusinessCapability, listAiCapabilities, listBusinessCapabilities } = require('../../../api/capabilities/registry.cjs');
const prior = require('../../../planning/ai-native-api/M5-A-API-Foundation-Contract-Matrix.json');
const root = path.resolve(__dirname, '../../..');
const A = 'DIRECT_FORMAL_MAPPING', B = 'COMPOSITE_EXISTING_FORMAL', C = 'FORMAL_READ_CAPABILITY_GAP', D = 'LEGACY_COMPOSITE_OR_DERIVED';
// [class, routes (comma-separated), implementation trace, behavior, existing constituent links,
//  proposed-only ID, index eligibility, index rationale, review note]
const reviewed = {
  get_management_action_center: [C, 'GET /api/workbench/action-center', 'workbench.cjs::buildManagementActionCenter+decorateManagementActionCenter', 'Live management action queue', '', 'workbench.action_center.read', 'DEFER_V1', 'Management aggregate outside core read set', 'Not execution_runs.record'],
  plan_factory_workflow: [D, 'POST /api/workbench/execution-plan', 'workbench.cjs::buildFactoryExecutionPlan+decorateFactoryExecutionPlanWithHistory', 'Derived factory execution plan; no execution', '', '', 'DEFER_V1', 'Higher-level workflow planning', 'Skill-like candidate'],
  get_business_alerts: [C, 'GET /api/quality/business-alerts', 'quality.cjs::buildBusinessAlerts', 'Business alert report', '', 'quality.business_alerts.read', 'DEFER_V1', 'Management alert aggregate', 'Not rule maintenance'],
  get_dashboard_summary: [C, 'GET /api/workbench/summary', 'workbench.cjs::buildBusinessSummary', 'Operational dashboard summary', '', 'workbench.summary.read', 'DEFER_V1', 'Aggregate, not initial core read', 'No formal workbench query'],
  get_order_readiness_overview: [C, 'GET /api/orders/readiness-overview', 'orders.cjs::orderQueries.getReadinessOverview', 'Cross-order readiness overview', '', 'orders.readiness_overview.read', 'DEFER_V1', 'Aggregate order workflow', 'Different from orders.list'],
  check_order_readiness: [C, 'GET /api/orders/lookup,GET /api/orders/:id/readiness', 'orders.cjs::orderQueries.getOrderReadiness', 'Single-order readiness assessment after identity resolution', '', 'orders.readiness.read', 'EXPOSE_V1', 'Owner-facing order read', 'Lookup is identity support'],
  plan_order_readiness_actions: [D, 'GET /api/orders/lookup,GET /api/orders/:id/readiness-plan', 'orders.cjs::buildOrderReadinessActionDraft', 'Derived readiness action draft, not execution', '', '', 'DEFER_V1', 'Higher-level draft needs review', 'Not orders.execute_readiness_action'],
  search_factory_knowledge: [D, 'GET /api/knowledge,GET /api/knowledge/:id,GET /api/knowledge/overview', 'businessExecutors.cjs::buildKnowledgeSources+buildBusinessRuleAnswerGuidance', 'Search, detail hydration and freshness/evidence projection', '', '', 'EXPOSE_V1', 'Evidence-backed knowledge search', 'Composite retrieval, not single formal query'],
  get_factory_knowledge_detail: [D, 'GET /api/knowledge/:id,GET /api/knowledge/overview', 'businessExecutors.cjs::buildKnowledgeSources', 'Knowledge detail plus freshness', '', '', 'EXPOSE_V1', 'Knowledge search follow-up', 'Two unregistered knowledge reads'],
  get_factory_knowledge_health: [C, 'GET /api/knowledge/health', 'knowledge.cjs::buildKnowledgeSyncHealth', 'Knowledge sync health', '', 'knowledge.health.read', 'EXCLUDE_V1', 'Internal maintenance telemetry', 'Not knowledge.sync_derived'],
  get_order_knowledge_package: [C, 'GET /api/orders/lookup,GET /api/orders/:id/knowledge-package', 'orders.cjs::buildOrderKnowledgePackage', 'Live order state and confirmed knowledge package', '', 'orders.knowledge_package.read', 'EXPOSE_V1', 'Owner-facing order investigation', 'Not orders.list'],
  get_data_quality_summary: [C, 'GET /api/quality/summary', 'quality.cjs::buildDataQualitySummary', 'Quality score and issue summary', '', 'quality.summary.read', 'DEFER_V1', 'Operational quality overview', 'No matching formal query'],
  analyze_recipe_configuration: [C, 'POST /api/quality/recipe-analysis', 'quality.cjs::analyzeRecipeConfiguration', 'Read-only recipe analysis and rule suggestions', '', 'quality.recipe_analysis.preview', 'DEFER_V1', 'Requires evidence review', 'Not quality.recipe_feedback.save'],
  get_factory_learning_health: [C, 'GET /api/quality/rule-learning-health', 'quality.cjs::buildFactoryLearningHealth', 'Learning evidence recheck health', '', 'quality.rule_learning_health.read', 'EXCLUDE_V1', 'Factory-learning telemetry', 'Not refresh command'],
  get_factory_rule_candidates: [C, 'GET /api/quality/rule-candidates', 'quality.cjs::listFactoryRuleCandidates', 'Learned rule candidates list', '', 'quality.rule_candidates.read', 'EXCLUDE_V1', 'Internal rule review', 'Not review command'],
  get_factory_rule_impact: [C, 'GET /api/quality/rule-candidates/:id/impact', 'quality.cjs::buildFactoryRuleImpact', 'Candidate rule impact report', '', 'quality.rule_candidates.impact', 'EXCLUDE_V1', 'Internal rule review', 'Not review command'],
  get_factory_rule_compliance: [C, 'GET /api/quality/rule-compliance', 'quality.cjs::buildFactoryRuleCompliance', 'Approved rule compliance report', '', 'quality.rule_compliance.read', 'EXCLUDE_V1', 'Internal rule governance', 'No formal query'],
  get_factory_rule_history: [C, 'GET /api/quality/rule-events', 'quality.cjs::listFactoryRuleEvents', 'Rule event history', '', 'quality.rule_events.read', 'EXCLUDE_V1', 'Internal rule audit', 'Not restore command'],
  get_order_detail: [D, 'GET /api/orders/lookup,GET /api/orders/:id', 'orderExecutors.cjs::loadOrder+resolveOrderTarget', 'Order detail plus parsed items and derived presentation totals', '', '', 'EXPOSE_V1', 'Core order detail', 'Not orders.list; adapter derives totals'],
  build_order_draft: [D, 'POST /api/orders/save-payload-draft', 'orders.cjs::buildOrderSavePayloadDraft', 'Non-persisted order save payload draft', '', '', 'DEFER_V1', 'Draft workflow review needed', 'Not orders.create/update_draft'],
  inspect_quotation_file: [D, 'POST /api/files/:id/quotation-draft', 'files.cjs::buildQuotationFileDraft', 'Parse uploaded file into quotation match draft', '', '', 'DEFER_V1', 'File parsing workflow review needed', 'Not plain file read'],
  build_quotation_draft: [D, 'GET /api/customers,GET /api/recipes,POST /api/recipes/:id/cost-preview,POST /api/quotations/save-payload-draft', 'businessExecutors.cjs::findByNameOrId+customerMarginMultiplier', 'Customer and recipe lookup, optional cost preview, quotation draft', 'customers.list,recipes.list', '', 'DEFER_V1', 'High-level draft skill candidate', 'Partial formal constituents only'],
  preview_recipe_cost: [D, 'GET /api/recipes,GET /api/recipes/current-costs,POST /api/recipes/bom-draft,POST /api/recipes/:id/cost-preview,GET /api/templates,GET /api/parts,GET /api/recipes?keyword=', 'businessExecutors.cjs::resolveUniqueRecipe+selectCurrentRecipeCost+normalizeRecipeCostContract', 'No-override current cost; baseline BOM rebuild; legacy override preview; cross-catalog reads only on not-found', 'recipes.list,recipes.current_costs', '', 'DEFER_V1', 'Three contracts under one cost tool; clarify before index', 'Not scenario_compare_preview; cross-catalog routes are conditional failure enrichment'],
  explain_cost_change: [A, 'POST /api/cost/recipe-difference', 'cost.cjs::costQueries.getRecipeDifference', 'Authoritative current recipe cost difference and drivers', 'cost.recipe_difference', '', 'EXPOSE_V1', 'Direct recipe cost difference explanation', 'Presentation summary only'],
  search_factory_file_archive_targets: [C, 'GET /api/files/archive-targets', 'files.cjs::searchFactoryFileArchiveTargets', 'Formal target candidates for file linking', '', 'files.archive_targets.read', 'DEFER_V1', 'Archive workflow support', 'Not files.archive command'],
  get_recipe_detail: [D, 'GET /api/recipes,GET /api/recipes/:id,GET /api/recipes/current-costs,GET /api/templates,GET /api/parts,GET /api/recipes?keyword=', 'queryExecutors.cjs::resolveUniqueRecipe+selectCurrentRecipeCost', 'Recipe detail plus optional rebuilt cost; cross-catalog reads only on not-found', 'recipes.list,recipes.current_costs', '', 'EXPOSE_V1', 'Core recipe detail with optional cost', 'GET detail unregistered; cross-catalog routes are conditional failure enrichment'],
  get_recipe_technical_files: [C, 'GET /api/recipes,GET /api/recipes/:id/technical-files,GET /api/templates,GET /api/parts,GET /api/recipes?keyword=', 'recipes.cjs::listRecipeTechnicalFiles', 'Files attached to resolved recipe; cross-catalog reads only on not-found', 'recipes.list', 'recipes.technical_files.list', 'EXPOSE_V1', 'Mature recipe file read', 'Not upload/delete or technical profile; cross-catalog routes are conditional failure enrichment'],
  build_recipe_bom_draft: [D, 'POST /api/recipes/bom-draft', 'recipes.cjs::recipeQueries.getBomDraft', 'Unsaved configured BOM and cost preview', '', '', 'DEFER_V1', 'Powerful draft; differentiate from scenario compare', 'Different current/same-read-set contract'],
  preview_pump_shell_cost: [D, 'GET /api/templates,POST /api/recipes/bom-draft', 'recipes.cjs::recipeQueries.getBomDraft', 'Template resolution, BOM draft, shell-only cost projection', 'templates.list', '', 'DEFER_V1', 'Shell-only derived preview', 'No independent cost formula'],
  compare_recipes: [A, 'POST /api/cost/recipe-difference', 'recipeExecutors.cjs::buildRecipeComparison', 'Authoritative two-recipe difference plus presentation', 'cost.recipe_difference', '', 'EXPOSE_V1', 'Direct current recipe comparison', 'Driver presentation uses formal response'],
  full_calculate: [D, 'POST /api/cost/full-estimate', 'cost.cjs::costQueries.calculateFullEstimate', 'Legacy free-form full estimate, not saved recipe scenario', '', '', 'DEFER_V1', 'Overlaps other cost tools but different basis', 'Do not map to current_costs'],
  dynamic_config_cost: [D, 'POST /api/cost/dynamic', 'cost.cjs::costQueries.calculateDynamic', 'Legacy dynamic configuration calculator', '', '', 'DEFER_V1', 'Overlapping legacy calculator', 'Not scenario_compare_preview'],
  calculate_coil_cost: [C, 'GET /api/coils,POST /api/coils/calculate', 'coils.cjs::calculateCoilCostHandler+calculateCoilCost', 'Variant-safe coil cost preview and other-scheme notice', 'coils.list', 'coils.cost_preview', 'EXPOSE_V1', 'Core formal coil cost', 'coils.list is identity, not cost'],
  get_copper_price: [C, 'GET /api/copper-price', 'cost.cjs::marketSync.getCopperPrice', 'Current copper price read', '', 'market.copper_price.read', 'EXPOSE_V1', 'Relevant cost driver', 'market.sync_copper_price is maintenance'],
  get_coil_specs: [C, 'GET /api/coils/specs', 'coils.cjs::coilQueries.getSpecOptions', 'Coil specification options read', '', 'coils.spec_options.read', 'EXPOSE_V1', 'Coil specification discovery', 'Not coils.list record semantics'],
  get_rotor_drawing_history: [C, 'GET /api/rotor/history', 'rotor.cjs::listRotorHistory', 'Bounded rotor drawing history projection', '', 'drawings.rotor.history.read', 'DEFER_V1', 'Outside initial cost/read core', 'Do not map to drawing write commands'],
};

function executorEvidence(name, family) {
  const rel = `api/routes/ai/executors/${family}Executors.cjs`;
  const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
  const at = lines.findIndex(line => line.includes(`case '${name}':`));
  if (at < 0) throw new Error(`Missing executor: ${name}`);
  return `${rel}:${at + 1}`;
}

function buildAudit() {
  const names = prior.unlinkedLegacyOrCompositeAiActions;
  if (names.length !== 36 || Object.keys(reviewed).length !== 36 || names.some(name => !reviewed[name])) throw new Error('Expected exactly 36 unlinked actions');
  const matrix = names.map(name => {
    const cap = getAiCapability(name);
    if (!cap) throw new Error(`Missing reviewed AI action: ${name}`);
    const [primaryClass, routes, service, behavior, links, proposed, eligibility, indexReason, notes] = reviewed[name];
    if (![A, B, C, D].includes(primaryClass) || !['EXPOSE_V1', 'DEFER_V1', 'EXCLUDE_V1'].includes(eligibility)) throw new Error(`Invalid review: ${name}`);
    const recommended = links ? links.split(',') : [];
    recommended.forEach(id => { if (!getBusinessCapability(id)) throw new Error(`Invented link: ${name} -> ${id}`); });
    // A2's proposed IDs are historical audit evidence. Later phases may
    // register an approved proposal; retain the classification without
    // rewriting the A2 snapshot or treating the approved registration as a
    // failed audit.
    const proposalRegistrationStatus = proposed
      ? (getBusinessCapability(proposed) ? 'REGISTERED_SINCE_A2' : 'PROPOSED_ONLY')
      : null;
    return { toolName: name, executorKey: cap.executorKey, access: cap.access, operation: cap.operation,
      actualApiRoutes: routes.split(','), actualServices: [service], actualBusinessBehavior: behavior,
      currentFormalCapabilityIds: [...cap.formalCapabilityIds], primaryClass,
      recommendedFormalCapabilityIds: recommended, proposedFormalCapabilityId: proposed || null,
      proposedFormalCapabilityStatus: proposalRegistrationStatus,
      mappingSemantics: primaryClass === A ? 'DIRECT' : primaryClass === B ? 'COMPOSITE' : primaryClass === C ? 'REGISTRY_GAP' : 'DERIVED_OR_LEGACY',
      mappingEvidence: [executorEvidence(name, cap.executorKey), service.includes('Executors.cjs::') ? `api/routes/ai/executors/${service}` : `api/routes/${service}`, 'api/capabilities/registry.cjs'],
      indexEligibility: eligibility, indexReason, notes };
  });
  const classification = Object.fromEntries([A, B, C, D].map(k => [k, matrix.filter(r => r.primaryClass === k).length]));
  const eligibility = Object.fromEntries(['EXPOSE_V1', 'DEFER_V1', 'EXCLUDE_V1'].map(k => [k, matrix.filter(r => r.indexEligibility === k).length]));
  const overview = { aiActions: listAiCapabilities().length, formalBusinessCapabilities: listBusinessCapabilities().length,
    linked: listAiCapabilities().filter(c => c.formalCapabilityIds.length).length, unlinked: matrix.length };
  return { matrix, classification, eligibility, overview };
}

if (require.main === module) {
  const audit = buildAudit();
  if (process.argv.includes('--write')) {
    const out = path.join(root, 'planning/ai-native-api');
    fs.writeFileSync(path.join(out, 'M5-A2-Formal-Mapping-Matrix.json'), JSON.stringify({ phase: 'M5-A2', ...audit }, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'M5-A2-Index-Eligibility.json'), JSON.stringify({ phase: 'M5-A2', counts: audit.eligibility,
      actions: audit.matrix.map(({ toolName, primaryClass, indexEligibility, indexReason }) => ({ toolName, primaryClass, indexEligibility, indexReason })) }, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify({ ...audit.overview, classification: audit.classification, eligibility: audit.eligibility }) + '\n');
}
module.exports = { buildAudit };
