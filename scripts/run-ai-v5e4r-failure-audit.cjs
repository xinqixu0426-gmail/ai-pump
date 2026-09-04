'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildToolCapabilityReverseIndex, getV5Capability } = require('../api/services/ai-v5/capabilityRegistry.cjs');

const root = path.resolve(__dirname, '..');
const frozenPath = path.join(root, 'docs', 'ai-observability', 'data', 'p06-failure-cases.json');
const publicP15Path = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4-independent-shadow-evaluation.json');
const outputPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-interpreter-failure-audit.json');

const CASES = Object.freeze({
    'coil-current-stock-real-provider': Object.freeze({ family: 'P06-COIL-001', sourceGroupId: 'COIL_INVENTORY', inputFingerprintGroup: 'INPUT_01' }),
    'current-cost-1': Object.freeze({ family: 'P06-EXACT-001', sourceGroupId: 'EXACT_RECIPE_COST', inputFingerprintGroup: 'INPUT_02' }),
    'flat-knife-800-1': Object.freeze({ family: 'P06-FLATBLADE-001', sourceGroupId: 'FLAT_BLADE_PRICE', inputFingerprintGroup: 'INPUT_03' }),
    'part-current-stock-real-provider': Object.freeze({ family: 'P06-INVENTORY-001', sourceGroupId: 'PART_INVENTORY_PRIMARY', inputFingerprintGroup: 'INPUT_04' }),
    'simple-current-1': Object.freeze({ family: 'P06-SIMPLE-001', sourceGroupId: 'PART_INVENTORY_REPEAT', inputFingerprintGroup: 'INPUT_04' }),
});
const PATHS = Object.freeze({ legacy_v3: 'LEGACY', v4_investigation: 'V4I', v4_r3: 'V4R3' });

