const { getAiCapability } = require('../capabilities/registry.cjs');
const { createHash } = require('crypto');
const {
    formatAnswerPlanDeterministically,
    validateRenderedAnswer,
} = require('./aiGroundedAnswerV4.cjs');

const ACCEPTED_DOMAINS = new Set(['part', 'coil', 'template', 'recipe', 'cost']);
const ACCEPTED_MODES = new Set(['query', 'analysis']);
const TERMINAL_STATES = new Set([
    'completed',
    'completed_negative',
    'needs_clarification',
    'failed_unverified',
    'budget_exhausted',
]);
const CONTROL_CLAIM_TYPES = new Set(['ambiguous', 'unavailable']);
const TECHNICAL_FAILURES = new Set(['timeout', 'transport_failure', 'protocol_failure']);
const ORACLE_STATUSES = new Set(['ready', 'verified_absent', 'prerequisite_missing', 'fixture_invalid']);
const DEFAULT_REPORT_LIMITS = Object.freeze({ errors: 24, identifiers: 32 });

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function immutable(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(immutable));
    if (!value || typeof value !== 'object') return value;
    return Object.freeze(Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, immutable(nested)])
    ));
}

function sameValue(left, right) {
    return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function requiredString(value, field) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new TypeError(`R4-A case 缺少 ${field}`);
    return normalized;
}

function normalizedSubject(subject = {}) {
    return {
        entityType: requiredString(subject.entityType, 'expectedClaims.subject.entityType'),
        entityId: subject.entityId === undefined || subject.entityId === null
            ? null
            : String(subject.entityId),
    };
}

function claimBusinessIdentityKey(claim = {}) {
    return JSON.stringify(stableValue({
        subject: normalizedSubject(claim.subject),
        predicate: requiredString(claim.predicate, 'expectedClaims.predicate'),
        temporalScope: requiredString(claim.temporalScope, 'expectedClaims.temporalScope'),
        scenario: requiredString(claim.scenario, 'expectedClaims.scenario'),
        qualifiers: claim.qualifiers || {},
    }));
}

function normalizeExpectedClaim(claim = {}, index = 0) {
    const normalized = {
        expectedClaimId: String(claim.expectedClaimId || `expected-${index + 1}`),
        claimType: requiredString(claim.claimType, 'expectedClaims.claimType'),
        factKey: claim.factKey ? String(claim.factKey) : null,
        subject: normalizedSubject(claim.subject),
        predicate: requiredString(claim.predicate, 'expectedClaims.predicate'),
        value: claim.value === undefined ? null : stableValue(claim.value),
        unit: claim.unit === undefined ? null : claim.unit,
        temporalScope: requiredString(claim.temporalScope, 'expectedClaims.temporalScope'),
        scenario: requiredString(claim.scenario, 'expectedClaims.scenario'),
        qualifiers: stableValue(claim.qualifiers || {}),
        evidenceClasses: [...new Set(claim.evidenceClasses || [])],
        sourceOfTruth: requiredString(claim.sourceOfTruth, 'expectedClaims.sourceOfTruth'),
        oracleSource: 'formal_api_or_service',
    };
    normalized.businessIdentity = claimBusinessIdentityKey(normalized);
    return immutable(normalized);
}

