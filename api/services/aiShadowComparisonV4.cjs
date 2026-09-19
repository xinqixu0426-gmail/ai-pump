const { getAiCapability } = require('../capabilities/registry.cjs');
const {
    buildExpectedClaimSet,
    evaluateArchitectureAcceptanceCase,
} = require('./aiArchitectureAcceptanceV4.cjs');
const { buildClaimsFromInvestigation } = require('./aiClaimGroundingV4.cjs');
const { buildAnswerPlan, formatAnswerPlanDeterministically } = require('./aiGroundedAnswerV4.cjs');
const { replayReadInvestigationProjection } = require('./aiReadInvestigationRuntimeV4.cjs');

const SHADOW_PATHS = Object.freeze({
    LEGACY: 'legacy_v3',
    V4_INVESTIGATION: 'v4_investigation',
    V4_R3: 'v4_r3',
});
const PATH_ORDER = Object.freeze(Object.values(SHADOW_PATHS));
const PATH_CLASSIFICATIONS = new Set(['PASS', 'FAIL', 'UNAVAILABLE', 'NEEDS_CLARIFICATION']);
const COMPARISON_CLASSIFICATIONS = new Set([
    'V4_R3_BETTER',
    'V4_R3_EQUAL',
    'V4_R3_WORSE',
    'BOTH_FAIL',
    'INCOMPARABLE',
]);

function immutable(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(immutable));
    if (!value || typeof value !== 'object') return value;
    return Object.freeze(Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, immutable(nested)])
    ));
}

function finiteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function ratio(numerator, denominator) {
    return immutable({
        numerator,
        denominator,
        rate: denominator === 0 ? null : Number((numerator / denominator).toFixed(6)),
    });
}

function percentile(values, quantile) {
    const sorted = values.map(value => finiteNumber(value)).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
    return sorted[index];
}

function average(values) {
    if (values.length === 0) return null;
    return Number((values.reduce((sum, value) => sum + finiteNumber(value), 0) / values.length).toFixed(3));
}

function envForShadowPath(path, baseEnv = {}) {
    if (!PATH_ORDER.includes(path)) throw new TypeError(`未知 shadow path: ${path}`);
    return Object.freeze({
        ...baseEnv,
        AI_READ_INVESTIGATION_V4_ENABLED: path === SHADOW_PATHS.LEGACY ? 'false' : 'true',
        AI_CLAIM_GROUNDING_V4_ENABLED: path === SHADOW_PATHS.V4_R3 ? 'true' : 'false',
        AI_READ_INVESTIGATION_V4_SHADOW_ENABLED: 'false',
    });
}

function assertReadOnlyShadowCase(testCase) {
    if (!testCase || !['query', 'analysis'].includes(testCase.mode)) {
        throw new TypeError('R4-B shadow 只允许 query/analysis case');
    }
    if (testCase.writeBoundary !== 'read_only') {
        throw new TypeError('R4-B shadow case 必须声明 read_only');
    }
    const allowedClasses = new Set(testCase.allowedCapabilityClasses || []);
    if ([...allowedClasses].some(item => !['query', 'preview'].includes(item))) {
        throw new TypeError('R4-B shadow 只允许 Query 或无副作用 Preview');
    }
    for (const name of testCase.optionalAllowedCapabilities || []) {
        if (getAiCapability(name)?.access === 'write') {
            throw new TypeError(`R4-B shadow allowlist 暴露写能力: ${name}`);
        }
    }
    return true;
}

function capabilityNames(runtimeResult = {}) {
    return [...new Set([
        ...(runtimeResult.toolResults || []).map(item => item?.name),
        ...(runtimeResult.telemetry?.toolSteps || []).map(item => item?.capabilityName),
    ].filter(Boolean))];
}

function writeExposureNames(runtimeResult = {}) {
    return capabilityNames(runtimeResult).filter(name => getAiCapability(name)?.access === 'write');
}

function hasConfirmationState(runtimeResult = {}) {
    return runtimeResult.telemetry?.outcome === 'confirmation'
        || (runtimeResult.toolResults || []).some(item => (
            item?.result?.requiresConfirmation === true
            || item?.result?.confirmationToken
            || item?.result?.operation?.status === 'pending_confirmation'
        ));
}

