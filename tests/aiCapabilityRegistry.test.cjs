const test = require('node:test');
const assert = require('node:assert/strict');
const { AI_TOOLS, WRITE_TOOLS } = require('../api/routes/ai/tools.cjs');
const {
    AI_CAPABILITY_REGISTRY,
    BUSINESS_CAPABILITY_REGISTRY,
    assertAiToolRegistryComplete,
    getAiCapability,
    getBusinessCapability,
    listAiCapabilities,
    listBusinessCapabilities,
} = require('../api/capabilities/registry.cjs');
const { executeToolCall } = require('../api/routes/ai/executor.cjs');

test('AI 能力注册表：全部工具唯一登记且具备强制契约字段', () => {
    assert.equal(assertAiToolRegistryComplete(AI_TOOLS), true);
    assert.equal(Object.keys(AI_CAPABILITY_REGISTRY).length, AI_TOOLS.length);
    assert.equal(listAiCapabilities().length, AI_TOOLS.length);

    for (const tool of AI_TOOLS) {
        const name = tool.function.name;
        const capability = getAiCapability(name);
        assert.ok(capability, `${name} 未登记`);
        assert.equal(capability.toolName, name);
        assert.ok(
            typeof capability.displayName === 'string'
                && capability.displayName.trim()
                && capability.displayName !== name,
            `${name} 缺少面向用户的统一 displayName`
        );
        assert.ok(
            ['cost', 'query', 'order', 'recipe', 'business'].includes(capability.executorKey),
            `${name} 缺少有效 executorKey`
        );
        if (capability.resultProvenance) {
            assert.equal(capability.resultProvenance.kind, 'live_business');
            assert.equal(capability.resultProvenance.label, '实时业务数据');
        }
        assert.match(capability.capabilityId, /^ai\.[a-z0-9_]+$/);
        assert.equal(capability.domain, capability.domains[0]);
        assert.ok(capability.domains.length > 0);
        assert.ok(Array.isArray(capability.entityScopes));
        assert.ok(capability.entityScopes.length > 0);
        assert.ok(capability.entityScopes.every(scope => (
            ['single', 'collection', 'global'].includes(scope)
        )));
        assert.ok(['read', 'write'].includes(capability.access));
        assert.ok(['query', 'command', 'preview'].includes(capability.operation));
        assert.ok(['low', 'medium', 'high', 'critical'].includes(capability.riskLevel));
        assert.ok(capability.sourceOfTruth);
        assert.ok(capability.inputSchema);
        assert.ok(capability.outputSchema);
        assert.ok(capability.idempotency);
        assert.ok(capability.concurrencyControl);
        assert.ok(capability.transactionality);
        assert.ok(capability.audit);
        assert.ok(Number.isFinite(capability.timeoutMs) && capability.timeoutMs > 0);
        assert.equal(WRITE_TOOLS.has(name), capability.access === 'write');
        assert.equal(capability.requiresConfirmation, capability.access === 'write');
    }
});

test('AI 工具目录：人类可读 schema 使用规范业务术语且保留稳定字段名', () => {
    const tool = name => AI_TOOLS.find(item => item.function.name === name)?.function;
    const createPart = tool('create_part');
    const updatePart = tool('update_part');
    const updateOrderItem = tool('update_order_item');
    const createRecipe = tool('create_recipe');
    const updateRecipe = tool('update_recipe');
    const searchFileTargets = tool('search_factory_file_archive_targets');

    assert.match(createPart.parameters.properties.price.description, /目录成本价/);
    assert.match(updatePart.parameters.properties.price.description, /目录成本价/);
    assert.match(updateOrderItem.parameters.properties.unitPrice.description, /销售单价/);
    assert.match(createRecipe.parameters.properties.name.description, /成品型号/);
    assert.match(createRecipe.parameters.properties.spec.description, /配置摘要/);
    assert.match(updateRecipe.parameters.properties.newName.description, /新成品型号/);
    assert.match(updateRecipe.parameters.properties.newSpec.description, /新配置摘要/);
    assert.match(searchFileTargets.description, /可关联的真实业务资料对象/);
    assert.doesNotMatch(searchFileTargets.description, /可归档的真实业务对象|归档前/);

    assert.ok(Object.hasOwn(createPart.parameters.properties, 'price'));
    assert.ok(Object.hasOwn(updateOrderItem.parameters.properties, 'unitPrice'));
    assert.ok(Object.hasOwn(createRecipe.parameters.properties, 'name'));
    assert.ok(Object.hasOwn(createRecipe.parameters.properties, 'spec'));
});