function createArchitectureAcceptanceCase(input = {}) {
    const domain = requiredString(input.domain, 'domain');
    const mode = requiredString(input.mode, 'mode');
    if (!ACCEPTED_DOMAINS.has(domain)) throw new TypeError(`R4-A 不支持 domain: ${domain}`);
    if (!ACCEPTED_MODES.has(mode)) throw new TypeError(`R4-A 不支持 mode: ${mode}`);
    if (typeof input.oracleBuilder !== 'function') throw new TypeError('R4-A case 需要 oracleBuilder');
    if (typeof input.expectedClaims !== 'function') {
        throw new TypeError('expectedClaims 必须是读取 formal oracle 结果的函数');
    }
    if (!Array.isArray(input.requiredFacts) || input.requiredFacts.length === 0) {
        throw new TypeError('R4-A case 需要 requiredFacts');
    }
    const terminalState = requiredString(input.terminalState, 'terminalState');
    if (!TERMINAL_STATES.has(terminalState)) throw new TypeError(`未知 terminalState: ${terminalState}`);
    return immutable({
        caseKey: requiredString(input.caseKey, 'caseKey'),
        domain,
        userQuestion: requiredString(input.userQuestion, 'userQuestion'),
        mode,
        entityScope: requiredString(input.entityScope, 'entityScope'),
        setup: typeof input.setup === 'function' ? input.setup : async () => ({}),
        oracleBuilder: input.oracleBuilder,
        requiredFacts: stableValue(input.requiredFacts),
        expectedClaims: input.expectedClaims,
        allowedCapabilityClasses: [...new Set(input.allowedCapabilityClasses || [])],
        optionalAllowedCapabilities: [...new Set(input.optionalAllowedCapabilities || [])],
        forbiddenSubstitutions: [...new Set(input.forbiddenSubstitutions || [])],
        requiredEvidenceClasses: [...new Set(input.requiredEvidenceClasses || [])],
        terminalState,
        semanticRequirements: stableValue(input.semanticRequirements || {}),
        writeBoundary: input.writeBoundary || 'read_only',
        freshness: stableValue(input.freshness || {}),
    });
}

async function buildExpectedClaimSet(testCase, oracleContext) {
    const oracleStatus = oracleContext?.oracle?.status;
    if (!ORACLE_STATUSES.has(oracleStatus)) {
        throw new TypeError(`R4-A case ${testCase.caseKey} 的 oracle 缺少明确 status`);
    }
    if (['prerequisite_missing', 'fixture_invalid'].includes(oracleStatus)) {
        const error = new Error(`R4-A case ${testCase.caseKey} 的测试前置无效`);
        error.code = oracleStatus === 'prerequisite_missing'
            ? 'ORACLE_PREREQUISITE_MISSING'
            : 'ORACLE_FIXTURE_INVALID';
        throw error;
    }
    const raw = await testCase.expectedClaims(oracleContext);
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new TypeError(`R4-A case ${testCase.caseKey} 的 oracle 未生成 ExpectedClaimSet`);
    }
    const claims = raw.map(normalizeExpectedClaim);
    const identities = new Set();
    for (const claim of claims) {
        if (identities.has(claim.businessIdentity)) {
            throw new TypeError(`R4-A case ${testCase.caseKey} 的 ExpectedClaimSet 包含重复业务 Fact`);
        }
        identities.add(claim.businessIdentity);
    }
    if (oracleStatus === 'verified_absent'
        && claims.some(claim => claim.claimType !== 'verified_not_found')) {
        throw new TypeError(`R4-A case ${testCase.caseKey} 的 verified_absent oracle 必须生成负 Claim`);
    }
    return immutable(claims);
}

function actualBusinessIdentity(claim = {}) {
    try {
        return claimBusinessIdentityKey(claim);
    } catch {
        return null;
    }
}

function matchClaims(expectedClaims, actualClaims = []) {
    const unused = new Set(actualClaims.map((_, index) => index));
    const matches = [];
    for (const expected of expectedClaims) {
        let matchedIndex = -1;
        for (const index of unused) {
            const actual = actualClaims[index];
            if (actualBusinessIdentity(actual) === expected.businessIdentity
                && actual.claimType === expected.claimType) {
                matchedIndex = index;
                break;
            }
        }
        const actual = matchedIndex >= 0 ? actualClaims[matchedIndex] : null;
        if (matchedIndex >= 0) unused.delete(matchedIndex);
        const agreement = Boolean(actual)
            && sameValue(actual.value, expected.value)
            && sameValue(actual.unit ?? null, expected.unit ?? null)
            && (!expected.factKey || actual.factKey === expected.factKey);
        matches.push({ expected, actual, agreement });
    }
    return {
        matches,
        unsupportedClaims: [...unused].map(index => actualClaims[index]),
    };
}

function capabilityDescriptor(entry) {
    const name = typeof entry === 'string' ? entry : entry?.name || entry?.capabilityName;
    const registered = name ? getAiCapability(name) : null;
    return {
        name: name || null,
        access: entry?.access || registered?.access || null,
        capabilityClass: entry?.capabilityClass || entry?.class || registered?.operation || null,
        sourceOfTruth: entry?.sourceOfTruth || registered?.sourceOfTruth || null,
    };
}

