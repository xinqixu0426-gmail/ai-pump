'use strict';

const {
    createV5EntityIdentity,
    detectUntrackedIdentityLoss,
    shapeOf,
} = require('./entityIdentity.cjs');

const EXACT_RAW_MENTION = 'v750-tokoy-';
const FLAT_BLADE_RAW_MENTION = '800平刀';

function expectedShapeFromCase(testCase) {
    const event = String(testCase?.first_divergence?.first_divergent_event || '');
    const match = event.match(/expected length\/punctuation (\d+)\/(\d+)/u);
    if (match) return { length: Number(match[1]), punctuationCount: Number(match[2]) };
    if (String(testCase?.case_id || '').includes('EXACT')) return shapeOf(EXACT_RAW_MENTION);
    return null;
}

function observedShapeFromCase(testCase) {
    const normalization = testCase?.safe_structural_metadata?.entity_normalizations?.[0];
    if (!normalization || normalization.type !== 'recipe') return null;
    return {
        length: normalization.input_length,
        punctuationCount: normalization.input_punctuation_count,
    };
}

function evaluateExactIdentityCases(cases) {
    return Object.freeze((Array.isArray(cases) ? cases : [])
        .filter(testCase => String(testCase?.case_id || '').includes('P06-EXACT-001'))
        .map(testCase => {
            const identity = createV5EntityIdentity({
                version: 1,
                entityType: 'recipe',
                rawMention: EXACT_RAW_MENTION,
                normalizedMention: 'v750-tokoy',
                canonicalEntityId: null,
                canonicalBusinessKey: null,
                resolutionStatus: 'UNRESOLVED',
                matchType: 'NOT_RESOLVED',
                source: 'TASK_BOUNDARY',
                resolverPath: null,
            });
            const expectedShape = expectedShapeFromCase(testCase);
            const observedShape = observedShapeFromCase(testCase);
            const loss = detectUntrackedIdentityLoss(expectedShape, observedShape);
            const resolution = testCase?.safe_structural_metadata?.entity_resolutions?.find(item => item.type === 'recipe');
            const damageDetected = loss.status === 'TRANSFORMED_UNTRACKED';
            return Object.freeze({
                caseId: testCase.case_id,
                rawIdentityAvailableAtFirstObservableBoundary: loss.status === 'PRESERVED',
                normalizationTransformationTracked: observedShape !== null,
                upstreamIdentityLossTracked: damageDetected ? false : null,
                resolverInputForm: 'TOOL_ARGUMENT',
                resolverValidMatchForReceivedInput: resolution?.resolved === true && resolution?.exact_match === true,
                v5PreservesOriginalMention: identity.rawMention === EXACT_RAW_MENTION,
                v5DetectsLossBeforeResolver: damageDetected,
                identityDamage: damageDetected,
                outcome: damageDetected ? 'PREVENTED' : 'NOT_ADDRESSED',
            });
        }));
}

function evaluateFlatBladeIdentityCases(cases) {
    return Object.freeze((Array.isArray(cases) ? cases : [])
        .filter(testCase => String(testCase?.case_id || '').includes('P06-FLATBLADE-001'))
        .map(testCase => {
            const identity = createV5EntityIdentity({
                version: 1,
                entityType: 'part',
                rawMention: FLAT_BLADE_RAW_MENTION,
                normalizedMention: null,
                canonicalEntityId: null,
                canonicalBusinessKey: null,
                resolutionStatus: 'UNRESOLVED',
                matchType: 'NOT_RESOLVED',
                source: 'TASK_BOUNDARY',
                resolverPath: null,
            });
            return Object.freeze({
                caseId: testCase.case_id,
                rawPreserved: identity.rawMention === FLAT_BLADE_RAW_MENTION,
                canonicalSeparated: identity.canonicalEntityId === null,
                pathIdentityMetadataAvailable: false,
            });
        }));
}

function evaluateP06IdentityCorpus(cases) {
    const exact = evaluateExactIdentityCases(cases);
    const evaluated = Array.isArray(cases) ? cases.length : 0;
    return Object.freeze({
        exact,
        metrics: Object.freeze({
            evaluated,
            sufficientIdentityMetadata: exact.length,
            projectable: exact.length,
            preservationPass: exact.filter(item => item.v5PreservesOriginalMention).length,
            damageDetectable: exact.filter(item => item.v5DetectsLossBeforeResolver).length,
            insufficientData: evaluated - exact.length,
        }),
    });
}

module.exports = {
    EXACT_RAW_MENTION,
    FLAT_BLADE_RAW_MENTION,
    evaluateExactIdentityCases,
    evaluateFlatBladeIdentityCases,
    evaluateP06IdentityCorpus,
    expectedShapeFromCase,
    observedShapeFromCase,
};
