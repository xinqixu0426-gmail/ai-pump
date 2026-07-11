const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function walkFiles(dir, predicate, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && ['node_modules', '.next', 'dist', 'build'].includes(entry.name)) {
            continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkFiles(fullPath, predicate, files);
            continue;
        }
        if (predicate(fullPath)) files.push(fullPath);
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
    const roots = [
        path.join(repoRoot, 'src'),
        path.join(repoRoot, 'apps/web-next'),
    ].filter((dir) => fs.existsSync(dir));

    return roots.flatMap((root) => walkFiles(
        root,
        (filePath) => /\.(ts|tsx|js|jsx)$/.test(filePath)
    ));
}

test('API 静态契约：前端成本计算不得调用已删除的 /api/cost/calculate', () => {
    const srcFiles = frontendSourceFiles();

    const offenders = srcFiles
        .filter((filePath) => readUtf8(filePath).includes('/api/cost/calculate'))
        .map(relative);

    assert.deepEqual(offenders, []);
});

test('API 静态契约：前端不得新增裸 fetch 调用', () => {
    const srcFiles = frontendSourceFiles();

    const offenders = [];
    for (const filePath of srcFiles) {
        const rel = relative(filePath);
        if (['src/utils/api.ts', 'apps/web-next/lib/api.ts'].includes(rel)) continue;

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

test('API 静态契约：前端 API client 统一处理资源 id 兼容', () => {
    const source = readUtf8(path.join(repoRoot, 'src/utils/api.ts'));

    assert.match(source, /function normalizeLegacyEntity/);
    assert.match(source, /return normalizeLegacyEntities\(res\.data \|\| \[\]\);/);
    assert.doesNotMatch(source, /type LegacyListResponse/);
    assert.doesNotMatch(source, /function unwrapList/);
    assert.doesNotMatch(source, /response\.data\?\.id \?\? response\.data\?\.Id/);
    assert.doesNotMatch(source, /response\.id|response\.Id/);
});

test('API 静态契约：核心资源页面不得直接依赖 legacy Id 时间字段', () => {
    const files = [
        'src/pages/PartsPage.tsx',
        'src/components/parts/PartRow.tsx',
        'src/pages/RecipesPage.tsx',
        'src/components/TemplateSection.tsx',
        'src/components/ModelVariantSection.tsx',
        'src/components/recipe/StepTemplateSelect.tsx',
        'src/components/RecipeDetailModal.tsx',
        'src/pages/RecipeFormPage.tsx',
        'src/components/order/OrderItemsManager.tsx',
        'src/pages/CustomersPage.tsx',
        'src/pages/QuotationsPage.tsx',
        'src/components/GlobalSearch.tsx',
        'src/utils/orderFormRules.ts',
        'src/utils/recipeProductionRules.ts',
    ];

    const offenders = files.filter((filePath) => {
        const source = readUtf8(path.join(repoRoot, filePath));
        return /\.(Id|CreatedAt|UpdatedAt)\b/.test(source);
    });

    assert.deepEqual(offenders, []);
});

test('API 静态契约：parts 写接口新调用必须使用路径 ID', () => {
    const client = readUtf8(path.join(repoRoot, 'src/utils/api.ts'));
    const route = readUtf8(path.join(repoRoot, 'api/routes/parts.cjs'));

    assert.match(route, /router\.patch\('\/:id'/);
    assert.match(route, /router\.delete\('\/:id'/);
    assert.doesNotMatch(route, /router\.patch\('\/'/);
    assert.doesNotMatch(route, /router\.delete\('\/'/);
    assert.doesNotMatch(client, /proxyRequest<[^>]+>\('\/api\/parts',\s*\{\s*method: 'PATCH'/);
    assert.doesNotMatch(client, /proxyRequest\('\/api\/parts',\s*\{\s*method: 'DELETE'/);
});

test('API 静态契约：orders 写接口新调用必须使用路径 ID', () => {
    const client = readUtf8(path.join(repoRoot, 'src/utils/orderStore.ts'));
    const route = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));

    assert.match(route, /router\.patch\('\/:id'/);
    assert.match(route, /router\.delete\('\/:id'/);
    assert.doesNotMatch(route, /router\.patch\('\/'/);
    assert.doesNotMatch(route, /router\.delete\('\/'/);
    assert.match(client, /proxyRequest(?:<[^>]+>)?\(`\/api\/orders\/\$\{numId\}`,\s*\{\s*method: 'PATCH'/);
    assert.match(client, /proxyRequest(?:<[^>]+>)?\(`\/api\/orders\/\$\{numId\}`,\s*\{\s*method: 'DELETE'/);
    assert.match(client, /buildOrderSavePayloadDraft/);
    assert.match(client, /\/api\/orders\/save-payload-draft/);
    assert.doesNotMatch(client, /itemsJson: JSON\.stringify\(order\.items\)/);
    assert.doesNotMatch(client, /purchaseListJson: JSON\.stringify\(order\.purchaseList\)/);
    assert.doesNotMatch(client, /proxyRequest\('\/api\/orders',\s*\{\s*method: 'PATCH'/);
    assert.doesNotMatch(client, /proxyRequest\('\/api\/orders',\s*\{\s*method: 'DELETE'/);
});

test('API 静态契约：recipes 写接口新调用必须使用路径 ID', () => {
    const client = readUtf8(path.join(repoRoot, 'src/utils/api.ts'));
    const route = readUtf8(path.join(repoRoot, 'api/routes/recipes.cjs'));

    assert.match(route, /router\.patch\('\/:id'/);
    assert.match(route, /router\.delete\('\/:id'/);
    assert.doesNotMatch(route, /router\.patch\('\/'/);
    assert.doesNotMatch(route, /router\.delete\('\/'/);
    assert.match(client, /proxyRequest<[^>]+>\(`\/api\/recipes\/\$\{id\}`,\s*\{\s*method: 'PATCH'/);
    assert.match(client, /proxyRequest\(`\/api\/recipes\/\$\{id\}`,\s*\{\s*method: 'DELETE'/);
    assert.doesNotMatch(client, /proxyRequest<[^>]+>\('\/api\/recipes',\s*\{\s*method: 'PATCH'/);
    assert.doesNotMatch(client, /proxyRequest\('\/api\/recipes',\s*\{\s*method: 'DELETE'/);
});

test('API 静态契约：配方常用配置应用必须由后端生成草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/recipes.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/recipes.ts'));
    const nextView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));

    assert.match(route, /router\.post\('\/model-variant-draft'/);
    assert.match(route, /pump_model_variants WHERE id = \? AND deleted_at IS NULL/);
    assert.match(route, /loadTemplateContext\(variant\.templateId\)/);
    assert.match(route, /recipeDraft/);
    assert.match(route, /surfaceTreatmentMode/);
    assert.match(nextClient, /applyModelVariantDraft/);
    assert.match(nextClient, /\/api\/recipes\/model-variant-draft/);
    assert.match(nextView, /applyModelVariantDraft\(modelVariantId\)/);
    assert.doesNotMatch(nextView, /variants\.find\(\(item\) => String\(item\.id\) === nextVariantId\)/);
});

test('API 静态契约：配方泵壳模板应用必须由后端生成草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/templates.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/recipes.ts'));
    const nextView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));

    assert.match(route, /router\.get\('\/:id\/default-recipe'/);
    assert.match(route, /recipeDraft/);
    assert.match(route, /templateId: tpl\.id/);
    assert.match(route, /surfaceTreatmentMode: tpl\.paintingWage != null \? 'painting' : 'none'/);
    assert.match(nextClient, /getTemplateRecipeDraft/);
    assert.match(nextClient, /\/api\/templates\/\$\{templateId\}\/default-recipe/);
    assert.match(nextView, /getTemplateRecipeDraft\(templateId\)/);
    assert.doesNotMatch(nextView, /templates\.find\(\(item\) => String\(item\.id\) === nextTemplateId\)/);
});

test('API 静态契约：配方保存 payload 必须由后端生成草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/recipes.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/recipes.ts'));
    const nextView = readUtf8(path.join(repoRoot, 'apps/web-next/components/recipes-view.tsx'));

    assert.match(route, /router\.post\('\/save-payload-draft'/);
    assert.match(route, /function buildRecipeSavePayloadDraft/);
    assert.match(route, /packingPartsJson: JSON\.stringify\(recipeSelectionRows\(body\?\.packingParts, true\)\)/);
    assert.match(route, /technicalDataJson: stringifyTechnicalData\(body\?\.technicalData\)/);
    assert.match(nextClient, /buildRecipeSavePayloadDraft/);
    assert.match(nextClient, /\/api\/recipes\/save-payload-draft/);
    assert.match(nextView, /buildRecipeSavePayloadDraft\(\{/);
    assert.doesNotMatch(nextView, /partsJson: JSON\.stringify\(costDraft\.parts\)/);
    assert.doesNotMatch(nextView, /technicalDataJson: stringifyTechnicalData/);
});

test('API 静态契约：配方生产扣库存必须由后端动作执行', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/recipes.cjs'));
    const apiClient = readUtf8(path.join(repoRoot, 'src/utils/api.ts'));
    const detailModal = readUtf8(path.join(repoRoot, 'src/components/RecipeDetailModal.tsx'));

    assert.match(route, /router\.post\('\/:id\/production-check'/);
    assert.match(route, /router\.post\('\/:id\/produce'/);
    assert.match(route, /function buildRecipeProductionDraft/);
    assert.match(route, /function produceRecipe/);
    assert.match(route, /db\.transaction\(\(\) =>/);
    assert.match(route, /safeUpdate\('parts', deduction\.partId, \{ stock \}\)/);
    assert.match(apiClient, /produceRecipe\(recipeId: number, produceQty: number\)/);
    assert.match(apiClient, /\/api\/recipes\/\$\{id\}\/produce/);
    assert.doesNotMatch(detailModal, /batchDeductStock/);
    assert.doesNotMatch(detailModal, /stockDeductionsFromChecks/);
});

test('API 静态契约：报价转订单必须由后端生成订单草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/quotations.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quotations.ts'));
    const legacyClient = readUtf8(path.join(repoRoot, 'src/utils/api.ts'));
    const legacyPage = readUtf8(path.join(repoRoot, 'src/pages/QuotationsPage.tsx'));

    assert.match(route, /router\.post\('\/:id\/order-draft'/);
    assert.match(route, /function buildOrderDraftFromQuotation/);
    assert.match(route, /buildOrderPlan\(orderItems, dbGetAllParts\(\)\)/);
    assert.match(nextClient, /buildQuotationOrderDraft\(quotationId: number\)/);
    assert.match(nextClient, /\/api\/quotations\/\$\{quotationId\}\/order-draft/);
    assert.match(nextClient, /input\.draft \|\| await buildQuotationOrderDraft\(input\.quotation\.id\)/);
    assert.doesNotMatch(nextClient, /generatePurchasePlan/);
    assert.doesNotMatch(nextClient, /recipes\.find\(\(candidate\) => candidate\.id === Number\(item\.baseRecipeId\)\)/);
    assert.match(legacyClient, /buildOrderDraftFromQuotation/);
    assert.match(legacyClient, /\/api\/quotations\/\$\{quotationId\}\/order-draft/);
    assert.match(legacyPage, /buildOrderDraftFromQuotation\(entityId\(q\)\)/);
    assert.doesNotMatch(legacyPage, /buildOrderFromQuotation/);
    assert.doesNotMatch(legacyPage, /quotationOrderConversion/);
});

test('API 静态契约：报价保存 payload 必须由后端生成草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/quotations.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/quotations.ts'));
    const legacyClient = readUtf8(path.join(repoRoot, 'src/utils/api.ts'));
    const legacyPage = readUtf8(path.join(repoRoot, 'src/pages/QuotationsPage.tsx'));

    assert.match(route, /router\.post\('\/save-payload-draft'/);
    assert.match(route, /function buildQuotationSavePayloadDraft/);
    assert.match(route, /itemsJson: JSON\.stringify\(items\)/);
    assert.match(route, /totalCost/);
    assert.match(route, /totalPrice/);
    assert.match(nextClient, /buildQuotationSavePayloadDraft/);
    assert.match(nextClient, /\/api\/quotations\/save-payload-draft/);
    assert.doesNotMatch(nextClient, /itemsJson: JSON\.stringify\(input\.items\)/);
    assert.doesNotMatch(nextClient, /totalCost: totals\.totalCost/);
    assert.doesNotMatch(nextClient, /totalPrice: totals\.totalPrice/);
    assert.match(legacyClient, /buildQuotationSavePayloadDraft/);
    assert.match(legacyClient, /\/api\/quotations\/save-payload-draft/);
    assert.match(legacyPage, /const data: QuotationInput = \{ customerId, status, items, remark \}/);
    assert.doesNotMatch(legacyPage, /itemsJson: JSON\.stringify\(items\)/);
    assert.doesNotMatch(legacyPage, /calculateQuotationTotals\(items\)/);
});

test('API 静态契约：订单保存 payload 必须由后端生成草稿', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/orders.ts'));
    const nextView = readUtf8(path.join(repoRoot, 'apps/web-next/components/orders-view.tsx'));
    const legacyClient = readUtf8(path.join(repoRoot, 'src/utils/orderStore.ts'));
    const legacyFormRules = readUtf8(path.join(repoRoot, 'src/utils/orderFormRules.ts'));
    const legacyOrderForm = readUtf8(path.join(repoRoot, 'src/pages/OrderFormPage.tsx'));

    assert.match(route, /router\.post\('\/save-payload-draft'/);
    assert.match(route, /function buildOrderSavePayloadDraft/);
    assert.match(route, /itemsJson: JSON\.stringify\(items\)/);
    assert.match(route, /purchaseListJson: JSON\.stringify\(plan\.purchaseList/);
    assert.match(nextClient, /buildOrderSavePayloadDraft/);
    assert.match(nextClient, /\/api\/orders\/save-payload-draft/);
    assert.doesNotMatch(nextClient, /itemsJson: JSON\.stringify\(order\.items\)/);
    assert.doesNotMatch(nextClient, /purchaseListJson: JSON\.stringify\(order\.purchaseList\)/);
    assert.doesNotMatch(nextView, /generatePurchasePlan\(draftItems\)/);
    assert.match(legacyClient, /buildOrderSavePayloadDraft/);
    assert.match(legacyClient, /\/api\/orders\/save-payload-draft/);
    assert.doesNotMatch(legacyClient, /itemsJson: JSON\.stringify\(order\.items\)/);
    assert.doesNotMatch(legacyClient, /purchaseListJson: JSON\.stringify\(order\.purchaseList\)/);
    assert.doesNotMatch(legacyFormRules, /order\.purchaseList = input\.purchaseList/);
    assert.doesNotMatch(legacyFormRules, /order\.todos = input\.todos/);
    assert.doesNotMatch(legacyOrderForm, /purchaseList,\s*\n\s*todos,\s*\n\s*orderTotals/);
});

test('API 静态契约：订单详情动作必须由后端执行', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const nextClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/orders.ts'));
    const detailDrawer = readUtf8(path.join(repoRoot, 'apps/web-next/components/order-detail-drawer.tsx'));
    const legacyClient = readUtf8(path.join(repoRoot, 'src/utils/orderStore.ts'));
    const legacyDetail = readUtf8(path.join(repoRoot, 'src/components/OrderDetailModal.tsx'));
    const legacyOrdersPage = readUtf8(path.join(repoRoot, 'src/pages/OrdersPage.tsx'));
    const legacyRules = readUtf8(path.join(repoRoot, 'src/utils/orderLifecycleRules.ts'));
    const legacyApi = readUtf8(path.join(repoRoot, 'src/utils/api.ts'));

    assert.match(route, /router\.post\('\/:id\/status'/);
    assert.match(route, /router\.post\('\/:id\/purchase-items\/toggle'/);
    assert.match(route, /router\.post\('\/:id\/todos\/toggle'/);
    assert.match(route, /router\.post\('\/:id\/complete-purchase'/);
    assert.match(route, /db\.transaction\(\(orderId\) =>/);
    assert.match(route, /safeUpdate\('parts', partId, \{ stock \}\)/);
    assert.match(route, /safeUpdate\('orders', orderId/);
    assert.match(nextClient, /setOrderStatus/);
    assert.match(nextClient, /toggleOrderPurchaseItem/);
    assert.match(nextClient, /toggleOrderTodoItem/);
    assert.match(nextClient, /completeOrderPurchase/);
    assert.match(nextClient, /\/api\/orders\/\$\{orderId\(order\)\}\/complete-purchase/);
    assert.doesNotMatch(detailDrawer, /saveOrder/);
    assert.doesNotMatch(detailDrawer, /batchAddStock/);
    assert.doesNotMatch(detailDrawer, /updateOrderStatus|togglePurchaseItem|toggleTodoItem|completePurchaseOrder/);
    assert.match(legacyClient, /setOrderStatus/);
    assert.match(legacyClient, /toggleOrderPurchaseItem/);
    assert.match(legacyClient, /toggleOrderTodoItem/);
    assert.match(legacyClient, /completeOrderPurchase/);
    assert.doesNotMatch(legacyDetail, /saveOrder/);
    assert.doesNotMatch(legacyDetail, /batchAddStock/);
    assert.doesNotMatch(legacyDetail, /updateOrderStatus|togglePurchaseItem|toggleTodoItem|completePurchaseOrder/);
    assert.doesNotMatch(legacyOrdersPage, /saveOrder\(updateOrderStatus/);
    assert.doesNotMatch(legacyRules, /export function updateOrderStatus|export function togglePurchaseItem|export function toggleTodoItem|export function completePurchaseOrder|stockAdditionsFromPurchaseList/);
    assert.doesNotMatch(legacyApi, /export async function batchAddStock/);
});

test('API 静态契约：采购中心批量采购状态必须由后端执行', () => {
    const route = readUtf8(path.join(repoRoot, 'api/routes/orders.cjs'));
    const purchaseClient = readUtf8(path.join(repoRoot, 'apps/web-next/lib/purchase.ts'));
    const legacyClient = readUtf8(path.join(repoRoot, 'src/utils/orderStore.ts'));
    const legacyPurchasePage = readUtf8(path.join(repoRoot, 'src/pages/PurchaseCenterPage.tsx'));
    const legacyPurchaseRules = readUtf8(path.join(repoRoot, 'src/utils/purchaseCenterRules.ts'));

    assert.match(route, /router\.post\('\/purchase-items\/batch'/);
    assert.match(route, /function applyPurchaseItemsByTask/);
    assert.match(route, /SELECT \* FROM orders WHERE deleted_at IS NULL AND status != \?/);
    assert.match(route, /safeUpdate\('orders', record\.id/);
    assert.match(purchaseClient, /\/api\/orders\/purchase-items\/batch/);
    assert.doesNotMatch(purchaseClient, /saveOrder/);
    assert.doesNotMatch(purchaseClient, /buildUpdatedOrders/);
    assert.match(legacyClient, /applyPurchaseTaskByModel/);
    assert.match(legacyClient, /\/api\/orders\/purchase-items\/batch/);
    assert.doesNotMatch(legacyPurchasePage, /saveOrder/);
    assert.doesNotMatch(legacyPurchasePage, /buildUpdatedOrders/);
    assert.doesNotMatch(legacyPurchaseRules, /export function buildUpdatedOrders/);
});

test('API 静态契约：客户和报价写接口新调用必须使用路径 ID', () => {
    const client = readUtf8(path.join(repoRoot, 'src/utils/api.ts'));
    const customersRoute = readUtf8(path.join(repoRoot, 'api/routes/customers.cjs'));
    const quotationsRoute = readUtf8(path.join(repoRoot, 'api/routes/quotations.cjs'));

    assert.match(customersRoute, /router\.patch\('\/:id'/);
    assert.match(customersRoute, /router\.delete\('\/:id'/);
    assert.match(quotationsRoute, /router\.patch\('\/:id'/);
    assert.match(quotationsRoute, /router\.delete\('\/:id'/);
    assert.match(client, /`\/api\/customers\/\$\{id\}`,\s*\{\s*method: 'PATCH'/);
    assert.match(client, /`\/api\/customers\/\$\{id\}`,\s*\{\s*method: 'DELETE'/);
    assert.match(client, /`\/api\/quotations\/\$\{id\}`,\s*\{\s*method: 'PATCH'/);
    assert.match(client, /`\/api\/quotations\/\$\{id\}`,\s*\{\s*method: 'DELETE'/);
    assert.doesNotMatch(client, /proxyRequest<[^>]+>\('\/api\/customers',\s*\{\s*method: 'PATCH'/);
    assert.doesNotMatch(client, /proxyRequest<[^>]+>\('\/api\/customers',\s*\{\s*method: 'DELETE'/);
    assert.doesNotMatch(client, /proxyRequest<[^>]+>\('\/api\/quotations',\s*\{\s*method: 'PATCH'/);
    assert.doesNotMatch(client, /proxyRequest<[^>]+>\('\/api\/quotations',\s*\{\s*method: 'DELETE'/);
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
    assert.doesNotMatch(docs, /partId\/id\/Id/);
});

test('API 静态契约：业务新增写库必须通过 safeInsert', () => {
    const dbSource = readUtf8(path.join(repoRoot, 'api/db.cjs'));
    assert.match(dbSource, /function safeInsert\(table, values\)/);
    assert.match(dbSource, /writeAuditLog\('INSERT', table/);
    assert.match(dbSource, /safeInsert,/);

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

    assert.match(queryExecutor, /internalFetch\('\/api\/parts'/);
    assert.match(queryExecutor, /internalFetch\(`\/api\/parts\/\$\{target\.Id\}`/);
    assert.doesNotMatch(queryExecutor, /safeInsert\('parts'/);
    assert.doesNotMatch(queryExecutor, /softDelete\('parts'/);

    assert.match(orderExecutor, /internalFetch\(`\/api\/orders\/\$\{row\.Id\}`/);
    assert.doesNotMatch(orderExecutor, /softDelete\('orders'/);

    assert.match(recipeExecutor, /internalFetch\(`\/api\/recipes\/\$\{recipe\.Id\}`/);
    assert.doesNotMatch(recipeExecutor, /softDelete\('recipes'/);
});

test('重构准备契约：业务流程冻结文档必须存在并被 README 引用', () => {
    const businessFlowPath = path.join(repoRoot, 'docs/business-flow.md');
    const readme = readUtf8(path.join(repoRoot, 'docs/README.md'));
    const flow = readUtf8(businessFlowPath);

    assert.match(readme, /\[business-flow\.md\]\(\.\/business-flow\.md\)/);
    assert.match(flow, /写库与只读边界/);
    assert.match(flow, /成本快照规则/);
    assert.match(flow, /报价转订单必须保存展开后的 BOM 快照/);
    assert.match(flow, /采购中心不入库/);
});