function evidenceForClaim(claim, evidenceById) {
    return (claim?.evidenceRefs || []).map(id => evidenceById.get(id)).filter(Boolean);
}

function supportingEvidence(match, evidenceById, requiredKinds) {
    if (!match.actual) return [];
    return evidenceForClaim(match.actual, evidenceById).filter(record => (
        record.recordType === 'evidence'
        && record.factKey === match.actual.factKey
        && record.sourceOfTruth === match.expected.sourceOfTruth
        && (requiredKinds.length === 0 || requiredKinds.includes(record.kind))
    ));
}

function claimReportSummary(claim, options = {}) {
    const identity = actualBusinessIdentity(claim) || claim.businessIdentity || null;
    return {
        claimId: claim.claimId || claim.expectedClaimId || null,
        claimType: claim.claimType || null,
        factKeyFingerprint: claim.factKey
            ? createHash('sha256').update(String(claim.factKey)).digest('hex').slice(0, 16)
            : null,
        entityType: claim.subject?.entityType || null,
        predicate: claim.predicate || null,
        temporalScope: claim.temporalScope || null,
        scenario: claim.scenario || null,
        businessIdentityFingerprint: identity
            ? createHash('sha256').update(identity).digest('hex').slice(0, 16)
            : null,
        valueMatched: options.valueMatched ?? null,
        evidenceClasses: [...new Set(options.evidenceClasses || claim.evidenceClasses || [])],
    };
}

function boundedUnique(values, limit) {
    return [...new Set(values.filter(Boolean).map(String))].slice(0, limit);
}