function projectedInvestigation(runtimeResult, testCase) {
    if (runtimeResult.investigationState) {
        return Object.freeze({
            state: runtimeResult.investigationState,
            observations: runtimeResult.observations || runtimeResult.investigationState.observations || [],
            evidenceLedger: runtimeResult.evidenceLedger || [],
        });
    }
    return replayReadInvestigationProjection({
        intent: runtimeResult.intent,
        originalTarget: testCase.userQuestion,
        observations: runtimeResult.observations,
        evidenceRecords: runtimeResult.evidenceLedger,
    });
}

function actualForArchitecture(path, runtimeResult, testCase) {
    const projection = projectedInvestigation(runtimeResult, testCase);
    if (!projection?.state) {
        const error = new Error('runtime 结果无法投影为 InvestigationState');
        error.code = 'SHADOW_INVESTIGATION_PROJECTION_UNAVAILABLE';
        throw error;
    }
    const { state, observations, evidenceLedger } = projection;
    const claims = path === SHADOW_PATHS.V4_R3 && Array.isArray(runtimeResult.claims)
        ? runtimeResult.claims
        : buildClaimsFromInvestigation({ state, observations, evidenceLedger });
    const answerPlan = path === SHADOW_PATHS.V4_R3 && runtimeResult.answerPlan
        ? runtimeResult.answerPlan
        : buildAnswerPlan({
            claims,
            requirements: state.requirements,
            answerShape: runtimeResult.intent?.answerShape,
        });
    const answerRendering = path === SHADOW_PATHS.V4_R3
        ? runtimeResult.answerRendering || null
        : 'shadow_projection';
    return {
        investigationState: state,
        entityScope: runtimeResult.intent?.entityScope || testCase.entityScope,
        claims,
        evidenceLedger,
        observations,
        behaviorLog: runtimeResult.behaviorEvents || [],
        capabilityTrace: capabilityNames(runtimeResult),
        answerPlan,
        answerRendering,
        finalContent: path === SHADOW_PATHS.V4_R3
            ? runtimeResult.finalContent
            : formatAnswerPlanDeterministically(answerPlan, claims),
    };
}

function pathClassification(architectureReport, runtimeResult) {
    if (!architectureReport) return 'UNAVAILABLE';
    if (!architectureReport.passed) return 'FAIL';
    if (architectureReport.terminalState === 'needs_clarification') return 'NEEDS_CLARIFICATION';
    if (runtimeResult?.fallbackReason === 'v4_internal_failure') return 'FAIL';
    return 'PASS';
}

function satisfiesOracle(classification) {
    return classification === 'PASS' || classification === 'NEEDS_CLARIFICATION';
}

function comparisonClassification(legacy, v4r3) {
    if (!PATH_CLASSIFICATIONS.has(legacy) || !PATH_CLASSIFICATIONS.has(v4r3)) {
        throw new TypeError('未知 path classification');
    }
    if (legacy === 'UNAVAILABLE' || v4r3 === 'UNAVAILABLE') return 'INCOMPARABLE';
    const legacyPass = satisfiesOracle(legacy);
    const v4Pass = satisfiesOracle(v4r3);
    if (!legacyPass && v4Pass) return 'V4_R3_BETTER';
    if (legacyPass && v4Pass) return 'V4_R3_EQUAL';
    if (legacyPass && !v4Pass) return 'V4_R3_WORSE';
    return 'BOTH_FAIL';
}

function safeFailureCode(error, fallback = 'SHADOW_PATH_FAILED') {
    const code = String(error?.code || fallback).trim();
    return /^[A-Z0-9_:-]{1,96}$/.test(code) ? code : fallback;
}

