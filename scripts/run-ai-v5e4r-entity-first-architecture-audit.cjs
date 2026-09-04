'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const B2_DATASET = path.join(ROOT, 'docs/ai-governance/data/v5-e4r-task-class-semantics-v1_1-evaluation.json');
const P06_DATASET = path.join(ROOT, 'docs/ai-observability/data/p06-failure-cases.json');
const RESOLVER_ADAPTER = path.join(ROOT, 'api/services/ai-v5/entityResolverAdapter.cjs');
const SOURCE_SPAN = path.join(ROOT, 'api/services/ai-v5/sourceSpanCatalog.cjs');

const { V5_TASK_CLASS_CATALOG } = require('../api/services/ai-v5/taskClassCatalog.cjs');
const { listV5Capabilities } = require('../api/services/ai-v5/capabilityRegistry.cjs');
const { MAX_SOURCE_SPANS } = require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const { V5_RESOLVER_INPUT_POLICIES } = require('../api/services/ai-v5/entityResolverAdapter.cjs');

const GROUP_CLASS_AUTHORITY = Object.freeze({
    COIL_INVENTORY: Object.freeze({ expected: 'tc_004', actual: 'tc_002' }),
    EXACT_RECIPE_COST: Object.freeze({ expected: 'tc_024', actual: 'tc_024' }),
    FLAT_BLADE_PRICE: Object.freeze({ expected: 'tc_002', actual: 'tc_003' }),
    PART_INVENTORY_PRIMARY: Object.freeze({ expected: 'tc_002', actual: 'tc_002' }),
    PART_INVENTORY_REPEAT: Object.freeze({ expected: 'tc_002', actual: 'tc_002' }),
});

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function classByRef(classRef) {
    const value = V5_TASK_CLASS_CATALOG.find(item => item.classRef === classRef);
    if (!value) throw new Error(`Unknown Task Class: ${classRef}`);
    return value;
}

function capabilityFor(taskClass) {
    const matches = listV5Capabilities().filter(item => item.exposableInV5B === true
        && item.domain === taskClass.domain
        && item.operation === taskClass.operation
        && item.requiredEntityTypes.length === taskClass.entityTypes.length
        && item.requiredEntityTypes.every(type => taskClass.entityTypes.includes(type)));
    if (matches.length !== 1) throw new Error(`Task Class does not have one authoritative capability: ${taskClass.classRef}`);
    return matches[0].capabilityId;
}

function failureDimension(expected, actual) {
    const entityWrong = JSON.stringify(expected.entityTypes) !== JSON.stringify(actual.entityTypes);
    const operationWrong = expected.operation !== actual.operation;
    if (entityWrong && operationWrong) return 'BOTH_WRONG';
    if (entityWrong) return 'ENTITY_DIMENSION_WRONG';
    if (operationWrong) return 'OPERATION_DIMENSION_WRONG';
    return expected.classRef === actual.classRef ? 'NONE' : 'TASK_CLASS_ONLY_MAPPING_WRONG';
}

function usableResolverEvidence(item) {
    return item?.type && item.type !== 'unknown' && item.match_type && item.match_type !== 'not_applicable';
}