function evaluateArchitectureAcceptanceCase(testCase, expectedClaims, actual = {}, options = {}) {
    const limits = { ...DEFAULT_REPORT_LIMITS, ...(options.reportLimits || {}) };
    const actualClaims = Array.isArray(actual.claims) ? actual.claims : [];
    const evidenceLedger = Array.isArray(actual.evidenceLedger) ? actual.evidenceLedger : [];
    const observations = Array.isArray(actual.observations)
        ? actual.observations
        : Array.isArray(actual.investigationState?.observations) ? actual.investigationState.observations : [];
    const behaviorLog = Array.isArray(actual.behaviorLog) ? actual.behaviorLog : [];
    const terminalState = actual.investigationState?.status || actual.terminalState || null;
    const capabilities = (actual.capabilityTrace || actual.capabilities || []).map(capabilityDescriptor);
    const evidenceById = new Map(evidenceLedger.map(record => [record.evidenceId, record]));
    const { matches, unsupportedClaims } = matchClaims(expectedClaims, actualClaims);
    const errors = [];
    const addError = (code, details) => errors.push({ code, ...(details ? { details } : {}) });

    if (terminalState !== testCase.terminalState) addError('TERMINAL_STATE_MISMATCH');
    if ((actual.entityScope || actual.investigationGoal?.entityScope || 'single') !== testCase.entityScope) {
        addError('ENTITY_SCOPE_MISMATCH');
    }
    const investigationRequirements = actual.investigationState?.requirements || [];
    if (investigationRequirements.length > 0 && investigationRequirements.some(requirement => (
        !['satisfied', 'negative_satisfied', 'needs_clarification', 'unavailable', 'optional_skipped']
            .includes(requirement.status)
    ))) addError('REQUIRED_FACT_NOT_TERMINAL');
    if (evidenceLedger.some(record => record?.recordType !== 'evidence')) {
        addError('INVALID_EVIDENCE_LEDGER_RECORD');
    }

    const allowedNames = new Set(testCase.optionalAllowedCapabilities);
    const allowedClasses = new Set(testCase.allowedCapabilityClasses);
    for (const capability of capabilities) {
        if (capability.access === 'write') addError('READ_WRITE_EXPOSURE', capability.name);
        if (testCase.forbiddenSubstitutions.includes(capability.name)) {
            addError('FORBIDDEN_CAPABILITY_SUBSTITUTION', capability.name);
        }
        if (allowedClasses.size > 0
            && !allowedClasses.has(capability.capabilityClass)
            && !allowedNames.has(capability.name)) {
            addError('CAPABILITY_CLASS_NOT_ALLOWED', capability.name);
        }
    }
    if (testCase.writeBoundary === 'read_only' && capabilities.some(item => item.access === 'write')) {
        addError('WRITE_BOUNDARY_VIOLATED');
    }

    for (const match of matches) {
        if (!match.actual) {
            addError('REQUIRED_CLAIM_MISSING', match.expected.expectedClaimId);
            continue;
        }
        if (!match.agreement) addError('DYNAMIC_ORACLE_DISAGREEMENT', match.expected.expectedClaimId);
        const requiredKinds = match.expected.evidenceClasses.length > 0
            ? match.expected.evidenceClasses
            : testCase.requiredEvidenceClasses;
        if (!CONTROL_CLAIM_TYPES.has(match.actual.claimType) && requiredKinds.length > 0) {
            if (supportingEvidence(match, evidenceById, requiredKinds).length === 0) {
                addError('REQUIRED_EVIDENCE_CLASS_MISSING', match.expected.expectedClaimId);
            }
        }
    }
    if (unsupportedClaims.length > 0) addError('UNSUPPORTED_BUSINESS_CLAIM');

    const expectedAmbiguous = expectedClaims.filter(claim => claim.claimType === 'ambiguous');
    const ambiguityAutoResolved = expectedAmbiguous.some(expected => actualClaims.some(actualClaim => (
        actualBusinessIdentity(actualClaim) === expected.businessIdentity
        && actualClaim.claimType !== 'ambiguous'
    )));
    if (ambiguityAutoResolved) addError('AMBIGUITY_AUTO_RESOLVED');

    const expectedNegativeKeys = new Set(expectedClaims
        .filter(claim => claim.claimType === 'verified_not_found')
        .map(claim => claim.businessIdentity));
    const falseNotFound = actualClaims.filter(claim => (
        claim.claimType === 'verified_not_found'
        && !expectedNegativeKeys.has(actualBusinessIdentity(claim))
    ));
    if (falseNotFound.length > 0) addError('FALSE_NOT_FOUND');

    const technicalOutcome = testCase.semanticRequirements.technicalFailureOutcome;
    let technicalFailureAccurate = null;
    if (technicalOutcome) {
        const unavailableMatch = matches.find(match => (
            match.expected.claimType === 'unavailable'
            && match.actual?.claimType === 'unavailable'
            && match.agreement
        ));
        const provenanceObservation = unavailableMatch
            ? observations.find(observation => (
                observation.outcome === technicalOutcome
                && observation.factKey === unavailableMatch.actual.factKey
                && unavailableMatch.actual.observationRefs?.includes(observation.observationId)
            ))
            : null;
        technicalFailureAccurate = TECHNICAL_FAILURES.has(technicalOutcome)
            && terminalState === 'failed_unverified'
            && Boolean(unavailableMatch)
            && Boolean(provenanceObservation)
            && actualClaims.every(claim => claim.claimType !== 'verified_not_found')
            && evidenceLedger.every(record => record.kind !== 'verified_negative');
        if (!technicalFailureAccurate) addError('TECHNICAL_FAILURE_SEMANTICS_INACCURATE');
    }

    const requiredActualClaimIds = matches.filter(match => match.actual).map(match => match.actual.claimId);
    const planRefs = new Set([
        ...(actual.answerPlan?.requiredClaimRefs || []),
        ...(actual.answerPlan?.blocks || []).flatMap(block => block.claimRefs || []),
    ]);
    const answerPlanCovered = requiredActualClaimIds.every(id => id && planRefs.has(id));
    if (actual.answerPlan && !answerPlanCovered) addError('ANSWER_PLAN_CLAIM_COVERAGE_MISSING');
    let deterministicOutputCanonical = null;
    if (actual.answerRendering === 'deterministic' && actual.answerPlan && actual.finalContent !== undefined) {
        deterministicOutputCanonical = actual.finalContent
            === formatAnswerPlanDeterministically(actual.answerPlan, actualClaims);
        if (!deterministicOutputCanonical) addError('DETERMINISTIC_FINAL_SEMANTICS_MISMATCH');
    }

    let rendererGrounded = null;
    if (testCase.semanticRequirements.requireRenderer === true) {
        const renderingValidation = actual.renderedAnswer && actual.answerPlan
            ? validateRenderedAnswer(actual.renderedAnswer, actual.answerPlan, actualClaims)
            : { valid: false };
        rendererGrounded = ['renderer', 'llm_structured'].includes(actual.answerRendering)
            && renderingValidation.valid
            && answerPlanCovered;
        if (!rendererGrounded) addError('RENDERER_GROUNDING_FAILED');
    }

    const evidencePreservationRequired = testCase.semanticRequirements.evidencePreserved === true;
    const evidencePreserved = evidencePreservationRequired
        ? matches.filter(match => !CONTROL_CLAIM_TYPES.has(match.expected.claimType)).every(match => (
            supportingEvidence(
                match,
                evidenceById,
                match.expected.evidenceClasses.length > 0
                    ? match.expected.evidenceClasses
                    : testCase.requiredEvidenceClasses
            ).length > 0
        ))
        : null;
    if (evidencePreservationRequired && !evidencePreserved) addError('EVIDENCE_NOT_PRESERVED');

    const freshnessAsOf = Date.parse(testCase.freshness.notOlderThan || '');
    if (Number.isFinite(freshnessAsOf)) {
        const stale = evidenceLedger.some(record => {
            const authorityTime = Date.parse(record.authorityTime || '');
            return Number.isFinite(authorityTime) && authorityTime < freshnessAsOf;
        });
        if (stale) addError('EVIDENCE_FRESHNESS_VIOLATED');
    }

    const matchedCount = matches.filter(match => match.actual).length;
    const agreementCount = matches.filter(match => match.agreement).length;
    const writeExposureCount = capabilities.filter(item => item.access === 'write').length;
    const report = {
        caseKey: testCase.caseKey,
        domain: testCase.domain,
        terminalState,
        expectedTerminalState: testCase.terminalState,
        passed: errors.length === 0,
        counts: {
            expectedClaims: expectedClaims.length,
            actualClaims: actualClaims.length,
            matchedClaims: matchedCount,
            oracleAgreements: agreementCount,
            unsupportedClaims: unsupportedClaims.length,
            falseNotFound: falseNotFound.length,
            capabilityCalls: capabilities.length,
            writeExposures: writeExposureCount,
        },
        checks: {
            evidencePreserved,
            ambiguityExpected: expectedAmbiguous.length > 0,
            ambiguityAutoResolved,
            answerPlanCovered,
            deterministicOutputCanonical,
            rendererGrounded,
            technicalFailureAccurate,
        },
        expectedClaims: matches.slice(0, limits.identifiers).map(match => claimReportSummary(
            match.expected,
            { valueMatched: match.agreement }
        )),
        actualClaims: actualClaims.slice(0, limits.identifiers).map(claim => {
            const match = matches.find(item => item.actual === claim);
            return claimReportSummary(claim, {
                valueMatched: match?.agreement ?? false,
                evidenceClasses: evidenceForClaim(claim, evidenceById).map(record => record.kind),
            });
        }),
        actualCapabilityClasses: boundedUnique(capabilities.map(item => item.capabilityClass), limits.identifiers),
        evidenceCategories: boundedUnique(evidenceLedger.map(item => item.kind), limits.identifiers),
        errorCodes: boundedUnique(errors.map(error => error.code), limits.errors),
        observedCapabilities: boundedUnique(capabilities.map(item => item.name), limits.identifiers),
        behaviorTypes: boundedUnique(behaviorLog.map(item => item.type), limits.identifiers),
        observationOutcomes: boundedUnique(observations.map(item => item.outcome), limits.identifiers),
    };
    return immutable(report);
}

