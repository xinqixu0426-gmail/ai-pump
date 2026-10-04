'use strict';

// Semantic runners never publish canonical acceptance evidence.  Each run
// writes once to its own caller-supplied directory; a later assembler is the
// sole canonical-artifact writer.
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeEvidence, scanForSecrets } = require('./d2B2AcceptanceEvidence.cjs');

function requireRunId(value) {
    const runId = String(value || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(runId)) throw new Error('D2_B2_RUN_ID_REQUIRED');
    return runId;
}
function rootFor(outputDirectory) { return path.join(outputDirectory || path.join(process.cwd(), 'planning/ai-native-api'), 'M5-D2-B2-runs'); }
function runDirectory(outputDirectory, kind, runId) {
    // R6 acceptance has independent writers for each semantic suite.  Keep
    // the vocabulary closed so a runner cannot silently invent a staging
    // location or publish a canonical artifact directly.
    if (!/^(?:controlled|repetition|real|domain-corpus|rag|targeted|d1-protection|r6-gates)$/u.test(kind)) throw new Error('D2_B2_RUN_KIND_INVALID');
    return path.join(rootFor(outputDirectory), kind, requireRunId(runId));
}
function createExclusiveRun(outputDirectory, { kind, runId }) {
    const directory = runDirectory(outputDirectory, kind, runId);
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    try { fs.mkdirSync(directory); } catch (error) {
        if (error?.code === 'EEXIST') throw new Error('D2_B2_RUN_ALREADY_EXISTS');
        throw error;
    }
    return Object.freeze({ kind, runId: requireRunId(runId), directory });
}
function writeStagedRun(run, value) {
    const content = `${JSON.stringify(sanitizeEvidence(value), null, 2)}\n`;
    if (!scanForSecrets(content).pass) throw new Error('D2_B2_EVIDENCE_SECRET_SCAN_FAILED');
    const temp = path.join(run.directory, '.artifact.json.tmp');
    const target = path.join(run.directory, 'artifact.json');
    fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, target);
    return target;
}
function readStagedRun(outputDirectory, { kind, runId }) {
    const target = path.join(runDirectory(outputDirectory, kind, runId), 'artifact.json');
    if (!fs.existsSync(target)) throw new Error('D2_B2_REQUIRED_RUN_MISSING');
    return JSON.parse(fs.readFileSync(target, 'utf8'));
}
module.exports = { createExclusiveRun, readStagedRun, requireRunId, rootFor, runDirectory, writeStagedRun };
