'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { startD2B2ControlledFixture } = require('./d2B2ControlledFixture.cjs');
const { finalAcceptanceEnvironment } = require('./run-d1-final-controlled.cjs');
const { freshMemos } = require('./run-d1-r1-controlled.cjs');
const { runApiNativeAgentCandidate } = require('./apiNativeAgentCandidate.cjs');
const { buildControlledOracles } = require('./d2B2AcceptanceOracles.cjs');
const { classifyRun, databaseSnapshot, compareDatabaseSnapshots } = require('./d2B2AcceptanceEvaluator.cjs');
const { serializeRun } = require('./d2B2AcceptanceEvidence.cjs');
const { createExclusiveRun, requireRunId, writeStagedRun } = require('./d2B2AcceptanceStaging.cjs');

const CASES = Object.freeze([
    ['W1-01', 'ORDER-A现在缺什么？各缺多少？'], ['W1-02', 'ORDER-A现在能直接生产吗？'],
    ['W1-03', 'ORDER-A这个缺料现在需要多少、库存有多少、还差多少？'], ['W1-04', 'ORDER-A里有哪些产品，各多少台？'],
    ['W1-05', '采购总览里ORDER-A这个缺料现在到哪一步了？'], ['W1-06', 'ORDER-A缺什么？缺的东西有没有采购？'],
    ['W1-07', 'V750-通用款做10台库存够不够？不够缺什么？'], ['W1-08', 'ORDER-U还有哪些物料目前无法确认库存？'],
    ['W1-09', 'ORDER-B现在还有缺料吗？'], ['W1-10', '采购总览里所有待处理物料有哪些？'],
]);
function hash(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
async function runCandidateCase(testCase, env, executeToolCall) {
    const started = process.hrtime.bigint(); const memos = await freshMemos(testCase.rawOwnerInput, env); const formalCalls = [];
    // The acceptance oracle records the exact read query that the Agent made.
    // It is test-only observability, not an agent-visible workflow hint.
    const recordedExecuteToolCall = async (name, args, options) => {
        const result = await executeToolCall(name, args, options);
        formalCalls.push(Object.freeze({ name, args: { ...(args || {}) }, success: result?.success === true,
            verified: result?.verified === true || result?.executionEvidence?.verified === true,
            queryReceipt: result?.queryReceipt || null }));
        return result;
    };
    const candidate = await runApiNativeAgentCandidate({ rawOwnerInput: testCase.rawOwnerInput, businessMemo: memos.businessMemo, policyMemo: memos.policyMemo, env }, { executeToolCall: recordedExecuteToolCall });
    return Object.freeze({ ...testCase, candidate, businessMemoHash: hash(memos.businessMemo), policyMemoHash: hash(memos.policyMemo), memoTimings: memos.timings,
        formalCalls: Object.freeze(formalCalls), durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        ...classifyRun({ ...testCase, formalCalls }, candidate) });
}
async function main(outputDirectory = path.join(process.cwd(), 'planning/ai-native-api')) {
    if (process.env.D2_B2_ALLOW_MODEL_RUN !== '1') throw new Error('D2_B2_MODEL_RUN_REQUIRES_EXPLICIT_OPT_IN');
    const env = finalAcceptanceEnvironment();
    const fixture = await startD2B2ControlledFixture();
    try {
        const { executeToolCall } = require('../../../api/routes/ai/executor.cjs');
        const before = databaseSnapshot(fixture.db); const oracleById = await buildControlledOracles(executeToolCall, fixture.ids);
        if (process.env.D2_B2_PREFLIGHT_ONLY === '1') return Object.freeze({ phase: 'M5-D2-B2', preflight: true, fixtureRuntime: fixture.fixtureKind, oracleCount: Object.keys(oracleById).length, modelCallsEnabled: false });
        const selectedIds = process.env.D2_B2_CASE_IDS ? process.env.D2_B2_CASE_IDS.split(',').map(value => value.trim()).filter(Boolean) : CASES.map(([id]) => id);
        const selected = CASES.filter(([id]) => selectedIds.includes(id));
        if (!selected.length || selected.length !== selectedIds.length) throw new Error('D2_B2_CASE_SELECTION_INVALID');
        const results = [];
        for (const [id, rawOwnerInput] of selected) results.push(await runCandidateCase({ id, rawOwnerInput, oracle: oracleById[id] }, env, executeToolCall));
        const output = Object.freeze({ phase: 'M5-D2-B2', kind: 'controlled', runId: requireRunId(process.env.D2_B2_RUN_ID), fixtureRuntime: fixture.fixtureKind, modelCallsEnabled: true, database: compareDatabaseSnapshots(before, databaseSnapshot(fixture.db)), results: results.map(serializeRun) });
        writeStagedRun(createExclusiveRun(outputDirectory, { kind: 'controlled', runId: output.runId }), output); return output;
    } finally { await fixture.close(); }
}
if (require.main === module) main(process.env.D2_B2_OUTPUT_DIR).then(result => console.log(JSON.stringify({ preflight: result.preflight === true, cases: result.results?.length || 0, database: result.database || null }, null, 2))).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { CASES, main, runCandidateCase };
