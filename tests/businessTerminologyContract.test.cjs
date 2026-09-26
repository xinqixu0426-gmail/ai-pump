const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function readUtf8(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
    return JSON.parse(readUtf8(relativePath));
}

test('业务命名契约：产品身份统一为水泵工厂管理系统', () => {
    const rootPackage = readJson('package.json');
    const webPackage = readJson('apps/web-next/package.json');
    const manifest = readJson('apps/web-next/public/manifest.json');
    const identitySurfaces = [
        'README.md',
        'AGENTS.md',
        'docs/README.md',
        'docs/api-contract.md',
        'docs/modularization-design.md',
        'api.cjs',
        'api/routes/health.cjs',
        'api/services/marketData.cjs',
        'apps/web-next/app/layout.tsx',
        'apps/web-next/app/login/page.tsx',
        'apps/web-next/components/app-shell.tsx',
    ].map(readUtf8).join('\n');

    assert.equal(rootPackage.name, 'pump-factory-management');
    assert.equal(webPackage.name, 'pump-factory-web');
    assert.equal(manifest.name, '水泵工厂管理系统');
    assert.equal(manifest.short_name, '水泵工厂');
    assert.match(identitySurfaces, /水泵工厂管理系统/);
    assert.doesNotMatch(identitySurfaces, /水泵订单及生产管理系统|水泵 BOM 订单及生产管理系统|水泵 BOM 管理与出图系统|水泵 BOM 成本管理系统|水泵成本核算系统|水泵BOM成本查询API|水泵 BOM 管理与工厂执行系统|pump-bom-manager/);
});

test('业务命名契约：配方、预设、成本和报价使用统一界面术语', () => {
    const recipeBasic = readUtf8('apps/web-next/components/recipe/RecipeBasicSection.tsx');
    const variantPanel = readUtf8('apps/web-next/components/recipe/ModelVariantCompatibilityPanel.tsx');
    const missingParts = readUtf8('apps/web-next/components/recipe/MissingPartsBatchDialog.tsx');
    const inlinePart = readUtf8('apps/web-next/components/recipe/InlinePartCreateDialog.tsx');
    const coils = readUtf8('apps/web-next/components/coils-view.tsx');
    const quotations = readUtf8('apps/web-next/components/quotations-view.tsx');
    const parts = readUtf8('apps/web-next/components/parts-view.tsx');
    const aiResults = readUtf8('apps/web-next/components/ai/AiBusinessResult.tsx');
    const aiPrimitives = readUtf8('apps/web-next/components/ai/AiResultPrimitives.tsx');
    const aiTools = readUtf8('api/routes/ai/tools.cjs');
    const qualitySummary = readUtf8('api/services/qualitySummary.cjs');
    const costEngine = readUtf8('api/services/costEngine.cjs');

    assert.match(recipeBasic, /成品型号/);
    assert.match(recipeBasic, /配置摘要/);
    assert.match(recipeBasic, />配方名称</);
    assert.doesNotMatch(recipeBasic, />规格</);
    assert.match(variantPanel, /常用配置预设/);
    assert.match(variantPanel, /预设名称/);
    assert.doesNotMatch(variantPanel, />Variant</);
    assert.match(missingParts, /目录成本价/);
    assert.match(inlinePart, /目录成本价/);
    assert.match(coils, /定子单片成本/);
    assert.match(coils, /线圈套成本/);
    assert.match(quotations, /销售单价/);
    assert.match(parts, /目录成本价/);
    assert.doesNotMatch(parts, /\bprice: string|form\.price/);
    assert.match(aiResults, /成品型号/);
    assert.match(aiResults, /配置摘要/);
    assert.match(aiResults, /BOM 快照单价/);
    assert.match(aiResults + aiPrimitives + aiTools, /销售单价/);
    assert.match(aiTools + qualitySummary, /目录成本价/);
    assert.match(costEngine, /定子单片成本/);
    assert.doesNotMatch(aiResults + aiPrimitives + aiTools + qualitySummary, /出厂价|零件价格为 0|新的单价/);
});

