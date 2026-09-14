const { hasVerifiedExecution } = require('./aiExecutionEvidence.cjs');

const EVIDENCE_BUNDLE_VERSION = 1;

function text(value) {
    return String(value ?? '').trim();
}

function successfulVerifiedResult(item) {
    return Boolean(item?.result?.success !== false && hasVerifiedExecution(item.result));
}

function configuredBomEvidence(item) {
    if (item?.name !== 'build_recipe_bom_draft' || !successfulVerifiedResult(item)) return null;
    const data = item.result.data || {};
    const parts = Array.isArray(data.parts) ? data.parts : [];
    const shell = parts.find(part => (
        part?.source === 'pump_shell_template'
        || part?.costRole === 'stainlessShellBundle'
    ));
    const coil = parts.find(part => part?.costRole === 'coil');
    const floatParts = parts.filter(part => part?.costRole === 'float');
    const packingParts = parts.filter(part => part?.costRole === 'packing');
    const preview = data.costPreview || {};
    return {
        toolName: item.name,
        templateModel: text(shell?.model),
        coilModel: text(coil?.model),
        hasFloat: floatParts.length > 0,
        floatModels: floatParts.map(part => text(part.model || part.name)).filter(Boolean),
        packingModels: packingParts.map(part => text(part.model || part.name)).filter(Boolean),
        totalCost: Number.isFinite(Number(preview.currentTotalCost)) ? Number(preview.currentTotalCost) : null,
        partsCost: Number.isFinite(Number(preview.partsCost)) ? Number(preview.partsCost) : null,
        laborCost: Number.isFinite(Number(preview.laborCost)) ? Number(preview.laborCost) : null,
        pricingComplete: preview.pricingComplete === true,
        configurationBasis: data.configurationBasis || null,
    };
}

function knowledgeEvidence(item) {
    if (item?.name !== 'search_factory_knowledge' || !successfulVerifiedResult(item)) return null;
    const statements = Array.isArray(item.result?.answerGuidance?.businessRuleStatements)
        ? item.result.answerGuidance.businessRuleStatements.map(text).filter(Boolean)
        : [];
    if (!statements.length) return null;
    return {
        toolName: item.name,
        query: text(item.args?.query),
        statements,
        sources: Array.isArray(item.result.sources) ? item.result.sources : [],
    };
}

function buildEvidenceBundle(task, toolResults = []) {
    const verifiedTools = toolResults.filter(successfulVerifiedResult);
    const configuredBom = verifiedTools.map(configuredBomEvidence).find(Boolean) || null;
    const knowledge = verifiedTools.map(knowledgeEvidence).filter(Boolean);
    return {
        version: EVIDENCE_BUNDLE_VERSION,
        taskVersion: task?.version || null,
        presentation: task?.presentation || 'conversation',
        configuredBom,
        knowledge,
        verifiedToolNames: [...new Set(verifiedTools.map(item => item.name))],
        warnings: verifiedTools.flatMap(item => Array.isArray(item.result?.warnings) ? item.result.warnings : []),
    };
}

module.exports = {
    EVIDENCE_BUNDLE_VERSION,
    buildEvidenceBundle,
    configuredBomEvidence,
    knowledgeEvidence,
};
