'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const resolutionPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-type-independent-entity-resolution-b1b.json');
const architecturePath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-entity-first-architecture-audit.json');
const outputPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-ambiguity-regression-audit.json');

const resolution = JSON.parse(fs.readFileSync(resolutionPath, 'utf8'));
const architecture = JSON.parse(fs.readFileSync(architecturePath, 'utf8'));
const expectedByCase = new Map(architecture.cases.map(item => [item.case_id, item]));
const taskClasses = require('../api/services/ai-v5/taskClassCatalog.cjs').V5_TASK_CLASS_CATALOG;

// These are safe type/count facts from the frozen B1-B resolver result. No raw
// mention, canonical identifier, candidate identity, or business value is retained.
const candidateTypesByGroup = Object.freeze({
    COIL_INVENTORY: Object.freeze(['coil']),
    EXACT_RECIPE_COST: Object.freeze(['recipe']),
    FLAT_BLADE_PRICE: Object.freeze(['part', 'template']),
    PART_INVENTORY_PRIMARY: Object.freeze(['part']),
    PART_INVENTORY_REPEAT: Object.freeze(['part']),
});

function localClasses(candidateTypes) {
    const allowed = new Set(candidateTypes);
    return taskClasses.filter(item => item.entityTypes.some(type => allowed.has(type)));
}

const cases = resolution.paths.map(item => {
    const expected = expectedByCase.get(item.case_id);
    if (!expected) throw new Error(`Missing frozen expectation: ${item.case_id}`);
    const candidateTypes = candidateTypesByGroup[item.source_group_id];
    if (!candidateTypes) throw new Error(`Missing candidate-type evidence: ${item.source_group_id}`);
    const local = localClasses(candidateTypes);
    const expectedClass = taskClasses.find(taskClass => taskClass.classRef === expected.expected_class);
    if (!expectedClass) throw new Error(`Missing expected class: ${expected.expected_class}`);
    const expectedType = expected.expected_entity_type;
    const finalExpectedTypeCandidateCount = candidateTypes.filter(type => type === expectedType).length;
    return {
        case_id: item.case_id,
        source_group_id: item.source_group_id,
        candidateTypeCount: candidateTypes.length,
        candidateTypes: [...candidateTypes],
        localTaskClassCount: local.length,
        localTaskClasses: local.map(taskClass => ({
            classRef: taskClass.classRef,
            operation: taskClass.operation,
            entityTypes: [...taskClass.entityTypes],
        })),
        expectedClass: expected.expected_class,
        expectedClassSurvives: local.some(taskClass => taskClass.classRef === expected.expected_class),
        finalExpectedTypeCandidateCount,
        finalUniqueEntityAfterExpectedClassFilter: finalExpectedTypeCandidateCount === 1,
        ambiguityClass: item.source_group_id === 'FLAT_BLADE_PRICE'
            ? 'TRUE_AUTHORITATIVE_AMBIGUITY'
            : 'NOT_AMBIGUOUS',
        simulationOnly: true,
        safeReasonCodes: item.source_group_id === 'FLAT_BLADE_PRICE'
            ? ['DISTINCT_EXACT_CROSS_TYPE_CANDIDATES', 'EXPECTED_CLASS_DISAMBIGUATES_ENTITY_TYPE']
            : ['AUTHORITATIVE_UNIQUE_CANDIDATE', 'EXPECTED_CLASS_SURVIVES_LOCAL_UNION'],
    };
});

if (cases.length !== 15) throw new Error(`Frozen path count changed: ${cases.length}`);
if (!cases.every(item => item.expectedClassSurvives)) throw new Error('Expected class survival is not 15/15');
if (!cases.every(item => item.finalUniqueEntityAfterExpectedClassFilter)) {
    throw new Error('Expected task-class filtering does not yield a unique entity for every path');
}

const counts = cases.map(item => item.localTaskClassCount).sort((a, b) => a - b);
const output = {
    schemaVersion: 1,
    audit: 'V5-E4R-E-B1-C Cross-Type Ambiguity + Regression Attribution Audit',
    collision: {
        classification: 'TRUE_AUTHORITATIVE_AMBIGUITY',
        partCandidateAuthoritative: true,
        templateCandidateAuthoritative: true,
        distinctTypeScopedCanonicalEntities: true,
        resolverAmbiguousCorrect: true,
        exactMatchKinds: ['EXACT'],
        complete: true,
    },
    candidateSetArchitecture: {
        decision: 'CANDIDATE_SET_THEN_LOCAL_TASK_CLASS',
        globalTaskClassCount: taskClasses.length,
        expectedClassSurvival: `${cases.filter(item => item.expectedClassSurvives).length}/${cases.length}`,
        finalUniqueEntityAfterExpectedClassFilter: `${cases.filter(item => item.finalUniqueEntityAfterExpectedClassFilter).length}/${cases.length}`,
        minLocalTaskClassCount: counts[0],
        medianLocalTaskClassCount: counts[Math.floor(counts.length / 2)],
        maxLocalTaskClassCount: counts[counts.length - 1],
        modelSelectsCanonicalEntity: false,
        modelSelectsEntityTypeDirectly: false,
        modelSelectsLocalTaskClassOnly: true,
        simulationOnly: true,
    },
    regression: {
        dirtyMainGate: 'FAIL_SEARCH_COILS_COPPER_BASE_MISMATCH',
        cleanCurrentCommitGate: 'FAIL_SEARCH_COILS_COPPER_BASE_MISMATCH',
        cleanPreB1BCommitGate: 'FAIL_SEARCH_COILS_COPPER_BASE_MISMATCH',
        attribution: 'PRE_EXISTING_COMMITTED_FAILURE',
        b1bNewRegressionConfirmed: false,
        b1bInterferencePath: 'NONE',
        userDirtyWorktreeEffect: false,
        firstDivergence: 'FORMAL_API_SNAPSHOT_BEFORE_ASYNC_STARTUP_COPPER_SYNC_SETTLED_VS_MCP_READ_AFTER_UPDATE',
        safeReasonCodes: [
            'SAME_FAILURE_AT_PRE_B1B_COMMIT',
            'SAME_FAILURE_AT_B1B_COMMIT',
            'SAME_FAILURE_IN_DIRTY_MAIN',
            'B1B_ENTITY_LOOKUP_PATH_DISCONNECTED_FROM_SEARCH_COILS',
            'DEEP_API_STABILITY_CHECK_RACES_ASYNC_STARTUP_COPPER_SYNC',
        ],
    },
    cases,
};

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
    paths: cases.length,
    expectedClassSurvival: output.candidateSetArchitecture.expectedClassSurvival,
    finalUnique: output.candidateSetArchitecture.finalUniqueEntityAfterExpectedClassFilter,
    medianLocal: output.candidateSetArchitecture.medianLocalTaskClassCount,
    maxLocal: output.candidateSetArchitecture.maxLocalTaskClassCount,
    regressionAttribution: output.regression.attribution,
}));