test('业务命名契约：页面说明不暴露内部 JSON 和设置键', () => {
    const surfaces = [
        'apps/web-next/components/recipe/PumpShellTemplateEditor.tsx',
        'apps/web-next/components/recipe/RecipeOptionalPackingSection.tsx',
        'apps/web-next/components/parts-view.tsx',
    ].map(readUtf8).join('\n');

    assert.doesNotMatch(surfaces, /保存到 partsJson|保存到 extraPartsJson/);
    assert.doesNotMatch(surfaces, /cable_accessories 设置|float_accessory_delta 设置|long_screw_pricing 设置/);
});

test('业务命名契约：零件页面模型统一 remark 和 catalogUnitCost，旧名只留在适配层', () => {
    const partsClient = readUtf8('apps/web-next/lib/parts.ts');
    const db = readUtf8('api/db.cjs');
    const partType = partsClient.match(/export type Part = \{[\s\S]*?\n\};/)?.[0] || '';

    assert.match(partType, /catalogUnitCost: number/);
    assert.match(partType, /remark: string/);
    assert.doesNotMatch(partType, /\bprice:|\bnotes:/);
    assert.match(partsClient, /type PartRow = \{[\s\S]*?notes\?: string/);
    assert.match(partsClient, /function partInputToApi[\s\S]*price: catalogUnitCost,[\s\S]*remark,/);
    assert.doesNotMatch(partsClient, /function partInputToApi[\s\S]*notes: remark/);
    assert.match(db, /function partRow[\s\S]*remark: r\.remark \|\| '', notes: r\.remark \|\| ''/);
    assert.match(db, /remark: body\.remark \?\? body\.notes \?\? ''/);
});

test('业务命名契约：稳定技术标识不随界面术语改名', () => {
    const recipesClient = readUtf8('apps/web-next/lib/recipes.ts');
    const apiReference = readUtf8('docs/api-reference.md');
    const schema = readUtf8('api/database/schema.cjs');

    assert.match(recipesClient, /\/api\/model-variants/);
    assert.match(apiReference, /\/api\/model-variants/);
    assert.match(apiReference, /modelVariantId\/modelName/);
    assert.match(schema, /pump_model_variants/);
    assert.match(schema, /model_name/);
});

test('业务命名契约：资料关联与任务解决不再混用归档动作', () => {
    const attachmentDialog = readUtf8('apps/web-next/components/ai/AiWorkspaceDialogs.tsx');
    const attachmentController = readUtf8('apps/web-next/components/ai/AiAttachmentArchiveController.tsx');
    const fileClient = readUtf8('apps/web-next/lib/files.ts');
    const actionCenter = readUtf8('apps/web-next/components/management-action-center.tsx');
    const businessChanges = readUtf8('apps/web-next/components/business-change-view.tsx');
    const businessExecutor = readUtf8('api/routes/ai/executors/businessExecutors.cjs');
    const fileArchiveService = readUtf8('api/services/factoryFileArchive.cjs');
    const capabilityRegistry = readUtf8('api/capabilities/registry.cjs');

    assert.match(attachmentDialog, /关联业务资料/);
    assert.match(attachmentController, /资料关联/);
    assert.match(fileClient, /读取文件关联记录失败/);
    assert.match(actionCenter, /已解决/);
    assert.match(businessChanges, /model_variant: '常用配置预设'/);
    assert.match(businessExecutor, /可关联的业务资料|资料关联结果/);
    assert.match(fileArchiveService + capabilityRegistry, /业务资料关联目标/);
    assert.doesNotMatch(attachmentDialog + attachmentController + fileClient, /归档附件|已有归档|归档目标|文件归档记录|归档文件失败/);
    assert.doesNotMatch(businessExecutor, /文件归档目标|可归档目标|文件归档结果/);
    assert.doesNotMatch(fileArchiveService + capabilityRegistry, /归档目标不存在|查找文件归档目标/);
    assert.doesNotMatch(actionCenter, /最近归档|自动归档记录/);
});
