'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { CASES } = require('./cases.cjs');
const { loadContextSources } = require('./contextSources.cjs');
const { executeCase } = require('./orchestrator.cjs');
const { evaluateRun } = require('./evaluate.cjs');

const root = path.resolve(__dirname, '../../..');
const repeats = new Set(['CTX-02', 'CTX-03', 'CTX-04', 'CTX-05', 'CTX-06', 'CTX-10', 'CTX-11', 'ADV-04']);
const env = { ...process.env, ...(fs.existsSync(path.join(root, '.env')) ? dotenv.parse(fs.readFileSync(path.join(root, '.env'), 'utf8')) : {}) };
env.DEEPSEEK_MODEL = 'deepseek-chat';
function median(values) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function summarize(runs) {
    const fields = ['businessContextMs', 'ontologyContextMs', 'parallelContextTotalMs', 'intentMs', 'totalMs'];
    const timingMedians = Object.fromEntries(fields.map(field => [field, Math.round(median(runs.map(run => run.timings[field])))]));
    const results = runs.map(run => ({ ...run, evaluation: evaluateRun(run) }));
    const counts = Object.fromEntries(['PASS', 'PARTIAL', 'FAIL'].map(status => [status, results.filter(run => run.evaluation.overall === status).length]));
    const stability = Object.fromEntries([...repeats].map(id => {
        const items = results.filter(run => run.id === id);
        const stable = items.length === 2 && items[0].intentMemo === items[1].intentMemo;
        return [id, { status: stable ? 'STABLE' : 'VARIANT', run1Intent: items[0]?.intentMemo || '', run2Intent: items[1]?.intentMemo || '' }];
    }));
    return { results, counts, criticalFailures: results.filter(run => run.evaluation.criticalFailure).length, timingMedians, stability,
        metrics: Object.fromEntries(['businessContextRelevance', 'policyRelevance', 'ontologyContextRelevance', 'noFormalFactHallucination', 'intentCompleteness', 'intentBoundary', 'languageFidelity'].map(key => [key, results.every(run => run.evaluation.dimensions[key]) ? 'PASS' : 'FAIL'])),
        contextAgentsParallel: results.every(run => run.parallelProof.intervalsOverlap) ? 'YES' : 'NO', modelCalls: results.length * 3 };
}
async function main() {
    const sources = loadContextSources();
    const cases = [...CASES, ...CASES.filter(testCase => repeats.has(testCase.id)).map(testCase => ({ ...testCase, run: 2 }))];
    const runs = [];
    for (const testCase of cases) {
        const beganAt = new Date().toISOString();
        try { runs.push({ ...(await executeCase(testCase, sources, { env })), beganAt, error: null }); }
        catch (error) { runs.push({ id: testCase.id, run: testCase.run || 1, userInput: testCase.userInput, recentConversation: testCase.recentConversation || '', beganAt, error: error?.stack || String(error), timings: null, parallelProof: null }); }
        process.stderr.write(`Completed ${runs.length}/${cases.length}: ${testCase.id} run ${testCase.run || 1}\n`);
    }
    const completed = runs.filter(run => !run.error);
    const summary = summarize(completed);
    const result = { title: 'M4-2D Context-First Intent first smoke run', startedAt: runs[0]?.beganAt || null, finishedAt: new Date().toISOString(),
        provider: 'DeepSeek', model: env.DEEPSEEK_MODEL, plannedRuns: 24, completedRuns: completed.length, modelCalls: summary.modelCalls,
        contextSourceMetadata: { businessModelSource: sources.businessModelSource, policySource: sources.policySource,
            policySourceVersion: sources.policyVersion, policyCurrentPublishedVersionVerified: false,
            policyVerificationNote: 'Local pump.db has no domain_policy_versions table; used the checked-in runtime bootstrap policy text without accessing business records.',
            ontologySources: sources.ontologySources, ontologyCharacters: sources.ontologyText.length },
        parallelContextTotalDefinition: 'Wall time from Promise.all dispatch until both Business and Ontology memos resolve.',
        timingMedians: summary.timingMedians, contextAgentsParallel: summary.contextAgentsParallel,
        aggregateCounts: summary.counts, criticalFailures: summary.criticalFailures, stability: summary.stability, rubric: summary.metrics,
        errors: runs.filter(run => run.error).map(({ id, run, error }) => ({ id, run, error })), results: summary.results };
    const outputDir = path.join(__dirname, 'results'); fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'M4-2D-smoke-results.json'); fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ outputPath, completedRuns: result.completedRuns, modelCalls: result.modelCalls,
        contextAgentsParallel: result.contextAgentsParallel, timingMedians: result.timingMedians, aggregateCounts: result.aggregateCounts,
        criticalFailures: result.criticalFailures, errors: result.errors.length }, null, 2)}\n`);
}
main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
