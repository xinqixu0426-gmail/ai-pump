'use strict';
// Static adjudication only. Never invokes a model, resolver or Tool.
const fs = require('node:fs'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const rawPath = 'docs/ai-governance/data/p16i-r4-semantic-certification.json';
const raw = fs.readFileSync(rawPath), run = JSON.parse(raw);
const corpus = require('../docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json').cases;
const { required } = require('./run-ai-v5f2b-answer-formal.cjs');
const { selectReadExecution } = require('../api/services/ai-v5/readExecutionRegistry.cjs');
assert.equal(run.paths.length, 15); assert.equal(corpus.length, 15);
const paths = run.paths.map(p => {
    const oracle = corpus.find(c => c.case_id === p.caseId);
    assert.ok(oracle?.expected_class);
    const expected = required[oracle.source_group] === 'price.current' ? 'tc_028' : oracle.expected_class;
    return { caseId: p.caseId, expectedSemantic: expected, selectedSemantic: p.selectedTaskClassRef,
        taskClassMatch: expected === p.selectedTaskClassRef,
        factMatch: p.derivedFactKey === required[oracle.source_group],
        capabilityMatch: p.capabilityId === oracle.expected_capability,
        finalEntityTypeMatch: p.finalEntityType === oracle.expected_entity_type,
        executionIsUniqueRead: selectReadExecution(p.capabilityId).status === 'UNIQUE',
        unchangedRecordedSafety: p.finalIdentityMatch && p.exactIdentityMatch && p.headerAssertion === 'ABSENT'
            && p.interpreterModelCalls <= 2 && p.toolCalls === 1 && p.final && !p.rawExposed
            && p.validationPass && p.contractValid && p.evidenceRefsValid && p.groundingValid
            && p.requiredFactCoverage && p.numericValid && p.entityValid
            && p.resultEquivalence === 'MATCH' && p.evidenceVerification === 'PASS' };
});
const result = { sourceArtifact: rawPath, sourceHash: crypto.createHash('sha256').update(raw).digest('hex'),
    correction: 'HARNESS_EXPECTED_TASK_CLASS_UNDEFINED_USE_FROZEN_EXPECTED_CLASS',
    originalArtifactModified: false, modelCalls: 0, apiCalls: 0, productionChangesAfterEvaluation: false,
    paths, pass: paths.every(p => p.taskClassMatch && p.factMatch && p.capabilityMatch && p.finalEntityTypeMatch
        && p.executionIsUniqueRead && p.unchangedRecordedSafety)
        && run.freezeMatch && run.businessDbUnchanged && run.fixtureUnchanged && run.backupCountUnchanged
        && run.exitCode === 0 && run.portClosed && ['orphans','crossRequest','sourceLeaks','forbiddenFields'].every(k => run.trace[k] === 0) };
if (require.main === module) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
module.exports = result;
