'use strict';

const { createV5ToolResult } = require('./contracts.cjs');
const { addEvidence, createEvidenceLedger, toolResultToCandidateEvidence } = require('./evidenceLedger.cjs');
const { listEvidenceRequirements } = require('./evidenceRequirements.cjs');
const { verifyV5Task } = require('./verification.cjs');

const VERIFICATION_SYMPTOMS = new Set(['V01', 'V02', 'V03', 'V04']);
const TOOL_CAPABILITY = Object.freeze({
    search_coils: { capabilityId: 'coil.read', claimType: 'coil.inventory', entityType: 'coil' },
    search_parts: { capabilityId: 'inventory.read', claimType: 'inventory.quantity', entityType: 'part' },
    preview_recipe_cost: { capabilityId: 'recipe.cost.preview', claimType: 'recipe.cost.preview', entityType: 'recipe' },
});

function projectCase(item) {
    const expectedTool = item.expected?.primary_tool;
    const mapping = TOOL_CAPABILITY[expectedTool];
    if (!mapping) return { caseId: item.case_id, classification: 'INSUFFICIENT_DATA', correctlyClassified: null, verification: null };
    const taskId = `shadow:${item.case_id}`;
    const toolResult = createV5ToolResult({ taskId, toolName: expectedTool, status: 'success', data: null, operationRefs: [] });
    let ledger = createEvidenceLedger(taskId);
    const evidence = toolResultToCandidateEvidence(toolResult, {
        evidenceId: `evidence:${item.case_id}`,
        claimType: mapping.claimType,
        capabilityId: mapping.capabilityId,
        formalSourceValidated: true,
        sourceRef: `p06-structural:${item.case_id}`,
        freshness: 'CURRENT',
        entityConsistent: true,
        entityRef: { entityType: mapping.entityType, canonicalEntityId: `synthetic:${item.case_id}`, resolutionReceiptRef: `p06-structural:${item.case_id}` },
        createdAt: '2026-09-04T00:00:00.000Z',
    });
    ledger = addEvidence(ledger, evidence);
    const verification = verifyV5Task({
        ledger,
        requirements: listEvidenceRequirements(mapping.capabilityId),
        execution: { toolResults: [toolResult], requiredExecutionCount: 1, orchestrationComplete: item.result === 'PASS' },
    });
    const hasVerificationSymptom = (item.secondary_classes || []).some(code => VERIFICATION_SYMPTOMS.has(code));
    const classification = hasVerificationSymptom
        ? (item.failure_class ? 'DOWNSTREAM_SYMPTOM' : 'ROOT_CAUSE')
        : item.result === 'PASS' ? 'SUCCESS_CONTROL' : 'NOT_A_VERIFICATION_FAILURE';
    const correctlyClassified = item.result === 'PASS'
        ? verification.decision === 'VERIFIED'
        : verification.decision !== 'VERIFIED' && classification !== 'INSUFFICIENT_DATA';
    return { caseId: item.case_id, classification, correctlyClassified, verification };
}

function evaluateP06VerificationCases(cases = []) {
    const paths = cases.map(projectCase);
    const verificationFailures = paths.filter(item => ['ROOT_CAUSE', 'DOWNSTREAM_SYMPTOM', 'INSUFFICIENT_DATA'].includes(item.classification));
    const successControls = paths.filter(item => item.classification === 'SUCCESS_CONTROL');
    const c02 = cases.map((item, index) => ({ source: item, projected: paths[index] })).filter(item => item.source.failure_class === 'C02');
    return Object.freeze({
        paths: Object.freeze(paths),
        metrics: Object.freeze({
            verificationFailureCasesAnalyzed: verificationFailures.length,
            rootCauses: verificationFailures.filter(item => item.classification === 'ROOT_CAUSE').length,
            downstreamSymptoms: verificationFailures.filter(item => item.classification === 'DOWNSTREAM_SYMPTOM').length,
            insufficientData: verificationFailures.filter(item => item.classification === 'INSUFFICIENT_DATA').length,
            deterministicallyClassifiedCorrectly: verificationFailures.filter(item => item.correctlyClassified === true).length,
            unknown: verificationFailures.filter(item => item.correctlyClassified === null).length,
            c02CasesRechecked: c02.length,
            c02IncorrectlyCountedAsRootFix: c02.filter(item => item.projected.classification === 'ROOT_CAUSE').length,
            successControlCases: successControls.length,
            successControlsFalselyRejected: successControls.filter(item => item.verification?.decision !== 'VERIFIED').length,
        }),
    });
}

module.exports = { evaluateP06VerificationCases };
