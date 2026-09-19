'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');
const { execFileSync } = require('node:child_process');
const { createBusinessUnderstandingFixture, runFixtureSelfChecks } = require('../tests/helpers/businessUnderstandingFixture.cjs');
const { buildBusinessUnderstandingOracle, definitionHashes, readDefinition } = require('../tests/helpers/businessUnderstandingOracle.cjs');
const { evaluateBusinessUnderstandingCase } = require('../tests/helpers/businessUnderstandingEvaluator.cjs');

const root = path.resolve(__dirname, '..');
const args = new Map(process.argv.slice(2).map(value => {
    const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=') || true];
}));
const envFile = String(args.get('env-file') || process.env.BUS_BENCH_ENV_FILE || '').trim();
if (envFile) dotenv.config({ path: path.resolve(envFile), quiet: true });
const definitionPath = path.join(root, 'tests/fixtures/business-understanding-benchmark-v1.json');
const fixturePath = path.join(root, 'tests/helpers/businessUnderstandingFixture.cjs');
const oraclePath = path.join(root, 'tests/helpers/businessUnderstandingOracle.cjs');
const reportPath = path.resolve(String(args.get('report') || path.join(root, 'logs/business-understanding-baseline-v1-raw.json')));
const artifactPath = path.resolve(String(args.get('artifact') || path.join(root, 'docs/business-understanding-baseline-v1.json')));
const definition = readDefinition(definitionPath);

function flatten(value, output = []) {
    if (Array.isArray(value)) for (const item of value) flatten(item, output);
    else if (value && typeof value === 'object') { output.push(value); for (const item of Object.values(value)) flatten(item, output); }
    return output;
}

function capabilities(toolResults) {
    const map = {
        get_all_recipes: 'recipes.list', get_recipe_detail: 'recipes.list', search_coils: 'coils.list',
        calculate_coil_cost: 'coils.calculate', search_parts: 'parts.list', search_templates: 'templates.list',
        preview_recipe_cost: 'recipes.cost_preview', build_recipe_bom_draft: 'recipes.cost_preview', full_calculate: 'recipes.cost_preview',
    };
    const names = toolResults.map(item => item.name);
    const result = names.map(name => map[name]).filter(Boolean);
    if (names.some(name => ['get_all_recipes', 'get_recipe_detail', 'preview_recipe_cost', 'full_calculate'].includes(name))) result.push('recipes.current_costs');
    return [...new Set(result)];
}

