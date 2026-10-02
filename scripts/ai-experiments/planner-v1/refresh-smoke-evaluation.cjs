'use strict';

const fs = require('fs');
const { BASE_CASES, NEGATIVE_CASES } = require('./cases.cjs');
const { evaluatePlannerCase } = require('./plannerEvaluator.cjs');
const { compilePlan } = require('./planCompiler.cjs');
const { validatePlanContract } = require('./planContractValidator.cjs');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { buildPlannerContext } = require('./plannerContext.cjs');
const { parseRequirementMemo } = require('./requirementMemo.cjs');
const { validateRequirementMemo } = require('./requirementValidator.cjs');

function refreshSmokeEvaluation(filePath) {
    const output = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const cases = new Map([...BASE_CASES, ...NEGATIVE_CASES].map(testCase => [testCase.id, testCase]));
    const baseCatalog = createPlannerCapabilityCatalogSnapshot();
    const results = output.results.map(result => {
        const testCase = cases.get(result.id);
        const omitted = new Set(testCase.catalogOmit || []);
        const capabilityCatalog = Object.freeze({ ...baseCatalog, visibleCapabilities: Object.freeze(baseCatalog.visibleCapabilities.filter(capability => !omitted.has(capability.capabilityId))), plannerVisibleCapabilityCount: baseCatalog.visibleCapabilities.filter(capability => !omitted.has(capability.capabilityId)).length });
        const context = buildPlannerContext({ rawOwnerInput: result.user, upstream: result.upstream, capabilityCatalog });
        const requirement = parseRequirementMemo(result.requirementMemo);
        const requirementValidation = validateRequirementMemo({ requirement, context });
        const rawPlan = compilePlan({ requirement, context });
        const validation = validatePlanContract({ plan: rawPlan, context });
        const refreshedResult = Object.freeze({ ...result, context, requirement, requirementValidation, rawPlan, plan: rawPlan, validation, validatedPlan: validation.validatedPlan });
        return Object.freeze({ ...refreshedResult, evaluation: evaluatePlannerCase(testCase, refreshedResult) });
    });
    const validation = results.map(item => item.validation);
    const refreshed = Object.freeze({
        ...output,
        requirementMetrics: Object.freeze({ pass: results.filter(item => item.evaluation.requirement.overall === 'PASS').length, fail: results.filter(item => item.evaluation.requirement.overall === 'FAIL').length }),
        compilerMetrics: Object.freeze({ pass: results.filter(item => item.evaluation.compiler.overall === 'PASS').length, fail: results.filter(item => item.evaluation.compiler.overall === 'FAIL').length }),
        planValidationMetrics: Object.freeze({ ...output.planValidationMetrics, finalPass: results.filter(item => item.evaluation.overall === 'PASS').length, finalFail: results.filter(item => item.evaluation.overall === 'FAIL').length, validatedPlanPass: validation.filter(item => item.validationStatus === 'VALID').length, planContractViolations: validation.reduce((sum, item) => sum + item.violations.length, 0), capabilityTargetTypeMismatches: validation.reduce((sum, item) => sum + item.violations.filter(violation => violation.code === 'CAPABILITY_OUTPUT_MISMATCH').length, 0), statusGroundingContradictions: validation.reduce((sum, item) => sum + item.violations.filter(violation => violation.code === 'STATUS_GROUNDING_CONTRADICTION').length, 0), blockedRequiredFactViolations: validation.reduce((sum, item) => sum + item.violations.filter(violation => violation.code === 'BLOCKED_REQUIRED_FACT_VIOLATION').length, 0) }),
        results: Object.freeze(results),
    });
    fs.writeFileSync(filePath, `${JSON.stringify(refreshed, null, 2)}\n`, 'utf8');
    return refreshed;
}

module.exports = { refreshSmokeEvaluation };