test('AI 能力注册表：每个写工具必须关联已登记的正式业务能力', () => {
    const writeCapabilities = listAiCapabilities()
        .filter(capability => capability.access === 'write');

    assert.equal(writeCapabilities.length, WRITE_TOOLS.size);
    for (const capability of writeCapabilities) {
        assert.ok(
            capability.formalCapabilityIds.length > 0,
            `${capability.toolName} 未关联正式业务能力`
        );
        for (const capabilityId of capability.formalCapabilityIds) {
            assert.ok(
                getBusinessCapability(capabilityId),
                `${capability.toolName} 关联了未登记能力 ${capabilityId}`
            );
        }
        assert.match(capability.idempotency, /persistent/);
        assert.equal(capability.contractStatus, 'current');
        assert.notEqual(capability.concurrencyControl, 'not_yet_standardized');
        assert.match(capability.audit, /strong_audit/);
    }
});

test('AI 能力注册表：零件资料与库存使用互斥的正式命令模式', () => {
    const capability = getAiCapability('update_part');

    assert.deepEqual(capability.formalCapabilityIds, ['parts.update']);
    assert.equal(capability.concurrencyControl, 'expectedUpdatedAt');
    assert.equal(capability.transactionality, 'business_write_audit_and_operation_receipt_atomic');
});

test('AI 能力注册表：关联知识能力只指向已登记只读能力', () => {
    for (const capability of listAiCapabilities()) {
        if (!capability.knowledgeCompanion) continue;
        const companion = getAiCapability(capability.knowledgeCompanion.capabilityName);
        assert.ok(companion, `${capability.toolName} 的关联知识能力未登记`);
        assert.equal(companion.access, 'read');
        assert.ok(capability.knowledgeCompanion.argumentProjection);
    }
});

test('AI 能力注册表：当日成本对比工具统一登记实时业务证据', () => {
    for (const name of ['compare_recipes', 'explain_cost_change']) {
        const capability = getAiCapability(name);
        assert.equal(capability.dataMode, 'live', `${name} 未登记为 live`);
        assert.equal(capability.sourceOfTruth, 'costEngine');
        assert.equal(capability.resultProvenance?.kind, 'live_business');
    }
});

