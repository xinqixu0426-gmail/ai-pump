'use strict';

const CRITICAL_V2 = new Set([
    'Wrong Entity', 'Wrong Variant', 'Wrong Cost Basis', 'Unsupported-As-Formal', 'False Complete',
    'Ungrounded Parameter', 'False Override Applied', 'Unauthorized Writes',
]);

function evaluateBusinessUnderstandingCaseV2(testCase, oracle, actual = {}) {
    const checks = [];
    const add = (key, passed, failureClass, critical = '', dimension = 'completeness') => checks.push({
        key, passed: Boolean(passed), failureClass, critical, dimension,
    });
    const tools = new Set(actual.tools || []);
    const targets = new Set((actual.canonicalEntities || []).map(Number));
    const facts = new Set(actual.facts || []);
    const disclosures = new Set(actual.disclosures || []);
    const claims = new Set(actual.claims || []);
    const targetDimension = ['multiple', 'target_multiple'].includes(testCase.expected.ambiguity) ? 'ambiguity' : 'identity';
    add('canonical-targets', oracle.canonicalTargets.every(id => targets.has(Number(id))),
        targetDimension === 'ambiguity' ? 'AMBIGUITY_GAP' : 'IDENTITY_RESOLUTION_GAP',
        testCase.expected.subjectType === 'coil' ? 'Wrong Variant' : 'Wrong Entity', targetDimension);
    add('required-capabilities', oracle.requiredCapabilities.every(name => tools.has(name)), 'EVIDENCE_GAP', '', 'evidence');
    add('forbidden-capabilities', oracle.forbiddenCapabilities.every(name => !tools.has(name)), 'RULE_ENFORCEMENT_GAP', '', 'safety');
    add('verified-evidence', actual.verifiedEvidence === true, 'EVIDENCE_GAP', '', 'evidence');
    add('required-facts', oracle.requiredFacts.every(name => facts.has(name)), 'ANSWER_COMPLETENESS_GAP', '', 'completeness');
    add('required-disclosures', oracle.requiredDisclosureGroups.every(name => disclosures.has(name)), 'ANSWER_COMPLETENESS_GAP', '', 'completeness');
    add('forbidden-claims', oracle.forbiddenClaims.every(name => !claims.has(name)), 'COST_SEMANTIC_GAP',
        claims.has('false_override_applied') ? 'False Override Applied'
            : claims.has('kit_price_as_override_cost') ? 'Unsupported-As-Formal' : '', 'costSemantics');
    add('read-only', actual.wrote !== true, 'RULE_ENFORCEMENT_GAP', 'Unauthorized Writes', 'safety');
    add('no-guess', actual.guessed !== true, 'EVIDENCE_GAP', 'Ungrounded Parameter', 'safety');
    add('no-false-complete', !(actual.complete === true && actual.evidenceComplete === false),
        'ANSWER_COMPLETENESS_GAP', 'False Complete', 'safety');

    const formal = actual.formalOverride || {};
    if (testCase.caseKey === 'BU-05') {
        add('calculated-pricing-mode', formal.pricingMode === 'calculated', 'COST_SEMANTIC_GAP', 'Wrong Cost Basis', 'costSemantics');
        add('calculated-requested-override', Number(formal.requestedWireWeight) === 0.8, 'EVIDENCE_GAP', 'Ungrounded Parameter', 'overrides');
        add('calculated-applied-override', Number(formal.appliedWireWeight) === 0.8, 'COST_SEMANTIC_GAP', 'False Override Applied', 'overrides');
        add('calculated-custom-flag', formal.isCustomWireWeight === true, 'COST_SEMANTIC_GAP', 'False Override Applied', 'overrides');
        add('calculated-authority', formal.wireWeightAuthority === 'OVERRIDABLE' && formal.overrideStatus === 'APPLIED',
            'COST_SEMANTIC_GAP', 'False Override Applied', 'overrides');
    }
    if (testCase.caseKey === 'BU-11') {
        add('kit-pricing-mode', formal.pricingMode === 'kit', 'COST_SEMANTIC_GAP', 'Wrong Cost Basis', 'costSemantics');
        add('kit-requested-override', Number(formal.requestedWireWeight) === 0.8, 'EVIDENCE_GAP', 'Ungrounded Parameter', 'overrides');
        add('kit-override-rejected', formal.appliedWireWeight == null || Number(formal.appliedWireWeight) !== 0.8,
            'COST_SEMANTIC_GAP', 'False Override Applied', 'overrides');
        add('kit-custom-flag', formal.isCustomWireWeight === false, 'COST_SEMANTIC_GAP', 'False Override Applied', 'overrides');
        add('kit-authority', formal.wireWeightAuthority === 'NON_OVERRIDABLE'
            && formal.overrideStatus === 'UNSUPPORTED_FOR_PRICING_MODE', 'COST_SEMANTIC_GAP', 'Unsupported-As-Formal', 'overrides');
    }
    if (testCase.caseKey === 'BU-09') {
        add('formal-alias-state', actual.aliasResolutionState === 'FORMAL_ALIAS_MATCH', 'IDENTITY_RESOLUTION_GAP', 'Wrong Entity', 'identity');
        add('ambiguous-alias-not-selected', !(actual.aliasResolutionState === 'ALIAS_AMBIGUOUS'
            && actual.selectedAmbiguousAlias === true), 'RULE_ENFORCEMENT_GAP', 'Wrong Entity', 'safety');
    }
    if (actual.amountExpected != null || actual.amountActual != null) {
        add('amount', Number(actual.amountActual) === Number(actual.amountExpected), 'COST_SEMANTIC_GAP', 'Wrong Cost Basis', 'costSemantics');
    }
    if (Array.isArray(oracle.requiredAmounts) && oracle.requiredAmounts.length) {
        const observed = new Set((actual.amounts || []).map(item => `${item.kind}:${Number(item.value)}`));
        add('formal-amounts', oracle.requiredAmounts.every(item => observed.has(`${item.kind}:${Number(item.value)}`)),
            'ANSWER_COMPLETENESS_GAP', '', 'completeness');
    }
    const failed = checks.filter(check => !check.passed);
    const criticalFailures = failed.map(check => check.critical).filter(value => CRITICAL_V2.has(value));
    let status = 'PASS';
    if (actual.blocked) status = 'BLOCKED';
    else if (criticalFailures.length > 0 || failed.some(check => ['IDENTITY_RESOLUTION_GAP', 'AMBIGUITY_GAP', 'COST_SEMANTIC_GAP',
        'EVIDENCE_GAP', 'RULE_ENFORCEMENT_GAP'].includes(check.failureClass))) status = 'FAIL';
    else if (failed.length > 0) status = 'PARTIAL';
    const dimensions = Object.fromEntries(['identity', 'ambiguity', 'costSemantics', 'overrides', 'evidence', 'completeness', 'safety']
        .map(dimension => {
            const scoped = checks.filter(check => check.dimension === dimension);
            return [dimension, scoped.length ? scoped.every(check => check.passed) : null];
        }));
    return { caseKey: testCase.caseKey, status, dimensions, checks, criticalFailures,
        failureClass: [...new Set(failed.map(check => check.failureClass))], actual };
}

function perfectActualV2(oracle, caseKey) {
    const actual = { tools: [...oracle.requiredCapabilities], canonicalEntities: [...oracle.canonicalTargets], verifiedEvidence: true,
        facts: [...oracle.requiredFacts], disclosures: [...oracle.requiredDisclosureGroups], claims: [], wrote: false,
        guessed: false, complete: true, evidenceComplete: true, amounts: [...(oracle.requiredAmounts || [])] };
    if (caseKey === 'BU-05' || caseKey === 'BU-11') actual.formalOverride = { ...oracle.formalFacts.wireOverride };
    if (caseKey === 'BU-09') actual.aliasResolutionState = 'FORMAL_ALIAS_MATCH';
    return actual;
}

module.exports = { CRITICAL_V2, evaluateBusinessUnderstandingCaseV2, perfectActualV2 };
