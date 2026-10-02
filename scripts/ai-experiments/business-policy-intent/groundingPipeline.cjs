'use strict';

const { runBusinessAgent } = require('./businessAgent.cjs');
const { runPolicyAgent } = require('./policyAgent.cjs');
const { detectReferenceSurface } = require('./referenceDetection.cjs');
const { runReferenceResolver, parseReferenceMemo } = require('./referenceResolver.cjs');
const { buildNarrowBusinessReferenceHint } = require('./referenceHint.cjs');
const { runRoleClassifier, parseRoleMemo } = require('./roleClassifier.cjs');
const { buildGroundingWorkingUtterance } = require('./workingUtterance.cjs');
const { resolveReferenceFastPath } = require('./referenceFastPath.cjs');
const { alignRoleExpressionToWorkingUtterance } = require('./spanAlignment.cjs');
const { detectConceptQuestionFastPath } = require('./conceptQuestionFastPath.cjs');
const { refineQualifiedTargets } = require('./qualifierRefinement.cjs');
const { ROLE_RETRY_ADDENDUM, detectRoleContradiction } = require('./roleContradiction.cjs');
const { resolveAgentEntity } = require('../../../api/ontology/agentResolver.cjs');

const FANOUT_ENTITY_TYPES = Object.freeze(['recipe', 'coil', 'template', 'part']);

function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
function timed(runner) {
    const start = process.hrtime.bigint();
    return Promise.resolve().then(runner).then(value => ({ value, ms: elapsed(start) }));
}

function buildCandidateProposals(roles, workingUtterance) {
    const seen = new Set();
    const rejected = [];
    const spanAlignments = [];
    const candidateProposals = (roles || []).filter(item => item.role === 'FORMAL_ENTITY_CANDIDATE' && item.expression)
        .map(item => Object.freeze({ item, alignment: alignRoleExpressionToWorkingUtterance(item.expression, workingUtterance) }))
        .filter(entry => {
            const { item, alignment } = entry;
            spanAlignments.push(alignment);
            if (alignment.status !== 'UNIQUE_MATCH') {
                rejected.push(Object.freeze({ expression: item.expression, reason: alignment.status }));
                return false;
            }
            return true;
        })
        .filter(entry => {
            if (seen.has(entry.alignment.alignedExpression)) return false;
            seen.add(entry.alignment.alignedExpression);
            return true;
        }).map(({ item, alignment }) => Object.freeze({ expression: alignment.alignedExpression, role: 'FORMAL_ENTITY_CANDIDATE', source: 'ROLE_CLASSIFIER', sourceExpression: item.expression, alignedWorkingSpan: alignment.alignedExpression, workingUtterance }));
    return Object.freeze({ candidateProposals: Object.freeze(candidateProposals), rejectedCandidateProposals: Object.freeze(rejected), spanAlignments: Object.freeze(spanAlignments) });
}

function computeGroundingGate({ referenceStatus, roles, workingUtterance }) {
    if (referenceStatus === 'UNRESOLVED') return Object.freeze({ gate: 'STOP_UNRESOLVED_REFERENCE', candidateProposals: Object.freeze([]) });
    const { candidateProposals, rejectedCandidateProposals, spanAlignments } = buildCandidateProposals(roles, workingUtterance);
    if (candidateProposals.length) return Object.freeze({ gate: 'RUN', candidateProposals, rejectedCandidateProposals, spanAlignments });
    const roleValues = (roles || []).map(item => item.role);
    if (roleValues.length && roleValues.every(value => value === 'CONCEPT_ONLY')) return Object.freeze({ gate: 'STOP_CONCEPT_ONLY', candidateProposals, rejectedCandidateProposals, spanAlignments });
    return Object.freeze({ gate: 'STOP_NO_FORMAL_TARGET', candidateProposals, rejectedCandidateProposals, spanAlignments });
}

function formalStatus(result) {
    if (result.status === 'RESOLVED') return 'EXACT';
    if (result.status === 'AMBIGUOUS') return 'MULTIPLE';
    return 'UNRESOLVED';
}