async function executeShadowPath(input) {
    const startedAt = Date.now();
    try {
        const runtimeResult = await input.executePath({
            path: input.path,
            testCase: input.testCase,
            setup: input.setup,
            oracle: input.oracle,
            expectedClaims: input.expectedClaims,
            env: envForShadowPath(input.path, input.baseEnv),
            allowWrite: false,
        });
        const writeExposures = writeExposureNames(runtimeResult);
        if (writeExposures.length > 0) {
            const error = new Error('shadow executor 调用了写能力');
            error.code = 'SHADOW_WRITE_EXPOSURE';
            throw error;
        }
        if (hasConfirmationState(runtimeResult)) {
            const error = new Error('shadow 生成了 confirmation state');
            error.code = 'SHADOW_CONFIRMATION_STATE';
            throw error;
        }
        const actual = actualForArchitecture(input.path, runtimeResult, input.testCase);
        const architecture = evaluateArchitectureAcceptanceCase(
            input.testCase,
            input.expectedClaims,
            actual
        );
        const classification = pathClassification(architecture, runtimeResult);
        return immutable({
            path: input.path,
            classification,
            terminalState: architecture.terminalState,
            architecture,
            runtime: {
                capabilityIds: capabilityNames(runtimeResult),
                toolCount: finiteNumber(runtimeResult.telemetry?.executedTools, capabilityNames(runtimeResult).length),
                latencyMs: finiteNumber(runtimeResult.telemetry?.totalMs, Date.now() - startedAt),
                providerRequestCount: (runtimeResult.telemetry?.providerEvents || []).length,
                usage: runtimeResult.telemetry?.usage || null,
                answerRendering: runtimeResult.answerRendering || (input.path === SHADOW_PATHS.V4_R3 ? null : 'legacy_synthesis'),
                fallbackReason: runtimeResult.fallbackReason || null,
            },
            failureCode: classification === 'FAIL'
                ? architecture.errorCodes[0] || 'ORACLE_MISMATCH'
                : null,
        });
    } catch (error) {
        return immutable({
            path: input.path,
            classification: 'UNAVAILABLE',
            terminalState: null,
            architecture: null,
            runtime: {
                capabilityIds: [], toolCount: 0, latencyMs: Date.now() - startedAt,
                providerRequestCount: 0, usage: null, answerRendering: null, fallbackReason: null,
            },
            failureCode: safeFailureCode(error),
        });
    }
}

