'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createSyntheticBusinessAcceptanceFixture } = require('../tests/helpers/syntheticBusinessAcceptanceFixture.cjs');
const { buildSyntheticBusinessAcceptanceOracle, definitionHashes } = require('../tests/helpers/syntheticBusinessAcceptanceOracle.cjs');
const { evaluateSyntheticBusinessCase, CRITICAL_FAILURES } = require('../tests/helpers/syntheticBusinessAcceptanceEvaluator.cjs');

const root = path.resolve(__dirname, '..');
const args = new Map(process.argv.slice(2).map(value => {
    const [key, ...rest] = value.replace(/^--/, '').split('=');
    return [key, rest.join('=') || true];
}));
const reportPath = path.resolve(String(args.get('report') || path.join(root, 'logs/synthetic-business-acceptance-v1-raw.json')));
const artifactPath = path.resolve(String(args.get('artifact') || path.join(root, 'docs/synthetic-business-acceptance-baseline-v1.json')));
const definitionPath = path.join(root, 'tests/fixtures/synthetic-business-acceptance-v1.json');
const fixturePath = path.join(root, 'tests/helpers/syntheticBusinessAcceptanceFixture.cjs');
const oraclePath = path.join(root, 'tests/helpers/syntheticBusinessAcceptanceOracle.cjs');
const definition = require(definitionPath);
const source = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const hashes = definitionHashes(definitionPath, fixturePath, oraclePath);
for (const key of ['caseHash', 'fixtureHash', 'oracleHash']) {
    if (source[key] !== hashes[key]) throw new Error(`SYNTHETIC_ADJUDICATION_HASH_MISMATCH:${key}`);
}
const fixture = createSyntheticBusinessAcceptanceFixture();
let oracle;
try {
    oracle = buildSyntheticBusinessAcceptanceOracle(fixture, definition);
} finally {
    fixture.close();
}
const byKey = new Map(definition.cases.map(item => [item.caseKey, item]));
const executions = source.executions.map(item => {
    const testCase = byKey.get(item.caseKey);
    if (!testCase || !oracle.perCase[item.caseKey]) throw new Error(`SYNTHETIC_ADJUDICATION_CASE_MISSING:${item.caseKey}`);
    if (item.actual?.blocked) return item;
    return { runNumber: item.runNumber, ...evaluateSyntheticBusinessCase(testCase, oracle.perCase[item.caseKey], item.actual) };
});
const counts = Object.fromEntries(['PASS', 'PARTIAL', 'FAIL', 'BLOCKED'].map(status => [status,
    executions.filter(item => item.status === status).length]));
const criticalFailureCounts = Object.fromEntries(CRITICAL_FAILURES.map(name => [name,
    executions.reduce((sum, item) => sum + (item.criticalFailures || []).filter(value => value === name).length, 0)]));
const dimensions = Object.fromEntries(definition.dimensions.map(name => {
    const values = executions.map(item => item.dimensions?.[name]).filter(value => value !== null && value !== undefined);
    return [name, { passed: values.filter(Boolean).length, total: values.length,
        passRate: values.length ? Number((values.filter(Boolean).length / values.length * 100).toFixed(1)) : 100 }];
}));
const adjudicated = { ...source, adjudicatedAt: new Date().toISOString(), counts, criticalFailureCounts, dimensions, executions };
fs.writeFileSync(reportPath, `${JSON.stringify(adjudicated, null, 2)}\n`);
const { executions: ignoredExecutions, ...summary } = adjudicated;
void ignoredExecutions;
fs.writeFileSync(artifactPath, `${JSON.stringify({ ...summary, cases: executions.map(item => ({
    run: item.runNumber, caseKey: item.caseKey, status: item.status, failureClass: item.failureClass,
    criticalFailures: item.criticalFailures, dimensions: item.dimensions,
})) }, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, artifactPath, counts, criticalFailureCounts, dimensions }, null, 2));
