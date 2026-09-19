require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const projectRoot = path.resolve(__dirname, '..');
const reportPath = path.join(projectRoot, 'output', 'ai-r4b-shadow-latest.json');

function cliValue(name) {
    const inline = process.argv.find(value => value.startsWith(`${name}=`));
    return inline ? inline.slice(name.length + 1) : '';
}

function writeUnavailableReport(code) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify({
        schemaVersion: 1,
        suite: 'r4b_read_shadow_comparison',
        generatedAt: new Date().toISOString(),
        realProvider: false,
        status: 'INCOMPLETE',
        rolloutReadiness: { ready: false, blocker: code },
        cases: [],
    }, null, 2)}\n`, 'utf8');
}

async function snapshotDatabase(source, destination) {
    const db = new Database(source, { readonly: true, fileMustExist: true });
    try {
        await db.backup(destination);
    } finally {
        db.close();
    }
}

function fileFingerprint(file) {
    const hash = createHash('sha256');
    hash.update(fs.readFileSync(file));
    return `sha256:${hash.digest('hex').slice(0, 24)}`;
}

async function parentMain() {
    const source = path.resolve(process.env.PUMP_SHADOW_SOURCE_DATABASE_PATH || path.join(projectRoot, 'pump.db'));
    if (!fs.existsSync(source) || !process.env.DEEPSEEK_API_KEY) {
        writeUnavailableReport(!fs.existsSync(source) ? 'SHADOW_SOURCE_DATABASE_UNAVAILABLE' : 'AI_PROVIDER_UNAVAILABLE');
        process.exitCode = 2;
        return;
    }
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-r4b-shadow-'));
    const snapshot = path.join(tempRoot, 'pump-shadow.db');
    try {
        await snapshotDatabase(source, snapshot);
        const result = spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], {
            cwd: projectRoot,
            env: {
                ...process.env,
                NODE_ENV: 'test',
                NODE_TEST_CONTEXT: 'r4b-shadow',
                DB_BACKUP_DIR: path.join(tempRoot, 'backups'),
                PUMP_TEST_DATABASE_PATH: path.join(tempRoot, 'pump-shadow-{pid}.db'),
                PUMP_SHADOW_BASE_SNAPSHOT: snapshot,
                PUMP_SHADOW_DATABASE_FINGERPRINT: fileFingerprint(snapshot),
            },
            stdio: 'inherit',
        });
        if (result.error) throw result.error;
        process.exitCode = result.status ?? 1;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

async function workerMain() {
    if (process.env.NODE_ENV !== 'test' || !process.env.PUMP_TEST_DATABASE_PATH) {
        throw new Error('R4-B worker 必须使用隔离数据库快照');
    }
    const isolatedPath = path.resolve(
        String(process.env.PUMP_TEST_DATABASE_PATH).replaceAll('{pid}', String(process.pid))
    );
    fs.copyFileSync(process.env.PUMP_SHADOW_BASE_SNAPSHOT, isolatedPath);
    const fixtureDb = new Database(isolatedPath);
    try {
        const positiveCoil = fixtureDb.prepare('SELECT id FROM coils ORDER BY id LIMIT 1 OFFSET 1').get()
            || fixtureDb.prepare('SELECT id FROM coils ORDER BY id LIMIT 1').get();
        if (positiveCoil) fixtureDb.prepare('UPDATE coils SET stock = ? WHERE id = ?').run(7, positiveCoil.id);
    } finally {
        fixtureDb.close();
    }
    const express = require('express');
    const costRouter = require('../api/routes/cost.cjs');
    const coilsRouter = require('../api/routes/coils.cjs');
    const partsRouter = require('../api/routes/parts.cjs');
    const recipesRouter = require('../api/routes/recipes.cjs');
    const templatesRouter = require('../api/routes/templates.cjs');
    const { stopBackupScheduler } = require('../api/db.cjs');
    const { runAiAgentRuntimeV3 } = require('../api/services/aiAgentRuntimeV3.cjs');
    const { createArchitectureAcceptanceCase } = require('../api/services/aiArchitectureAcceptanceV4.cjs');
    const {
        CURRENT_INVENTORY_SCENARIO,
        INVENTORY_ENTITY_CONTRACTS,
        INVENTORY_QUANTITY_CLAIM_PREDICATE,
        INVENTORY_QUANTITY_PREDICATE,
    } = require('../api/services/aiNumericScalarFactsV4.cjs');
    const { runShadowComparisonSuite } = require('../api/services/aiShadowComparisonV4.cjs');

    const app = express();
    app.use(express.json());
    app.use('/api', costRouter);
    app.use('/api/coils', coilsRouter);
    app.use('/api/parts', partsRouter);
    app.use('/api/recipes', recipesRouter);
    app.use('/api/templates', templatesRouter);
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    process.env.PORT = String(server.address().port);
    try {
        const apiData = async (url, options) => {
            const response = await fetch(`${baseUrl}${url}`, options);
            const payload = await response.json();
            if (!response.ok || payload.success === false) {
                throw Object.assign(new Error(`formal API failed: ${url}`), { code: 'SHADOW_FORMAL_API_FAILED' });
            }
            return payload.data;
        };
        const parts = await apiData('/api/parts');
        const coils = await apiData('/api/coils');
        const recipes = await apiData('/api/recipes');
        const currentCostsResponse = await apiData('/api/recipes/current-costs');
        const currentCosts = Array.isArray(currentCostsResponse?.items) ? currentCostsResponse.items : [];
        const partPositive = parts.find(item => String(item.model || '').trim() && Number(item.stock) > 0);
        const partZero = parts.find(item => String(item.model || '').trim() && Number(item.stock) === 0);
        const coilPositive = coils.find(item => String(item.schemeCode || '').trim() && Number(item.stock) > 0);
        const coilZero = coils.find(item => String(item.schemeCode || '').trim() && Number(item.stock) === 0);
        const flatKnife = parts.find(item => item.model === '800平刀切割泵壳');
        const recipe = recipes.find(item => currentCosts.some(cost => String(cost.recipeId ?? cost.id) === String(item.id)));
        const currentCost = recipe
            ? currentCosts.find(item => String(item.recipeId ?? item.id) === String(recipe.id))
            : null;
        const recipeDetail = recipe ? await apiData(`/api/recipes/${recipe.id}`) : null;

        const inventoryCase = ({ caseKey, entityType, row, question, tags = [], repeatGroup = null }) => ({
            testCase: createArchitectureAcceptanceCase({
                caseKey,
                domain: entityType,
                userQuestion: question || (row
                    ? `${entityType === 'part' ? row.model : row.schemeCode}当前库存是多少`
                    : '当前库存是多少'),
                mode: 'query',
                entityScope: 'single',
                oracleBuilder: async () => row
                    ? { status: 'ready', row }
                    : { status: 'prerequisite_missing' },
                requiredFacts: [{
                    entityType, predicate: INVENTORY_QUANTITY_PREDICATE,
                    temporalScope: 'current', scenario: CURRENT_INVENTORY_SCENARIO,
                    qualifiers: {},
                }],
                expectedClaims: async ({ oracle }) => [{
                    claimType: 'scalar_value',
                    subject: { entityType, entityId: String(oracle.row.id) },
                    predicate: INVENTORY_QUANTITY_CLAIM_PREDICATE,
                    value: oracle.row.stock,
                    unit: INVENTORY_ENTITY_CONTRACTS[entityType].unit,
                    temporalScope: 'current',
                    scenario: CURRENT_INVENTORY_SCENARIO,
                    qualifiers: {},
                    evidenceClasses: ['live_business'],
                    sourceOfTruth: entityType === 'part' ? 'partsService' : 'coilService',
                }],
                allowedCapabilityClasses: ['query'],
                requiredEvidenceClasses: ['live_business'],
                terminalState: 'completed',
                semanticRequirements: { evidencePreserved: true },
                writeBoundary: 'read_only',
            }),
            shadow: { repeatGroup, tags },
        });

        const priceCase = ({ caseKey, row, repeatGroup = null, tags = [] }) => ({
            testCase: createArchitectureAcceptanceCase({
                caseKey,
                domain: 'part',
                userQuestion: row ? `${row.model}现在多少钱` : '指定零件现在多少钱',
                mode: 'query', entityScope: 'single',
                oracleBuilder: async () => row ? { status: 'ready', row } : { status: 'prerequisite_missing' },
                requiredFacts: [{ entityType: 'part', predicate: 'currentScalar', temporalScope: 'current', scenario: 'catalog_current', qualifiers: {} }],
                expectedClaims: async ({ oracle }) => [{
                    claimType: 'scalar_value', subject: { entityType: 'part', entityId: String(oracle.row.id) },
                    predicate: 'price.current', value: oracle.row.price, unit: 'CNY',
                    temporalScope: 'current', scenario: 'catalog_current', qualifiers: {},
                    evidenceClasses: ['live_business'], sourceOfTruth: 'partsService',
                }],
                allowedCapabilityClasses: ['query'], requiredEvidenceClasses: ['live_business'],
                terminalState: 'completed', semanticRequirements: { evidencePreserved: true }, writeBoundary: 'read_only',
            }),
            shadow: { repeatGroup, tags },
        });

        const currentCostValue = currentCost?.currentTotalCost ?? currentCost?.unitCost ?? null;
        const savedCostValue = recipeDetail?.savedTotalCost ?? null;
        const costCase = ({ caseKey, includeSaved = false, repeatGroup, tags = [], detailed = false }) => ({
            testCase: createArchitectureAcceptanceCase({
                caseKey,
                domain: 'cost',
                userQuestion: recipe
                    ? includeSaved
                        ? `${recipe.name}的当前成本和已保存成本分别是多少${detailed ? '，请详细比较并说明' : ''}`
                        : `${recipe.name}现在的完整成本是多少`
                    : '指定配方成本是多少',
                mode: includeSaved ? 'analysis' : 'query', entityScope: 'single',
                oracleBuilder: async () => recipe && Number.isFinite(Number(currentCostValue))
                    && (!includeSaved || Number.isFinite(Number(savedCostValue)))
                    ? { status: 'ready', recipe, currentCostValue, savedCostValue }
                    : { status: 'prerequisite_missing' },
                requiredFacts: [
                    { entityType: 'recipe', predicate: 'currentRecipeCost', temporalScope: 'current', scenario: 'current_recipe_cost', qualifiers: {} },
                    ...(includeSaved ? [{ entityType: 'recipe', predicate: 'savedRecipeCostSnapshot', temporalScope: 'saved_snapshot', scenario: 'saved_recipe_snapshot', qualifiers: {} }] : []),
                ],
                expectedClaims: async ({ oracle }) => [{
                    claimType: 'scalar_value', subject: { entityType: 'recipe', entityId: String(oracle.recipe.id) },
                    predicate: 'cost.current.recipe', value: oracle.currentCostValue, unit: 'CNY',
                    temporalScope: 'current', scenario: 'current_recipe_cost', qualifiers: {},
                    evidenceClasses: ['live_business'], sourceOfTruth: 'costEngine',
                }, ...(includeSaved ? [{
                    claimType: 'scalar_value', subject: { entityType: 'recipe', entityId: String(oracle.recipe.id) },
                    predicate: 'cost.saved.snapshot', value: oracle.savedCostValue, unit: 'CNY',
                    temporalScope: 'saved_snapshot', scenario: 'saved_recipe_snapshot', qualifiers: {},
                    evidenceClasses: ['historical_snapshot'], sourceOfTruth: 'recipeServiceAndCostEngine',
                }] : [])],
                allowedCapabilityClasses: ['query', 'preview'],
                requiredEvidenceClasses: includeSaved ? ['live_business', 'historical_snapshot'] : ['live_business'],
                terminalState: 'completed', semanticRequirements: { evidencePreserved: true }, writeBoundary: 'read_only',
            }),
            shadow: { repeatGroup, tags },
        });

        const ambiguityRows = coils.filter(item => item.spec === '12' && Number(item.sheets) === 200);
        const ambiguityCase = run => ({
            testCase: createArchitectureAcceptanceCase({
                caseKey: `coil-inventory-ambiguous-${run}`,
                domain: 'coil', userQuestion: '12-200线圈当前库存是多少', mode: 'query', entityScope: 'single',
                oracleBuilder: async () => ambiguityRows.length > 1
                    ? { status: 'ready', rows: ambiguityRows }
                    : { status: 'prerequisite_missing' },
                requiredFacts: [{ entityType: 'coil', predicate: INVENTORY_QUANTITY_PREDICATE, temporalScope: 'current', scenario: CURRENT_INVENTORY_SCENARIO, qualifiers: {} }],
                expectedClaims: async ({ oracle }) => [{
                    claimType: 'ambiguous', subject: { entityType: 'coil', entityId: null },
                    predicate: INVENTORY_QUANTITY_PREDICATE,
                    value: oracle.rows.map(item => ({ entityType: 'coil', entityId: item.id, canonicalName: item.schemeName || `${item.spec}-${item.sheets}` })),
                    unit: null, temporalScope: 'current', scenario: CURRENT_INVENTORY_SCENARIO, qualifiers: {},
                    evidenceClasses: [], sourceOfTruth: 'coilService',
                }],
                allowedCapabilityClasses: ['query'], terminalState: 'needs_clarification',
                semanticRequirements: { ambiguityExpected: true }, writeBoundary: 'read_only',
            }),
            shadow: { repeatGroup: 'ambiguous', tags: ['ambiguous'] },
        });

        const cases = [
            inventoryCase({ caseKey: 'part-current-stock-real-provider', entityType: 'part', row: partPositive, tags: ['inventory_numeric'] }),
            inventoryCase({ caseKey: 'part-zero-stock-real-provider', entityType: 'part', row: partZero, tags: ['inventory_numeric', 'zero_inventory'] }),
            inventoryCase({ caseKey: 'coil-current-stock-real-provider', entityType: 'coil', row: coilPositive, tags: ['inventory_numeric'] }),
            inventoryCase({ caseKey: 'coil-zero-stock-real-provider', entityType: 'coil', row: coilZero, tags: ['inventory_numeric', 'zero_inventory'] }),
            inventoryCase({ caseKey: 'coil-quantity-with-scheme-status', entityType: 'coil', row: coilZero, question: coilZero ? `${coilZero.schemeCode}线圈当前库存是多少套` : null, tags: ['inventory_numeric', 'quantity_status_coexist'] }),
        ];
        for (let run = 1; run <= 5; run += 1) {
            cases.push(
                inventoryCase({ caseKey: `simple-current-${run}`, entityType: 'part', row: partPositive, repeatGroup: 'simple_current', tags: ['simple_current'] }),
                ambiguityCase(run),
                costCase({ caseKey: `current-cost-${run}`, repeatGroup: 'current_cost', tags: ['current_cost'] }),
                costCase({ caseKey: `current-saved-${run}`, includeSaved: true, repeatGroup: 'current_saved', tags: ['current_saved'] }),
                costCase({ caseKey: `complex-renderer-${run}`, includeSaved: true, detailed: true, repeatGroup: 'complex_renderer', tags: ['complex_renderer'] }),
                priceCase({ caseKey: `flat-knife-800-${run}`, row: flatKnife, repeatGroup: 'flat_knife_800', tags: ['flat_knife_800'] }),
            );
        }
        const requestedCase = cliValue('--case-key');
        const selectedCases = requestedCase
            ? cases.filter(item => item.testCase.caseKey === requestedCase)
            : cases;
        if (requestedCase && selectedCases.length === 0) {
            throw Object.assign(new Error('未知 R4-B case key'), { code: 'SHADOW_CASE_NOT_FOUND' });
        }
        const report = await runShadowComparisonSuite({
            cases: selectedCases,
            executePath: ({ testCase: item, env, allowWrite }) => runAiAgentRuntimeV3({
                messages: [{ role: 'user', content: item.userQuestion }],
                agentVersion: 3,
                env,
                allowWrite,
                requestId: `shadow:${item.caseKey}`,
            }),
            baseEnv: process.env,
            databaseSnapshot: process.env.PUMP_SHADOW_DATABASE_FINGERPRINT,
            gitCommit: process.env.GIT_COMMIT || '',
            realProvider: true,
        });
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        process.stdout.write(`${JSON.stringify({
            status: report.status,
            blocker: report.rolloutReadiness.blocker,
            caseCount: report.cases.length,
            comparisons: report.metrics?.comparisons || null,
            oracleRates: Object.fromEntries(Object.entries(report.metrics?.paths || {}).map(([key, value]) => [key, value.oraclePassRate])),
        }, null, 2)}\n`);
        process.exitCode = report.status === 'PASS' ? 0 : report.status === 'INCOMPLETE' ? 2 : 1;
    } finally {
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(() => resolve()));
        stopBackupScheduler();
        costRouter.stopCopperPriceScheduler?.();
        partsRouter.stopCopperPriceScheduler?.();
    }
}

if (process.argv.includes('--worker')) {
    workerMain().catch(error => {
        writeUnavailableReport(String(error?.code || 'SHADOW_RUNNER_FAILED'));
        console.error(error?.message || String(error));
        process.exitCode = 2;
    });
} else {
    parentMain().catch(error => {
        writeUnavailableReport(String(error?.code || 'SHADOW_RUNNER_FAILED'));
        console.error(error?.message || String(error));
        process.exitCode = 2;
    });
}