test('正式业务能力注册表：已迁移 query 和 command 统一登记完整契约', () => {
    const expectedIds = [
        'business_changes.list',
        'inventory.parts.batch_adjust_stock',
        'inventory.coils.adjust_stock',
        'workflow.quotation.convert_to_order',
        'purchasing.order.item_progress',
        'purchasing.task.batch_order',
        'purchasing.order.complete_inbound',
        'customers.create',
        'customers.update',
        'customers.delete',
        'parts.create',
        'parts.batch_create',
        'parts.batch_delete',
        'parts.update',
        'parts.save_profile',
        'parts.delete',
        'parts.batch_update_prices',
        'coils.create',
        'coils.update',
        'coils.delete',
        'coils.batch_update_unit_price',
        'templates.create',
        'templates.update',
        'templates.delete',
        'model_variants.create',
        'model_variants.update',
        'model_variants.delete',
        'settings.update_business_value',
        'settings.update_runtime',
        'market.sync_copper_price',
        'market.sync_indicators',
        'parts.list',
        'coils.list',
        'orders.list',
        'orders.revisions.list',
        'purchasing.overview',
        'recipes.list',
        'customers.list',
        'customers.history',
        'templates.list',
        'templates.detail',
        'quotations.list',
        'quotations.detail',
        'quotations.inquiry_summary',
        'quotations.inquiry_summary_draft',
        'quotations.create',
        'quotations.update',
        'quotations.change_status',
        'quotations.delete',
        'quotations.expire_overdue',
        'orders.create',
        'orders.change_status',
        'orders.execute_readiness_action',
        'orders.requirements.save_draft',
        'orders.requirements.confirm',
        'orders.requirements.revoke',
        'orders.execution_records.create_draft',
        'orders.execution_records.update_draft',
        'orders.execution_records.confirm',
        'orders.execution_records.revoke',
        'orders.execution_records.delete',
        'orders.todos.toggle',
        'orders.update_draft',
        'orders.delete',
        'recipes.create',
        'recipes.update',
        'recipes.delete',
        'recipes.technical_files.upload',
        'recipes.technical_files.delete',
        'drawings.rotor.save_parameters',
        'drawings.rotor.rename_history',
        'drawings.rotor.link_history',
        'drawings.rotor.delete_history',
        'drawings.rotor.generate_pdf',
        'drawings.rotor.print_pdf',
        'knowledge.sync_derived',
        'knowledge.documents.upload',
        'knowledge.documents.delete',
        'files.upload',
        'files.upload_business_attachment',
        'files.parse',
        'files.delete',
        'ai.conversations.create',
        'ai.conversations.messages.append',
        'ai.conversations.messages.update_metadata',
        'ai.conversations.delete',
        'ai.health.read',
        'ai.evaluations.runs.start',
        'ai.evaluations.results.record',
        'ai.evaluations.runs.complete',
        'ai.evaluations.cases.review',
        'ai.evaluations.system_cases.configure',
        'ai.feedback.list',
        'ai.feedback.submit',
        'ai.feedback.diagnose',
        'ai.feedback.retest',
        'ai.feedback.review',
        'ai.learning_rules.list',
        'ai.learning_rules.update',
        'ai.factory_profile.update',
        'quality.recipe_feedback.save',
        'quality.recipe_feedback.resolve',
        'quality.rule_candidates.refresh',
        'quality.rule_candidates.review',
        'quality.rule_events.restore',
        'files.archive',
        'files.links.delete',
        'workbench.execution_runs.record',
    ];
    assert.deepEqual(
        Object.keys(BUSINESS_CAPABILITY_REGISTRY).sort(),
        expectedIds.sort()
    );
    assert.equal(listBusinessCapabilities().length, expectedIds.length);
    for (const capabilityId of expectedIds) {
        const capability = getBusinessCapability(capabilityId);
        assert.ok(capability);
        assert.equal(capability.capabilityId, capabilityId);
        if (capability.access === 'query') {
            assert.equal(capability.operation, 'query');
            assert.equal(capability.requiresConfirmation, false);
            assert.equal(capability.riskLevel, 'low');
            assert.match(capability.inputSchema, /^GET \/api\//);
            assert.ok(capability.outputSchema);
            assert.ok(capability.sourceOfTruth);
            continue;
        }
        if (capability.access === 'preview') {
            assert.equal(capability.operation, 'preview');
            assert.equal(capability.requiresConfirmation, false);
            assert.equal(capability.riskLevel, 'low');
            assert.match(capability.inputSchema, /^POST \/api\//);
            assert.ok(capability.outputSchema);
            assert.ok(capability.sourceOfTruth);
            assert.equal(capability.idempotency, 'inherent');
            assert.equal(capability.transactionality, 'not_applicable');
            assert.equal(capability.audit, 'none');
            continue;
        }
        assert.equal(capability.access, 'write');
        assert.ok(
            ['command', 'maintenance'].includes(capability.operation)
        );
        assert.ok(['medium', 'high', 'critical'].includes(capability.riskLevel));
        assert.equal(typeof capability.requiresConfirmation, 'boolean');
        assert.match(
            capability.inputSchema,
            /^(?:(?:POST|PUT|PATCH|DELETE) \/api\/|INTERNAL )/
        );
        assert.match(capability.outputSchema, /^(?:External)?CommandReceipt</);
        assert.ok(['completed', 'accepted_async'].includes(capability.completionMode));
        assert.ok(capability.sourceOfTruth);
        assert.match(capability.idempotency, /persistent/);
        assert.ok([
            'not_applicable',
            'expectedUpdatedAt',
            'expectedUpdatedAt+previewHash_bound_live_readiness',
            'expectedVersions',
            'confirmationToken_bound_input',
            'confirmationToken_bound_resource',
            'confirmationToken_bound_snapshot',
            'confirmationToken_bound_absence_snapshot',
            'confirmationToken_bound_inventory_snapshot',
            'expectedUpdatedAt+confirmationToken_bound_delete_preview',
            'confirmationToken_bound_expectedVersions',
            'confirmationToken_bound_part_and_setting_versions',
            'confirmationToken_bound_file_hash_and_target_version',
            'external_snapshot_at_execution_time',
            'content_sha256_deduplication',
            'expectedUpdatedAt+parser_status_lock',
            'expectedUpdatedAt+run_case_unique',
            'expectedUpdatedAt_if_feedback_exists',
            'expectedVersion_content_sha256',
        ].includes(capability.concurrencyControl));
        assert.match(capability.transactionality, /operation|external/);
        assert.match(capability.audit, /strong_audit/);
        assert.ok(Number.isFinite(capability.timeoutMs) && capability.timeoutMs > 0);
        assert.equal(capability.deprecated, false);
        assert.equal(capability.contractStatus, 'current');
        if (capability.supportsPreview) {
            assert.match(capability.previewPath, /^\/api\//);
        }
    }
});

test('报价查询工具关联正式只读能力', () => {
    const aiCapability = getAiCapability('search_quotations');
    const formalCapability = getBusinessCapability('quotations.list');

    assert.deepEqual(aiCapability.formalCapabilityIds, ['quotations.list']);
    assert.equal(aiCapability.access, 'read');
    assert.equal(formalCapability.access, 'query');
    assert.equal(formalCapability.inputSchema, 'GET /api/quotations?status?&customerName?&limit?');
    assert.equal(formalCapability.sourceOfTruth, 'customers+quotations');
});

test('全部核心列表工具都映射正式只读能力而不是依赖模型自行筛选', () => {
    const expected = {
        search_parts: ['parts.list'],
        search_coils: ['coils.list'],
        get_recent_orders: ['orders.list'],
        search_quotations: ['quotations.list'],
        get_purchase_overview: ['purchasing.overview'],
        get_all_recipes: ['recipes.list'],
        search_customers: ['customers.list'],
        search_templates: ['templates.list'],
        search_customer_history: ['customers.list', 'customers.history'],
    };

    for (const [toolName, capabilityIds] of Object.entries(expected)) {
        const capability = getAiCapability(toolName);
        assert.deepEqual(capability.formalCapabilityIds, capabilityIds, toolName);
        assert.equal(capability.access, 'read', toolName);
        for (const capabilityId of capabilityIds) {
            assert.equal(getBusinessCapability(capabilityId).access, 'query', capabilityId);
        }
    }
});

test('线圈列表能力登记完整线圈档案输出而不是库存窄视图', () => {
    const formalCapability = getBusinessCapability('coils.list');
    const aiCapability = getAiCapability('search_coils');

    assert.equal(formalCapability.outputSchema, 'CoilProfile[]');
    assert.equal(formalCapability.sourceOfTruth, 'coils+stator_variants');
    assert.deepEqual(aiCapability.formalCapabilityIds, ['coils.list']);
    assert.equal(aiCapability.resultProvenance.kind, 'live_business');
});

test('正式业务能力注册表：配方技术档案写入声明文件和知识边界', () => {
    const upload = getBusinessCapability('recipes.technical_files.upload');
    const remove = getBusinessCapability('recipes.technical_files.delete');

    assert.equal(upload.riskLevel, 'medium');
    assert.equal(upload.requiresConfirmation, false);
    assert.equal(upload.concurrencyControl, 'expectedUpdatedAt');
    assert.match(upload.sourceOfTruth, /factory_files/);
    assert.match(upload.audit, /strong_audit/);

    assert.equal(remove.riskLevel, 'medium');
    assert.equal(remove.requiresConfirmation, true);
    assert.equal(remove.concurrencyControl, 'expectedUpdatedAt');
    assert.equal(remove.sourceOfTruth, 'recipe_technical_files');
});

test('正式业务能力注册表：转子历史命令区分数据库事务与文件副作用', () => {
    const save = getBusinessCapability('drawings.rotor.save_parameters');
    const rename = getBusinessCapability('drawings.rotor.rename_history');
    const link = getBusinessCapability('drawings.rotor.link_history');
    const remove = getBusinessCapability('drawings.rotor.delete_history');

    assert.equal(save.concurrencyControl, 'not_applicable');
    assert.equal(save.requiresConfirmation, false);
    assert.equal(rename.concurrencyControl, 'expectedUpdatedAt');
    assert.equal(link.concurrencyControl, 'expectedUpdatedAt');
    assert.equal(remove.riskLevel, 'medium');
    assert.equal(remove.requiresConfirmation, true);
    assert.match(remove.sourceOfTruth, /public\/drawings/);
    assert.match(remove.transactionality, /then_idempotent_file_cleanup/);
});

test('正式业务能力注册表：转子生成和打印声明 Preview、确认及外部副作用边界', () => {
    const generate = getBusinessCapability('drawings.rotor.generate_pdf');
    const print = getBusinessCapability('drawings.rotor.print_pdf');

    assert.equal(generate.riskLevel, 'high');
    assert.equal(generate.completionMode, 'accepted_async');
    assert.equal(generate.requiresConfirmation, true);
    assert.equal(generate.supportsPreview, true);
    assert.equal(generate.previewPath, '/api/rotor/draw-preview');
    assert.match(generate.outputSchema, /StructuredSafetyWarnings/);
    assert.match(generate.transactionality, /before_external_side_effect/);

    assert.equal(print.riskLevel, 'critical');
    assert.equal(print.completionMode, 'completed');
    assert.equal(print.requiresConfirmation, true);
    assert.equal(print.supportsPreview, true);
    assert.equal(print.previewPath, '/api/rotor/print/:jobId/preview');
    assert.match(print.transactionality, /before_external_side_effect/);
});

test('AI 能力注册表：转子生成和打印都是受确认保护的外部副作用', () => {
    const generate = getAiCapability('generate_rotor_drawing');
    const print = getAiCapability('print_rotor_drawing');

    assert.equal(generate.access, 'write');
    assert.equal(generate.operation, 'command');
    assert.equal(generate.completionMode, 'accepted_async');
    assert.equal(generate.riskLevel, 'high');
    assert.equal(generate.requiresConfirmation, true);
    assert.match(generate.transactionality, /external_side_effect/);

    assert.equal(print.access, 'write');
    assert.equal(print.operation, 'command');
    assert.equal(print.completionMode, 'completed');
    assert.equal(print.riskLevel, 'critical');
    assert.equal(print.requiresConfirmation, true);
    assert.match(print.transactionality, /external_side_effect/);
});

test('AI 能力注册表：线圈库存调整已接入持久化命令安全协议', () => {
    const capability = getAiCapability('adjust_coil_stock');
    assert.match(capability.idempotency, /persistent/);
    assert.equal(capability.supportsPreview, true);
    assert.equal(
        capability.concurrencyControl,
        'confirmationToken_bound_inventory_snapshot'
    );
    assert.match(capability.transactionality, /operation_receipt_atomic/);
    assert.match(capability.audit, /strong_audit/);
    assert.equal(capability.contractStatus, 'current');
});

test('AI 能力注册表：零件批量库存调整直接映射正式原子库存命令', () => {
    const capability = getAiCapability('adjust_part_stock');
    assert.equal(capability.access, 'write');
    assert.equal(capability.riskLevel, 'critical');
    assert.equal(capability.requiresConfirmation, true);
    assert.equal(capability.supportsPreview, true);
    assert.deepEqual(capability.formalCapabilityIds, ['inventory.parts.batch_adjust_stock']);
    assert.equal(
        capability.concurrencyControl,
        'confirmationToken_bound_inventory_snapshot'
    );
    assert.match(capability.transactionality, /operation_receipt_atomic/);
    assert.match(capability.audit, /strong_audit/);
});

test('AI 能力注册表：报价转订单工作流接入预览、确认和持久化业务协议', () => {
    const capability = getAiCapability('execute_factory_workflow_step');
    assert.equal(capability.riskLevel, 'critical');
    assert.equal(capability.requiresConfirmation, true);
    assert.equal(capability.supportsPreview, true);
    assert.match(capability.idempotency, /persistent/);
    assert.equal(capability.concurrencyControl, 'expectedUpdatedAt');
    assert.match(capability.transactionality, /operation_receipt_atomic/);
    assert.match(capability.audit, /strong_audit/);
});

test('AI 能力注册表：建单和订单状态写入已委托持久化正式命令', () => {
    const createOrder = getAiCapability('create_order');
    const updateStatus = getAiCapability('update_order_status');
    const executeReadiness = getAiCapability('execute_order_readiness_action');

    assert.equal(createOrder.supportsPreview, true);
    assert.match(createOrder.idempotency, /persistent/);
    assert.equal(createOrder.concurrencyControl, 'not_applicable');
    assert.equal(createOrder.contractStatus, 'current');

    assert.equal(updateStatus.supportsPreview, false);
    assert.match(updateStatus.idempotency, /persistent/);
    assert.equal(updateStatus.concurrencyControl, 'expectedUpdatedAt');
    assert.equal(updateStatus.contractStatus, 'current');

    assert.equal(executeReadiness.supportsPreview, true);
    assert.match(executeReadiness.idempotency, /persistent/);
    assert.equal(
        executeReadiness.concurrencyControl,
        'expectedUpdatedAt+previewHash_bound_live_readiness'
    );
    assert.match(executeReadiness.audit, /strong_audit/);
    assert.equal(executeReadiness.contractStatus, 'current');

    for (const toolName of [
        'add_recipe_to_order',
        'remove_recipe_from_order',
        'update_order_item',
        'generate_purchase_list',
        'delete_order',
    ]) {
        const capability = getAiCapability(toolName);
        assert.match(capability.idempotency, /persistent/);
        assert.equal(capability.concurrencyControl, 'expectedUpdatedAt');
        assert.equal(capability.contractStatus, 'current');
    }
});

test('AI 能力注册表：配方创建、修改和删除已委托持久化正式命令', () => {
    const createRecipe = getAiCapability('create_recipe');
    const updateRecipe = getAiCapability('update_recipe');
    const deleteRecipe = getAiCapability('delete_recipe');

    assert.equal(createRecipe.supportsPreview, true);
    assert.match(createRecipe.idempotency, /persistent/);
    assert.equal(createRecipe.concurrencyControl, 'not_applicable');
    assert.equal(createRecipe.sourceOfTruth, 'recipeService');
    assert.equal(createRecipe.contractStatus, 'current');

    assert.equal(updateRecipe.supportsPreview, true);
    assert.match(updateRecipe.idempotency, /persistent/);
    assert.equal(updateRecipe.concurrencyControl, 'expectedUpdatedAt');
    assert.equal(updateRecipe.sourceOfTruth, 'recipeService');
    assert.equal(updateRecipe.contractStatus, 'current');

    assert.equal(deleteRecipe.supportsPreview, true);
    assert.match(deleteRecipe.idempotency, /persistent/);
    assert.equal(
        deleteRecipe.concurrencyControl,
        'expectedUpdatedAt+confirmationToken_bound_delete_preview'
    );
    assert.equal(deleteRecipe.sourceOfTruth, 'recipeService');
    assert.equal(deleteRecipe.contractStatus, 'current');
});

test('AI 能力注册表：未登记工具默认拒绝且不会进入 executor', async () => {
    const result = await executeToolCall('unregistered_side_effect', {}, { allowWrite: true });

    assert.equal(result.success, false);
    assert.match(result.error, /未登记到能力注册表/);
});

test('AI 能力注册表：打印未确认时不执行外部动作', async () => {
    const result = await executeToolCall(
        'print_rotor_drawing',
        { jobId: 'job-1' },
        { allowWrite: false }
    );

    assert.equal(result.success, true);
    assert.equal(result.requiresConfirmation, true);
    assert.equal(result.confirmation.capabilityId, 'ai.print_rotor_drawing');
    assert.equal(result.confirmation.riskLevel, 'critical');
    assert.equal(result.confirmation.toolName, 'print_rotor_drawing');
});
