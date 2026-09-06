'use strict';
// Deterministic failure injection only: no provider, business API or database.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { runCandidateRead } = require('../api/services/ai-v5/candidateRead.cjs');
async function main() {
    const output = 'docs/ai-governance/data/p16e-r4l-close-failure-injection.json';
    assert.equal(fs.existsSync(output), false, 'CERTIFICATION_ALREADY_EXISTS');
    const read = { goal: 'synthetic', mode: 'query', domains: ['catalog'], needsBusinessData: true,
        contextMode: 'current_turn', answerShape: 'direct', entityScope: 'single', requiresClarification: false,
        ambiguities: [], confidence: 'high' };
    const cases = [
        ['RISK_UNAVAILABLE', async () => { throw Error('RISK_UNAVAILABLE'); }],
        ['EXCEPTION', async () => { throw Error('synthetic'); }],
        ['TIMEOUT', () => new Promise(() => {})],
        ['INVALID_CONTRACT', async () => ({})],
        ['UNKNOWN_MODE', async () => ({ ...read, mode: 'unknown' })],
        ['UNEXPECTED_FIELD', async () => ({ ...read, toolSteps: [] })],
        ['MALFORMED_RESPONSE', async () => null],
    ];
    const paths = [];
    for (let repeat = 0; repeat < 3; repeat++) for (const [id, request] of cases) {
        const counts = { interpreter: 0, resolver: 0, readTool: 0, answerModel: 0, businessAnswer: 0 };
        const fail = key => () => { counts[key]++; throw Error('UNREACHABLE'); };
        const outcome = await runCandidateRead({ sourceRequest: 'synthetic', factKey: 'inventory.quantity',
            previewOptIn: true, internalAuthorized: true, deliver: fail('businessAnswer') }, {
            env: { PUMP_V5_CANDIDATE_RUNTIME: 'true', AI_V5_READ_CANARY_ENABLED: 'true', AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED: 'true' },
            riskOptions: { request, timeoutMs: 10 }, interpret: fail('interpreter'), lookupEntities: fail('resolver'),
            executionOptions: { execute: fail('readTool') }, answerOptions: { modelRequest: fail('answerModel') },
        });
        const pass = outcome.riskOutcomeClass === 'SAFE_AVAILABILITY_FALLBACK' && !outcome.attempted
            && !outcome.eligible && !outcome.delivered && Object.values(counts).every(n => n === 0);
        paths.push({ id, repeat, outcomeClass: outcome.riskOutcomeClass, eligible: outcome.eligible, counts, pass });
    }
    const data = { paths, distinctFailurePaths: cases.length, repeats: 3, attempts: paths.length,
        unsafeAdmissions: paths.filter(p => p.eligible).length, pass: paths.every(p => p.pass) };
    fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ pass: data.pass, attempts: data.attempts, unsafeAdmissions: data.unsafeAdmissions }));
    assert.equal(data.pass, true);
}
if (require.main === module) main().catch(() => { console.error('CANDIDATE_FAILURE_CERTIFICATION_FAILED'); process.exitCode = 1; });