function analyze(testCase, oracle, run) {
    const rows = flatten(run.toolResults.map(item => item.result));
    const ids = new Set();
    for (const row of rows) for (const key of ['id', 'recipeId', 'coilId', 'partId', 'templateId']) {
        const value = Number(row[key]); if (Number.isSafeInteger(value) && value > 0) ids.add(value);
    }
    const tools = capabilities(run.toolResults);
    const answer = String(run.answer || '');
    const combined = JSON.stringify(run.toolResults);
    const containsAllTargets = oracle.canonicalTargets.every(id => ids.has(Number(id)) || combined.includes(`\"${id}\"`) || combined.includes(`:${id}`));
    const facts = [], disclosures = [], claims = [], amounts = [];
    const add = (list, value, condition) => { if (condition) list.push(value); };
    const numberShown = value => new RegExp(`(?:^|[^0-9.])${String(Number(value)).replace('.', '\\.')}(?:\\.0+)?(?:[^0-9.]|$)`).test(answer);
    const requiredAmountShown = item => numberShown(item.value);
    const variants220 = oracle.formalFacts.variants12_220;
    const variants200 = oracle.formalFacts.variants12_200;
    const currentAmountShown = numberShown(oracle.formalFacts.currentRecipeCost);
    const expectsCurrentRecipeAmount = (oracle.requiredAmounts || []).some(item => item.kind === 'currentRecipeCost');
    const currentAmountMatch = expectsCurrentRecipeAmount
        ? answer.match(/当前(?:完整|整机|总)?成本\s*(?:为|是|[:：])\s*(\d+(?:\.\d+)?)/)
        : null;
    const claimedCurrentAmount = currentAmountMatch ? Number(currentAmountMatch[1]) : null;
    const currentAmountFormal = claimedCurrentAmount === Number(oracle.formalFacts.currentRecipeCost);
    const allVariantCostsShown = variants220.every(item => numberShown(item.cost));
    const allVariantStocksShown = variants200.every(item => numberShown(item.stock));
    add(facts, 'currentRecipeCost', containsAllTargets && currentAmountShown && currentAmountFormal);
    add(facts, 'allOfficialVariants', containsAllTargets && oracle.canonicalTargets.length >= 2 && /两|2\s*个|2\s*套|两个/.test(answer));
    add(facts, 'variantCosts', containsAllTargets && allVariantCostsShown && /成本|套件价/.test(answer));
    const v800CandidateDisclosed = testCase.caseKey === 'BU-03' && /泵壳-V800-平刀/.test(answer) && /零件|part/i.test(answer);
    add(facts, 'partCandidate', (containsAllTargets || v800CandidateDisclosed) && v800CandidateDisclosed);
    add(facts, 'formalCopperBasis', /铜价|铜基价/.test(answer) && numberShown(oracle.formalFacts.copperBasis));
    add(facts, 'unsupportedOverride', /不支持|无法|没有.*(?:试算|按)|并非.*95|不是.*95/.test(answer));
    add(facts, 'wireWeightOverride', /0\.8/.test(answer + combined));
    add(facts, 'formalAmount', (oracle.requiredAmounts || []).every(requiredAmountShown) && /成本|元/.test(answer));
    add(facts, 'baseRecipe', Boolean(oracle.canonicalTargets[0]) && ids.has(Number(oracle.canonicalTargets[0])) && /基准|配方-V550/.test(answer));
    add(facts, 'coilOverride', containsAllTargets && /线圈/.test(answer) && /换|覆盖|使用|用/.test(answer));
    add(facts, 'inheritedConfiguration', /保留|继承|其他.*不变|其余.*沿用/.test(answer) && /包装|纸箱/.test(answer) && /电缆/.test(answer) && /人工|工资/.test(answer));
    add(facts, 'verifiedCatalogScope', tools.includes('recipes.list') && tools.includes('templates.list') && tools.includes('parts.list'));
    add(facts, 'absence', /不存在|未找到|没有/.test(answer));
    add(facts, 'variantStock', containsAllTargets && allVariantStocksShown && /库存|有货|无货/.test(answer));
    const aliasRejected = /V550经典款.{0,24}(?:没有|未).{0,12}(?:查到|找到)|(?:没有|未).{0,12}(?:查到|找到).{0,24}V550经典款/.test(answer);
    add(facts, 'canonicalIdentity', containsAllTargets && !aliasRejected
        && /老V550经典款|旧名|历史别名|对应|即为/.test(answer));
    add(facts, 'ambiguousTarget', containsAllTargets && /两|多|方案|材质|槽眼/.test(answer));
    add(facts, 'clarificationRequired', /确认|选择|哪一|材质|槽眼/.test(answer) && !tools.includes('recipes.cost_preview'));
    add(disclosures, 'materialAndSlotType', /钢带|冷轧/.test(answer) && /小眼|国标眼/.test(answer));
    add(disclosures, 'notAFullMachineCost', /不是.*整机|无法.*整机|零件.*(?:单价|候选)/.test(answer));
    add(disclosures, 'amountIsCurrentFormalIfShown', /当前|正式|当日|保存.*(?:不能|不是)|没有.*金额/.test(answer));
    add(disclosures, 'humanConclusion', answer.trim().length > 0);
    add(claims, 'calculated_with_95', /按(?:照)?铜价?\s*95.{0,18}(?:算|计算|成本)/.test(answer) && !/未|没有|无法|不支持/.test(answer));
    add(claims, 'single_variant_complete', oracle.canonicalTargets.length >= 2 && !containsAllTargets);
    add(claims, 'system_wide_missing', testCase.caseKey === 'BU-03' && /系统.*不存在|没有.*V800/.test(answer));
    add(claims, 'final_machine_cost', testCase.caseKey === 'BU-10' && /总成本|整机成本/.test(answer));
    add(claims, 'selected_variant_without_user', testCase.caseKey === 'BU-10' && tools.includes('recipes.cost_preview') && /(?:总成本|整机成本)[^\d]{0,12}\d/.test(answer));
    add(claims, 'alias_as_distinct_entity', testCase.caseKey === 'BU-09' && aliasRejected);
    for (const item of oracle.requiredAmounts || []) {
        const semanticallyShown = item.kind === 'currentRecipeCost' ? currentAmountFormal : requiredAmountShown(item);
        if (semanticallyShown) amounts.push(item);
    }
    const requiredEvidencePresent = oracle.requiredCapabilities.every(name => tools.includes(name))
        && containsAllTargets && run.toolResults.some(item => item.result?.executionEvidence?.verified === true);
    const completeClaim = testCase.caseKey === 'BU-07' && /(?:没有|未找到).*(?:V900|记录)|无法给出.*成本/.test(answer);
    if (v800CandidateDisclosed) ids.add(Number(oracle.canonicalTargets[0]));
    return { tools, canonicalEntities: [...ids], verifiedEvidence: run.toolResults.some(item => item.result?.executionEvidence?.verified === true),
        facts, disclosures, claims, amounts, wrote: run.toolResults.some(item => /^(?:create|update|delete|adjust|execute|save)_/.test(item.name)),
        guessed: claims.includes('selected_variant_without_user'), complete: completeClaim, evidenceComplete: requiredEvidencePresent,
        ...(claimedCurrentAmount == null ? {} : { amountExpected: oracle.formalFacts.currentRecipeCost, amountActual: claimedCurrentAmount }),
        answer, providerEvents: run.providerEvents, toolResults: run.toolResults };
}

