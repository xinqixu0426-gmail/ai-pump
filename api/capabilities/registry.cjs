const DOMAIN_CAPABILITY_NAMES = Object.freeze({
    business_history: Object.freeze([
        'search_business_changes',
    ]),
    management: Object.freeze([
        'get_management_action_center',
        'plan_factory_workflow',
        'get_business_alerts',
        'get_dashboard_summary',
        'get_order_readiness_overview',
        'check_order_readiness',
        'plan_order_readiness_actions',
        'execute_order_readiness_action',
        'execute_factory_workflow_step',
    ]),
    knowledge: Object.freeze([
        'search_factory_knowledge',
        'get_factory_knowledge_detail',
        'get_factory_knowledge_health',
        'sync_factory_knowledge',
        'get_order_knowledge_package',
    ]),
    quality: Object.freeze([
        'get_data_quality_summary',
        'analyze_recipe_configuration',
        'get_factory_learning_health',
        'get_factory_rule_candidates',
        'get_factory_rule_impact',
        'get_factory_rule_compliance',
        'get_factory_rule_history',
        'set_recipe_analysis_feedback',
        'refresh_factory_rule_candidates',
        'review_factory_rule_candidate',
        'restore_factory_rule_event',
    ]),
    order: Object.freeze([
        'get_order_detail',
        'get_recent_orders',
        'get_purchase_overview',
        'get_order_readiness_overview',
        'check_order_readiness',
        'plan_order_readiness_actions',
        'get_order_knowledge_package',
        'build_order_draft',
        'generate_purchase_list',
        'save_order_requirement_draft',
        'save_order_execution_draft',
        'create_order',
        'update_order_status',
        'add_recipe_to_order',
        'remove_recipe_from_order',
        'update_order_item',
        'delete_order',
        'execute_order_readiness_action',
    ]),
    quotation: Object.freeze([
        'search_quotations',
        'get_quotation_detail',
        'search_customers',
        'inspect_quotation_file',
        'build_quotation_draft',
        'search_customer_history',
        'preview_recipe_cost',
        'explain_cost_change',
        'build_order_draft',
        'plan_factory_workflow',
        'execute_factory_workflow_step',
    ]),
    file: Object.freeze([
        'inspect_quotation_file',
        'search_factory_file_archive_targets',
        'archive_factory_file',
        'get_order_knowledge_package',
        'save_order_requirement_draft',
        'save_order_execution_draft',
    ]),
    recipe: Object.freeze([
        'search_templates',
        'get_template_detail',
        'get_all_recipes',
        'get_recipes_by_coil',
        'get_recipe_parts',
        'get_recipes_by_part',
        'get_recipe_detail',
        'get_recipe_technical_files',
        'build_recipe_bom_draft',
        'preview_recipe_cost',
        'preview_pump_shell_cost',
        'compare_recipes',
        'analyze_recipe_configuration',
        'create_recipe',
        'update_recipe',
        'delete_recipe',
    ]),
    cost: Object.freeze([
        'preview_recipe_cost',
        'preview_pump_shell_cost',
        'full_calculate',
        'dynamic_config_cost',
        'calculate_coil_cost',
        'get_copper_price',
        'explain_cost_change',
        'compare_recipes',
        'build_recipe_bom_draft',
    ]),
    coil: Object.freeze([
        'get_coil_specs',
        'search_coils',
        'calculate_coil_cost',
        'get_copper_price',
        'adjust_coil_stock',
        'search_factory_knowledge',
    ]),
    catalog: Object.freeze([
        'search_parts',
        'create_part',
        'batch_create_parts',
        'adjust_part_stock',
        'update_part',
        'delete_part',
        'batch_update_prices',
        'search_factory_knowledge',
    ]),
    drawing: Object.freeze([
        'generate_rotor_drawing',
        'get_rotor_drawing_history',
        'print_rotor_drawing',
    ]),
});

const AI_CAPABILITY_DISPLAY_NAMES = Object.freeze({
    search_business_changes: '查询业务变更',
    get_management_action_center: '读取管理待办',
    plan_factory_workflow: '生成工厂工作流计划',
    get_business_alerts: '读取经营异常',
    get_dashboard_summary: '读取运营看板',
    get_order_readiness_overview: '读取订单准备总览',
    check_order_readiness: '检查订单生产准备',
    plan_order_readiness_actions: '生成订单处理方案',
    execute_order_readiness_action: '执行订单处理步骤',
    execute_factory_workflow_step: '执行工厂工作流步骤',
    search_factory_knowledge: '搜索工厂知识库',
    get_factory_knowledge_detail: '读取知识详情',
    get_factory_knowledge_health: '检查知识库健康状态',
    sync_factory_knowledge: '同步工厂知识库',
    get_order_knowledge_package: '读取订单知识包',
    get_data_quality_summary: '读取数据质量',
    analyze_recipe_configuration: '智能检查配方',
    get_factory_learning_health: '检查学习证据健康状态',
    get_factory_rule_candidates: '读取候选业务规则',
    get_factory_rule_impact: '分析规则影响范围',
    get_factory_rule_compliance: '检查规则执行情况',
    get_factory_rule_history: '读取规则变更记录',
    set_recipe_analysis_feedback: '保存配方检查反馈',
    refresh_factory_rule_candidates: '归纳候选业务规则',
    review_factory_rule_candidate: '审核候选业务规则',
    restore_factory_rule_event: '恢复规则审核状态',
    get_order_detail: '读取订单详情',
    get_recent_orders: '读取最近订单',
    get_purchase_overview: '读取采购总览',
    build_order_draft: '生成订单草稿',
    generate_purchase_list: '生成采购清单',
    save_order_requirement_draft: '保存客户要求草稿',
    save_order_execution_draft: '保存订单执行档案草稿',
    create_order: '新建订单',
    update_order_status: '修改订单状态',
    add_recipe_to_order: '订单追加产品',
    remove_recipe_from_order: '订单移除产品',
    update_order_item: '修改订单产品',
    delete_order: '删除订单',
    inspect_quotation_file: '识别报价文件',
    search_quotations: '查询报价列表',
    get_quotation_detail: '读取报价详情',
    search_customers: '查询客户列表',
    search_templates: '查询泵壳模板',
    get_template_detail: '读取泵壳模板详情',
    build_quotation_draft: '生成报价草稿',
    search_customer_history: '查询客户历史',
    explain_cost_change: '解释成本差异',
    search_factory_file_archive_targets: '查找业务资料关联目标',
    archive_factory_file: '归档工厂文件',
    get_all_recipes: '读取配方列表',
    get_recipes_by_coil: '按线圈反查配方',
    get_recipe_parts: '读取配方规范零件',
    get_recipes_by_part: '按零件反查配方',
    get_recipe_detail: '读取配方明细',
    get_recipe_technical_files: '读取配方技术档案',
    build_recipe_bom_draft: '生成 BOM 草稿',
    preview_recipe_cost: '配方成本试算',
    preview_pump_shell_cost: '泵壳成本试算',
    compare_recipes: '对比配方',
    create_recipe: '新建配方',
    update_recipe: '修改配方',
    delete_recipe: '删除配方',
    full_calculate: '完整成本估算',
    dynamic_config_cost: '计算动态配置成本',
    calculate_coil_cost: '计算线圈成本',
    get_copper_price: '查询铜价',
    get_coil_specs: '读取线圈规格',
    search_coils: '查询线圈库存',
    adjust_coil_stock: '调整线圈库存',
    search_parts: '搜索零件',
    create_part: '新建零件',
    batch_create_parts: '批量新增零件',
    adjust_part_stock: '调整零件库存',
    update_part: '修改零件',
    delete_part: '删除零件',
    batch_update_prices: '批量调价',
    generate_rotor_drawing: '生成转子图纸',
    get_rotor_drawing_history: '读取出图历史',
    print_rotor_drawing: '打印转子图纸',
});

const DEFAULT_AI_ENTITY_SCOPES = Object.freeze([
    'single',
    'collection',
    'global',
]);
const AI_ENTITY_SCOPES = Object.freeze({
    get_quotation_detail: Object.freeze(['single']),
    get_template_detail: Object.freeze(['single']),
    get_business_alerts: Object.freeze(['collection', 'global']),
    get_management_action_center: Object.freeze(['collection', 'global']),
    get_order_readiness_overview: Object.freeze(['collection', 'global']),
    get_dashboard_summary: Object.freeze(['global']),
});

const AI_KNOWLEDGE_COMPANIONS = Object.freeze({
    get_recent_orders: Object.freeze({
        capabilityName: 'get_order_knowledge_package',
        argumentProjection: 'single_order_result',
    }),
    get_order_detail: Object.freeze({
        capabilityName: 'get_order_knowledge_package',
        argumentProjection: 'order_target',
    }),
    check_order_readiness: Object.freeze({
        capabilityName: 'get_order_knowledge_package',
        argumentProjection: 'order_target',
    }),
    plan_order_readiness_actions: Object.freeze({
        capabilityName: 'get_order_knowledge_package',
        argumentProjection: 'order_target',
    }),
});

const AI_EXECUTOR_CAPABILITY_NAMES = Object.freeze({
    cost: Object.freeze([
        'full_calculate',
        'get_copper_price',
        'calculate_coil_cost',
        'dynamic_config_cost',
        'generate_rotor_drawing',
        'print_rotor_drawing',
        'get_rotor_drawing_history',
    ]),
    query: Object.freeze([
        'search_business_changes',
        'get_coil_specs',
        'search_coils',
        'get_all_recipes',
        'get_recipes_by_coil',
        'get_recipe_parts',
        'get_recipes_by_part',
        'get_recipe_detail',
        'get_recipe_technical_files',
        'get_recent_orders',
        'search_quotations',
        'get_quotation_detail',
        'search_customers',
        'search_templates',
        'get_template_detail',
        'create_part',
        'batch_create_parts',
        'adjust_part_stock',
        'update_part',
        'adjust_coil_stock',
        'search_parts',
        'delete_part',
        'batch_update_prices',
        'get_dashboard_summary',
    ]),
    order: Object.freeze([
        'save_order_requirement_draft',
        'save_order_execution_draft',
        'create_order',
        'add_recipe_to_order',
        'get_order_detail',
        'get_purchase_overview',
        'get_order_knowledge_package',
        'check_order_readiness',
        'get_order_readiness_overview',
        'plan_order_readiness_actions',
        'execute_order_readiness_action',
        'update_order_status',
        'remove_recipe_from_order',
        'update_order_item',
        'generate_purchase_list',
        'delete_order',
    ]),
    recipe: Object.freeze([
        'create_recipe',
        'delete_recipe',
        'update_recipe',
        'compare_recipes',
    ]),
    business: Object.freeze([
        'build_recipe_bom_draft',
        'preview_recipe_cost',
        'preview_pump_shell_cost',
        'inspect_quotation_file',
        'build_quotation_draft',
        'build_order_draft',
        'search_customer_history',
        'explain_cost_change',
        'get_data_quality_summary',
        'analyze_recipe_configuration',
        'set_recipe_analysis_feedback',
        'get_factory_learning_health',
        'get_factory_rule_candidates',
        'get_factory_rule_impact',
        'get_factory_rule_compliance',
        'get_factory_rule_history',
        'restore_factory_rule_event',
        'refresh_factory_rule_candidates',
        'review_factory_rule_candidate',
        'get_management_action_center',
        'plan_factory_workflow',
        'execute_factory_workflow_step',
        'get_business_alerts',
        'search_factory_file_archive_targets',
        'archive_factory_file',
        'search_factory_knowledge',
        'get_factory_knowledge_detail',
        'get_factory_knowledge_health',
        'sync_factory_knowledge',
    ]),
});

const AI_EXECUTOR_BY_CAPABILITY_NAME = Object.freeze(Object.fromEntries(
    Object.entries(AI_EXECUTOR_CAPABILITY_NAMES)
        .flatMap(([executorKey, names]) => names.map(name => [name, executorKey]))
));

