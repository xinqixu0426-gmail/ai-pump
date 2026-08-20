const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    getAiCapability,
    listAiCapabilities,
} = require('../api/capabilities/registry.cjs');

const repoRoot = path.join(__dirname, '..');

function readUtf8(filePath) {
    return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

function readAiPromptContractSource() {
    return [
        'api/routes/ai/chat.cjs',
        'api/routes/ai/prompt.cjs',
        'api/services/aiPromptComposer.cjs',
    ].map(readUtf8).join('\n');
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
    const section = sliceBetween(source, "router.post('/cost-draft'", "router.post('/bom-draft'");

    assert.match(section, /buildRecipeCostDraft\(req\.body \|\| \{\}, \{ partsCatalog: dbGetAllParts\(\) \}\)/);
    assert.match(section, /res\.json\(\{ success: true, data \}\)/);
    assert.match(section, /sendRecipeQueryError\(res, error, 400\)/);
    assertNoWrites(section);
});

test('关键 API 集成契约：/api/recipes/bom-draft 只生成 BOM 草稿不写库', () => {
    const source = readUtf8('api/routes/recipes.cjs');
    const queries = readUtf8('api/services/recipeQueries.cjs');
    const section = sliceBetween(source, "router.post('/bom-draft'", "router.post('/model-variant-draft'");

    assert.match(section, /recipeQueries\.getBomDraft\(req\.body \|\| \{\}\)/);
    assert.doesNotMatch(section, /db\.prepare|SELECT /);
    assert.match(queries, /return buildBomDraft\(input, \{/);
    assert.match(queries, /partsCatalog: listParts\(\)/);
    assert.match(queries, /coils: listCoils\(\)/);
    assert.match(queries, /loadTemplateContext\(templateId\)/);
    assert.match(queries, /templateRow\(/);
    assert.match(queries, /modelVariantRow\(/);
    assert.match(section, /res\.json\(\{ success: true, data \}\)/);
    assert.match(section, /sendRecipeQueryError\(res, error, 400\)/);
    assertNoWrites(section);
    assertNoWrites(queries);
});

test('关键 API 集成契约：/api/recipes/:id/cost-preview 使用配方快照和动态试算服务', () => {
    const source = readUtf8('api/routes/cost.cjs');
    const queries = readUtf8('api/services/costQueries.cjs');
    const section = sliceBetween(source, "router.post('/recipes/:id/cost-preview'", '// ── POST /cost/full-estimate ──');

    assert.match(section, /const baseRecipeId = req\.params\.id/);
    assert.match(section, /costQueries\.previewRecipeCost/);
    assert.match(queries, /SELECT \*[\s\S]*FROM recipes[\s\S]*WHERE id = \? AND deleted_at IS NULL/);
    assert.match(queries, /calculateRecipeCostPreview\(/);
    assert.match(queries, /loadPartsData\(\)/);
    assert.match(queries, /getCoils: listCoils/);
    assert.match(queries, /unitCost: result\.unitCost/);
    assert.match(queries, /parts: result\.parts/);
    assert.match(queries, /costSnapshot: result\.costSnapshot/);
    assert.doesNotMatch(section, /response\.unitCost|const response/);
    assertNoWrites(section);
    assertNoWrites(queries);
});

test('关键 API 集成契约：完整估算只在 route 兼容旧字段且选择失败整体返回错误', () => {
    const source = readUtf8('api/routes/cost.cjs');
    const queries = readUtf8('api/services/costQueries.cjs');
    const section = sliceBetween(source, "router.post('/cost/full-estimate'", "router.post('/cost/recipe-difference'");

    assert.match(section, /input\.recipeName = input\.pumphousing_model/);
    assert.match(section, /delete input\.pumphousing_model/);
    assert.match(section, /costQueries\.calculateFullEstimate\(input\)/);
    assert.doesNotMatch(queries, /pumphousing_model/);
    assert.match(queries, /FULL_ESTIMATE_RECIPE_REQUIRED/);
    assert.match(queries, /FULL_ESTIMATE_RECIPE_NOT_FOUND/);
    assert.match(queries, /FULL_ESTIMATE_RECIPE_AMBIGUOUS/);
    assert.doesNotMatch(queries, /recipeCost\s*=\s*\{\s*error:/);
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
    const route = readUtf8('api/routes/recipes.cjs');
    const service = readUtf8('api/services/recipeCommands.cjs');
    const create = sliceBetween(route, "router.post('/',", "router.delete('/:id'");
    const remove = sliceBetween(route, "router.delete('/:id'", "router.patch('/:id'");
    const patch = sliceBetween(route, "router.patch('/:id'", 'module.exports');

    assert.match(service, /buildRecipeCostDraft\(\{/);
    assert.match(service, /assertRecipeBomPrices\(canonicalCost\.parts\)/);
    assert.match(service, /function buildRecipeSavePayloadDraft/);
    assert.match(service, /function executeRecipeCreate/);
    assert.match(service, /function executeRecipeUpdate/);
    assert.match(service, /function executeRecipeDelete/);
    assert.match(create, /executeRecipeCreate/);
    assert.match(patch, /executeRecipeUpdate/);
    assert.match(remove, /executeRecipeDelete/);
    assert.match(create, /sendCommandError\(res, error\)/);
    assert.match(patch, /sendCommandError\(res, error\)/);
    assert.match(remove, /sendCommandError\(res, error\)/);
});

test('关键 API 集成契约：配方测试报告支持上传、下载和软删除', () => {
    const source = readUtf8('api/routes/recipes.cjs');
    const service = readUtf8('api/services/recipeTechnicalFiles.cjs');
    const webClient = readUtf8('apps/web-next/lib/recipes.ts');
    const editor = readUtf8('apps/web-next/components/technical-data-editor.tsx');
    const db = readUtf8('api/db.cjs');
    const schema = readUtf8('api/database/schema.cjs');

    assert.match(source, /router\.get\('\/:id\/technical-files'/);
    assert.match(source, /router\.post\('\/:id\/technical-files'/);
    assert.match(source, /router\.get\('\/:id\/technical-files\/:fileId\/download'/);
    assert.match(source, /router\.delete\('\/:id\/technical-files\/:fileId'/);
    assert.match(source, /executeRecipeTechnicalFileUpload/);
    assert.match(source, /executeRecipeTechnicalFileDelete/);
    assert.match(source, /getRecipeTechnicalFileDownload/);
    assert.match(source, /listRecipeTechnicalFiles/);
    assert.doesNotMatch(source, /safeInsert\('recipe_technical_files'/);
    assert.doesNotMatch(source, /softDelete\('recipe_technical_files'/);
    assert.match(service, /parsePumpTestReport/);
    assert.match(service, /storeFactoryFile/);
    assert.match(service, /file_id: stored\.file\.id/);
    assert.match(service, /safeInsert\(\s*'recipe_technical_files'/);
    assert.match(service, /safeUpdate\(\s*'recipe_technical_files'/);
    assert.match(service, /executePersistentCommand/);
    assert.match(service, /assertExpectedUpdatedAt/);
    assert.match(webClient, /recipe-technical-file-upload:/);
    assert.match(webClient, /recipe-technical-file-delete:/);
    assert.match(webClient, /body\.append\('expectedUpdatedAt'/);
    assert.match(editor, /uploadRecipeTechnicalFile\(recipeId, file, recipeUpdatedAt\)/);
    assert.match(editor, /deleteRecipeTechnicalFile\(recipeId, file\.id, file\.updatedAt\)/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS recipe_technical_files/);
    assert.match(db, /'recipe_technical_files'/);
});

test('关键 API 集成契约：转子暂存和历史写入由正式 command service 执行', () => {
    const route = readUtf8('api/routes/rotor.cjs');
    const commandService = readUtf8('api/services/rotorCommands.cjs');
    const parameterService = readUtf8('api/services/rotorParameters.cjs');
    const historyService = readUtf8('api/services/rotorHistory.cjs');
    const queryService = readUtf8('api/services/rotorQueries.cjs');
    const webClient = readUtf8('apps/web-next/lib/rotor.ts');
    const db = readUtf8('api/db.cjs');

    for (const command of [
        'executeRotorParameterSave',
        'executeRotorHistoryRename',
        'executeRotorHistoryLink',
        'executeRotorHistoryDelete',
    ]) {
        assert.match(route, new RegExp(command));
        assert.match(commandService, new RegExp(`function ${command}`));
    }
    assert.match(route, /commandContextFromRequest/);
    assert.match(commandService, /executePersistentCommand/);
    assert.match(commandService, /assertExpectedUpdatedAt/);
    assert.match(commandService, /resolveDrawingFile/);
    assert.match(commandService, /dependencies\.safeInsert\(\s*'rotor_drawings'/);
    assert.match(commandService, /dependencies\.safeUpdate\(\s*'rotor_drawings'/);
    assert.match(parameterService, /function buildFcParams/);
    assert.match(historyService, /function getRotorJobStatus/);
    assert.match(historyService, /FROM rotor_drawings/);
    for (const query of [
        'listOrderPumpModels',
        'buildRecipeRotorDraft',
        'buildTemplateRotorDraft',
        'listRotorLinkTargets',
    ]) {
        assert.match(route, new RegExp(query));
        assert.match(queryService, new RegExp(`function ${query}`));
    }
    assert.match(queryService, /buildRotorRecipeDraft/);
    assert.match(queryService, /buildRotorTemplateDraft/);
    assert.doesNotMatch(route, /function buildFcParams/);
    assert.doesNotMatch(route, /SELECT id, customer_name, contract_no, items_json/);
    assert.doesNotMatch(route, /SELECT v\.id, v\.model_name/);
    assert.doesNotMatch(route, /hardDelete\('rotor_drawings'/);
    assert.match(webClient, /rotor-save/);
    assert.match(webClient, /rotor-link:/);
    assert.match(webClient, /rotor-delete:/);
    assert.match(webClient, /expectedUpdatedAt: record\.updatedAt/);
    assert.match(db, /function hardDelete\(table, id, options = \{\}\)/);
    assert.match(db, /if \(options\.requireAudit\) throw error/);
});

test('关键 API 集成契约：线圈库存支持原子批量调整并保留流水', () => {
    const source = readUtf8('api/routes/coils.cjs');
    const service = readUtf8('api/services/inventoryCommands.cjs');
    const operation = readUtf8('api/services/commandExecution.cjs');
    const section = sliceBetween(source, "router.post('/stock-adjustments'", "router.get('/:id/stock-movements'");

    assert.ok(
        source.indexOf("router.post('/stock-adjustments'") < source.indexOf("router.get('/:id/stock-movements'"),
        '批量库存路由必须注册在动态线圈 ID 路由之前'
    );
    assert.match(source, /router\.post\('\/stock-adjustments-preview'/);
    assert.match(source, /buildCoilStockPreview/);
    assert.match(section, /executeConfirmedCoilStockBatch/);
    assert.match(section, /commandActorKey/);
    assert.match(section, /commandContextFromRequest/);
    assert.doesNotMatch(section, /safeUpdate\s*\(|safeInsert\s*\(|db\.transaction/);
    assert.match(service, /function executeCoilStockBatch/);
    assert.match(service, /adjustCoilStock/);
    assert.match(service, /expectedUpdatedAt/);
    assert.match(service, /auditIds/);
    assert.match(operation, /api_operations/);
    assert.match(operation, /run\.immediate\(\)/);
});

test('关键 API 集成契约：线圈列表、规格草稿和库存流水委托纯读 Query service', () => {
    const route = readUtf8('api/routes/coils.cjs');
    const service = readUtf8('api/services/coilQueries.cjs');
    const listSection = sliceBetween(
        route,
        "router.get('/'",
        "router.post('/'"
    );
    const movementSection = sliceBetween(
        route,
        "router.get('/:id/stock-movements'",
        "router.post('/:id/stock-adjustment'"
    );

    assert.match(route, /createCoilQueries/);
    assert.match(listSection, /coilQueries\.getAllCoils\(req\.query\)/);
    assert.match(listSection, /coilQueries\.getAllStatorVariants/);
    assert.match(route, /coilQueries\.getSpecDraft/);
    assert.match(route, /coilQueries\.getSpecOptions/);
    assert.match(movementSection, /coilQueries\.getStockMovements/);
    assert.doesNotMatch(movementSection, /db\.prepare|SELECT|coilStockMovementRow/);
    assert.match(service, /SELECT id FROM coils WHERE id = \?/);
    assert.match(service, /FROM coil_stock_movements/);
    assert.match(service, /String\(options\.spec/);
    assert.match(service, /Number\(coil\.sheets\) === sheets/);
    assert.doesNotMatch(service, /safeInsert|safeUpdate|hardDelete/);
});

test('关键 API 集成契约：线圈产生库存事实后冻结业务身份', () => {
    const route = readUtf8('api/routes/coils.cjs');
    const commands = readUtf8('api/services/coilCommands.cjs');
    const service = readUtf8('api/services/coilInventory.cjs');
    const patchSection = sliceBetween(route, "router.patch('/:id'", "router.delete('/:id'");
    const commandSection = sliceBetween(
        commands,
        'function executeCoilUpdate',
        'function executeCoilDelete'
    );

    assert.match(patchSection, /executeCoilUpdate/);
    assert.match(commandSection, /identityChanges/);
    assert.match(
        commandSection,
        /dependencies\.assertCoilIdentityEditable\(\s*dependencies\.db,\s*coilId,\s*identityChanges/
    );
    assert.ok(
        commandSection.indexOf('dependencies.assertCoilIdentityEditable(')
            < commandSection.indexOf('variantResult = ensureStatorVariant('),
        '身份冻结检查必须早于创建或切换定子组合'
    );
    assert.match(service, /Number\(coil\.stock \|\| 0\) > 0/);
    assert.match(service, /SELECT COUNT\(\*\) AS count FROM coil_stock_movements WHERE coil_id = \?/);
    assert.match(service, /error\.statusCode = 409/);
});

test('关键 API 集成契约：回答纠错可生成全局长期规则并支持停用', () => {
    const route = readUtf8('api/routes/ai/feedback.cjs');
    const evaluationRoute = readUtf8('api/routes/ai/evaluations.cjs');
    const feedbackService = readUtf8('api/services/aiAnswerFeedback.cjs');
    const ruleService = readUtf8('api/services/factoryAiRules.cjs');
    const regressionService = readUtf8('api/services/aiRegressionCases.cjs');
    const chat = readAiPromptContractSource();

    assert.match(route, /router\.get\('\/api\/ai\/learning-rules'/);
    assert.match(route, /router\.patch\('\/api\/ai\/learning-rules\/:id'/);
    assert.match(feedbackService, /learnFromCorrection === true && rating !== 'incorrect'/);
    assert.match(feedbackService, /让 AI 长期记住时必须填写正确做法/);
    assert.match(feedbackService, /synchronizeFactoryAiRuleFromFeedback/);
    assert.match(feedbackService, /synchronizeAiEvaluationCaseFromFeedback/);
    assert.match(ruleService, /status: 'active'/);
    assert.match(ruleService, /ALLOWED_STATUSES = new Set\(\['active', 'disabled'\]\)/);
    assert.match(chat, /composeAiSystemPrompt/);
    assert.match(chat, /buildFactoryAiRulesPrompt/);
    assert.match(ruleService, /selectRelevantFactoryAiRules/);
    assert.match(evaluationRoute, /router\.patch\('\/api\/ai\/evaluations\/cases\/:id'/);
    assert.match(regressionService, /confidenceScore >= 65/);
    assert.match(regressionService, /source_type: 'feedback'/);
});

test('关键 API 集成契约：AI 对话按当前轮次隔离上下文并二次校验工具权限', () => {
    const chat = readUtf8('api/routes/ai/chat.cjs');
    const dispatcher = readUtf8('api/services/aiAgentRuntimeV3.cjs');
    const planner = readUtf8('api/services/aiGoalPlannerV3.cjs');
    const catalog = readUtf8('api/services/aiCapabilityCatalogV2.cjs');
    const context = readUtf8('api/services/aiContext.cjs');
    const protocol = readUtf8('api/services/aiToolProtocol.cjs');
    const provider = readUtf8('api/services/aiProvider.cjs');

    assert.match(chat, /runAiDispatcherV3\(/);
    assert.match(dispatcher, /planAiIntentV3\(messages/);
    assert.match(dispatcher, /scopeAiContextForIntent\(messages, intent\)/);
    assert.match(dispatcher, /selectToolsForIntent\(intent/);
    assert.match(dispatcher, /allowedToolNames/);
    assert.match(dispatcher, /writeIntent: intent\.mode === 'command'/);
    assert.match(planner, /submit_ai_intent_plan/);
    assert.match(planner, /toolChoice/);
    assert.match(catalog, /capability\.access === 'write'/);
    assert.match(context, /不是执行授权或事实证据/);
    assert.match(protocol, /AI_TOOL_NOT_ALLOWED_FOR_CURRENT_TURN/);
    assert.match(protocol, /AI_WRITE_TOOL_NOT_ALLOWED_FOR_READ_TURN/);
    assert.match(provider, /prepareProviderTools\(options\.tools, config\)/);
    assert.match(provider, /providerTools/);
    assert.match(provider, /options\.toolChoice/);
});

test('关键 API 集成契约：V9.1 统一文件上传执行真实类型校验和哈希去重', () => {
    const entry = readUtf8('api.cjs');
    const route = readUtf8('api/routes/files.cjs');
    const service = readUtf8('api/services/factoryFileStore.cjs');
    const schema = readUtf8('api/database/schema.cjs');
    const knowledgeRoute = readUtf8('api/routes/knowledge.cjs');
    const knowledgeDocuments = readUtf8('api/services/knowledgeDocuments.cjs');
    const recipeRoute = readUtf8('api/routes/recipes.cjs');
    const recipeTechnicalFiles = readUtf8('api/services/recipeTechnicalFiles.cjs');

    assert.match(entry, /app\.use\('\/api\/files', require\('\.\/api\/routes\/files\.cjs'\)\)/);
    assert.match(route, /router\.post\('\/'/);
    assert.match(route, /router\.get\('\/:id\/download'/);
    assert.match(route, /router\.delete\('\/:id'/);
    assert.match(route, /executeFactoryFileUpload\(/);
    assert.match(service, /inspectFactoryFile/);
    assert.match(service, /fileSha256: crypto\.createHash\('sha256'\)/);
    assert.match(service, /SELECT \* FROM factory_files WHERE file_sha256 = \?/);
    assert.match(service, /文件扩展名与实际/);
    assert.match(service, /MAX_FACTORY_FILE_SIZE = 10 \* 1024 \* 1024/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS factory_files/);
    assert.match(schema, /file_sha256 TEXT NOT NULL UNIQUE/);
    assert.match(knowledgeRoute, /executeKnowledgeDocumentUpload/);
    assert.match(knowledgeDocuments, /sourceType: 'knowledge_document'/);
    assert.match(recipeRoute, /recipeTechnicalFileDependencies/);
    assert.match(recipeTechnicalFiles, /sourceType: 'recipe_technical_file'/);
});

test('关键 API 集成契约：V9.2 PDF 上传自动解析并提供重试和全文读取', () => {
    const route = readUtf8('api/routes/files.cjs');
    const parser = readUtf8('api/services/factoryFileParser.cjs');
    const pdfParser = readUtf8('api/services/factoryPdfParser.cjs');
    const store = readUtf8('api/services/factoryFileStore.cjs');

    assert.match(route, /await executeFactoryFileParse\(/);
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

    assert.match(route, /needsFactoryFileParsing\(result\)/);
    assert.match(route, /buildQuotationFileDraft\(id/);
    const quotationDraftRoute = sliceBetween(
        route,
        "router.post('/:id/quotation-draft'",
        "router.get('/:id/links'"
    );
    assert.match(quotationDraftRoute, /factory_file_parse_required/);
    assert.doesNotMatch(
        quotationDraftRoute,
        /executeFactoryFileParse|safeInsert|safeUpdate|softDelete/
    );
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
    const queries = readUtf8('api/services/costQueries.cjs');
    const section = sliceBetween(source, "router.post('/cost/recipe-difference'", '// ── 市场指标 ──');

    assert.match(section, /costQueries\.getRecipeDifference\(req\.body \|\| \{\}\)/);
    assert.match(queries, /buildCostDifference\(input, \{/);
    assert.match(queries, /currentCostDependencies/);
    assert.match(section, /res\.json\(\{\s*success:\s*true,\s*data:/);
    assert.match(section, /sendCostQueryError\(res, error, 400\)/);
    assertNoWrites(section);
    assertNoWrites(queries);
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

test('关键 API 集成契约：客户 CRUD 由正式 command service 执行', () => {
    const route = readUtf8('api/routes/customers.cjs');
    const service = readUtf8('api/services/customerCommands.cjs');
    const client = readUtf8('apps/web-next/lib/customers.ts');

    assert.match(route, /executeCustomerCreate/);
    assert.match(route, /executeCustomerUpdate/);
    assert.match(route, /executeCustomerDelete/);
    assert.match(route, /commandContextFromRequest/);
    assert.doesNotMatch(route, /safeInsert\('customers'|safeUpdate\('customers'|softDelete\('customers'/);
    assert.match(service, /executePersistentCommand/);
    assert.match(service, /assertExpectedUpdatedAt/);
    assert.match(service, /safeInsert\('customers'/);
    assert.match(service, /safeUpdate\(\s*'customers'/);
    assert.match(service, /requiredAuditCount: 1/);
    assert.match(client, /Idempotency-Key/);
    assert.match(client, /expectedUpdatedAt/);
});

test('关键 API 集成契约：泵壳模板 CRUD 由正式 command service 执行', () => {
    const route = readUtf8('api/routes/templates.cjs');
    const service = readUtf8('api/services/templateCommands.cjs');
    const client = readUtf8('apps/web-next/lib/recipes.ts');

    assert.match(route, /executeTemplateCreate/);
    assert.match(route, /executeTemplateUpdate/);
    assert.match(route, /executeTemplateDelete/);
    assert.match(route, /commandContextFromRequest/);
    assert.doesNotMatch(
        route,
        /safeInsert\('pump_shell_templates'|safeUpdate\('pump_shell_templates'|hardDelete\('pump_shell_templates'/
    );
    assert.match(service, /executePersistentCommand/);
    assert.match(service, /assertExpectedUpdatedAt/);
    assert.match(service, /validateShellComponents/);
    assert.match(service, /safeInsert\('pump_shell_templates'/);
    assert.match(service, /safeUpdate\(\s*'pump_shell_templates'/);
    assert.match(service, /hardDelete\(\s*'pump_shell_templates'/);
    assert.match(service, /SELECT COUNT\(\*\) AS count FROM recipes WHERE template_id = \?/);
    assert.match(service, /requiredAuditCount: 1/);
    assert.match(client, /template-create/);
    assert.match(client, /template-update:/);
    assert.match(client, /template-delete:/);
    assert.match(client, /expectedUpdatedAt: template\.updatedAt/);
});

test('关键 API 集成契约：泵壳模板查询和配方草稿由 Query service 聚合', () => {
    const route = readUtf8('api/routes/templates.cjs');
    const service = readUtf8('api/services/templateQueries.cjs');

    assert.match(route, /createTemplateQueries/);
    assert.match(route, /templateQueries\.getAllTemplates/);
    assert.match(route, /shellModel:\s*req\.query\.shellModel/);
    assert.match(route, /description:\s*req\.query\.description/);
    assert.match(route, /limit:\s*req\.query\.limit/);
    assert.match(route, /templateQueries\.getTemplateCost/);
    assert.match(route, /templateQueries\.getDefaultRecipe/);
    assert.match(route, /templateQueries\.applyTemplate/);
    assert.match(route, /templateQueries\.getTemplateRecipes/);
    assert.doesNotMatch(route, /db\.prepare\(/);
    assert.doesNotMatch(route, /JSON\.parse\(/);
    assert.match(service, /SELECT \* FROM pump_shell_templates WHERE id = \?/);
    assert.match(service, /SELECT \* FROM recipes WHERE template_id = \?/);
    assert.match(service, /buildTemplateCostParts/);
    assert.match(service, /calculateRecipeCost/);
    assert.doesNotMatch(service, /\b(INSERT|UPDATE|DELETE)\b/);
});

test('关键 API 集成契约：报价转订单由 command service 统一事务与重试安全', () => {
    const route = readUtf8('api/routes/quotations.cjs');
    const service = readUtf8('api/services/quotationConversion.cjs');
    const version = readUtf8('api/services/resourceVersion.cjs');

    assert.match(route, /buildQuotationOrderDraft/);
    assert.match(route, /executeQuotationConversion/);
    assert.match(route, /commandContextFromRequest/);
    assert.doesNotMatch(route, /function convertQuotationToOrder|const convert = db\.transaction/);
    assert.match(service, /executePersistentCommand/);
    assert.match(service, /quotationConversionPreviewHash/);
    assert.match(service, /assertPreviewHash/);
    assert.match(service, /safeInsert\('orders'/);
    assert.match(service, /safeUpdate\('quotations'/);
    assert.match(service, /requiredAuditCount: 2/);
    assert.match(service, /quotation_already_converted/);
    assert.match(version, /resource_version_conflict/);
});

test('关键 API 集成契约：采购一键入库由正式预览和 command service 原子执行', () => {
    const route = readUtf8('api/routes/orders.cjs');
    const service = readUtf8('api/services/purchasingInbound.cjs');
    const inventory = readUtf8('api/services/purchaseInventory.cjs');

    assert.match(route, /buildCompletePurchaseDraft/);
    assert.match(route, /executeCompletePurchase/);
    assert.match(route, /commandContextFromRequest/);
    assert.doesNotMatch(route, /function completePurchaseOrder/);
    assert.match(service, /executePersistentCommand/);
    assert.match(service, /assertExpectedUpdatedAt/);
    assert.match(service, /suggestedIdempotencyKey/);
    assert.match(service, /requiredAuditCount/);
    assert.match(service, /purchase_receipt_id: receiptId/);
    assert.match(inventory, /adjustCoilStock/);
    assert.match(inventory, /auditContext/);
});

test('关键 API 集成契约：单项采购进度由正式预览和 command service 原子执行', () => {
    const route = readUtf8('api/routes/orders.cjs');
    const service = readUtf8('api/services/purchasingItemProgress.cjs');
    const nextClient = readUtf8('apps/web-next/lib/orders.ts');

    assert.match(route, /buildPurchaseItemProgressDraft/);
    assert.match(route, /buildLegacyPurchaseItemToggleInput/);
    assert.match(route, /executePurchaseItemProgress/);
    assert.match(route, /PURCHASE_PROGRESS_CAPABILITY_ID/);
    assert.doesNotMatch(route, /function updatePurchaseItemProgress/);
    assert.match(service, /executePersistentCommand/);
    assert.match(service, /function buildLegacyPurchaseItemToggleInput/);
    assert.match(service, /progressPreviewHash/);
    assert.match(service, /assertExpectedUpdatedAt/);
    assert.match(service, /assertPreviewHash/);
    assert.match(service, /applyPurchaseInventory/);
    assert.match(service, /requiredAuditCount/);
    assert.match(nextClient, /purchase-items\/progress-draft/);
    assert.match(nextClient, /draft\.suggestedIdempotencyKey/);
    assert.match(nextClient, /draft\.expectedUpdatedAt/);
    assert.match(nextClient, /draft\.previewHash/);
});

test('关键 API 集成契约：采购中心批量下单由正式预览和跨订单 command 原子执行', () => {
    const route = readUtf8('api/routes/orders.cjs');
    const service = readUtf8('api/services/purchasingBatchOrder.cjs');
    const client = readUtf8('apps/web-next/lib/purchase.ts');

    assert.match(route, /buildPurchaseBatchDraft/);
    assert.match(route, /executePurchaseBatch/);
    assert.match(route, /PURCHASE_BATCH_CAPABILITY_ID/);
    assert.doesNotMatch(route, /persistCurrentBalancedPurchasePlans\(\)/);
    assert.match(service, /executePersistentCommand/);
    assert.match(service, /batchPreviewHash/);
    assert.match(service, /expectedVersions/);
    assert.match(service, /assertPreviewHash/);
    assert.match(service, /requiredAuditCount/);
    assert.match(client, /buildPurchaseBatchDraft/);
    assert.match(client, /draft\.expectedVersions/);
    assert.match(client, /draft\.previewHash/);
});

test('关键 API 集成契约：直接建单和状态变更由订单 command service 执行', () => {
    const route = readUtf8('api/routes/orders.cjs');
    const service = readUtf8('api/services/orderCommands.cjs');
    const createRoute = sliceBetween(route, "router.post('/'", "router.patch('/:id'");
    const statusRoute = sliceBetween(
        route,
        "router.post('/:id/status'",
        "router.post('/:id/purchase-items/progress'"
    );

    assert.match(createRoute, /executeOrderCreate/);
    assert.match(createRoute, /commandContextFromRequest\(req, ORDER_CREATE_CAPABILITY_ID\)/);
    assert.doesNotMatch(createRoute, /safeInsert\s*\(|safeUpdate\s*\(|db\.transaction/);
    assert.match(statusRoute, /executeOrderStatus/);
    assert.match(statusRoute, /commandContextFromRequest\(req, ORDER_STATUS_CAPABILITY_ID\)/);
    assert.doesNotMatch(statusRoute, /safeInsert\s*\(|safeUpdate\s*\(|db\.transaction/);
    assert.match(service, /executePersistentCommand/);
    assert.match(service, /assertPreviewHash/);
    assert.match(service, /assertExpectedUpdatedAt/);
    assert.match(service, /buildCurrentBalancedPurchasePlans/);
    assert.match(route, /function legacyOrderCommandResponse/);
    assert.match(route, /operationStatus:\s*result\.status/);
    assert.match(route, /\.\.\.result\.order/);
});

test('关键 API 集成契约：待确认订单编辑和删除由同一 command service 执行', () => {
    const route = readUtf8('api/routes/orders.cjs');
    const service = readUtf8('api/services/orderCommands.cjs');
    const updateRoute = sliceBetween(
        route,
        "router.patch('/:id'",
        "router.delete('/:id'"
    );
    const deleteRoute = sliceBetween(
        route,
        "router.delete('/:id'",
        'module.exports = router'
    );

    assert.match(updateRoute, /executeOrderUpdate/);
    assert.match(updateRoute, /commandContextFromRequest\(req, ORDER_UPDATE_CAPABILITY_ID\)/);
    assert.doesNotMatch(updateRoute, /safeUpdate\s*\(|db\.transaction/);
    assert.match(deleteRoute, /executeOrderDelete/);
    assert.match(deleteRoute, /commandContextFromRequest\(req, ORDER_DELETE_CAPABILITY_ID\)/);
    assert.doesNotMatch(deleteRoute, /safeUpdate\s*\(|softDelete\s*\(|db\.transaction/);
    assert.match(service, /function executeOrderUpdate/);
    assert.match(service, /function executeOrderDelete/);
    assert.match(service, /order_update_status_conflict/);
    assert.match(service, /order_delete_status_conflict/);
});

test('关键 API 集成契约：V8.4 执行历史独立记录结果并按实时计划恢复', () => {
    const route = readUtf8('api/routes/workbench.cjs');
    const history = readUtf8('api/services/factoryWorkflowHistory.cjs');
    const command = readUtf8('api/services/factoryWorkflowCommands.cjs');
    const recorder = readUtf8('api/routes/ai/executors/workflowRunRecorder.cjs');

    assert.match(route, /router\.get\('\/execution-runs'/);
    assert.match(route, /router\.post\('\/execution-runs'/);
    assert.match(route, /executeRecordFactoryWorkflowRun\(/);
    assert.match(route, /commandContextFromRequest\(/);
    assert.doesNotMatch(route, /recordFactoryWorkflowRun\(req\.body/);
    assert.match(route, /decorateFactoryExecutionPlanWithHistory\(plan\)/);
    assert.match(history, /safeInsert\('factory_workflow_runs'/);
    assert.match(history, /hardDelete\(/);
    assert.doesNotMatch(history, /DELETE FROM factory_workflow_runs/);
    assert.match(history, /fingerprintFactoryExecutionPlan/);
    assert.match(history, /retry_available/);
    assert.match(history, /该计划版本的步骤已有成功执行记录，不会重复执行/);
    assert.match(command, /executePersistentCommand/);
    assert.match(command, /RECORD_WORKFLOW_RUN_CAPABILITY_ID/);
    assert.match(recorder, /\/api\/workbench\/execution-runs/);
    assert.doesNotMatch(history, /safeUpdate\('(?:orders|quotations|parts|recipes)'/);
});

test('关键 API 集成契约：工厂提示配置由版本化 command service 写入', () => {
    const route = readUtf8('api/routes/ai/prompt.cjs');
    const service = readUtf8('api/services/factoryProfileService.cjs');
    const web = readUtf8('apps/web-next/lib/ai.ts');

    assert.match(route, /executeFactoryProfileUpdate\(/);
    assert.match(route, /commandContextFromRequest\(/);
    assert.doesNotMatch(route, /setConfig\(/);
    assert.match(service, /executePersistentCommand/);
    assert.match(service, /expectedVersion/);
    assert.match(service, /setConfig\(/);
    assert.match(web, /system-prompt\?includeMeta=1/);
    assert.match(web, /Idempotency-Key/);
    assert.match(web, /expectedVersion:\s*factoryProfileVersion/);
});

test('关键 API 集成契约：/api/quality/recipe-analysis 只生成配方智能建议不写库', () => {
    const source = readUtf8('api/routes/quality.cjs');

    assert.match(source, /router\.post\('\/recipe-analysis'/);
    assert.match(source, /analyzeRecipeConfiguration\(req\.body \|\| \{\}\)/);
    assert.match(source, /res\.json\(\{ success: true, data:/);
    assert.match(source, /error\.statusCode \|\| 500/);
    assertNoWrites(source);
});

test('关键 API 集成契约：配方检查反馈通过持久化命令委托统一反馈服务', () => {
    const source = readUtf8('api/routes/quality.cjs');
    const command = readUtf8('api/services/qualityRuleCommands.cjs');
    assert.match(source, /router\.post\('\/recipes\/:recipeId\/feedback'/);
    assert.match(source, /executeSaveRecipeAnalysisFeedback\(/);
    assert.match(source, /router\.post\('\/recipe-feedback\/:id\/resolve'/);
    assert.match(source, /executeResolveRecipeAnalysisFeedback\(/);
    assert.match(source, /commandContextFromRequest/);
    assert.match(command, /saveRecipeAnalysisFeedback\(/);
    assert.match(command, /resolveRecipeAnalysisFeedback\(/);
    assert.match(command, /executePersistentCommand/);
});

test('关键 API 集成契约：候选规则提供归纳、影响、执行监控、历史、审核和恢复入口', () => {
    const source = readUtf8('api/routes/quality.cjs');
    const command = readUtf8('api/services/qualityRuleCommands.cjs');
    assert.match(source, /router\.get\('\/rule-compliance'/);
    assert.match(source, /router\.get\('\/rule-learning-health'/);
    assert.match(source, /router\.get\('\/rule-candidates'/);
    assert.match(source, /router\.get\('\/rule-events'/);
    assert.match(source, /router\.post\('\/rule-events\/:id\/restore'/);
    assert.match(source, /router\.post\('\/rule-candidates\/refresh'/);
    assert.match(source, /router\.get\('\/rule-candidates\/:id\/impact'/);
    assert.match(source, /router\.patch\('\/rule-candidates\/:id'/);
    assert.match(source, /executeRefreshFactoryRuleCandidates/);
    assert.match(source, /buildFactoryLearningHealth/);
    assert.match(source, /executeReviewFactoryRuleCandidate/);
    assert.match(source, /executeRestoreFactoryRuleEvent/);
    assert.match(command, /refreshFactoryRuleCandidates/);
    assert.match(command, /reviewFactoryRuleCandidate/);
    assert.match(command, /restoreFactoryRuleEvent/);
});

test('关键 API 集成契约：/api/knowledge 提供搜索、详情和同步入口', () => {
    const source = readUtf8('api/routes/knowledge.cjs');
    const command = readUtf8('api/services/knowledgeSyncCommand.cjs');
    const documents = readUtf8('api/services/knowledgeDocuments.cjs');
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
    assert.match(source, /executeKnowledgeDocumentUpload/);
    assert.match(source, /executeKnowledgeDocumentDelete/);
    assert.match(source, /commandContextFromRequest\(\s*req,\s*KNOWLEDGE_DOCUMENT_UPLOAD_CAPABILITY_ID/);
    assert.match(source, /commandContextFromRequest\(\s*req,\s*KNOWLEDGE_DOCUMENT_DELETE_CAPABILITY_ID/);
    assert.match(documents, /executePersistentCommand/);
    assert.match(documents, /assertExpectedUpdatedAt/);
    assert.match(source, /router\.post\('\/sync-preview'/);
    assert.match(source, /buildKnowledgeSyncPreview/);
    assert.match(source, /router\.post\('\/sync'/);
    assert.match(source, /executeKnowledgeSync/);
    assert.match(source, /commandContextFromRequest\(req, KNOWLEDGE_SYNC_CAPABILITY_ID\)/);
    assert.match(command, /executePersistentCommand/);
    assert.match(command, /consumeBusinessConfirmation/);
    assert.match(command, /scheduleVectorSync: false/);
    assert.match(command, /requestKnowledgeVectorSync/);
    assert.match(source, /router\.get\('\/:id'/);
    assert.match(source, /parsePositiveId\(req\.params\.id\)/);
    assert.match(source, /getKnowledgeEntryDetail\(id\)/);
    assert.match(source, /res\.json\(\{ success: true, data \}\)/);
});

test('关键 API 集成契约：AI 会话提供历史列表、详情、消息保存和删除入口', () => {
    const route = readUtf8('api/routes/ai/conversations.cjs');
    const service = readUtf8('api/services/aiConversations.cjs');
    const commands = readUtf8('api/services/aiConversationCommands.cjs');
    assert.match(route, /router\.get\('\/api\/ai\/conversations'/);
    assert.match(route, /router\.post\('\/api\/ai\/conversations'/);
    assert.match(route, /router\.get\('\/api\/ai\/conversations\/:id'/);
    assert.match(route, /router\.post\('\/api\/ai\/conversations\/:id\/messages'/);
    assert.match(route, /router\.patch\('\/api\/ai\/conversations\/:id\/messages\/:messageId'/);
    assert.match(route, /router\.delete\('\/api\/ai\/conversations\/:id'/);
    assert.match(route, /parsePositiveId/);
    assert.match(route, /conversationAuth/);
    assert.match(route, /executeCreateAiConversation/);
    assert.match(route, /executeAppendAiConversationMessage/);
    assert.match(route, /executeUpdateAiConversationMessage/);
    assert.match(route, /executeDeleteAiConversation/);
    assert.match(service, /metadata\.attachments/);
    assert.match(service, /附件不存在或已删除/);
    assert.match(commands, /executePersistentCommand/);
    assert.match(commands, /assertExpectedUpdatedAt/);
    assert.match(commands, /requiredAuditCount: 2/);
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
    assert.match(route, /executeSubmitAiAnswerFeedback/);
    assert.match(route, /executeReviewAiAnswerFeedback/);
    assert.match(route, /executeDiagnoseAiAnswerFeedback/);
    assert.match(route, /executeRetestAiAnswerFeedback/);
    assert.match(route, /executeUpdateFactoryAiRule/);
    assert.match(route, /commandContextFromRequest/);
});

test('关键 API 集成契约：知识库回归检查提供运行、记录和汇总入口', () => {
    const route = readUtf8('api/routes/ai/evaluations.cjs');
    const aiRouter = readUtf8('api/routes/ai.cjs');

    assert.match(aiRouter, /evaluationsRouter/);
    assert.match(route, /router\.get\('\/api\/ai\/evaluations\/overview'/);
    assert.match(route, /router\.post\('\/api\/ai\/evaluations\/runs'/);
    assert.match(route, /router\.post\('\/api\/ai\/evaluations\/runs\/:id\/results'/);
    assert.match(route, /router\.post\('\/api\/ai\/evaluations\/runs\/:id\/complete'/);
    assert.match(route, /router\.patch\('\/api\/ai\/evaluations\/system-cases\/:id'/);
    assert.match(route, /evaluationAuth/);
    assert.match(route, /executeConfigureAiSystemEvaluationCase/);
    assert.match(route, /executeRecordAiEvaluationResult/);
    assert.match(route, /executeCompleteAiEvaluationRun/);
    assert.match(route, /commandContextFromRequest/);
    assert.match(route, /legacyEvaluationEntityResponse/);
});

test('关键 API 集成契约：/api/recipes/current-costs 批量返回完整当日成本且不写库', () => {
    const source = readUtf8('api/routes/cost.cjs');
    const queries = readUtf8('api/services/costQueries.cjs');
    const section = sliceBetween(source, "router.get('/recipes/current-costs'", "router.get('/recipes/:id/cost'");

    assert.match(section, /costQueries\.getCurrentRecipeCosts\(\)/);
    assert.match(queries, /listRecipes\(\)\.map\(recipe => calculateCurrentRecipeCost\(/);
    assert.match(queries, /calculateRecipeCost/);
    assert.match(queries, /const coils = listCoils\(\)/);
    assert.match(queries, /getSetting/);
    assert.match(queries, /asOf: now\.toISOString\(\)/);
    assert.match(queries, /sourceOfTruth: 'costEngine'/);
    assert.match(queries, /basis: 'currentTemplateAndRecipeParameters'/);
    assertNoWrites(section);
    assertNoWrites(queries);
});

test('关键 API 集成契约：成本路由只做协议适配且不复用其他 route handler', () => {
    const route = readUtf8('api/routes/cost.cjs');
    const queries = readUtf8('api/services/costQueries.cjs');

    assert.match(route, /createCostQueries/);
    assert.match(route, /costQueries\.calculateParts/);
    assert.match(route, /costQueries\.getRecipeCostByName/);
    assert.match(route, /costQueries\.getRecipeCostById/);
    assert.match(route, /costQueries\.calculateCoil/);
    assert.match(route, /costQueries\.calculateDynamic/);
    assert.match(route, /costQueries\.calculateFullEstimate/);
    assert.doesNotMatch(route, /require\('\.\/coils\.cjs'\)/);
    assert.doesNotMatch(route, /db\.prepare\(/);
    assert.doesNotMatch(route, /JSON\.parse\(/);
    assert.match(queries, /calculateRecipeCost/);
    assert.match(queries, /calculateDynamicConfigCost/);
    assert.match(queries, /calculateFullEstimateCoilCost/);
    assertNoWrites(queries);
});

test('关键 API 集成契约：/api/orders/purchase-plan 只生成采购计划草稿不写库', () => {
    const source = readUtf8('api/routes/orders.cjs');
    const section = sliceBetween(source, "router.post('/purchase-plan'", "router.get('/lookup'");

    assert.match(section, /const items = Array\.isArray\(req\.body\?\.items\) \? req\.body\.items : \[\]/);
    assert.match(section, /buildOrderPlan\(items, dbGetAllParts\(\), \{ coilsCatalog: dbGetAllCoils\(\) \}\)/);
    assert.match(section, /res\.json\(\{\s*success:\s*true,\s*data:/);
    assert.match(section, /res\.status\(400\)\.json\(\{ success: false, error: error\.message \}\)/);
    assertNoWrites(section);
});

test('关键 API 集成契约：/api/orders/:id/readiness 只读编排生产准备检查', () => {
    const source = readUtf8('api/routes/orders.cjs');
    const queries = readUtf8('api/services/orderQueries.cjs');
    const shared = readUtf8('api/services/activeOrderReadiness.cjs');
    const section = sliceBetween(source, "router.get('/:id/readiness'", "router.post('/save-payload-draft'");
    assert.match(queries, /buildOrderReadinessContext\(record\)\.readiness/);
    assert.match(shared, /buildBalancedOrderPlans/);
    assert.match(shared, /buildOrderReadiness/);
    assert.match(shared, /dbGetAllParts\(\)/);
    assert.match(shared, /dbGetAllCoils\(\)/);
    assert.match(shared, /dbGetAllRecipes\(\)/);
    assert.match(section, /orderQueries\.getOrderReadiness/);
    assertNoWrites(queries);
    assertNoWrites(shared);
    assert.doesNotMatch(section, /safeInsert|safeUpdate|softDelete|hardDelete/);
    assert.match(section, /success:\s*true,\s*data:/);
});

test('关键 API 集成契约：订单只读查询和处理方案不刷新采购计划', () => {
    const source = readUtf8('api/routes/orders.cjs');
    const queries = readUtf8('api/services/orderQueries.cjs');
    const purchasePlanning = readUtf8('api/services/orderPurchasePlanning.cjs');
    const readinessCommands = readUtf8('api/services/orderReadinessCommands.cjs');
    const list = sliceBetween(source, "router.get('/'", "router.get('/history-price/:recipeName'");
    const lookup = sliceBetween(source, "router.get('/lookup'", "router.get('/readiness-overview'");
    const plan = sliceBetween(source, "router.get('/:id/readiness-plan'", "router.get('/:id/readiness'");
    const detail = sliceBetween(source, "router.get('/:id'", "router.post('/'");

    assert.match(list, /orderQueries\.getAllOrders/);
    assert.match(list, /router\.get\('\/purchase-overview'/);
    assert.match(list, /orderQueries\.getPurchaseOverview/);
    assertNoWrites(list);
    assert.match(lookup, /orderQueries\.lookupOrders/);
    assert.doesNotMatch(lookup, /db\.prepare|SELECT /);
    assert.match(queries, /SELECT id, customer_name, contract_no, status, updated_at/);
    assert.doesNotMatch(lookup, /persistCurrentBalancedPurchasePlans/);
    assertNoWrites(lookup);
    assert.match(plan, /buildOrderReadinessActionDraft/);
    assertNoWrites(plan);
    const readinessDraft = sliceBetween(
        readinessCommands,
        'function buildOrderReadinessActionDraft',
        'function requireAvailableAction'
    );
    assert.match(readinessDraft, /buildReadinessState/);
    assert.match(readinessDraft, /actionProtocol/);
    assertNoWrites(readinessDraft);
    assert.match(detail, /orderQueries\.getOrder/);
    assertNoWrites(detail);
    assert.match(purchasePlanning, /function listOrdersWithCurrentPurchasePlans/);
    assert.match(purchasePlanning, /function getOrderWithCurrentPurchasePlan/);
    assert.doesNotMatch(
        sliceBetween(
            purchasePlanning,
            'function listOrdersWithCurrentPurchasePlans',
            'function persistCurrentBalancedPurchasePlans'
        ),
        /safeUpdate/
    );
});

test('关键 API 集成契约：报价列表只读，过期状态由独立维护服务处理', () => {
    const route = readUtf8('api/routes/quotations.cjs');
    const queryService = readUtf8('api/services/quotationQueries.cjs');
    const expiryService = readUtf8('api/services/quotationExpiry.cjs');
    const section = sliceBetween(route, "router.get('/'", "router.post('/'");

    assert.match(section, /quotationQueries\.list/);
    assert.match(section, /status:\s*req\.query\.status/);
    assert.match(section, /customerName:\s*req\.query\.customerName/);
    assert.match(section, /limit:\s*req\.query\.limit/);
    assertNoWrites(section);
    assertNoWrites(queryService);
    assert.match(queryService, /quotation\.status.*=== status/s);
    assert.match(queryService, /customerName.*includes\(normalizedCustomerName\)/s);
    assert.doesNotMatch(section, /expireOverdueQuotations/);
    assert.match(expiryService, /requireBusinessCapability/);
    assert.match(expiryService, /executePersistentCommand/);
    assert.match(expiryService, /safeUpdate\(\s*'quotations'/);
    assert.match(expiryService, /requiredAuditCount: quotationIds\.length/);
});

test('关键 API 集成契约：零件列表筛选委托只读 Query service', () => {
    const route = readUtf8('api/routes/parts.cjs');
    const service = readUtf8('api/services/partQueries.cjs');
    const section = sliceBetween(route, "router.get('/'", "router.post('/'");

    assert.match(section, /listParts\(dbGetAllParts\(\),/);
    assert.match(section, /stockStatus:\s*req\.query\.stockStatus/);
    assert.match(section, /limit:\s*req\.query\.limit/);
    assert.match(section, /priceBelow:\s*req\.query\.priceBelow/);
    assert.match(section, /stockAbove:\s*req\.query\.stockAbove/);
    assertNoWrites(section);
    assert.match(service, /stock > 0 && stock <= LOW_STOCK_MAX/);
    assert.match(service, /stockStatus === 'attention'/);
    assertNoWrites(service);
});

test('关键 API 集成契约：客户历史由正式 Query 聚合，AI executor 只调用客户 API', () => {
    const route = readUtf8('api/routes/customers.cjs');
    const queries = readUtf8('api/services/customerQueries.cjs');
    const executor = readUtf8('api/routes/ai/executors/businessExecutors.cjs');
    const contextRoute = sliceBetween(
        route,
        "router.get('/:id/context'",
        "router.post('/'"
    );
    const historyExecutor = sliceBetween(
        executor,
        "case 'search_customer_history':",
        "case 'explain_cost_change':"
    );
    const listRoute = sliceBetween(route, "router.get('/'", "router.get('/:id/context'");

    assert.match(listRoute, /customerQueries\.getAllCustomers/);
    assert.match(listRoute, /id:\s*req\.query\.id/);
    assert.match(listRoute, /name:\s*req\.query\.name/);
    assert.match(listRoute, /limit:\s*req\.query\.limit/);
    assert.match(contextRoute, /customerQueries\.getCustomerContext/);
    assertNoWrites(contextRoute);
    assert.match(queries, /listCustomers\(\)/);
    assert.match(queries, /listQuotations\(\)/);
    assert.match(queries, /listOrders\(\)/);
    assertNoWrites(queries);
    assert.match(historyExecutor, /\/api\/customers\/\$\{customerId\}\/context/);
    assert.doesNotMatch(historyExecutor, /\/api\/quotations|\/api\/orders/);
    assert.doesNotMatch(historyExecutor, /itemsJson|displaySequence|Date\.parse/);
});

test('关键 API 集成契约：订单准备总览只计算一次平衡计划且不写库', () => {
    const source = readUtf8('api/routes/orders.cjs');
    const queries = readUtf8('api/services/orderQueries.cjs');
    const helper = readUtf8('api/services/activeOrderReadiness.cjs');
    const route = sliceBetween(source, "router.get('/readiness-overview'", "router.get('/:id/readiness-plan'");

    assert.match(helper, /const plans = buildBalancedOrderPlans\(records, parts/);
    assert.equal((helper.match(/const plans = buildBalancedOrderPlans\(/g) || []).length, 1);
    assert.match(helper, /records\.map/);
    assert.match(helper, /buildOrderReadiness/);
    assert.match(helper, /buildOrderReadinessPlan/);
    assert.match(helper, /buildOrderReadinessOverview/);
    assertNoWrites(helper);
    assert.match(route, /orderQueries\.getReadinessOverview\(\)/);
    assert.match(queries, /return buildActiveOrdersReadinessOverview\(\)/);
    assertNoWrites(queries);
    assertNoWrites(route);
});

test('关键 API 集成契约：订单方案动作通过正式 command 实时重验并限制可确认步骤', () => {
    const source = readUtf8('api/routes/orders.cjs');
    const service = readUtf8('api/services/orderReadinessCommands.cjs');
    const route = sliceBetween(source, "router.post('/:id/readiness-actions/:actionId'", "router.get('/:id/readiness'");

    assert.match(service, /executePersistentCommand/);
    assert.match(service, /buildOrderReadinessContext/);
    assert.match(service, /buildOrderReadinessPlan/);
    assert.match(service, /action\.mode !== 'confirmable'/);
    assert.match(service, /action\.status !== 'available'/);
    assert.match(service, /assertExpectedUpdatedAt/);
    assert.match(service, /assertPreviewHash/);
    assert.match(service, /applyOrderStatusChange/);
    assert.match(service, /safeUpdate/);
    assert.match(service, /auditIds/);
    assert.match(route, /\['confirm_order', 'generate_purchase_plan'\]/);
    assert.match(route, /executeOrderReadinessAction/);
    assert.match(route, /commandContextFromRequest/);
    assert.doesNotMatch(route, /safeUpdate\(/);
});

test('关键 API 集成契约：/api/parts/batch-stock 是唯一标准库存增减入口', () => {
    const source = readUtf8('api/routes/parts.cjs');
    const partService = readUtf8('api/services/partCommands.cjs');
    const service = readUtf8('api/services/inventoryCommands.cjs');
    const aiExecutor = readUtf8('api/routes/ai/executors/queryExecutors.cjs');
    const aiPartExecution = readUtf8('api/services/aiPartExecution.cjs');
    const webClient = readUtf8('apps/web-next/lib/parts.ts');
    const section = sliceBetween(source, "router.post('/batch-stock'", 'module.exports = router');

    assert.match(source, /router\.post\('\/batch-stock-preview'/);
    assert.match(source, /buildPartStockPreview/);
    assert.match(section, /executeConfirmedPartStockBatch/);
    assert.match(section, /commandActorKey/);
    assert.match(section, /commandContextFromRequest/);
    assert.match(section, /invalidatePartsCache\(\)/);
    assert.doesNotMatch(section, /safeUpdate\s*\(|db\.transaction/);
    assert.match(service, /parsePositiveId\(item\?\.partId\)/);
    assert.match(service, /parseCommandInput\([\s\S]*parseFiniteNumber\(value,[\s\S]*item\?\.delta/);
    assert.match(service, /SELECT id, stock, updated_at FROM parts/);
    assert.match(service, /safeUpdate\('parts', item\.partId, \{ stock: nextStock \}, auditContext\)/);
    assert.match(service, /assertExpectedUpdatedAt/);
    assert.match(partService, /part_stock_patch_compatibility/);
    assert.match(partService, /新调用必须使用 \/api\/parts\/batch-stock/);
    assert.match(aiExecutor, /executePartUpdate/);
    assert.match(aiPartExecution, /\/api\/parts\/batch-stock-preview/);
    assert.match(aiPartExecution, /\/api\/parts\/batch-stock/);
    assert.match(webClient, /\/api\/parts\/batch-stock-preview/);
    assert.match(webClient, /\/api\/parts\/batch-stock/);
    assert.doesNotMatch(section, /\bdb\.prepare\(\s*`?\s*UPDATE\b/i);
});

test('关键 API 集成契约：批量零件建档使用预览、确认和原子正式命令', () => {
    const route = readUtf8('api/routes/parts.cjs');
    const service = readUtf8('api/services/partCommands.cjs');
    const aiExecutor = readUtf8('api/routes/ai/executors/queryExecutors.cjs');
    const aiPartExecution = readUtf8('api/services/aiPartExecution.cjs');
    const routeSection = sliceBetween(
        route,
        "router.post('/batch-create-preview'",
        "router.post('/prices-preview'"
    );

    assert.match(routeSection, /buildPartBatchCreatePreview/);
    assert.match(routeSection, /executeConfirmedPartBatchCreate/);
    assert.match(routeSection, /commandActorKey/);
    assert.match(routeSection, /commandContextFromRequest/);
    assert.match(routeSection, /invalidatePartsCache\(\)/);
    assert.doesNotMatch(routeSection, /safeInsert\s*\(|db\.transaction/);
    assert.match(service, /MAX_BATCH_CREATE_PARTS = 100/);
    assert.match(service, /issueBusinessConfirmation/);
    assert.match(service, /consumeBusinessConfirmation/);
    assert.match(service, /findActivePartByIdentity/);
    assert.match(service, /executePersistentCommand/);
    assert.match(service, /safeInsert\('parts'/);
    assert.match(service, /requiredAuditCount: created\.length/);
    assert.match(aiExecutor, /case 'batch_create_parts'/);
    assert.match(aiPartExecution, /\/api\/parts\/batch-create-preview/);
    assert.match(aiPartExecution, /\/api\/parts\/batch-create/);
});

test('关键 API 集成契约：/api/parts/prices 是标准批量调价入口', () => {
    const source = readUtf8('api/routes/parts.cjs');
    const service = readUtf8('api/services/partCommands.cjs');
    const aiExecutor = readUtf8('api/routes/ai/executors/queryExecutors.cjs');
    const aiPartExecution = readUtf8('api/services/aiPartExecution.cjs');
    const section = sliceBetween(source, "router.patch('/prices'", "router.patch('/:id'");

    assert.match(source, /router\.post\('\/prices-preview'/);
    assert.match(source, /buildPartPricePreview/);
    assert.match(section, /executePartPriceBatch/);
    assert.match(section, /commandContextFromRequest/);
    assert.match(section, /invalidatePartsCache\(\)/);
    assert.match(service, /updates 数组不能为空/);
    assert.match(service, /parsePositiveId\(item\?\.partId\)/);
    assert.match(service, /parseNonNegativeNumber\(item\?\.price, `updates\[\$\{index\}\]\.price`\)/);
    assert.match(service, /expectedUpdatedAt/);
    assert.match(service, /previewHash/);
    assert.match(service, /assertPreviewHash/);
    assert.match(service, /safeUpdate\(\s*'parts',\s*item\.partId,\s*\{ price: item\.price \}/);
    assert.match(service, /requiredAuditCount: parts\.length/);
    assert.doesNotMatch(service, /item\?\.id|item\?\.Id/);
    assert.match(aiExecutor, /executePartPriceBatch/);
    assert.match(aiPartExecution, /\/api\/parts\/prices-preview/);
    assert.match(aiPartExecution, /previewHash: preview\.previewHash/);
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
        const delegatesValidatedIds = filePath === 'api/routes/rotor.cjs'
            && source.includes("require('../services/rotorCommands.cjs')")
            && source.includes("require('../services/rotorQueries.cjs')")
            && readUtf8('api/services/rotorCommands.cjs')
                .includes("require('./validation.cjs')")
            && readUtf8('api/services/rotorQueries.cjs')
                .includes("require('./validation.cjs')");
        return /function parseId\b/.test(source) ||
            /parseInt\(req\.params\.id\)/.test(source) ||
            /Number\(req\.params\.id\)/.test(source) ||
            (!source.includes("require('../services/validation.cjs')")
                && !delegatesValidatedIds);
    });

    assert.deepEqual(offenders, []);
});

test('关键 API 集成契约：成本基础资料写入必须使用统一数字和 JSON 校验', () => {
    const templates = readUtf8('api/routes/templates.cjs');
    const templateCommands = readUtf8('api/services/templateCommands.cjs');
    const variants = readUtf8('api/routes/modelVariants.cjs');
    const modelVariantCommands = readUtf8('api/services/modelVariantCommands.cjs');
    const coils = readUtf8('api/routes/coils.cjs');
    const coilCommands = readUtf8('api/services/coilCommands.cjs');
    const db = readUtf8('api/db.cjs');
    const schema = readUtf8('api/database/schema.cjs');

    assert.match(templates, /executeTemplateCreate/);
    assert.match(templates, /executeTemplateUpdate/);
    assert.match(templateCommands, /parseNonNegativeNumber/);
    assert.match(templateCommands, /stringifyJsonArray/);
    assert.match(templateCommands, /stringifyJsonObject/);
    assert.doesNotMatch(templateCommands, /parseFloat\(assembly_wage\)|parseFloat\(packing_wage\)|parseFloat\(bundle_cost\)/);
    assert.doesNotMatch(templateCommands, /typeof b\.parts_json === 'string' \? b\.parts_json : JSON\.stringify/);

    assert.match(variants, /executeModelVariantCreate/);
    assert.match(variants, /executeModelVariantUpdate/);
    assert.match(variants, /executeModelVariantDelete/);
    assert.match(modelVariantCommands, /parseNonNegativeNumber/);
    assert.match(modelVariantCommands, /stringifyJsonArray/);
    assert.doesNotMatch(modelVariantCommands, /\bNumber\(body\.(coil_sheets|barrel_length|long_screw_extra_length|impeller_thickness|impeller_diameter|impeller_blade_count)\)/);

    assert.match(coils, /executeCoilCreate/);
    assert.match(coils, /executeCoilUpdate/);
    assert.match(coilCommands, /function coilCostFromValues/);
    assert.match(coilCommands, /parseNonNegativeNumber/);
    for (const field of ['mainWireGauge', 'mainWireData', 'auxWireGauge', 'auxWireData']) {
        assert.match(coilCommands, new RegExp(field));
    }
    for (const column of ['main_wire_gauge', 'main_wire_data', 'aux_wire_gauge', 'aux_wire_data']) {
        assert.match(schema, new RegExp(`${column}\\s+TEXT`));
    }
    for (const field of ['mainWireGauge', 'mainWireData', 'auxWireGauge', 'auxWireData']) {
        assert.match(db, new RegExp(field));
    }
    assert.doesNotMatch(coilCommands, /parseFloat\(unitPriceInput\)|parseInt\(sheetsRaw\)|parseFloat\(b\.wireWeight/);
    assert.doesNotMatch(coilCommands, /Number\.isFinite\(up\)/);
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
    const orderCommands = readUtf8('api/services/orderCommands.cjs');
    const configuredSnapshot = readUtf8('api/services/configuredRecipeSnapshot.cjs');
    const quotations = readUtf8('api/routes/quotations.cjs');
    const quotationDraft = readUtf8('api/services/quotationDraft.cjs');

    assert.match(orders, /buildOrderSavePayloadDraft/);
    assert.match(orderCommands, /buildConfiguredRecipeSnapshot/);
    assert.match(orderCommands, /const unitCost = configured\?\.unitCost \?\? Number\(recipe\.saved_total_cost\)/);
    assert.doesNotMatch(orderCommands, /parseNonNegativeNumber\(\s*item\.unitCost/);
    assert.match(orderCommands, /parseNonNegativeNumber\(\s*item\.unitPrice,\s*`items\[\$\{index\}\]\.unitPrice`/);
    assert.match(orderCommands, /parsePositiveNumber\(\s*item\.qty,\s*`items\[\$\{index\}\]\.qty`/);
    assert.match(orderCommands, /parsePositiveNumber\(\s*item\.profitMargin,\s*`items\[\$\{index\}\]\.profitMargin`/);
    assert.doesNotMatch(orderCommands, /Number\(item\.(unitCost|unitPrice|qty|profitMargin)\) \|\|/);

    assert.match(quotationDraft, /parseNonNegativeNumber\(\s*configured\.unitCost,\s*`items\[\$\{index\}\]\.unitCost`/);
    assert.match(quotationDraft, /parseNonNegativeNumber\(\s*item\.unitPrice,\s*`items\[\$\{index\}\]\.unitPrice`/);
    assert.match(quotationDraft, /parseOptionalPositiveNumber\(\s*item\.qty,\s*`items\[\$\{index\}\]\.qty`/);
    assert.match(quotationDraft, /parsePositiveNumber\(\s*item\.margin,\s*`items\[\$\{index\}\]\.margin`/);
    assert.match(quotationDraft, /buildConfiguredRecipeSnapshot\(dependencies, recipeId, item\.overrides/);
    assert.match(configuredSnapshot, /normalizeRecipeConfigurationOverrides\(rawOverrides, fieldPrefix\)/);
    assert.match(quotationDraft, /bomSnapshot: configured\.bomSnapshot/);
    assert.match(quotationDraft, /function parseQuotationItemsInput\(value\)/);
    assert.match(quotations, /buildQuotationSavePayloadDraft/);
    assert.doesNotMatch(quotationDraft, /total_cost:\s*totalCost \|\| 0/);
    assert.doesNotMatch(quotationDraft, /total_price:\s*totalPrice \|\| 0/);
    assert.doesNotMatch(quotationDraft, /Number\(item\.(unitCost|unitPrice|qty|margin)\) \|\|/);
});

test('关键 API 集成契约：配方保存草稿必须统一校验数字字段', () => {
    const recipes = readUtf8('api/routes/recipes.cjs');
    const service = readUtf8('api/services/recipeCommands.cjs');
    const saveDraft = sliceBetween(service, 'function buildRecipeSavePayloadDraft', 'function partsCatalogRows');

    assert.match(service, /const canonicalCost = buildRecipeCostDraft\(\{/);
    assert.match(service, /saved_total_cost: canonicalCost\.savedTotalCost/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.coilSheets, 'form\.coilSheets'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.cableLength, 'form\.cableLength'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(\s*form\.longScrewExtraLength,\s*'form\.longScrewExtraLength'/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.assemblyWage, 'form\.assemblyWage'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.packingWage, 'form\.packingWage'\)/);
    assert.match(saveDraft, /parseNonNegativeNumber\(form\.managementFee, 'form\.managementFee'\)/);
    assert.match(saveDraft, /parseNonNegativeInteger\(form\.impellerBladeCount, 'form\.impellerBladeCount'\)/);
    assert.doesNotMatch(saveDraft, /numberValue\(form\./);
    assert.doesNotMatch(saveDraft, /\bNumber\(form\./);
    assert.match(recipes, /router\.get\('\/:id\/inventory-status'/);
    assert.doesNotMatch(recipes, /produceQty|production-check|router\.post\('\/:id\/produce'/);
    assert.match(service, /parseNonNegativeNumber\(\s*source\.long_screw_extra_length,\s*'longScrewExtraLength'/);
});

test('关键 API 集成契约：业务设置写入由正式 command service 执行', () => {
    const route = readUtf8('api/routes/settings.cjs');
    const service = readUtf8('api/services/businessSettingCommands.cjs');
    const db = readUtf8('api/db.cjs');

    assert.match(route, /executeBusinessSettingUpdate/);
    assert.match(route, /commandContextFromRequest/);
    assert.match(service, /executePersistentCommand/);
    assert.match(service, /expectedUpdatedAt/);
    assert.match(service, /normalizeCableAccessories/);
    assert.match(service, /requiredAuditCount:\s*1/);
    assert.match(db, /function setSetting\(key, value, options = \{\}\)/);
    assert.match(db, /if \(options\.requireAudit\) throw error/);
});

test('关键 API 集成契约：设置读取和 AI 连接探测由 Query service 执行', () => {
    const route = readUtf8('api/routes/settings.cjs');
    const queries = readUtf8('api/services/settingsQueries.cjs');

    assert.match(route, /createSettingsQueries/);
    assert.match(route, /settingsQueries\.getRuntimeSettings/);
    assert.match(route, /settingsQueries\.getBusinessSetting/);
    assert.match(route, /settingsQueries\.getAllBusinessSettings/);
    assert.match(route, /settingsQueries\.testAiConnection/);
    assert.doesNotMatch(route, /db\.prepare\(/);
    assert.doesNotMatch(route, /fetchAiProvider\(\[/);
    assert.match(queries, /SELECT key, value, updated_at/);
    assert.match(queries, /allowedSettings\.has\(key\)/);
    assert.match(queries, /await fetchAiProvider/);
    assert.match(queries, /await response\.arrayBuffer\(\)/);
    assertNoWrites(queries);
});

test('关键 API 集成契约：转子出图和打印通过正式 Preview 与外部命令 service', () => {
    const source = readUtf8('api/routes/rotor.cjs');
    const service = readUtf8('api/services/rotorExternalCommands.cjs');
    const naturalLanguage = readUtf8('api/services/rotorNaturalLanguage.cjs');
    const helpers = sliceBetween(source, 'function rotorSuccess', '// 2分钟后自动清理已完成任务');
    const previewSection = sliceBetween(source, "router.post('/draw-preview'", "router.post('/draw'");
    const drawSection = sliceBetween(source, "router.post('/draw'", "router.post('/save'");
    const chatSection = sliceBetween(source, "router.post('/chat'", "router.get('/status/:jobId'");
    const printPreviewSection = sliceBetween(source, "router.post('/print/:jobId/preview'", "router.post('/print/:jobId',");
    const printSection = sliceBetween(source, "router.post('/print/:jobId',", "router.get('/order-pump-models'");

    assert.match(helpers, /res\.json\(\{ success: true, data, \.\.\.data \}\)/);
    assert.match(helpers, /res\.status\(statusCode\)\.json\(\{ success: false, error: message, status: 'error', message \}\)/);
    assert.match(previewSection, /buildDrawPreview/);
    assert.match(drawSection, /executeDraw/);
    assert.match(drawSection, /commandContextFromRequest\(req, DRAW_CAPABILITY_ID\)/);
    assert.doesNotMatch(drawSection, /safeInsert|execFile/);
    assert.match(chatSection, /rotorNaturalLanguageService\.preview/);
    assert.doesNotMatch(chatSection, /callDeepSeek|https\.request|JSON\.parse|buildFcParams/);
    assert.match(naturalLanguage, /status: 'need_params'/);
    assert.match(naturalLanguage, /buildSafetyWarning/);
    assert.match(naturalLanguage, /buildDrawPreview/);
    assert.match(naturalLanguage, /status: 'confirmation_required'/);
    assert.match(source, /return rotorError\(res, e\.statusCode \|\| 500, e\.message\)/);
    assert.match(printPreviewSection, /buildPrintPreview/);
    assert.match(printSection, /executePrint/);
    assert.doesNotMatch(printSection, /execFileSync|safeUpdate/);
    assert.match(service, /beginPersistentExternalCommand/);
    assert.match(service, /consumeBusinessConfirmation/);
    assert.match(service, /EXTERNAL_PRINT_REQUESTED/);
});

test('关键 API 集成契约：V9.5 文件归档统一校验目标并保护写入边界', () => {
    const route = readUtf8('api/routes/files.cjs');
    const service = readUtf8('api/services/factoryFileArchive.cjs');
    const commandService = readUtf8('api/services/factoryFileCommands.cjs');
    const executor = readUtf8('api/routes/ai/executors/businessExecutors.cjs');
    const tools = readUtf8('api/routes/ai/tools.cjs');
    const store = readUtf8('api/services/factoryFileStore.cjs');

    const searchPosition = route.indexOf("router.get('/archive-targets'");
    const idPosition = route.indexOf("router.get('/:id'");
    assert.notEqual(searchPosition, -1);
    assert.notEqual(idPosition, -1);
    assert.ok(searchPosition < idPosition, 'archive-targets must be registered before /:id');
    assert.match(route, /buildFactoryFileArchivePreview/);
    assert.match(route, /executeConfirmedFactoryFileArchive/);
    assert.match(route, /executeFactoryFileLinkDelete/);
    assert.match(service, /targetSummary\(targetType, targetId, accessors\)/);
    assert.match(service, /parser_status/);
    assert.match(service, /db\.transaction\(execute\)\.immediate\(\)/);
    assert.match(commandService, /executePersistentCommand/);
    assert.match(commandService, /issueBusinessConfirmation/);
    assert.match(commandService, /consumeBusinessConfirmation/);
    assert.match(commandService, /requiredAuditCount/);
    assert.match(
        route,
        /commandContextFromRequest\(\s*req,\s*ARCHIVE_CAPABILITY_ID\s*\)/
    );
    assert.match(executor, /\/api\/files\/\$\{args\.fileId\}\/archive/);
    assert.match(executor, /\/api\/files\/\$\{args\.fileId\}\/archive-preview/);
    assert.match(executor, /source: 'ai_chat'/);
    assert.match(tools, /const WRITE_TOOLS = new Set/);
    assert.match(store, /SELECT id FROM factory_file_links/);
});

test('V10.2 客户要求契约：草稿与人工知识确认使用独立入口', () => {
    const routes = readUtf8('api/routes/orders.cjs');
    const service = readUtf8('api/services/orderRequirements.cjs');
    const tools = readUtf8('api/routes/ai/tools.cjs');
    const panel = readUtf8('apps/web-next/components/order-requirements-panel.tsx');

    assert.match(routes, /router\.put\('\/:id\/requirements\/draft'/);
    assert.match(routes, /router\.post\('\/:id\/requirements\/confirm'/);
    assert.match(routes, /router\.post\('\/:id\/requirements\/revoke'/);
    assert.match(service, /confirmed_text/);
    assert.match(service, /confirmed_source_file_ids_json/);
    assert.match(tools, /name: 'save_order_requirement_draft'/);
    assert.doesNotMatch(tools, /name: 'confirm_order_requirement/);
    assert.match(panel, /确认进入知识库/);
    assert.match(panel, /保存草稿/);
});

test('V10.3 执行档案契约：事实草稿、人工确认和知识边界独立', () => {
    const routes = readUtf8('api/routes/orders.cjs');
    const service = readUtf8('api/services/orderExecutionRecords.cjs');
    const knowledge = readUtf8('api/services/knowledge.cjs');
    const tools = readUtf8('api/routes/ai/tools.cjs');
    const panel = readUtf8('apps/web-next/components/order-execution-records-panel.tsx');

    assert.match(routes, /router\.post\('\/:id\/execution-records'/);
    assert.match(routes, /router\.put\('\/:id\/execution-records\/:recordId\/draft'/);
    assert.match(routes, /router\.post\('\/:id\/execution-records\/:recordId\/confirm'/);
    assert.match(routes, /router\.post\('\/:id\/execution-records\/:recordId\/revoke'/);
    assert.match(service, /confirmed_occurred_at/);
    assert.match(service, /listConfirmedOrderExecutionRecordsForKnowledge/);
    assert.match(knowledge, /执行档案（人工确认事实）/);
    assert.match(tools, /name: 'save_order_execution_draft'/);
    assert.doesNotMatch(tools, /name: 'confirm_order_execution/);
    assert.match(panel, /执行事实时间线/);
    assert.match(panel, /确认进入知识库/);
});

test('V10.4 订单知识包契约：实时业务与人工确认事实统一只读输出', () => {
    const routes = readUtf8('api/routes/orders.cjs');
    const service = readUtf8('api/services/orderKnowledgePackage.cjs');
    const tools = readUtf8('api/routes/ai/tools.cjs');
    const executor = readUtf8('api/routes/ai/executors/orderExecutors.cjs');

    assert.match(routes, /router\.get\('\/:id\/knowledge-package'/);
    assert.match(service, /buildOrderReadinessContext/);
    assert.match(service, /getOrderRequirementSummary/);
    assert.match(service, /getOrderExecutionRecords/);
    assert.match(service, /draftsExcluded:\s*true/);
    assert.match(service, /kind:\s*'human_confirmed'/);
    assertNoWrites(service);
    assert.match(tools, /name: 'get_order_knowledge_package'/);
    assert.match(executor, /\/api\/orders\/\$\{resolved\.orderId\}\/knowledge-package/);
    assert.equal(getAiCapability('get_order_knowledge_package').access, 'read');
});

test('关键 API 集成契约：AI chat 委托模型流与工具消息协议 service', () => {
    const chat = readUtf8('api/routes/ai/chat.cjs');
    const dispatcher = readUtf8('api/services/aiAgentRuntimeV3.cjs');
    const providerStream = readUtf8('api/services/aiProviderStream.cjs');
    const toolProtocol = readUtf8('api/services/aiToolProtocol.cjs');

    assert.match(chat, /runAiDispatcherV3/);
    assert.match(dispatcher, /readAiProviderStream\(response/);
    assert.match(dispatcher, /prepareAiToolCalls\(resolutionBinding\.toolCalls, 'model'/);
    assert.match(dispatcher, /buildAiToolPlan\(preparedCalls, WRITE_TOOLS\)/);
    assert.match(dispatcher, /parseAiToolArguments\(toolCall\.function\.arguments\)/);
    assert.match(dispatcher, /buildAiToolResultMessage\(toolCall, result\)/);
    assert.match(dispatcher, /prioritizeBusinessEvidence/);
    assert.doesNotMatch(chat, /new TextDecoder/);
    assert.doesNotMatch(chat, /JSON\.parse/);

    assert.match(providerStream, /new TextDecoder\('utf-8'\)/);
    assert.match(providerStream, /appendToolCallDelta/);
    assert.match(providerStream, /data\?\.choices\?\.\[0\]\?\.delta/);
    assert.match(toolProtocol, /writeTools\.has\(name\)/);
    assert.match(toolProtocol, /validateAiToolArgs/);
    assert.match(toolProtocol, /prioritizeCurrentEvidence/);
    assertNoWrites(providerStream);
    assertNoWrites(toolProtocol);
});

test('关键 API 集成契约：AI 工具展示名由能力注册表统一提供', () => {
    const registry = readUtf8('api/capabilities/registry.cjs');
    const executor = readUtf8('api/routes/ai/executor.cjs');
    const toolProtocol = readUtf8('api/services/aiToolProtocol.cjs');

    assert.match(registry, /const AI_CAPABILITY_DISPLAY_NAMES = Object\.freeze/);
    assert.match(registry, /displayName: AI_CAPABILITY_DISPLAY_NAMES\[name\] \|\| name/);
    assert.match(executor, /const title = capability\?\.displayName \|\| toolName/);
    assert.match(toolProtocol, /getAiCapability\(name\)\?\.displayName \|\| name/);
    assert.doesNotMatch(executor, /const TOOL_LABELS/);
    assert.doesNotMatch(toolProtocol, /const TOOL_PLAN_LABELS/);
});

test('关键 API 集成契约：AI 工具按注册表 executorKey 唯一分发', () => {
    const registry = readUtf8('api/capabilities/registry.cjs');
    const executor = readUtf8('api/routes/ai/executor.cjs');
    const sources = {
        cost: readUtf8('api/routes/ai/executors/costExecutors.cjs'),
        query: readUtf8('api/routes/ai/executors/queryExecutors.cjs'),
        order: readUtf8('api/routes/ai/executors/orderExecutors.cjs'),
        recipe: readUtf8('api/routes/ai/executors/recipeExecutors.cjs'),
        business: readUtf8('api/routes/ai/executors/businessExecutors.cjs'),
    };

    assert.match(registry, /const AI_EXECUTOR_CAPABILITY_NAMES = Object\.freeze/);
    assert.match(registry, /executorKey: AI_EXECUTOR_BY_CAPABILITY_NAME\[name\] \|\| null/);
    assert.match(registry, /resultProvenance: LIVE_BUSINESS_EVIDENCE_NAMES\.has\(name\)/);
    assert.match(executor, /const executor = TOOL_EXECUTORS\[capability\.executorKey\]/);
    assert.match(executor, /attachVerifiedExecutionEvidence\(/);
    assert.match(executor, /internalFetch\.getApiTrace\(\)/);
    assert.match(executor, /validateAiToolArgs\(toolName, args\)/);
    assert.match(executor, /return attachReadProvenance\(/);
    assert.doesNotMatch(executor, /const LIVE_BUSINESS_TOOLS/);
    assert.doesNotMatch(executor, /const costRes|const queryRes|const orderRes|const recipeRes|const businessRes/);

    for (const capability of listAiCapabilities()) {
        const owners = Object.entries(sources)
            .filter(([, source]) => source.includes(`case '${capability.toolName}'`))
            .map(([owner]) => owner);
        assert.deepEqual(
            owners,
            [capability.executorKey],
            `${capability.toolName} executor 实现与注册表不一致`
        );
    }

    for (const source of Object.values(sources)) {
        assert.doesNotMatch(source, /const (?:COST|QUERY|ORDER|RECIPE)_TOOLS/);
    }
});
