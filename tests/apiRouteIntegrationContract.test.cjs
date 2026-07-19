const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function readUtf8(filePath) {
    return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

function sliceBetween(source, startText, endText) {
    const start = source.indexOf(startText);
    assert.notEqual(start, -1, `missing start marker: ${startText}`);
    const end = endText ? source.indexOf(endText, start + startText.length) : -1;
    return source.slice(start, end === -1 ? source.length : end);
}

function assertNoWrites(section) {
    assert.doesNotMatch(section, /\bdb\.prepare\(\s*`?\s*(INSERT|UPDATE|DELETE)\b/i);
    assert.doesNotMatch(section, /\bsafeUpdate\s*\(/);
    assert.doesNotMatch(section, /\bsoftDelete\s*\(/);
    assert.doesNotMatch(section, /\bhardDelete\s*\(/);
    assert.doesNotMatch(section, /\binvalidatePartsCache\s*\(/);
}

test('关键 API 集成契约：/api/recipes/cost-draft 只生成保存成本草稿不写库', () => {
    const source = readUtf8('api/routes/recipes.cjs');
    const section = sliceBetween(source, "router.post('/cost-draft'", 'function loadTemplateContext');

    assert.match(section, /buildRecipeCostDraft\(req\.body \|\| \{\}, \{ partsCatalog: dbGetAllParts\(\) \}\)/);
    assert.match(section, /res\.json\(\{ success: true, data \}\)/);
    assert.match(section, /res\.status\(400\)\.json\(\{ success: false, error: error\.message \}\)/);
    assertNoWrites(section);
});

test('关键 API 集成契约：/api/recipes/bom-draft 只生成 BOM 草稿不写库', () => {
    const source = readUtf8('api/routes/recipes.cjs');
    const section = sliceBetween(source, "router.post('/bom-draft'", "router.get('/:id'");
    const templateContext = sliceBetween(source, 'function loadTemplateContext', "router.post('/bom-draft'");

    assert.match(section, /buildRecipeBomDraft\(body, \{/);
    assert.match(section, /partsCatalog: dbGetAllParts\(\)/);
    assert.match(section, /coils: dbGetAllCoils\(\)/);
    assert.match(section, /loadTemplateContext\(templateId\)/);
    assert.match(templateContext, /templateRow\(/);
    assert.match(section, /modelVariantRow\(/);
    assert.match(section, /res\.json\(\{ success: true, data \}\)/);
    assertNoWrites(section);
});

test('关键 API 集成契约：/api/recipes/:id/cost-preview 使用配方快照和动态试算服务', () => {
    const source = readUtf8('api/routes/cost.cjs');
    const section = sliceBetween(source, "router.post('/recipes/:id/cost-preview'", '// ── POST /cost/full-estimate ──');

    assert.match(section, /const baseRecipeId = req\.params\.id/);
    assert.match(section, /SELECT \* FROM recipes WHERE id = \? AND deleted_at IS NULL/);
    assert.match(section, /calculateRecipeCostPreview\(row, overrides, \{/);
    assert.match(section, /loadPartsData\(\)/);
    assert.match(section, /getCoils: dbGetAllCoils/);
    assert.match(section, /res\.json\(\{ success: true, data: \{ unitCost: result\.unitCost \} \}\)/);
    assert.doesNotMatch(section, /response\.unitCost|const response/);
    assertNoWrites(section);
});

test('关键 API 集成契约：/api/recipes/current-costs 批量返回完整当日成本且不写库', () => {
    const source = readUtf8('api/routes/cost.cjs');
    const section = sliceBetween(source, "router.get('/recipes/current-costs'", 'function calculateRecipeByIdHandler');

    assert.match(section, /dbGetAllRecipes\(\)\.map\(recipe => calculateCurrentRecipeCost\(recipe, \{/);
    assert.match(section, /calculateRecipeCost/);
    assert.match(section, /coils/);
    assert.match(section, /getSetting/);
    assert.match(section, /data: \{ asOf: new Date\(\)\.toISOString\(\), items \}/);
    assertNoWrites(section);
});

test('关键 API 集成契约：/api/orders/purchase-plan 只生成采购计划草稿不写库', () => {
    const source = readUtf8('api/routes/orders.cjs');
    const section = sliceBetween(source, "router.post('/purchase-plan'", "router.get('/:id'");

    assert.match(section, /const items = Array\.isArray\(req\.body\?\.items\) \? req\.body\.items : \[\]/);
    assert.match(section, /buildOrderPlan\(items, dbGetAllParts\(\)\)/);
    assert.match(section, /res\.json\(\{ success: true, data:/);
    assert.match(section, /res\.status\(400\)\.json\(\{ success: false, error: error\.message \}\)/);
    assertNoWrites(section);
});

test('关键 API 集成契约：/api/parts/batch-stock 是唯一标准库存增减入口', () => {
    const source = readUtf8('api/routes/parts.cjs');
    const section = sliceBetween(source, "router.post('/batch-stock'", 'module.exports = router');

    assert.match(source, /parsePositiveId, parseFiniteNumber/);
    assert.match(section, /parsePositiveId\(op\.partId\)/);
    assert.match(section, /parseFiniteNumber\(op\.delta, 'delta'\)/);
    assert.match(section, /SELECT stock FROM parts WHERE id = \? AND deleted_at IS NULL/);
    assert.match(section, /safeUpdate\('parts', id, \{ stock \}\)/);
    assert.match(section, /invalidatePartsCache\(\)/);
    assert.doesNotMatch(section, /op\.id|op\.Id/);
    assert.doesNotMatch(section, /\bdb\.prepare\(\s*`?\s*UPDATE\b/i);
});

test('关键 API 集成契约：/api/parts/prices 是标准批量调价入口', () => {
    const source = readUtf8('api/routes/parts.cjs');
    const section = sliceBetween(source, "router.patch('/prices'", "router.patch('/:id'");

    assert.match(section, /updates 数组不能为空/);
    assert.match(section, /parsePositiveId\(item\?\.partId\)/);
    assert.match(section, /parseFiniteNumber\(item\?\.price, `updates\[\$\{index\}\]\.price`\)/);
    assert.match(section, /safeUpdate\('parts', row\.partId, \{ price: row\.price \}\)/);
    assert.match(section, /invalidatePartsCache\(\)/);
    assert.doesNotMatch(section, /item\?\.id|item\?\.Id/);
    assert.doesNotMatch(section, /\bdb\.prepare\(\s*`?\s*UPDATE\b/i);
});

test('关键 API 集成契约：路由 ID 参数必须使用 validation helper', () => {
    const routeFiles = [
        'api/routes/parts.cjs',
        'api/routes/customers.cjs',
        'api/routes/quotations.cjs',
        'api/routes/orders.cjs',
        'api/routes/recipes.cjs',
        'api/routes/templates.cjs',
        'api/routes/modelVariants.cjs',
        'api/routes/coils.cjs',
        'api/routes/rotor.cjs',
    ];

    const offenders = routeFiles.filter((filePath) => {
        const source = readUtf8(filePath);
        return /function parseId\b/.test(source) ||
            /parseInt\(req\.params\.id\)/.test(source) ||
            /Number\(req\.params\.id\)/.test(source) ||
            !source.includes("require('../services/validation.cjs')");
    });

    assert.deepEqual(offenders, []);
});

test('关键 API 集成契约：成本基础资料写入必须使用统一数字和 JSON 校验', () => {
    const templates = readUtf8('api/routes/templates.cjs');
    const variants = readUtf8('api/routes/modelVariants.cjs');
    const coils = readUtf8('api/routes/coils.cjs');

    assert.match(templates, /parseNonNegativeNumber/);
    assert.match(templates, /stringifyJsonArray/);
    assert.match(templates, /stringifyJsonObject/);
    assert.doesNotMatch(templates, /parseFloat\(assembly_wage\)|parseFloat\(packing_wage\)|parseFloat\(bundle_cost\)/);
    assert.doesNotMatch(templates, /typeof b\.parts_json === 'string' \? b\.parts_json : JSON\.stringify/);

    assert.match(variants, /parseNonNegativeNumber/);
    assert.match(variants, /stringifyJsonArray/);
    assert.doesNotMatch(variants, /\bNumber\(b\.(coil_sheets|barrel_length|long_screw_extra_length|impeller_thickness|impeller_diameter|impeller_blade_count)\)/);

    assert.match(coils, /function coilCostFromValues/);
    assert.match(coils, /parseNonNegativeNumber/);
    assert.doesNotMatch(coils, /parseFloat\(unitPriceInput\)|parseInt\(sheetsRaw\)|parseFloat\(b\.wireWeight/);
    assert.doesNotMatch(coils, /Number\.isFinite\(up\)/);
});

test('关键 API 集成契约：线圈规格批量更新路由必须先于 ID 路由注册', () => {
    const coils = readUtf8('api/routes/coils.cjs');
    const specPatch = coils.indexOf("router.patch('/spec/:spec'");
    const idPatch = coils.indexOf("router.patch('/:id'");

    assert.notEqual(specPatch, -1);
    assert.notEqual(idPatch, -1);
    assert.ok(specPatch < idPatch, '/spec/:spec must be registered before /:id');
});

test('关键 API 集成契约：订单和报价保存草稿不得吞掉坏数字', () => {
    const orders = readUtf8('api/routes/orders.cjs');
    const quotations = readUtf8('api/routes/quotations.cjs');

    assert.match(orders, /parseNonNegativeNumber\(item\.unitCost, `items\[\$\{index\}\]\.unitCost`\)/);
    assert.match(orders, /parseNonNegativeNumber\(item\.unitPrice, `items\[\$\{index\}\]\.unitPrice`\)/);
    assert.match(orders, /parsePositiveNumber\(item\.qty, `items\[\$\{index\}\]\.qty`/);
    assert.match(orders, /parsePositiveNumber\(item\.profitMargin, `items\[\$\{index\}\]\.profitMargin`/);
    assert.doesNotMatch(orders, /Number\(item\.(unitCost|unitPrice|qty|profitMargin)\) \|\|/);

    assert.match(quotations, /parseNonNegativeNumber\(item\.unitCost, `items\[\$\{index\}\]\.unitCost`\)/);
    assert.match(quotations, /parseNonNegativeNumber\(item\.unitPrice, `items\[\$\{index\}\]\.unitPrice`\)/);
    assert.match(quotations, /parsePositiveNumber\(item\.qty, `items\[\$\{index\}\]\.qty`/);
    assert.match(quotations, /parsePositiveNumber\(item\.margin, `items\[\$\{index\}\]\.margin`/);
    assert.doesNotMatch(quotations, /Number\(item\.(unitCost|unitPrice|qty|margin)\) \|\|/);
});

test('关键 API 集成契约：配方保存草稿必须统一校验数字字段', () => {
    const recipes = readUtf8('api/routes/recipes.cjs');
    const saveDraft = sliceBetween(recipes, 'function buildRecipeSavePayloadDraft', 'function partsCatalogRows');

    assert.match(saveDraft, /parseNonNegativeNumber\(costDraft\.savedTotalCost, 'costDraft\.savedTotalCost'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.coilSheets, 'form\.coilSheets'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.cableLength, 'form\.cableLength'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.assemblyWage, 'form\.assemblyWage'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.packingWage, 'form\.packingWage'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.managementFee, 'form\.managementFee'\)/);
    assert.match(saveDraft, /parseNonNegativeInteger\(form\.impellerBladeCount, 'form\.impellerBladeCount'\)/);
    assert.doesNotMatch(saveDraft, /numberValue\(form\./);
    assert.doesNotMatch(saveDraft, /\bNumber\(form\./);
    assert.match(recipes, /parsePositiveNumber\(body\?\.produceQty \?\? body\?\.qty, 'produceQty'/);
});

test('关键 API 集成契约：转子出图入口使用标准响应并保留兼容字段', () => {
    const source = readUtf8('api/routes/rotor.cjs');
    const helpers = sliceBetween(source, 'function rotorSuccess', 'const os = require');
    const drawSection = sliceBetween(source, "router.post('/draw'", "router.post('/save'");
    const chatSection = sliceBetween(source, "router.post('/chat'", "router.get('/status/:jobId'");

    assert.match(helpers, /res\.json\(\{ success: true, data, \.\.\.data \}\)/);
    assert.match(helpers, /res\.status\(statusCode\)\.json\(\{ success: false, error: message, status: 'error', message \}\)/);
    assert.match(drawSection, /return rotorSuccess\(res, \{/);
    assert.match(drawSection, /status: 'success'/);
    assert.match(drawSection, /jobId/);
    assert.match(drawSection, /return rotorError\(res, 400,/);
    assert.match(chatSection, /return rotorSuccess\(res, \{ status: 'need_params'/);
    assert.match(chatSection, /if \(hasWarning\) return rotorSuccess\(res, warningPayload\)/);
    assert.match(chatSection, /return rotorSuccess\(res, \{/);
    assert.match(chatSection, /return rotorError\(res, 500,/);
});
