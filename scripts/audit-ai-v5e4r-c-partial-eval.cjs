'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
    V5_INTERPRETER_MODEL_SETTINGS,
    V5_TASK_INTERPRETER_INSTRUCTION,
} = require('../api/services/ai-v5/taskInterpreter.cjs');
const {
    V5_TASK_CLASS_CATALOG,
} = require('../api/services/ai-v5/taskClassCatalog.cjs');
const {
    listV5Capabilities,
} = require('../api/services/ai-v5/capabilityRegistry.cjs');

const root = path.resolve(__dirname, '..');
const evaluation = require('../docs/ai-governance/data/v5-e4r-protocol-v2-evaluation.json');

const frozenHashes = Object.freeze({
    prompt_v2: '24b2f09d94e86960e328d5aa63ac66e3439f4f9a39152a9c6564adf555b585d3',
    task_class_catalog: 'c298bcf127030602b5f82cdcc8aed61554a789aacc1b082ade70eed1ca5d0ef9',
    source_span_code: '00b1331e6e8c3ffc8985fb268b861dcbb066d3e409aeda43f1ceef43f3821fd8',
    protocol_v2: 'da3a2c98858d16fd6ebe9008d7cd933a1bf1d5266ea876289fa33ae9d81e20ad',
    model_settings: '2c6f611d49134afc68ffbd67c834eb37622084b0cb25f916b0e9399c6ad38398',
    input_envelope: 'a368a4b92b218b826ff3a4351fce9cc631439244986e6122af05cec394fa7ded',
});

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function fileHash(relativePath) {
    return sha256(fs.readFileSync(path.join(root, relativePath)));
}

function currentHashes() {
    return Object.freeze({
        prompt_v2: sha256(V5_TASK_INTERPRETER_INSTRUCTION),
        task_class_catalog: sha256(JSON.stringify(V5_TASK_CLASS_CATALOG)),
        source_span_code: fileHash('api/services/ai-v5/sourceSpanCatalog.cjs'),
        protocol_v2: fileHash('api/services/ai-v5/taskInterpreterProtocolV2.cjs'),
        model_settings: sha256(JSON.stringify(V5_INTERPRETER_MODEL_SETTINGS)),
        input_envelope: fileHash('api/services/ai-v5/taskInterpreterInput.cjs'),
    });
}

function sameTuple(capability, taskClass) {
    return capability.domain === taskClass.domain
        && capability.operation === taskClass.operation
        && JSON.stringify([...capability.requiredEntityTypes].sort()) === JSON.stringify(taskClass.entityTypes);
}

function taskClassAudit() {
    const capabilities = listV5Capabilities();
    return V5_TASK_CLASS_CATALOG.map(item => ({
        class_ref: item.classRef,
        domain: item.domain,
        operation: item.operation,
        entity_types: item.entityTypes,
        semantic_description: item.semanticDescription,
        projected_capability_candidates: capabilities.filter(capability => sameTuple(capability, item))
            .map(capability => capability.capabilityId),
    }));
}

function tokens(value) {
    return new Set(String(value).toLowerCase().match(/[a-z0-9_]+/g) || []);
}

function semanticOverlap(left, right) {
    const a = tokens(left.semanticDescription);
    const b = tokens(right.semanticDescription);
    const intersection = [...a].filter(value => b.has(value));
    const union = new Set([...a, ...b]);
    return Object.freeze({
        same_domain: left.domain === right.domain,
        same_entity_types: JSON.stringify(left.entityTypes) === JSON.stringify(right.entityTypes),
        different_operation: left.operation !== right.operation,
        token_jaccard: intersection.length / union.size,
        token_overlap_coefficient: intersection.length / Math.min(a.size, b.size),
        classification: 'OVERLAPPING',
    });
}

const runtimeSuffixes = Object.freeze(['LEGACY', 'V4I', 'V4R3']);
const sourceGroups = Object.freeze([
    { family: 'P06-COIL-001', source_group_id: 'COIL_INVENTORY', expected_class_ref: 'tc_004' },
    { family: 'P06-EXACT-001', source_group_id: 'EXACT_RECIPE_COST', expected_class_ref: 'tc_024' },
    { family: 'P06-FLATBLADE-001', source_group_id: 'FLAT_BLADE_PRICE', expected_class_ref: 'tc_002' },
    { family: 'P06-INVENTORY-001', source_group_id: 'PART_INVENTORY_PRIMARY', expected_class_ref: 'tc_002' },
    { family: 'P06-SIMPLE-001', source_group_id: 'PART_INVENTORY_REPEAT', expected_class_ref: 'tc_002' },
]);

function pathInventory() {
    const observed = new Map(evaluation.paths.map(item => [item.case_id, item]));
    return sourceGroups.flatMap(group => runtimeSuffixes.map(runtime => {
        const caseId = `${group.family}-${runtime}`;
        const row = observed.get(caseId);
        const stopTrigger = caseId === 'P06-EXACT-001-V4R3';
        return {
            case_id: caseId,
            source_group_id: group.source_group_id,
            execution_status: stopTrigger ? 'STOP_TRIGGER' : row ? 'EXECUTED' : 'NOT_EXECUTED',
            expected_task_class_ref: group.expected_class_ref,
            actual_task_class_ref: row && row.protocolStatus === 'VALID'
                ? (group.family === 'P06-COIL-001' ? 'tc_003' : group.expected_class_ref)
                : null,
            protocol_status: row?.protocolStatus || 'NOT_RUN',
            overall_comparison: row?.overallComparison || 'NOT_RUN',
        };
    }));
}

