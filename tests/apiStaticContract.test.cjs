const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
    const routeFiles = ['api/routes/customers.cjs', 'api/routes/quotations.cjs'];
    const offenders = routeFiles.filter((filePath) => {
        const source = readUtf8(path.join(repoRoot, filePath));
        return !source.includes('res.json({ success: true, data: record })') ||
            source.includes('id: info.lastInsertRowid');
    });

    assert.deepEqual(offenders, []);
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
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/recipes.ts'));

    assert.match(route, /router\.post\('\/model-variant-draft'/);
    assert.match(route, /recipeDraft/);
    assert.match(nextClient, /applyModelVariantDraft/);
    assert.match(nextClient, /\/api\/recipes\/model-variant-draft/);
});

test('API 静态契约：配方泵壳模板应用必须由后端生成草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/templates.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/recipes.ts'));
    const nextView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));

    assert.match(route, /router\.get\('\/:id\/default-recipe'/);
    assert.match(route, /recipeDraft/);
    assert.match(nextClient, /getTemplateRecipeDraft/);
    assert.match(nextClient, /\/api\/templates\/\$\{templateId\}\/default-recipe/);
    assert.match(nextView, /getTemplateRecipeDraft\(templateId\)/);
});

test('API 静态契约：配方保存 payload 必须由后端生成草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/recipes.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/recipes.ts'));
    const nextView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));

    assert.match(route, /router\.post\('\/save-payload-draft'/);
    assert.match(route, /function buildRecipeSavePayloadDraft/);
    assert.match(nextClient, /buildRecipeSavePayloadDraft/);
    assert.match(nextClient, /\/api\/recipes\/save-payload-draft/);
    assert.match(nextView, /buildRecipeSavePayloadDraft\(\{/);
    assert.doesNotMatch(nextView, /partsJson: JSON\.stringify\(costDraft\.parts\)/);
});

test('API 静态契约：配方线圈材质切换必须从可用组合解析槽眼', () => {
    const coilService = readUtf8(path.join(repoRoot, 'api/services/coilCost.cjs'));
    const coilRoute = readUtf8(path.join(repoRoot, 'api/routes/coils.cjs'));
    const recipeView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));

    assert.match(coilService, /function buildCoilSpecOptions/);
    assert.match(coilRoute, /buildCoilSpecOptions\(dbGetAllCoils\(\)\)/);
    assert.match(recipeView, /function resolveCoilVariantSelection/);
    assert.match(recipeView, /resolveCoilVariantSelection\(\s*selectedFormCoilSpec,\s*event\.target\.value/);
    assert.match(recipeView, /resolveCoilVariantSelection\(\s*selectedVariantCoil,\s*event\.target\.value/);
    assert.doesNotMatch(recipeView, /coilMaterial:\s*event\.target\.value,\s*coilSlotType:\s*'小眼'/);
});

test('API 静态契约：配方详情只读库存状态且不保留生产扣库存入口', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/recipes.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/recipes.ts'));
    const recipeView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));

    assert.match(route, /router\.get\('\/:id\/inventory-status'/);
    assert.match(route, /function buildRecipeInventoryStatus/);
    assert.doesNotMatch(route, /production-check|router\.post\('\/:id\/produce'|function produceRecipe/);
    assert.match(nextClient, /getRecipeInventoryStatus\(recipeId: number\)/);
    assert.match(nextClient, /\/api\/recipes\/\$\{recipeId\}\/inventory-status/);
    assert.doesNotMatch(recipeView, /确认生产|生产数量|预检库存|produceRecipe/);
});

test('API 静态契约：报价转订单必须由后端生成订单草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/quotations.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quotations.ts'));

    assert.match(route, /router\.post\('\/:id\/order-draft'/);
    assert.match(route, /function buildOrderDraftFromQuotation/);
    assert.match(route, /buildBalancedOrderPlans/);
    assert.match(route, /router\.post\('\/:id\/convert'/);
    assert.match(route, /converted_order_id/);
    assert.match(nextClient, /buildQuotationOrderDraft\(quotationId: number\)/);
    assert.match(nextClient, /\/api\/quotations\/\$\{quotationId\}\/order-draft/);
    assert.match(nextClient, /\/api\/quotations\/\$\{input\.quotation\.id\}\/convert/);
    assert.doesNotMatch(nextClient, /generatePurchasePlan/);
});