function ratio(numerator, denominator) {
    return immutable({
        numerator,
        denominator,
        rate: denominator === 0 ? null : Number((numerator / denominator).toFixed(6)),
    });
}

function aggregateArchitectureMetrics(results = []) {
    const sum = selector => results.reduce((total, result) => total + selector(result), 0);
    const evidenceCases = results.filter(result => result.checks.evidencePreserved !== null);
    const ambiguityCases = results.filter(result => result.checks.ambiguityExpected);
    const rendererCases = results.filter(result => result.checks.rendererGrounded !== null);
    const technicalCases = results.filter(result => result.checks.technicalFailureAccurate !== null);
    return immutable({
        evidencePreservationRate: ratio(
            evidenceCases.filter(result => result.checks.evidencePreserved).length,
            evidenceCases.length
        ),
        unsupportedBusinessClaimRate: ratio(
            sum(result => result.counts.unsupportedClaims),
            sum(result => result.counts.actualClaims)
        ),
        requiredClaimCoverageRate: ratio(
            sum(result => result.counts.matchedClaims),
            sum(result => result.counts.expectedClaims)
        ),
        falseNotFoundRate: ratio(
            sum(result => result.counts.falseNotFound),
            sum(result => result.counts.actualClaims)
        ),
        ambiguityAutoResolutionRate: ratio(
            ambiguityCases.filter(result => result.checks.ambiguityAutoResolved).length,
            ambiguityCases.length
        ),
        readWriteExposureRate: ratio(
            sum(result => result.counts.writeExposures),
            sum(result => result.counts.capabilityCalls)
        ),
        dynamicOracleAgreementRate: ratio(
            sum(result => result.counts.oracleAgreements),
            sum(result => result.counts.expectedClaims)
        ),
        rendererGroundingPassRate: ratio(
            rendererCases.filter(result => result.checks.rendererGrounded).length,
            rendererCases.length
        ),
        technicalFailureSemanticAccuracy: ratio(
            technicalCases.filter(result => result.checks.technicalFailureAccurate).length,
            technicalCases.length
        ),
    });
}

