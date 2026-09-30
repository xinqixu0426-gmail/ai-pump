'use strict';

const { performance } = require('node:perf_hooks');
const { runBusinessUnderstandingAgent } = require('./businessUnderstandingAgent.cjs');
const { runOntologyContextAgent } = require('./ontologyContextAgent.cjs');
const { runIntentAgent } = require('./intentAgent.cjs');

async function executeCase(testCase, contextSources, dependencies = {}) {
    const runBusiness = dependencies.runBusiness || runBusinessUnderstandingAgent;
    const runOntology = dependencies.runOntology || runOntologyContextAgent;
    const runIntent = dependencies.runIntent || runIntentAgent;
    const env = dependencies.env || process.env;
    const common = { userInput: testCase.userInput, recentConversation: testCase.recentConversation || '' };
    const parallelStarted = performance.now();
    let businessStarted; let businessFinished; let ontologyStarted; let ontologyFinished;
    const [businessResult, ontologyResult] = await Promise.all([
        (async () => { const start = performance.now(); businessStarted = start; const memo = await runBusiness({ ...common, businessModel: contextSources.businessModel, domainPolicy: contextSources.domainPolicy }, { env }); businessFinished = performance.now(); return { memo, ms: businessFinished - start }; })(),
        (async () => { const start = performance.now(); ontologyStarted = start; const memo = await runOntology({ ...common, ontologyText: contextSources.ontologyText }, { env }); ontologyFinished = performance.now(); return { memo, ms: ontologyFinished - start }; })(),
    ]);
    const parallelContextTotalMs = performance.now() - parallelStarted;
    const intentStarted = performance.now();
    const intentMemo = await runIntent({ ...common, businessMemo: businessResult.memo, ontologyMemo: ontologyResult.memo }, { env });
    const intentMs = performance.now() - intentStarted;
    return Object.freeze({ id: testCase.id, run: testCase.run || 1, userInput: testCase.userInput,
        recentConversation: testCase.recentConversation || '', businessMemo: businessResult.memo, ontologyMemo: ontologyResult.memo, intentMemo,
        timings: Object.freeze({ businessContextMs: businessResult.ms, ontologyContextMs: ontologyResult.ms,
            parallelContextTotalMs, intentMs, totalMs: parallelContextTotalMs + intentMs }),
        parallelProof: Object.freeze({ businessStartedOffsetMs: businessStarted - parallelStarted, businessFinishedOffsetMs: businessFinished - parallelStarted,
            ontologyStartedOffsetMs: ontologyStarted - parallelStarted, ontologyFinishedOffsetMs: ontologyFinished - parallelStarted,
            intervalsOverlap: Math.max(businessStarted, ontologyStarted) < Math.min(businessFinished, ontologyFinished) }) });
}

module.exports = { executeCase };