function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildAudit() {
    const b2 = readJson(B2_DATASET);
    const p06 = readJson(P06_DATASET);
    if (b2.paths.length !== 15) throw new Error('Frozen B2 path count changed');
    if (V5_TASK_CLASS_CATALOG.length !== 27) throw new Error('Task Class count changed');

    const capabilities = listV5Capabilities();
    const classRows = V5_TASK_CLASS_CATALOG.map(item => ({
        class_ref: item.classRef,
        domain: item.domain,
        operation: item.operation,
        entity_types: [...item.entityTypes],
        projected_capability_candidates: capabilities
            .filter(capability => capability.exposableInV5B === true
                && capability.domain === item.domain
                && capability.operation === item.operation
                && capability.requiredEntityTypes.some(type => item.entityTypes.includes(type)))
            .map(capability => capability.capabilityId)
            .sort(),
    }));
    const domains = [...new Set(classRows.map(item => item.domain))].sort();
    const operations = [...new Set(classRows.map(item => item.operation))].sort();
    const entityTypes = [...new Set(classRows.flatMap(item => item.entity_types))].sort();

    const resolverEvidenceGroups = new Set();
    for (const sourceCase of p06) {
        const b2Path = b2.paths.find(item => item.case_id === sourceCase.case_id);
        if (!b2Path) continue;
        const observations = sourceCase.safe_structural_metadata?.entity_resolutions || [];
        if (observations.some(usableResolverEvidence)) resolverEvidenceGroups.add(b2Path.source_group_id);
    }

    const paths = b2.paths.map(item => {
        const authority = GROUP_CLASS_AUTHORITY[item.source_group_id];
        if (!authority) throw new Error(`Missing class authority for ${item.source_group_id}`);
        const expected = classByRef(authority.expected);
        const actual = classByRef(authority.actual);
        const expectedCapability = capabilityFor(expected);
        const actualCapability = capabilityFor(actual);
        const entityFiltered = V5_TASK_CLASS_CATALOG.filter(candidate => (
            candidate.entityTypes.some(type => expected.entityTypes.includes(type))
        ));
        if (item.task_class_match !== (expected.classRef === actual.classRef)) {
            throw new Error(`Frozen Task Class match disagrees for ${item.case_id}`);
        }
        return {
            case_id: item.case_id,
            source_group: item.source_group_id,
            expected_task_class: expected.classRef,
            actual_task_class: actual.classRef,
            expected_domain: expected.domain,
            actual_domain: actual.domain,
            expected_operation: expected.operation,
            actual_operation: actual.operation,
            expected_entity_type: expected.entityTypes[0],
            actual_entity_type: actual.entityTypes[0],
            span_correct: item.source_span_selection_status === 'MATCH',
            anchor_correct: item.anchor_status === 'ANCHORED',
            expected_capability: expectedCapability,
            actual_capability: actualCapability,
            dimension_failure: failureDimension(expected, actual),
            entity_filtered_candidate_count: entityFiltered.length,
            expected_class_survives_entity_filter: entityFiltered.some(candidate => candidate.classRef === expected.classRef),
            architecture_prevention: expected.classRef === actual.classRef ? null : {
                CURRENT_FLAT_V2: 'WOULD_NOT_PREVENT',
                A_PRE_RESOLVE_SPANS: entityFiltered.length === 1 ? 'WOULD_PREVENT' : 'MAY_PREVENT',
                B_TWO_STAGE_SPAN_ENTITY_LOCAL_INTENT: entityFiltered.length === 1 ? 'WOULD_PREVENT' : 'MAY_PREVENT',
                C_SINGLE_CALL_SPAN_OPERATION: 'WOULD_NOT_PREVENT',
                D_ENTITY_FIRST_LOCAL_OPERATION: entityFiltered.length === 1 ? 'WOULD_PREVENT' : 'MAY_PREVENT',
            },
            safe_reason_codes: expected.classRef === actual.classRef
                ? ['FROZEN_INTERPRETER_MATCH']
                : ['FLAT_TASK_CLASS_SELECTION_DIVERGENCE', 'ENTITY_FILTER_RETAINS_EXPECTED_CLASS'],
        };
    });

    const groups = Object.keys(GROUP_CLASS_AUTHORITY).map(sourceGroup => {
        const authority = GROUP_CLASS_AUTHORITY[sourceGroup];
        const expected = classByRef(authority.expected);
        const compatible = V5_TASK_CLASS_CATALOG.filter(item => item.entityTypes.some(type => expected.entityTypes.includes(type)));
        return {
            source_group: sourceGroup,
            expected_entity_type: expected.entityTypes[0],
            global_candidate_count: V5_TASK_CLASS_CATALOG.length,
            entity_filtered_candidate_count: compatible.length,
            entity_filtered_class_refs: compatible.map(item => item.classRef),
            expected_class: expected.classRef,
            expected_class_survives: compatible.some(item => item.classRef === expected.classRef),
            existing_resolver_evidence: resolverEvidenceGroups.has(sourceGroup),
        };
    });

    const resolverAdapterText = fs.readFileSync(RESOLVER_ADAPTER, 'utf8');
    const sourceSpanText = fs.readFileSync(SOURCE_SPAN, 'utf8');
    if (!resolverAdapterText.includes('formalResult is required; adapter never queries or writes business data')) {
        throw new Error('Resolver adapter side-effect contract changed');
    }
    if (!sourceSpanText.includes('const MAX_SOURCE_SPANS = 128')) throw new Error('Source Span maximum changed');

    const failures = paths.filter(item => item.dimension_failure !== 'NONE');
    const dimensionCounts = Object.fromEntries([
        'ENTITY_DIMENSION_WRONG',
        'OPERATION_DIMENSION_WRONG',
        'BOTH_WRONG',
        'TASK_CLASS_ONLY_MAPPING_WRONG',
    ].map(key => [key, failures.filter(item => item.dimension_failure === key).length]));
    const filterCounts = groups.map(item => item.entity_filtered_candidate_count);
    const supportedResolverTypes = Object.keys(V5_RESOLVER_INPUT_POLICIES).sort();

    return {
        schema_version: 1,
        audit: 'V5-E4R-E-A Entity-First Interpreter Architecture Audit',
        source_evaluation_variant: b2.evaluation_variant,
        frozen_path_count: paths.length,
        semantic_wrong_path_count: failures.length,
        failure_dimensions: dimensionCounts,
        task_class_factorization: {
            task_class_count: classRows.length,
            unique_domain_count: domains.length,
            unique_operation_count: operations.length,
            unique_entity_type_count: entityTypes.length,
            domains,
            operations,
            entity_types: entityTypes,
            classes: classRows,
            flat_class_coupling: true,
        },
        resolver_audit: {
            adapter: 'api/services/ai-v5/entityResolverAdapter.cjs',
            consumes_exact_raw_mention: true,
            requires_entity_type_hint: true,
            requires_external_formal_result: true,
            type_independent_resolution: false,
            read_only: true,
            uses_business_api: false,
            uses_internal_api_client: false,
            direct_db_read: false,
            write_side_effect: false,
            resolver_supported_entity_types: supportedResolverTypes,
            frozen_source_groups_with_existing_resolver_evidence: resolverEvidenceGroups.size,
            frozen_source_groups_total: groups.length,
        },
        candidate_reduction: {
            global_task_classes: V5_TASK_CLASS_CATALOG.length,
            median_entity_filtered_candidate_count: median(filterCounts),
            max_entity_filtered_candidate_count: Math.max(...filterCounts),
            expected_class_survival: `${paths.filter(item => item.expected_class_survives_entity_filter).length}/${paths.length}`,
            groups,
        },
        option_assessment: {
            A_PRE_RESOLVE_SPANS: {
                result: 'HIGH_COST',
                maximum_typed_resolution_attempts: MAX_SOURCE_SPANS * supportedResolverTypes.length,
                reason_codes: ['SPAN_TYPE_FANOUT', 'FORMAL_RESULT_NOT_OWNED_BY_V5_ADAPTER'],
            },
            B_TWO_STAGE_SPAN_ENTITY_LOCAL_INTENT: {
                result: 'PARTIAL',
                model_calls_per_request: 2,
                resolver_calls_per_request: '1 intended; unavailable with current typed formal-result adapter',
                stage_1_supported_by_frozen_span_evidence: true,
                reason_codes: ['SPAN_SELECTION_15_OF_15', 'TYPE_INDEPENDENT_RESOLVER_MISSING'],
            },
            C_SINGLE_CALL_SPAN_OPERATION: {
                result: 'NOT_SUPPORTED',
                global_operation_count: operations.length,
                reason_codes: ['FROZEN_OPERATION_ACCURACY_9_OF_15', 'ENTITY_AUTHORITY_STILL_MISSING'],
            },
            D_ENTITY_FIRST_LOCAL_OPERATION: {
                result: 'PARTIAL',
                reason_codes: ['SIGNIFICANT_CANDIDATE_REDUCTION', 'PRE_MODEL_ENTITY_AUTHORITY_MISSING'],
            },
        },
        architecture_decision: {
            flat_task_class_architecture_root_cause: 'CONFIRMED',
            recommended_architecture: 'TWO_STAGE_SPAN_ENTITY_LOCAL_INTENT',
            model_global_27_way_task_class_selection_removed: true,
            external_contract_v1_sufficient: true,
            source_anchor_decision: 'KEEP_EXACT',
            state_machine_revision_required: false,
            new_write_authority_introduced: false,
            multi_entity_compatible: 'PARTIAL',
            compound_request_extension: 'EASIER',
        },
        paths,
    };
}

if (require.main === module) {
    const audit = buildAudit();
    const summary = {
        frozenPaths: audit.frozen_path_count,
        semanticWrongPaths: audit.semantic_wrong_path_count,
        failureDimensions: audit.failure_dimensions,
        taskClassFactorization: {
            classCount: audit.task_class_factorization.task_class_count,
            domainCount: audit.task_class_factorization.unique_domain_count,
            operationCount: audit.task_class_factorization.unique_operation_count,
            entityTypeCount: audit.task_class_factorization.unique_entity_type_count,
        },
        candidateReduction: audit.candidate_reduction,
        resolverAudit: audit.resolver_audit,
        recommendation: audit.architecture_decision,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

module.exports = { buildAudit };