function deriveFormalResult(mention, typeResults) {
    const supported = typeResults.filter(item => item.result.status === 'RESOLVED' || item.result.status === 'AMBIGUOUS');
    if (!supported.length) return Object.freeze({ mention, entityType: null, status: 'UNRESOLVED', candidates: Object.freeze([]), typeResults: Object.freeze(typeResults) });
    if (supported.length > 1) {
        return Object.freeze({ mention, entityType: null, status: 'MULTIPLE_TYPE', candidates: Object.freeze(supported.flatMap(item => item.result.candidates || [])), typeResults: Object.freeze(typeResults) });
    }
    const match = supported[0];
    return Object.freeze({ mention, entityType: match.entityType, status: formalStatus(match.result), canonicalId: match.result.canonicalId || null,
        canonicalName: match.result.canonicalName || null, candidates: Object.freeze(match.result.candidates || []), typeResults: Object.freeze(typeResults) });
}

async function resolveCandidateProposal(proposal, resolver, dependencies) {
    const typeResults = [];
    for (const entityType of FANOUT_ENTITY_TYPES) {
        const started = process.hrtime.bigint();
        const result = await resolver({ entityType, mention: proposal.expression }, dependencies);
        typeResults.push(Object.freeze({ entityType, result, resolverMs: elapsed(started) }));
    }
    return Object.freeze({ ...deriveFormalResult(proposal.expression, typeResults), proposal });
}

function finalTargetFromSupportedProbe(probe) {
    return Object.freeze({ mention: probe.mention, entityType: probe.entityType, status: probe.status, canonicalId: probe.canonicalId || null, canonicalName: probe.canonicalName || null, candidates: probe.candidates, source: 'RESOLVER_PROBE', proposal: probe.proposal });
}

function validateCandidateProposals({ probeResults, workingUtterance, roles = [] }) {
    const supportedProbeResults = probeResults.filter(item => item.status === 'EXACT' || item.status === 'MULTIPLE' || item.status === 'MULTIPLE_TYPE');
    const unresolvedProbeResults = probeResults.filter(item => item.status === 'UNRESOLVED');
    const qualifierCandidates = roles.filter(item => item.role === 'CONFIG_VALUE' && String(workingUtterance || '').includes(item.expression))
        .map(item => Object.freeze({ mention: item.expression, source: 'OWNER_EXPLICIT_CONFIG_VALUE', proposal: null }));
    const refinement = refineQualifiedTargets({ supportedProbeResults, unresolvedProbeResults, qualifierCandidates, workingUtterance });
    const finalGroundedTargets = [];
    for (const probe of supportedProbeResults) {
        const replacement = refinement.replacements.get(probe.mention);
        if (replacement) finalGroundedTargets.push(...replacement);
        else finalGroundedTargets.push(finalTargetFromSupportedProbe(probe));
    }
    return Object.freeze({ supportedProbeResults: Object.freeze(supportedProbeResults), unresolvedProbeResults: Object.freeze(unresolvedProbeResults), unresolvedProposalWarnings: Object.freeze(unresolvedProbeResults.map(item => Object.freeze({ expression: item.mention, reason: 'UNRESOLVED_PROPOSAL_WARNING', proposal: item.proposal }))), qualifierCandidates: Object.freeze(qualifierCandidates), qualifierRefinements: refinement.refinements, finalGroundedTargets: Object.freeze(finalGroundedTargets) });
}

