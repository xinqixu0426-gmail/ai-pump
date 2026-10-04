'use strict';

const base = require('./d1FinalAcceptanceEvidence.cjs');
const fs = require('node:fs');
const path = require('node:path');
const ARTIFACTS = Object.freeze({ sourceManifest: 'M5-D2-B2-Source-Manifest.json', controlledSmoke: 'M5-D2-B2-Controlled-Smoke.json', controlledRepetition: 'M5-D2-B2-Controlled-Repetition.json', realCatalog: 'M5-D2-B2-Real-Catalog.json', agentTraces: 'M5-D2-B2-Agent-Traces.json', safety: 'M5-D2-B2-Safety.json', performance: 'M5-D2-B2-Performance.json', acceptance: 'M5-D2-B2-Acceptance.md' });
function writeArtifacts(outputDirectory, artifacts) {
    fs.mkdirSync(outputDirectory, { recursive: true });
    for (const [key, value] of Object.entries(artifacts || {})) {
        const filename = ARTIFACTS[key]; if (!filename) continue;
        const content = key === 'acceptance' ? String(value) : `${JSON.stringify(base.sanitizeEvidence(value), null, 2)}\n`;
        if (!base.scanForSecrets(content).pass) throw new Error('D2_B2_EVIDENCE_SECRET_SCAN_FAILED');
        fs.writeFileSync(path.join(outputDirectory, filename), content, 'utf8');
    }
}
module.exports = { ...base, ARTIFACTS, writeArtifacts };
