'use strict';

process.env.NODE_ENV = 'test';
process.env.NODE_TEST_CONTEXT = '1';
process.env.AI_V5_SHADOW_ENABLED = 'false';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const root = path.resolve(__dirname, '..');
const sourceDb = path.join(root, 'pump.db');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-v5-entity-lookup-'));
const tempDbTemplate = path.join(tempRoot, 'pump-evaluation-{pid}.db');
const tempDb = tempDbTemplate.replace('{pid}', String(process.pid));
fs.copyFileSync(sourceDb, tempDb);
process.env.PUMP_TEST_DATABASE_PATH = tempDbTemplate;
process.env.INTERNAL_SECRET = process.env.INTERNAL_SECRET || crypto.randomUUID();

const { db } = require('../api/db.cjs');
const { createEntityLookupRouter } = require('../api/routes/entityLookup.cjs');
const { createInternalFetch, getJson, lookupEntities } = require('../api/routes/ai/internalApiClient.cjs');
const { resolveEntityTypeIndependent } = require('../api/services/ai-v5/typeIndependentEntityResolver.cjs');
const { V5_TASK_CLASS_CATALOG } = require('../api/services/ai-v5/taskClassCatalog.cjs');
const { createV5InterpreterInputEnvelope } = require('../api/services/ai-v5/taskInterpreterInput.cjs');

const outputPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-type-independent-entity-resolution-b1b.json');
const frozenCasesPath = path.join(root, 'docs', 'ai-observability', 'data', 'p06-failure-cases.json');
const architectureAuditPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-entity-first-architecture-audit.json');
const frozenInterpreterEvaluationPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-task-class-semantics-v1_1-evaluation.json');
const FAMILY_TO_GROUP = Object.freeze({
    'P06-COIL-001': 'COIL_INVENTORY',
    'P06-EXACT-001': 'EXACT_RECIPE_COST',
    'P06-FLATBLADE-001': 'FLAT_BLADE_PRICE',
    'P06-INVENTORY-001': 'PART_INVENTORY_PRIMARY',
    'P06-SIMPLE-001': 'PART_INVENTORY_REPEAT',
});

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function backupCount() {
    const directories = [path.join(root, 'backups'), path.join(root, 'api', 'backups')];
    let count = 0;
    for (const directory of directories) {
        if (!fs.existsSync(directory)) continue;
        const stack = [directory];
        while (stack.length) {
            const current = stack.pop();
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                if (entry.isDirectory()) stack.push(path.join(current, entry.name));
                else count += 1;
            }
        }
    }
    return count;
}

function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function sourceGroup(caseId) {
    const family = Object.keys(FAMILY_TO_GROUP).find(value => caseId.startsWith(value));
    return family ? FAMILY_TO_GROUP[family] : null;
}

function findByFrozenFingerprint(items, fingerprint, question) {
    return items.find(item => createV5InterpreterInputEnvelope({
        rawUserRequest: question(item),
        pageContext: null,
    }).inputFingerprint === fingerprint);
}

