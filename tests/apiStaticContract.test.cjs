const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getAiCapability } = require('../api/capabilities/registry.cjs');

const repoRoot = path.join(__dirname, '..');

function walkFiles(dir, predicate, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && ['node_modules', '.next', '.next-dev', 'dist', 'build'].includes(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walkFiles(fullPath, predicate, files);
        else if (predicate(fullPath)) files.push(fullPath);
    }
    return files;
}

function readUtf8(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function readAiPromptContractSource() {
    return [
        'api/routes/ai/chat.cjs',
        'api/routes/ai/prompt.cjs',
        'api/services/factoryProfileService.cjs',
        'api/services/aiPromptComposer.cjs',
    ].map(filePath => readUtf8(path.join(repoRoot, filePath))).join('\n');
}

function relative(filePath) {
    return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function frontendSourceFiles() {
    return walkFiles(
        path.join(repoRoot, 'apps/web-next'),
        (filePath) => /\.(ts|tsx|js|jsx)$/.test(filePath)
    );
}

test('API 静态契约：线圈正式方案迁移先去重再创建唯一索引', () => {
    const migrationSource = readUtf8(path.join(repoRoot, 'api/database/migrations.cjs'));
    const schemaSource = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));

    assert.match(migrationSource, /HAVING COUNT\(\*\) > 1/);
    assert.match(migrationSource, /UPDATE coils SET scheme_status = 'testing'/);
    assert.match(schemaSource, /CREATE UNIQUE INDEX IF NOT EXISTS idx_coils_one_official_scheme/);
});