test('API 静态契约：报价保存 payload 必须由后端生成草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/quotations.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quotations.ts'));

    assert.match(route, /router\.post\('\/save-payload-draft'/);
    assert.match(route, /function buildQuotationSavePayloadDraft/);
    assert.match(nextClient, /buildQuotationSavePayloadDraft/);
    assert.match(nextClient, /\/api\/quotations\/save-payload-draft/);
    assert.doesNotMatch(nextClient, /itemsJson: JSON\.stringify\(input\.items\)/);
});

test('API 静态契约：订单保存 payload 必须由后端生成草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/orders.ts'));
    const nextView = readUtf8(path.join(repoRoot, 'apps/web-next/components/orders-view.tsx'));

    assert.match(route, /router\.post\('\/save-payload-draft'/);
    assert.match(route, /function buildOrderSavePayloadDraft/);
    assert.match(nextClient, /buildOrderSavePayloadDraft/);
    assert.match(nextClient, /\/api\/orders\/save-payload-draft/);
    assert.doesNotMatch(nextClient, /itemsJson: JSON\.stringify\(order\.items\)/);
    assert.doesNotMatch(nextView, /generatePurchasePlan\(draftItems\)/);
});

test('API 静态契约：订单详情动作必须由后端执行', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/orders.ts'));
    const detailDrawer = readUtf8(path.join(repoRoot, 'apps/web-next/components/order-detail-drawer.tsx'));

    assert.match(route, /router\.post\('\/:id\/status'/);
    assert.match(route, /router\.post\('\/:id\/purchase-items\/progress'/);
    assert.match(route, /router\.post\('\/:id\/purchase-items\/toggle'/);
    assert.match(route, /router\.post\('\/:id\/todos\/toggle'/);
    assert.match(route, /router\.post\('\/:id\/complete-purchase'/);
    assert.match(route, /function applyPurchaseInventory/);
    assert.match(route, /safeUpdate\('parts', partId, \{ stock:/);
    assert.match(route, /adjustCoilStock/);
    assert.match(route, /movementType: 'purchase_inbound'/);
    assert.match(route, /record\.purchase_completed_at \|\| record\.status === '采购完成'/);
    assert.match(route, /purchase_receipt_id: receiptId/);
    assert.match(route, /const receiptId = randomUUID\(\)/);
    assert.match(route, /db\.transaction\(\(orderId\) =>/);
    assert.match(nextClient, /setOrderStatus/);
    assert.match(nextClient, /updateOrderPurchaseItem/);
    assert.match(nextClient, /toggleOrderPurchaseItem/);
    assert.match(nextClient, /toggleOrderTodoItem/);
    assert.match(nextClient, /completeOrderPurchase/);
    assert.doesNotMatch(detailDrawer, /saveOrder|batchAddStock/);
});

test('API 静态契约：包装零件二级分类贯穿数据库、接口和标准 Adapter', () => {
    const dbSource = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const schemaSource = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const migrationSource = readUtf8(path.join(repoRoot, 'api/database/migrations.cjs'));
    const routeSource = readUtf8(path.join(repoRoot, 'api/routes/parts.cjs'));

    assert.match(schemaSource, /subcategory TEXT DEFAULT ''/);
    assert.match(dbSource, /subcategory: r\.subcategory \|\| ''/);
    assert.match(migrationSource, /partSubcategory/);
    assert.match(routeSource, /updates\.subcategory = f\.subcategory/);
    assert.match(routeSource, /subcategory: f\.subcategory/);
});

test('API 静态契约：报价确认转单必须事务化并防止重复转单', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/quotations.cjs'));

    assert.match(route, /function convertQuotationToOrder/);
    assert.match(route, /db\.transaction\(\(id\) =>/);
    assert.match(route, /quotation\.converted_order_id \|\| quotation\.status === '已转订单'/);
    assert.match(route, /safeInsert\('orders'/);
    assert.match(route, /converted_order_id: orderId/);
    assert.match(route, /statusCode = 409/);
});

test('API 静态契约：采购中心批量采购状态必须由后端执行', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const purchaseClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/purchase.ts'));

    assert.match(route, /router\.post\('\/purchase-items\/batch'/);
    assert.match(route, /function applyPurchaseItemsByTask/);
    assert.match(route, /safeUpdate\('orders', record\.id/);
    assert.match(purchaseClient, /\/api\/orders\/purchase-items\/batch/);
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
    const docs = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));

    assert.match(route, /parsePositiveId\(op\.partId\)/);
    assert.match(route, /parseFiniteNumber\(op\.delta, 'delta'\)/);
    assert.doesNotMatch(route, /op\.id|op\.Id/);
    assert.match(docs, /operations: \[\{ partId, delta \}\]/);
});

test('API 静态契约：业务新增写库必须通过 safeInsert', () => {
    const dbSource = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    assert.match(dbSource, /function safeInsert\(table, values\)/);
    assert.match(dbSource, /writeAuditLog\('INSERT', table/);

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

    assert.match(queryExecutor, /postJson\(internalFetch,\s*'\/api\/parts'/);
    assert.match(queryExecutor, /patchJson\(internalFetch,\s*`\/api\/parts\/\$\{targetId\}`/);
    assert.doesNotMatch(queryExecutor, /safeInsert\('parts'|safeUpdate\('parts'|softDelete\('parts'/);

    assert.match(orderExecutor, /getJson\(internalFetch,\s*`\/api\/orders\/\$\{id\}`/);
    assert.match(orderExecutor, /patchJson\(internalFetch,\s*`\/api\/orders\/\$\{order\.id \?\? order\.Id\}`/);

    assert.match(recipeExecutor, /deleteJson\(internalFetch,\s*`\/api\/recipes\/\$\{recipe\.id \?\? recipe\.Id\}`/);
    assert.doesNotMatch(recipeExecutor, /softDelete\('recipes'/);
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

    assert.match(recipeExecutor, /\/api\/recipes\/cost-draft/);
    assert.match(recipeExecutor, /\/api\/recipes\/save-payload-draft/);
    assert.match(recipeExecutor, /postJson\(internalFetch,\s*'\/api\/recipes'/);
    assert.match(recipeExecutor, /patchJson\(internalFetch,\s*`\/api\/recipes\/\$\{recipe\.id \?\? recipe\.Id\}`/);
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
    const chatRoute = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
    const promptRoute = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));

    assert.match(chatRoute, /hasPendingWriteConfirmation/);
    assert.doesNotMatch(chatRoute, /buildToolCardReply/);
    assert.doesNotMatch(chatRoute, /整理在下面的卡片/);
    assert.match(promptRoute, /普通工具返回的数据是给你继续分析和编排使用的/);
    for (const name of ['build_recipe_bom_draft', 'preview_recipe_cost', 'preview_pump_shell_cost', 'build_quotation_draft', 'build_order_draft', 'search_customer_history', 'explain_cost_change', 'get_data_quality_summary', 'analyze_recipe_configuration', 'set_recipe_analysis_feedback', 'get_factory_learning_health', 'get_factory_rule_candidates', 'get_factory_rule_impact', 'get_factory_rule_compliance', 'get_factory_rule_history', 'restore_factory_rule_event', 'refresh_factory_rule_candidates', 'review_factory_rule_candidate', 'get_business_alerts', 'search_factory_knowledge', 'get_factory_knowledge_detail', 'get_factory_knowledge_health', 'sync_factory_knowledge']) {
        assert.match(tools, new RegExp(name));
    }
});

test('API 静态契约：配方智能检查只读且区分工厂规则、确定问题与复核建议', () => {
    const chatRoute = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
    const promptRoute = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const businessExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/recipeIntelligence.cjs'));

    assert.match(tools, /name: 'analyze_recipe_configuration'/);
    assert.doesNotMatch(tools.slice(tools.indexOf('const WRITE_TOOLS')), /analyze_recipe_configuration/);
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
    assert.match(tools.slice(tools.indexOf('const WRITE_TOOLS')), /set_recipe_analysis_feedback/);
    assert.match(route, /router\.post\('\/recipes\/:recipeId\/feedback'/);
    assert.match(service, /safeInsert/);
    assert.match(service, /safeUpdate/);
    assert.match(schema, /UNIQUE\(recipe_id, finding_key\)/);
});

test('API 静态契约：候选业务规则需人工审核后才进入知识库', () => {
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const knowledge = readUtf8(path.join(repoRoot, 'api/services/knowledge.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));

    assert.match(service, /finding_type = 'peer_pattern'/);
    assert.match(service, /minimumEvidence \|\| MINIMUM_APPROVAL_SUPPORT/);
    assert.match(service, /status === 'approved'/);
    assert.match(knowledge, /approvedFactoryRuleEntries/);
    assert.match(knowledge, /sourceTable: 'factory_rule_candidates'/);
    assert.match(tools.slice(tools.indexOf('const WRITE_TOOLS')), /review_factory_rule_candidate/);
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
    const prompt = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));

    assert.match(route, /router\.get\('\/rule-candidates\/:id\/impact'/);
    assert.match(tools, /name: 'get_factory_rule_impact'/);
    assert.doesNotMatch(tools.slice(tools.indexOf('const WRITE_TOOLS')), /get_factory_rule_impact/);
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
    const prompt = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));

    assert.match(route, /router\.get\('\/rule-compliance'/);
    assert.match(tools, /name: 'get_factory_rule_compliance'/);
    assert.doesNotMatch(tools.slice(tools.indexOf('const WRITE_TOOLS')), /get_factory_rule_compliance/);
    assert.match(prompt, /使用 get_factory_rule_compliance/);
    assert.match(service, /function buildFactoryRuleCompliance/);
    assert.match(service, /affectedRecipeCount/);
    assert.match(service, /ruleViolationCount/);
    assert.match(qualityView, /已批准规则执行情况/);
    assert.match(qualityView, /受影响配方/);
});

test('API 静态契约：Knowledge V3 同类反馈与候选规则归纳保持事务一致', () => {
    const feedbackService = readUtf8(path.join(repoRoot, 'api/services/recipeAnalysisFeedback.cjs'));
    const prompt = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));
    const recipesView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));

    assert.match(feedbackService, /database\.transaction/);
    assert.match(feedbackService, /findingType !== 'peer_pattern'/);
    assert.match(feedbackService, /refreshFactoryRuleCandidates/);
    assert.match(feedbackService, /ruleLearning/);
    assert.match(prompt, /无需再调用 refresh_factory_rule_candidates/);
    assert.match(qualityView, /反馈保存后会自动归纳/);
    assert.match(qualityView, /重新核对规则/);
    assert.match(recipesView, /自动计入候选规则证据/);
});

test('API 静态契约：Knowledge V3 规则生命周期记录可追溯且只读', () => {
    const schema = readUtf8(path.join(repoRoot, 'api/database/schema.cjs'));
    const route = readUtf8(path.join(repoRoot, 'api/routes/quality.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const prompt = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));

    assert.match(schema, /CREATE TABLE IF NOT EXISTS factory_rule_events/);
    assert.match(schema, /idx_factory_rule_events_candidate/);
    assert.match(route, /router\.get\('\/rule-events'/);
    assert.match(service, /function recordFactoryRuleEvent/);
    assert.match(service, /function listFactoryRuleEvents/);
    assert.match(tools, /name: 'get_factory_rule_history'/);
    assert.doesNotMatch(tools.slice(tools.indexOf('const WRITE_TOOLS')), /get_factory_rule_history/);
    assert.match(prompt, /使用 get_factory_rule_history/);
    assert.match(qualityView, /规则变更记录/);
    assert.doesNotMatch(qualityView, /恢复历史版本/);
});

test('API 静态契约：Knowledge V3 规则审核与派生知识保持事务一致', () => {
    const knowledge = readUtf8(path.join(repoRoot, 'api/services/knowledge.cjs'));
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const feedback = readUtf8(path.join(repoRoot, 'api/services/recipeAnalysisFeedback.cjs'));
    const prompt = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));
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
    const prompt = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));
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
    assert.match(tools.slice(tools.indexOf('const WRITE_TOOLS')), /restore_factory_rule_event/);
    assert.match(prompt, /恢复只改变审核状态，保留当前证据/);
    assert.match(executor, /\/api\/quality\/rule-events\/\$\{Number\(args\.eventId\)\}\/restore/);
    assert.match(qualityView, /恢复此状态/);
});

test('API 静态契约：Knowledge V3 低置信度规则禁止批准并自动撤回', () => {
    const service = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const prompt = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));
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
    assert.match(docs, /V3 第八阶段/);
});

test('API 静态契约：Knowledge V3 固化反馈证据来源并隔离范围漂移', () => {
    const feedbackService = readUtf8(path.join(repoRoot, 'api/services/recipeAnalysisFeedback.cjs'));
    const ruleService = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const prompt = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));
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
    assert.match(docs, /V3 第九阶段/);
});

test('API 静态契约：Knowledge V3 隔离配方修改后的过期反馈', () => {
    const intelligence = readUtf8(path.join(repoRoot, 'api/services/recipeIntelligence.cjs'));
    const ruleService = readUtf8(path.join(repoRoot, 'api/services/factoryRuleCandidates.cjs'));
    const recipesRoute = readUtf8(path.join(repoRoot, 'api/routes/recipes.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));
    const recipesView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));
    const qualityClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quality.ts'));
    const docs = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));

    assert.match(intelligence, /outdatedFeedbackCount/);
    assert.match(intelligence, /历史反馈不再抑制提醒/);
    assert.match(ruleService, /contentOutdated/);
    assert.match(ruleService, /outdatedEvidence/);
    assert.match(recipesRoute, /refreshRecipeRuleLearningIfNeeded/);
    assert.match(recipesRoute, /decision IN \('confirmed', 'special_case', 'ignored'\)/);
    assert.match(recipesRoute, /refreshFactoryRuleCandidates\(\{ actor \}\)/);
    assert.match(recipesRoute, /softDelete\('recipes', id\);\s+refreshRecipeRuleLearningIfNeeded\(id,/);
    assert.match(tools, /内容过期/);
    assert.match(qualityClient, /outdatedCount: number/);
    assert.match(qualityView, /内容过期/);
    assert.match(recipesView, /反馈已过期/);
    assert.match(docs, /V3 第十阶段/);
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
    assert.match(docs, /V3 第十一阶段/);
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
    assert.match(docs, /V3 第十二阶段/);
    assert.match(businessFlow, /自动执行一次智能检查/);
});

test('API 静态契约：Knowledge V3 已消失的待复核提醒可确认解决', () => {
    const feedbackService = readUtf8(path.join(repoRoot, 'api/services/recipeAnalysisFeedback.cjs'));
    const route = readUtf8(path.join(repoRoot, 'api/routes/quality.cjs'));
    const qualityClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quality.ts'));
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));
    const recipesView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));
    const docs = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));

    assert.match(feedbackService, /function resolveRecipeAnalysisFeedback/);
    assert.match(feedbackService, /decision: 'review'/);
    assert.match(feedbackService, /这条反馈仍对应当前配方版本/);
    assert.match(feedbackService, /analysisContainsFinding/);
    assert.match(feedbackService, /原提醒在当前配方智能检查中仍然存在/);
    assert.match(route, /router\.post\('\/recipe-feedback\/:id\/resolve'/);
    assert.match(qualityClient, /resolveRecipeAnalysisFeedback/);
    assert.match(qualityView, /feedbackIds=\$\{feedbackIds\}/);
    assert.match(recipesView, /data-review-target/);
    assert.match(recipesView, /确认已解决/);
    assert.match(recipesView, /原待复核提醒/);
    assert.match(docs, /V3 第十三阶段/);
});

test('API 静态契约：Knowledge V3 同一配方待复核反馈按任务聚合并顺序处理', () => {
    const qualityView = readUtf8(path.join(repoRoot, 'apps/web-next/components/quality-view.tsx'));
    const recipesView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));
    const docs = readUtf8(path.join(repoRoot, 'docs/README.md'));
    const businessFlow = readUtf8(path.join(repoRoot, 'docs/business-flow.md'));

    assert.match(qualityView, /const evidenceRecheckGroups = useMemo/);
    assert.match(qualityView, /group\.items\.map\(\(item\) => item\.feedbackId\)\.join\(','\)/);
    assert.match(qualityView, /处理 \{group\.items\.length\} 条/);
    assert.match(recipesView, /params\.get\('feedbackIds'\)/);
    assert.match(recipesView, /setReviewEvidenceTargets\(evidence\)/);
    assert.match(recipesView, /function completeCurrentReviewEvidence/);
    assert.match(recipesView, /继续处理下一条/);
    assert.match(recipesView, /待复核进度：第/);
    assert.match(docs, /V3 第十四阶段/);
    assert.match(businessFlow, /按配方聚合/);
});

test('API 静态契约：Knowledge V3 待复核工作台展示规则影响并完成闭环', () => {
    const recipesView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));
    const docs = readUtf8(path.join(repoRoot, 'docs/README.md'));
    const apiDocs = readUtf8(path.join(repoRoot, 'docs/api-reference.md'));
    const businessFlow = readUtf8(path.join(repoRoot, 'docs/business-flow.md'));

    assert.match(recipesView, /setReviewRuleLearning\(result\.ruleLearning \|\| null\)/);
    assert.match(recipesView, /规则学习已按本次判断刷新/);
    assert.match(recipesView, /function skipCurrentReviewEvidence/);
    assert.match(recipesView, /原反馈状态没有改变/);
    assert.match(recipesView, /nextUrl\.searchParams\.delete\('feedbackIds'\)/);
    assert.match(recipesView, /window\.location\.assign\('\/dashboard\?view=quality'\)/);
    assert.match(recipesView, /返回数据质量/);
    assert.match(docs, /V3 第十五阶段/);
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
    assert.match(docs, /Knowledge Base V4 第一阶段/);
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
    assert.match(docs, /Knowledge Base V4 第二阶段/);
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
    assert.match(docs, /Knowledge Base V4 第三阶段/);
    assert.match(apiDocs, /\/api\/knowledge\/health/);
});

