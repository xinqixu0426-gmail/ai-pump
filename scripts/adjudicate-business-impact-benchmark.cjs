'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const definition = require('../tests/fixtures/business-impact-benchmark-v1.json');
const { createBusinessImpactFixture, runBusinessImpactFixtureChecks } = require('../tests/helpers/businessImpactFixture.cjs');
const { buildBusinessImpactOracle, impactDefinitionHashes } = require('../tests/helpers/businessImpactOracle.cjs');
const { evaluateBusinessImpactCase, CRITICAL_FAILURES } = require('../tests/helpers/businessImpactEvaluator.cjs');

const root = path.resolve(__dirname, '..');
const args = new Map(process.argv.slice(2).map(value => {
    const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=') || true];
}));
const reportPath = path.resolve(String(args.get('report') || path.join(root, 'logs/business-impact-benchmark-v1-raw.json')));
const artifactPath = path.resolve(String(args.get('artifact') || path.join(root, 'docs/business-impact-baseline-v1.json')));
const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const fixture = createBusinessImpactFixture();
let oracle;
try { oracle = buildBusinessImpactOracle(fixture, definition); } finally { fixture.close(); }
const byKey = Object.fromEntries(definition.cases.map(item => [item.caseKey, item]));
const executions = raw.executions.map(entry => ({ runNumber: entry.runNumber,
    ...evaluateBusinessImpactCase(byKey[entry.caseKey], oracle.perCase[entry.caseKey], entry.actual) }));
const counts = Object.fromEntries(['PASS','PARTIAL','FAIL','BLOCKED'].map(status => [status, executions.filter(item => item.status === status).length]));
const criticalFailureCounts = Object.fromEntries(CRITICAL_FAILURES.map(name => [name,
    executions.reduce((sum, item) => sum + item.criticalFailures.filter(value => value === name).length, 0)]));
const dimensions = Object.fromEntries(definition.dimensions.map(name => {
    const values = executions.map(item => item.dimensions[name]);
    return [name, { passed: values.filter(Boolean).length, total: values.length,
        passRate: Number((values.filter(Boolean).length / values.length * 100).toFixed(1)) }];
}));
const hashes = impactDefinitionHashes(path.join(root, 'tests/fixtures/business-impact-benchmark-v1.json'),
    path.join(root, 'tests/helpers/businessImpactFixture.cjs'), path.join(root, 'tests/helpers/businessImpactOracle.cjs'));
const checkFixture = createBusinessImpactFixture();
const fixtureChecks = runBusinessImpactFixtureChecks(checkFixture);
checkFixture.close();
const summary = { ...Object.fromEntries(Object.entries(raw).filter(([key]) => !['executions','counts','criticalFailureCounts','dimensions','caseHash','fixtureHash','oracleHash'].includes(key))),
    ...hashes,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    fixtureChecks, counts, criticalFailureCounts, dimensions };
fs.writeFileSync(artifactPath, `${JSON.stringify({ ...summary, cases: executions.map(item => ({ run: item.runNumber,
    caseKey: item.caseKey, status: item.status, failureClass: item.failureClass,
    criticalFailures: item.criticalFailures, dimensions: item.dimensions })) }, null, 2)}\n`);
console.log(JSON.stringify({ artifactPath, counts, criticalFailureCounts, dimensions, ...hashes }, null, 2));
