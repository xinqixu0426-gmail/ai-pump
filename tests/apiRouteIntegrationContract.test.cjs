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
    const section = sliceBetween(source, "router.post('/bom-draft'", "router.post('/model-variant-draft'");
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
    assert.match(section, /unitCost: result\.unitCost/);
    assert.match(section, /parts: result\.parts/);
    assert.match(section, /costSnapshot: result\.costSnapshot/);
    assert.doesNotMatch(section, /response\.unitCost|const response/);
    assertNoWrites(section);
});

test('报价动态试算契约：组合包材和表面处理按覆盖配置替换', () => {
    const source = readUtf8('api/services/dynamicCostPreview.cjs');
    const semantics = readUtf8('api/services/packagingSemantics.cjs');

    assert.match(source, /function inferPackingRole/);
    assert.match(source, /inferPackagingSemantics/);
    assert.match(semantics, /container/);
    assert.match(semantics, /foam/);
    assert.match(semantics, /pearlCotton/);
    assert.match(source, /managedTotals\.packing/);
    assert.match(source, /effectiveSurfaceCost - baseSurfaceCost/);
    assert.match(source, /surfaceTreatmentMode/);
});

test('关键 API 集成契约：配方保存的草稿与正式写入口都拒绝零价格 BOM', () => {
    const source = readUtf8('api/routes/recipes.cjs');
    const saveDraft = sliceBetween(source, 'function buildRecipeSavePayloadDraft', 'function partsCatalogRows');
    const create = sliceBetween(source, "router.post('/',", "router.delete('/:id'");
    const updateRecord = sliceBetween(source, 'function updateRecipeRecord', "router.get('/'");
    const patch = sliceBetween(source, "router.patch('/:id'", 'module.exports');

    assert.match(saveDraft, /assertRecipeBomPrices\(parts\)/);
    assert.match(create, /assertRecipeBomPrices\(parseJsonArray\(b\.parts_json \|\| '\[\]'\)\)/);
    assert.match(updateRecord, /assertRecipeBomPrices\(parseJsonArray\(updates\.parts_json\)\)/);
    assert.match(create, /res\.status\(error\.statusCode \|\| 500\)/);
    assert.match(patch, /res\.status\(error\.statusCode \|\| 500\)/);
});