function pathMetrics(results, path) {
    const samples = results.map(item => item.paths[path]);
    const oraclePasses = samples.filter(item => satisfiesOracle(item.classification)).length;
    const toolCounts = samples.map(item => item.runtime.toolCount);
    const latencies = samples.map(item => item.runtime.latencyMs);
    const usageSamples = samples.map(item => item.runtime.usage).filter(Boolean);
    return immutable({
        oraclePassRate: ratio(oraclePasses, samples.length),
        runtime: {
            toolCount: { average: average(toolCounts), p50: percentile(toolCounts, 0.5), p95: percentile(toolCounts, 0.95) },
            latencyMs: { average: average(latencies), p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
            providerRequestCount: samples.reduce((sum, item) => sum + item.runtime.providerRequestCount, 0),
            usage: usageSamples.length === 0 ? { available: false } : {
                available: true,
                reportedRequests: usageSamples.length,
                inputTokens: usageSamples.reduce((sum, usage) => sum + finiteNumber(usage.promptTokens), 0),
                outputTokens: usageSamples.reduce((sum, usage) => sum + finiteNumber(usage.completionTokens), 0),
                totalTokens: usageSamples.reduce((sum, usage) => sum + finiteNumber(usage.totalTokens), 0),
                source: 'provider_reported_only',
            },
        },
    });
}

function aggregateSafety(results) {
    const reports = results.map(item => item.paths[SHADOW_PATHS.V4_R3].architecture).filter(Boolean);
    const sum = selector => reports.reduce((total, report) => total + selector(report), 0);
    const actualClaims = sum(report => report.counts.actualClaims);
    const expectedClaims = sum(report => report.counts.expectedClaims);
    const evidenceCases = reports.filter(report => report.checks.evidencePreserved !== null);
    const ambiguityCases = reports.filter(report => report.checks.ambiguityExpected);
    return immutable({
        unsupportedClaimRate: ratio(sum(report => report.counts.unsupportedClaims), actualClaims),
        falseNotFoundRate: ratio(sum(report => report.counts.falseNotFound), actualClaims),
        ambiguityAutoResolutionRate: ratio(
            ambiguityCases.filter(report => report.checks.ambiguityAutoResolved).length,
            ambiguityCases.length
        ),
        writeExposureRate: ratio(sum(report => report.counts.writeExposures), sum(report => report.counts.capabilityCalls)),
        evidencePreservationRate: ratio(
            evidenceCases.filter(report => report.checks.evidencePreserved).length,
            evidenceCases.length
        ),
        requiredClaimCoverageRate: ratio(sum(report => report.counts.matchedClaims), expectedClaims),
    });
}

function renderingMetrics(results) {
    const samples = results.map(item => item.paths[SHADOW_PATHS.V4_R3].runtime);
    const count = value => samples.filter(item => item.answerRendering === value).length;
    return immutable({
        deterministicAnswerRate: ratio(count('deterministic'), samples.length),
        rendererRate: ratio(samples.filter(item => ['renderer', 'llm_structured'].includes(item.answerRendering)).length, samples.length),
        rendererRepairRate: ratio(count('renderer_repaired'), samples.length),
        deterministicFallbackRate: ratio(count('deterministic_fallback'), samples.length),
        v4InternalFailureCount: samples.filter(item => item.fallbackReason === 'v4_internal_failure').length,
    });
}

function comparisonCounts(results) {
    return immutable(Object.fromEntries([...COMPARISON_CLASSIFICATIONS].map(classification => [
        classification,
        results.filter(item => item.comparison === classification).length,
    ])));
}

function repeatStability(results) {
    const groups = new Map();
    for (const result of results.filter(item => item.repeatGroup)) {
        if (!groups.has(result.repeatGroup)) groups.set(result.repeatGroup, []);
        groups.get(result.repeatGroup).push(result);
    }
    const details = [...groups.entries()].map(([repeatGroup, items]) => ({
        repeatGroup,
        passCount: items.filter(item => satisfiesOracle(item.paths[SHADOW_PATHS.V4_R3].classification)).length,
        runCount: items.length,
    }));
    return immutable({
        passed: details.length > 0 && details.every(item => item.passCount === item.runCount && item.runCount >= 5),
        groups: details,
    });
}

function exactRate(metric, expected) {
    return metric.denominator > 0 && metric.rate === expected;
}

function performanceHealthy(metrics) {
    const legacy = metrics.paths[SHADOW_PATHS.LEGACY].runtime;
    const v4r3 = metrics.paths[SHADOW_PATHS.V4_R3].runtime;
    const toolLimit = Math.max((legacy.toolCount.p95 || 0) * 3, (legacy.toolCount.p95 || 0) + 6, 10);
    return (v4r3.toolCount.p95 || 0) <= toolLimit;
}

function rolloutReadiness(results, metrics) {
    const safety = metrics.safety;
    const comparisons = metrics.comparisons;
    const v4Pass = metrics.paths[SHADOW_PATHS.V4_R3].oraclePassRate;
    const currentSaved = results.filter(item => item.tags.includes('current_saved'));
    const flatKnife = results.filter(item => item.tags.includes('flat_knife_800'));
    const blocker =
        comparisons.INCOMPARABLE > 0 ? 'SHADOW_INCOMPARABLE'
            : !exactRate(safety.writeExposureRate, 0) ? 'SHADOW_WRITE_EXPOSURE'
            : !exactRate(safety.unsupportedClaimRate, 0) ? 'UNSUPPORTED_BUSINESS_CLAIM'
                : !exactRate(safety.falseNotFoundRate, 0) ? 'FALSE_NOT_FOUND'
                    : !exactRate(safety.ambiguityAutoResolutionRate, 0) ? 'AMBIGUITY_AUTO_RESOLUTION'
                        : !exactRate(safety.evidencePreservationRate, 1) ? 'EVIDENCE_NOT_PRESERVED'
                            : !exactRate(safety.requiredClaimCoverageRate, 1) ? 'REQUIRED_CLAIM_COVERAGE'
                                : comparisons.V4_R3_WORSE > 0 ? 'V4_R3_REGRESSION'
                                    : !exactRate(v4Pass, 1) ? 'V4_R3_ORACLE_FAILURE'
                                            : !metrics.repeatStability.passed ? 'REPEAT_STABILITY_FAILED'
                                                : metrics.rendering.v4InternalFailureCount > 0 ? 'V4_INTERNAL_FAILURE'
                                                    : currentSaved.length === 0 || currentSaved.some(item => !satisfiesOracle(item.paths.v4_r3.classification))
                                                        ? 'CURRENT_SAVED_FAILED'
                                                        : flatKnife.length === 0 || flatKnife.some(item => !satisfiesOracle(item.paths.v4_r3.classification))
                                                            ? 'FLAT_KNIFE_800_FAILED'
                                                            : !performanceHealthy(metrics) ? 'PERFORMANCE_RUNAWAY'
                                                                : null;
    return immutable({ ready: blocker === null, blocker });
}

function safePathReport(pathResult) {
    return {
        classification: pathResult.classification,
        terminalState: pathResult.terminalState,
        capabilityIds: pathResult.runtime.capabilityIds.slice(0, 32),
        toolCount: pathResult.runtime.toolCount,
        latencyMs: pathResult.runtime.latencyMs,
        evidenceCount: pathResult.architecture?.evidenceCategories.length || 0,
        expectedClaimCount: pathResult.architecture?.counts.expectedClaims || 0,
        matchedClaimCount: pathResult.architecture?.counts.matchedClaims || 0,
        failureCode: pathResult.failureCode,
        answerRendering: pathResult.runtime.answerRendering,
        fallbackReason: pathResult.runtime.fallbackReason,
    };
}

async function runShadowComparisonSuite(input = {}) {
    if (!Array.isArray(input.cases) || input.cases.length === 0) throw new TypeError('R4-B 需要 shadow cases');
    if (typeof input.executePath !== 'function') throw new TypeError('R4-B 需要 executePath');
    const results = [];
    for (const caseEntry of input.cases) {
        const testCase = caseEntry?.testCase || caseEntry;
        const shadow = caseEntry?.testCase ? (caseEntry.shadow || {}) : {};
        assertReadOnlyShadowCase(testCase);
        const setup = await testCase.setup();
        const oracle = await testCase.oracleBuilder(setup);
        if (!oracle || ['prerequisite_missing', 'fixture_invalid'].includes(oracle.status)) {
            const unavailable = Object.fromEntries(PATH_ORDER.map(path => [path, immutable({
                path,
                classification: 'UNAVAILABLE',
                terminalState: null,
                architecture: null,
                runtime: { capabilityIds: [], toolCount: 0, latencyMs: 0, providerRequestCount: 0, usage: null, answerRendering: null, fallbackReason: null },
                failureCode: oracle?.status === 'fixture_invalid' ? 'ORACLE_FIXTURE_INVALID' : 'ORACLE_PREREQUISITE_MISSING',
            })]));
            results.push(immutable({
                caseKey: testCase.caseKey,
                repeatGroup: shadow.repeatGroup || null,
                tags: [...new Set(shadow.tags || [])],
                paths: unavailable,
                comparison: 'INCOMPARABLE',
            }));
            continue;
        }
        const expectedClaims = await buildExpectedClaimSet(testCase, { setup, oracle });
        const paths = {};
        for (const path of PATH_ORDER) {
            paths[path] = await executeShadowPath({
                path, testCase, setup, oracle, expectedClaims,
                executePath: input.executePath,
                baseEnv: input.baseEnv,
            });
        }
        results.push(immutable({
            caseKey: testCase.caseKey,
            repeatGroup: shadow.repeatGroup || null,
            tags: [...new Set(shadow.tags || [])],
            paths,
            comparison: comparisonClassification(paths.legacy_v3.classification, paths.v4_r3.classification),
        }));
    }
    const metrics = {
        paths: Object.fromEntries(PATH_ORDER.map(path => [path, pathMetrics(results, path)])),
        comparisons: comparisonCounts(results),
        safety: aggregateSafety(results),
        rendering: renderingMetrics(results),
        repeatStability: repeatStability(results),
    };
    const readiness = rolloutReadiness(results, metrics);
    return immutable({
        schemaVersion: 1,
        suite: 'r4b_read_shadow_comparison',
        generatedAt: input.generatedAt || new Date().toISOString(),
        gitCommit: String(input.gitCommit || ''),
        realProvider: input.realProvider === true,
        databaseSnapshot: String(input.databaseSnapshot || 'isolated'),
        llmJudgeUsed: false,
        cases: results.map(result => ({
            caseKey: result.caseKey,
            repeatGroup: result.repeatGroup,
            tags: result.tags,
            comparison: result.comparison,
            paths: Object.fromEntries(PATH_ORDER.map(path => [path, safePathReport(result.paths[path])])),
        })),
        metrics,
        rolloutReadiness: readiness,
        status: readiness.ready ? 'PASS' : results.some(item => item.comparison === 'INCOMPARABLE') ? 'INCOMPLETE' : 'FAIL',
    });
}

module.exports = {
    COMPARISON_CLASSIFICATIONS,
    PATH_CLASSIFICATIONS,
    PATH_ORDER,
    SHADOW_PATHS,
    actualForArchitecture,
    assertReadOnlyShadowCase,
    comparisonClassification,
    envForShadowPath,
    runShadowComparisonSuite,
    satisfiesOracle,
};