async function runArchitectureAcceptanceSuite(inputs = {}) {
    if (!Array.isArray(inputs.cases) || inputs.cases.length === 0) {
        throw new TypeError('R4-A suite 需要 cases');
    }
    if (typeof inputs.executeCase !== 'function') throw new TypeError('R4-A suite 需要 executeCase');
    const results = [];
    for (const testCase of inputs.cases) {
        try {
            const setupContext = await testCase.setup();
            const oracle = await testCase.oracleBuilder(setupContext);
            if (!oracle || typeof oracle !== 'object') {
                throw new TypeError(`R4-A case ${testCase.caseKey} 未取得 formal oracle`);
            }
            const oracleContext = immutable({ setup: setupContext, oracle });
            const expectedClaims = await buildExpectedClaimSet(testCase, oracleContext);
            const actual = await inputs.executeCase(testCase, { setup: setupContext, oracle, expectedClaims });
            results.push(evaluateArchitectureAcceptanceCase(testCase, expectedClaims, actual, inputs));
        } catch (error) {
            if (!['ORACLE_PREREQUISITE_MISSING', 'ORACLE_FIXTURE_INVALID'].includes(error.code)) throw error;
            results.push(immutable({
                caseKey: testCase.caseKey,
                domain: testCase.domain,
                terminalState: null,
                expectedTerminalState: testCase.terminalState,
                passed: false,
                phase: 'oracle',
                counts: {
                    expectedClaims: 0, actualClaims: 0, matchedClaims: 0,
                    oracleAgreements: 0, unsupportedClaims: 0, falseNotFound: 0,
                    capabilityCalls: 0, writeExposures: 0,
                },
                checks: {
                    evidencePreserved: null, ambiguityExpected: false,
                    ambiguityAutoResolved: false, answerPlanCovered: false,
                    deterministicOutputCanonical: null, rendererGrounded: null,
                    technicalFailureAccurate: null,
                },
                expectedClaims: [], actualClaims: [], actualCapabilityClasses: [],
                evidenceCategories: [], errorCodes: [error.code],
                observedCapabilities: [], behaviorTypes: [], observationOutcomes: [],
            }));
        }
    }
    return immutable({
        suite: 'r4a_dynamic_architecture_acceptance',
        deterministic: true,
        llmJudgeUsed: false,
        caseCount: results.length,
        passed: results.every(result => result.passed),
        cases: results,
        metrics: aggregateArchitectureMetrics(results),
    });
}

module.exports = {
    ACCEPTED_DOMAINS,
    ACCEPTED_MODES,
    ORACLE_STATUSES,
    TERMINAL_STATES,
    aggregateArchitectureMetrics,
    buildExpectedClaimSet,
    claimBusinessIdentityKey,
    createArchitectureAcceptanceCase,
    evaluateArchitectureAcceptanceCase,
    runArchitectureAcceptanceSuite,
};