async function runGroundingPipeline(input, dependencies = {}) {
    const businessRunner = dependencies.runBusinessAgent || runBusinessAgent;
    const policyRunner = dependencies.runPolicyAgent || runPolicyAgent;
    const referenceRunner = dependencies.runReferenceResolver || runReferenceResolver;
    const roleRunner = dependencies.runRoleClassifier || runRoleClassifier;
    const resolver = dependencies.resolveAgentEntity || resolveAgentEntity;
    const totalStart = process.hrtime.bigint();
    const detection = detectReferenceSurface(input.userInput);
    const [business, policy] = await Promise.all([
        timed(() => businessRunner({ userInput: input.userInput, recentConversation: input.recentOwnerWording, businessModel: input.businessModel }, dependencies)),
        timed(() => policyRunner({ userInput: input.userInput, recentConversation: input.recentOwnerWording, domainPolicy: input.domainPolicy }, dependencies)),
    ]);
    const referenceHintStarted = process.hrtime.bigint();
    const businessReferenceHint = detection.status === 'DETECTED'
        ? buildNarrowBusinessReferenceHint({ recentOwnerWording: input.recentOwnerWording || '', businessMemo: business.value })
        : null;
    const referenceHintMs = detection.status === 'DETECTED' ? elapsed(referenceHintStarted) : 0;
    const referenceFastStarted = process.hrtime.bigint();
    const referenceFastPath = detection.status === 'DETECTED'
        ? resolveReferenceFastPath({ userInput: input.userInput, recentOwnerWording: input.recentOwnerWording || '', referenceSurface: detection.surface, businessReferenceHint })
        : null;
    const referenceFastPathMs = detection.status === 'DETECTED' ? elapsed(referenceFastStarted) : 0;
    const referenceModel = referenceFastPath?.mode === 'DEFER_TO_LLM'
        ? await timed(() => referenceRunner({ userInput: input.userInput, recentOwnerWording: input.recentOwnerWording || '', referenceSurface: detection.surface, businessReferenceHint }, dependencies))
        : { value: null, ms: 0 };
    const reference = referenceFastPath?.mode === 'SAFE_RESOLVED'
        ? Object.freeze({ status: 'RESOLVED', surface: detection.surface, resolvedLanguageReference: referenceFastPath.resolvedLanguageReference })
        : referenceFastPath?.mode === 'SAFE_UNRESOLVED'
            ? Object.freeze({ status: 'UNRESOLVED', surface: detection.surface, resolvedLanguageReference: null })
            : parseReferenceMemo(referenceModel.value, detection, input.recentOwnerWording || '');
    const referenceSource = referenceFastPath?.mode === 'SAFE_RESOLVED' || referenceFastPath?.mode === 'SAFE_UNRESOLVED'
        ? 'FAST_PATH'
        : detection.status === 'DETECTED' ? 'LLM' : 'NONE';
    const rewriteStarted = process.hrtime.bigint();
    const working = buildGroundingWorkingUtterance({ rawOwnerInput: input.userInput, reference });
    const referenceRewriteMs = elapsed(rewriteStarted);
    if (reference.status === 'UNRESOLVED') {
        return Object.freeze({
            businessMemo: business.value, policyMemo: policy.value, referenceDetection: detection, businessReferenceHint, referenceFastPath, referenceSource, referenceMemo: referenceModel.value, reference, workingUtterance: working.workingUtterance, referenceRewrite: working.rewrite,
            conceptFastPath: null, firstRoleMemo: null, secondRoleMemo: null, roleMemo: null, roles: Object.freeze([]), roleAttempts: 0, roleRetryTriggered: false, roleContradiction: null, roleStatus: 'NOT_RUN', retryAddendumUsed: false, gate: 'STOP_UNRESOLVED_REFERENCE', candidateProposals: Object.freeze([]), rejectedCandidateProposals: Object.freeze([]), spanAlignments: Object.freeze([]), probeResults: Object.freeze([]), supportedProbeResults: Object.freeze([]), unresolvedProbeResults: Object.freeze([]), unresolvedProposalWarnings: Object.freeze([]), qualifierRefinements: Object.freeze([]), finalGroundedTargets: Object.freeze([]),
            modelCalls: Object.freeze({ business: 1, policy: 1, reference: referenceSource === 'LLM' ? 1 : 0, role: 0, intent: 0, utteranceExtractor: 0 }),
            timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms, referenceHintMs, referenceFastPathMs, referenceMs: referenceModel.ms, referenceRewriteMs, conceptFastPathMs: 0, roleFirstMs: 0, roleRetryMs: 0, roleMs: 0, spanAlignmentMs: 0, resolverProbeMs: 0, qualifierRefinementMs: 0, totalMs: elapsed(totalStart) }),
        });
    }
    if (working.rewrite.failure) {
        return Object.freeze({
            businessMemo: business.value, policyMemo: policy.value, referenceDetection: detection, businessReferenceHint, referenceFastPath, referenceSource, referenceMemo: referenceModel.value, reference, workingUtterance: working.workingUtterance, referenceRewrite: working.rewrite,
            conceptFastPath: null, firstRoleMemo: null, secondRoleMemo: null, roleMemo: null, roles: Object.freeze([]), roleAttempts: 0, roleRetryTriggered: false, roleContradiction: null, roleStatus: 'NOT_RUN', retryAddendumUsed: false, gate: 'STOP_REFERENCE_REWRITE_FAILURE', candidateProposals: Object.freeze([]), rejectedCandidateProposals: Object.freeze([]), spanAlignments: Object.freeze([]), probeResults: Object.freeze([]), supportedProbeResults: Object.freeze([]), unresolvedProbeResults: Object.freeze([]), unresolvedProposalWarnings: Object.freeze([]), qualifierRefinements: Object.freeze([]), finalGroundedTargets: Object.freeze([]),
            modelCalls: Object.freeze({ business: 1, policy: 1, reference: detection.status === 'DETECTED' ? 1 : 0, role: 0, intent: 0, utteranceExtractor: 0 }),
            timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms, referenceHintMs, referenceFastPathMs, referenceMs: referenceModel.ms, referenceRewriteMs, conceptFastPathMs: 0, roleFirstMs: 0, roleRetryMs: 0, roleMs: 0, spanAlignmentMs: 0, resolverProbeMs: 0, qualifierRefinementMs: 0, totalMs: elapsed(totalStart) }),
        });
    }
    const conceptFastPathStarted = process.hrtime.bigint();
    const conceptFastPath = detectConceptQuestionFastPath(working.workingUtterance);
    const conceptFastPathMs = elapsed(conceptFastPathStarted);
    if (conceptFastPath.status === 'MATCHED_CONCEPT_ONLY') {
        return Object.freeze({
            businessMemo: business.value, policyMemo: policy.value, referenceDetection: detection, businessReferenceHint, referenceFastPath, referenceSource, referenceMemo: referenceModel.value, reference, workingUtterance: working.workingUtterance, referenceRewrite: working.rewrite,
            conceptFastPath, firstRoleMemo: null, secondRoleMemo: null, roleMemo: null, roles: Object.freeze([]), roleAttempts: 0, roleRetryTriggered: false, roleContradiction: null, roleStatus: 'NOT_RUN', retryAddendumUsed: false, gate: 'STOP_CONCEPT_ONLY', candidateProposals: Object.freeze([]), rejectedCandidateProposals: Object.freeze([]), spanAlignments: Object.freeze([]), probeResults: Object.freeze([]), supportedProbeResults: Object.freeze([]), unresolvedProbeResults: Object.freeze([]), unresolvedProposalWarnings: Object.freeze([]), qualifierRefinements: Object.freeze([]), finalGroundedTargets: Object.freeze([]),
            modelCalls: Object.freeze({ business: 1, policy: 1, reference: referenceSource === 'LLM' ? 1 : 0, role: 0, intent: 0, utteranceExtractor: 0 }),
            timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms, referenceHintMs, referenceFastPathMs, referenceMs: referenceModel.ms, referenceRewriteMs, conceptFastPathMs, roleFirstMs: 0, roleRetryMs: 0, roleMs: 0, spanAlignmentMs: 0, resolverProbeMs: 0, qualifierRefinementMs: 0, totalMs: elapsed(totalStart) }),
        });
    }
    const firstRole = await timed(() => roleRunner({ workingUtterance: working.workingUtterance, businessMemo: business.value, policyMemo: policy.value }, dependencies));
    const firstParsedRole = parseRoleMemo(firstRole.value);
    const contradiction = detectRoleContradiction({ conceptFastPath, roles: firstParsedRole.roles });
    const retryRole = contradiction.triggered
        ? await timed(() => roleRunner({ workingUtterance: working.workingUtterance, businessMemo: business.value, policyMemo: policy.value, retryAddendum: ROLE_RETRY_ADDENDUM }, dependencies))
        : { value: null, ms: 0 };
    const parsedRole = contradiction.triggered ? parseRoleMemo(retryRole.value) : firstParsedRole;
    const roleAttempts = contradiction.triggered ? 2 : 1;
    const roleUnresolvedAfterRetry = contradiction.triggered && !parsedRole.roles.some(item => item.role === 'FORMAL_ENTITY_CANDIDATE');
    const spanAlignmentStarted = process.hrtime.bigint();
    const computedGate = computeGroundingGate({ referenceStatus: reference.status, roles: parsedRole.roles, workingUtterance: working.workingUtterance });
    const gate = roleUnresolvedAfterRetry
        ? Object.freeze({ ...computedGate, gate: 'STOP_ROLE_UNRESOLVED', candidateProposals: Object.freeze([]) })
        : computedGate;
    const spanAlignmentMs = elapsed(spanAlignmentStarted);
    const probeResults = [];
    if (gate.gate === 'RUN') {
        for (const proposal of gate.candidateProposals) probeResults.push(await resolveCandidateProposal(proposal, resolver, dependencies));
    }
    const resolverProbeMs = probeResults.reduce((sum, result) => sum + result.typeResults.reduce((subtotal, item) => subtotal + item.resolverMs, 0), 0);
    const refinementStarted = process.hrtime.bigint();
    const validation = validateCandidateProposals({ probeResults, workingUtterance: working.workingUtterance, roles: parsedRole.roles });
    const qualifierRefinementMs = elapsed(refinementStarted);
    return Object.freeze({
        businessMemo: business.value, policyMemo: policy.value, referenceDetection: detection, businessReferenceHint, referenceFastPath, referenceSource, referenceMemo: referenceModel.value, reference, workingUtterance: working.workingUtterance, referenceRewrite: working.rewrite,
        conceptFastPath, firstRoleMemo: firstRole.value, secondRoleMemo: retryRole.value, roleMemo: contradiction.triggered ? retryRole.value : firstRole.value, roles: parsedRole.roles, roleAttempts, roleRetryTriggered: contradiction.triggered, roleContradiction: contradiction, roleStatus: roleUnresolvedAfterRetry ? 'UNRESOLVED_AFTER_RETRY' : 'RESOLVED', retryAddendumUsed: contradiction.triggered, gate: gate.gate, candidateProposals: gate.candidateProposals, rejectedCandidateProposals: gate.rejectedCandidateProposals || Object.freeze([]), spanAlignments: gate.spanAlignments || Object.freeze([]), probeResults: Object.freeze(probeResults), ...validation,
        modelCalls: Object.freeze({ business: 1, policy: 1, reference: referenceSource === 'LLM' ? 1 : 0, role: roleAttempts, intent: 0, utteranceExtractor: 0 }),
        timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms, referenceHintMs, referenceFastPathMs, referenceMs: referenceModel.ms, referenceRewriteMs, conceptFastPathMs, roleFirstMs: firstRole.ms, roleRetryMs: retryRole.ms, roleMs: firstRole.ms + retryRole.ms, spanAlignmentMs, resolverProbeMs, qualifierRefinementMs, totalMs: elapsed(totalStart) }),
    });
}

module.exports = { FANOUT_ENTITY_TYPES, runGroundingPipeline, computeGroundingGate, buildCandidateProposals, deriveFormalResult, resolveCandidateProposal, validateCandidateProposals };