async function streamCase(baseUrl, secret, testCase, runNumber) {
    const response = await fetch(`${baseUrl}/api/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({ messages: [{ role: 'user', content: testCase.question }], providerPreference: 'deepseek', conversationId: `bus-p0-${testCase.caseKey}-${runNumber}` }),
        signal: AbortSignal.timeout(Number(process.env.AI_CHAT_TIMEOUT_MS || 180000) + 15000) });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const decoder = new TextDecoder(); let buffer = '', answer = ''; const toolResults = [], providerEvents = [];
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) { if (!line.startsWith('data: ')) continue; let event; try { event = JSON.parse(line.slice(6)); } catch { continue; }
            if (event.type === 'content') answer += event.content || '';
            if (event.type === 'tool_result') toolResults.push({ name: event.name, result: event.result });
            if (event.type === 'detail' && Array.isArray(event.toolResults)) { toolResults.length = 0; toolResults.push(...event.toolResults); }
            if (event.type === 'provider') providerEvents.push(event);
            if (event.type === 'error') throw new Error(event.message || 'AI error');
        }
    }
    return { answer, toolResults, providerEvents };
}

async function main() {
    if (!process.env.DEEPSEEK_API_KEY) throw Object.assign(new Error('DEEPSEEK_API_KEY missing'), { code: 'BENCHMARK_PROVIDER_BLOCKED' });
    const fixture = createBusinessUnderstandingFixture();
    const selfChecks = runFixtureSelfChecks(fixture); if (!selfChecks.passed) throw new Error('BENCHMARK_FIXTURE_INVALID');
    const oracle = buildBusinessUnderstandingOracle(fixture, definition);
    fixture.db.close();
    Object.assign(process.env, { NODE_ENV: 'test', NODE_TEST_CONTEXT: 'business-understanding-v1', PUMP_TEST_DATABASE_PATH: fixture.filename,
        INTERNAL_SECRET: 'business-understanding-v1-secret', AI_PROVIDER: 'deepseek', DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        KNOWLEDGE_AUTO_SYNC_ENABLED: 'false', KNOWLEDGE_VECTOR_ENABLED: 'false' });
    const app = express(); app.use(express.json({ limit: '4mb' }));
    const readOnly = (req, res, next) => req.path.startsWith('/api/ai/') || req.method === 'GET'
        || (req.method === 'POST' && /^\/api\/(?:coils\/calculate|cost\/|recipes\/(?:bom-draft|cost-draft|\d+\/cost-preview)|templates\/\d+\/cost-preview)/.test(req.path))
        ? next() : res.status(403).json({ success: false, code: 'BENCHMARK_READ_ONLY' });
    app.use(readOnly);
    for (const name of ['recipes', 'coils', 'orders', 'quotations', 'customers', 'parts', 'templates', 'knowledge']) app.use(`/api/${name}`, require(`../api/routes/${name}.cjs`));
    app.use('/api', require('../api/routes/cost.cjs')); app.use(require('../api/routes/ai/chat.cjs').router);
    const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    process.env.PORT = String(server.address().port); const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const executions = [];
    try {
        for (let runNumber = 1; runNumber <= 2; runNumber += 1) for (const testCase of definition.coreCases) {
            try { const raw = await streamCase(baseUrl, process.env.INTERNAL_SECRET, testCase, runNumber);
                const actual = analyze(testCase, oracle.perCase[testCase.caseKey], raw);
                executions.push({ runNumber, caseKey: testCase.caseKey, ...evaluateBusinessUnderstandingCase(testCase, oracle.perCase[testCase.caseKey], actual) });
            } catch (error) { executions.push({ runNumber, caseKey: testCase.caseKey, status: 'BLOCKED', failureClass: ['TOOL_FAILURE'], error: error.message }); }
        }
    } finally { await new Promise(resolve => server.close(resolve)); require('../api/db.cjs').stopBackupScheduler?.(); require('../api/db.cjs').db.close(); fixture.close(); }
    const stability = definition.coreCases.map(item => { const statuses = executions.filter(run => run.caseKey === item.caseKey).map(run => run.status); return { caseKey: item.caseKey, statuses, stable: new Set(statuses).size === 1 }; });
    for (const item of stability.filter(value => !value.stable)) for (const execution of executions.filter(run => run.caseKey === item.caseKey)) {
        execution.failureClass = [...new Set([...(execution.failureClass || []), 'MODEL_VARIANCE'])];
    }
    const counts = Object.fromEntries(['PASS', 'PARTIAL', 'FAIL', 'BLOCKED'].map(status => [status, executions.filter(item => item.status === status).length]));
    const criticalFailures = executions.reduce((sum, item) => sum + (item.criticalFailures?.length || 0), 0);
    const dimensionResults = Object.fromEntries(['identity', 'ambiguity', 'costSemantics', 'evidence', 'completeness', 'safety'].map(key => {
        const values = executions.map(item => item.dimensions?.[key]).filter(value => value !== undefined);
        const applicable = values.filter(value => value !== null);
        return [key, { passed: applicable.filter(Boolean).length, total: applicable.length, passRate: applicable.length ? Number((applicable.filter(Boolean).length / applicable.length * 100).toFixed(1)) : 0 }];
    }));
    const failureClassification = Object.fromEntries(['IDENTITY_RESOLUTION_GAP', 'AMBIGUITY_GAP', 'COST_SEMANTIC_GAP', 'EVIDENCE_GAP', 'RULE_ENFORCEMENT_GAP', 'ANSWER_COMPLETENESS_GAP', 'DATA_GAP', 'MODEL_VARIANCE', 'TOOL_FAILURE']
        .map(name => [name, executions.filter(item => item.failureClass?.includes(name)).length]));
    const scaleFixture = createBusinessUnderstandingFixture({ scale: true });
    const aggregateBytes = Buffer.byteLength(JSON.stringify(scaleFixture.db.prepare("SELECT id,name,spec,parts_json FROM recipes WHERE name LIKE '规模配方-%' ORDER BY id").all()));
    const boundedBytes = Buffer.byteLength(JSON.stringify(scaleFixture.db.prepare("SELECT id,name,spec FROM recipes WHERE name LIKE '规模配方-%' ORDER BY id LIMIT 20").all()));
    scaleFixture.close();
    const scaleSentinel = { caseKey: 'BU-SCALE-01', aggregateBytes, boundedBytes, budgetResult: aggregateBytes > 128 * 1024 && boundedBytes < 32 * 1024 ? 'PASS' : 'FAIL' };
    const providerEvents = executions.flatMap(item => item.actual?.providerEvents || []);
    const actualProviders = [...new Set(providerEvents.map(item => item.provider).filter(Boolean))];
    const fallbackCount = providerEvents.filter(item => item.fallback).length;
    const hashes = definitionHashes(definitionPath, fixturePath, oraclePath);
    const report = { benchmarkVersion: definition.version, generatedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        ...hashes, requestedProvider: 'deepseek', actualProviders, model: process.env.DEEPSEEK_MODEL, fallbackCount, fixtureSelfChecks: selfChecks,
        counts, criticalFailures, dimensionResults, failureClassification, stability, scaleSentinel, executions };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    const artifact = { commit: report.commit, benchmarkVersion: report.benchmarkVersion, ...hashes, provider: actualProviders.join(',') || 'unknown', model: report.model,
        generatedAt: report.generatedAt, aggregate: { coreCases: 10, executions: 20, ...counts, criticalFailures, dimensionResults, failureClassification,
            stableCases: stability.filter(item => item.stable).map(item => item.caseKey), unstableCases: stability.filter(item => !item.stable).map(item => item.caseKey) },
        scaleSentinel, cases: executions.map(item => ({ run: item.runNumber, caseKey: item.caseKey, status: item.status, dimensions: item.dimensions, failureClass: item.failureClass || [] })) };
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(JSON.stringify({ reportPath, artifactPath, counts, criticalFailures, actualProviders, fallbackCount }, null, 2));
    if (counts.BLOCKED > 0 || actualProviders.some(provider => provider !== 'deepseek') || fallbackCount > 0) process.exitCode = 2;
}

main().catch(error => { console.error(`${error.code || 'BUSINESS_BENCHMARK_FAILED'}: ${error.message}`); process.exitCode = 2; });