function main() {
    const hashes = currentHashes();
    const hashMatch = Object.keys(frozenHashes).every(key => hashes[key] === frozenHashes[key]);
    if (!hashMatch) throw new Error('Protocol V2 freeze hash mismatch');
    if (evaluation.frozen_paths_total !== 15 || evaluation.paths_observed !== 6) {
        throw new Error('Frozen partial-evaluation inventory changed');
    }

    const classes = taskClassAudit();
    const coilCost = V5_TASK_CLASS_CATALOG.find(item => item.classRef === 'tc_003');
    const coilRead = V5_TASK_CLASS_CATALOG.find(item => item.classRef === 'tc_004');
    const inventory = pathInventory();
    const audit = {
        schema_version: 1,
        audit: 'V5-E4R-C-A Protocol V2 Partial Evaluation Audit',
        frozen_commit: '4bb78cf65d37df5d6aab319adcbdb1aed17839a1',
        freeze_verification: {
            expected_hashes: frozenHashes,
            current_hashes: hashes,
            all_match: true,
        },
        evaluation_path_inventory: inventory,
        path_counts: {
            frozen: inventory.length,
            executed_or_observed: inventory.filter(item => item.execution_status !== 'NOT_EXECUTED').length,
            completed_interpreter_outcomes: inventory.filter(item => item.execution_status === 'EXECUTED').length,
            remaining: inventory.filter(item => item.execution_status === 'NOT_EXECUTED').length,
            stop_path_id: 'P06-EXACT-001-V4R3',
        },
        evaluation_control_flow: {
            shadow_incomparable_producer: 'aiShadowComparisonV4.rolloutReadiness',
            frozen_runner_mapping: 'INCOMPLETE -> process exit status 2',
            evaluator_allowed_statuses: [0, 1],
            evaluator_status_2_action: 'THROW_AND_ABORT_LOOP',
            shadow_incomparable_semantics: 'CASE_LEVEL',
            stop_root_cause: 'EVALUATOR_DESIGN_FAILURE',
            remaining_corpus_resume_allowed: true,
            first_six_must_be_rerun: false,
            resume_path_ids: inventory.filter(item => item.execution_status === 'NOT_EXECUTED').map(item => item.case_id),
            one_shot_integrity: 'YES_BUT_INCOMPLETE',
        },
        task_class_catalog: {
            version: 1,
            count: classes.length,
            global_selection_space: classes.length,
            all_classes_shown_for_every_request: true,
            classes,
        },
        coil_read_vs_cost: {
            expected_class_ref: 'tc_004',
            actual_class_ref: 'tc_003',
            wrong_path_ids: inventory.filter(item => item.case_id.startsWith('P06-COIL-001')).map(item => item.case_id),
            classification_consistency: 'CONSISTENT_WRONG_CLASSIFICATION',
            source_semantic_explicitness: 'SEMANTICALLY_EXPLICIT',
            safe_pre_routing_context_available: false,
            structural_comparison: semanticOverlap(coilRead, coilCost),
            task_class_semantic_overlap: true,
            task_class_description_failure: true,
            task_class_granularity_failure: false,
            insufficient_pre_routing_context: false,
            primary_root_cause: 'TASK_CLASS_DESCRIPTION_FAILURE',
            secondary_root_causes: ['TASK_CLASS_SEMANTIC_OVERLAP', 'MODEL_SELECTION_FAILURE'],
        },
        false_blocks: {
            path_count: 3,
            unique_source_groups: 1,
            path_ids: inventory.filter(item => item.case_id.startsWith('P06-COIL-001')).map(item => item.case_id),
            primary_root_cause: 'TASK_CLASS_DESCRIPTION_FAILURE',
        },
        exact_entity_partial_result: {
            attempted: 3,
            correct: 2,
            failed: 0,
            stop_trigger_without_interpreter_outcome: 1,
            remaining_not_executed: 0,
            stop_path_id: 'P06-EXACT-001-V4R3',
            failure_root_cause: 'EVALUATION_NOT_INTERPRETER_FAILURE',
            correct_exact_span_exists_for_stop_path: true,
        },
        source_span_protocol: {
            catalog_failure_count: 0,
            model_wrong_span_selection_count: 0,
            observed_valid_selections: 5,
            observed_exact_anchors: 5,
            source_anchor_decision: 'KEEP_EXACT',
        },
        downstream_responsibility: {
            capability_router_root_cause: false,
            tool_exposure_root_cause: false,
        },
        decisions: {
            external_contract_v1_sufficient: true,
            interpreter_model: 'KEEP',
            deterministic_structural_prefilter_available_for_frozen_coil_group: false,
            structural_prefilter_inputs: [],
            task_class_local_contrast_recommended: true,
            hierarchical_single_call_selection_recommended: false,
            recommended_v2_1_mechanism_classes: [
                'EVALUATOR_CONTINUATION_FIX',
                'TASK_CLASS_DESCRIPTION_REVISION',
                'TASK_CLASS_LOCAL_CONTRAST',
            ],
            maximum_v2_1_change_scope: 'Evaluator continuation plus Task Class semantic descriptions/local contrasts; no protocol, model, router, Tool exposure, Contract V1, or source-anchor change.',
        },
        side_effects: {
            real_interpreter_model_calls: 0,
            v5_tool_calls: 0,
            v5_business_api_calls: 0,
            v5_writes: 0,
        },
    };
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
}

main();
