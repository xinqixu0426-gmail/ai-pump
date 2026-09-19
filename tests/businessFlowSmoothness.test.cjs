const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const typescript = require('../apps/web-next/node_modules/typescript');

const repoRoot = path.join(__dirname, '..');

function readUtf8(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadPricingMargin() {
    const source = readUtf8('apps/web-next/lib/pricing-margin.ts');
    const output = typescript.transpileModule(source, {
        compilerOptions: {
            module: typescript.ModuleKind.CommonJS,
            target: typescript.ScriptTarget.ES2020,
        },
    }).outputText;
    const loaded = { exports: {} };
    vm.runInNewContext(output, {
        module: loaded,
        exports: loaded.exports,
        Number,
        Math,
        String,
    });
    return loaded.exports;
}

test('报价和订单共用利润率百分比与 multiplier 的稳定转换', () => {
    const pricing = loadPricingMargin();
    assert.equal(pricing.marginPercentToMultiplier('10'), 1.1);
    assert.equal(pricing.marginPercentToMultiplier('0'), 1);
    assert.equal(pricing.marginMultiplierToPercent(1.1), 10);
    assert.equal(pricing.marginMultiplierToPercent(1), 0);
    assert.equal(pricing.marginMultiplierToPercent(0.9), -10);
    assert.equal(pricing.customerMarginPercent(0.125), '12.5');
});

test('普通新建报价和订单不再静默选择客户且显式预填与编辑仍保留', () => {
    const quotations = readUtf8('apps/web-next/components/quotations-view.tsx');
    const orders = readUtf8('apps/web-next/components/orders-view.tsx');
    assert.doesNotMatch(quotations, /setCustomerId\(\(current\)[\s\S]{0,120}customers\[0\]/);
    assert.match(quotations, /function resetForm\(\)[\s\S]*?setCustomerId\(''\)/);
    assert.match(quotations, /setCustomerId\(String\(customer\.id\)\)/);
    assert.match(orders, /function openCreateDrawer\(\)[\s\S]*?setCustomerId\(''\)/);
    assert.match(orders, /setCustomerId\(order\.customerId == null \? '' : String\(order\.customerId\)\)/);
    assert.doesNotMatch(orders, /nextCustomers\[0\]/);
});

test('配方缺少铜价快照进入统一待复核筛选和统计', () => {
    const workspace = readUtf8('apps/web-next/components/recipe/RecipeWorkspace.tsx');
    assert.match(workspace, /\['missing', 'watch', 'review', 'critical'\]\.includes\(row\.copperRisk\.level\)/);
    assert.match(workspace, /copperReviewCount/);
    assert.match(workspace, /铜价待复核/);
});

test('通用新建零件要求显式分类且连续录入继续继承分类', () => {
    const parts = readUtf8('apps/web-next/components/parts-view.tsx');
    assert.match(parts, /const emptyForm[\s\S]*?category: ''/);
    assert.match(parts, /<option value="">请选择分类<\/option>/);
    assert.match(parts, /function resetAfterContinue[\s\S]*?category: form\.category/);
    assert.match(parts, /function formToInput[\s\S]*?category: form\.category\.trim\(\)/);
    assert.doesNotMatch(parts, /function formToInput[\s\S]*?category: form\.category\.trim\(\) \|\| '轴承'/);
});

test('核心页面首次加载指标统一显示占位而非业务零值', () => {
    for (const file of [
        'apps/web-next/components/quotations-view.tsx',
        'apps/web-next/components/orders-view.tsx',
        'apps/web-next/components/parts-view.tsx',
        'apps/web-next/components/purchase-view.tsx',
        'apps/web-next/components/recipe/RecipeWorkspace.tsx',
    ]) {
        assert.match(readUtf8(file), /loading \? '—'/, `${file} 缺少指标加载占位`);
    }
});

test('采购中心通过同一正式 batch API 编排供应商多任务预览和提交', () => {
    const client = readUtf8('apps/web-next/lib/purchase.ts');
    const view = readUtf8('apps/web-next/components/purchase-view.tsx');
    assert.match(client, /function purchaseTasksPayload/);
    assert.match(client, /buildSupplierPurchaseBatchDraft/);
    assert.match(client, /applySupplierPurchaseTasks/);
    assert.match(view, /按供应商整批下单/);
    assert.match(view, /一次预览并原子提交多个物料/);
    assert.match(view, /const supplier = task\.supplier\.trim\(\)/);
    assert.match(view, /supplierLabel: supplier \|\| '未填写供应商'/);
    assert.match(view, /await load\(true\)/);
});

test('报价询价助手复用统一剪贴板文件校验并提供 WPS 文件粘贴入口', () => {
    const panel = readUtf8('apps/web-next/components/quotation-attachment-summary-panel.tsx');
    assert.match(panel, /FACTORY_ATTACHMENT_EXTENSIONS/);
    assert.match(panel, /selectClipboardFile/);
    assert.match(panel, /function handlePaste/);
    assert.match(panel, /onPaste=\{handlePaste\}/);
    assert.match(panel, /WPS、文件夹复制文件后在此按 Ctrl\+V 粘贴/);
});

test('配方正式线圈方案与线重、成本和电容使用同一紧凑信息网格', () => {
    const section = readUtf8('apps/web-next/components/recipe/RecipeCoilSection.tsx');
    assert.match(section, /sm:grid-cols-\[minmax\(0,2fr\)_minmax\(0,\.65fr\)_minmax\(0,1fr\)_minmax\(0,\.7fr\)\]/);
    assert.match(section, /正式线圈方案[\s\S]*?线重 kg[\s\S]*?线圈成本[\s\S]*?自动电容/);
    assert.doesNotMatch(section, /正式线圈方案[\s\S]{0,1200}h-9 w-full/);
});