test('API 静态契约：Knowledge V4 AI 可只读诊断同步健康状态', () => {
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executor.cjs'));
    const businessExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));
    const chat = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
    const prompt = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));

    assert.match(tools, /name: 'get_factory_knowledge_health'/);
    assert.doesNotMatch(tools.slice(tools.indexOf('const WRITE_TOOLS')), /get_factory_knowledge_health/);
    assert.match(executor, /'get_factory_knowledge_health'/);
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
    const route = readUtf8(path.join(repoRoot, 'api/routes/knowledge.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const chat = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
    const knowledgeLib = readUtf8(path.join(repoRoot, 'apps/web-next/lib/knowledge.ts'));
    const knowledgeView = readUtf8(path.join(repoRoot, 'apps/web-next/components/knowledge-view.tsx'));

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
    assert.match(route, /safeInsert\('knowledge_documents'/);
    assert.match(route, /softDelete\('knowledge_documents'/);
    assert.match(route, /router\.get\('\/documents\/:id\/download'/);
    assert.match(tools, /'document'/);
    assert.match(chat, /parserStatus=metadata_only/);
    assert.match(knowledgeLib, /uploadKnowledgeDocument/);
    assert.match(knowledgeLib, /deleteKnowledgeDocument/);
    assert.match(knowledgeView, /导入工厂资料/);
    assert.match(knowledgeView, /下载原文件/);
    assert.match(knowledgeView, /删除资料/);
});

test('API 静态契约：V5.2 订单生产准备检查复用库存计划且保持只读', () => {
    const service = readUtf8(path.join(repoRoot, 'api/services/orderReadiness.cjs'));
    const ordersRoute = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/orderExecutors.cjs'));
    const prompt = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
    assert.match(service, /waiting_materials/);
    assert.match(service, /needs_review/);
    assert.match(service, /currentStock/);
    assert.match(service, /inventoryType === 'none'/);
    assert.match(service, /price_below_cost/);
    assert.match(ordersRoute, /router\.get\('\/:id\/readiness'/);
    assert.match(ordersRoute, /buildBalancedOrderPlans/);
    assert.match(tools, /name:\s*'check_order_readiness'/);
    assert.match(executor, /\/api\/orders\/\$\{resolved\.orderId\}\/readiness/);
    assert.match(prompt, /已下单或已到货不等于已经入库/);
    const writeTools = tools.split('const WRITE_TOOLS')[1];
    assert.doesNotMatch(writeTools, /check_order_readiness/);
});

test('API 静态契约：V5.3 订单处理方案有依赖顺序且只生成不执行', () => {
    const service = readUtf8(path.join(repoRoot, 'api/services/orderReadinessPlan.cjs'));
    const ordersRoute = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/orderExecutors.cjs'));
    const prompt = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
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
    const writeTools = tools.split('const WRITE_TOOLS')[1];
    assert.doesNotMatch(writeTools, /plan_order_readiness_actions/);
});

test('API 静态契约：V5.4 订单方案执行受确认和实时重验双重保护', () => {
    const ordersRoute = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/orderExecutors.cjs'));
    const confirmation = readUtf8(path.join(repoRoot, 'api/routes/ai/executor.cjs'));
    const prompt = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
    assert.match(ordersRoute, /router\.post\('\/:id\/readiness-actions\/:actionId'/);
    assert.match(ordersRoute, /action\.mode !== 'confirmable'/);
    assert.match(ordersRoute, /action\.status !== 'available'/);
    assert.match(tools, /name:\s*'execute_order_readiness_action'/);
    assert.match(tools.split('const WRITE_TOOLS')[1], /execute_order_readiness_action/);
    assert.match(executor, /readiness-actions\/\$\{encodeURIComponent\(actionId\)\}/);
    assert.match(confirmation, /case 'execute_order_readiness_action'/);
    assert.match(prompt, /确认时后端会再次重验/);
    assert.match(prompt, /禁止执行 manual、needs_input、monitor 或 blocked/);
});

test('API 静态契约：V5.5 订单准备总览对 API、AI 和只读边界保持一致', () => {
    const service = readUtf8(path.join(repoRoot, 'api/services/orderReadinessOverview.cjs'));
    const ordersRoute = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/orderExecutors.cjs'));
    const prompt = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));

    assert.match(service, /attentionRequired/);
    assert.match(service, /waiting_materials/);
    assert.match(service, /nextAction/);
    assert.doesNotMatch(service, /safeInsert|safeUpdate|softDelete|hardDelete/);
    assert.match(ordersRoute, /router\.get\('\/readiness-overview'/);
    assert.match(tools, /name:\s*'get_order_readiness_overview'/);
    assert.match(executor, /\/api\/orders\/readiness-overview/);
    assert.match(prompt, /哪些订单不能生产/);
    assert.doesNotMatch(tools.split('const WRITE_TOOLS')[1], /get_order_readiness_overview/);
});

test('API 静态契约：易变业务数据查询必须强制刷新工具结果', () => {
    const chatRoute = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
    const freshness = readUtf8(path.join(repoRoot, 'api/services/aiFreshness.cjs'));
    const pageContext = readUtf8(path.join(repoRoot, 'api/services/aiPageContext.cjs'));

    assert.match(chatRoute, /buildFreshLookupToolCalls/);
    assert.match(chatRoute, /normalizeAiPageContext\(req\.body\?\.pageContext\)/);
    assert.match(chatRoute, /resolveMessagesWithPageContext/);
    assert.match(chatRoute, /正在刷新.*易变业务数据/);
    assert.match(chatRoute, /禁止直接复述历史会话里的数字/);
    assert.match(chatRoute, /所有正式材质\+槽眼方案/);
    assert.match(freshness, /function coilSpecSheetKey/);
    assert.match(freshness, /entryType: 'coil'/);
    assert.match(pageContext, /仅用于理解/);
    assert.match(pageContext, /不得替代工具查询/);
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
    const chatRoute = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
    const promptRoute = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executor.cjs'));
    const businessExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));

    assert.match(businessExecutor, /buildKnowledgeSources/);
    assert.match(businessExecutor, /\/api\/knowledge\/overview/);
    assert.match(businessExecutor, /kind: 'knowledge_snapshot'/);
    assert.match(businessExecutor, /knowledgePath: `\/dashboard\?view=knowledge&entry=/);
    assert.match(executor, /kind: 'live_business'/);
    assert.match(chatRoute, /sources 是本轮回答的可追溯依据/);
    assert.match(promptRoute, /不得自行编造知识 ID/);
});

test('API 静态契约：AI 必须识别不锈钢机筒长度影响泵壳成本', () => {
    const chatRoute = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
    const promptRoute = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    const businessExecutor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));

    assert.match(tools, /preview_pump_shell_cost/);
    assert.match(tools, /机筒长度/);
    assert.match(tools, /不要用本工具，改用 preview_pump_shell_cost/);
    assert.match(promptRoute, /泵壳\/机筒长度规则/);
    assert.match(promptRoute, /不要用 query_recipe_cost_by_name/);
    assert.match(chatRoute, /preview_pump_shell_cost/);
    assert.match(chatRoute, /不要使用 query_recipe_cost_by_name/);
    assert.match(businessExecutor, /\/api\/recipes\/bom-draft/);
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
    assert.match(service, /safeUpdate\('ai_conversation_messages'/);
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
});

test('API 静态契约：AI 默认系统提示词不得宣称业务工具直接写数据库', () => {
    const promptRoute = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));

    assert.match(promptRoute, /所有业务写操作必须通过工具调用，由后端标准 API 执行/);
    assert.match(promptRoute, /优先使用配方保存成本作为订单锁价/);
    assert.doesNotMatch(promptRoute, /直接写入数据库/);
});

test('API 静态契约：AI 不得把性能测试报告标成参考图纸', () => {
    const chat = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
    const tools = readUtf8(path.join(repoRoot, 'api/routes/ai/tools.cjs'));
    assert.match(chat, /metadata\.testReports/);
    assert.match(chat, /禁止称为“图纸”“参考图纸”或“工程图”/);
    assert.match(tools, /性能测试报告附件，不是图纸/);
    assert.match(chat, /“规定点、实测点、偏差”不作为有效技术结论/);
    assert.match(chat, /最终回答中也不要出现这三个模板字段名/);
});

test('API 静态契约：AI 报价展示与成品电缆使用业务口径', () => {
    const chat = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
    const executor = readUtf8(path.join(repoRoot, 'api/routes/ai/executors/businessExecutors.cjs'));

    assert.match(chat, /displaySequence/);
    assert.match(chat, /不得把数据库 id 写成/);
    assert.match(chat, /共同组成一个“成品电缆”业务项/);
    assert.match(executor, /displaySequence: index \+ 1/);
    assert.match(executor, /const \{ id, Id, \.\.\.quotation \} = row/);
});

test('API 静态契约：DeepSeek 默认模型使用 V4 Flash', () => {
    const chatRoute = readUtf8(path.join(repoRoot, 'api/routes/ai/chat.cjs'));
    const rotorRoute = readUtf8(path.join(repoRoot, 'api/routes/rotor.cjs'));

    assert.match(chatRoute, /process\.env\.DEEPSEEK_MODEL \|\| 'deepseek-v4-flash'/);
    assert.match(rotorRoute, /process\.env\.DEEPSEEK_MODEL \|\| 'deepseek-v4-flash'/);
    assert.doesNotMatch(chatRoute, /deepseek-chat/);
    assert.doesNotMatch(rotorRoute, /model:\s*'deepseek-chat'/);
});

test('API 静态契约：生产环境不得使用默认 JWT 密钥且必须校验关键环境变量', () => {
    const api = readUtf8(path.join(repoRoot, 'api.cjs'));
    const auth = readUtf8(path.join(repoRoot, 'api/routes/auth.cjs'));
    const middleware = readUtf8(path.join(repoRoot, 'api/authMiddleware.cjs'));
    const envExample = readUtf8(path.join(repoRoot, '.env.example'));
    const verifyScript = readUtf8(path.join(repoRoot, 'scripts/verify-production-env.cjs'));

    assert.match(api, /requireProductionEnv/);
    assert.match(api, /const PORT = Number\(process\.env\.PORT \|\| 3002\)/);
    for (const name of ['ACCESS_PASSWORD', 'JWT_SECRET', 'INTERNAL_SECRET', 'CORS_ORIGIN', 'SIRI_API_TOKEN']) {
        assert.match(api, new RegExp(name));
        assert.match(envExample, new RegExp(`${name}=`));
        assert.match(verifyScript, new RegExp(name));
    }
    assert.doesNotMatch(auth, /fallback_secret/);
    assert.doesNotMatch(middleware, /fallback_secret/);
    assert.match(auth, /生产环境必须配置 JWT_SECRET/);
    assert.match(middleware, /生产环境必须配置 JWT_SECRET/);
});

test('API 静态契约：生产环境 Siri 入口必须配置独立 token', () => {
    const siri = readUtf8(path.join(repoRoot, 'api/routes/ai/siri.cjs'));

    assert.match(siri, /process\.env\.SIRI_API_TOKEN/);
    assert.match(siri, /生产环境必须配置 SIRI_API_TOKEN/);
    assert.match(siri, /if \(IS_PRODUCTION && !SIRI_TOKEN\)/);
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

test('API 静态契约：AI System Prompt 修改必须进入审计日志', () => {
    const db = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    const promptRoute = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));
    const sectionStart = db.indexOf('function setConfig');
    const sectionEnd = db.indexOf('// ── P1.7', sectionStart);
    const section = db.slice(sectionStart, sectionEnd);

    assert.match(section, /writeAuditLog\(/);
    assert.match(section, /CONFIG_UPDATE|CONFIG_INSERT/);
    assert.match(promptRoute, /setConfig\('ai-system-prompt', prompt\)/);
    assert.match(promptRoute, /提示词不能为空/);
    assert.match(promptRoute, /prompt\.length > 50000/);
    assert.doesNotMatch(promptRoute, /INSERT OR REPLACE INTO config/);
});

test('API 静态契约：微信小程序不得提交固定 INTERNAL_SECRET', () => {
    const config = readUtf8(path.join(repoRoot, 'wechat-miniprogram/config.js'));
    const apiUtil = readUtf8(path.join(repoRoot, 'wechat-miniprogram/utils/api.js'));

    assert.match(config, /INTERNAL_SECRET:\s*''/);
    assert.doesNotMatch(config, /pump_internal_|[a-f0-9]{32,}/i);
    assert.match(apiUtil, /INTERNAL_SECRET 未配置/);
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