const LIVE_BUSINESS_EVIDENCE_NAMES = new Set([
    'search_business_changes',
    'search_parts',
    'search_coils',
    'get_all_recipes',
    'get_recipes_by_coil',
    'get_recipe_parts',
    'get_recipes_by_part',
    'get_recipe_detail',
    'get_recipe_technical_files',
    'preview_recipe_cost',
    'preview_pump_shell_cost',
    'compare_recipes',
    'explain_cost_change',
    'calculate_coil_cost',
    'dynamic_config_cost',
    'full_calculate',
    'get_copper_price',
    'get_recent_orders',
    'search_quotations',
    'get_quotation_detail',
    'search_customers',
    'search_templates',
    'get_template_detail',
    'get_purchase_overview',
    'get_order_detail',
    'get_order_knowledge_package',
    'get_order_readiness_overview',
    'check_order_readiness',
    'plan_order_readiness_actions',
    'search_customer_history',
    'inspect_quotation_file',
    'get_dashboard_summary',
    'get_management_action_center',
    'get_business_alerts',
    'get_data_quality_summary',
    'analyze_recipe_configuration',
    'search_factory_file_archive_targets',
    'get_factory_knowledge_health',
    'get_factory_rule_candidates',
    'get_factory_rule_impact',
    'get_factory_rule_compliance',
    'get_factory_rule_history',
]);

const WRITE_CAPABILITY_NAMES = new Set([
    'create_part',
    'batch_create_parts',
    'adjust_part_stock',
    'update_part',
    'delete_part',
    'batch_update_prices',
    'adjust_coil_stock',
    'create_order',
    'delete_order',
    'update_order_status',
    'add_recipe_to_order',
    'remove_recipe_from_order',
    'update_order_item',
    'generate_purchase_list',
    'save_order_requirement_draft',
    'save_order_execution_draft',
    'execute_order_readiness_action',
    'execute_factory_workflow_step',
    'create_recipe',
    'delete_recipe',
    'update_recipe',
    'archive_factory_file',
    'sync_factory_knowledge',
    'set_recipe_analysis_feedback',
    'refresh_factory_rule_candidates',
    'review_factory_rule_candidate',
    'restore_factory_rule_event',
    'generate_rotor_drawing',
    'print_rotor_drawing',
]);

const LIVE_CAPABILITY_NAMES = new Set([
    'search_business_changes',
    'full_calculate',
    'get_copper_price',
    'calculate_coil_cost',
    'get_coil_specs',
    'search_coils',
    'adjust_coil_stock',
    'adjust_part_stock',
    'get_all_recipes',
    'get_recipes_by_coil',
    'get_recipe_parts',
    'get_recipes_by_part',
    'get_recipe_detail',
    'get_recipe_technical_files',
    'dynamic_config_cost',
    'get_recent_orders',
    'search_quotations',
    'get_quotation_detail',
    'search_customers',
    'search_templates',
    'get_template_detail',
    'get_purchase_overview',
    'get_order_detail',
    'generate_purchase_list',
    'preview_recipe_cost',
    'preview_pump_shell_cost',
    'compare_recipes',
    'search_customer_history',
    'explain_cost_change',
    'get_data_quality_summary',
    'get_management_action_center',
    'get_business_alerts',
    'get_order_readiness_overview',
    'check_order_readiness',
    'get_dashboard_summary',
    'search_parts',
]);

const DERIVED_CAPABILITY_NAMES = new Set([
    'build_recipe_bom_draft',
    'inspect_quotation_file',
    'build_quotation_draft',
    'build_order_draft',
    'analyze_recipe_configuration',
    'get_factory_learning_health',
    'get_factory_rule_candidates',
    'get_factory_rule_impact',
    'get_factory_rule_compliance',
    'get_factory_rule_history',
    'plan_factory_workflow',
    'execute_factory_workflow_step',
    'plan_order_readiness_actions',
    'get_order_knowledge_package',
    'search_factory_knowledge',
    'get_factory_knowledge_detail',
    'get_factory_knowledge_health',
]);

const PREVIEW_CAPABILITY_NAMES = new Set([
    'adjust_coil_stock',
    'full_calculate',
    'calculate_coil_cost',
    'dynamic_config_cost',
    'build_recipe_bom_draft',
    'preview_recipe_cost',
    'preview_pump_shell_cost',
    'inspect_quotation_file',
    'build_quotation_draft',
    'build_order_draft',
    'explain_cost_change',
    'analyze_recipe_configuration',
    'plan_factory_workflow',
    'execute_factory_workflow_step',
    'plan_order_readiness_actions',
    'execute_order_readiness_action',
    'compare_recipes',
    'batch_create_parts',
    'create_order',
    'create_recipe',
    'update_recipe',
    'add_recipe_to_order',
    'remove_recipe_from_order',
    'update_order_item',
    'generate_purchase_list',
    'archive_factory_file',
]);

// Private assistant implementation capabilities do not automatically widen the independently reviewed
// MCP catalogue. Every AI capability still declares this boundary explicitly in its registry record.
const PRIVATE_ASSISTANT_ONLY_CAPABILITY_NAMES = new Set([
    'get_recipe_parts',
    'get_recipes_by_part',
]);

const AI_FORMAL_CAPABILITY_IDS = Object.freeze({
    search_business_changes: Object.freeze(['business_changes.list']),
    search_parts: Object.freeze(['parts.list']),
    search_coils: Object.freeze(['coils.list']),
    get_recent_orders: Object.freeze(['orders.list']),
    search_quotations: Object.freeze(['quotations.list']),
    get_quotation_detail: Object.freeze(['quotations.detail']),
    get_purchase_overview: Object.freeze(['purchasing.overview']),
    get_all_recipes: Object.freeze(['recipes.list']),
    get_recipes_by_coil: Object.freeze(['recipes.by_coil']),
    get_recipe_parts: Object.freeze(['ontology.relations.resolve']),
    get_recipes_by_part: Object.freeze(['ontology.relations.resolve']),
    search_customers: Object.freeze(['customers.list']),
    search_templates: Object.freeze(['templates.list']),
    get_template_detail: Object.freeze(['templates.list', 'templates.detail']),
    search_customer_history: Object.freeze(['customers.list', 'customers.history']),
    create_part: Object.freeze(['parts.create']),
    batch_create_parts: Object.freeze(['parts.batch_create']),
    adjust_part_stock: Object.freeze(['inventory.parts.batch_adjust_stock']),
    update_part: Object.freeze(['parts.update']),
    delete_part: Object.freeze(['parts.delete']),
    batch_update_prices: Object.freeze(['parts.batch_update_prices']),
    adjust_coil_stock: Object.freeze(['inventory.coils.adjust_stock']),
    create_order: Object.freeze(['orders.create']),
    delete_order: Object.freeze(['orders.delete']),
    update_order_status: Object.freeze(['orders.change_status']),
    add_recipe_to_order: Object.freeze(['orders.update_draft']),
    remove_recipe_from_order: Object.freeze(['orders.update_draft']),
    update_order_item: Object.freeze(['orders.update_draft']),
    generate_purchase_list: Object.freeze(['orders.update_draft']),
    save_order_requirement_draft: Object.freeze([
        'orders.requirements.save_draft',
    ]),
    save_order_execution_draft: Object.freeze([
        'orders.execution_records.create_draft',
    ]),
    execute_order_readiness_action: Object.freeze([
        'orders.execute_readiness_action',
        'workbench.execution_runs.record',
    ]),
    execute_factory_workflow_step: Object.freeze([
        'workflow.quotation.convert_to_order',
        'workbench.execution_runs.record',
    ]),
    create_recipe: Object.freeze(['recipes.create']),
    update_recipe: Object.freeze(['recipes.update']),
    delete_recipe: Object.freeze(['recipes.delete']),
    archive_factory_file: Object.freeze(['files.archive']),
    sync_factory_knowledge: Object.freeze(['knowledge.sync_derived']),
    set_recipe_analysis_feedback: Object.freeze([
        'quality.recipe_feedback.save',
    ]),
    refresh_factory_rule_candidates: Object.freeze([
        'quality.rule_candidates.refresh',
    ]),
    review_factory_rule_candidate: Object.freeze([
        'quality.rule_candidates.review',
    ]),
    restore_factory_rule_event: Object.freeze([
        'quality.rule_events.restore',
    ]),
    generate_rotor_drawing: Object.freeze(['drawings.rotor.generate_pdf']),
    print_rotor_drawing: Object.freeze(['drawings.rotor.print_pdf']),
});

const CRITICAL_CAPABILITY_NAMES = new Set([
    'adjust_coil_stock',
    'adjust_part_stock',
    'execute_factory_workflow_step',
    'print_rotor_drawing',
]);

const MEDIUM_CAPABILITY_NAMES = new Set([
    'create_part',
    'update_part',
    'delete_part',
    'set_recipe_analysis_feedback',
    'refresh_factory_rule_candidates',
    'review_factory_rule_candidate',
    'restore_factory_rule_event',
    'save_order_requirement_draft',
    'save_order_execution_draft',
]);

const EXTERNAL_SIDE_EFFECT_CAPABILITY_NAMES = new Set([
    'generate_rotor_drawing',
    'print_rotor_drawing',
]);

function defineBusinessCapability(definition) {
    return Object.freeze({
        access: 'write',
        operation: 'command',
        completionMode: 'completed',
        requiresConfirmation: true,
        idempotency: 'persistent_actor_capability_key_request_hash_90_days',
        concurrencyControl: 'expectedUpdatedAt',
        transactionality: 'business_write_audit_and_operation_receipt_atomic',
        audit: 'strong_audit_linked_by_operation_request_and_capability',
        timeoutMs: 15_000,
        deprecated: false,
        contractStatus: 'current',
        recordsBusinessChange: true,
        ...definition,
    });
}

function defineQueryCapability(definition) {
    return Object.freeze({
        access: 'query',
        operation: 'query',
        requiresConfirmation: false,
        supportsPreview: false,
        idempotency: 'inherent',
        concurrencyControl: 'not_applicable',
        transactionality: 'not_applicable',
        audit: 'none',
        timeoutMs: 15_000,
        deprecated: false,
        contractStatus: 'current',
        ...definition,
    });
}

function definePreviewCapability(definition) {
    return Object.freeze({
        access: 'preview',
        operation: 'preview',
        requiresConfirmation: false,
        supportsPreview: false,
        idempotency: 'inherent',
        concurrencyControl: 'not_applicable',
        transactionality: 'not_applicable',
        audit: 'none',
        timeoutMs: 15_000,
        deprecated: false,
        contractStatus: 'current',
        ...definition,
    });
}

