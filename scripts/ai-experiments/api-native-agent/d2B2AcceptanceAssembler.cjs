'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ARTIFACTS, sanitizeEvidence, scanForSecrets } = require('./d2B2AcceptanceEvidence.cjs');
const { readStagedRun } = require('./d2B2AcceptanceStaging.cjs');

function atomicWrite(directory, filename, value) {
    fs.mkdirSync(directory, { recursive: true });
    const content = `${JSON.stringify(sanitizeEvidence(value), null, 2)}\n`;
    if (!scanForSecrets(content).pass) throw new Error('D2_B2_EVIDENCE_SECRET_SCAN_FAILED');
    const target = path.join(directory, filename); const temp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(temp, content, 'utf8'); fs.renameSync(temp, target);
}
function assemble(outputDirectory, plan) {
    const controlled = readStagedRun(outputDirectory, { kind: 'controlled', runId: plan.controlledRunId });
    const repetition = readStagedRun(outputDirectory, { kind: 'repetition', runId: plan.repetitionRunId });
    const real = readStagedRun(outputDirectory, { kind: 'real', runId: plan.realRunId });
    atomicWrite(outputDirectory, ARTIFACTS.controlledSmoke, controlled);
    atomicWrite(outputDirectory, ARTIFACTS.controlledRepetition, repetition);
    atomicWrite(outputDirectory, ARTIFACTS.realCatalog, real);
    return Object.freeze({ controlled, repetition, real });
}
module.exports = { assemble, atomicWrite };
