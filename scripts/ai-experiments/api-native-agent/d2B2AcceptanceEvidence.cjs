'use strict';

const base = require('./d1FinalAcceptanceEvidence.cjs');
const fs = require('node:fs');
const path = require('node:path');
const ARTIFACTS = Object.freeze({ sourceManifest: 'M5-D2-B2-Source-Manifest.json', controlledSmoke: 'M5-D2-B2-Controlled-Smoke.json', controlledRepetition: 'M5-D2-B2-Controlled-Repetition.json', realCatalog: 'M5-D2-B2-Real-Catalog.json', agentTraces: 'M5-D2-B2-Agent-Traces.json', safety: 'M5-D2-B2-Safety.json', performance: 'M5-D2-B2-Performance.json', acceptance: 'M5-D2-B2-Acceptance.md' });
function domainRuntimeState(candidate = {}) {
    const coverage = candidate.relevantApiCoverage || candidate.metrics?.relevantApiCoverage || {};
    const domainApiSet = Array.isArray(coverage.domainApiSet) ? coverage.domainApiSet : [];
    const executed = new Set(coverage.executedRelevantTools || []); const failed = new Set(coverage.failedRelevantTools || []);
    const blocked = new Set(coverage.blockedRelevantTools || []); const notApplicable = new Map((coverage.notApplicableDomainApis || []).map(item => [item.toolName, item]));
    const terminalStates = domainApiSet.map(toolName => ({ toolName,
        terminalState: executed.has(toolName) ? 'EXECUTED' : failed.has(toolName) ? (blocked.has(toolName) ? 'BLOCKED' : 'FAILED') : notApplicable.has(toolName) ? 'NOT_APPLICABLE' : 'MISSING',
        ...(notApplicable.has(toolName) ? { reason: notApplicable.get(toolName).reason, missingInput: notApplicable.get(toolName).missingInput, source: notApplicable.get(toolName).source } : {}),
    }));
    return Object.freeze({ selectedBusinessDomains: coverage.selectedBusinessDomains || [], domainApiSet, executedDomainApis: terminalStates.filter(item => item.terminalState === 'EXECUTED').map(item => item.toolName), failedDomainApis: terminalStates.filter(item => item.terminalState === 'FAILED').map(item => item.toolName), blockedDomainApis: terminalStates.filter(item => item.terminalState === 'BLOCKED').map(item => item.toolName), notApplicableDomainApis: terminalStates.filter(item => item.terminalState === 'NOT_APPLICABLE'), missingDomainApis: terminalStates.filter(item => item.terminalState === 'MISSING').map(item => item.toolName), apiTerminalStates: terminalStates, finalDomainCoverage: coverage.finalRelevantCoverage === true && terminalStates.every(item => item.terminalState !== 'MISSING'), domainCoverageReviewResumed: Number(coverage.coverageReviewResumed || 0), domainDeclarationCount: Array.isArray(coverage.selectedBusinessDomains) && coverage.selectedBusinessDomains.length ? 1 : 0,
        rag: { ragSearchRequired: domainApiSet.length > 0, ragSearchExecuted: coverage.ragAuxiliarySearched === true, ragSearchTool: 'search_factory_knowledge' } });
}
function serializeRun(item, options = {}) {
    const serialized = base.serializeRun(item, options); const domainRuntime = domainRuntimeState(item?.candidate || item || {});
    const output = base.sanitizeEvidence({ ...serialized, domainRuntime });
    if (!base.scanForSecrets(output).pass) throw new Error('D2_B2_EVIDENCE_SECRET_SCAN_FAILED');
    return Object.freeze(output);
}
function writeArtifacts(outputDirectory, artifacts) {
    fs.mkdirSync(outputDirectory, { recursive: true });
    for (const [key, value] of Object.entries(artifacts || {})) {
        const filename = ARTIFACTS[key]; if (!filename) continue;
        const content = key === 'acceptance' ? String(value) : `${JSON.stringify(base.sanitizeEvidence(value), null, 2)}\n`;
        if (!base.scanForSecrets(content).pass) throw new Error('D2_B2_EVIDENCE_SECRET_SCAN_FAILED');
        fs.writeFileSync(path.join(outputDirectory, filename), content, 'utf8');
    }
}
module.exports = { ...base, ARTIFACTS, domainRuntimeState, serializeRun, writeArtifacts };
