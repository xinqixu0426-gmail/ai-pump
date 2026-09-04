'use strict';

const p06Cases = require('../docs/ai-observability/data/p06-failure-cases.json');
const {
    auditOntologyConsistency,
    listV5EntityTypes,
    validateCapabilityOntologyReferences,
} = require('../api/services/ai-v5/businessOntology.cjs');
const {
    evaluateExactIdentityCases,
    evaluateFlatBladeIdentityCases,
    evaluateP06IdentityCorpus,
} = require('../api/services/ai-v5/entityShadowEvaluation.cjs');

const exact = evaluateExactIdentityCases(p06Cases);
const flatBlade = evaluateFlatBladeIdentityCases(p06Cases);
const corpus = evaluateP06IdentityCorpus(p06Cases);
const capabilityReferences = validateCapabilityOntologyReferences();
const consistency = auditOntologyConsistency();

process.stdout.write(`${JSON.stringify({
    ontologyVersion: 1,
    entityTypes: listV5EntityTypes().map(item => item.entityType),
    capabilityOntology: capabilityReferences,
    consistency,
    exactIdentity: exact,
    exactMetrics: {
        analyzed: exact.length,
        originalPreserved: exact.filter(item => item.v5PreservesOriginalMention).length,
        damageDetected: exact.filter(item => item.v5DetectsLossBeforeResolver).length,
        prevented: exact.filter(item => item.outcome === 'PREVENTED').length,
        detectedNotPrevented: exact.filter(item => item.outcome === 'DETECTED_NOT_PREVENTED').length,
        notAddressed: exact.filter(item => item.outcome === 'NOT_ADDRESSED').length,
        unknown: exact.filter(item => item.outcome === 'UNKNOWN').length,
    },
    flatBladeMetrics: {
        analyzed: flatBlade.length,
        rawPreserved: flatBlade.filter(item => item.rawPreserved).length,
        canonicalSeparated: flatBlade.filter(item => item.canonicalSeparated).length,
    },
    corpusMetrics: corpus.metrics,
    productionExecutions: 0,
    entityWrites: 0,
    toolExecutions: 0,
    writes: 0,
}, null, 2)}\n`);
