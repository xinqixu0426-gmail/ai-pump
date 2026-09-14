const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('业务变更契约：只提供一个跨域 API 和一个 AI 工具', () => {
    const tools = require('../api/routes/ai/tools.cjs').AI_TOOLS;
    const names = tools.map(tool => tool.function.name);
    assert.equal(names.filter(name => name === 'search_business_changes').length, 1);
    assert.equal(names.some(name => /^search_(order|quotation|recipe|part|coil|template)_changes$/.test(name)), false);
    const capability = require('../api/capabilities/registry.cjs').getAiCapability('search_business_changes');
    assert.deepEqual(capability.formalCapabilityIds, ['business_changes.list']);
    assert.equal(capability.executorKey, 'query');
    assert.equal(capability.access, 'read');
    const rootApi = read('api.cjs');
    assert.match(rootApi, /app\.use\('\/api\/business-changes'/);
    const executor = read('api/routes/ai/executors/queryExecutors.cjs');
    assert.match(executor, /case 'search_business_changes'/);
    assert.match(executor, /\/api\/business-changes/);
});

test('业务变更契约：核心正式命令显式声明业务事件而不是底层猜测', () => {
    const files = [
        'orderCommands.cjs',
        'quotationCommands.cjs',
        'quotationConversion.cjs',
        'quotationExpiry.cjs',
        'purchasingBatchOrder.cjs',
        'purchasingItemProgress.cjs',
        'purchasingInbound.cjs',
        'partCommands.cjs',
        'inventoryCommands.cjs',
        'recipeCommands.cjs',
        'recipeTechnicalFiles.cjs',
        'templateCommands.cjs',
        'coilCommands.cjs',
        'customerCommands.cjs',
        'orderRequirementCommands.cjs',
        'orderExecutionRecordCommands.cjs',
        'orderTodoCommands.cjs',
        'orderReadinessCommands.cjs',
        'modelVariantCommands.cjs',
        'businessSettingCommands.cjs',
        'runtimeSettingCommands.cjs',
        'factoryProfileService.cjs',
        'factoryWorkflowCommands.cjs',
        'qualityRuleCommands.cjs',
        'rotorCommands.cjs',
        'factoryFileCommands.cjs',
        'factoryFileLifecycleCommands.cjs',
        'knowledgeDocuments.cjs',
    ];
    for (const file of files) {
        const source = read(`api/services/${file}`);
        const commands = source.match(/executePersistentCommand\(\{/g) || [];
        const descriptors = source.match(/businessChange:\s*standardBusinessChange/g) || [];
        const technicalCommands = file === 'qualityRuleCommands.cjs' ? 1 : 0;
        assert.equal(descriptors.length, commands.length - technicalCommands, file);
    }
    const commandExecution = read('api/services/commandExecution.cjs');
    assert.match(commandExecution, /businessChangeDescriptor/);
    assert.doesNotMatch(commandExecution, /resourceType.*allowlist|allowlist.*resourceType/i);
    const db = read('api/db.cjs');
    assert.doesNotMatch(db, /recordBusinessChangeEvent/);
});

test('业务变更契约：仅技术过程明确退出业务长期记忆', () => {
    const registry = require('../api/capabilities/registry.cjs').BUSINESS_CAPABILITY_REGISTRY;
    const excluded = [
        'market.sync_copper_price',
        'market.sync_indicators',
        'knowledge.sync_derived',
        'quality.rule_candidates.refresh',
        'files.parse',
        'drawings.rotor.generate_pdf',
        'drawings.rotor.print_pdf',
        'ai.conversations.create',
        'ai.conversations.messages.append',
        'ai.conversations.messages.update_metadata',
        'ai.conversations.delete',
        'ai.conversations.batch_delete',
        'ai.feedback.submit',
        'ai.feedback.diagnose',
        'ai.feedback.retest',
        'ai.feedback.review',
        'ai.learning_rules.update',
    ];
    for (const capabilityId of excluded) {
        assert.equal(registry[capabilityId]?.recordsBusinessChange, false, capabilityId);
    }
});

test('业务变更契约：事件是知识和向量的可重建投影源', () => {
    const knowledge = read('api/services/knowledge.cjs');
    const autoSync = read('api/services/knowledgeAutoSync.cjs');
    assert.match(knowledge, /entryType: 'change_event'/);
    assert.match(knowledge, /sourceTable: 'business_change_events'/);
    assert.match(knowledge, /businessChangeKnowledgeEntries/);
    assert.match(autoSync, /'business_change_events'/);
    assert.doesNotMatch(autoSync, /'audit_log'/);
});

test('业务变更契约：AI 明确区分变更历史和管理待办', () => {
    const prompt = read('api/services/aiPromptComposer.cjs');
    const planner = read('api/services/aiGoalPlannerV3.cjs');
    assert.match(prompt, /search_business_changes/);
    assert.match(prompt, /禁止用 get_management_action_center 替代/);
    assert.match(planner, /属于 business_history，使用 search_business_changes/);
});