test('API 静态契约：数据库启动仅通过版本化迁移初始化 Schema', () => {
    const dbSource = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const migrationSource = readUtf8(path.join(repoRoot, 'api/database/migrations.cjs'));

    assert.match(dbSource, /runMigrations\(db\)/);
    assert.doesNotMatch(dbSource, /\bALTER TABLE\b/);
    assert.doesNotMatch(dbSource, /\bCREATE TABLE IF NOT EXISTS\b/);
    assert.match(migrationSource, /schema_migrations/);
    assert.match(migrationSource, /transaction\(\(\) =>/);
    assert.match(migrationSource, /\.immediate\(\)/);
});

test('API 静态契约：旧 Vite 前端入口已移除', () => {
    const removedPaths = [
        'src',
        'dist',
        'index.html',
        'vite.config.ts',
        'tsconfig.json',
        'tsconfig.node.json',
    ];

    const offenders = removedPaths.filter((item) => fs.existsSync(path.join(repoRoot, item)));
    assert.deepEqual(offenders, []);
});

test('API 静态契约：根 package 不再保留旧前端脚本和依赖', () => {
    const pkg = JSON.parse(readUtf8(path.join(repoRoot, 'package.json')));
    const scripts = Object.keys(pkg.scripts || {});
    const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    assert.deepEqual(scripts.filter((name) => name.startsWith('legacy:') || name === 'build:all'), []);
    for (const dep of ['@mui/material', '@emotion/react', '@emotion/styled', 'react-router-dom', 'vite', '@vitejs/plugin-react', '@vitejs/plugin-basic-ssl']) {
        assert.equal(dependencies[dep], undefined, dep);
    }
});

test('API 静态契约：发布前检查脚本必须串起前后端 audit、test、build 和生产环境校验', () => {
    const pkg = JSON.parse(readUtf8(path.join(repoRoot, 'package.json')));
    const release = pkg.scripts?.['verify:release'] || '';

    assert.match(release, /npm audit/);
    assert.match(release, /npm --prefix apps\/web-next audit/);
    assert.match(release, /npm test/);
    assert.match(release, /npm run build/);
    assert.match(release, /npm run verify:prod-env/);
});

test('市场同步契约：route 不实现行情解析或数据库写入，AI 不获得新增写权限', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/cost.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/marketSync.cjs'));
    const command = readUtf8(path.join(repoRoot, 'api/services/marketIndicatorCommands.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));

    assert.match(route, /createMarketSyncService/);
    assert.match(route, /commandContextFromRequest/);
    assert.doesNotMatch(route, /fetchSpotMetalPrice/);
    assert.doesNotMatch(route, /INSERT OR REPLACE INTO system_settings/);
    assert.match(service, /fetchMarketSnapshot/);
    assert.match(command, /executePersistentCommand/);
    assert.match(command, /transaction: false/);
    assert.match(command, /setSetting/);
    assert.doesNotMatch(tools, /sync_market_indicators/);
});

test('运行配置契约：敏感设置通过正式命令提交且回执不暴露密钥', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/settings.cjs'));
    const command = readUtf8(path.join(repoRoot, 'api/services/runtimeSettingCommands.cjs'));
    const runtime = readUtf8(path.join(repoRoot, 'api/services/runtimeConfig.cjs'));
    const client = readUtf8(path.join(repoRoot, 'apps/web-next/lib/runtime-settings.ts'));

    assert.match(route, /executeRuntimeSettingsUpdate/);
    assert.doesNotMatch(route, /updateRuntimeSettings\(req\.body/);
    assert.match(command, /executePersistentCommand/);
    assert.match(command, /applyRuntimeEnvironment/);
    assert.match(command, /requiredAuditCount: writes\.length/);
    assert.match(runtime, /encryptSecret/);
    assert.match(runtime, /runtimeSettingsUpdatedAt/);
    assert.match(client, /Idempotency-Key/);
    assert.match(client, /expectedUpdatedAt/);
});

test('客户要求契约：草稿、确认和撤销通过正式命令且 AI 不能确认知识', () => {
    const routes = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const commands = readUtf8(path.join(
        repoRoot,
        'api/services/orderRequirementCommands.cjs'
    ));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    assert.match(routes, /executeSaveRequirementDraft/);
    assert.match(routes, /executeConfirmRequirement/);
    assert.match(routes, /executeRevokeRequirement/);
    assert.match(commands, /executePersistentCommand/);
    assert.match(commands, /assertExpectedUpdatedAt/);
    assert.match(commands, /requiredAuditCount/);
    assert.doesNotMatch(tools, /confirm_order_requirement/);
    assert.doesNotMatch(tools, /revoke_order_requirement/);
});

test('执行档案契约：五项写入通过正式命令且确认事实不开放给 AI', () => {
    const routes = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const commands = readUtf8(path.join(
        repoRoot,
        'api/services/orderExecutionRecordCommands.cjs'
    ));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    assert.match(routes, /executeCreateExecutionDraft/);
    assert.match(routes, /executeUpdateExecutionDraft/);
    assert.match(routes, /executeConfirmExecutionRecord/);
    assert.match(routes, /executeRevokeExecutionRecord/);
    assert.match(routes, /executeDeleteExecutionRecord/);
    assert.match(commands, /executePersistentCommand/);
    assert.match(commands, /assertExpectedUpdatedAt/);
    assert.match(commands, /requiredAuditCount/);
    assert.doesNotMatch(tools, /confirm_order_execution/);
    assert.doesNotMatch(tools, /revoke_order_execution/);
    assert.doesNotMatch(tools, /delete_order_execution/);
});

test('API 静态契约：Mac Mini 发布后必须执行真实 AI 回归门禁并保存报告', () => {
    const pkg = JSON.parse(readUtf8(path.join(repoRoot, 'package.json')));
    const gate = pkg.scripts?.['verify:ai-release'] || '';
    const installer = readUtf8(path.join(repoRoot, 'scripts/install-macmini-launchdaemons.sh'));
    const evaluator = readUtf8(path.join(repoRoot, 'scripts/run-knowledge-evaluation.cjs'));

    assert.match(gate, /run-knowledge-evaluation\.cjs/);
    assert.match(gate, /ai-release-gate-latest\.json/);
    assert.match(installer, /run verify:ai-release/);
    assert.match(installer, /本次发布不能验收/);
    assert.match(evaluator, /buildReleaseGateReport/);
    assert.match(evaluator, /failedChecks/);
});

test('API 静态契约：前端成本计算不得调用已删除的 /api/cost/calculate', () => {
    const offenders = frontendSourceFiles()
        .filter((filePath) => readUtf8(filePath).includes('/api/cost/calculate'))
        .map(relative);

    assert.deepEqual(offenders, []);
});

test('API 静态契约：前端不得新增裸 fetch 调用', () => {
    const offenders = [];
    for (const filePath of frontendSourceFiles()) {
        const rel = relative(filePath);
        if (rel === 'apps/web-next/lib/api.ts') continue;

        const source = readUtf8(filePath).replace(/\bproxyFetch\s*\(/g, '');
        if (/\bfetch\s*\(/.test(source)) offenders.push(rel);
    }

    assert.deepEqual(offenders, []);
});

test('API 静态契约：AI 纠错学习只通过统一客户端并提供人工启停入口', () => {
    const client = readUtf8(path.join(repoRoot, 'apps/web-next/lib/ai.ts'));
    const feedback = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/useAiAnswerFeedback.ts'));
    const dialogs = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/AiWorkspaceDialogs.tsx'));
    const knowledge = readUtf8(path.join(repoRoot, 'apps/web-next/components/knowledge-view.tsx'));

    assert.match(client, /proxyRequest<ApiResponse<FactoryAiRuleList>>\(`\/api\/ai\/learning-rules/);
    assert.match(client, /learnFromCorrection\?: boolean/);
    assert.match(dialogs, /让 AI 长期记住这条正确做法/);
    assert.match(feedback, /feedbackRating === 'incorrect' && feedbackLearn/);
    assert.match(knowledge, /AI 长期学习规则/);
    assert.match(knowledge, /toggleLearningRule/);
});

test('API 静态契约：核心 Row Adapter 输出标准 id 和时间字段', () => {
    const source = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const adapterNames = [
        'partRow',
        'recipeRow',
        'templateRow',
        'modelVariantRow',
        'orderRow',
        'coilRow',
        'customerRow',
        'quotationRow',
    ];

    const offenders = adapterNames.filter((name) => {
        const start = source.indexOf(`function ${name}(r)`);
        if (start === -1) return true;
        const next = source.indexOf('\nfunction ', start + 1);
        const body = source.slice(start, next === -1 ? source.length : next);
        return !body.includes('id: r.id') ||
            !body.includes('createdAt: r.created_at') ||
            !body.includes('updatedAt: r.updated_at');
    });

    assert.deepEqual(offenders, []);
});

test('API 静态契约：客户和报价写接口返回标准 data 对象', () => {
    const customers = readUtf8(path.join(repoRoot, 'api/routes/customers.cjs'));
    const quotations = readUtf8(path.join(repoRoot, 'api/routes/quotations.cjs'));
    assert.match(customers, /legacyCustomerCommandResponse\(result\)/);
    assert.match(quotations, /legacyQuotationCommandResponse\(result\)/);
    assert.match(quotations, /res\.json\(\{ success: true, data:/);
    assert.match(customers, /res\.json\(\{ success: true, data:/);
    assert.doesNotMatch(customers, /lastInsertRowid/);
    assert.doesNotMatch(quotations, /id: info\.lastInsertRowid/);
});

test('API 静态契约：Next 资源 client 统一处理 legacy id 时间兼容', () => {
    const clientFiles = [
        'apps/web-next/lib/parts.ts',
        'apps/web-next/lib/recipes.ts',
        'apps/web-next/lib/orders.ts',
        'apps/web-next/lib/customers.ts',
        'apps/web-next/lib/coils.ts',
    ];

    for (const filePath of clientFiles) {
        const source = readUtf8(path.join(repoRoot, filePath));
        assert.match(source, /\.id \?\? .*\.Id|row\.id \?\? row\.Id|id: .*\.id \|\| .*\.Id/, filePath);
    }
});

test('API 静态契约：核心资源页面不得直接依赖 legacy Id 时间字段', () => {
    const files = walkFiles(path.join(repoRoot, 'apps/web-next/app'), (filePath) => /\.(ts|tsx)$/.test(filePath))
        .concat(walkFiles(path.join(repoRoot, 'apps/web-next/components'), (filePath) => /\.(ts|tsx)$/.test(filePath)))
        .filter((filePath) => {
        const rel = relative(filePath);
        return !['apps/web-next/lib/api.ts'].includes(rel);
    });

    const offenders = files
        .filter((filePath) => /\.(Id|CreatedAt|UpdatedAt)\b/.test(readUtf8(filePath)))
        .map(relative);

    assert.deepEqual(offenders, []);
});

test('API 静态契约：核心资源写接口新调用必须使用路径 ID', () => {
    const routeFiles = [
        'api/routes/parts.cjs',
        'api/routes/orders.cjs',
        'api/routes/recipes.cjs',
        'api/routes/customers.cjs',
        'api/routes/quotations.cjs',
    ];

    for (const filePath of routeFiles) {
        const route = readUtf8(path.join(repoRoot, filePath));
        assert.match(route, /router\.patch\('\/:id'/, filePath);
        assert.match(route, /router\.delete\('\/:id'/, filePath);
        assert.doesNotMatch(route, /router\.patch\('\/'/, filePath);
        assert.doesNotMatch(route, /router\.delete\('\/'/, filePath);
    }
});

test('API 静态契约：历史常用配置草稿接口必须保持后端兼容', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/recipes.cjs'));
    const queries = readUtf8(path.join(repoRoot, 'api/services/recipeQueries.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/recipes.ts'));

    assert.match(route, /router\.post\('\/model-variant-draft'/);
    assert.match(route, /recipeQueries\.getModelVariantDraft/);
    assert.match(queries, /const recipeDraft = \{/);
    assert.match(nextClient, /applyModelVariantDraft/);
    assert.match(nextClient, /\/api\/recipes\/model-variant-draft/);
});

test('API 静态契约：配方泵壳模板应用必须由后端生成草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/templates.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/templateQueries.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/recipes.ts'));
    const nextView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));

    assert.match(route, /router\.get\('\/:id\/default-recipe'/);
    assert.match(route, /templateQueries\.getDefaultRecipe/);
    assert.match(service, /recipeDraft: \{/);
    assert.match(service, /calculateRecipeCost/);
    assert.match(nextClient, /getTemplateRecipeDraft/);
    assert.match(nextClient, /\/api\/templates\/\$\{templateId\}\/default-recipe/);
    assert.match(nextView, /getTemplateRecipeDraft\(templateId\)/);
});

test('API 静态契约：配方保存 payload 必须由后端生成草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/recipes.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/recipeCommands.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/recipes.ts'));
    const nextView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));

    assert.match(route, /router\.post\('\/save-payload-draft'/);
    assert.match(route, /buildRecipeSavePayloadDraft\(\s*recipeCommandDependencies\(\)/);
    assert.match(service, /function buildRecipeSavePayloadDraft/);
    assert.match(service, /buildRecipeCostDraft/);
    assert.match(service, /executePersistentCommand/);
    assert.match(nextClient, /buildRecipeSavePayloadDraft/);
    assert.match(nextClient, /\/api\/recipes\/save-payload-draft/);
    assert.match(nextClient, /Idempotency-Key/);
    assert.match(nextView, /buildRecipeSavePayloadDraft\(\{/);
    assert.match(nextView, /expectedUpdatedAt: editingRecipe\?\.updatedAt/);
    assert.doesNotMatch(nextView, /partsJson: JSON\.stringify\(costDraft\.parts\)/);
});

test('API 静态契约：配方线圈材质切换必须从可用组合解析槽眼', () => {
    const coilService = readUtf8(path.join(repoRoot, 'api/services/coilCost.cjs'));
    const coilRoute = readUtf8(path.join(repoRoot, 'api/routes/coils.cjs'));
    const coilQueries = readUtf8(path.join(repoRoot, 'api/services/coilQueries.cjs'));
    const recipeView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));
    const recipeCoilSection = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipe/RecipeCoilSection.tsx'));
    const variantPanel = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipe/ModelVariantCompatibilityPanel.tsx'));
    const coilSelection = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipe/coil-selection.ts'));

    assert.match(coilService, /function buildCoilSpecOptions/);
    assert.match(coilRoute, /coilQueries\.getSpecOptions\(\)/);
    assert.match(coilQueries, /buildCoilSpecOptions\(listCoils\(\)\)/);
    assert.match(coilSelection, /export function resolveCoilVariantSelection/);
    assert.match(coilSelection, /variant\.material === preferredMaterial && variant\.slotType === preferredSlotType/);
    assert.match(coilSelection, /variants\.find\(\(variant\) => variant\.material === preferredMaterial\)/);
    assert.match(recipeCoilSection, /onMaterialChange\(event\.target\.value\)/);
    assert.match(recipeView, /resolveCoilVariantSelection\(\s*selectedFormCoilSpec,\s*coilMaterial/);
    assert.match(variantPanel, /resolveCoilVariantSelection\(\s*selectedCoil,\s*event\.target\.value/);
    assert.doesNotMatch(recipeView, /coilMaterial:\s*event\.target\.value,\s*coilSlotType:\s*'小眼'/);
});

test('API 静态契约：配方详情只读库存状态且不保留生产扣库存入口', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/recipes.cjs'));
    const queries = readUtf8(path.join(repoRoot, 'api/services/recipeQueries.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/recipes.ts'));
    const recipeView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));

    assert.match(route, /router\.get\('\/:id\/inventory-status'/);
    assert.match(route, /recipeQueries\.getInventoryStatus/);
    assert.match(queries, /function getInventoryStatus/);
    assert.match(queries, /scheme_status = 'official'/);
    assert.doesNotMatch(route, /production-check|router\.post\('\/:id\/produce'|function produceRecipe/);
    assert.match(nextClient, /getRecipeInventoryStatus\(recipeId: number\)/);
    assert.match(nextClient, /\/api\/recipes\/\$\{recipeId\}\/inventory-status/);
    assert.doesNotMatch(recipeView, /确认生产|生产数量|预检库存|produceRecipe/);
});

test('API 静态契约：报价转订单必须由后端生成订单草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/quotations.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/quotationConversion.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quotations.ts'));

    assert.match(route, /router\.post\('\/:id\/order-draft'/);
    assert.match(route, /buildQuotationOrderDraft/);
    assert.match(service, /function buildQuotationOrderDraft/);
    assert.match(service, /buildBalancedOrderPlans/);
    assert.match(route, /router\.post\('\/:id\/convert'/);
    assert.match(service, /converted_order_id/);
    assert.match(nextClient, /buildQuotationOrderDraft\(\s*quotationId: number,\s*itemQuantities: QuotationItemQuantity\[\]/);
    assert.match(nextClient, /body: JSON\.stringify\(\{ itemQuantities \}\)/);
    assert.match(nextClient, /\/api\/quotations\/\$\{quotationId\}\/order-draft/);
    assert.match(nextClient, /\/api\/quotations\/\$\{input\.quotation\.id\}\/convert/);
    assert.match(nextClient, /expectedUpdatedAt/);
    assert.match(nextClient, /Idempotency-Key/);
    assert.doesNotMatch(nextClient, /generatePurchasePlan/);
});

test('API 静态契约：报价保存 payload 必须由后端生成草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/quotations.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/quotationDraft.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quotations.ts'));

    assert.match(route, /router\.post\('\/save-payload-draft'/);
    assert.match(route, /buildQuotationSavePayloadDraft/);
    assert.match(service, /function buildQuotationSavePayloadDraft/);
    assert.match(nextClient, /buildQuotationSavePayloadDraft/);
    assert.match(nextClient, /\/api\/quotations\/save-payload-draft/);
    assert.doesNotMatch(nextClient, /itemsJson: JSON\.stringify\(input\.items\)/);
});

test('API 静态契约：订单保存 payload 必须由后端生成草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const commandService = readUtf8(path.join(repoRoot, 'api/services/orderCommands.cjs'));
    const revisionService = readUtf8(path.join(repoRoot, 'api/services/orderRevisions.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/orders.ts'));
    const nextView = readUtf8(path.join(repoRoot, 'apps/web-next/components/orders-view.tsx'));
    const detailDrawer = readUtf8(path.join(repoRoot, 'apps/web-next/components/order-detail-drawer.tsx'));

    assert.match(route, /router\.post\('\/save-payload-draft'/);
    assert.match(route, /buildOrderSavePayloadDraft/);
    assert.match(commandService, /function buildOrderSavePayloadDraft/);
    assert.match(commandService, /executePersistentCommand/);
    assert.match(commandService, /executeOrderCreate/);
    assert.match(commandService, /executeOrderStatus/);
    assert.match(commandService, /assertExpectedUpdatedAt/);
    assert.match(commandService, /orderCoreEditEligibility/);
    assert.match(commandService, /safeInsert\('order_revisions'/);
    assert.match(revisionService, /function listOrderRevisions/);
    assert.match(route, /router\.get\('\/:id\/revisions'/);
    assert.match(nextClient, /buildOrderSavePayloadDraft/);
    assert.match(nextClient, /\/api\/orders\/save-payload-draft/);
    assert.match(nextClient, /Idempotency-Key/);
    assert.match(nextClient, /expectedUpdatedAt:\s*order\.updatedAt/);
    assert.doesNotMatch(nextClient, /itemsJson: JSON\.stringify\(order\.items\)/);
    assert.doesNotMatch(nextView, /generatePurchasePlan\(draftItems\)/);
    assert.match(nextView, /prepareOrderUpdate/);
    assert.match(nextView, /本次修改原因/);
    assert.match(detailDrawer, /编辑订单/);
    assert.match(detailDrawer, /修改记录/);
    assert.match(detailDrawer, /getOrderRevisions/);
});

test('API 静态契约：订单详情动作必须由后端执行', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const progressService = readUtf8(path.join(repoRoot, 'api/services/purchasingItemProgress.cjs'));
    const inboundService = readUtf8(path.join(repoRoot, 'api/services/purchasingInbound.cjs'));
    const inventoryService = readUtf8(path.join(repoRoot, 'api/services/purchaseInventory.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/orders.ts'));
    const detailDrawer = readUtf8(path.join(repoRoot, 'apps/web-next/components/order-detail-drawer.tsx'));

    assert.match(route, /router\.post\('\/:id\/status'/);
    assert.match(route, /router\.post\('\/:id\/purchase-items\/progress-draft'/);
    assert.match(route, /router\.post\('\/:id\/purchase-items\/progress'/);
    assert.match(route, /router\.post\('\/:id\/purchase-items\/toggle'/);
    assert.match(route, /router\.post\('\/:id\/todos\/toggle'/);
    assert.match(route, /router\.post\('\/:id\/complete-purchase-draft'/);
    assert.match(route, /router\.post\('\/:id\/complete-purchase'/);
    assert.match(route, /buildCompletePurchaseDraft/);
    assert.match(route, /executeCompletePurchase/);
    assert.match(route, /buildPurchaseItemProgressDraft/);
    assert.match(route, /buildLegacyPurchaseItemToggleInput/);
    assert.match(route, /executePurchaseItemProgress/);
    assert.match(route, /commandContextFromRequest/);
    assert.match(progressService, /executePersistentCommand/);
    assert.match(progressService, /function buildLegacyPurchaseItemToggleInput/);
    assert.match(progressService, /assertExpectedUpdatedAt/);
    assert.match(progressService, /assertPreviewHash/);
    assert.match(progressService, /requiredAuditCount/);
    assert.match(inventoryService, /function applyPurchaseInventory/);
    assert.match(inventoryService, /safeUpdate\(\s*'parts'/);
    assert.match(inventoryService, /adjustCoilStock/);
    assert.match(inventoryService, /movementType: 'purchase_inbound'/);
    assert.match(inboundService, /record\.purchase_completed_at \|\| record\.status === '采购完成'/);
    assert.match(inboundService, /purchase_receipt_id: receiptId/);
    assert.match(inboundService, /executePersistentCommand/);
    assert.match(inboundService, /requiredAuditCount/);
    assert.match(nextClient, /setOrderStatus/);
    assert.match(nextClient, /updateOrderPurchaseItem/);
    assert.match(nextClient, /buildOrderPurchaseItemProgressDraft/);
    assert.match(nextClient, /purchase-items\/progress-draft/);
    assert.match(nextClient, /toggleOrderPurchaseItem/);
    assert.match(nextClient, /toggleOrderTodoItem/);
    assert.match(nextClient, /buildCompleteOrderPurchaseDraft/);
    assert.match(nextClient, /Idempotency-Key/);
    assert.match(nextClient, /completeOrderPurchase/);
    assert.match(detailDrawer, /commandDraft\.stockAddition/);
    assert.doesNotMatch(detailDrawer, /window\.confirm/);
    assert.match(detailDrawer, /setPurchaseConfirmTarget/);
    assert.match(detailDrawer, /<ConfirmDialog/);
    assert.match(detailDrawer, /入库后库存/);
    assert.doesNotMatch(detailDrawer, /saveOrder|batchAddStock/);
});

test('API 静态契约：包装零件二级分类贯穿数据库、接口和标准 Adapter', () => {
    const dbSource = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const schemaSource = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const migrationSource = readUtf8(path.join(repoRoot, 'api/database/migrations.cjs'));
    const routeSource = readUtf8(path.join(repoRoot, 'api/routes/parts.cjs'));
    const serviceSource = readUtf8(path.join(repoRoot, 'api/services/partCommands.cjs'));

    assert.match(schemaSource, /subcategory TEXT DEFAULT ''/);
    assert.match(dbSource, /subcategory: r\.subcategory \|\| ''/);
    assert.match(migrationSource, /partSubcategory/);
    assert.match(routeSource, /extractPartFields/);
    assert.match(routeSource, /executePartCreate/);
    assert.match(routeSource, /executePartUpdate/);
    assert.match(serviceSource, /subcategory: String\(fields\.subcategory \|\| ''\)\.trim\(\)/);
    assert.match(serviceSource, /input\.category === undefined && input\.subcategory === undefined/);
});

test('API 静态契约：报价确认转单必须事务化并防止重复转单', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/quotations.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/quotationConversion.cjs'));

    assert.match(route, /executeQuotationConversion/);
    assert.match(route, /commandContextFromRequest/);
    assert.match(service, /executePersistentCommand/);
    assert.match(service, /quotation\.converted_order_id \|\| quotation\.status === '已转订单'/);
    assert.match(service, /safeInsert\('orders'/);
    assert.match(service, /converted_order_id: orderId/);
    assert.match(service, /requiredAuditCount: 2/);
    assert.match(service, /expectedUpdatedAt/);
});

test('API 静态契约：采购中心批量采购状态必须由后端执行', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/purchasingBatchOrder.cjs'));
    const purchaseClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/purchase.ts'));
    const purchaseView = readUtf8(path.join(repoRoot, 'apps/web-next/components/purchase-view.tsx'));

    assert.match(route, /router\.post\('\/purchase-items\/batch'/);
    assert.match(route, /router\.post\('\/purchase-items\/batch-draft'/);
    assert.match(route, /executePurchaseBatch/);
    assert.match(route, /buildPurchaseBatchDraft/);
    assert.doesNotMatch(route, /function applyPurchaseItemsByTask/);
    assert.match(service, /executePersistentCommand/);
    assert.match(service, /expectedVersions/);
    assert.match(service, /assertPreviewHash/);
    assert.match(service, /requiredAuditCount/);
    assert.match(purchaseClient, /\/api\/orders\/purchase-items\/batch-draft/);
    assert.match(purchaseClient, /\/api\/orders\/purchase-items\/batch/);
    assert.match(purchaseClient, /Idempotency-Key/);
    assert.match(purchaseView, /draft\.affectedOrders/);
    assert.doesNotMatch(purchaseView, /window\.confirm/);
    assert.match(purchaseView, /setConfirmTarget\(\{ task, purchased, draft, totalChange \}\)/);
    assert.match(purchaseView, /<ConfirmDialog/);
    assert.doesNotMatch(purchaseClient, /saveOrder|buildUpdatedOrders/);
});

test('API 静态契约：成本 API 不再暴露旧命名 alias', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/cost.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/costExecutors.cjs'));

    assert.doesNotMatch(route, /cost\/calculate/);
    assert.doesNotMatch(route, /cost\/dynamic-calculate/);
    assert.doesNotMatch(route, /cost\/full-calculate/);
    assert.doesNotMatch(route, /cost\/dynamic-config/);
    assert.doesNotMatch(route, /cost\/recipe\/:id/);
    assert.doesNotMatch(executor, /\/api\/cost\/recipe\/\$\{/);
});

test('API 静态契约：批量库存接口只接受标准 partId', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/parts.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/inventoryCommands.cjs'));
    const docs = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));

    assert.match(route, /buildPartStockPreview/);
    assert.match(route, /executeConfirmedPartStockBatch/);
    assert.match(service, /parsePositiveId\(item\?\.partId\)/);
    assert.match(service, /parseFiniteNumber\(value, `operations\[\$\{index\}\]\.delta`\)/);
    assert.doesNotMatch(service, /item\?\.id|item\?\.Id/);
    assert.match(docs, /operations: \[\{ partId, delta \}\]/);
    assert.match(docs, /\{ confirmationToken, idempotencyKey\? \}/);
});

test('API 静态契约：业务新增写库必须通过 safeInsert', () => {
    const dbSource = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    assert.match(dbSource, /function safeInsert\(table, values, options = \{\}\)/);
    assert.match(dbSource, /writeAuditLog\(\s*'INSERT',\s*table/);

    const files = [
        'api/routes/parts.cjs',
        'api/routes/customers.cjs',
        'api/routes/quotations.cjs',
        'api/routes/orders.cjs',
        'api/routes/recipes.cjs',
        'api/routes/templates.cjs',
        'api/routes/modelVariants.cjs',
        'api/routes/coils.cjs',
        'api/routes/rotor.cjs',
        'api/routes/ai/executors/recipeExecutors.cjs',
        'api/routes/ai/executors/queryExecutors.cjs',
        'api/routes/ai/executors/orderExecutors.cjs',
        'api/routes/ai/executors/businessExecutors.cjs',
    ];

    const offenders = files
        .filter((filePath) => /INSERT\s+(?:OR\s+REPLACE\s+)?INTO/i.test(readUtf8(path.join(repoRoot, filePath))))
        .map((filePath) => filePath.replace(/\\/g, '/'));

    assert.deepEqual(offenders, []);
});

test('API 静态契约：AI 低风险 CRUD 写操作必须复用标准 API', () => {
    const queryExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/queryExecutors.cjs'));
    const orderExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/orderExecutors.cjs'));
    const recipeExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/recipeExecutors.cjs'));

    assert.match(queryExecutor, /return executePartCreate\(args/);
    assert.match(queryExecutor, /return executePartDelete\(args/);
    assert.doesNotMatch(queryExecutor, /safeInsert\('parts'|safeUpdate\('parts'|softDelete\('parts'/);

    assert.match(orderExecutor, /getJson\(internalFetch,\s*`\/api\/orders\/\$\{id\}`/);
    assert.match(orderExecutor, /patchJson\(internalFetch,\s*`\/api\/orders\/\$\{order\.id \?\? order\.Id\}`/);

    assert.match(recipeExecutor, /confirmationContext\?\.kind === 'recipe_delete_target'/);
    assert.match(recipeExecutor, /deleteJson\(\s*internalFetch,\s*`\/api\/recipes\/\$\{context\.recipeId\}`/);
    assert.doesNotMatch(recipeExecutor, /softDelete\('recipes'/);
});

test('API 静态契约：AI 零件写操作必须委托独立 service 和正式 API', () => {
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executor.cjs'));
    const queryExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/queryExecutors.cjs'));
    const partExecution = readUtf8(path.join(repoRoot, 'api/services/aiPartExecution.cjs'));

    assert.match(queryExecutor, /return executePartCreate\(args/);
    assert.match(queryExecutor, /return executePartDelete\(args/);
    assert.match(queryExecutor, /return executePartUpdate\(args/);
    assert.match(queryExecutor, /return executePartPriceBatch\(args/);
    assert.doesNotMatch(queryExecutor, /batch-stock-preview|prices-preview|requestedStockDelta|percentChange \/ 100|零件新建成功|找不到零件/);
    assert.doesNotMatch(executor, /partUpdateInputError|stockDelta/);
    assert.match(partExecution, /postJson\(\s*internalFetch,\s*'\/api\/parts'/);
    assert.match(partExecution, /deleteJson\(\s*internalFetch,\s*`\/api\/parts\/\$\{target\.id \?\? target\.Id\}`/);
    assert.match(partExecution, /patchJson\(\s*internalFetch,\s*`\/api\/parts\/\$\{targetId\}`/);
    assert.match(partExecution, /expectedUpdatedAt: target\.updatedAt \|\| target\.UpdatedAt/);
    assert.doesNotMatch(partExecution, /function partUpdateInputError/);
    assert.doesNotMatch(partExecution, /一次 update_part 不能同时修改零件资料和库存/);
    assert.match(partExecution, /preview\.suggestedIdempotencyKey/);
    assert.match(partExecution, /oldPrice \* \(1 \+ percentChange \/ 100\)/);
    assert.match(partExecution, /\/api\/parts\/prices-preview/);
    assert.match(partExecution, /previewHash: preview\.previewHash/);
    assert.doesNotMatch(partExecution, /db\.prepare|safeInsert|safeUpdate/);
});

test('API 静态契约：AI 线圈库存俗称编排必须委托独立 service 和正式库存 API', () => {
    const queryExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/queryExecutors.cjs'));
    const coilStockExecution = readUtf8(path.join(repoRoot, 'api/services/aiCoilStockExecution.cjs'));

    assert.match(queryExecutor, /return executeCoilStockAdjustment\(args/);
    assert.doesNotMatch(queryExecutor, /parseCoilInventoryModel|stock-adjustments-preview/);
    assert.match(coilStockExecution, /function parseCoilInventoryModel/);
    assert.match(coilStockExecution, /coil\.schemeStatus === 'official'/);
    assert.match(coilStockExecution, /存在多个正式方案/);
    assert.match(coilStockExecution, /\/api\/coils\/stock-adjustments-preview/);
    assert.match(coilStockExecution, /\/api\/coils\/stock-adjustments/);
    assert.match(coilStockExecution, /preview\.confirmationToken/);
    assert.match(coilStockExecution, /preview\.suggestedIdempotencyKey/);
    assert.doesNotMatch(coilStockExecution, /db\.prepare|safeInsert|safeUpdate/);
});

test('API 静态契约：AI 订单写操作必须复用订单草稿和动作接口', () => {
    const orderExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/orderExecutors.cjs'));

    assert.match(orderExecutor, /\/api\/orders\/save-payload-draft/);
    assert.match(orderExecutor, /postJson\(internalFetch,\s*'\/api\/orders'/);
    assert.match(orderExecutor, /postJson\(internalFetch,\s*`\/api\/orders\/\$\{row\.id \?\? row\.Id\}\/status`/);
    assert.doesNotMatch(orderExecutor, /db\.prepare|safeInsert\('orders'|safeUpdate\('orders'|buildOrderPlan/);
});

test('API 静态契约：AI 配方保存必须复用配方草稿和标准写接口', () => {
    const recipeExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/recipeExecutors.cjs'));

    assert.doesNotMatch(recipeExecutor, /\/api\/recipes\/cost-draft/);
    assert.match(recipeExecutor, /\/api\/recipes\/save-payload-draft/);
    assert.match(recipeExecutor, /optionalParts/);
    assert.match(recipeExecutor, /postJson\(internalFetch,\s*'\/api\/recipes'/);
    assert.match(recipeExecutor, /confirmationContext\?\.kind === 'recipe_update_preview'/);
    assert.match(recipeExecutor, /`\/api\/recipes\/\$\{context\.recipeId\}`/);
    assert.match(recipeExecutor, /context\.draft/);
    assert.match(recipeExecutor, /`\/api\/recipes\/\$\{context\.recipeId\}`,[\s\S]*'配方修改后回读失败'/);
    assert.match(recipeExecutor, /recipeId: Number\(recipe\.id \?\? recipe\.Id\)/);
    assert.match(recipeExecutor, /const expectedUpdatedAt = recipe\.updatedAt \?\? recipe\.UpdatedAt/);
    assert.match(recipeExecutor, /\{ expectedUpdatedAt: context\.expectedUpdatedAt \}/);
    assert.doesNotMatch(recipeExecutor, /safeInsert\('recipes'|safeUpdate\('recipes'/);
});

test('API 静态契约：AI executor 不得直接访问数据库 helper 或裸解析 API 响应', () => {
    const executorFiles = [
        'api/routes/ai/executors/recipeExecutors.cjs',
        'api/routes/ai/executors/queryExecutors.cjs',
        'api/routes/ai/executors/orderExecutors.cjs',
        'api/routes/ai/executors/costExecutors.cjs',
        'api/routes/ai/executors/businessExecutors.cjs',
    ];

    const forbidden = /\b(dbGet\w+|loadPartsData|calculateRecipeCost|db\.prepare|safeInsert|safeUpdate|softDelete|hardDelete)\b|response\.json\(/;
    const offenders = executorFiles
        .filter((filePath) => forbidden.test(readUtf8(path.join(repoRoot, filePath))))
        .map((filePath) => filePath.replace(/\\/g, '/'));

    assert.deepEqual(offenders, []);
});

test('API 静态契约：AI 普通工具结果不得以卡片展示短路调度', () => {
    const chatRoute = readUtf8(path.join(repoRoot, 'api/services/aiAgentRuntimeV3.cjs'));
    const promptRoute = readAiPromptContractSource();
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));

    assert.match(chatRoute, /pendingConfirmation/);
    assert.doesNotMatch(chatRoute, /buildToolCardReply/);
    assert.doesNotMatch(chatRoute, /整理在下面的卡片/);
    assert.match(promptRoute, /普通工具返回的数据是给你继续分析和编排使用的/);
    for (const name of ['build_recipe_bom_draft', 'preview_recipe_cost', 'preview_pump_shell_cost', 'build_quotation_draft', 'build_order_draft', 'search_customer_history', 'explain_cost_change', 'get_data_quality_summary', 'analyze_recipe_configuration', 'set_recipe_analysis_feedback', 'get_factory_learning_health', 'get_factory_rule_candidates', 'get_factory_rule_impact', 'get_factory_rule_compliance', 'get_factory_rule_history', 'restore_factory_rule_event', 'refresh_factory_rule_candidates', 'review_factory_rule_candidate', 'get_business_alerts', 'search_factory_knowledge', 'get_factory_knowledge_detail', 'get_factory_knowledge_health', 'sync_factory_knowledge']) {
        assert.match(tools, new RegExp(name));
    }
});

test('API 静态契约：配方智能检查只读且区分工厂规则、确定问题与复核建议', () => {
    const chatRoute = readAiPromptContractSource();
    const promptRoute = readAiPromptContractSource();
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const businessExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/recipeIntelligence.cjs'));

    assert.match(tools, /name: 'analyze_recipe_configuration'/);
    assert.equal(getAiCapability('analyze_recipe_configuration').access, 'read');
    assert.match(businessExecutor, /\/api\/quality\/recipe-analysis/);
    assert.match(chatRoute, /已批准工厂规则、确定性配置矛盾与同类配方复核建议必须分开描述/);
    assert.match(promptRoute, /不得把建议说成确定错误/);
    assert.match(service, /advisoryOnly: true/);
    assert.match(service, /type: 'configuration_conflict'/);
    assert.match(service, /type: 'peer_pattern'/);
    assert.match(service, /type: 'factory_rule'/);
    assert.match(service, /dbGetFactoryRuleCandidates\('approved'\)/);
    assert.match(service, /factoryRuleFeedback\.active\.length/);
});

test('API 静态契约：配方检查反馈按提醒键持久化且受确认保护', () => {
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const route = readUtf8(path.join(repoRoot, 'api/routes/quality.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/recipeAnalysisFeedback.cjs'));
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));

    assert.match(tools, /name: 'set_recipe_analysis_feedback'/);
    assert.equal(getAiCapability('set_recipe_analysis_feedback').access, 'write');
    assert.match(route, /router\.post\('\/recipes\/:recipeId\/feedback'/);
    assert.match(service, /safeInsert/);
    assert.match(service, /safeUpdate/);
    assert.match(schema, /UNIQUE\(recipe_id, finding_key\)/);
});

test('API 静态契约：候选业务规则需人工审核后才进入知识库', () => {
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const knowledge = readUtf8(path.join(repoRoot, 'api/services/knowledge.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));

    assert.match(service, /finding_type = 'peer_pattern'/);
    assert.match(service, /minimumEvidence \|\| MINIMUM_APPROVAL_SUPPORT/);
    assert.match(service, /status === 'approved'/);
    assert.match(knowledge, /approvedFactoryRuleEntries/);
    assert.match(knowledge, /sourceTable: 'factory_rule_candidates'/);
    assert.equal(getAiCapability('review_factory_rule_candidate').access, 'write');
    assert.match(qualityView, /候选业务规则/);
    assert.match(qualityView, /批准后参与配方检查/);
});

test('API 静态契约：Knowledge V3 使用正反反馈和证据指纹治理学习规则', () => {
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const intelligence = readUtf8(path.join(repoRoot, 'api/services/recipeIntelligence.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));

    for (const column of ['support_count', 'special_case_count', 'ignored_count', 'confidence_score', 'learning_hash', 'reviewed_learning_hash']) {
        assert.match(schema, new RegExp(column));
    }
    assert.match(service, /confidenceForEvidence/);
    assert.match(service, /learningEvidenceHash/);
    assert.match(service, /decision IN \('confirmed', 'special_case', 'ignored'\)/);
    assert.match(service, /status: 'stale'/);
    assert.match(intelligence, /version: 'knowledge-v3\.0'/);
    assert.match(qualityView, /置信度/);
    assert.match(qualityView, /特殊情况证据/);
});

test('API 静态契约：Knowledge V3 规则批准前提供只读影响分析', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/quality.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const prompt = readAiPromptContractSource();
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));

    assert.match(route, /router\.get\('\/rule-candidates\/:id\/impact'/);
    assert.match(tools, /name: 'get_factory_rule_impact'/);
    assert.equal(getAiCapability('get_factory_rule_impact').access, 'read');
    assert.match(prompt, /先用 get_factory_rule_impact/);
    assert.match(service, /function buildFactoryRuleImpact/);
    assert.match(service, /needsReview/);
    assert.match(service, /specialCases/);
    assert.match(qualityView, /查看影响/);
    assert.match(qualityView, /影响范围：同模板/);
});

test('API 静态契约：Knowledge V3 全局监控已批准规则执行情况', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/quality.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const prompt = readAiPromptContractSource();
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));

    assert.match(route, /router\.get\('\/rule-compliance'/);
    assert.match(tools, /name: 'get_factory_rule_compliance'/);
    assert.equal(getAiCapability('get_factory_rule_compliance').access, 'read');
    assert.match(prompt, /使用 get_factory_rule_compliance/);
    assert.match(service, /function buildFactoryRuleCompliance/);
    assert.match(service, /affectedRecipeCount/);
    assert.match(service, /ruleViolationCount/);
    assert.match(qualityView, /已批准规则执行情况/);
    assert.match(qualityView, /受影响配方/);
});

test('API 静态契约：Knowledge V3 同类反馈与候选规则归纳保持事务一致', () => {
    const feedbackService = readUtf8(path.join(repoRoot, 'api/services/recipeAnalysisFeedback.cjs'));
    const prompt = readAiPromptContractSource();
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));
    const analysisPanel = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipe/RecipeAnalysisPanel.tsx'));

    assert.match(feedbackService, /database\.transaction/);
    assert.match(feedbackService, /findingType !== 'peer_pattern'/);
    assert.match(feedbackService, /refreshFactoryRuleCandidates/);
    assert.match(feedbackService, /ruleLearning/);
    assert.match(prompt, /无需再调用 refresh_factory_rule_candidates/);
    assert.match(qualityView, /反馈保存后会自动归纳/);
    assert.match(qualityView, /重新核对规则/);
    assert.match(analysisPanel, /自动计入候选规则证据/);
});

test('API 静态契约：Knowledge V3 规则生命周期记录可追溯且只读', () => {
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const route = readUtf8(path.join(repoRoot, 'api/routes/quality.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const prompt = readAiPromptContractSource();
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));

    assert.match(schema, /CREATE TABLE IF NOT EXISTS factory_rule_events/);
    assert.match(schema, /idx_factory_rule_events_candidate/);
    assert.match(route, /router\.get\('\/rule-events'/);
    assert.match(service, /function recordFactoryRuleEvent/);
    assert.match(service, /function listFactoryRuleEvents/);
    assert.match(tools, /name: 'get_factory_rule_history'/);
    assert.equal(getAiCapability('get_factory_rule_history').access, 'read');
    assert.match(prompt, /使用 get_factory_rule_history/);
    assert.match(qualityView, /规则变更记录/);
    assert.doesNotMatch(qualityView, /恢复历史版本/);
});

test('API 静态契约：Knowledge V3 规则审核与派生知识保持事务一致', () => {
    const knowledge = readUtf8(path.join(repoRoot, 'api/services/knowledge.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const feedback = readUtf8(path.join(repoRoot, 'api/services/recipeAnalysisFeedback.cjs'));
    const prompt = readAiPromptContractSource();
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));

    assert.match(knowledge, /function syncFactoryRuleKnowledgeEntry/);
    assert.match(knowledge, /source_table = 'factory_rule_candidates'/);
    assert.match(knowledge, /hardDelete\('knowledge_entries'/);
    assert.match(service, /syncFactoryRuleKnowledgeEntry/);
    assert.match(service, /knowledgeSync/);
    assert.match(feedback, /hardDelete: remove/);
    assert.match(prompt, /无需再全量同步知识库/);
    assert.match(qualityView, /自动更新规则知识/);
});

test('API 静态契约：Knowledge V3 历史恢复只改变审核状态并保留当前证据', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/quality.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const prompt = readAiPromptContractSource();
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));

    assert.match(route, /router\.post\('\/rule-events\/:id\/restore'/);
    assert.match(service, /function restoreFactoryRuleEvent/);
    assert.match(service, /currentRuleLearningGroup\(database, current\.ruleKey\)/);
    assert.match(service, /factoryRuleApprovalGate\(currentGroup\?\.supportCount/);
    assert.match(service, /recordFactoryRuleEvent\(restored, 'restored'/);
    assert.match(service, /syncRuleKnowledge\(restored\.id/);
    assert.match(tools, /name: 'restore_factory_rule_event'/);
    assert.equal(getAiCapability('restore_factory_rule_event').access, 'write');
    assert.match(prompt, /恢复只改变审核状态，保留当前证据/);
    assert.match(executor, /\/api\/quality\/rule-events\/\$\{Number\(args\.eventId\)\}\/restore/);
    assert.match(qualityView, /恢复此状态/);
});

test('API 静态契约：Knowledge V3 低置信度规则禁止批准并自动撤回', () => {
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const prompt = readAiPromptContractSource();
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));
    const qualityClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quality.ts'));
    const docs = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));

    assert.match(service, /MINIMUM_APPROVAL_SUPPORT = 2/);
    assert.match(service, /MINIMUM_APPROVAL_CONFIDENCE = 0\.65/);
    assert.match(service, /function factoryRuleApprovalGate/);
    assert.match(service, /approval_suspended/);
    assert.match(service, /updatedCandidate\.status === 'approved' \|\| approvalSuspended/);
    assert.match(tools, /置信度不低于65%/);
    assert.match(prompt, /低于门槛不得建议强制批准/);
    assert.match(qualityClient, /approvalEligible: boolean/);
    assert.match(qualityView, /暂不能批准/);
    assert.match(qualityView, /低于门槛会自动撤回批准/);
    assert.match(docs, /至少两个不同配方[\s\S]*65%/);
});

test('API 静态契约：Knowledge V3 固化反馈证据来源并隔离范围漂移', () => {
    const feedbackService = readUtf8(path.join(repoRoot, 'api/services/recipeAnalysisFeedback.cjs'));
    const ruleService = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const prompt = readAiPromptContractSource();
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));
    const qualityClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quality.ts'));
    const docs = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));

    assert.match(feedbackService, /findingSnapshot\.evidenceContext/);
    assert.match(feedbackService, /templateId: Number\(recipe\.template_id/);
    assert.match(ruleService, /scopeDrift/);
    assert.match(ruleService, /\['supporting', 'specialCases', 'ignored', 'drifted', 'outdated'\]/);
    assert.match(ruleService, /driftedEvidence/);
    assert.match(tools, /范围漂移/);
    assert.match(prompt, /不计入支持数/);
    assert.match(qualityClient, /driftedCount: number/);
    assert.match(qualityView, /换模板或修改配方后都需要重新检查确认/);
    assert.match(docs, /证据来源快照[\s\S]*templateId[\s\S]*recipeUpdatedAt/);
});

test('API 静态契约：Knowledge V3 隔离配方修改后的过期反馈', () => {
    const intelligence = readUtf8(path.join(repoRoot, 'api/services/recipeIntelligence.cjs'));
    const ruleService = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const recipesRoute = readUtf8(path.join(repoRoot, 'api/routes/recipes.cjs'));
    const recipeCommands = readUtf8(path.join(repoRoot, 'api/services/recipeCommands.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));
    const analysisPanel = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipe/RecipeAnalysisPanel.tsx'));
    const qualityClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quality.ts'));
    const docs = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));

    assert.match(intelligence, /outdatedFeedbackCount/);
    assert.match(intelligence, /历史反馈不再抑制提醒/);
    assert.match(ruleService, /contentOutdated/);
    assert.match(ruleService, /outdatedEvidence/);
    assert.match(recipeCommands, /function refreshRecipeRuleLearningIfNeeded/);
    assert.match(recipeCommands, /decision IN \('confirmed', 'special_case', 'ignored'\)/);
    assert.match(recipeCommands, /dependencies\.refreshFactoryRuleCandidates\(\{/);
    assert.match(recipesRoute, /executeRecipeDelete\(/);
    assert.match(recipeCommands, /safeUpdate\(\s*'recipes',\s*recipeId,\s*\{ deleted_at: deletedAt \}/);
    assert.match(recipeCommands, /refreshRecipeRuleLearningIfNeeded\(/);
    assert.match(tools, /内容过期/);
    assert.match(qualityClient, /outdatedCount: number/);
    assert.match(qualityView, /内容过期/);
    assert.match(analysisPanel, /反馈已过期/);
    assert.match(docs, /内容过期/);
});

test('API 静态契约：Knowledge V3 扫描全部学习反馈并形成待复核队列', () => {
    const ruleService = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const route = readUtf8(path.join(repoRoot, 'api/routes/quality.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));
    const qualityClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quality.ts'));
    const docs = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));

    assert.match(ruleService, /function buildFactoryLearningHealth/);
    assert.match(ruleService, /LEFT JOIN recipes ON recipes\.id = feedback\.recipe_id/);
    assert.match(ruleService, /recheckEvidenceCount/);
    assert.match(ruleService, /archivedEvidenceCount/);
    assert.match(route, /router\.get\('\/rule-learning-health'/);
    assert.match(tools, /name: 'get_factory_learning_health'/);
    assert.match(executor, /case 'get_factory_learning_health'/);
    assert.match(qualityClient, /getFactoryLearningHealth/);
    assert.match(qualityView, /学习证据待重新检查/);
    assert.match(qualityView, /尚未形成候选规则/);
    assert.match(docs, /学习证据健康检查/);
});

test('API 静态契约：Knowledge V3 待复核证据可直达配方并自动智能检查', () => {
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));
    const recipesView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));
    const docs = readUtf8(path.join(repoRoot, 'docs/README.md'));
    const businessFlow = readUtf8(path.join(repoRoot, 'docs/business-flow.md'));

    assert.match(qualityView, /`\/recipes\?recipeId=\$\{group\.recipeId\}&feedbackIds=\$\{feedbackIds\}&action=smart-check`/);
    assert.match(qualityView, /重新检查/);
    assert.match(recipesView, /function parseRecipeReviewTarget/);
    assert.match(recipesView, /params\.get\('action'\) === 'smart-check'/);
    assert.match(recipesView, /openEditDrawer\(recipe\)/);
    assert.match(recipesView, /setAutoAnalyzeRecipeId\(recipe\.id\)/);
    assert.match(recipesView, /nextUrl\.searchParams\.delete\('action'\)/);
    assert.match(recipesView, /void runRecipeAnalysis\(\)/);
    assert.match(docs, /自动执行一次智能检查/);
    assert.match(businessFlow, /自动执行一次智能检查/);
});

test('API 静态契约：Knowledge V3 已消失的待复核提醒可确认解决', () => {
    const feedbackService = readUtf8(path.join(repoRoot, 'api/services/recipeAnalysisFeedback.cjs'));
    const route = readUtf8(path.join(repoRoot, 'api/routes/quality.cjs'));
    const qualityClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quality.ts'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));
    const analysisPanel = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipe/RecipeAnalysisPanel.tsx'));
    const docs = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));

    assert.match(feedbackService, /function resolveRecipeAnalysisFeedback/);
    assert.match(feedbackService, /decision: 'review'/);
    assert.match(feedbackService, /这条反馈仍对应当前配方版本/);
    assert.match(feedbackService, /analysisContainsFinding/);
    assert.match(feedbackService, /原提醒在当前配方智能检查中仍然存在/);
    assert.match(route, /router\.post\('\/recipe-feedback\/:id\/resolve'/);
    assert.match(qualityClient, /resolveRecipeAnalysisFeedback/);
    assert.match(qualityView, /feedbackIds=\$\{feedbackIds\}/);
    assert.match(analysisPanel, /data-review-target/);
    assert.match(analysisPanel, /确认已解决/);
    assert.match(analysisPanel, /原待复核提醒/);
    assert.match(docs, /确认已解决/);
});

test('API 静态契约：Knowledge V3 同一配方待复核反馈按任务聚合并顺序处理', () => {
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));
    const recipesView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));
    const analysisPanel = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipe/RecipeAnalysisPanel.tsx'));
    const docs = readUtf8(path.join(repoRoot, 'docs/README.md'));
    const businessFlow = readUtf8(path.join(repoRoot, 'docs/business-flow.md'));

    assert.match(qualityView, /const evidenceRecheckGroups = useMemo/);
    assert.match(qualityView, /group\.items\.map\(\(item\) => item\.feedbackId\)\.join\(','\)/);
    assert.match(qualityView, /处理 \{group\.items\.length\} 条/);
    assert.match(recipesView, /params\.get\('feedbackIds'\)/);
    assert.match(recipesView, /setReviewEvidenceTargets\(evidence\)/);
    assert.match(recipesView, /function completeCurrentReviewEvidence/);
    assert.match(recipesView, /继续处理下一条/);
    assert.match(analysisPanel, /待复核进度：第/);
    assert.match(docs, /按配方聚合/);
    assert.match(businessFlow, /按配方聚合/);
});

test('API 静态契约：Knowledge V3 待复核工作台展示规则影响并完成闭环', () => {
    const recipesView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));
    const analysisPanel = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipe/RecipeAnalysisPanel.tsx'));
    const docs = readUtf8(path.join(repoRoot, 'docs/README.md'));
    const apiDocs = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));
    const businessFlow = readUtf8(path.join(repoRoot, 'docs/business-flow.md'));

    assert.match(recipesView, /setReviewRuleLearning\(result\.ruleLearning \|\| null\)/);
    assert.match(analysisPanel, /规则学习已按本次判断刷新/);
    assert.match(recipesView, /function skipCurrentReviewEvidence/);
    assert.match(recipesView, /原反馈状态没有改变/);
    assert.match(recipesView, /nextUrl\.searchParams\.delete\('feedbackIds'\)/);
    assert.match(recipesView, /window\.location\.assign\('\/dashboard\?view=quality'\)/);
    assert.match(analysisPanel, /返回数据质量/);
    assert.match(docs, /规则学习刷新结果/);
    assert.match(apiDocs, /暂时跳过只调整本地处理顺序/);
    assert.match(businessFlow, /暂时跳过只改变当前页面的处理顺序/);
});

test('API 静态契约：Knowledge V4 核心业务变更自动合并同步并保留人工兜底', () => {
    const db = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const app = readUtf8(path.join(repoRoot, 'api.cjs'));
    const autoSync = readUtf8(path.join(repoRoot, 'api/services/knowledgeAutoSync.cjs'));
    const knowledgeService = readUtf8(path.join(repoRoot, 'api/services/knowledge.cjs'));
    const knowledgeRoute = readUtf8(path.join(repoRoot, 'api/routes/knowledge.cjs'));
    const knowledgeView = readUtf8(path.join(repoRoot, 'apps/web-next/components/knowledge-view.tsx'));
    const docs = readUtf8(path.join(repoRoot, 'docs/README.md'));
    const apiDocs = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));

    assert.match(db, /notifyKnowledgeSourceChange/);
    assert.match(db, /requestAutoKnowledgeSync/);
    assert.match(autoSync, /AUTO_SYNC_SOURCE_TABLES/);
    assert.match(autoSync, /DEFAULT_RETRY_DELAYS_MS/);
    assert.match(autoSync, /pendingSources/);
    assert.match(autoSync, /recordExternalSuccess/);
    assert.match(app, /requestFullAutoKnowledgeSync\('api_startup'\)/);
    assert.match(knowledgeService, /autoSync: options\.autoSyncStatus \|\| getAutoKnowledgeSyncStatus\(\)/);
    assert.match(knowledgeRoute, /recordKnowledgeSyncSuccess\(data, 'manual', \{/);
    assert.match(knowledgeView, /自动同步正常/);
    assert.match(knowledgeView, /手动同步用于全量核对和故障恢复/);
    assert.match(docs, /核心业务知识自动同步/);
    assert.match(apiDocs, /autoSync/);
});

test('API 静态契约：Knowledge V4 同步成功、失败和重试历史可追溯', () => {
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const migrations = readUtf8(path.join(repoRoot, 'api/database/migrations.cjs'));
    const db = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const autoSync = readUtf8(path.join(repoRoot, 'api/services/knowledgeAutoSync.cjs'));
    const history = readUtf8(path.join(repoRoot, 'api/services/knowledgeSyncHistory.cjs'));
    const route = readUtf8(path.join(repoRoot, 'api/routes/knowledge.cjs'));
    const knowledgeView = readUtf8(path.join(repoRoot, 'apps/web-next/components/knowledge-view.tsx'));
    const knowledgeLib = readUtf8(path.join(repoRoot, 'apps/web-next/lib/knowledge.ts'));
    const docs = readUtf8(path.join(repoRoot, 'docs/README.md'));

    assert.match(schema, /CREATE TABLE IF NOT EXISTS knowledge_sync_runs/);
    assert.match(migrations, /version: 21/);
    assert.match(db, /function knowledgeSyncRunRow/);
    assert.match(db, /'knowledge_sync_runs'/);
    assert.match(autoSync, /persistRun/);
    assert.match(autoSync, /recordExternalFailure/);
    assert.match(history, /MAX_RETAINED_RUNS = 200/);
    assert.match(history, /recordKnowledgeSyncRun/);
    assert.match(route, /router\.get\('\/sync-runs'/);
    assert.match(route, /recordKnowledgeSyncFailure/);
    assert.match(knowledgeLib, /getKnowledgeSyncRuns/);
    assert.match(knowledgeView, /同步记录/);
    assert.match(knowledgeView, /第 \{run\.attempt\} 次尝试/);
    assert.match(docs, /同步运行历史/);
});

test('API 静态契约：Knowledge V4 健康告警只在真实异常时提供恢复入口', () => {
    const health = readUtf8(path.join(repoRoot, 'api/services/knowledgeSyncHealth.cjs'));
    const route = readUtf8(path.join(repoRoot, 'api/routes/knowledge.cjs'));
    const knowledgeView = readUtf8(path.join(repoRoot, 'apps/web-next/components/knowledge-view.tsx'));
    const knowledgeLib = readUtf8(path.join(repoRoot, 'apps/web-next/lib/knowledge.ts'));
    const docs = readUtf8(path.join(repoRoot, 'docs/README.md'));
    const apiDocs = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));

    assert.match(health, /unscheduled_changes/);
    assert.match(health, /sync_pending_too_long/);
    assert.match(health, /sync_running_too_long/);
    assert.match(health, /sync_failed/);
    assert.match(health, /pendingTotal > 0/);
    assert.match(route, /router\.get\('\/health'/);
    assert.match(knowledgeLib, /getKnowledgeSyncHealth/);
    assert.match(knowledgeView, /syncHealth\.status !== 'healthy'/);
    assert.match(knowledgeView, /检查并恢复/);
    assert.match(knowledgeView, /setSyncOpen\(true\)/);
    assert.match(docs, /知识同步健康检查/);
    assert.match(apiDocs, /\/api\/knowledge\/health/);
});

test('API 静态契约：Knowledge V4 AI 可只读诊断同步健康状态', () => {
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const registry = readUtf8(path.join(repoRoot, 'api/capabilities/registry.cjs'));
    const businessExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));
    const chat = readAiPromptContractSource();
    const prompt = readAiPromptContractSource();

    assert.match(tools, /name: 'get_factory_knowledge_health'/);
    assert.equal(getAiCapability('get_factory_knowledge_health').access, 'read');
    assert.match(registry, /'get_factory_knowledge_health'/);
    assert.match(businessExecutor, /case 'get_factory_knowledge_health'/);
    assert.match(businessExecutor, /\/api\/knowledge\/health/);
    assert.match(chat, /get_factory_knowledge_health/);
    assert.match(prompt, /get_factory_knowledge_health/);
});

test('API 静态契约：Knowledge V5 独立工厂资料进入检索与来源追溯', () => {
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const migrations = readUtf8(path.join(repoRoot, 'api/database/migrations.cjs'));
    const db = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const parser = readUtf8(path.join(repoRoot, 'api/services/knowledgeDocumentParser.cjs'));
    const knowledge = readUtf8(path.join(repoRoot, 'api/services/knowledge.cjs'));
    const documents = readUtf8(path.join(repoRoot, 'api/services/knowledgeDocuments.cjs'));
    const route = readUtf8(path.join(repoRoot, 'api/routes/knowledge.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const chat = readAiPromptContractSource();
    const knowledgeLib = readUtf8(path.join(repoRoot, 'apps/web-next/lib/knowledge.ts'));
    const knowledgeView = readUtf8(path.join(repoRoot, 'apps/web-next/components/knowledge-view.tsx'));
    const knowledgeDialogs = readUtf8(path.join(
        repoRoot,
        'apps/web-next/components/knowledge/KnowledgeDialogs.tsx',
    ));
    const knowledgeUi = `${knowledgeView}\n${knowledgeDialogs}`;

    assert.match(schema, /CREATE TABLE IF NOT EXISTS knowledge_documents/);
    assert.match(migrations, /version: 22/);
    assert.match(db, /function knowledgeDocumentRow/);
    assert.match(db, /dbGetAllKnowledgeDocuments/);
    assert.match(db, /'knowledge_documents'/);
    assert.match(parser, /metadata_only/);
    assert.match(parser, /parsePumpTestReport/);
    assert.match(knowledge, /entryType: 'document'/);
    assert.match(knowledge, /sourceTable: 'knowledge_documents'/);
    assert.match(knowledge, /不得据此推断图纸尺寸、材料或技术参数/);
    assert.match(documents, /executePersistentCommand/);
    assert.match(documents, /safeInsert\(\s*'knowledge_documents'/);
    assert.match(documents, /safeUpdate\(\s*'knowledge_documents'/);
    assert.match(documents, /assertExpectedUpdatedAt/);
    assert.match(route, /executeKnowledgeDocumentUpload/);
    assert.match(route, /executeKnowledgeDocumentDelete/);
    assert.match(route, /router\.get\('\/documents\/:id\/download'/);
    assert.match(tools, /'document'/);
    assert.match(chat, /parserStatus=metadata_only/);
    assert.match(knowledgeLib, /uploadKnowledgeDocument/);
    assert.match(knowledgeLib, /deleteKnowledgeDocument/);
    assert.match(knowledgeUi, /导入工厂资料/);
    assert.match(knowledgeUi, /下载原文件/);
    assert.match(knowledgeUi, /删除资料/);
});

test('API 静态契约：V9.1 统一文件对象保留原文件、类型和业务来源', () => {
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const migrations = readUtf8(path.join(repoRoot, 'api/database/migrations.cjs'));
    const db = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const store = readUtf8(path.join(repoRoot, 'api/services/factoryFileStore.cjs'));
    const filesRoute = readUtf8(path.join(repoRoot, 'api/routes/files.cjs'));
    const knowledgeDocuments = readUtf8(path.join(
        repoRoot,
        'api/services/knowledgeDocuments.cjs'
    ));
    const recipesRoute = readUtf8(path.join(repoRoot, 'api/routes/recipes.cjs'));
    const recipeTechnicalFiles = readUtf8(path.join(
        repoRoot,
        'api/services/recipeTechnicalFiles.cjs'
    ));

    assert.match(schema, /CREATE TABLE IF NOT EXISTS factory_files/);
    assert.match(schema, /detected_type TEXT NOT NULL/);
    assert.match(schema, /file_sha256 TEXT NOT NULL UNIQUE/);
    assert.match(schema, /source_type TEXT NOT NULL DEFAULT 'direct_upload'/);
    assert.match(migrations, /version: 31/);
    assert.match(migrations, /unified_factory_file_objects/);
    assert.match(db, /'factory_files'/);
    assert.match(store, /DANGEROUS_NAME_SEGMENT_RE/);
    assert.match(store, /isUtf8/);
    assert.match(store, /validateSpreadsheet/);
    assert.match(filesRoute, /multer\.memoryStorage/);
    assert.match(filesRoute, /MAX_FACTORY_FILE_SIZE/);
    assert.match(knowledgeDocuments, /file_id: stored\?\.file\.id \|\| null/);
    assert.match(recipesRoute, /recipeTechnicalFileDependencies/);
    assert.match(recipeTechnicalFiles, /file_id: stored\.file\.id/);
    assert.match(knowledgeDocuments, /LEFT JOIN factory_files/);
    assert.match(recipeTechnicalFiles, /LEFT JOIN factory_files/);
});

test('API 静态契约：V9.1 AI 聊天附件经过统一文件库并按模型能力传递', () => {
    const chat = readAiPromptContractSource();
    const provider = readUtf8(path.join(repoRoot, 'api/services/aiProvider.cjs'));
    const conversations = readUtf8(path.join(repoRoot, 'api/services/aiConversations.cjs'));
    const aiView = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai-view.tsx'));
    const aiAttachments = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/useAiAttachments.ts'));
    const aiComposer = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/AiComposer.tsx'));

    assert.match(chat, /router\.get\('\/api\/ai\/capabilities'/);
    assert.match(chat, /fetchAiProvider/);
    assert.match(provider, /AI_PROVIDER/);
    assert.match(provider, /KIMI_API_KEY/);
    assert.match(provider, /type: 'image_url'/);
    assert.match(provider, /不支持直接识图/);
    assert.match(conversations, /resolveMessageAttachments/);
    assert.match(conversations, /FROM factory_files/);
    assert.match(aiAttachments, /uploadFactoryFile/);
    assert.match(aiComposer, /Paperclip/);
    assert.match(aiView, /pendingAttachments/);
});

test('API 静态契约：V9.2 PDF 解析保留页码定位并按状态进入 AI 上下文', () => {
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const migrations = readUtf8(path.join(repoRoot, 'api/database/migrations.cjs'));
    const parser = readUtf8(path.join(repoRoot, 'api/services/factoryPdfParser.cjs'));
    const fileParser = readUtf8(path.join(repoRoot, 'api/services/factoryFileParser.cjs'));
    const filesRoute = readUtf8(path.join(repoRoot, 'api/routes/files.cjs'));
    const provider = readUtf8(path.join(repoRoot, 'api/services/aiProvider.cjs'));
    const attachmentDisplays = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/AiAttachmentDisplays.tsx'));

    assert.match(schema, /parsed_text TEXT NOT NULL DEFAULT ''/);
    assert.match(schema, /parsed_json TEXT NOT NULL DEFAULT '\{\}'/);
    assert.match(migrations, /version: 33/);
    assert.match(migrations, /factory_file_parsed_content/);
    assert.match(parser, /pdfjs-dist\/legacy\/build\/pdf\.mjs/);
    assert.match(parser, /pageNumber/);
    assert.match(parser, /detectTables/);
    assert.match(parser, /requiresOcr/);
    assert.match(fileParser, /accessors\.safeUpdate\(\s*'factory_files'/);
    assert.match(filesRoute, /router\.post\('\/:id\/parse'/);
    assert.match(filesRoute, /router\.get\('\/:id\/content'/);
    assert.match(provider, /解析内容（含 OCR）/);
    assert.match(provider, /本轮不能推断扫描图片中的内容/);
    assert.match(attachmentDisplays, /attachmentParserText/);
});

test('API 静态契约：V9.3 表格解析和报价映射保持只读业务边界', () => {
    const parser = readUtf8(path.join(repoRoot, 'api/services/factorySpreadsheetParser.cjs'));
    const mapper = readUtf8(path.join(repoRoot, 'api/services/factoryQuotationDraft.cjs'));
    const fileParser = readUtf8(path.join(repoRoot, 'api/services/factoryFileParser.cjs'));
    const filesRoute = readUtf8(path.join(repoRoot, 'api/routes/files.cjs'));
    const provider = readUtf8(path.join(repoRoot, 'api/services/aiProvider.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const chat = readAiPromptContractSource();
    const lifecycle = readUtf8(path.join(repoRoot, 'api/services/managementActionLifecycle.cjs'));
    const attachmentDisplays = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/AiAttachmentDisplays.tsx'));
    const resultPrimitives = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/AiResultPrimitives.tsx'));

    assert.match(parser, /version: 'spreadsheet-v1'/);
    assert.match(parser, /cellRef/);
    assert.match(parser, /formulaCount/);
    assert.match(mapper, /readyForSaveDraft/);
    assert.match(mapper, /quotationDraftInput/);
    assert.match(mapper, /只读解析和映射草稿/);
    assert.doesNotMatch(mapper, /safeInsert|safeUpdate|INSERT INTO quotations/);
    assert.match(fileParser, /parseSpreadsheetBuffer/);
    assert.match(filesRoute, /router\.post\('\/:id\/quotation-draft'/);
    const draftStart = filesRoute.indexOf("router.post('/:id/quotation-draft'");
    const draftEnd = filesRoute.indexOf("router.get('/:id/links'", draftStart);
    const draftRoute = filesRoute.slice(draftStart, draftEnd);
    assert.match(draftRoute, /factory_file_parse_required/);
    assert.doesNotMatch(draftRoute, /executeFactoryFileParse/);
    assert.match(provider, /inspect_quotation_file/);
    assert.match(tools, /name: 'inspect_quotation_file'/);
    assert.match(chat, /readyForSaveDraft=true/);
    assert.match(lifecycle, /quotation-draft/);
    assert.match(attachmentDisplays, /attachmentParserText/);
    assert.match(resultPrimitives, /已读取 \$\{sheets\} 个表/);
});

test('API 静态契约：V9.4 图片和扫描 PDF 使用本地 OCR 且候选参数只读', () => {
    const ocr = readUtf8(path.join(repoRoot, 'api/services/factoryOcrParser.cjs'));
    const candidates = readUtf8(path.join(repoRoot, 'api/services/factoryDrawingCandidates.cjs'));
    const fileParser = readUtf8(path.join(repoRoot, 'api/services/factoryFileParser.cjs'));
    const provider = readUtf8(path.join(repoRoot, 'api/services/aiProvider.cjs'));
    const chat = readAiPromptContractSource();
    const attachmentDisplays = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/AiAttachmentDisplays.tsx'));
    const resultPrimitives = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/AiResultPrimitives.tsx'));

    assert.match(ocr, /@tesseract\.js-data\/chi_sim/);
    assert.match(ocr, /@tesseract\.js-data\/eng/);
    assert.match(ocr, /renderPdfPages/);
    assert.match(ocr, /drawingCandidates/);
    assert.match(candidates, /needsReview/);
    assert.match(candidates, /pageNumber/);
    assert.match(fileParser, /parseScannedPdfBuffer/);
    assert.match(fileParser, /detected_type === 'image'/);
    assert.match(provider, /本地 OCR 结果/);
    assert.match(chat, /任何 OCR 候选都不得自动写入/);
    assert.match(attachmentDisplays, /attachmentParserText/);
    assert.match(resultPrimitives, /OCR 未识别到文字/);
});

test('API 静态契约：V5.2 订单生产准备检查复用库存计划且保持只读', () => {
    const service = readUtf8(path.join(repoRoot, 'api/services/orderReadiness.cjs'));
    const readinessService = readUtf8(path.join(repoRoot, 'api/services/activeOrderReadiness.cjs'));
    const ordersRoute = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/orderExecutors.cjs'));
    const prompt = readAiPromptContractSource();
    assert.match(service, /waiting_materials/);
    assert.match(service, /needs_review/);
    assert.match(service, /currentStock/);
    assert.match(service, /inventoryType === 'none'/);
    assert.match(service, /price_below_cost/);
    assert.match(ordersRoute, /router\.get\('\/:id\/readiness'/);
    assert.match(ordersRoute, /buildOrderReadinessContext/);
    assert.match(readinessService, /buildBalancedOrderPlans/);
    assert.match(tools, /name:\s*'check_order_readiness'/);
    assert.match(executor, /\/api\/orders\/\$\{resolved\.orderId\}\/readiness/);
    assert.match(prompt, /已下单或已到货不等于已经入库/);
    assert.equal(getAiCapability('check_order_readiness').access, 'read');
});

test('API 静态契约：V5.3 订单处理方案有依赖顺序且只生成不执行', () => {
    const service = readUtf8(path.join(repoRoot, 'api/services/orderReadinessPlan.cjs'));
    const ordersRoute = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/orderExecutors.cjs'));
    const prompt = readAiPromptContractSource();
    assert.match(service, /dependsOn/);
    assert.match(service, /mode:\s*'confirmable'/);
    assert.match(service, /mode:\s*'needs_input'/);
    assert.match(service, /'track_purchase_arrival', 'monitor'/);
    assert.match(service, /toolCall/);
    assert.doesNotMatch(service, /safeInsert|safeUpdate|softDelete|hardDelete/);
    assert.match(ordersRoute, /router\.get\('\/:id\/readiness-plan'/);
    assert.match(ordersRoute, /router\.get\('\/lookup'/);
    assert.match(tools, /name:\s*'plan_order_readiness_actions'/);
    assert.match(executor, /\/api\/orders\/\$\{resolved\.orderId\}\/readiness-plan/);
    assert.match(executor, /\/api\/orders\/lookup\?query=/);
    assert.match(prompt, /confirmable 只表示AI以后可以发起确认/);
    assert.equal(getAiCapability('plan_order_readiness_actions').access, 'read');
});

test('API 静态契约：V5.4 订单方案执行受确认和实时重验双重保护', () => {
    const ordersRoute = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const commandService = readUtf8(path.join(repoRoot, 'api/services/orderReadinessCommands.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/orderExecutors.cjs'));
    const aiExecution = readUtf8(path.join(repoRoot, 'api/services/aiOrderReadinessExecution.cjs'));
    const confirmation = readUtf8(path.join(repoRoot, 'api/routes/ai/executor.cjs'));
    const prompt = readAiPromptContractSource();
    assert.match(ordersRoute, /router\.post\('\/:id\/readiness-actions\/:actionId'/);
    assert.match(ordersRoute, /executeOrderReadinessAction/);
    assert.match(commandService, /action\.mode !== 'confirmable'/);
    assert.match(commandService, /action\.status !== 'available'/);
    assert.match(commandService, /executePersistentCommand/);
    assert.match(commandService, /assertExpectedUpdatedAt/);
    assert.match(commandService, /assertPreviewHash/);
    assert.match(tools, /name:\s*'execute_order_readiness_action'/);
    assert.equal(getAiCapability('execute_order_readiness_action').access, 'write');
    assert.match(executor, /return executeOrderReadinessAction\(args/);
    assert.doesNotMatch(executor, /readiness-actions\/\$\{encodeURIComponent\(actionId\)\}/);
    assert.match(aiExecution, /readiness-actions\/\$\{encodeURIComponent\(actionId\)\}/);
    assert.match(aiExecution, /command\?\.expectedUpdatedAt/);
    assert.match(aiExecution, /command\?\.previewHash/);
    assert.match(aiExecution, /command\?\.suggestedIdempotencyKey/);
    assert.match(confirmation, /case 'execute_order_readiness_action'/);
    assert.match(prompt, /确认时后端会再次重验/);
    assert.match(prompt, /禁止执行 manual、needs_input、monitor 或 blocked/);
});

test('API 静态契约：V5.5 订单准备总览对 API、AI 和只读边界保持一致', () => {
    const service = readUtf8(path.join(repoRoot, 'api/services/orderReadinessOverview.cjs'));
    const ordersRoute = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/orderExecutors.cjs'));
    const prompt = readAiPromptContractSource();

    assert.match(service, /attentionRequired/);
    assert.match(service, /waiting_materials/);
    assert.match(service, /nextAction/);
    assert.doesNotMatch(service, /safeInsert|safeUpdate|softDelete|hardDelete/);
    assert.match(ordersRoute, /router\.get\('\/readiness-overview'/);
    assert.match(tools, /name:\s*'get_order_readiness_overview'/);
    assert.match(executor, /\/api\/orders\/readiness-overview/);
    assert.match(prompt, /哪些订单不能生产/);
    assert.equal(getAiCapability('get_order_readiness_overview').access, 'read');
});

test('API 静态契约：V10.4 订单知识包只读取实时状态和人工确认事实', () => {
    const service = readUtf8(path.join(repoRoot, 'api/services/orderKnowledgePackage.cjs'));
    const ordersRoute = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/orderExecutors.cjs'));
    const pageContext = readUtf8(path.join(repoRoot, 'api/services/aiPageContext.cjs'));

    assert.match(service, /confirmedKnowledge/);
    assert.match(service, /pendingDraftCount/);
    assert.match(service, /buildOrderReadinessPlan/);
    assert.doesNotMatch(service, /safeInsert|safeUpdate|softDelete|hardDelete/);
    assert.match(ordersRoute, /router\.get\('\/:id\/knowledge-package'/);
    assert.match(tools, /name:\s*'get_order_knowledge_package'/);
    assert.match(executor, /\/api\/orders\/\$\{resolved\.orderId\}\/knowledge-package/);
    assert.match(pageContext, /'execution'/);
    assert.equal(getAiCapability('get_order_knowledge_package').access, 'read');
});

test('API 静态契约：V5.8 管理待办统一聚合并保持只读', () => {
    const service = readUtf8(path.join(repoRoot, 'api/services/managementActionCenter.cjs'));
    const workbench = readUtf8(path.join(repoRoot, 'api/routes/workbench.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));
    const prompt = readAiPromptContractSource();
    const catalog = readUtf8(path.join(repoRoot, 'api/services/aiCapabilityCatalogV2.cjs'));

    assert.match(service, /order_readiness/);
    assert.match(service, /business_risk/);
    assert.match(service, /data_quality/);
    assert.match(service, /rule_learning/);
    assert.match(service, /knowledge_health/);
    assert.doesNotMatch(service, /safeInsert|safeUpdate|softDelete|hardDelete/);
    assert.match(workbench, /router\.get\('\/action-center'/);
    assert.match(tools, /name:\s*'get_management_action_center'/);
    assert.match(executor, /\/api\/workbench\/action-center/);
    assert.match(prompt, /今天先做什么/);
    assert.match(catalog, /listAiCapabilities/);
    assert.equal(getAiCapability('get_management_action_center').access, 'read');
});

test('API 静态契约：V7.1 管理事项生命周期后台追踪且查看接口保持只读', () => {
    const lifecycle = readUtf8(path.join(repoRoot, 'api/services/managementActionLifecycle.cjs'));
    const center = readUtf8(path.join(repoRoot, 'api/services/managementActionCenter.cjs'));
    const workbench = readUtf8(path.join(repoRoot, 'api/routes/workbench.cjs'));
    const api = readUtf8(path.join(repoRoot, 'api.cjs'));
    const dashboard = readUtf8(path.join(repoRoot, 'apps/web-next/components/management-action-center.tsx'));

    assert.match(lifecycle, /management_action_lifecycles/);
    assert.match(lifecycle, /management_action_events/);
    assert.match(lifecycle, /event_type:\s*'appeared'/);
    assert.match(lifecycle, /event_type:\s*'resolved'/);
    assert.match(lifecycle, /event_type:\s*'reopened'/);
    assert.match(lifecycle, /safeInsert/);
    assert.match(lifecycle, /safeUpdate/);
    assert.match(lifecycle, /reconcile\.immediate\(\)/);
    assert.doesNotMatch(center, /safeInsert|safeUpdate|softDelete|hardDelete/);
    assert.match(workbench, /decorateManagementActionCenter\(center\)/);
    assert.match(workbench, /router\.get\('\/action-history'/);
    assert.doesNotMatch(workbench, /safeInsert|safeUpdate|softDelete|hardDelete/);
    assert.match(api, /startManagementActionLifecycleMonitor\(\)/);
    assert.match(dashboard, /occurrenceCount/);
    assert.match(dashboard, /自动归档记录/);
});

test('API 静态契约：V7.2 今日执行队列可解释排序且保持只读', () => {
    const queue = readUtf8(path.join(repoRoot, 'api/services/managementExecutionQueue.cjs'));
    const lifecycle = readUtf8(path.join(repoRoot, 'api/services/managementActionLifecycle.cjs'));
    const dashboard = readUtf8(path.join(repoRoot, 'apps/web-next/components/management-action-center.tsx'));
    const workflowResults = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/AiWorkflowResults.tsx'));

    assert.match(queue, /PRIORITY_BASE/);
    assert.match(queue, /duration/);
    assert.match(queue, /recurrence/);
    assert.match(queue, /impact/);
    assert.match(queue, /reasons/);
    assert.doesNotMatch(queue, /safeInsert|safeUpdate|softDelete|hardDelete/);
    assert.match(lifecycle, /buildManagementExecutionQueue\(decorated\)/);
    assert.match(dashboard, /今日执行队列/);
    assert.match(dashboard, /executionQueue\.items/);
    assert.match(workflowResults, /executionQueue\.summary/);
});

test('API 静态契约：V7.3 最短处理路径只复用受保护的现有写入口', () => {
    const center = readUtf8(path.join(repoRoot, 'api/services/managementActionCenter.cjs'));
    const overview = readUtf8(path.join(repoRoot, 'api/services/orderReadinessOverview.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const prompt = readAiPromptContractSource();
    const dashboard = readUtf8(path.join(repoRoot, 'apps/web-next/components/management-action-center.tsx'));
    const aiPage = readUtf8(path.join(repoRoot, 'apps/web-next/app/ai/page.tsx'));

    assert.match(center, /resolution:\s*actionResolution/);
    assert.match(center, /canAiConfirm/);
    assert.match(center, /toolName:\s*'execute_order_readiness_action'/);
    assert.match(overview, /expectedResult/);
    assert.doesNotMatch(center, /safeInsert|safeUpdate|softDelete|hardDelete/);
    assert.match(tools, /resolution\.canAiConfirm=true/);
    assert.match(prompt, /available\+confirmable/);
    assert.match(dashboard, /交给 AI/);
    assert.match(dashboard, /完成后：/);
    assert.match(aiPage, /initialPrompt/);
});

test('API 静态契约：V7.4 业务写入后自动复查并统一汇总处理进展', () => {
    const api = readUtf8(path.join(repoRoot, 'api.cjs'));
    const lifecycle = readUtf8(path.join(repoRoot, 'api/services/managementActionLifecycle.cjs'));
    const workbench = readUtf8(path.join(repoRoot, 'api/routes/workbench.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const prompt = readAiPromptContractSource();
    const dashboard = readUtf8(path.join(repoRoot, 'apps/web-next/components/management-action-center.tsx'));

    assert.match(api, /res\.once\('finish'/);
    assert.match(api, /shouldRecheckManagementActions/);
    assert.match(api, /requestManagementActionLifecycleRecheck/);
    assert.match(lifecycle, /DEFAULT_RECHECK_DELAY_MS/);
    assert.match(lifecycle, /status:\s*'resolved'/);
    assert.match(lifecycle, /buildManagementActionProgress/);
    assert.match(lifecycle, /resolvedCount/);
    assert.match(lifecycle, /unresolvedCount/);
    assert.match(lifecycle, /blockedCount/);
    assert.match(lifecycle, /recurringCount/);
    assert.match(workbench, /router\.get\('\/action-center'/);
    assert.doesNotMatch(workbench, /router\.(?:post|patch|delete)\('\/action-center'/);
    assert.match(tools, /自动归档/);
    assert.match(prompt, /progress\.resolvedItems/);
    assert.match(dashboard, /自动复查进展/);
    assert.match(dashboard, /自动归档记录/);
});

test('API 静态契约：V8.2 报价转单只复用确认、事务接口和实时复查', () => {
    const plan = readUtf8(path.join(repoRoot, 'api/services/factoryExecutionPlan.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));
    const workflowExecution = readUtf8(path.join(repoRoot, 'api/services/aiFactoryWorkflowExecution.cjs'));
    const quotationRoute = readUtf8(path.join(repoRoot, 'api/routes/quotations.cjs'));
    const quotationService = readUtf8(path.join(repoRoot, 'api/services/quotationConversion.cjs'));

    assert.match(plan, /toolName: 'execute_factory_workflow_step'/);
    assert.match(plan, /actionId: 'convert_quotation'/);
    assert.match(tools, /'execute_factory_workflow_step'/);
    assert.match(executor, /return executeFactoryWorkflowStep\(args/);
    assert.doesNotMatch(executor, /执行前刷新工厂计划失败/);
    assert.match(workflowExecution, /执行前刷新工厂计划失败/);
    assert.match(workflowExecution, /\/api\/quotations\/\$\{quotationId\}\/order-draft/);
    assert.match(workflowExecution, /\/api\/quotations\/\$\{quotationId\}\/convert/);
    assert.match(workflowExecution, /conversionDraft\.expectedUpdatedAt/);
    assert.match(workflowExecution, /\/api\/orders\/\$\{orderId\}\/readiness-plan/);
    assert.match(quotationRoute, /executeQuotationConversion/);
    assert.match(quotationService, /executePersistentCommand/);
    assert.match(quotationService, /该报价已经转为订单，不能重复转单/);
});

test('API 静态契约：V8.4 执行历史保存结果、错误和实时恢复边界', () => {
    const migrations = readUtf8(path.join(repoRoot, 'api/database/migrations.cjs'));
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const db = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const history = readUtf8(path.join(repoRoot, 'api/services/factoryWorkflowHistory.cjs'));
    const workbench = readUtf8(path.join(repoRoot, 'api/routes/workbench.cjs'));
    const businessExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));
    const workflowExecution = readUtf8(path.join(repoRoot, 'api/services/aiFactoryWorkflowExecution.cjs'));
    const orderExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/orderExecutors.cjs'));
    const orderExecution = readUtf8(path.join(repoRoot, 'api/services/aiOrderReadinessExecution.cjs'));

    assert.match(migrations, /version: 30/);
    assert.match(migrations, /CREATE TABLE IF NOT EXISTS factory_workflow_runs/);
    assert.match(schema, /'factory_workflow_runs'/);
    assert.match(db, /'factory_workflow_runs'/);
    assert.match(history, /plan_fingerprint/);
    assert.match(history, /latestRecheck/);
    assert.match(history, /recoverableActionIds/);
    assert.match(workbench, /\/execution-runs/);
    assert.match(businessExecutor, /executeFactoryWorkflowStep/);
    assert.match(workflowExecution, /status: writeCompleted \? 'completed' : 'failed'/);
    assert.match(orderExecutor, /executeOrderReadinessAction/);
    assert.match(orderExecution, /status: 'failed'/);
    assert.match(orderExecution, /执行前刷新订单计划失败/);
});

test('API 静态契约：V3 易变业务数据必须经过模型计划、正式能力和证据门', () => {
    const dispatcher = readUtf8(path.join(repoRoot, 'api/services/aiAgentRuntimeV3.cjs'));
    const planner = readUtf8(path.join(repoRoot, 'api/services/aiGoalPlannerV3.cjs'));
    const catalog = readUtf8(path.join(repoRoot, 'api/services/aiCapabilityCatalogV2.cjs'));
    const validator = readUtf8(path.join(repoRoot, 'api/services/aiToolInputValidatorV2.cjs'));
    const queryExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/queryExecutors.cjs'));
    const pageContext = readUtf8(path.join(repoRoot, 'api/services/aiPageContext.cjs'));

    assert.match(dispatcher, /planAiIntentV3/);
    assert.match(dispatcher, /selectToolsForIntent/);
    assert.match(dispatcher, /requiredEvidenceSatisfied/);
    assert.match(dispatcher, /hasVerifiedToolEvidence/);
    assert.match(planner, /按语义理解，不按关键词机械匹配/);
    assert.match(planner, /toolChoice/);
    assert.match(catalog, /getAiCapability/);
    assert.match(validator, /TOOL_SCHEMAS/);
    assert.match(validator, /unknownFields/);
    assert.match(queryExecutor, /suppliers: \[\.\.\.supplierCounts\.entries\(\)\]/);
    assert.match(queryExecutor, /truncated: parts\.length < results\.length/);
    assert.match(pageContext, /仅用于理解/);
    assert.match(pageContext, /不得替代工具查询/);
});

test('API 静态契约：AI Agent V3 统一实体发现、零结果恢复和跨轮状态', () => {
    const chat = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
    const v3Entry = readUtf8(path.join(repoRoot, 'api/services/aiDispatcherV3.cjs'));
    const dispatcher = readUtf8(path.join(repoRoot, 'api/services/aiAgentRuntimeV3.cjs'));
    const graph = readUtf8(path.join(repoRoot, 'api/services/aiCapabilityGraphV3.cjs'));
    const resolver = readUtf8(path.join(repoRoot, 'api/services/aiEntityResolverV3.cjs'));
    const turnState = readUtf8(path.join(repoRoot, 'api/services/aiTurnStateV3.cjs'));
    const aiClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/ai.ts'));
    const messageStream = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/useAiMessageStream.ts'));

    assert.match(chat, /runAiDispatcherV3/);
    assert.match(v3Entry, /runAiAgentRuntimeV3/);
    assert.match(dispatcher, /MAX_AGENT_RECOVERY_ROUNDS = 3/);
    assert.match(dispatcher, /MAX_ENTITY_DISCOVERY_CALLS = 12/);
    assert.match(dispatcher, /discoveryCapabilitiesForIntent/);
    assert.match(dispatcher, /isVerifiedEmptyObservation/);
    for (const entity of ['customer', 'order', 'recipe', 'part', 'coil', 'template']) {
        assert.match(graph, new RegExp(`${entity}: Object\\.freeze`));
    }
    assert.match(resolver, /buildSearchProbes/);
    assert.match(resolver, /resolutionReceipt/);
    assert.match(resolver, /capability\?\.access === 'read'/);
    assert.match(turnState, /buildAiTurnStateV3/);
    assert.match(turnState, /normalizeAiTurnStateV3/);
    assert.match(aiClient, /type: 'turn_state'/);
    assert.match(messageStream, /event\.type === 'turn_state'/);
});

test('API 静态契约：PWA AI 流中断自动重试且不保存不完整回复', () => {
    const aiClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/ai.ts'));
    const aiView = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai-view.tsx'));
    const messageStream = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/useAiMessageStream.ts'));
    const apiReference = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));

    assert.match(aiClient, /AI_STREAM_INTERRUPTED/);
    assert.match(aiClient, /if \(!completed\)/);
    assert.match(aiClient, /throw new AiStreamTransportError/);
    assert.match(aiView, /MAX_AI_STREAM_ATTEMPTS = 2/);
    assert.match(aiView, /isRetryableAiStreamError/);
    assert.match(aiView, /streamCompleted\s*&&/);
    assert.match(aiView, /finalAssistantItem\.status === 'done'/);
    assert.match(messageStream, /item\.status !== 'error'/);
    assert.match(messageStream, /item\.status !== 'cancelled'/);
    assert.match(apiReference, /连接中断时自动重试一次/);
    assert.match(apiReference, /收到 `done`/);
});

test('API 静态契约：知识库同步工具是受确认保护的写工具', () => {
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const businessExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));
    const db = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));

    assert.match(tools, /name: 'sync_factory_knowledge'/);
    assert.match(tools, /'sync_factory_knowledge'/);
    assert.match(tools, /name: 'search_factory_knowledge'/);
    assert.match(tools, /name: 'get_factory_knowledge_detail'/);
    assert.match(businessExecutor, /\/api\/knowledge\/sync/);
    assert.match(businessExecutor, /\/api\/knowledge\$\{query\.toString\(\)/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS knowledge_entries/);
    assert.match(schema, /CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_entries_fts/);
    assert.match(db, /'knowledge_entries'/);
});

test('API 静态契约：AI 知识回答必须携带可追溯来源并区分实时数据', () => {
    const chatRoute = readAiPromptContractSource();
    const promptRoute = readAiPromptContractSource();
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executor.cjs'));
    const registry = readUtf8(path.join(repoRoot, 'api/capabilities/registry.cjs'));
    const businessExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));

    assert.match(businessExecutor, /buildKnowledgeSources/);
    assert.match(businessExecutor, /\/api\/knowledge\/overview/);
    assert.match(businessExecutor, /kind: 'knowledge_snapshot'/);
    assert.match(businessExecutor, /knowledgePath: `\/dashboard\?view=knowledge&entry=/);
    assert.match(registry, /kind: 'live_business'/);
    assert.match(executor, /capability\?\.resultProvenance/);
    assert.match(chatRoute, /sources 是本轮回答的可追溯依据/);
    assert.match(promptRoute, /不得自行编造知识 ID/);
});

test('API 静态契约：AI 必须识别不锈钢机筒长度影响泵壳成本', () => {
    const chatRoute = readAiPromptContractSource();
    const promptRoute = readAiPromptContractSource();
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const businessExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));

    assert.match(tools, /preview_pump_shell_cost/);
    assert.match(tools, /机筒长度/);
    assert.match(promptRoute, /泵壳\/机筒长度规则/);
    assert.match(promptRoute, /查询整个配方当前成本或动态试算时统一使用 preview_recipe_cost/);
    assert.match(chatRoute, /preview_pump_shell_cost/);
    assert.match(businessExecutor, /\/api\/recipes\/bom-draft/);
});

test('API 静态契约：AI 成本与零件查询不再暴露旧重复工具', () => {
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const catalog = readUtf8(path.join(repoRoot, 'api/services/aiCapabilityCatalogV2.cjs'));
    const costExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/costExecutors.cjs'));
    const queryExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/queryExecutors.cjs'));

    for (const retiredName of ['query_recipe_cost_by_name', 'query_recipe_cost_by_id', 'get_all_parts']) {
        assert.doesNotMatch(tools, new RegExp(retiredName));
        assert.doesNotMatch(catalog, new RegExp(retiredName));
        assert.doesNotMatch(costExecutor, new RegExp(retiredName));
        assert.doesNotMatch(queryExecutor, new RegExp(retiredName));
    }
    assert.match(tools, /preview_recipe_cost/);
    assert.match(tools, /search_parts/);
});

test('API 静态契约：AI 会话表进入安全写入白名单', () => {
    const db = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/aiConversations.cjs'));

    assert.match(schema, /CREATE TABLE IF NOT EXISTS ai_conversations/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS ai_conversation_messages/);
    assert.match(db, /'ai_conversations'/);
    assert.match(db, /'ai_conversation_messages'/);
    assert.match(service, /safeInsert\('ai_conversations'/);
    assert.match(service, /safeInsert\('ai_conversation_messages'/);
    assert.match(service, /safeUpdate\('ai_conversations'/);
    assert.match(service, /safeUpdate\(\s*'ai_conversation_messages'/);
});

test('API 静态契约：AI 回答反馈使用安全写入并保存来源快照', () => {
    const db = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/aiAnswerFeedback.cjs'));

    assert.match(schema, /CREATE TABLE IF NOT EXISTS ai_answer_feedback/);
    assert.match(schema, /message_id INTEGER NOT NULL UNIQUE/);
    assert.match(schema, /diagnosis_json TEXT DEFAULT '\{\}'/);
    assert.match(schema, /retest_answer_text TEXT DEFAULT ''/);
    assert.match(db, /'ai_answer_feedback'/);
    assert.match(service, /safeInsert\('ai_answer_feedback'/);
    assert.match(service, /safeUpdate\('ai_answer_feedback'/);
    assert.match(service, /collectSources/);
    assert.match(service, /conversation\.owner_key = \?/);
    assert.match(service, /inspectKnowledgeOverview/);
    assert.match(service, /recordAiAnswerFeedbackRetest/);
});

test('API 静态契约：知识库回归检查由确定性规则判定并安全记录', () => {
    const db = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/aiEvaluations.cjs'));
    const regression = readUtf8(path.join(repoRoot, 'api/services/aiRegressionCases.cjs'));

    assert.match(schema, /CREATE TABLE IF NOT EXISTS ai_evaluation_cases/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS ai_evaluation_runs/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS ai_evaluation_results/);
    assert.match(db, /'ai_evaluation_cases'/);
    assert.match(db, /'ai_evaluation_runs'/);
    assert.match(db, /'ai_evaluation_results'/);
    assert.match(service, /safeInsert\('ai_evaluation_runs'/);
    assert.match(service, /safeInsert\('ai_evaluation_results'/);
    assert.match(service, /safeUpdate\('ai_evaluation_runs'/);
    assert.match(service, /fact:part_price/);
    assert.match(service, /fact:no_internal_ids/);
    assert.match(schema, /source_feedback_id INTEGER/);
    assert.match(schema, /review_status TEXT NOT NULL DEFAULT 'approved'/);
    assert.match(regression, /safeInsert\('ai_evaluation_cases'/);
    assert.match(regression, /safeUpdate\('ai_evaluation_cases'/);
    assert.match(regression, /proposalHash/);
});

test('API 静态契约：AI 默认系统提示词不得宣称业务工具直接写数据库', () => {
    const promptRoute = readAiPromptContractSource();

    assert.match(promptRoute, /所有业务写操作必须通过工具调用，由后端标准 API 执行/);
    assert.match(promptRoute, /优先使用配方保存成本作为订单锁价/);
    assert.doesNotMatch(promptRoute, /直接写入数据库/);
});

test('API 静态契约：AI 不得把性能测试报告标成参考图纸', () => {
    const chat = readAiPromptContractSource();
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    assert.match(chat, /metadata\.testReports/);
    assert.match(chat, /禁止称为“图纸”“参考图纸”或“工程图”/);
    assert.match(tools, /性能测试报告附件，不是图纸/);
    assert.match(chat, /“规定点、实测点、偏差”不作为有效技术结论/);
    assert.match(chat, /最终回答中也不要出现这三个模板字段名/);
});

test('API 静态契约：AI 报价展示与成品电缆使用业务口径', () => {
    const chat = readAiPromptContractSource();
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));
    const customerQueries = readUtf8(path.join(repoRoot, 'api/services/customerQueries.cjs'));

    assert.match(chat, /displaySequence/);
    assert.match(chat, /不得把数据库 id 写成/);
    assert.match(chat, /共同组成一个“成品电缆”业务项/);
    assert.match(executor, /\/api\/customers\/\$\{customerId\}\/context/);
    assert.match(customerQueries, /displaySequence: index \+ 1/);
    assert.match(customerQueries, /delete quotation\.id/);
    assert.match(customerQueries, /delete quotation\.Id/);
});

test('API 静态契约：AI 智能路由默认 DeepSeek 且图片和文件自动 Kimi', () => {
    const provider = readUtf8(path.join(repoRoot, 'api/services/aiProvider.cjs'));
    const rotorNaturalLanguage = readUtf8(
        path.join(repoRoot, 'api/services/rotorNaturalLanguage.cjs')
    );
    const runtimeConfig = readUtf8(path.join(repoRoot, 'api/services/runtimeConfig.cjs'));
    const setupView = readUtf8(path.join(repoRoot, 'apps/web-next/components/setup-view.tsx'));
    const aiMessageList = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/AiMessageList.tsx'));

    assert.match(provider, /text\(env\.DEEPSEEK_MODEL\) \|\| 'deepseek-v4-flash'/);
    assert.match(provider, /provider: 'deepseek'/);
    assert.match(provider, /resolveAiProviderRoute/);
    assert.match(provider, /needsVision \? kimi\.supportsImages : kimi\.supportsFileExtraction/);
    assert.match(provider, /routeReason: needsVision \? 'image' : 'file'/);
    assert.match(provider, /fileProvider: fileAvailable \? 'kimi' : null/);
    assert.match(provider, /selectedConfig\.routeReason === 'file'/);
    assert.match(provider, /'file_fallback'/);
    assert.match(provider, /'vision_fallback'/);
    assert.match(runtimeConfig, /values: \['auto', 'deepseek', 'kimi'\]/);
    assert.match(setupView, /图片原图、PDF、Excel\/CSV 和文本附件自动使用 Kimi K3/);
    assert.match(aiMessageList, /item\.provider\.displayName/);
    assert.match(rotorNaturalLanguage, /DEFAULT_MODEL = 'deepseek-v4-flash'/);
    assert.match(rotorNaturalLanguage, /process\.env\.DEEPSEEK_MODEL \|\| DEFAULT_MODEL/);
    assert.doesNotMatch(provider, /deepseek-chat/);
    assert.doesNotMatch(rotorNaturalLanguage, /model:\s*'deepseek-chat'/);
});

test('API 静态契约：报价询价助手直接使用 Kimi 原始附件且不走通用 AI 对话', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/quotations.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/quotationInquiryAi.cjs'));
    const client = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quotations.ts'));
    const panel = readUtf8(path.join(repoRoot, 'apps/web-next/components/quotation-attachment-summary-panel.tsx'));

    assert.match(route, /router\.post\('\/inquiry-summary-draft'/);
    assert.match(service, /options\.resolveProviderConfig \|\| resolveProviderConfig/);
    assert.match(service, /\n\s*'kimi',/);
    assert.match(service, /attachmentMode: 'content'/);
    assert.doesNotMatch(service, /vision_fallback|deepseek|factoryOcrParser/);
    assert.match(client, /\/api\/quotations\/inquiry-summary-draft/);
    assert.match(panel, /generateQuotationInquirySummaryDraft/);
    assert.doesNotMatch(panel, /generateAiDraftFromAttachments/);
});

test('API 静态契约：生产环境不得使用默认 JWT 密钥且必须校验关键环境变量', () => {
    const api = readUtf8(path.join(repoRoot, 'api.cjs'));
    const auth = readUtf8(path.join(repoRoot, 'api/routes/auth.cjs'));
    const middleware = readUtf8(path.join(repoRoot, 'api/authMiddleware.cjs'));
    const environment = readUtf8(path.join(repoRoot, 'api/services/environment.cjs'));
    const envExample = readUtf8(path.join(repoRoot, '.env.example'));
    const verifyScript = readUtf8(path.join(repoRoot, 'scripts/verify-production-env.cjs'));

    assert.match(api, /assertProductionEnvironment/);
    assert.match(api, /const PORT = getServerPort\(\)/);
    assert.match(auth, /isProductionEnvironment/);
    assert.match(middleware, /isProductionEnvironment/);
    assert.match(verifyScript, /validateProductionEnvironment/);
    for (const name of ['ACCESS_PASSWORD', 'JWT_SECRET', 'INTERNAL_SECRET', 'CORS_ORIGIN']) {
        assert.match(environment, new RegExp(name));
        assert.match(envExample, new RegExp(`${name}=`));
    }
    assert.doesNotMatch(auth, /fallback_secret/);
    assert.doesNotMatch(middleware, /fallback_secret/);
    assert.match(auth, /生产环境必须配置 JWT_SECRET/);
    assert.match(middleware, /生产环境必须配置 JWT_SECRET/);
});

test('API 静态契约：系统设置写入必须进入审计日志', () => {
    const db = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const sectionStart = db.indexOf('function setSetting');
    const sectionEnd = db.indexOf('/**', sectionStart);
    const section = db.slice(sectionStart, sectionEnd);

    assert.match(section, /oldRow/);
    assert.match(section, /INSERT OR REPLACE INTO system_settings/);
    assert.match(section, /writeAuditLog\(/);
    assert.match(section, /SETTING_UPDATE|SETTING_INSERT/);
});

test('API 静态契约：AI 工厂配置修改必须进入审计日志且不能覆盖核心规则', () => {
    const db = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const promptRoute = readAiPromptContractSource();
    const sectionStart = db.indexOf('function setConfig');
    const sectionEnd = db.indexOf('// ── P1.7', sectionStart);
    const section = db.slice(sectionStart, sectionEnd);

    assert.match(section, /writeAuditLog\(/);
    assert.match(section, /CONFIG_UPDATE|CONFIG_INSERT/);
    assert.match(promptRoute, /executeFactoryProfileUpdate\(/);
    assert.match(promptRoute, /executePersistentCommand\(/);
    assert.match(promptRoute, /setConfig\(\s*FACTORY_PROFILE_KEY,\s*profile,\s*auditContext/);
    assert.match(promptRoute, /expectedVersion/);
    assert.match(promptRoute, /工厂配置不能为空/);
    assert.match(promptRoute, /FACTORY_PROFILE_MAX_LENGTH = 8000/);
    assert.match(promptRoute, /不能覆盖核心安全、数据来源或写入确认规则/);
    assert.match(promptRoute, /LEGACY_BACKUP_KEY/);
    assert.doesNotMatch(promptRoute, /INSERT OR REPLACE INTO config/);
});

test('API 静态契约：转子页面表单不得直接使用 FreeCAD snake_case 参数名', () => {
    const rotorView = readUtf8(path.join(repoRoot, 'apps/web-next/components/rotor-view.tsx'));
    const forbidden = /\b(upper_bearing|lower_bearing|piece_count|rotor_dia|bearing_span|stack_offset|oil_seal_dia|impeller_dia|impeller_span|impeller_depth|thread_length|thread_dia)\b/;

    assert.doesNotMatch(rotorView, forbidden);
});

test('文档契约：业务流程文档必须存在并被 README 引用', () => {
    const businessFlowPath = path.join(repoRoot, 'docs/business-flow.md');
    const readme = readUtf8(path.join(repoRoot, 'docs/README.md'));
    const flow = readUtf8(businessFlowPath);

    assert.match(readme, /\[business-flow\.md\]\(\.\/business-flow\.md\)/);
    assert.match(flow, /写库与只读边界/);
    assert.match(flow, /成本快照规则/);
    assert.match(flow, /报价转订单必须保存展开后的 BOM 快照/);
    assert.match(flow, /采购中心不入库/);
});

test('API 静态契约：V9.5-V10.3 文件归档关联业务对象且知识写入需要确认', () => {
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const migrations = readUtf8(path.join(repoRoot, 'api/database/migrations.cjs'));
    const db = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const archive = readUtf8(path.join(repoRoot, 'api/services/factoryFileArchive.cjs'));
    const filesRoute = readUtf8(path.join(repoRoot, 'api/routes/files.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const chat = readAiPromptContractSource();
    const aiView = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai-view.tsx'));
    const aiDialogs = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/AiWorkspaceDialogs.tsx'));
    const aiAttachmentArchive = readUtf8(path.join(repoRoot, 'apps/web-next/components/ai/AiAttachmentArchiveController.tsx'));
    const fileLib = readUtf8(path.join(repoRoot, 'apps/web-next/lib/files.ts'));
    const attachmentPanel = readUtf8(path.join(repoRoot, 'apps/web-next/components/factory-file-attachments.tsx'));
    const customersView = readUtf8(path.join(repoRoot, 'apps/web-next/components/customers-view.tsx'));
    const quotationsView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quotations-view.tsx'));
    const quotationAttachmentSummary = readUtf8(path.join(repoRoot, 'apps/web-next/components/quotation-attachment-summary-panel.tsx'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));
    const knowledgeView = readUtf8(path.join(repoRoot, 'apps/web-next/components/knowledge-view.tsx'));
    const orderDrawer = readUtf8(path.join(repoRoot, 'apps/web-next/components/order-detail-drawer.tsx'));
    const orderRequirements = readUtf8(path.join(repoRoot, 'apps/web-next/components/order-requirements-panel.tsx'));
    const orderExecution = readUtf8(path.join(repoRoot, 'apps/web-next/components/order-execution-records-panel.tsx'));
    const aiPage = readUtf8(path.join(repoRoot, 'apps/web-next/app/ai/page.tsx'));

    assert.match(schema, /CREATE TABLE IF NOT EXISTS factory_file_links/);
    assert.match(schema, /idx_factory_file_links_active_unique/);
    assert.match(migrations, /version: 34/);
    assert.match(migrations, /factory_file_business_links/);
    assert.match(migrations, /version: 36/);
    assert.match(migrations, /order_factory_file_links/);
    assert.match(schema, /'customer_requirement'/);
    assert.match(schema, /'execution_evidence'/);
    assert.match(db, /'factory_file_links'/);
    assert.match(archive, /searchFactoryFileArchiveTargets/);
    assert.match(archive, /safeInsert\('knowledge_documents'/);
    assert.match(archive, /safeInsert\('factory_file_links'/);
    assert.match(archive, /safeUpdate\('factory_file_links'/);
    assert.match(archive, /safeUpdate\(\s*'factory_file_links'/);
    assert.match(filesRoute, /router\.get\('\/archive-targets'/);
    assert.match(filesRoute, /router\.post\('\/:id\/archive-preview'/);
    assert.match(filesRoute, /router\.post\('\/:id\/archive'/);
    assert.match(filesRoute, /router\.get\('\/:id\/links'/);
    assert.match(tools, /name: 'search_factory_file_archive_targets'/);
    assert.match(tools, /name: 'archive_factory_file'/);
    assert.match(tools, /'archive_factory_file'/);
    assert.match(chat, /禁止猜 targetId/);
    assert.match(fileLib, /archiveFactoryFile/);
    assert.match(fileLib, /listFactoryFileLinksForTarget/);
    assert.match(fileLib, /deleteFactoryFileLink/);
    assert.match(aiView, /AiAttachmentArchiveController/);
    assert.match(aiAttachmentArchive, /AttachmentArchiveDialog/);
    assert.match(aiDialogs, /归档附件/);
    assert.match(aiDialogs, /已有归档/);
    assert.match(attachmentPanel, /source: 'business_page'/);
    assert.match(attachmentPanel, /uploadFactoryFile/);
    assert.match(attachmentPanel, /archiveFactoryFile/);
    assert.match(attachmentPanel, /deleteFactoryFileLink/);
    assert.match(customersView, /targetType="customer"/);
    assert.match(quotationsView, /QuotationAttachmentSummaryPanel/);
    assert.match(quotationAttachmentSummary, /uploadFactoryFile/);
    assert.match(quotationAttachmentSummary, /generateQuotationInquirySummaryDraft/);
    assert.match(quotationAttachmentSummary, /询价助手/);
    assert.match(quotationAttachmentSummary, /lg:w-\[480px\]/);
    assert.match(quotationAttachmentSummary, /原始附件/);
    assert.match(quotationAttachmentSummary, /AI 归纳/);
    assert.match(quotationAttachmentSummary, /待确认/);
    assert.match(quotationsView, /attachmentFileIds: inquiryDraft\.files/);
    assert.match(quotationsView, /!editingQuotation/);
    assert.match(qualityView, /targetType="recipe_analysis_feedback"/);
    assert.match(knowledgeView, /targetType="ai_answer_feedback"/);
    assert.match(orderDrawer, /OrderRequirementsPanel/);
    assert.match(orderRequirements, /targetType="order"/);
    assert.match(orderRequirements, /AI 可以归纳草稿/);
    assert.match(orderRequirements, /generateAiDraftFromAttachment/);
    assert.match(orderRequirements, /setSummaryText\(result\)/);
    assert.match(orderRequirements, /确认进入知识库/);
    assert.match(orderDrawer, /OrderExecutionRecordsPanel/);
    assert.match(orderExecution, /targetType="order"/);
    assert.match(orderExecution, /relationRole="execution_evidence"/);
    assert.match(orderExecution, /执行事实时间线/);
    assert.match(orderExecution, /generateAiDraftFromAttachment/);
    assert.match(orderExecution, /summaryText: result/);
    assert.match(orderExecution, /确认进入知识库/);
    assert.match(attachmentPanel, /AI 归纳/);
    assert.match(attachmentPanel, /onAiSummarize/);
    assert.doesNotMatch(attachmentPanel, /href=\{`\/ai\?/);
    assert.match(readUtf8(path.join(repoRoot, 'apps/web-next/lib/ai.ts')), /generateAiDraftFromAttachment/);
    assert.match(aiPage, /initialAttachmentId/);
});