test('关键 API 集成契约：配方测试报告支持上传、下载和软删除', () => {
    const source = readUtf8('api/routes/recipes.cjs');
    const db = readUtf8('api/db.cjs');
    const schema = readUtf8('api/database/schema.cjs');

    assert.match(source, /router\.get\('\/:id\/technical-files'/);
    assert.match(source, /router\.post\('\/:id\/technical-files'/);
    assert.match(source, /router\.get\('\/:id\/technical-files\/:fileId\/download'/);
    assert.match(source, /router\.delete\('\/:id\/technical-files\/:fileId'/);
    assert.match(source, /parsePumpTestReport\(req\.file\.buffer, originalName\)/);
    assert.match(source, /storeFactoryFile\(\{/);
    assert.match(source, /file_id: stored\.file\.id/);
    assert.match(source, /safeInsert\('recipe_technical_files'/);
    assert.match(source, /softDelete\('recipe_technical_files'/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS recipe_technical_files/);
    assert.match(db, /'recipe_technical_files'/);
});

test('关键 API 集成契约：V9.1 统一文件上传执行真实类型校验和哈希去重', () => {
    const entry = readUtf8('api.cjs');
    const route = readUtf8('api/routes/files.cjs');
    const service = readUtf8('api/services/factoryFileStore.cjs');
    const schema = readUtf8('api/database/schema.cjs');
    const knowledgeRoute = readUtf8('api/routes/knowledge.cjs');
    const recipeRoute = readUtf8('api/routes/recipes.cjs');

    assert.match(entry, /app\.use\('\/api\/files', require\('\.\/api\/routes\/files\.cjs'\)\)/);
    assert.match(route, /router\.post\('\/'/);
    assert.match(route, /router\.get\('\/:id\/download'/);
    assert.match(route, /router\.delete\('\/:id'/);
    assert.match(route, /storeFactoryFile\(\{/);
    assert.match(service, /inspectFactoryFile/);
    assert.match(service, /fileSha256: crypto\.createHash\('sha256'\)/);
    assert.match(service, /SELECT \* FROM factory_files WHERE file_sha256 = \?/);
    assert.match(service, /文件扩展名与实际/);
    assert.match(service, /MAX_FACTORY_FILE_SIZE = 10 \* 1024 \* 1024/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS factory_files/);
    assert.match(schema, /file_sha256 TEXT NOT NULL UNIQUE/);
    assert.match(knowledgeRoute, /sourceType: 'knowledge_document'/);
    assert.match(recipeRoute, /sourceType: 'recipe_technical_file'/);
});

test('关键 API 集成契约：V9.2 PDF 上传自动解析并提供重试和全文读取', () => {
    const route = readUtf8('api/routes/files.cjs');
    const parser = readUtf8('api/services/factoryFileParser.cjs');
    const pdfParser = readUtf8('api/services/factoryPdfParser.cjs');
    const store = readUtf8('api/services/factoryFileStore.cjs');

    assert.match(route, /await parseFactoryFile\(result\.file\.id\)/);
    assert.match(route, /router\.post\('\/:id\/parse'/);
    assert.match(route, /router\.get\('\/:id\/content'/);
    assert.match(route, /getFactoryFileContent\(id\)/);
    assert.match(parser, /parser_status: 'processing'/);
    assert.match(parser, /parser_status: result\.parserStatus/);
    assert.match(parser, /parser_status: 'failed'/);
    assert.match(pdfParser, /MAX_PDF_PAGES = 100/);
    assert.match(pdfParser, /MAX_PDF_TEXT_CHARS = 300_000/);
    assert.match(store, /parsedTextPreview/);
    assert.match(store, /parserSummary/);
});

test('关键 API 集成契约：V9.3 报价文件草稿复用当前客户配方且不写正式报价', () => {
    const route = readUtf8('api/routes/files.cjs');
    const parser = readUtf8('api/services/factorySpreadsheetParser.cjs');
    const mapper = readUtf8('api/services/factoryQuotationDraft.cjs');
    const executor = readUtf8('api/routes/ai/executors/businessExecutors.cjs');

    assert.match(route, /needsFactoryFileParsing\(result\.file\)/);
    assert.match(route, /buildQuotationFileDraft\(id/);
    assert.match(parser, /MAX_SPREADSHEET_ROWS = 5_000/);
    assert.match(parser, /MAX_SPREADSHEET_CELLS = 50_000/);
    assert.match(mapper, /SELECT id, name, default_margin/);
    assert.match(mapper, /SELECT id, name, spec, saved_total_cost/);
    assert.match(mapper, /status: 'ambiguous'/);
    assert.match(mapper, /quotationDraftInput = readyForSaveDraft/);
    assert.doesNotMatch(mapper, /INSERT|UPDATE|DELETE FROM quotations/);
    assert.match(executor, /\/api\/files\/\$\{fileId\}\/quotation-draft/);
});

test('关键 API 集成契约：/api/cost/recipe-difference 只生成成本差异解释不写库', () => {
    const source = readUtf8('api/routes/cost.cjs');
    const section = sliceBetween(source, "router.post('/cost/recipe-difference'", '// ── 市场指标 ──');

    assert.match(section, /buildCostDifference\(req\.body \|\| \{\}\)/);
    assert.match(section, /res\.json\(\{\s*success:\s*true,\s*data:/);
    assert.match(section, /res\.status\(400\)\.json\(\{ success: false, error: error\.message \}\)/);
    assertNoWrites(section);
});

test('关键 API 集成契约：/api/quality/summary 只生成数据质量报告不写库', () => {
    const source = readUtf8('api/routes/quality.cjs');

    assert.match(source, /buildDataQualitySummary\(\)/);
    assert.match(source, /res\.json\(\{ success: true, data:/);
    assertNoWrites(source);
});

test('关键 API 集成契约：/api/quality/business-alerts 只生成经营异常提醒不写库', () => {
    const source = readUtf8('api/routes/quality.cjs');

    assert.match(source, /buildBusinessAlerts\(\)/);
    assert.match(source, /router\.get\('\/business-alerts'/);
    assert.match(source, /res\.json\(\{ success: true, data:/);
    assertNoWrites(source);
});

test('关键 API 集成契约：/api/workbench/action-center 只聚合现有检查不写库', () => {
    const route = readUtf8('api/routes/workbench.cjs');
    const service = readUtf8('api/services/managementActionCenter.cjs');

    assert.match(route, /router\.get\('\/action-center'/);
    assert.match(route, /buildManagementActionCenter\(\)/);
    assert.match(service, /buildActiveOrdersReadinessOverview\(\)/);
    assert.match(service, /buildBusinessAlerts\(\)/);
    assert.match(service, /buildDataQualitySummary\(\)/);
    assert.match(service, /buildFactoryLearningHealth\(\{ limit: 200 \}\)/);
    assert.match(service, /buildKnowledgeSyncHealth/);
    assertNoWrites(route);
    assertNoWrites(service);
});

test('关键 API 集成契约：V8 工厂执行计划统一现有业务检查且保持只读', () => {
    const route = readUtf8('api/routes/workbench.cjs');
    const service = readUtf8('api/services/factoryExecutionPlan.cjs');

    assert.match(route, /router\.post\('\/execution-plan'/);
    assert.match(route, /buildFactoryExecutionPlan\(req\.body \|\| \{\}\)/);
    assert.match(service, /order_readiness/);
    assert.match(service, /quotation_to_order/);
    assert.match(service, /management_action/);
    assert.match(service, /execute_order_readiness_action/);
    assert.match(service, /canExecute/);
    assertNoWrites(route);
    assertNoWrites(service);
});

test('关键 API 集成契约：V8.4 执行历史独立记录结果并按实时计划恢复', () => {
    const route = readUtf8('api/routes/workbench.cjs');
    const history = readUtf8('api/services/factoryWorkflowHistory.cjs');
    const recorder = readUtf8('api/routes/ai/executors/workflowRunRecorder.cjs');

    assert.match(route, /router\.get\('\/execution-runs'/);
    assert.match(route, /router\.post\('\/execution-runs'/);
    assert.match(route, /recordFactoryWorkflowRun\(req\.body \|\| \{\}\)/);
    assert.match(route, /decorateFactoryExecutionPlanWithHistory\(plan\)/);
    assert.match(history, /safeInsert\('factory_workflow_runs'/);
    assert.match(history, /fingerprintFactoryExecutionPlan/);
    assert.match(history, /retry_available/);
    assert.match(history, /该计划版本的步骤已有成功执行记录，不会重复执行/);
    assert.match(recorder, /\/api\/workbench\/execution-runs/);
    assert.doesNotMatch(history, /safeUpdate\('(?:orders|quotations|parts|recipes)'/);
});

test('关键 API 集成契约：/api/quality/recipe-analysis 只生成配方智能建议不写库', () => {
    const source = readUtf8('api/routes/quality.cjs');

    assert.match(source, /router\.post\('\/recipe-analysis'/);
    assert.match(source, /analyzeRecipeConfiguration\(req\.body \|\| \{\}\)/);
    assert.match(source, /res\.json\(\{ success: true, data:/);
    assert.match(source, /error\.statusCode \|\| 500/);
    assertNoWrites(source);
});

test('关键 API 集成契约：配方检查反馈使用统一反馈服务写入', () => {
    const source = readUtf8('api/routes/quality.cjs');
    assert.match(source, /router\.post\('\/recipes\/:recipeId\/feedback'/);
    assert.match(source, /saveRecipeAnalysisFeedback\(req\.params\.recipeId, req\.body \|\| \{\}, \{/);
    assert.match(source, /router\.post\('\/recipe-feedback\/:id\/resolve'/);
    assert.match(source, /resolveRecipeAnalysisFeedback\(req\.params\.id, req\.body \|\| \{\}, \{/);
    assert.match(source, /actor: req\.user\?\.role \|\| 'system'/);
});

test('关键 API 集成契约：候选规则提供归纳、影响、执行监控、历史、审核和恢复入口', () => {
    const source = readUtf8('api/routes/quality.cjs');
    assert.match(source, /router\.get\('\/rule-compliance'/);
    assert.match(source, /router\.get\('\/rule-learning-health'/);
    assert.match(source, /router\.get\('\/rule-candidates'/);
    assert.match(source, /router\.get\('\/rule-events'/);
    assert.match(source, /router\.post\('\/rule-events\/:id\/restore'/);
    assert.match(source, /router\.post\('\/rule-candidates\/refresh'/);
    assert.match(source, /router\.get\('\/rule-candidates\/:id\/impact'/);
    assert.match(source, /router\.patch\('\/rule-candidates\/:id'/);
    assert.match(source, /refreshFactoryRuleCandidates/);
    assert.match(source, /buildFactoryLearningHealth/);
    assert.match(source, /reviewFactoryRuleCandidate/);
    assert.match(source, /restoreFactoryRuleEvent/);
});

test('关键 API 集成契约：/api/knowledge 提供搜索、详情和同步入口', () => {
    const source = readUtf8('api/routes/knowledge.cjs');
    const app = readUtf8('api.cjs');

    assert.match(app, /app\.use\('\/api\/knowledge', require\('\.\/api\/routes\/knowledge\.cjs'\)\)/);
    assert.match(source, /router\.get\('\/overview'/);
    assert.match(source, /inspectKnowledgeOverview\(\)/);
    assert.match(source, /router\.get\('\/'/);
    assert.match(source, /await searchFactoryKnowledge\(\{/);
    assert.match(source, /router\.get\('\/sync-runs'/);
    assert.match(source, /listKnowledgeSyncRuns\(\{/);
    assert.match(source, /router\.get\('\/health'/);
    assert.match(source, /buildKnowledgeSyncHealth\(\{/);
    assert.match(source, /router\.get\('\/vector-health'/);
    assert.match(source, /buildKnowledgeVectorHealth\(db, embeddingProvider/);
    assert.match(source, /router\.get\('\/vector-sync-runs'/);
    assert.match(source, /listKnowledgeVectorSyncRuns\(\{/);
    assert.match(source, /router\.get\('\/retrieval-evaluation'/);
    assert.match(source, /runKnowledgeRetrievalEvaluation\(\)/);
    assert.match(source, /router\.get\('\/documents'/);
    assert.match(source, /router\.post\('\/documents'/);
    assert.match(source, /router\.get\('\/documents\/:id\/download'/);
    assert.match(source, /router\.delete\('\/documents\/:id'/);
    assert.match(source, /router\.post\('\/sync'/);
    assert.match(source, /syncKnowledgeEntries\(\)/);
    assert.match(source, /router\.get\('\/:id'/);
    assert.match(source, /parsePositiveId\(req\.params\.id\)/);
    assert.match(source, /getKnowledgeEntryDetail\(id\)/);
    assert.match(source, /res\.json\(\{ success: true, data \}\)/);
});

test('关键 API 集成契约：AI 会话提供历史列表、详情、消息保存和删除入口', () => {
    const route = readUtf8('api/routes/ai/conversations.cjs');
    const service = readUtf8('api/services/aiConversations.cjs');
    assert.match(route, /router\.get\('\/api\/ai\/conversations'/);
    assert.match(route, /router\.post\('\/api\/ai\/conversations'/);
    assert.match(route, /router\.get\('\/api\/ai\/conversations\/:id'/);
    assert.match(route, /router\.post\('\/api\/ai\/conversations\/:id\/messages'/);
    assert.match(route, /router\.patch\('\/api\/ai\/conversations\/:id\/messages\/:messageId'/);
    assert.match(route, /router\.delete\('\/api\/ai\/conversations\/:id'/);
    assert.match(route, /parsePositiveId/);
    assert.match(route, /conversationAuth/);
    assert.match(service, /metadata\.attachments/);
    assert.match(service, /附件不存在或已删除/);
});

test('关键 API 集成契约：AI 回答反馈提供提交、查询和处理入口', () => {
    const route = readUtf8('api/routes/ai/feedback.cjs');
    const aiRouter = readUtf8('api/routes/ai.cjs');

    assert.match(aiRouter, /feedbackRouter/);
    assert.match(route, /router\.get\('\/api\/ai\/feedback'/);
    assert.match(route, /router\.post\('\/api\/ai\/feedback'/);
    assert.match(route, /router\.post\('\/api\/ai\/feedback\/:id\/diagnose'/);
    assert.match(route, /router\.post\('\/api\/ai\/feedback\/:id\/retest'/);
    assert.match(route, /router\.patch\('\/api\/ai\/feedback\/:id'/);
    assert.match(route, /feedbackAuth/);
    assert.match(route, /submitAiAnswerFeedback/);
    assert.match(route, /reviewAiAnswerFeedback/);
    assert.match(route, /diagnoseAiAnswerFeedback/);
    assert.match(route, /recordAiAnswerFeedbackRetest/);
});

test('关键 API 集成契约：知识库回归检查提供运行、记录和汇总入口', () => {
    const route = readUtf8('api/routes/ai/evaluations.cjs');
    const aiRouter = readUtf8('api/routes/ai.cjs');

    assert.match(aiRouter, /evaluationsRouter/);
    assert.match(route, /router\.get\('\/api\/ai\/evaluations\/overview'/);
    assert.match(route, /router\.post\('\/api\/ai\/evaluations\/runs'/);
    assert.match(route, /router\.post\('\/api\/ai\/evaluations\/runs\/:id\/results'/);
    assert.match(route, /router\.post\('\/api\/ai\/evaluations\/runs\/:id\/complete'/);
    assert.match(route, /evaluationAuth/);
    assert.match(route, /recordAiEvaluationResult/);
    assert.match(route, /completeAiEvaluationRun/);
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
    const section = sliceBetween(source, "router.post('/purchase-plan'", 'function buildReadinessContextForOrderRecord');

    assert.match(section, /const items = Array\.isArray\(req\.body\?\.items\) \? req\.body\.items : \[\]/);
    assert.match(section, /buildOrderPlan\(items, dbGetAllParts\(\), \{ coilsCatalog: dbGetAllCoils\(\) \}\)/);
    assert.match(section, /res\.json\(\{\s*success:\s*true,\s*data:/);
    assert.match(section, /res\.status\(400\)\.json\(\{ success: false, error: error\.message \}\)/);
    assertNoWrites(section);
});

test('关键 API 集成契约：/api/orders/:id/readiness 只读编排生产准备检查', () => {
    const source = readUtf8('api/routes/orders.cjs');
    const helper = sliceBetween(source, 'function buildReadinessContextForOrderRecord', 'function buildReadinessForOrderRecord');
    const shared = readUtf8('api/services/activeOrderReadiness.cjs');
    const section = sliceBetween(source, "router.get('/:id/readiness'", "router.post('/save-payload-draft'");
    assert.match(helper, /buildOrderReadinessContext\(record\)/);
    assert.match(shared, /buildBalancedOrderPlans/);
    assert.match(shared, /buildOrderReadiness/);
    assert.match(shared, /dbGetAllParts\(\)/);
    assert.match(shared, /dbGetAllCoils\(\)/);
    assert.match(shared, /dbGetAllRecipes\(\)/);
    assert.match(section, /buildReadinessForOrderRecord/);
    assertNoWrites(helper);
    assertNoWrites(shared);
    assert.doesNotMatch(section, /safeInsert|safeUpdate|softDelete|hardDelete/);
    assert.match(section, /success:\s*true,\s*data:/);
});

test('关键 API 集成契约：订单只读查询和处理方案不刷新采购计划', () => {
    const source = readUtf8('api/routes/orders.cjs');
    const lookup = sliceBetween(source, "router.get('/lookup'", "router.get('/readiness-overview'");
    const plan = sliceBetween(source, "router.get('/:id/readiness-plan'", "router.get('/:id/readiness'");

    assert.match(lookup, /SELECT id, customer_name, contract_no, status, updated_at/);
    assert.doesNotMatch(lookup, /syncBalancedPurchasePlans/);
    assertNoWrites(lookup);
    assert.match(plan, /buildReadinessForOrderRecord/);
    assert.match(plan, /buildOrderReadinessPlan/);
    assertNoWrites(plan);
});

test('关键 API 集成契约：订单准备总览只计算一次平衡计划且不写库', () => {
    const source = readUtf8('api/routes/orders.cjs');
    const helper = readUtf8('api/services/activeOrderReadiness.cjs');
    const route = sliceBetween(source, "router.get('/readiness-overview'", "router.get('/:id/readiness-plan'");

    assert.match(helper, /const plans = buildBalancedOrderPlans\(records, parts/);
    assert.equal((helper.match(/const plans = buildBalancedOrderPlans\(/g) || []).length, 1);
    assert.match(helper, /records\.map/);
    assert.match(helper, /buildOrderReadiness/);
    assert.match(helper, /buildOrderReadinessPlan/);
    assert.match(helper, /buildOrderReadinessOverview/);
    assertNoWrites(helper);
    assert.match(route, /buildActiveOrdersReadinessOverview\(\)/);
    assertNoWrites(route);
});

test('关键 API 集成契约：订单方案动作执行前实时重验并限制可确认步骤', () => {
    const source = readUtf8('api/routes/orders.cjs');
    const helper = sliceBetween(source, 'function executeReadinessAction', "router.get('/lookup'");
    const route = sliceBetween(source, "router.post('/:id/readiness-actions/:actionId'", "router.get('/:id/readiness'");

    assert.match(helper, /buildReadinessContextForOrderRecord/);
    assert.match(helper, /buildOrderReadinessPlan/);
    assert.match(helper, /action\.mode !== 'confirmable'/);
    assert.match(helper, /action\.status !== 'available'/);
    assert.match(helper, /setOrderStatus\(id, '待采购'/);
    assert.match(helper, /safeUpdate\('orders'/);
    assert.match(helper, /buildReadinessForOrderRecord\(nextRecord\)/);
    assert.match(route, /\['confirm_order', 'generate_purchase_plan'\]/);
    assert.match(route, /executeReadinessAction\(id, actionId\)/);
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
    const db = readUtf8('api/db.cjs');
    const schema = readUtf8('api/database/schema.cjs');

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
    for (const field of ['mainWireGauge', 'mainWireData', 'auxWireGauge', 'auxWireData']) {
        assert.match(coils, new RegExp(field));
    }
    for (const column of ['main_wire_gauge', 'main_wire_data', 'aux_wire_gauge', 'aux_wire_data']) {
        assert.match(schema, new RegExp(`${column}\\s+TEXT`));
    }
    for (const field of ['mainWireGauge', 'mainWireData', 'auxWireGauge', 'auxWireData']) {
        assert.match(db, new RegExp(field));
    }
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

    assert.match(quotations, /parseNonNegativeNumber\(preview\.unitCost, `items\[\$\{index\}\]\.unitCost`\)/);
    assert.match(quotations, /parseNonNegativeNumber\(item\.unitPrice, `items\[\$\{index\}\]\.unitPrice`\)/);
    assert.match(quotations, /parsePositiveNumber\(item\.qty, `items\[\$\{index\}\]\.qty`/);
    assert.match(quotations, /parsePositiveNumber\(item\.margin, `items\[\$\{index\}\]\.margin`/);
    assert.match(quotations, /normalizeQuotationItemOverrides\(item\.overrides, index\)/);
    assert.match(quotations, /const overrides = normalizeQuotationItemOverrides\(item\.overrides, index\)/);
    assert.match(quotations, /bomSnapshot: preview\.parts/);
    assert.match(quotations, /function parseQuotationItemsInput\(value\)/);
    assert.match(quotations, /const payload = buildQuotationSavePayloadDraft\(\{/);
    assert.match(quotations, /items:\s*req\.body\.items \?\? parseQuotationItemsInput\(req\.body\.itemsJson\)/);
    assert.doesNotMatch(quotations, /total_cost:\s*totalCost \|\| 0/);
    assert.doesNotMatch(quotations, /total_price:\s*totalPrice \|\| 0/);
    assert.doesNotMatch(quotations, /Number\(item\.(unitCost|unitPrice|qty|margin)\) \|\|/);
});

test('关键 API 集成契约：配方保存草稿必须统一校验数字字段', () => {
    const recipes = readUtf8('api/routes/recipes.cjs');
    const saveDraft = sliceBetween(recipes, 'function buildRecipeSavePayloadDraft', 'function partsCatalogRows');

    assert.match(saveDraft, /parseNonNegativeNumber\(costDraft\.savedTotalCost, 'costDraft\.savedTotalCost'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.coilSheets, 'form\.coilSheets'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.cableLength, 'form\.cableLength'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.longScrewExtraLength, 'form\.longScrewExtraLength'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.assemblyWage, 'form\.assemblyWage'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.packingWage, 'form\.packingWage'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.managementFee, 'form\.managementFee'\)/);
    assert.match(saveDraft, /parseNonNegativeInteger\(form\.impellerBladeCount, 'form\.impellerBladeCount'\)/);
    assert.doesNotMatch(saveDraft, /numberValue\(form\./);
    assert.doesNotMatch(saveDraft, /\bNumber\(form\./);
    assert.match(recipes, /router\.get\('\/:id\/inventory-status'/);
    assert.doesNotMatch(recipes, /produceQty|production-check|router\.post\('\/:id\/produce'/);
    assert.match(recipes, /parseNonNegativeNumber\(updates\.long_screw_extra_length, 'longScrewExtraLength'\)/);
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

test('关键 API 集成契约：V9.5 文件归档统一校验目标并保护写入边界', () => {
    const route = readUtf8('api/routes/files.cjs');
    const service = readUtf8('api/services/factoryFileArchive.cjs');
    const executor = readUtf8('api/routes/ai/executors/businessExecutors.cjs');
    const tools = readUtf8('api/routes/ai/tools.cjs');
    const store = readUtf8('api/services/factoryFileStore.cjs');

    const searchPosition = route.indexOf("router.get('/archive-targets'");
    const idPosition = route.indexOf("router.get('/:id'");
    assert.notEqual(searchPosition, -1);
    assert.notEqual(idPosition, -1);
    assert.ok(searchPosition < idPosition, 'archive-targets must be registered before /:id');
    assert.match(route, /archiveFactoryFile\(id, \{/);
    assert.match(service, /targetSummary\(targetType, targetId, accessors\)/);
    assert.match(service, /parser_status/);
    assert.match(service, /db\.transaction\(execute\)\.immediate\(\)/);
    assert.match(executor, /\/api\/files\/\$\{args\.fileId\}\/archive/);
    assert.match(executor, /source: 'ai_chat'/);
    assert.match(tools, /const WRITE_TOOLS = new Set/);
    assert.match(store, /SELECT id FROM factory_file_links/);
});