function findEvidenceDirectory() {
    const explicit = process.env.PUMP_P15_WORK_DIR;
    if (explicit) return path.resolve(explicit);
    const candidates = fs.readdirSync(os.tmpdir(), { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.startsWith('pump-p15-real-'))
        .map(entry => path.join(os.tmpdir(), entry.name))
        .filter(directory => fs.existsSync(path.join(directory, 'interpretations'))
            && fs.existsSync(path.join(directory, 'reports')))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
    if (candidates.length === 0) throw new Error('P15 evidence directory not found');
    return candidates[0];
}

function expectedCapability(expected = {}) {
    const reverse = buildToolCapabilityReverseIndex();
    const ids = reverse[expected.primary_tool] || [];
    return ids.length === 1 ? getV5Capability(ids[0]) : null;
}

function firstDivergence(actual, expected) {
    if (actual.domain !== expected.domain) return 'MODEL_OUTPUT_DOMAIN';
    if (actual.operation !== expected.operation) return 'MODEL_OUTPUT_OPERATION';
    if (!expected.entityTypes.every(type => actual.entityTypes.includes(type))) return 'MODEL_OUTPUT_ENTITY_TYPE';
    if (!actual.entityAnchorStatuses.length || actual.entityAnchorStatuses.some(value => value !== 'ANCHORED')) {
        return 'SOURCE_ANCHOR';
    }
    if (actual.capabilityId !== expected.capabilityId) return 'CAPABILITY_ROUTER';
    if (!actual.allowedToolNames.includes(expected.expectedTool)) return 'TOOL_EXPOSURE';
    return 'NONE';
}

function rootCause(caseId, divergence) {
    if (divergence === 'NONE') return Object.freeze({ primary: 'NONE', secondary: [] });
    if (caseId.startsWith('P06-EXACT-001')) {
        const altered = !caseId.endsWith('V4R3');
        return Object.freeze({
            primary: 'PROMPT_FAILURE',
            secondary: altered
                ? ['MODEL_NONCOMPLIANCE', 'DOMAIN_TAXONOMY_FAILURE']
                : ['DOMAIN_TAXONOMY_FAILURE'],
        });
    }
    if (caseId.startsWith('P06-FLATBLADE-001')) {
        return Object.freeze({
            primary: 'DOMAIN_TAXONOMY_FAILURE',
            secondary: ['PROMPT_FAILURE'],
        });
    }
    return Object.freeze({
        primary: 'INSUFFICIENT_CONTEXT',
        secondary: ['PROMPT_FAILURE', 'ENTITY_TYPE_TAXONOMY_FAILURE'],
    });
}

function candidatePreservation(caseId, actual, publicCase) {
    if (publicCase.entityAnchorStatus === 'ANCHORED') return 'PRESERVED';
    if (caseId === 'P06-EXACT-001-LEGACY' || caseId === 'P06-EXACT-001-V4I') return 'ALTERED';
    if (caseId === 'P06-EXACT-001-V4R3' && actual.entityTypes.length === 0) return 'NOT_PROVIDED';
    return 'NOT_EVALUATED';
}

function confusionMatrix(cases, expectedKey, actualKey) {
    const counts = {};
    for (const item of cases.filter(value => !value.match_statuses[expectedKey])) {
        const expected = expectedKey === 'entity_type'
            ? item.expected.entity_types.join('+')
            : item.expected[expectedKey];
        const actual = actualKey === 'entity_types'
            ? (item.actual.entity_types.join('+') || 'NOT_AVAILABLE')
            : (item.actual[actualKey] || 'NOT_AVAILABLE');
        const key = `${expected}->${actual}`;
        counts[key] = (counts[key] || 0) + 1;
    }
    return Object.freeze(counts);
}

function reportRows(reportsDirectory) {
    const rows = new Map();
    for (const file of fs.readdirSync(reportsDirectory).filter(name => name.endsWith('.json'))) {
        const report = JSON.parse(fs.readFileSync(path.join(reportsDirectory, file), 'utf8'));
        for (const item of report.cases || []) {
            const mapping = CASES[item.caseKey];
            if (!mapping) continue;
            for (const [pathKey, suffix] of Object.entries(PATHS)) {
                const value = item.paths?.[pathKey];
                if (!value) continue;
                rows.set(`${mapping.family}-${suffix}`, Object.freeze({
                    v4Result: value.classification,
                    v4ActualTools: Object.freeze([...(value.capabilityIds || [])]),
                }));
            }
        }
    }
    return rows;
}

function interpretationRows(interpretationsDirectory) {
    const rows = new Map();
    for (const file of fs.readdirSync(interpretationsDirectory).filter(name => name.endsWith('.json'))) {
        const records = JSON.parse(fs.readFileSync(path.join(interpretationsDirectory, file), 'utf8'));
        for (const record of records) {
            const [caseKey, suffix] = String(record.caseId).split(':');
            const mapping = CASES[caseKey];
            if (!mapping || !suffix) continue;
            rows.set(`${mapping.family}-${suffix}`, Object.freeze({
                mapping,
                independent: record.independent,
            }));
        }
    }
    return rows;
}

function safeOutput(actual) {
    return Object.freeze({
        domain: actual.domain,
        operation: actual.operation,
        entity_types: Object.freeze([...(actual.entityTypes || [])]),
        anchor_statuses: Object.freeze([...(actual.entityAnchorStatuses || [])]),
        capability: actual.capabilityId,
        exposed_tools: Object.freeze([...(actual.allowedToolNames || [])]),
    });
}

function buildAudit(evidenceDirectory) {
    const frozen = JSON.parse(fs.readFileSync(frozenPath, 'utf8'));
    const publicP15 = JSON.parse(fs.readFileSync(publicP15Path, 'utf8'));
    const currentById = reportRows(path.join(evidenceDirectory, 'reports'));
    const actualById = interpretationRows(path.join(evidenceDirectory, 'interpretations'));
    const publicById = new Map(publicP15.paths.map(item => [item.case_id, item]));
    const frozenById = new Map(frozen.map(item => [item.case_id, item]));
    const caseIds = publicP15.paths.map(item => item.case_id).sort();
    const cases = caseIds.map(caseId => {
        const frozenCase = frozenById.get(caseId);
        const current = currentById.get(caseId);
        const actualRecord = actualById.get(caseId);
        if (!frozenCase || !current || !actualRecord) throw new Error(`Missing P15 evidence for ${caseId}`);
        const capability = expectedCapability(frozenCase.expected);
        if (!capability) throw new Error(`Expected capability is not uniquely mapped for ${caseId}`);
        const expected = Object.freeze({
            domain: capability.domain,
            operation: capability.operation,
            entity_types: Object.freeze([...capability.requiredEntityTypes]),
            capability: capability.capabilityId,
            tool: frozenCase.expected.primary_tool,
        });
        const actual = actualRecord.independent;
        const expectedInternal = {
            domain: expected.domain,
            operation: expected.operation,
            entityTypes: expected.entity_types,
            capabilityId: expected.capability,
            expectedTool: expected.tool,
        };
        const divergence = firstDivergence(actual, expectedInternal);
        const causes = rootCause(caseId, divergence);
        const publicCase = publicById.get(caseId);
        return Object.freeze({
            case_id: caseId,
            source_group_id: actualRecord.mapping.sourceGroupId,
            input_fingerprint_group: actualRecord.mapping.inputFingerprintGroup,
            runtime_variant: caseId.split('-').at(-1),
            v4_result: current.v4Result,
            p15_interpreter_status: actual.interpreterStatus,
            expected,
            actual: safeOutput(actual),
            v4_actual_tools: Object.freeze([...current.v4ActualTools]),
            match_statuses: Object.freeze({
                domain: publicCase.domainMatch,
                operation: publicCase.operationMatch,
                entity_type: publicCase.entityTypeMatch,
                anchor: publicCase.entityAnchorStatus === 'ANCHORED',
                capability: publicCase.capabilityMatch,
                expected_tool_exposed: publicCase.expectedToolExposed,
                wrong_tool_excluded: publicCase.wrongToolExcluded,
            }),
            candidate_preservation: candidatePreservation(caseId, actual, publicCase),
            first_interpreter_divergence: divergence,
            primary_root_cause: causes.primary,
            secondary_root_causes: causes.secondary,
            safe_reason_codes: Object.freeze([...publicCase.safeReasonCodes]),
        });
    });
    const failureCases = cases.filter(item => item.first_interpreter_divergence !== 'NONE');
    const primaryRootCauses = {};
    for (const item of failureCases) {
        primaryRootCauses[item.primary_root_cause] = (primaryRootCauses[item.primary_root_cause] || 0) + 1;
    }
    const modelNoncomplianceCount = failureCases.filter(item => item.secondary_root_causes.includes('MODEL_NONCOMPLIANCE')).length;
    const validButWrongCount = failureCases.filter(item => item.p15_interpreter_status === 'VALID').length;
    const sourceGroups = [...new Set(cases.map(item => item.source_group_id))];
    const strictGroupAccuracy = key => {
        const correct = sourceGroups.filter(group => cases
            .filter(item => item.source_group_id === group)
            .every(item => item.match_statuses[key])).length;
        return Object.freeze({ correct, total: sourceGroups.length, rate: correct / sourceGroups.length });
    };
    const signaturesByGroup = Object.fromEntries(sourceGroups.map(group => {
        const signatures = new Set(cases.filter(item => item.source_group_id === group).map(item => JSON.stringify(item.actual)));
        return [group, Object.freeze({ consistent: signatures.size === 1, distinct_structured_outputs: signatures.size })];
    }));
    return Object.freeze({
        schema_version: 1,
        frozen_p15_commit: '009b50547a1c3d690b7b01f86545b49183959dcd',
        cases: Object.freeze(cases),
        metrics: Object.freeze({
            cases_audited: cases.length,
            source_case_groups: sourceGroups.length,
            distinct_input_fingerprint_groups: new Set(cases.map(item => item.input_fingerprint_group)).size,
            path_accuracy: Object.freeze({
                domain: publicP15.metrics.domainAccuracy,
                operation: publicP15.metrics.operationAccuracy,
                entity_type: publicP15.metrics.entityTypeAccuracy,
                anchor: publicP15.metrics.entityAnchorAccuracy,
                capability: publicP15.metrics.capabilityRoutingAccuracy,
                expected_tool_exposure: publicP15.metrics.expectedToolExposureAccuracy,
            }),
            strict_source_group_accuracy: Object.freeze({
                domain: strictGroupAccuracy('domain'),
                operation: strictGroupAccuracy('operation'),
                entity_type: strictGroupAccuracy('entity_type'),
                anchor: strictGroupAccuracy('anchor'),
                capability: strictGroupAccuracy('capability'),
                expected_tool_exposure: strictGroupAccuracy('expected_tool_exposed'),
            }),
            valid_but_wrong_count: validButWrongCount,
            invalid_output_count: cases.filter(item => item.p15_interpreter_status === 'INVALID').length,
            model_noncompliance_count: modelNoncomplianceCount,
            primary_root_causes: Object.freeze(primaryRootCauses),
            confusion_matrices: Object.freeze({
                domain: confusionMatrix(cases, 'domain', 'domain'),
                operation: confusionMatrix(cases, 'operation', 'operation'),
                entity_type: confusionMatrix(cases, 'entity_type', 'entity_types'),
            }),
            correct_tuple_router_failures: failureCases.filter(item => item.first_interpreter_divergence === 'CAPABILITY_ROUTER').length,
            correct_capability_exposure_failures: failureCases.filter(item => item.first_interpreter_divergence === 'TOOL_EXPOSURE').length,
            observed_consistency: Object.freeze(signaturesByGroup),
        }),
    });
}

function main() {
    const evidenceDirectory = findEvidenceDirectory();
    const audit = buildAudit(evidenceDirectory);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
        status: 'completed',
        casesAudited: audit.metrics.cases_audited,
        sourceCaseGroups: audit.metrics.source_case_groups,
        distinctInputFingerprintGroups: audit.metrics.distinct_input_fingerprint_groups,
        validButWrong: audit.metrics.valid_but_wrong_count,
        invalidOutputs: audit.metrics.invalid_output_count,
        modelCalls: 0,
        toolCalls: 0,
        businessApiCalls: 0,
        writes: 0,
        output: outputPath,
    })}\n`);
}

if (require.main === module) {
    try { main(); } catch (error) {
        process.stderr.write(`${JSON.stringify({ status: 'failed', errorType: error.name, message: error.message })}\n`);
        process.exitCode = 1;
    }
}

module.exports = { buildAudit };
