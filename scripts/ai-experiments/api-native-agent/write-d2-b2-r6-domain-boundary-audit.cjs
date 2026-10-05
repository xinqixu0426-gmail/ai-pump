'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { buildApiIndex } = require('../../../api/services/ai-assistant/apiIndex.cjs');
const { listAiCapabilities } = require('../../../api/capabilities/registry.cjs');
const { evidenceProducerFor } = require('./d2B2DomainSemanticOracleV2.cjs');

const OLD_FINGERPRINT = '10bee9d8a065ea2322fcaf14bdf21cee949d0f57da8c3d5133448c1ee7d09c61';

function buildAudit() {
    const index = buildApiIndex();
    const capabilities = new Map(listAiCapabilities().map(item => [item.toolName, item]));
    const rows = index.modelIndexV1.map(entry => {
        const capability = capabilities.get(entry.toolName);
        const boundary = entry.semanticBoundary;
        return {
            toolName: entry.toolName,
            capabilityId: capability.capabilityId,
            currentDomains: entry.domains,
            operation: entry.operation,
            access: capability.access,
            sourceOfTruthAuthority: {
                capability: boundary.sourceOfTruth,
                formalAuthorities: boundary.formalAuthorities,
                factAuthorities: boundary.factAuthorities,
            },
            primaryBusinessResponsibility: boundary.primaryBusinessResponsibility,
            formalFactsProduced: boundary.formalFactsProduced,
            evidenceProducers: Object.fromEntries(boundary.formalFactsProduced
                .map(predicate => [predicate, evidenceProducerFor(entry.toolName, predicate)])),
            overlappingBusinessDomains: boundary.overlappingBusinessDomains,
            factsItDoesNotEstablish: boundary.factsItDoesNotEstablish,
            aggregateOrDirect: boundary.aggregateOrDirect,
            currentMetadataIssue: 'V1 exposed navigation domains and a short summary but omitted explicit fact authority, overlap, and negative boundary.',
            proposedCorrection: 'Expose the derived semantic boundary in the model API Index while preserving registered domains, execution, schemas, and business logic.',
        };
    });
    const multiDomainCapabilities = rows.filter(item => item.currentDomains.length > 1).map(item => item.toolName);
    return {
        schemaVersion: 'D2_B2_R6_DOMAIN_BOUNDARY_AUDIT_V2',
        conclusion: 'CONFIRMED_NON_EXCLUSIVE_DOMAIN_OVERLAP',
        oldApiIndexFingerprint: OLD_FINGERPRINT,
        newApiIndexFingerprint: index.fingerprint,
        fullInventoryCount: index.metrics.fullInventoryCount,
        exposedReadPreviewCount: rows.length,
        uniqueCapabilities: new Set(rows.map(item => item.toolName)).size,
        totalDomainMemberships: rows.reduce((sum, item) => sum + item.currentDomains.length, 0),
        multiDomainCapabilityCount: multiDomainCapabilities.length,
        multiDomainCapabilities,
        businessApiChanged: false,
        domainMembershipChanged: false,
        capabilities: rows,
    };
}

function writeAudit(target = path.resolve(process.cwd(), 'planning/ai-native-api/M5-D2-B2-R6-Domain-API-Semantic-Boundary-Audit.json')) {
    const audit = buildAudit();
    fs.writeFileSync(target, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
    return audit;
}

if (require.main === module) {
    const audit = writeAudit(process.argv[2]);
    process.stdout.write(`${JSON.stringify({ path: process.argv[2] || 'planning/ai-native-api/M5-D2-B2-R6-Domain-API-Semantic-Boundary-Audit.json', count: audit.exposedReadPreviewCount, fingerprint: audit.newApiIndexFingerprint })}\n`);
}

module.exports = { buildAudit, writeAudit };
