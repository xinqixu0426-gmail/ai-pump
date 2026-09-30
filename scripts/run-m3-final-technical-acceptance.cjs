'use strict';

// Manifest integrity gate.  Real-provider execution is intentionally a
// separate operational step: this source gate never reads credentials or
// mutates business data.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const finalPath = path.join(root, 'planning/ai-assistant-mvp-v1/M3-5/Final-Technical-Acceptance-V1.json');
const baselinePath = path.join(root, 'planning/ai-assistant-mvp-v1/M3-0/Baseline-V1-cases.json');
const finalManifest = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const caseIds = finalManifest.cases.map(item => item.id);
const baselineIds = baseline.cases.map(item => item.id);

if (!Number.isInteger(finalManifest.minimumCases) || finalManifest.minimumCases < 35) throw new Error('M3 final acceptance minimum must be at least 35 cases');
if (finalManifest.cases.length < finalManifest.minimumCases) throw new Error('M3 final acceptance case count is below its declared minimum');
if (new Set(caseIds).size !== caseIds.length) throw new Error('M3 final acceptance contains duplicate case IDs');
for (const id of baselineIds) if (!caseIds.includes(id)) throw new Error(`M3 baseline case missing from final acceptance: ${id}`);
const realCases = finalManifest.cases.filter(item => item.type === 'REAL_MODEL').length;
if (realCases < 9) throw new Error('M3 final acceptance must retain all nine real-model baseline cases');
console.log(JSON.stringify({ status: 'PASS', totalCases: finalManifest.cases.length, baselineCasesRetained: baselineIds.length, realModelCases: realCases }, null, 2));
