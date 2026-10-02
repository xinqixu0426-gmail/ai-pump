'use strict';

const fs = require('fs');

function median(values) { const sorted = [...values].sort((left, right) => left - right); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }
function mergeSmokeEvidence({ inputPaths, outputPath }) {
    const chunks = inputPaths.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
    const results = chunks.flatMap(chunk => chunk.results || []);
    const ids = new Set();
    for (const result of results) {
        if (ids.has(result.id)) throw new Error(`DUPLICATE_SMOKE_CASE:${result.id}`);
        ids.add(result.id);
    }
    const first = chunks[0];
    const output = Object.freeze({
        ...first,
        scope: 'full',
        modelCalls: Object.freeze({ requirement: results.reduce((sum, item) => sum + item.modelCalls.requirementPlanner, 0), planCompiler: 0, upstream: results.reduce((sum, item) => sum + (item.upstream.upstreamModelCalls ? Object.values(item.upstream.upstreamModelCalls).reduce((inner, value) => inner + value, 0) : 0), 0), total: results.reduce((sum, item) => sum + item.modelCalls.requirementPlanner + (item.upstream.upstreamModelCalls ? Object.values(item.upstream.upstreamModelCalls).reduce((inner, value) => inner + value, 0) : 0), 0) }),
        requirementMetrics: Object.freeze({ pass: results.filter(item => item.evaluation.requirement.overall === 'PASS').length, fail: results.filter(item => item.evaluation.requirement.overall === 'FAIL').length }),
        compilerMetrics: Object.freeze({ pass: results.filter(item => item.evaluation.compiler.overall === 'PASS').length, fail: results.filter(item => item.evaluation.compiler.overall === 'FAIL').length }),
        planValidationMetrics: Object.freeze({ finalPass: results.filter(item => item.evaluation.overall === 'PASS').length, finalFail: results.filter(item => item.evaluation.overall === 'FAIL').length, validatedPlanPass: results.filter(item => item.validation.validationStatus === 'VALID').length, planContractViolations: results.reduce((sum, item) => sum + item.validation.violations.length, 0), compilerModelCalls: 0, capabilityTargetTypeMismatches: results.reduce((sum, item) => sum + item.validation.violations.filter(violation => violation.code === 'CAPABILITY_OUTPUT_MISMATCH').length, 0), statusGroundingContradictions: results.reduce((sum, item) => sum + item.validation.violations.filter(violation => violation.code === 'STATUS_GROUNDING_CONTRADICTION').length, 0), blockedRequiredFactViolations: results.reduce((sum, item) => sum + item.validation.violations.filter(violation => violation.code === 'BLOCKED_REQUIRED_FACT_VIOLATION').length, 0), multiOutputStepCount: results.reduce((sum, item) => sum + item.rawPlan.steps.filter(step => String(step.produces).includes(',')).length, 0) }),
        performance: Object.freeze({ requirementPlannerMedianMs: median(results.map(item => item.timings.requirementPlannerMs)), planCompilerMedianMs: median(results.map(item => item.timings.planCompilerMs)), businessMedianMs: median(results.map(item => item.upstream.upstreamTimings?.businessMs || 0).filter(Boolean)), policyMedianMs: median(results.map(item => item.upstream.upstreamTimings?.policyMs || 0).filter(Boolean)), groundingMedianMs: median(results.map(item => item.upstream.upstreamTimings?.totalMs || 0).filter(Boolean)), totalRealChainMedianMs: median(results.filter(item => item.upstream.upstreamTimings).map(item => item.timings.requirementPlannerMs + item.upstream.upstreamTimings.totalMs)), totalMedianMs: median(results.map(item => item.timings.requirementPlannerMs + (item.upstream.upstreamTimings?.totalMs || 0))) }),
        results: Object.freeze(results),
    });
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return output;
}

module.exports = { mergeSmokeEvidence };