const BUSINESS_CAPABILITY_REGISTRY = Object.freeze({
    'rotor.recipe_draft': defineQueryCapability({
        capabilityId: 'rotor.recipe_draft', domain: 'rotor',
        inputSchema: 'POST /api/rotor/recipe-draft { recipeId }',
        outputSchema: 'RotorRecipeDraft with patch, hints and source IDs; ambiguous shell returns 409 with candidates',
        sourceOfTruth: 'recipes+pump_shell_templates+unique_active_shell_catalog+rotorTemplateDraft',
        riskLevel: 'low', callers: Object.freeze(['web', 'internal']),
    }),
    'rotor.template_draft': defineQueryCapability({
        capabilityId: 'rotor.template_draft', domain: 'rotor',
        inputSchema: 'POST /api/rotor/template-draft { templateId, variantId? }',
        outputSchema: 'RotorTemplateDraft with patch, hints and template metadata; ambiguous shell returns 409 with candidates',
        sourceOfTruth: 'pump_shell_templates+unique_active_shell_catalog+rotorTemplateDraft',
        riskLevel: 'low', callers: Object.freeze(['web', 'internal']),
    }),
    'recipes.resolve_identity': defineQueryCapability({
        capabilityId: 'recipes.resolve_identity', domain: 'recipes',
        inputSchema: 'GET /api/recipes/identity?name=',
        outputSchema: 'RecipeIdentityResolutionV1: { recipeId, recipeName } bound to exactly ONE active recipe; unregistered name returns 404 RECIPE_NOT_FOUND, several active recipes sharing the name return 409 RECIPE_AMBIGUOUS with bounded candidates',
        sourceOfTruth: 'recipes(name) exact match over non-deleted recipes, LIMIT-bounded by the service',
        riskLevel: 'low', transactionality: 'read_transaction', callers: Object.freeze(['internal']),
    }),
    'recipes.current_costs': defineQueryCapability({        capabilityId: 'recipes.current_costs', domain: 'recipes',
        inputSchema: 'GET /api/recipes/current-costs', outputSchema: 'CurrentRecipeCosts with per-recipe calculationError and incomplete costs',
        sourceOfTruth: 'saved_recipe_ids+current_template_ids+costEngine',
        riskLevel: 'low', transactionality: 'read_transaction', callers: Object.freeze(['web', 'internal']),
    }),
    'cost.recipe_difference': defineQueryCapability({
        capabilityId: 'cost.recipe_difference', domain: 'cost',
        inputSchema: 'POST /api/cost/recipe-difference { leftRecipeId?, leftRecipeName?, rightRecipeId?, rightRecipeName?, limit? }',
        outputSchema: 'CurrentRecipeCostDifference with current cost details',
        sourceOfTruth: 'saved_recipe_ids+current_template_ids+costEngine',
        riskLevel: 'low', transactionality: 'read_transaction', callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'catalog.rename': defineBusinessCapability({
        capabilityId: 'catalog.rename', displayName: '按规格规范名称', domain: 'catalog',
        inputSchema: 'POST /api/catalog/rename-preview { entityType, entityId, naming, samePhysicalItem: true, expectedUpdatedAt }; POST /api/catalog/rename { confirmationToken, idempotencyKey }',
        outputSchema: 'CommandReceipt<{entityType, entityId, currentName, bindingIds}>',
        sourceOfTruth: 'catalog_master_records+audited_reference_bindings+immutable_physical_profile', riskLevel: 'high',
        supportsPreview: true, previewPath: '/api/catalog/rename-preview', callers: Object.freeze(['web', 'internal']),
        concurrencyControl: 'confirmationToken_bound_source_and_catalog_hash',
    }),
    'catalog.bind_references': defineBusinessCapability({
        capabilityId: 'catalog.bind_references', displayName: '绑定历史物料引用', domain: 'catalog',
        inputSchema: 'POST /api/catalog/reference-bindings-preview { bindings[] }; POST /api/catalog/reference-bindings { confirmationToken, idempotencyKey? }',
        outputSchema: 'CommandReceipt<{ bindingIds: number[], displayOnly: true }>; preview: CatalogBindingPreviewV1',
        sourceOfTruth: 'audited_source_records+catalog_identity_profiles+catalog_reference_bindings', riskLevel: 'high',
        supportsPreview: true, callers: Object.freeze(['web', 'internal']),
        previewPath: '/api/catalog/reference-bindings-preview',
        concurrencyControl: 'confirmationToken_bound_snapshot',
    }),
    'catalog.bound_names': defineQueryCapability({
        capabilityId: 'catalog.bound_names', domain: 'catalog',
        inputSchema: 'POST /api/catalog/bound-names { sourceType, sourceId, afterId?, limit? }',
        outputSchema: 'CatalogBoundNamesV1 with source validity, currentName and snapshotValue',
        sourceOfTruth: 'source_records+catalog_reference_bindings+catalog_master_records',
        riskLevel: 'low', transactionality: 'read_transaction', callers: Object.freeze(['web', 'internal']),
    }),
    'catalog.references_resolve': defineQueryCapability({
        capabilityId: 'catalog.references_resolve', domain: 'catalog',
        inputSchema: 'POST /api/catalog/references/resolve { references: CatalogReferenceV1[] }',
        outputSchema: 'CatalogCurrentNamesV1 with currentName, snapshotName, referenceStatus and revisions',
        sourceOfTruth: 'catalog_master_records+catalog_identity_profiles', riskLevel: 'low',
        transactionality: 'read_transaction', callers: Object.freeze(['web', 'internal']),
    }),
    'catalog.naming_rules': defineQueryCapability({
        capabilityId: 'catalog.naming_rules', domain: 'catalog',
        inputSchema: 'GET /api/catalog/naming-rules', outputSchema: 'CatalogNamingRulesV1; ruleset version 5, recipe displayName or legacy series/configuration without pump prefix, barrel length optional, cable/float cross-section mm², bearing catalog shorthand',
        sourceOfTruth: 'server_catalog_naming_rules', riskLevel: 'low', callers: Object.freeze(['web', 'internal']),
    }),
    'catalog.name_preview': definePreviewCapability({
        capabilityId: 'catalog.name_preview', domain: 'catalog',
        inputSchema: 'POST /api/catalog/name-preview { ruleId, spec }', outputSchema: 'CatalogNamePreviewV1',
        sourceOfTruth: 'server_catalog_naming_rules', riskLevel: 'low', callers: Object.freeze(['web', 'internal']),
    }),
    'catalog.migrate': defineBusinessCapability({
        capabilityId: 'catalog.migrate', domain: 'catalog',
        inputSchema: 'POST /api/catalog/migrate {confirmationToken,idempotencyKey}',
        outputSchema: 'CommandReceipt<CatalogMigrationResult>',
        sourceOfTruth: 'catalog_identity_profiles+catalog_reference_bindings+catalog_tables',
        riskLevel: 'high', supportsPreview: true, previewPath: '/api/catalog/migration-preview',
        concurrencyControl: 'confirmationToken_bound_source_and_catalog_hash',
        callers: Object.freeze(['web', 'internal']),
    }),
    'catalog.reference_audit': defineQueryCapability({
        capabilityId: 'catalog.reference_audit', domain: 'catalog',
        inputSchema: 'INTERNAL catalog-reference-audit { maxRowsPerTable?, maxReferences? }',
        outputSchema: 'CatalogReferenceAuditV1 with complete, counts, references, sourceHashes, namingCandidates, businessBaseline and costBaseline',
        sourceOfTruth: 'parts+coils+templates+recipes+quotations+orders+persisted_business_references',
        transactionality: 'read_transaction', riskLevel: 'low',
        callers: Object.freeze(['internal']),
    }),
    'relations.read': defineQueryCapability({
        capabilityId: 'relations.read', domain: 'catalog',
        inputSchema: 'POST /api/relations/read RelationReadRequestV1',
        outputSchema: 'BoundedRelationResultV1',
        sourceOfTruth: 'orders+customers+parts+recipes saved canonical/exact references',
        transactionality: 'read_transaction', riskLevel: 'low',
        callers: Object.freeze(['internal']),
    }),
    'recipes.by_coil': defineQueryCapability({
        capabilityId: 'recipes.by_coil', domain: 'recipe',
        inputSchema: 'POST /api/relations/read { version: 1, relation: "coil.recipes", rootId: coilId, pageSize?, afterId? }',
        outputSchema: 'BoundedRelationResultV1 (resourceType=recipe, semantics=CURRENT_RECIPE_COIL_REFERENCES, keyset id_desc)',
        sourceOfTruth: 'recipes.coil_id current canonical references (not the whole recipe aggregate)',
        transactionality: 'read_transaction', riskLevel: 'low',
        callers: Object.freeze(['ai', 'internal']),
    }),
    'ontology.relations.resolve': defineQueryCapability({
        capabilityId: 'ontology.relations.resolve', domain: 'catalog',
        inputSchema: 'POST /api/relations/resolve OntologyRelationResolveRequestV1',
        outputSchema: 'OntologyRelationResolveResultV1 with canonicalOnly=true, bounded keyset page and explicit completeness',
        sourceOfTruth: 'OntologyV1 registered relations over canonical business IDs and saved canonical references',
        transactionality: 'read_transaction', riskLevel: 'low',
        callers: Object.freeze(['ai', 'internal']),
    }),
    'collections.read': defineQueryCapability({
        capabilityId: 'collections.read', domain: 'catalog',
        inputSchema: 'POST /api/collections/read CollectionReadRequest (customers list: optional literal customerKeyword, bounded keyset discovery)',
        outputSchema: 'BoundedCollectionResultV1',
        sourceOfTruth: 'orders+customers+parts+recipes+coils',
        transactionality: 'read_transaction', riskLevel: 'low',
        callers: Object.freeze(['ai', 'internal']),
    }),
    'entities.coil_span_candidates': defineQueryCapability({
        capabilityId: 'entities.coil_span_candidates',
        domain: 'coil',
        inputSchema: 'POST /api/entity-span-candidates { version: 1, sourceText: string, entityScope: coil }',
        outputSchema: 'BoundedCoilSourceSpans',
        sourceOfTruth: 'coils.scheme_name+coils.scheme_code',
        riskLevel: 'low',
        callers: Object.freeze(['internal']),
    }),
    'entities.lookup_batch': defineQueryCapability({
        capabilityId: 'entities.lookup_batch',
        domain: 'catalog',
        inputSchema: 'POST /api/entity-lookup { version, mention, entityTypes[], matchPolicy }',
        outputSchema: 'BoundedEntityLookupV1 with exact candidates and recipe formal-alias resolution states',
        sourceOfTruth: 'canonical_business_tables+catalog_name_aliases+catalog_identity_profiles',
        transactionality: 'read_transaction',
        riskLevel: 'low',
        callers: Object.freeze(['internal']),
    }),
    'business_changes.revision': defineQueryCapability({
        capabilityId: 'business_changes.revision',
        domain: 'business_history',
        inputSchema: 'GET /api/business-changes/revision',
        outputSchema: '{revision: opaque string, sourceOfTruth}',
        sourceOfTruth: 'business_change_events.latest_committed_id_and_operation',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'internal']),
    }),
    'business_changes.list': defineQueryCapability({
        capabilityId: 'business_changes.list',
        domain: 'business_history',
        inputSchema: 'GET /api/business-changes?period?&from?&to?&domain?&entityType?&entityId?&eventType?&keyword?&beforeId?&limit?',
        outputSchema: 'BusinessChangePage',
        sourceOfTruth: 'business_change_events+business_change_event_entities',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'inventory.parts.batch_adjust_stock': defineBusinessCapability({
        capabilityId: 'inventory.parts.batch_adjust_stock',
        domain: 'inventory',
        inputSchema: 'POST /api/parts/batch-stock',
        outputSchema: 'CommandReceipt<PartStockBatchResult>',
        sourceOfTruth: 'parts.stock',
        riskLevel: 'critical',
        supportsPreview: true,
        previewPath: '/api/parts/batch-stock-preview',
        concurrencyControl: 'confirmationToken_bound_inventory_snapshot',
    }),
    'inventory.coils.adjust_stock': defineBusinessCapability({
        capabilityId: 'inventory.coils.adjust_stock',
        domain: 'inventory',
        inputSchema: 'POST /api/coils/stock-adjustments',
        outputSchema: 'CommandReceipt<CoilStockBatchResult>',
        sourceOfTruth: 'coils.stock+coil_stock_movements',
        riskLevel: 'critical',
        supportsPreview: true,
        previewPath: '/api/coils/stock-adjustments-preview',
        concurrencyControl: 'confirmationToken_bound_inventory_snapshot',
    }),
    'workflow.quotation.convert_to_order': defineBusinessCapability({
        capabilityId: 'workflow.quotation.convert_to_order',
        domain: 'quotation',
        inputSchema:
            'POST /api/quotations/:id/convert { expectedUpdatedAt?, previewHash?, itemQuantities? }',
        outputSchema: 'CommandReceipt<QuotationConversionResult>',
        sourceOfTruth: 'quotationSnapshot+orderPlanning+orders',
        riskLevel: 'critical',
        supportsPreview: true,
        previewPath:
            '/api/quotations/:id/order-draft { itemQuantities?: [{ quotationItemId, qty }] }',
    }),
    'customers.create': defineBusinessCapability({
        capabilityId: 'customers.create',
        domain: 'customer',
        inputSchema: 'POST /api/customers',
        outputSchema: 'CommandReceipt<CustomerCreateResult>',
        sourceOfTruth: 'customers',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'not_applicable',
    }),
    'customers.update': defineBusinessCapability({
        capabilityId: 'customers.update',
        domain: 'customer',
        inputSchema: 'PATCH /api/customers/:id',
        outputSchema: 'CommandReceipt<CustomerUpdateResult>',
        sourceOfTruth: 'customers',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'customers.delete': defineBusinessCapability({
        capabilityId: 'customers.delete',
        domain: 'customer',
        inputSchema: 'DELETE /api/customers/:id',
        outputSchema: 'CommandReceipt<CustomerDeleteResult>',
        sourceOfTruth: 'customers+quotationHistory',
        riskLevel: 'medium',
        supportsPreview: false,
    }),
    'parts.create': defineBusinessCapability({
        capabilityId: 'parts.create',
        domain: 'catalog',
        inputSchema: 'POST /api/parts',
        outputSchema: 'CommandReceipt<PartCreateResult>',
        sourceOfTruth: 'parts+naming_inputs+optional_part_form_business_settings',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'not_applicable',
    }),
    'parts.batch_create': defineBusinessCapability({
        capabilityId: 'parts.batch_create',
        domain: 'catalog',
        inputSchema: 'POST /api/parts/batch-create',
        outputSchema: 'CommandReceipt<PartBatchCreateResult>',
        sourceOfTruth: 'parts+naming_inputs',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/parts/batch-create-preview',
        concurrencyControl: 'confirmationToken_bound_absence_snapshot',
        callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'parts.rename_impact': defineQueryCapability({
        capabilityId: 'parts.rename_impact',
        domain: 'catalog',
        inputSchema: 'POST /api/parts/:id/rename-impact { model, offset?, limit?, sourceHash? }',
        outputSchema: 'PartRenameImpact { blockers, references, referenceCount, sourceHash, nextOffset, displayOnly:true }; no write authorization',
        sourceOfTruth: 'parts+catalogReferenceAudit+catalog_reference_bindings+catalog_template_shell_bindings',
        riskLevel: 'low',
        transactionality: 'read_only_snapshot',
        callers: Object.freeze(['web', 'internal']),
    }),
    'parts.update': defineBusinessCapability({
        capabilityId: 'parts.update',
        domain: 'catalog',
        inputSchema: 'PATCH /api/parts/:id',
        outputSchema: 'CommandReceipt<PartUpdateResult>',
        sourceOfTruth: 'parts+catalogReferenceAudit+pump_shell_templates+optional_part_form_business_settings',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'parts.delete': defineBusinessCapability({
        capabilityId: 'parts.delete',
        domain: 'catalog',
        inputSchema: 'DELETE /api/parts/:id',
        outputSchema: 'CommandReceipt<PartDeleteResult>',
        sourceOfTruth: 'parts+recipeSnapshots',
        riskLevel: 'medium',
        supportsPreview: true,
        previewPath: '/api/parts/:id/delete-preview',
        concurrencyControl: 'expectedUpdatedAt+confirmationToken_bound_delete_preview',
    }),
    'parts.save_profile': defineBusinessCapability({
        capabilityId: 'parts.save_profile',
        domain: 'catalog',
        inputSchema: 'POST /api/parts/:id/save',
        outputSchema: 'CommandReceipt<PartProfileSaveResult>',
        sourceOfTruth: 'parts+catalogReferenceAudit+pump_shell_templates+part_form_business_settings',
        riskLevel: 'critical',
        supportsPreview: true,
        previewPath: '/api/parts/:id/save-preview',
        concurrencyControl: 'confirmationToken_bound_part_setting_versions_and_rename_source_hash',
        transactionality: 'part_stock_settings_audits_and_operation_receipt_atomic',
    }),
    'parts.batch_delete': defineBusinessCapability({
        capabilityId: 'parts.batch_delete',
        domain: 'catalog',
        inputSchema: 'POST /api/parts/batch-delete',
        outputSchema: 'CommandReceipt<PartBatchDeleteResult>',
        sourceOfTruth: 'parts',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/parts/batch-delete-preview',
        concurrencyControl: 'confirmationToken_bound_expectedVersions',
        transactionality: 'all_part_deletes_audits_and_operation_receipt_atomic',
    }),
    'parts.batch_update_prices': defineBusinessCapability({
        capabilityId: 'parts.batch_update_prices',
        domain: 'catalog',
        inputSchema: 'PATCH /api/parts/prices',
        outputSchema: 'CommandReceipt<PartBatchPriceResult>',
        sourceOfTruth: 'parts.price',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/parts/prices-preview',
        concurrencyControl: 'expectedVersions',
    }),
    'coils.create': defineBusinessCapability({
        capabilityId: 'coils.create',
        domain: 'coil',
        inputSchema: 'POST /api/coils CoilInput(schemeCode?,isDefault?,ratedVoltageV?,ratedFrequencyHz?,market?,schemeFamilyCode?)',
        outputSchema: 'CommandReceipt<CoilCreateResult>',
        sourceOfTruth: 'stator_variants+coils',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'not_applicable',
    }),
    'coils.update': defineBusinessCapability({
        capabilityId: 'coils.update',
        domain: 'coil',
        inputSchema: 'PATCH /api/coils/:id CoilUpdate(isDefault?,ratedVoltageV?,ratedFrequencyHz?,market?,schemeFamilyCode?)',
        outputSchema: 'CommandReceipt<CoilUpdateResult>',
        sourceOfTruth: 'stator_variants+coils+coil_stock_movements',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'coils.delete': defineBusinessCapability({
        capabilityId: 'coils.delete',
        domain: 'coil',
        inputSchema: 'DELETE /api/coils/:id',
        outputSchema: 'CommandReceipt<CoilDeleteResult>',
        sourceOfTruth: 'coils+coil_stock_movements',
        riskLevel: 'high',
        supportsPreview: false,
    }),
    'coils.batch_update_unit_price': defineBusinessCapability({
        capabilityId: 'coils.batch_update_unit_price',
        domain: 'coil',
        inputSchema: 'PATCH /api/coils/spec/:spec',
        outputSchema: 'CommandReceipt<CoilBatchUnitPriceResult>',
        sourceOfTruth: 'stator_variants+coils.cost',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/coils/spec-price-preview',
        concurrencyControl: 'expectedVersions',
    }),
    'templates.create': defineBusinessCapability({
        capabilityId: 'templates.create',
        domain: 'recipe',
        inputSchema: 'POST /api/templates TemplateInput(naming required, shellPartId required for bundle, partsJson[].partId?, shellComponentsJson[].partId?, configurationPolicyJson?, shellComponentsJson.subassemblyContents[].referenceUnitPrice?)',
        outputSchema: 'CommandReceipt<TemplateCreateResult>',
        sourceOfTruth: 'pump_shell_templates+partsCatalog',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'not_applicable',
    }),
    'templates.update': defineBusinessCapability({
        capabilityId: 'templates.update',
        domain: 'recipe',
        inputSchema: 'PATCH /api/templates/:id TemplatePatch(partsJson[].partId?, shellComponentsJson[].partId?, configurationPolicyJson?, shellComponentsJson.subassemblyContents[].referenceUnitPrice?)',
        outputSchema: 'CommandReceipt<TemplateUpdateResult>',
        sourceOfTruth: 'pump_shell_templates+partsCatalog',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'templates.delete': defineBusinessCapability({
        capabilityId: 'templates.delete',
        domain: 'recipe',
        inputSchema: 'DELETE /api/templates/:id',
        outputSchema: 'CommandReceipt<TemplateDeleteResult>',
        sourceOfTruth: 'pump_shell_templates+recipeReferences',
        riskLevel: 'high',
        supportsPreview: false,
    }),
    'model_variants.create': defineBusinessCapability({
        capabilityId: 'model_variants.create',
        domain: 'recipe',
        inputSchema: 'POST /api/model-variants ModelVariantInput(naming required)',
        outputSchema: 'CommandReceipt<ModelVariantCreateResult>',
        sourceOfTruth: 'pump_model_variants+pump_shell_templates+parts',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'not_applicable',
    }),
    'model_variants.update': defineBusinessCapability({
        capabilityId: 'model_variants.update',
        domain: 'recipe',
        inputSchema: 'PATCH /api/model-variants/:id',
        outputSchema: 'CommandReceipt<ModelVariantUpdateResult>',
        sourceOfTruth: 'pump_model_variants+pump_shell_templates+parts',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'model_variants.delete': defineBusinessCapability({
        capabilityId: 'model_variants.delete',
        domain: 'recipe',
        inputSchema: 'DELETE /api/model-variants/:id',
        outputSchema: 'CommandReceipt<ModelVariantDeleteResult>',
        sourceOfTruth: 'pump_model_variants+recipeReferences',
        riskLevel: 'high',
        supportsPreview: false,
    }),
    'settings.update_business_value': defineBusinessCapability({
        capabilityId: 'settings.update_business_value',
        domain: 'cost',
        inputSchema: 'PUT /api/settings/:key',
        outputSchema: 'CommandReceipt<BusinessSettingUpdateResult>',
        sourceOfTruth: 'system_settings+costEngineConsumers',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'settings.update_runtime': defineBusinessCapability({
        capabilityId: 'settings.update_runtime',
        domain: 'configuration',
        inputSchema: 'PUT /api/settings/runtime',
        outputSchema: 'CommandReceipt<RuntimeSettingsUpdateResult>',
        sourceOfTruth: 'runtime_settings+process_environment',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'expectedUpdatedAt',
        transactionality:
            'encrypted_settings_audit_and_operation_receipt_atomic_then_process_environment_apply',
    }),
    'market.sync_copper_price': defineBusinessCapability({
        capabilityId: 'market.sync_copper_price',
        recordsBusinessChange: false,
        domain: 'cost',
        operation: 'maintenance',
        inputSchema: 'POST /api/copper-price/update',
        outputSchema: 'CommandReceipt<CopperPriceSyncResult>',
        sourceOfTruth: 'dailyMarketSnapshot+coils.copper_base+coils.cost',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'persistent_BJT_daily_attempt_and_single_flight_snapshot',
        transactionality:
            'daily_cache_maintenance_then_atomic_coil_audit_and_operation_commit',
        timeoutMs: 25_000,
    }),
    'market.sync_indicators': defineBusinessCapability({
        capabilityId: 'market.sync_indicators',
        recordsBusinessChange: false,
        domain: 'cost',
        operation: 'maintenance',
        inputSchema: 'POST /api/market-indicators/update',
        outputSchema: 'CommandReceipt<MarketIndicatorSyncResult>',
        sourceOfTruth:
            'dailyMarketSnapshot+coils+system_settings',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'persistent_BJT_daily_attempt_and_single_flight_snapshot',
        transactionality:
            'daily_cache_maintenance_then_atomic_coils_settings_audit_and_operation_commit',
        timeoutMs: 25_000,
    }),
    'orders.requirements.save_draft': defineBusinessCapability({
        capabilityId: 'orders.requirements.save_draft',
        domain: 'order',
        inputSchema: 'PUT /api/orders/:id/requirements/draft',
        outputSchema: 'CommandReceipt<OrderRequirementSummary>',
        sourceOfTruth:
            'orders+order_requirement_summaries+linked_customer_requirement_files',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'orders.requirements.confirm': defineBusinessCapability({
        capabilityId: 'orders.requirements.confirm',
        domain: 'knowledge',
        inputSchema: 'POST /api/orders/:id/requirements/confirm',
        outputSchema: 'CommandReceipt<OrderRequirementSummary>',
        sourceOfTruth:
            'order_requirement_summaries.confirmed_snapshot+knowledgeSync',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'orders.requirements.revoke': defineBusinessCapability({
        capabilityId: 'orders.requirements.revoke',
        domain: 'knowledge',
        inputSchema: 'POST /api/orders/:id/requirements/revoke',
        outputSchema: 'CommandReceipt<OrderRequirementSummary>',
        sourceOfTruth:
            'order_requirement_summaries.confirmed_snapshot+knowledgeSync',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'orders.execution_records.create_draft': defineBusinessCapability({
        capabilityId: 'orders.execution_records.create_draft',
        domain: 'order',
        inputSchema: 'POST /api/orders/:id/execution-records',
        outputSchema: 'CommandReceipt<OrderExecutionRecord>',
        sourceOfTruth:
            'orders+order_execution_records+linked_execution_evidence_files',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'not_applicable',
    }),
    'orders.execution_records.update_draft': defineBusinessCapability({
        capabilityId: 'orders.execution_records.update_draft',
        domain: 'order',
        inputSchema: 'PUT /api/orders/:id/execution-records/:recordId/draft',
        outputSchema: 'CommandReceipt<OrderExecutionRecord>',
        sourceOfTruth:
            'order_execution_records+linked_execution_evidence_files',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'orders.execution_records.confirm': defineBusinessCapability({
        capabilityId: 'orders.execution_records.confirm',
        domain: 'knowledge',
        inputSchema: 'POST /api/orders/:id/execution-records/:recordId/confirm',
        outputSchema: 'CommandReceipt<OrderExecutionRecord>',
        sourceOfTruth:
            'order_execution_records.confirmed_snapshot+knowledgeSync',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'orders.execution_records.revoke': defineBusinessCapability({
        capabilityId: 'orders.execution_records.revoke',
        domain: 'knowledge',
        inputSchema: 'POST /api/orders/:id/execution-records/:recordId/revoke',
        outputSchema: 'CommandReceipt<OrderExecutionRecord>',
        sourceOfTruth:
            'order_execution_records.confirmed_snapshot+knowledgeSync',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'orders.execution_records.delete': defineBusinessCapability({
        capabilityId: 'orders.execution_records.delete',
        domain: 'order',
        inputSchema: 'DELETE /api/orders/:id/execution-records/:recordId',
        outputSchema: 'CommandReceipt<OrderExecutionRecordDeleteResult>',
        sourceOfTruth: 'order_execution_records.confirmation_state',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'parts.list': defineQueryCapability({
        capabilityId: 'parts.list',
        domain: 'catalog',
        inputSchema: 'GET /api/parts?keyword?&category?&supplier?&stockStatus?&limit?&minPrice?&maxPrice?&priceBelow?&priceAbove?&minStock?&maxStock?&stockBelow?&stockAbove?',
        outputSchema: 'Part[]',
        sourceOfTruth: 'parts',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'coils.list': defineQueryCapability({
        capabilityId: 'coils.list',
        domain: 'coil',
        inputSchema: 'GET /api/coils?spec?&sheets?&material?&slotType?&schemeCode?&schemeStatus?&isDefault?&ratedVoltageV?&ratedFrequencyHz?&market?&schemeFamilyCode?',
        outputSchema: 'CoilProfile[]',
        sourceOfTruth: 'coils+stator_variants',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'orders.list': defineQueryCapability({
        capabilityId: 'orders.list',
        domain: 'order',
        inputSchema: 'GET /api/orders?limit?&status?&customerName?&contractNo?',
        outputSchema: 'Order[] with stable PurchaseItem id/identityKey and referencePrice/referencePriceSource(part_catalog|coil_total_cost|none)/purchasePriceRecorded; ambiguous progress continuity returns 409',
        sourceOfTruth: 'orders.saved_ids+currentPurchasePlan+historicalPurchaseNames+parts.model+parts.price+coils.cost',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'orders.revisions.list': defineQueryCapability({
        capabilityId: 'orders.revisions.list',
        domain: 'order',
        inputSchema: 'GET /api/orders/:id/revisions',
        outputSchema: 'OrderRevision[]',
        sourceOfTruth: 'order_revisions',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'internal']),
    }),
    'quotations.list': defineQueryCapability({
        capabilityId: 'quotations.list',
        domain: 'quotation',
        inputSchema: 'GET /api/quotations?status?&customerName?&limit?',
        outputSchema: 'Quotation[]',
        sourceOfTruth: 'customers+quotations',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'quotations.detail': defineQueryCapability({
        capabilityId: 'quotations.detail',
        domain: 'quotation',
        inputSchema: 'GET /api/quotations/:id',
        outputSchema: 'Quotation',
        sourceOfTruth: 'customers+quotations',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'quotations.inquiry_summary': defineQueryCapability({
        capabilityId: 'quotations.inquiry_summary',
        domain: 'quotation',
        inputSchema: 'GET /api/quotations/:id/inquiry-summary',
        outputSchema: 'QuotationInquirySummary',
        sourceOfTruth:
            'quotations+customers+factory_file_links+factory_files+quotation_attachment_summaries',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'internal']),
    }),
    'quotations.inquiry_summary_draft': definePreviewCapability({
        capabilityId: 'quotations.inquiry_summary_draft',
        domain: 'quotation',
        inputSchema: 'POST /api/quotations/inquiry-summary-draft { fileIds[1..4], customerName? }',
        outputSchema: 'QuotationInquirySummaryDraft',
        sourceOfTruth: 'factory_files.original_blob+Kimi API',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'internal']),
        timeoutMs: 120000,
    }),
    'purchasing.overview': defineQueryCapability({
        capabilityId: 'purchasing.overview',
        domain: 'procurement',
        inputSchema: 'GET /api/orders/purchase-overview?limit?&supplier?&pendingOnly?',
        outputSchema: 'PurchaseOverview grouped by typed material identity and purchase configuration (unit, stock conversion, cable length/accessory)',
        sourceOfTruth: 'orders.saved_ids+currentPurchasePlan+parts.model+coils.scheme_name',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'recipes.list': defineQueryCapability({
        capabilityId: 'recipes.list',
        domain: 'recipe',
        inputSchema: 'GET /api/recipes?keyword?&hasTechnicalFiles?',
        outputSchema: 'Recipe[] including technicalFileCount and readonly externalModel preserved by protected rename',
        sourceOfTruth: 'recipes+recipe_technical_files',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'recipes.inventory_status': defineQueryCapability({
        capabilityId: 'recipes.inventory_status',
        domain: 'recipe',
        inputSchema: 'GET /api/recipes/:id/inventory-status',
        outputSchema: 'RecipeInventoryStatus including currentName, snapshotName, referenceStatus and nullable currentStock',
        sourceOfTruth: 'recipes.parts_json.saved_ids+parts+coils',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'internal']),
    }),
    'customers.list': defineQueryCapability({
        capabilityId: 'customers.list',
        domain: 'customer',
        inputSchema: 'GET /api/customers?id?&name?&limit?',
        outputSchema: 'Customer[]',
        sourceOfTruth: 'customers',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'customers.history': defineQueryCapability({
        capabilityId: 'customers.history',
        domain: 'customer',
        inputSchema: 'GET /api/customers/:id/context?keyword?&historyType?&limit?',
        outputSchema: 'CustomerContext',
        sourceOfTruth: 'customers+quotations+orders',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'templates.list': defineQueryCapability({
        capabilityId: 'templates.list',
        domain: 'template',
        inputSchema: 'GET /api/templates?shellModel?&description?&limit?',
        outputSchema: 'PumpShellTemplate[] including configurationPolicyJson',
        sourceOfTruth: 'pump_shell_templates',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'templates.detail': defineQueryCapability({
        capabilityId: 'templates.detail',
        domain: 'template',
        inputSchema: 'GET /api/templates/:id',
        outputSchema: 'PumpShellTemplate including configurationPolicyJson',
        sourceOfTruth: 'pump_shell_templates',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'ai', 'internal']),
    }),
    'quotations.create': defineBusinessCapability({
        capabilityId: 'quotations.create',
        domain: 'quotation',
        inputSchema: 'POST /api/quotations',
        outputSchema: 'CommandReceipt<QuotationCreateResult>',
        sourceOfTruth:
            'recipeConfigurationPolicy+configuredRecipeSnapshot+quotationSaveDraft+costEngine+quotations+factory_files+quotation_attachment_summaries',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/quotations/save-payload-draft',
        concurrencyControl: 'not_applicable',
    }),
    'quotations.update': defineBusinessCapability({
        capabilityId: 'quotations.update',
        domain: 'quotation',
        inputSchema: 'PATCH /api/quotations/:id',
        outputSchema: 'CommandReceipt<QuotationUpdateResult>',
        sourceOfTruth: 'recipeConfigurationPolicy+configuredRecipeSnapshot+quotationSaveDraft+costEngine+quotations',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/quotations/save-payload-draft',
    }),
    'quotations.change_status': defineBusinessCapability({
        capabilityId: 'quotations.change_status',
        domain: 'quotation',
        inputSchema: 'POST /api/quotations/:id/status',
        outputSchema: 'CommandReceipt<QuotationStatusResult>',
        sourceOfTruth: 'quotationStateMachine+quotations',
        riskLevel: 'high',
        supportsPreview: false,
    }),
    'quotations.delete': defineBusinessCapability({
        capabilityId: 'quotations.delete',
        domain: 'quotation',
        inputSchema: 'DELETE /api/quotations/:id',
        outputSchema: 'CommandReceipt<QuotationDeleteResult>',
        sourceOfTruth: 'quotations',
        riskLevel: 'high',
        supportsPreview: false,
    }),
    'quotations.expire_overdue': defineBusinessCapability({
        capabilityId: 'quotations.expire_overdue',
        domain: 'quotation',
        operation: 'maintenance',
        inputSchema: 'INTERNAL quotation-expiry scheduler',
        outputSchema: 'CommandReceipt<QuotationExpiryResult>',
        sourceOfTruth: 'quotations.status+quotations.created_at',
        riskLevel: 'high',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'not_applicable',
        transactionality:
            'quotation_status_audits_and_operation_receipt_atomic',
    }),
    'purchasing.order.item_progress': defineBusinessCapability({
        capabilityId: 'purchasing.order.item_progress',
        domain: 'purchasing',
        inputSchema: 'POST /api/orders/:id/purchase-items/progress',
        outputSchema: 'CommandReceipt<PurchaseItemProgressResult>; ambiguous name-only selection returns 409; preview and apply share inventory identity validation; conflicting typed IDs and declared catalog supplier drift are rejected',
        sourceOfTruth: 'orderPurchasePlan+parts.stock+coils.stock',
        riskLevel: 'critical',
        supportsPreview: true,
        previewPath: '/api/orders/:id/purchase-items/progress-draft',
    }),
    'purchasing.task.batch_order': defineBusinessCapability({
        capabilityId: 'purchasing.task.batch_order',
        domain: 'purchasing',
        inputSchema: 'POST /api/orders/purchase-items/batch ({ identityKey?, model, supplier?, purchased } | { supplier, purchased, tasks[1..50] })',
        outputSchema: 'CommandReceipt<PurchaseBatchOrderResult> with task/items/order preview details; name-only tasks must resolve one material/configuration across orders',
        sourceOfTruth: 'activeOrderPurchasePlans',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/orders/purchase-items/batch-draft',
        concurrencyControl: 'expectedVersions',
    }),
    'purchasing.order.complete_inbound': defineBusinessCapability({
        capabilityId: 'purchasing.order.complete_inbound',
        domain: 'purchasing',
        inputSchema: 'POST /api/orders/:id/complete-purchase',
        outputSchema: 'CommandReceipt<CompletePurchaseResult>; preview and apply share typed inventory target, declared catalog supplier and unit validation',
        sourceOfTruth: 'orderPurchasePlan+parts.stock+coils.stock',
        riskLevel: 'critical',
        supportsPreview: true,
        previewPath: '/api/orders/:id/complete-purchase-draft',
    }),
    'orders.create': defineBusinessCapability({
        capabilityId: 'orders.create',
        domain: 'order',
        inputSchema: 'POST /api/orders',
        outputSchema: 'CommandReceipt<OrderCreateResult>',
        sourceOfTruth: 'recipeConfigurationPolicy+configuredRecipeSnapshot+costEngine+recipes.savedCost+inventory+orderSaveDraft+orders',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/orders/save-payload-draft',
        concurrencyControl: 'not_applicable',
    }),
    'orders.change_status': defineBusinessCapability({
        capabilityId: 'orders.change_status',
        domain: 'order',
        inputSchema: 'POST /api/orders/:id/status',
        outputSchema: 'CommandReceipt<OrderStatusResult>',
        sourceOfTruth: 'orderWorkflow+activeOrderPurchasePlans+orderInventoryDisposition+parts.stock+coils.stock',
        riskLevel: 'critical',
        supportsPreview: true,
        previewPath: '/api/orders/:id/status-draft',
        concurrencyControl: 'expectedUpdatedAt+previewHash_bound_inventory',
    }),
    'orders.execute_readiness_action': defineBusinessCapability({
        capabilityId: 'orders.execute_readiness_action',
        domain: 'order',
        inputSchema: 'POST /api/orders/:id/readiness-actions/:actionId',
        outputSchema: 'CommandReceipt<OrderReadinessActionResult>',
        sourceOfTruth: 'orderReadinessPlan+activeOrderPurchasePlans+orders',
        riskLevel: 'critical',
        supportsPreview: true,
        previewPath: '/api/orders/:id/readiness-plan',
        concurrencyControl: 'expectedUpdatedAt+previewHash_bound_live_readiness',
    }),
    'orders.todos.toggle': defineBusinessCapability({
        capabilityId: 'orders.todos.toggle',
        domain: 'order',
        inputSchema: 'POST /api/orders/:id/todos/toggle',
        outputSchema: 'CommandReceipt<OrderTodoToggleResult>',
        sourceOfTruth: 'orders.todos_json',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'orders.update_draft': defineBusinessCapability({
        capabilityId: 'orders.update_draft',
        domain: 'order',
        inputSchema: 'PATCH /api/orders/:id with editReason',
        outputSchema: 'CommandReceipt<OrderUpdateResult>',
        sourceOfTruth: 'recipeConfigurationPolicy+configuredRecipeSnapshot+costEngine+orderSaveDraft+orders+order_revisions',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/orders/save-payload-draft',
    }),
    'orders.delete': defineBusinessCapability({
        capabilityId: 'orders.delete',
        domain: 'order',
        inputSchema: 'DELETE /api/orders/:id',
        outputSchema: 'CommandReceipt<OrderDeleteResult>',
        sourceOfTruth: 'orders',
        riskLevel: 'high',
        supportsPreview: false,
    }),
    'recipes.create': defineBusinessCapability({
        capabilityId: 'recipes.create',
        domain: 'recipe',
        inputSchema: 'POST /api/recipes RecipeInput(naming required, externalModel optional)',
        outputSchema: 'CommandReceipt<RecipeCreateResult>',
        sourceOfTruth: 'recipeConfigurationPolicy+recipeBomEngine+costEngine+stablePartIdentity+recipes',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/recipes/save-payload-draft',
        concurrencyControl: 'not_applicable',
    }),
    'recipes.update': defineBusinessCapability({
        capabilityId: 'recipes.update',
        domain: 'recipe',
        inputSchema: 'PATCH /api/recipes/:id',
        outputSchema: 'CommandReceipt<RecipeUpdateResult>',
        sourceOfTruth: 'recipeConfigurationPolicy+recipeBomEngine+costEngine+stablePartIdentity+recipes',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/recipes/save-payload-draft',
    }),
    'recipes.delete': defineBusinessCapability({
        capabilityId: 'recipes.delete',
        domain: 'recipe',
        inputSchema: 'DELETE /api/recipes/:id',
        outputSchema: 'CommandReceipt<RecipeDeleteResult>',
        sourceOfTruth: 'recipes+factoryRuleLearning',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/recipes/:id/delete-preview',
        concurrencyControl: 'expectedUpdatedAt+confirmationToken_bound_delete_preview',
    }),
    'recipes.technical_files.upload': defineBusinessCapability({
        capabilityId: 'recipes.technical_files.upload',
        domain: 'recipe',
        inputSchema: 'POST /api/recipes/:id/technical-files',
        outputSchema: 'CommandReceipt<RecipeTechnicalFileUploadResult>',
        sourceOfTruth: 'factory_files+recipe_technical_files',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        timeoutMs: 30_000,
    }),
    'recipes.technical_files.delete': defineBusinessCapability({
        capabilityId: 'recipes.technical_files.delete',
        domain: 'recipe',
        inputSchema: 'DELETE /api/recipes/:id/technical-files/:fileId',
        outputSchema: 'CommandReceipt<RecipeTechnicalFileDeleteResult>',
        sourceOfTruth: 'recipe_technical_files',
        riskLevel: 'medium',
        supportsPreview: false,
    }),
    'drawings.rotor.save_parameters': defineBusinessCapability({
        capabilityId: 'drawings.rotor.save_parameters',
        domain: 'drawing',
        inputSchema: 'POST /api/rotor/save',
        outputSchema: 'CommandReceipt<RotorParameterSaveResult>',
        sourceOfTruth: 'rotorParameters+rotor_drawings',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'not_applicable',
    }),
    'drawings.rotor.rename_history': defineBusinessCapability({
        capabilityId: 'drawings.rotor.rename_history',
        domain: 'drawing',
        inputSchema: 'PATCH /api/rotor/history/:id/name',
        outputSchema: 'CommandReceipt<RotorHistoryRenameResult>',
        sourceOfTruth: 'rotor_drawings',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'drawings.rotor.link_history': defineBusinessCapability({
        capabilityId: 'drawings.rotor.link_history',
        domain: 'drawing',
        inputSchema: 'PATCH /api/rotor/history/:id/link',
        outputSchema: 'CommandReceipt<RotorHistoryLinkResult>',
        sourceOfTruth: 'rotor_drawings',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
    }),
    'drawings.rotor.delete_history': defineBusinessCapability({
        capabilityId: 'drawings.rotor.delete_history',
        domain: 'drawing',
        inputSchema: 'DELETE /api/rotor/history/:id',
        outputSchema: 'CommandReceipt<RotorHistoryDeleteResult>',
        sourceOfTruth: 'rotor_drawings+public/drawings',
        riskLevel: 'medium',
        supportsPreview: false,
        transactionality: 'business_delete_audit_and_operation_receipt_atomic_then_idempotent_file_cleanup',
    }),
    'drawings.rotor.generate_pdf': defineBusinessCapability({
        capabilityId: 'drawings.rotor.generate_pdf',
        completionMode: 'accepted_async',
        recordsBusinessChange: false,
        domain: 'drawing',
        inputSchema: 'POST /api/rotor/draw',
        outputSchema: 'ExternalCommandReceipt<RotorDrawingJob>; preview=RotorDrawPreview<StructuredSafetyWarnings>',
        sourceOfTruth: 'rotorParameters+rotor_drawings+FreeCAD',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/rotor/draw-preview',
        concurrencyControl: 'confirmationToken_bound_input',
        transactionality: 'operation_and_queued_record_atomic_before_external_side_effect',
        timeoutMs: 180_000,
    }),
    'drawings.rotor.print_pdf': defineBusinessCapability({
        capabilityId: 'drawings.rotor.print_pdf',
        recordsBusinessChange: false,
        domain: 'drawing',
        inputSchema: 'POST /api/rotor/print/:jobId',
        outputSchema: 'ExternalCommandReceipt<RotorPrintResult>',
        sourceOfTruth: 'rotor_drawings+public/drawings+defaultPrinter',
        riskLevel: 'critical',
        supportsPreview: true,
        previewPath: '/api/rotor/print/:jobId/preview',
        concurrencyControl: 'confirmationToken_bound_resource',
        transactionality: 'operation_and_audit_recorded_before_external_side_effect',
        timeoutMs: 45_000,
    }),
    'knowledge.sync_derived': defineBusinessCapability({
        capabilityId: 'knowledge.sync_derived',
        recordsBusinessChange: false,
        domain: 'knowledge',
        inputSchema: 'POST /api/knowledge/sync',
        outputSchema: 'CommandReceipt<KnowledgeSyncResult>',
        sourceOfTruth: 'formalBusinessTables+knowledge_entries+knowledge_sync_runs',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/knowledge/sync-preview',
        concurrencyControl: 'confirmationToken_bound_snapshot',
        transactionality: 'derived_entries_sync_run_audit_and_operation_receipt_atomic',
        timeoutMs: 60_000,
    }),
    'knowledge.documents.upload': defineBusinessCapability({
        capabilityId: 'knowledge.documents.upload',
        domain: 'knowledge',
        inputSchema: 'POST /api/knowledge/documents',
        outputSchema: 'CommandReceipt<KnowledgeDocumentUploadResult>',
        sourceOfTruth: 'factory_files+knowledge_documents',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'not_applicable',
        transactionality: 'file_document_audit_and_operation_receipt_atomic',
        timeoutMs: 30_000,
    }),
    'knowledge.documents.delete': defineBusinessCapability({
        capabilityId: 'knowledge.documents.delete',
        domain: 'knowledge',
        inputSchema: 'DELETE /api/knowledge/documents/:id',
        outputSchema: 'CommandReceipt<KnowledgeDocumentDeleteResult>',
        sourceOfTruth: 'knowledge_documents',
        riskLevel: 'medium',
        supportsPreview: false,
        transactionality: 'document_delete_audit_and_operation_receipt_atomic',
    }),
    'files.upload': defineBusinessCapability({
        capabilityId: 'files.upload',
        domain: 'file',
        inputSchema: 'POST /api/files multipart/form-data',
        outputSchema: 'CommandReceipt<FactoryFileUploadResult>',
        sourceOfTruth: 'validated_file_bytes+factory_files',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'content_sha256_deduplication',
        transactionality:
            'file_blob_audit_and_operation_receipt_atomic_then_optional_parse',
        timeoutMs: 60_000,
    }),
    'files.upload_business_attachment': defineBusinessCapability({
        capabilityId: 'files.upload_business_attachment',
        domain: 'file',
        inputSchema: 'POST /api/files/business-attachment multipart/form-data',
        outputSchema: 'CommandReceipt<FactoryFileBusinessAttachmentUploadResult>',
        sourceOfTruth: 'validated_file_bytes+factory_files+factory_file_links',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/files/business-attachment-preview',
        concurrencyControl: 'confirmationToken_bound_file_hash_and_target_version',
        transactionality: 'file_link_audits_and_operation_receipt_atomic_then_optional_parse',
        timeoutMs: 60_000,
    }),
    'files.parse': defineBusinessCapability({
        capabilityId: 'files.parse',
        recordsBusinessChange: false,
        domain: 'file',
        operation: 'maintenance',
        inputSchema: 'POST /api/files/:id/parse',
        outputSchema: 'CommandReceipt<FactoryFileParseResult>',
        sourceOfTruth: 'factory_files.file_blob+localParsersAndOcr',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'expectedUpdatedAt+parser_status_lock',
        transactionality:
            'processing_state_audit_and_operation_accept_atomic_then_parser_result_audited',
        timeoutMs: 120_000,
    }),
    'files.delete': defineBusinessCapability({
        capabilityId: 'files.delete',
        domain: 'file',
        inputSchema: 'DELETE /api/files/:id',
        outputSchema: 'CommandReceipt<FactoryFileDeleteResult>',
        sourceOfTruth:
            'factory_files+knowledge_recipe_business_and_conversation_references',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality: 'reference_check_soft_delete_audit_and_operation_receipt_atomic',
    }),
    'ai.conversations.create': defineBusinessCapability({
        capabilityId: 'ai.conversations.create',
        recordsBusinessChange: false,
        domain: 'ai',
        inputSchema: 'POST /api/ai/conversations',
        outputSchema: 'CommandReceipt<AiConversation>',
        sourceOfTruth: 'ai_conversations',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'not_applicable',
        transactionality: 'conversation_audit_and_operation_receipt_atomic',
    }),
    'ai.conversations.messages.append': defineBusinessCapability({
        capabilityId: 'ai.conversations.messages.append',
        recordsBusinessChange: false,
        domain: 'ai',
        inputSchema: 'POST /api/ai/conversations/:id/messages',
        outputSchema: 'CommandReceipt<AiConversationMessage>',
        sourceOfTruth: 'ai_conversations+ai_conversation_messages+factory_files',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality:
            'message_conversation_summary_audits_and_operation_receipt_atomic',
    }),
    'ai.conversations.messages.update_metadata': defineBusinessCapability({
        capabilityId: 'ai.conversations.messages.update_metadata',
        recordsBusinessChange: false,
        domain: 'ai',
        inputSchema: 'PATCH /api/ai/conversations/:id/messages/:messageId',
        outputSchema: 'CommandReceipt<AiConversationMessage>',
        sourceOfTruth: 'ai_conversation_messages',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality: 'message_metadata_audit_and_operation_receipt_atomic',
    }),
    'ai.conversations.delete': defineBusinessCapability({
        capabilityId: 'ai.conversations.delete',
        recordsBusinessChange: false,
        domain: 'ai',
        inputSchema: 'DELETE /api/ai/conversations/:id',
        outputSchema: 'CommandReceipt<AiConversationDeleteResult>',
        sourceOfTruth: 'ai_conversations',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality: 'conversation_soft_delete_audit_and_operation_receipt_atomic',
    }),
    'ai.conversations.batch_delete': defineBusinessCapability({
        capabilityId: 'ai.conversations.batch_delete',
        recordsBusinessChange: false,
        domain: 'ai',
        inputSchema: 'POST /api/ai/conversations/batch-delete',
        outputSchema: 'CommandReceipt<AiConversationBatchDeleteResult>',
        sourceOfTruth: 'ai_conversations',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality: 'selected_conversations_soft_delete_audits_and_operation_receipt_atomic',
    }),
    'ai.health.read': defineQueryCapability({
        capabilityId: 'ai.health.read',
        domain: 'ai',
        inputSchema: 'GET /api/ai/health',
        outputSchema: 'AiHealthSnapshot',
        sourceOfTruth:
            'current_provider_configuration+bounded_process_telemetry+ai_evaluation_runs',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'internal']),
    }),
    'ai.tool_confirmation.repreview': definePreviewCapability({
        capabilityId: 'ai.tool_confirmation.repreview',
        domain: 'ai',
        inputSchema: 'POST /api/ai/confirm-tool/preview { confirmationToken, toolName, args }',
        outputSchema: 'AiToolResult<EditableConfirmationPreview>',
        sourceOfTruth: 'pending_ai_confirmation+AI_TOOLS_input_schema+formal_write_preflight',
        riskLevel: 'low',
        callers: Object.freeze(['web']),
    }),
    'ai.evaluations.runs.start': defineBusinessCapability({
        capabilityId: 'ai.evaluations.runs.start',
        recordsBusinessChange: false,
        domain: 'ai',
        operation: 'maintenance',
        inputSchema:
            'POST /api/ai/evaluations/runs { scope?: manual (login)|release (internal), caseKey?: string (manual only) }',
        outputSchema: 'CommandReceipt<AiEvaluationRunStartResult>',
        sourceOfTruth:
            'approved_ai_evaluation_cases+ai_evaluation_runs',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'not_applicable',
        transactionality:
            'superseded_run_new_run_audits_and_operation_receipt_atomic',
    }),
    'ai.evaluations.results.record': defineBusinessCapability({
        capabilityId: 'ai.evaluations.results.record',
        recordsBusinessChange: false,
        domain: 'ai',
        operation: 'maintenance',
        inputSchema: 'POST /api/ai/evaluations/runs/:id/results',
        outputSchema: 'CommandReceipt<AiEvaluationResult>',
        sourceOfTruth:
            'live_business_reads+ai_evaluation_cases+ai_evaluation_results',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'expectedUpdatedAt+run_case_unique',
        transactionality:
            'evaluation_result_audit_and_operation_receipt_atomic',
    }),
    'ai.evaluations.runs.complete': defineBusinessCapability({
        capabilityId: 'ai.evaluations.runs.complete',
        recordsBusinessChange: false,
        domain: 'ai',
        operation: 'maintenance',
        inputSchema: 'POST /api/ai/evaluations/runs/:id/complete',
        outputSchema: 'CommandReceipt<AiEvaluationRun>',
        sourceOfTruth:
            'ai_evaluation_runs+ai_evaluation_results',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality:
            'evaluation_summary_audit_and_operation_receipt_atomic',
    }),
    'ai.evaluations.cases.review': defineBusinessCapability({
        capabilityId: 'ai.evaluations.cases.review',
        recordsBusinessChange: false,
        domain: 'ai',
        operation: 'maintenance',
        inputSchema: 'PATCH /api/ai/evaluations/cases/:id',
        outputSchema: 'CommandReceipt<AiEvaluationCase>',
        sourceOfTruth:
            'ai_evaluation_cases+factory_ai_rules',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality:
            'evaluation_case_review_audit_and_operation_receipt_atomic',
    }),
    'ai.evaluations.system_cases.configure': defineBusinessCapability({
        capabilityId: 'ai.evaluations.system_cases.configure',
        recordsBusinessChange: false,
        domain: 'ai',
        operation: 'maintenance',
        inputSchema:
            'PATCH /api/ai/evaluations/system-cases/:id { enabled, expectedUpdatedAt? }',
        outputSchema: 'CommandReceipt<AiEvaluationCase>',
        sourceOfTruth: 'ai_evaluation_cases.enabled',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality:
            'system_evaluation_case_configuration_audit_and_operation_receipt_atomic',
    }),
    'ai.personal_memory.list': defineQueryCapability({
        capabilityId: 'ai.personal_memory.list', domain: 'ai',
        inputSchema: 'GET /api/ai/personal-memories?afterId?&limit?',
        outputSchema: 'PersonalMemoryPage { items, hasMore, nextAfterId }',
        sourceOfTruth: 'ai_personal_memories', riskLevel: 'low',
        callers: Object.freeze(['web', 'internal']),
    }),
    'ai.personal_memory.change': defineBusinessCapability({
        capabilityId: 'ai.personal_memory.change', recordsBusinessChange: false, domain: 'ai',
        operation: 'command',
        inputSchema: 'POST /api/ai/personal-memories/change { action, id?, content?, expectedVersion?, idempotencyKey? }',
        outputSchema: 'CommandReceipt<PersonalMemory>', sourceOfTruth: 'ai_personal_memories+ai_personal_memory_revisions',
        riskLevel: 'medium', requiresConfirmation: false, supportsPreview: false,
        concurrencyControl: 'expectedVersion_for_mutation',
        transactionality: 'memory_revision_audits_and_operation_atomic',
    }),
    'ai.feedback.list': defineQueryCapability({
        capabilityId: 'ai.feedback.list',
        domain: 'ai',
        inputSchema: 'GET /api/ai/feedback?conversationId?&status?&rating?&limit?',
        outputSchema: 'AiAnswerFeedbackList including conversationDeleted',
        sourceOfTruth:
            'ai_answer_feedback_snapshots+ai_conversations.owner_key_and_deleted_at',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'internal']),
    }),
    'ai.feedback.submit': defineBusinessCapability({
        capabilityId: 'ai.feedback.submit',
        recordsBusinessChange: false,
        domain: 'ai',
        operation: 'maintenance',
        inputSchema: 'POST /api/ai/feedback { messageId, rating, note?, learnFromCorrection?, expectedUpdatedAt? }',
        outputSchema: 'CommandReceipt<AiAnswerFeedback including pending structured learning rule and evaluation candidate>',
        sourceOfTruth:
            'ai_conversation_messages+ai_answer_feedback+structured_factory_ai_rule+manually_reviewed_regression_case',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'expectedUpdatedAt_if_feedback_exists',
        transactionality:
            'feedback_structured_rule_pending_regression_audits_and_operation_receipt_atomic',
    }),
    'ai.feedback.diagnose': defineBusinessCapability({
        capabilityId: 'ai.feedback.diagnose',
        recordsBusinessChange: false,
        domain: 'ai',
        operation: 'maintenance',
        inputSchema: 'POST /api/ai/feedback/:id/diagnose',
        outputSchema: 'CommandReceipt<AiAnswerFeedback>',
        sourceOfTruth:
            'ai_answer_feedback+current_knowledge_sync_state',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality:
            'diagnosis_snapshot_audit_and_operation_receipt_atomic',
    }),
    'ai.feedback.retest': defineBusinessCapability({
        capabilityId: 'ai.feedback.retest',
        recordsBusinessChange: false,
        domain: 'ai',
        operation: 'maintenance',
        inputSchema: 'POST /api/ai/feedback/:id/retest',
        outputSchema: 'CommandReceipt<AiAnswerFeedback>',
        sourceOfTruth:
            'current_ai_answer_tool_evidence+ai_answer_feedback',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality:
            'retest_snapshot_audit_and_operation_receipt_atomic',
    }),
    'ai.feedback.review': defineBusinessCapability({
        capabilityId: 'ai.feedback.review',
        recordsBusinessChange: false,
        domain: 'ai',
        operation: 'maintenance',
        inputSchema: 'PATCH /api/ai/feedback/:id',
        outputSchema: 'CommandReceipt<AiAnswerFeedback>',
        sourceOfTruth: 'ai_answer_feedback',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality:
            'feedback_review_audit_and_operation_receipt_atomic',
    }),
    'ai.learning_rules.list': defineQueryCapability({
        capabilityId: 'ai.learning_rules.list',
        domain: 'ai',
        inputSchema: 'GET /api/ai/learning-rules?status?&effectiveStatus?&domain?&limit?',
        outputSchema: 'FactoryAiRuleList including lifecycle, evaluation, conflict and scope state',
        sourceOfTruth: 'factory_ai_rules+ai_evaluation_cases',
        riskLevel: 'low',
        callers: Object.freeze(['web', 'internal']),
    }),
    'ai.learning_rules.update': defineBusinessCapability({
        capabilityId: 'ai.learning_rules.update',
        recordsBusinessChange: false,
        domain: 'ai',
        operation: 'maintenance',
        inputSchema: 'PATCH /api/ai/learning-rules/:id { status?, title?, triggerText?, instruction?, scopeType?, domains?, objectType?, objectRef?, ruleType?, conflictGroup?, priority?, effectiveFrom?, expiresAt?, expectedUpdatedAt? }',
        outputSchema: 'CommandReceipt<StructuredFactoryAiRule>',
        sourceOfTruth:
            'factory_ai_rules+manually_reviewed_ai_evaluation_cases',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality:
            'versioned_learning_rule_pending_regression_case_audits_and_operation_receipt_atomic',
    }),
    'ai.factory_profile.update': defineBusinessCapability({
        capabilityId: 'ai.factory_profile.update',
        domain: 'ai',
        operation: 'command',
        inputSchema: 'PUT /api/ai/system-prompt',
        outputSchema: 'CommandReceipt<FactoryProfile>',
        sourceOfTruth: 'config.ai-factory-profile',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'expectedVersion_content_sha256',
        transactionality:
            'factory_profile_audit_and_operation_receipt_atomic',
    }),
    'quality.recipe_feedback.save': defineBusinessCapability({
        capabilityId: 'quality.recipe_feedback.save',
        domain: 'quality',
        operation: 'maintenance',
        inputSchema: 'POST /api/quality/recipes/:recipeId/feedback',
        outputSchema: 'CommandReceipt<RecipeAnalysisFeedback>',
        sourceOfTruth:
            'recipes+recipe_analysis_feedback+derived_factory_rule_candidates',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'expectedUpdatedAt_if_feedback_exists',
        transactionality:
            'feedback_candidate_events_knowledge_audits_and_operation_receipt_atomic',
    }),
    'quality.recipe_feedback.resolve': defineBusinessCapability({
        capabilityId: 'quality.recipe_feedback.resolve',
        domain: 'quality',
        operation: 'maintenance',
        inputSchema: 'POST /api/quality/recipe-feedback/:id/resolve',
        outputSchema: 'CommandReceipt<RecipeAnalysisFeedbackResolution>',
        sourceOfTruth:
            'current_recipe_analysis+recipe_analysis_feedback+derived_factory_rule_candidates',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality:
            'feedback_candidate_events_knowledge_audits_and_operation_receipt_atomic',
    }),
    'quality.rule_candidates.refresh': defineBusinessCapability({
        capabilityId: 'quality.rule_candidates.refresh',
        recordsBusinessChange: false,
        domain: 'quality',
        operation: 'maintenance',
        inputSchema: 'POST /api/quality/rule-candidates/refresh',
        outputSchema: 'CommandReceipt<FactoryRuleCandidateRefreshResult>',
        sourceOfTruth:
            'recipe_analysis_feedback+recipes+factory_rule_candidates',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'not_applicable',
        transactionality:
            'candidate_events_knowledge_audits_and_operation_receipt_atomic',
    }),
    'quality.rule_candidates.review': defineBusinessCapability({
        capabilityId: 'quality.rule_candidates.review',
        domain: 'quality',
        operation: 'maintenance',
        inputSchema: 'PATCH /api/quality/rule-candidates/:id',
        outputSchema: 'CommandReceipt<FactoryRuleCandidate>',
        sourceOfTruth:
            'factory_rule_candidates+factory_rule_events+derived_knowledge_entry',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality:
            'candidate_event_knowledge_audits_and_operation_receipt_atomic',
    }),
    'quality.rule_events.restore': defineBusinessCapability({
        capabilityId: 'quality.rule_events.restore',
        domain: 'quality',
        operation: 'maintenance',
        inputSchema: 'POST /api/quality/rule-events/:id/restore',
        outputSchema: 'CommandReceipt<FactoryRuleRestoreResult>',
        sourceOfTruth:
            'factory_rule_events+current_learning_evidence+factory_rule_candidates+derived_knowledge_entry',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        transactionality:
            'candidate_restore_event_knowledge_audits_and_operation_receipt_atomic',
    }),
    'workbench.execution_runs.record': defineBusinessCapability({
        capabilityId: 'workbench.execution_runs.record',
        domain: 'management',
        operation: 'maintenance',
        inputSchema: 'POST /api/workbench/execution-runs',
        outputSchema: 'CommandReceipt<FactoryWorkflowRun>',
        sourceOfTruth:
            'factory_workflow_runs_secondary_execution_evidence',
        riskLevel: 'medium',
        requiresConfirmation: false,
        supportsPreview: false,
        concurrencyControl: 'not_applicable',
        transactionality:
            'workflow_run_retention_audits_and_operation_receipt_atomic',
    }),
    'files.archive': defineBusinessCapability({
        capabilityId: 'files.archive',
        domain: 'file',
        inputSchema: 'POST /api/files/:id/archive',
        outputSchema: 'CommandReceipt<FactoryFileArchiveResult>',
        sourceOfTruth: 'factory_files+factory_file_links+knowledge_documents',
        riskLevel: 'high',
        supportsPreview: true,
        previewPath: '/api/files/:id/archive-preview',
        concurrencyControl: 'confirmationToken_bound_snapshot',
        transactionality: 'document_link_audit_and_operation_receipt_atomic',
        timeoutMs: 30_000,
    }),
    'files.links.delete': defineBusinessCapability({
        capabilityId: 'files.links.delete',
        domain: 'file',
        inputSchema: 'DELETE /api/files/:id/links/:linkId',
        outputSchema: 'CommandReceipt<FactoryFileLinkDeleteResult>',
        sourceOfTruth: 'factory_file_links+confirmed_order_file_references',
        riskLevel: 'medium',
        supportsPreview: false,
        transactionality: 'link_delete_audit_and_operation_receipt_atomic',
    }),
});

function domainsByCapabilityName() {
    const result = new Map();
    for (const [domain, names] of Object.entries(DOMAIN_CAPABILITY_NAMES)) {
        for (const name of names) {
            const domains = result.get(name) || [];
            if (!domains.includes(domain)) domains.push(domain);
            result.set(name, domains);
        }
    }
    return result;
}

function sourceOfTruthFor(name, domains) {
    const overrides = {
        build_recipe_bom_draft: 'recipeBomEngine+saved_template_ids+current_catalog',
        get_recipe_detail: 'recipeServiceAndCostEngine',
        preview_pump_shell_cost: 'recipeBomEngineAndCostEngine',
        get_order_knowledge_package: 'orderService',
        plan_factory_workflow: 'workflowPlanningService',
        execute_factory_workflow_step: 'formalWorkflowApi',
        inspect_quotation_file: 'quotationFileParser',
        build_quotation_draft: 'quotationService',
        build_order_draft: 'orderService',
    };
    if (overrides[name]) return overrides[name];
    if (name === 'adjust_coil_stock') return 'coilInventory';
    if (name === 'generate_rotor_drawing' || name === 'print_rotor_drawing') {
        return 'rotorServiceAndDevice';
    }
    if (domains.includes('cost')) return 'costEngine';
    if (domains.includes('knowledge')) return 'knowledgeIndex';
    if (domains.includes('order')) return 'orderService';
    if (domains.includes('quotation')) return 'quotationService';
    if (domains.includes('recipe')) return 'recipeService';
    if (domains.includes('catalog')) return 'partsService';
    if (domains.includes('coil')) return 'coilService';
    if (domains.includes('quality')) return 'qualityService';
    if (domains.includes('file')) return 'factoryFileService';
    return 'formalApi';
}

function dataModeFor(name) {
    if (LIVE_CAPABILITY_NAMES.has(name)) return 'live';
    if (DERIVED_CAPABILITY_NAMES.has(name)) return 'derived';
    return 'stable';
}

function riskLevelFor(name, access) {
    if (access === 'read') return 'low';
    if (CRITICAL_CAPABILITY_NAMES.has(name)) return 'critical';
    if (MEDIUM_CAPABILITY_NAMES.has(name)) return 'medium';
    return 'high';
}

function timeoutFor(name) {
    if (name === 'generate_rotor_drawing') return 120_000;
    if (name === 'print_rotor_drawing') return 45_000;
    if (name === 'sync_factory_knowledge') return 60_000;
    if (name === 'archive_factory_file') return 30_000;
    return 15_000;
}

function buildRegistry() {
    const registry = {};
    for (const [name, domains] of domainsByCapabilityName()) {
        const access = WRITE_CAPABILITY_NAMES.has(name) ? 'write' : 'read';
        const operation = access === 'write'
            ? 'command'
            : PREVIEW_CAPABILITY_NAMES.has(name)
                ? 'preview'
                : 'query';
        const externalSideEffect = EXTERNAL_SIDE_EFFECT_CAPABILITY_NAMES.has(name);
        const formalCapabilityIds = AI_FORMAL_CAPABILITY_IDS[name] || [];
        const formalCapabilities = formalCapabilityIds
            .map(capabilityId => BUSINESS_CAPABILITY_REGISTRY[capabilityId])
            .filter(Boolean);
        if (access === 'write' && formalCapabilityIds.length === 0) {
            throw new Error(`AI 写能力 ${name} 未关联正式业务能力`);
        }
        if (formalCapabilities.length !== formalCapabilityIds.length) {
            const missing = formalCapabilityIds.filter(
                capabilityId => !BUSINESS_CAPABILITY_REGISTRY[capabilityId]
            );
            throw new Error(`AI 能力 ${name} 关联了未登记正式能力: ${missing.join(', ')}`);
        }
        const primaryFormalCapability = formalCapabilities[0] || null;
        const supportsPreview = PREVIEW_CAPABILITY_NAMES.has(name)
            || formalCapabilities.some(capability => capability.supportsPreview);
        const concurrencyControl = primaryFormalCapability?.concurrencyControl;
        const transactionality = primaryFormalCapability?.transactionality;
        registry[name] = Object.freeze({
            capabilityId: `ai.${name}`,
            toolName: name,
            displayName: AI_CAPABILITY_DISPLAY_NAMES[name] || name,
            executorKey: AI_EXECUTOR_BY_CAPABILITY_NAME[name] || null,
            domain: domains[0],
            domains: Object.freeze([...domains]),
            entityScopes: AI_ENTITY_SCOPES[name] || DEFAULT_AI_ENTITY_SCOPES,
            inputSchema: `AI_TOOLS.${name}.parameters`,
            outputSchema: `executor.${name}.result`,
            access,
            operation,
            completionMode: access === 'read'
                ? 'not_applicable'
                : primaryFormalCapability.completionMode,
            sourceOfTruth: sourceOfTruthFor(name, domains),
            dataMode: dataModeFor(name),
            resultProvenance: LIVE_BUSINESS_EVIDENCE_NAMES.has(name)
                ? Object.freeze({
                    kind: 'live_business',
                    label: '实时业务数据',
                })
                : null,
            knowledgeCompanion: AI_KNOWLEDGE_COMPANIONS[name] || null,
            riskLevel: riskLevelFor(name, access),
            requiresConfirmation: access === 'write',
            mcpExposure: PRIVATE_ASSISTANT_ONLY_CAPABILITY_NAMES.has(name) ? 'private_assistant_only' : 'eligible',
            supportsPreview,
            formalCapabilityIds: Object.freeze([...formalCapabilityIds]),
            formalPreviewPaths: Object.freeze(formalCapabilities
                .map(capability => capability.previewPath)
                .filter(Boolean)),
            idempotency: access === 'read'
                ? 'inherent'
                : primaryFormalCapability.idempotency,
            concurrencyControl: access === 'read'
                ? 'not_applicable'
                : concurrencyControl
                    || (name === 'create_order' || name === 'create_recipe'
                        ? 'not_applicable'
                        : name === 'refresh_factory_rule_candidates'
                            ? 'not_applicable'
                        : name === 'adjust_coil_stock'
                            ? 'confirmationToken_bound_inventory_snapshot'
                        : name === 'archive_factory_file'
                            ? 'confirmationToken_bound_snapshot'
                        : 'expectedUpdatedAt'),
            transactionality: access === 'read'
                ? 'not_applicable'
                : transactionality
                    || (externalSideEffect
                        ? 'external_side_effect_requires_operation_state'
                        : 'business_write_audit_and_operation_receipt_atomic'),
            audit: access === 'read'
                ? 'none'
                : primaryFormalCapability.audit
                    || 'strong_audit_linked_by_operation_request_and_capability',
            timeoutMs: timeoutFor(name),
            deprecated: false,
            contractStatus: 'current',
        });
    }
    return Object.freeze(registry);
}

const AI_CAPABILITY_REGISTRY = buildRegistry();

function getAiCapability(name) {
    return AI_CAPABILITY_REGISTRY[String(name || '')] || null;
}

function getBusinessCapability(capabilityId) {
    return BUSINESS_CAPABILITY_REGISTRY[String(capabilityId || '')] || null;
}

function requireBusinessCapability(capabilityId) {
    const capability = getBusinessCapability(capabilityId);
    if (!capability) {
        throw new Error(`正式业务能力未登记: ${String(capabilityId || '')}`);
    }
    return capability;
}

function listBusinessCapabilities() {
    return Object.values(BUSINESS_CAPABILITY_REGISTRY);
}

function listAiCapabilities() {
    return Object.values(AI_CAPABILITY_REGISTRY);
}

function hasAiKnowledgeCompanionProjection(capabilityName, argumentProjection) {
    return listAiCapabilities().some(capability => (
        capability.knowledgeCompanion?.capabilityName === capabilityName
        && capability.knowledgeCompanion.argumentProjection === argumentProjection
    ));
}

function writeCapabilityNames() {
    return listAiCapabilities()
        .filter(capability => capability.access === 'write')
        .map(capability => capability.toolName);
}

function assertAiToolRegistryComplete(aiTools = []) {
    const toolNames = new Set((Array.isArray(aiTools) ? aiTools : [])
        .map(tool => tool?.function?.name)
        .filter(Boolean));
    const registeredNames = new Set(Object.keys(AI_CAPABILITY_REGISTRY));
    const missing = [...toolNames].filter(name => !registeredNames.has(name));
    const orphaned = [...registeredNames].filter(name => !toolNames.has(name));
    if (missing.length || orphaned.length) {
        throw new Error(
            `AI 能力注册表不完整: missing=[${missing.join(', ')}], orphaned=[${orphaned.join(', ')}]`
        );
    }
    const invalidMetadata = listAiCapabilities()
        .filter(capability => (
            !capability.displayName
            || capability.displayName === capability.toolName
            || !AI_EXECUTOR_CAPABILITY_NAMES[capability.executorKey]
        ))
        .map(capability => capability.toolName);
    if (invalidMetadata.length > 0) {
        throw new Error(`AI 能力注册表执行元数据不完整: [${invalidMetadata.join(', ')}]`);
    }
    return true;
}

module.exports = {
    AI_CAPABILITY_REGISTRY,
    BUSINESS_CAPABILITY_REGISTRY,
    DOMAIN_CAPABILITY_NAMES,
    assertAiToolRegistryComplete,
    getAiCapability,
    hasAiKnowledgeCompanionProjection,
    getBusinessCapability,
    listAiCapabilities,
    listBusinessCapabilities,
    requireBusinessCapability,
    writeCapabilityNames,
};
