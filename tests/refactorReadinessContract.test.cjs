const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function readUtf8(filePath) {
    return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

function walkFiles(dir, predicate, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && ['node_modules', '.next'].includes(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkFiles(fullPath, predicate, files);
            continue;
        }
        if (predicate(fullPath)) files.push(fullPath);
    }
    return files;
}

function relative(filePath) {
    return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

test('文档契约：当前核心文档必须存在并被 README 引用', () => {
    const readme = readUtf8('docs/README.md');
    const requiredDocs = [
        'business-flow.md',
        'frontend-state-boundary.md',
        'ui-refactor-guidelines.md',
    ];

    for (const doc of requiredDocs) {
        assert.ok(fs.existsSync(path.join(repoRoot, 'docs', doc)), `${doc} should exist`);
        assert.match(readme, new RegExp(`\\[${doc}\\]\\(\\.\\/${doc}\\)`));
    }
});

test('文档契约：生产发布清单必须被根 README 引用并覆盖关键检查', () => {
    const rootReadme = readUtf8('README.md');
    const docPath = path.join(repoRoot, 'docs/deployment-checklist.md');
    const doc = readUtf8('docs/deployment-checklist.md');
    const deploySection = rootReadme.split('## 生产发布')[1].split('## 文档入口')[0];

    assert.ok(fs.existsSync(docPath), 'deployment checklist should exist');
    assert.match(rootReadme, /\[docs\/deployment-checklist\.md\]\(docs\/deployment-checklist\.md\)/);
    assert.match(deploySection, /\.\/scripts\/install-macmini-launchdaemons\.sh/);
    assert.doesNotMatch(deploySection, /pkill -f/);
    assert.doesNotMatch(deploySection, /nohup node api\.cjs/);
    for (const marker of [
        '.env.example',
        'ACCESS_PASSWORD',
        'JWT_SECRET',
        'INTERNAL_SECRET',
        'CORS_ORIGIN',
        'SIRI_API_TOKEN',
        'npm run verify:release',
        'npm run verify:prod-env',
        './scripts/install-macmini-launchdaemons.sh',
        '不要把手动 `pkill + nohup` 作为常规发布路径',
        'curl http://127.0.0.1:3002/api/health',
        'logs/api-launchd.error.log',
    ]) {
        assert.match(doc, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('文档契约：API SOP 必须约束历史兼容字段扩散', () => {
    const doc = readUtf8('docs/api-sop.md');

    for (const marker of [
        'Id',
        'CreatedAt',
        'UpdatedAt',
        'snake_case',
        'camelCase',
        'apps/web-next/lib/',
        'paintingWage',
        'boxType',
        'surfaceTreatmentMode',
        'packingPartsJson',
        'npm run verify:release',
    ]) {
        assert.match(doc, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('文档契约：迁移过程文档和旧前端回滚说明不得保留', () => {
    const removedDocs = [
        'docs/next-migration-acceptance.md',
        'docs/ai-api-executor-migration-plan.md',
        'docs/business-logic-refactor-status.md',
        'docs/cost-rules.md',
    ];

    for (const doc of removedDocs) {
        assert.equal(fs.existsSync(path.join(repoRoot, doc)), false, `${doc} should be removed`);
    }

    const docs = walkFiles(path.join(repoRoot, 'docs'), (filePath) => /\.md$/.test(filePath))
        .map((filePath) => readUtf8(relative(filePath)))
        .join('\n');
    const readme = readUtf8('README.md') + '\n' + readUtf8('docs/README.md');

    assert.doesNotMatch(readme, /next-migration-acceptance|ai-api-executor-migration-plan|legacy:dev|回滚备用/);
    assert.doesNotMatch(docs, /Next 迁移验收清单|AI 调用 API 改造计划|正式 UI\/交互重构前|正式 UI 重构前/);
});

test('文档契约：Next 当前启动和生产脚本保持可用', () => {
    const packageJson = JSON.parse(readUtf8('package.json'));
    const rootReadme = readUtf8('README.md');

    assert.equal(packageJson.scripts['web-next:full'], 'concurrently "npm run api" "npm run web-next:dev"');
    assert.equal(packageJson.scripts['web-next:prod'], 'concurrently "npm run start:prod" "npm run web-next:start"');
    assert.equal(packageJson.scripts['restart:local'], 'powershell -ExecutionPolicy Bypass -File scripts/restart-local-dev.ps1');
    assert.match(rootReadme, /npm start/);
    assert.match(rootReadme, /npm run restart:local/);
    assert.match(rootReadme, /npm run web-next:full/);
    assert.match(rootReadme, /npm run build/);
});

test('文档契约：本地重启脚本保留前后端崩溃日志', () => {
    const restartScript = readUtf8('scripts/restart-local-dev.ps1');

    assert.match(restartScript, /Get-NetTCPConnection/);
    assert.match(restartScript, /Stop-Process/);
    assert.match(restartScript, /Start-Process/);
    assert.match(restartScript, /api\.cjs/);
    assert.match(restartScript, /dev:primary/);
    assert.match(restartScript, /local-api\.error\.log/);
    assert.match(restartScript, /local-web\.error\.log/);
});

test('文档契约：AI 文本助手在 Next 中启用导航', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const docsReadme = readUtf8('docs/README.md');

    assert.match(shell, /\{\s*href: '\/ai',\s*label: 'AI',\s*icon: Bot,\s*enabled: true\s*\}/);
    assert.ok(fs.existsSync(path.join(repoRoot, 'apps/web-next/app/ai/page.tsx')), 'Next AI page should exist once AI navigation is enabled');
    assert.match(docsReadme, /AI executor 已通过内部 API client 调用标准 API/);
});

test('文档契约：数据质量面板必须有独立导航和标准 API', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const qualityView = readUtf8('apps/web-next/components/quality-view.tsx');
    const qualityLib = readUtf8('apps/web-next/lib/quality.ts');
    const quotationsView = readUtf8('apps/web-next/components/quotations-view.tsx');
    const ordersView = readUtf8('apps/web-next/components/orders-view.tsx');
    const api = readUtf8('api.cjs');
    const docs = readUtf8('docs/api-reference.md') + '\n' + readUtf8('docs/README.md');

    assert.match(shell, /\{\s*href: '\/quality',\s*label: '质量',\s*icon: ShieldCheck,\s*enabled: true\s*\}/);
    assert.ok(fs.existsSync(path.join(repoRoot, 'apps/web-next/app/quality/page.tsx')), 'quality page should exist');
    assert.match(qualityView, /getDataQualitySummary/);
    assert.match(qualityView, /getBusinessAlerts/);
    assert.match(qualityView, /经营提醒/);
    assert.match(qualityLib, /\/api\/quality\/business-alerts/);
    assert.match(quotationsView, /BusinessAlertsBanner scope="quotation"/);
    assert.match(ordersView, /BusinessAlertsBanner scope="order"/);
    assert.match(api, /\/api\/quality/);
    assert.match(docs, /\/api\/quality\/summary/);
    assert.match(docs, /\/api\/quality\/business-alerts/);
});

test('文档契约：前端状态边界必须约束全局状态、页面状态和刷新规则', () => {
    const doc = readUtf8('docs/frontend-state-boundary.md');

    assert.match(doc, /全局状态/);
    assert.match(doc, /页面本地状态/);
    assert.match(doc, /重新拉取对应资源/);
    assert.match(doc, /派生数据/);
    assert.match(doc, /跨资源刷新规则/);
    assert.match(doc, /禁止全局乐观写入/);
});

test('文档契约：UI 约束必须覆盖简洁风格、动效和业务边界', () => {
    const doc = readUtf8('docs/ui-refactor-guidelines.md');

    assert.match(doc, /motion-primitives/);
    assert.match(doc, /简洁/);
    assert.match(doc, /AI 味/);
    assert.match(doc, /动效只用于解释状态变化/);
    assert.match(doc, /表格操作要稳定/);
    assert.match(doc, /业务不可变边界/);
});

test('文档契约：业务流程文档必须链接状态和 UI 约束', () => {
    const doc = readUtf8('docs/business-flow.md');

    assert.match(doc, /\[前端状态边界\]\(\.\/frontend-state-boundary\.md\)/);
    assert.match(doc, /\[UI\/交互约束\]\(\.\/ui-refactor-guidelines\.md\)/);
});

test('Next UI 契约：按钮链接必须走基础组件且不得引入 MUI', () => {
    const webNextRoot = path.join(repoRoot, 'apps/web-next');
    const files = walkFiles(
        webNextRoot,
        (filePath) => /\.(ts|tsx)$/.test(filePath)
    );

    const muiOffenders = files
        .filter((filePath) => readUtf8(relative(filePath)).includes('@mui/'))
        .map(relative);
    assert.deepEqual(muiOffenders, []);

    const linkOffenders = files
        .filter((filePath) => {
            const rel = relative(filePath);
            if (rel === 'apps/web-next/components/ui/nav-item.tsx') return false;
            return /from 'next\/link'|from "next\/link"/.test(readUtf8(rel));
        })
        .map(relative);
    assert.deepEqual(linkOffenders, []);

    const doc = readUtf8('docs/ui-refactor-guidelines.md');
    assert.match(doc, /无频闪交互规则/);
    assert.match(doc, /prefetch=\{false\}/);
});

test('Next UI 契约：详情编辑面板必须居中显示，不使用右侧抽屉', () => {
    const slideOver = readUtf8('apps/web-next/components/motion/slide-over.tsx');

    assert.match(slideOver, /items-center justify-center/);
    assert.match(slideOver, /max-h-\[calc\(100vh-2rem\)\]/);
    assert.match(slideOver, /rounded-panel/);
    assert.doesNotMatch(slideOver, /right-0/);
    assert.doesNotMatch(slideOver, /\bborder-l\b/);
});

test('Next UI 契约：启用导航必须有真实页面且只允许 NavItem 使用 Link', () => {
    const shell = readUtf8('apps/web-next/components/app-shell.tsx');
    const navMatches = Array.from(shell.matchAll(/\{\s*href: '([^']+)',\s*label: '([^']+)',\s*icon: [^,]+,\s*enabled: true\s*\}/g));
    const enabledRoutes = navMatches.map((match) => match[1]);

    assert.ok(enabledRoutes.length > 0, 'should find enabled Next nav routes');
    for (const route of enabledRoutes) {
        const pagePath = route === '/'
            ? 'apps/web-next/app/page.tsx'
            : `apps/web-next/app${route}/page.tsx`;
        assert.ok(fs.existsSync(path.join(repoRoot, pagePath)), `${route} should have ${pagePath}`);
    }

    const webNextRoot = path.join(repoRoot, 'apps/web-next');
    const files = walkFiles(webNextRoot, (filePath) => /\.(ts|tsx)$/.test(filePath));
    const linkOffenders = files
        .filter((filePath) => {
            const rel = relative(filePath);
            if (rel === 'apps/web-next/components/ui/nav-item.tsx') return false;
            return /from 'next\/link'|from "next\/link"/.test(readUtf8(rel));
        })
        .map(relative);

    assert.deepEqual(linkOffenders, []);
});

test('Next API 契约：页面组件不得直接请求 API', () => {
    const componentRoots = [
        path.join(repoRoot, 'apps/web-next/app'),
        path.join(repoRoot, 'apps/web-next/components'),
    ];
    const files = componentRoots.flatMap((root) => walkFiles(root, (filePath) => /\.(ts|tsx)$/.test(filePath)));

    const offenders = files
        .filter((filePath) => {
            const source = readUtf8(relative(filePath));
            return /import\s+\{[^}]*\bproxy(?:Request|Fetch)\b[^}]*\}/.test(source) ||
                /\bproxy(?:Request|Fetch)\s*\(/.test(source);
        })
        .map(relative);

    assert.deepEqual(offenders, []);
});

test('Next UI 契约：不得重新引入 MUI 或 Emotion 依赖', () => {
    const packageJson = JSON.parse(readUtf8('apps/web-next/package.json'));
    const packageLock = readUtf8('apps/web-next/package-lock.json');
    const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
    };

    const forbiddenDeps = Object.keys(deps).filter((name) => (
        name.startsWith('@mui/') ||
        name.startsWith('@emotion/')
    ));
    assert.deepEqual(forbiddenDeps, []);
    assert.doesNotMatch(packageLock, /"node_modules\/@mui\//);
    assert.doesNotMatch(packageLock, /"node_modules\/@emotion\//);
});

test('Next UI 契约：配方技术参数必须结构化编辑，不回退到手写 JSON', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const editor = readUtf8('apps/web-next/components/technical-data-editor.tsx');
    const technicalLib = readUtf8('apps/web-next/lib/technical-data.ts');

    assert.match(recipesView, /TechnicalDataEditor/);
    assert.match(recipesView, /parseTechnicalDataJson/);
    assert.match(recipesView, /buildRecipeSavePayloadDraft/);
    assert.doesNotMatch(recipesView, /技术参数 JSON/);
    assert.doesNotMatch(recipesView, /<textarea[\s\S]*technicalDataJson/);
    assert.doesNotMatch(recipesView, /technicalDataJson: stringifyTechnicalData/);
    assert.match(editor, /固定技术字段/);
    assert.match(editor, /自定义参数/);
    assert.match(editor, /useState\(false\)/);
    assert.match(editor, /expanded \? <div/);
    assert.match(technicalLib, /customFields/);
});

test('Next UI 契约：配方零件必须在旁边展示成本价和计算公式', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const recipesLib = readUtf8('apps/web-next/lib/recipes.ts');
    const apiReference = readUtf8('docs/api-reference.md');

    assert.match(recipesView, /partCostLine/);
    assert.match(recipesView, /partFormulaLine/);
    assert.match(recipesView, /findDraftPart\(bomDraft, part\)/);
    assert.match(recipesView, /公式:/);
    assert.match(recipesView, /小计/);
    assert.match(recipesLib, /formula\?: string/);
    assert.match(apiReference, /snapshotPrice/);
    assert.match(apiReference, /formula\/costSource\/source/);
});

test('Next UI 契约：配方编辑必须按泵壳、线圈和选配顺序分区', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const technicalEditor = readUtf8('apps/web-next/components/technical-data-editor.tsx');

    assert.match(recipesView, /1\. 泵壳与产品/);
    assert.match(recipesView, /2\. 线圈转子/);
    assert.match(recipesView, /3\. 浮球与电缆/);
    assert.match(recipesView, /4\. 包装与其他配件/);
    assert.match(recipesView, /5\. 人工与费用/);
    assert.match(recipesView, /配方名称/);
    assert.match(recipesView, /泵壳模板/);
    assert.match(recipesView, /线重 kg/);
    assert.match(recipesView, /exactCoilRecord\.wireWeight/);
    assert.match(recipesView, /value=\{form\.coilWireWeight\}/);
    assert.match(recipesView, /系统默认 \/ 客户指定/);
    assert.doesNotMatch(recipesView, /recipe-coil-wire-weight-options/);
    assert.match(recipesView, /模板 \/ 型号零配件/);
    assert.match(recipesView, /relatedBomParts/);
    assert.match(recipesView, /自动关联电容/);
    assert.match(recipesView, /bomDraft\?\.coilSnapshot\?\.formula/);
    assert.doesNotMatch(recipesView, /线圈与叶轮/);
    assert.match(technicalEditor, /叶轮参数/);
});

test('Next UI 契约：零件页必须按分类提供结构化输入', () => {
    const partsView = readUtf8('apps/web-next/components/parts-view.tsx');
    const rules = readUtf8('apps/web-next/lib/part-form-rules.ts');
    const partsLib = readUtf8('apps/web-next/lib/parts.ts');

    assert.match(partsView, /validatePartForm/);
    assert.match(partsView, /buildPartNotes/);
    assert.match(partsView, /finalPartModel/);
    assert.match(partsView, /getSettingValue/);
    assert.match(partsView, /setSettingValue/);
    for (const label of ['电容容量', '线径', '电缆配件费', '新界式浮球加价', '按长度自动计价', '不锈钢机筒', '保存并继续']) {
        assert.match(partsView, new RegExp(label));
    }
    for (const marker of ['groupedParts', 'collapsedCategories', 'toggleSelectGroup', 'exportSelectedCsv', 'deleteParts']) {
        assert.match(partsView, new RegExp(marker));
    }
    for (const category of ['电容', '电缆线', '浮球', '螺丝', '泵壳']) {
        assert.match(rules, new RegExp(category));
    }
    assert.match(partsLib, /\/api\/settings\/\$\{key\}/);
    assert.match(partsLib, /export async function deleteParts/);
});

test('Next UI 契约：订单详情必须保留后端动作和入库确认', () => {
    const ordersView = readUtf8('apps/web-next/components/orders-view.tsx');
    const detailDrawer = readUtf8('apps/web-next/components/order-detail-drawer.tsx');
    const ordersLib = readUtf8('apps/web-next/lib/orders.ts');

    assert.match(ordersView, /OrderDetailDrawer/);
    assert.match(ordersView, /createOrder/);
    assert.match(detailDrawer, /toggleOrderPurchaseItem/);
    assert.match(detailDrawer, /toggleOrderTodoItem/);
    assert.match(detailDrawer, /setOrderStatus/);
    assert.match(detailDrawer, /completeOrderPurchase/);
    assert.match(detailDrawer, /确认采购完成并入库/);
    assert.match(detailDrawer, /purchaseAdditions/);
    assert.match(detailDrawer, /避免重复入库/);
    assert.match(ordersLib, /\/api\/orders\/\$\{orderId\(order\)\}\/status/);
    assert.match(ordersLib, /\/api\/orders\/\$\{orderId\(order\)\}\/purchase-items\/toggle/);
    assert.match(ordersLib, /\/api\/orders\/\$\{orderId\(order\)\}\/todos\/toggle/);
    assert.match(ordersLib, /\/api\/orders\/\$\{orderId\(order\)\}\/complete-purchase/);
});

test('Next UI 契约：订单新增产品保存成本为空时必须后端兜底试算', () => {
    const ordersView = readUtf8('apps/web-next/components/orders-view.tsx');
    const ordersLib = readUtf8('apps/web-next/lib/orders.ts');

    assert.match(ordersLib, /getRecipeCurrentPartsCost/);
    assert.match(ordersLib, /\/api\/recipes\/\$\{recipeId\}\/cost/);
    assert.match(ordersLib, /createOrderItemWithUnitCost/);
    assert.match(ordersView, /getRecipeCurrentPartsCost\(selectedRecipe\.id\)/);
    assert.match(ordersView, /保存成本为空时调用后端当前配件价作为参考/);
    assert.doesNotMatch(ordersView, /保存成本为空时该产品成本为 0/);
});

test('Next UI 契约：线圈页必须保留材质默认单价和规格组批量改单价', () => {
    const coilsView = readUtf8('apps/web-next/components/coils-view.tsx');
    const coilsLib = readUtf8('apps/web-next/lib/coils.ts');
    const docsReadme = readUtf8('docs/README.md');

    assert.match(coilsView, /实时市场指标/);
    assert.match(coilsView, /同步市场指标/);
    assert.match(coilsView, /refreshMarketIndicators/);
    assert.match(coilsView, /syncMarketIndicators/);
    assert.match(coilsView, /材质默认单价/);
    assert.match(coilsView, /保存单价配置/);
    assert.match(coilsView, /添加材质/);
    assert.match(coilsView, /改单价/);
    assert.match(coilsView, /saveMaterialConfig/);
    assert.match(coilsView, /saveGroupPrice/);
    assert.match(coilsLib, /saveCoilMaterialPrices/);
    assert.match(coilsLib, /\/api\/coils\/materials/);
    assert.match(coilsLib, /updateCoilSpecPrice/);
    assert.match(coilsLib, /\/api\/coils\/spec\/\$\{encodeURIComponent\(spec\)\}/);
    assert.match(coilsLib, /getMarketIndicators/);
    assert.match(coilsLib, /\/api\/market-indicators/);
    assert.match(coilsLib, /updateMarketIndicators/);
    assert.match(coilsLib, /\/api\/market-indicators\/update/);
    assert.match(docsReadme, /实时市场指标/);
    assert.match(docsReadme, /材质默认单价/);
    assert.match(docsReadme, /规格组批量改单价/);
});

test('Next UI 契约：报价转订单必须先预览后确认', () => {
    const quotationsView = readUtf8('apps/web-next/components/quotations-view.tsx');
    const quotationsLib = readUtf8('apps/web-next/lib/quotations.ts');

    assert.match(quotationsView, /报价转订单预览/);
    assert.match(quotationsView, /openConvertPreview/);
    assert.match(quotationsView, /confirmConvertToOrder/);
    assert.match(quotationsView, /buildQuotationOrderDraft/);
    assert.match(quotationsView, /采购计划预览/);
    assert.match(quotationsLib, /buildQuotationOrderDraft/);
    assert.match(quotationsLib, /\/api\/quotations\/\$\{quotationId\}\/order-draft/);
    assert.match(quotationsLib, /input\.draft \|\| await buildQuotationOrderDraft\(input\.quotation\.id\)/);
});

test('Next UI 契约：报价动态覆盖必须走后端 cost-preview', () => {
    const quotationsView = readUtf8('apps/web-next/components/quotations-view.tsx');
    const quotationsLib = readUtf8('apps/web-next/lib/quotations.ts');

    assert.match(quotationsLib, /previewQuotationItemCost/);
    assert.match(quotationsLib, /\/api\/recipes\/\$\{recipeId\}\/cost-preview/);
    assert.match(quotationsLib, /buildRecipeDefaultQuotationOverrides/);
    assert.match(quotationsView, /previewQuotationItemCost/);
    assert.match(quotationsView, /updateDraftItemOverrides/);
    assert.match(quotationsView, /hasFloat/);
    assert.match(quotationsView, /hasCable/);
    assert.match(quotationsView, /customBarrelLength/);
    assert.match(quotationsView, /packagingOptions/);
    assert.match(quotationsView, /packingPartsJson/);
    assert.match(quotationsView, /包装/);
    assert.match(quotationsLib, /getAllParts/);
    assert.doesNotMatch(quotationsView, /动态覆盖项稍后单独迁移/);
});

test('Next UI 契约：客户详情可以带客户上下文新建报价', () => {
    const customersView = readUtf8('apps/web-next/components/customers-view.tsx');
    const quotationsView = readUtf8('apps/web-next/components/quotations-view.tsx');
    const quotationsPage = readUtf8('apps/web-next/app/quotations/page.tsx');

    assert.match(customersView, /useRouter/);
    assert.match(customersView, /createQuotationForCustomer/);
    assert.match(customersView, /\/quotations\?create=1&customerId=\$\{customer\.id\}/);
    assert.match(customersView, /新建报价/);
    assert.doesNotMatch(customersView, /后续接入报价创建/);
    assert.match(quotationsView, /useSearchParams/);
    assert.match(quotationsView, /prefillCustomerId/);
    assert.match(quotationsView, /shouldCreateFromQuery/);
    assert.match(quotationsView, /setDrawerOpen\(true\)/);
    assert.match(quotationsView, /setItemMargin\(\(1 \+ Number\(customer\.defaultMargin/);
    assert.match(quotationsPage, /Suspense/);
    assert.match(quotationsPage, /<QuotationsView \/>/);
});

test('Next UI 契约：转子页必须支持模板变体带入和历史关联', () => {
    const rotorView = readUtf8('apps/web-next/components/rotor-view.tsx');
    const rotorLib = readUtf8('apps/web-next/lib/rotor.ts');
    const rotorRoute = readUtf8('api/routes/rotor.cjs');
    const rotorDraftService = readUtf8('api/services/rotorTemplateDraft.cjs');

    assert.match(rotorView, /getAllTemplates/);
    assert.match(rotorView, /getAllModelVariants/);
    assert.match(rotorView, /calculateBearingSpan/);
    assert.match(rotorView, /getRotorTemplateDraft/);
    assert.doesNotMatch(rotorView, /function formPatchFromTemplate/);
    assert.doesNotMatch(rotorView, /findShellMetaForTemplate/);
    assert.match(rotorView, /getRotorLinkTargets/);
    assert.match(rotorView, /linkRotorHistory/);
    assert.match(rotorLib, /\/api\/rotor\/template-draft/);
    assert.match(rotorLib, /\/api\/rotor\/link-targets/);
    assert.match(rotorLib, /\/api\/rotor\/history\/\$\{id\}\/link/);
    assert.match(rotorRoute, /router\.post\('\/template-draft'/);
    assert.match(rotorDraftService, /function buildRotorTemplateDraft/);
});

test('Next UI 契约：配方页必须保留模板入口并支持直接复制配方', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const recipesLib = readUtf8('apps/web-next/lib/recipes.ts');

    assert.match(recipesView, /sectionOptions/);
    assert.match(recipesView, /泵壳模板/);
    assert.match(recipesView, /配方对比/);
    assert.match(recipesView, /toggleCompareRecipe/);
    assert.match(recipesView, /buildComparePartRows/);
    assert.match(recipesView, /comparePartRows/);
    assert.match(recipesView, /Recipe Detail/);
    assert.match(recipesView, /openRecipeDetail/);
    assert.match(recipesView, /checkRecipeProduction/);
    assert.match(recipesView, /produceRecipe/);
    assert.match(recipesView, /生产扣库存/);
    assert.match(recipesView, /新建模板/);
    assert.match(recipesView, /submitTemplate/);
    assert.match(recipesView, /openEditTemplate/);
    assert.match(recipesView, /deleteTemplate/);
    assert.match(recipesView, /getTemplateRecipeDraft/);
    assert.match(recipesView, /templateId:\s*String\(recipeDraft\.templateId\)/);
    assert.match(recipesView, /const hasStainlessBarrel = formShellMeta\?\.isStainless === true/);
    assert.match(recipesView, /\{hasStainlessBarrel \? \(/);
    assert.match(recipesView, /customBarrelLength: hasStainlessBarrel \? form\.customBarrelLength \|\| null : null/);
    assert.match(recipesView, /longScrewExtraLength: hasStainlessBarrel \? form\.longScrewExtraLength \|\| 0 : 0/);
    assert.match(recipesView, /openCloneRecipe/);
    assert.match(recipesView, /副本/);
    assert.match(recipesView, /复制/);
    assert.doesNotMatch(recipesView, /保存为常用配置/);
    assert.match(recipesView, /线圈快照/);
    assert.match(recipesView, /自动电容/);
    assert.match(recipesView, /bomDraft\?\.coilSnapshot\?\.wireGauge/);
    assert.match(recipesView, /patch\.floatWire = nextFloatWire/);
    assert.match(recipesView, /patch\.cableWire = nextCableWire/);
    assert.match(recipesView, /isFloatWireRecommended \? <RecipeStatusBadge tone="green">系统推荐<\/RecipeStatusBadge>/);
    assert.match(recipesView, /isCableWireRecommended \? <RecipeStatusBadge tone="green">系统推荐<\/RecipeStatusBadge>/);
    assert.match(recipesView, /autoWireSelectionRef\.current\.floatWire = ''/);
    assert.match(recipesView, /autoWireSelectionRef\.current\.cableWire = ''/);
    assert.match(recipesView, /wireOptions\(parts, '浮球', '浮球-线径'\)/);
    assert.match(recipesView, /wireOptions\(parts, '电缆线', '电缆-线径'\)/);
    assert.match(recipesView, /ariaLabel="浮球线径"/);
    assert.match(recipesView, /ariaLabel="电缆线径"/);
    assert.match(recipesView, /function EditableWireSelect/);
    assert.match(recipesView, /const coilSheetOptions = useMemo/);
    assert.match(recipesView, /function EditableNumberSelect/);
    assert.match(recipesView, /onFocus=\{\(\) => \{/);
    assert.match(recipesView, /const exactCoilRecord = useMemo/);
    assert.match(recipesView, /coilWireWeight: String\(exactCoilRecord\.wireWeight\)/);
    assert.doesNotMatch(recipesView, /recipe-coil-wire-weight-options/);
    assert.match(recipesView, /role="listbox"/);
    assert.match(recipesView, /options=\{coilSheetOptions\}/);
    assert.doesNotMatch(recipesView, /list="recipe-coil-sheet-options"/);
    assert.match(recipesView, /联动标注/);
    assert.match(recipesView, /CircleHelp/);
    assert.match(recipesView, /联动标注说明/);
    assert.match(recipesView, /当泵体机筒是由不锈钢机筒构成且成本随机筒长度变化时/);
    assert.match(recipesView, /linkedChangeAnnotations/);
    assert.match(recipesView, /泵壳整体成本/);
    assert.match(recipesView, /不锈钢长螺丝/);
    assert.match(recipesView, /关联电容/);
    assert.match(recipesView, /浮球线径/);
    assert.match(recipesView, /电缆线径/);
    assert.match(recipesView, /wireLinkNote/);
    assert.match(recipesView, /机筒 \/ 长螺丝/);
    assert.doesNotMatch(recipesView, /bomDraft\.parts\.slice\(0,\s*12\)/);
    assert.match(recipesView, /buildRecipeSavePayloadDraft/);
    assert.match(recipesView, /assemblyWage:\s*String\(recipeDraft\.assemblyWage/);
    assert.match(recipesLib, /createModelVariant/);
    assert.match(recipesLib, /updateModelVariant/);
    assert.match(recipesLib, /deleteModelVariant/);
    assert.match(recipesLib, /applyModelVariantDraft/);
    assert.match(recipesLib, /buildRecipeSavePayloadDraft/);
    assert.match(recipesLib, /getTemplateRecipeDraft/);
    assert.match(recipesLib, /\/api\/recipes\/model-variant-draft/);
    assert.match(recipesLib, /\/api\/recipes\/save-payload-draft/);
    assert.match(recipesLib, /\/api\/recipes\/\$\{recipeId\}\/production-check/);
    assert.match(recipesLib, /\/api\/recipes\/\$\{recipeId\}\/produce/);
    assert.match(recipesLib, /\/api\/templates\/\$\{templateId\}\/default-recipe/);
    assert.match(recipesLib, /createTemplate/);
    assert.match(recipesLib, /updateTemplate/);
    assert.match(recipesLib, /deleteTemplate/);
    assert.match(recipesLib, /\/api\/templates/);
    assert.match(recipesLib, /\/api\/model-variants/);
    assert.match(recipesLib, /\/api\/coils\/specs/);
});

test('Next UI 契约：泵壳模板必须引用零件库并分离整体与组合计价', () => {
    const recipesView = readUtf8('apps/web-next/components/recipes-view.tsx');
    const recipesLib = readUtf8('apps/web-next/lib/recipes.ts');
    const templatesRoute = readUtf8('api/routes/templates.cjs');
    const db = readUtf8('api/db.cjs');

    assert.match(recipesView, /part\.category === '泵壳'/);
    assert.match(recipesView, /零件库泵壳型号/);
    assert.match(recipesView, /selectTemplateShell/);
    assert.match(recipesView, /泵壳套件/);
    assert.match(recipesView, /自由搭配/);
    assert.match(recipesView, /ariaLabel="泵壳计价方式"/);
    assert.match(recipesView, /templateForm\.costMode === 'bundle'/);
    assert.match(recipesView, /templateForm\.bundleNote/);
    assert.match(recipesView, /填写套件计价或配置说明/);
    assert.match(recipesView, /电泳\+喷塑/);
    assert.match(recipesView, /整体喷塑/);
    assert.match(recipesView, /表面处理费用/);
    assert.match(recipesView, /templateForm\.surfaceTreatmentCost/);
    assert.doesNotMatch(recipesView, /喷漆工资/);
    assert.match(recipesLib, /electrophoresis_powder_coating/);
    assert.match(templatesRoute, /surfaceTreatmentMode:\s*'surface_treatment_mode'/);
    assert.match(db, /pump_shell_templates ADD COLUMN surface_treatment_mode/);
    assert.match(db, /pump_shell_templates ADD COLUMN surface_treatment_cost/);
    assert.match(db, /pump_shell_templates ADD COLUMN bundle_note/);
});

test('Next UI 契约：线圈新增必须保留同规格自动带入小操作', () => {
    const coilsView = readUtf8('apps/web-next/components/coils-view.tsx');
    const coilsLib = readUtf8('apps/web-next/lib/coils.ts');
    const coilsRoute = readUtf8('api/routes/coils.cjs');
    const coilCostService = readUtf8('api/services/coilCost.cjs');

    assert.match(coilsView, /function autoFillFromSpec/);
    assert.match(coilsView, /getCoilSpecDraft/);
    assert.match(coilsView, /specOptions\.includes\(spec\)/);
    assert.match(coilsView, /onBlur=\{\(\) => \{/);
    assert.match(coilsView, /list="coil-spec-options"/);
    assert.match(coilsView, /wireWeight:\s*optionalNumberText\(draft\.wireWeight\)/);
    assert.match(coilsView, /copperBase:\s*optionalNumberText\(draft\.copperBase\)/);
    assert.match(coilsView, /coilFee:\s*optionalNumberText\(draft\.coilFee\)/);
    assert.match(coilsView, /rotorFee:\s*optionalNumberText\(draft\.rotorFee\)/);
    assert.match(coilsView, /defaultWireGauge:\s*draft\.defaultWireGauge/);
    assert.match(coilsView, /defaultCapacitor:\s*draft\.defaultCapacitor/);
    assert.match(coilsView, /disabled=\{Boolean\(editingCoil\)\}/);
    assert.match(coilsView, /单片价请在规格组里批量修改/);
    assert.match(coilsLib, /getCoilSpecDraft/);
    assert.match(coilsLib, /\/api\/coils\/spec-draft/);
    assert.match(coilsRoute, /router\.post\('\/spec-draft'/);
    assert.match(coilCostService, /function buildCoilSpecDraft/);
});