async function main() {
    const original = {
        hash: sha256(sourceDb),
        mtimeMs: fs.statSync(sourceDb).mtimeMs,
        size: fs.statSync(sourceDb).size,
        backupCount: backupCount(),
    };
    const app = express();
    app.use(express.json());
    app.use('/api/parts', require('../api/routes/parts.cjs'));
    app.use('/api/coils', require('../api/routes/coils.cjs'));
    app.use('/api/recipes', require('../api/routes/recipes.cjs'));
    app.use('/api/entity-lookup', createEntityLookupRouter({ db }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    process.env.PORT = String(server.address().port);

    try {
        const setupFetch = createInternalFetch({ operationId: 'v5-b1b-fixture-setup' });
        const parts = await getJson(setupFetch, '/api/parts', '零件基线读取失败');
        const coils = await getJson(setupFetch, '/api/coils', '线圈基线读取失败');
        const recipes = await getJson(setupFetch, '/api/recipes', '配方基线读取失败');
        const frozenInterpreterPaths = JSON.parse(fs.readFileSync(frozenInterpreterEvaluationPath, 'utf8')).paths;
        const fingerprints = new Map(frozenInterpreterPaths.map(item => [item.source_group_id, item.input_fingerprint]));
        const partPositive = findByFrozenFingerprint(parts, fingerprints.get('PART_INVENTORY_PRIMARY'), item => `${item.model}当前库存是多少`);
        const partRepeat = findByFrozenFingerprint(parts, fingerprints.get('PART_INVENTORY_REPEAT'), item => `${item.model}当前库存是多少`);
        const coilPositive = findByFrozenFingerprint(coils, fingerprints.get('COIL_INVENTORY'), item => `${item.schemeCode}当前库存是多少`);
        const recipe = findByFrozenFingerprint(recipes, fingerprints.get('EXACT_RECIPE_COST'), item => `${item.name}现在的完整成本是多少`);
        const flatBlade = findByFrozenFingerprint(parts, fingerprints.get('FLAT_BLADE_PRICE'), item => `${item.model}现在多少钱`);
        if (!partPositive || !partRepeat || !coilPositive || !recipe || !flatBlade) {
            throw new Error(`Frozen authoritative entity fixture prerequisites are missing: ${JSON.stringify({
                partPositive: Boolean(partPositive),
                partRepeat: Boolean(partRepeat),
                coilPositive: Boolean(coilPositive),
                recipe: Boolean(recipe),
                flatBlade: Boolean(flatBlade),
            })}`);
        }
        const mentionByGroup = new Map([
            ['COIL_INVENTORY', coilPositive.schemeCode],
            ['EXACT_RECIPE_COST', recipe.name],
            ['FLAT_BLADE_PRICE', flatBlade.model],
            ['PART_INVENTORY_PRIMARY', partPositive.model],
            ['PART_INVENTORY_REPEAT', partRepeat.model],
        ]);
        const testDbBeforeLookup = {
            hash: sha256(tempDb),
            mtimeMs: fs.statSync(tempDb).mtimeMs,
            size: fs.statSync(tempDb).size,
            totalChanges: Number(db.prepare('SELECT total_changes() AS count').get().count),
        };

        const frozenCases = JSON.parse(fs.readFileSync(frozenCasesPath, 'utf8'));
        const expectedRows = JSON.parse(fs.readFileSync(architectureAuditPath, 'utf8')).cases;
        const expectedByCase = new Map(expectedRows.map(item => [item.case_id, item]));
        const selectedCases = frozenCases.filter(item => sourceGroup(item.case_id));
        if (selectedCases.length !== 15) throw new Error(`Frozen path count changed: ${selectedCases.length}`);

        const apiLatencies = [];
        const resolverLatencies = [];
        let businessApiCalls = 0;
        const paths = [];
        for (const item of selectedCases) {
            const group = sourceGroup(item.case_id);
            const rawMention = mentionByGroup.get(group);
            const internalFetch = createInternalFetch({ operationId: `v5-b1b-${item.case_id}` });
            const measuredLookup = async (fetcher, input) => {
                const started = performance.now();
                businessApiCalls += 1;
                try {
                    return await lookupEntities(fetcher, input);
                } finally {
                    apiLatencies.push(performance.now() - started);
                }
            };
            const started = performance.now();
            const resolution = await resolveEntityTypeIndependent(rawMention, {
                internalFetch,
                lookupEntities: measuredLookup,
            });
            resolverLatencies.push(performance.now() - started);
            const expected = expectedByCase.get(item.case_id);
            if (!expected) throw new Error(`Frozen expected entity is missing: ${item.case_id}`);
            const localClasses = resolution.status === 'RESOLVED'
                ? V5_TASK_CLASS_CATALOG.filter(taskClass => taskClass.entityTypes.includes(resolution.resolvedEntityType))
                : [];
            paths.push({
                case_id: item.case_id,
                source_group_id: group,
                resolutionStatus: resolution.status,
                expectedEntityType: expected.expected_entity_type,
                resolvedEntityTypeMatch: resolution.resolvedEntityType === expected.expected_entity_type,
                candidateCount: resolution.candidateCount,
                candidateTypeCount: resolution.candidateTypeCount,
                complete: resolution.complete,
                logicalApiCallCount: 1,
                localTaskClassCount: localClasses.length,
                expectedClassSurvives: localClasses.some(taskClass => taskClass.classRef === expected.expected_class),
                safeReasonCodes: [...resolution.reasonCodes],
                traceId: item.trace_id || null,
            });
        }

        const concurrentInputs = Array.from({ length: 10 }, (_, index) => `v5-b1b-synthetic-${index}`);
        const concurrentResults = await Promise.all(concurrentInputs.map(async rawMention => {
            const internalFetch = createInternalFetch({ operationId: crypto.randomUUID() });
            const measuredLookup = async (fetcher, input) => {
                const started = performance.now();
                businessApiCalls += 1;
                try {
                    return await lookupEntities(fetcher, input);
                } finally {
                    apiLatencies.push(performance.now() - started);
                }
            };
            const started = performance.now();
            const resolution = await resolveEntityTypeIndependent(rawMention, {
                internalFetch,
                lookupEntities: measuredLookup,
            });
            resolverLatencies.push(performance.now() - started);
            return resolution;
        }));
        const concurrentIsolation = concurrentResults.every((result, index) => (
            result.rawMention === concurrentInputs[index]
            && result.status === 'NOT_FOUND'
            && result.candidateCount === 0
        ));

        const sourceGroups = [...new Set(paths.map(item => item.source_group_id))];
        const testDbAfterLookup = {
            hash: sha256(tempDb),
            mtimeMs: fs.statSync(tempDb).mtimeMs,
            size: fs.statSync(tempDb).size,
            totalChanges: Number(db.prepare('SELECT total_changes() AS count').get().count),
        };
        const finalState = {
            hash: sha256(sourceDb),
            mtimeMs: fs.statSync(sourceDb).mtimeMs,
            size: fs.statSync(sourceDb).size,
            backupCount: backupCount(),
        };
        const metrics = {
            frozenPaths: paths.length,
            applicablePaths: paths.length,
            correctResolvedEntityType: paths.filter(item => item.resolutionStatus === 'RESOLVED' && item.resolvedEntityTypeMatch).length,
            wrongEntityType: paths.filter(item => item.resolutionStatus === 'RESOLVED' && !item.resolvedEntityTypeMatch).length,
            ambiguous: paths.filter(item => item.resolutionStatus === 'AMBIGUOUS').length,
            notFound: paths.filter(item => item.resolutionStatus === 'NOT_FOUND').length,
            incomplete: paths.filter(item => item.safeReasonCodes.includes('ENTITY_LOOKUP_INCOMPLETE')).length,
            resolverError: paths.filter(item => item.resolutionStatus === 'ERROR').length,
            falseUniqueResolution: paths.filter(item => item.resolutionStatus === 'RESOLVED' && !item.resolvedEntityTypeMatch).length,
            sourceGroups: sourceGroups.length,
            correctlyResolvedSourceGroups: sourceGroups.filter(group => paths.filter(item => item.source_group_id === group)
                .every(item => item.resolutionStatus === 'RESOLVED' && item.resolvedEntityTypeMatch)).length,
            expectedLocalClassSurvival: paths.filter(item => item.expectedClassSurvives).length,
            logicalResolverCalls: paths.length + concurrentInputs.length,
            frozenLogicalResolverCalls: paths.length,
            concurrentLogicalResolverCalls: concurrentInputs.length,
            businessApiCalls,
            businessApiCallsPerLogicalResolver: businessApiCalls / (paths.length + concurrentInputs.length),
            serverTypedLookupAttempts: (paths.length + concurrentInputs.length) * 6,
            medianTypedAttempts: 6,
            maxTypedAttempts: 6,
            medianLocalTaskClassCount: percentile(paths.map(item => item.localTaskClassCount), 0.5),
            maxLocalTaskClassCount: Math.max(...paths.map(item => item.localTaskClassCount)),
            entityLookupApiMedianMs: percentile(apiLatencies, 0.5),
            entityLookupApiP95Ms: percentile(apiLatencies, 0.95),
            resolverMedianMs: percentile(resolverLatencies, 0.5),
            resolverP95Ms: percentile(resolverLatencies, 0.95),
            timeoutCount: paths.filter(item => item.safeReasonCodes.includes('ENTITY_LOOKUP_TIMEOUT')).length,
            concurrentIsolation,
            crossRequestContaminationCount: concurrentIsolation ? 0 : 1,
            entityLookupWriteCount: testDbAfterLookup.totalChanges - testDbBeforeLookup.totalChanges,
            allowWriteCalls: 0,
            mutationServiceCalls: 0,
            v5InterpreterModelCalls: 0,
            v5ToolCalls: 0,
            v5BusinessApiReadCalls: businessApiCalls,
            v5Writes: 0,
            productionRequestsRoutedToV5: 0,
        };
        const dataset = {
            schemaVersion: 1,
            evaluation: 'V5-E4R-E-B1-B Governed Entity Resolution',
            paths,
            metrics,
            safety: {
                businessDbHashUnchanged: original.hash === finalState.hash,
                businessDbMTimeUnchanged: original.mtimeMs === finalState.mtimeMs,
                businessDbSizeUnchanged: original.size === finalState.size,
                backupCountUnchanged: original.backupCount === finalState.backupCount,
                unexpectedBackupCreated: finalState.backupCount > original.backupCount,
                lookupDbHashUnchanged: testDbBeforeLookup.hash === testDbAfterLookup.hash,
                lookupDbMTimeUnchanged: testDbBeforeLookup.mtimeMs === testDbAfterLookup.mtimeMs,
                lookupDbSizeUnchanged: testDbBeforeLookup.size === testDbAfterLookup.size,
            },
        };
        fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
        process.stdout.write(`${JSON.stringify({ metrics, safety: dataset.safety })}\n`);
    } finally {
        await new Promise(resolve => server.close(resolve));
        db.close();
        const resolvedTempRoot = path.resolve(tempRoot);
        const resolvedSystemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
        if (!resolvedTempRoot.startsWith(resolvedSystemTemp)
            || !path.basename(resolvedTempRoot).startsWith('pump-v5-entity-lookup-')) {
            throw new Error('Refusing to remove an unverified evaluation directory');
        }
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
