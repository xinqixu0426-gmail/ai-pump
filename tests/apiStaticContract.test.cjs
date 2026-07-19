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

test('API 静态契约：发布前检查脚本必须串起 audit、test、build 和生产环境校验', () => {
    const pkg = JSON.parse(readUtf8(path.join(repoRoot, 'package.json')));
    const release = pkg.scripts?.['verify:release'] || '';

    assert.match(release, /npm audit/);
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

test('API 静态契约：配方生产扣库存必须由后端动作执行', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/recipes.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/recipes.ts'));
    const recipeView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));

    assert.match(route, /router\.post\('\/:id\/production-check'/);
    assert.match(route, /router\.post\('\/:id\/produce'/);
    assert.match(route, /function produceRecipe/);
    assert.match(route, /safeUpdate\('parts', deduction\.partId, \{ stock \}\)/);
    assert.match(nextClient, /produceRecipe\(recipeId: number, produceQty: number\)/);
    assert.match(nextClient, /\/api\/recipes\/\$\{recipeId\}\/produce/);
    assert.doesNotMatch(recipeView, /batchDeductStock|stockDeductionsFromChecks/);
});

test('API 静态契约：报价转订单必须由后端生成订单草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/quotations.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quotations.ts'));

    assert.match(route, /router\.post\('\/:id\/order-draft'/);
    assert.match(route, /function buildOrderDraftFromQuotation/);
    assert.match(route, /buildOrderPlan\(orderItems, dbGetAllParts\(\)\)/);
    assert.match(nextClient, /buildQuotationOrderDraft\(quotationId: number\)/);
    assert.match(nextClient, /\/api\/quotations\/\$\{quotationId\}\/order-draft/);
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
    assert.match(route, /router\.post\('\/:id\/purchase-items\/toggle'/);
    assert.match(route, /router\.post\('\/:id\/todos\/toggle'/);
    assert.match(route, /router\.post\('\/:id\/complete-purchase'/);
    assert.match(route, /safeUpdate\('parts', partId, \{ stock \}\)/);
    assert.match(nextClient, /setOrderStatus/);
    assert.match(nextClient, /toggleOrderPurchaseItem/);
    assert.match(nextClient, /toggleOrderTodoItem/);
    assert.match(nextClient, /completeOrderPurchase/);
    assert.doesNotMatch(detailDrawer, /saveOrder|batchAddStock/);
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
    ];

    const forbidden = /\b(dbGet\w+|loadPartsData|calculateRecipeCost|db\.prepare|safeInsert|safeUpdate|softDelete|hardDelete)\b|response\.json\(/;
    const offenders = executorFiles
        .filter((filePath) => forbidden.test(readUtf8(path.join(repoRoot, filePath))))
        .map((filePath) => filePath.replace(/\\/g, '/'));

    assert.deepEqual(offenders, []);
});

test('API 静态契约：AI 默认系统提示词不得宣称业务工具直接写数据库', () => {
    const promptRoute = readUtf8(path.join(repoRoot, 'api/routes/ai/prompt.cjs'));

    assert.match(promptRoute, /所有业务写操作必须通过工具调用，由后端标准 API 执行/);
    assert.match(promptRoute, /优先使用配方保存成本作为订单锁价/);
    assert.doesNotMatch(promptRoute, /直接写入数据库/);
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
