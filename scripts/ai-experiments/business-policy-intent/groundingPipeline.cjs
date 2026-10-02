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
const { resolveAgentEntity } = require('../../../api/ontology/agentResolver.cjs');

const FANOUT_ENTITY_TYPES = Object.freeze(['recipe', 'coil', 'template', 'part']);

function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
function timed(runner) {
    const start = process.hrtime.bigint();
    return Promise.resolve().then(runner).then(value => ({ value, ms: elapsed(start) }));
}

function uniqueFormalTargets(roles, workingUtterance) {
    const seen = new Set();
    const rejected = [];
    const spanAlignments = [];
    const formalTargets = (roles || []).filter(item => item.role === 'FORMAL_ENTITY_CANDIDATE' && item.expression)
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
        }).map(({ item, alignment }) => Object.freeze({ mention: alignment.alignedExpression, source: 'ROLE_CLASSIFIER', sourceExpression: item.expression, alignedWorkingSpan: alignment.alignedExpression, workingUtterance }));
    return Object.freeze({ formalTargets: Object.freeze(formalTargets), rejectedFormalTargets: Object.freeze(rejected), spanAlignments: Object.freeze(spanAlignments) });
}

function computeGroundingGate({ referenceStatus, roles, workingUtterance }) {
    if (referenceStatus === 'UNRESOLVED') return Object.freeze({ gate: 'STOP_UNRESOLVED_REFERENCE', formalTargets: Object.freeze([]) });
    const { formalTargets, rejectedFormalTargets, spanAlignments } = uniqueFormalTargets(roles, workingUtterance);
    if (formalTargets.length) return Object.freeze({ gate: 'RUN', formalTargets, rejectedFormalTargets, spanAlignments });
    const roleValues = (roles || []).map(item => item.role);
    if (roleValues.length && roleValues.every(value => value === 'CONCEPT_ONLY')) return Object.freeze({ gate: 'STOP_CONCEPT_ONLY', formalTargets, rejectedFormalTargets, spanAlignments });
    return Object.freeze({ gate: 'STOP_NO_FORMAL_TARGET', formalTargets, rejectedFormalTargets, spanAlignments });
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

async function resolveFormalCandidate(target, resolver, dependencies) {
    const typeResults = [];
    for (const entityType of FANOUT_ENTITY_TYPES) {
        const started = process.hrtime.bigint();
        const result = await resolver({ entityType, mention: target.mention }, dependencies);
        typeResults.push(Object.freeze({ entityType, result, resolverMs: elapsed(started) }));
    }
    return deriveFormalResult(target.mention, typeResults);
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
            conceptFastPath: null, roleMemo: null, roles: Object.freeze([]), gate: 'STOP_UNRESOLVED_REFERENCE', formalTargets: Object.freeze([]), rejectedFormalTargets: Object.freeze([]), spanAlignments: Object.freeze([]), formalResults: Object.freeze([]),
            modelCalls: Object.freeze({ business: 1, policy: 1, reference: referenceSource === 'LLM' ? 1 : 0, role: 0, intent: 0, utteranceExtractor: 0 }),
            timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms, referenceHintMs, referenceFastPathMs, referenceMs: referenceModel.ms, referenceRewriteMs, conceptFastPathMs: 0, roleMs: 0, spanAlignmentMs: 0, resolverFanoutMs: 0, totalMs: elapsed(totalStart) }),
        });
    }
    if (working.rewrite.failure) {
        return Object.freeze({
            businessMemo: business.value, policyMemo: policy.value, referenceDetection: detection, businessReferenceHint, referenceFastPath, referenceSource, referenceMemo: referenceModel.value, reference, workingUtterance: working.workingUtterance, referenceRewrite: working.rewrite,
            conceptFastPath: null, roleMemo: null, roles: Object.freeze([]), gate: 'STOP_REFERENCE_REWRITE_FAILURE', formalTargets: Object.freeze([]), rejectedFormalTargets: Object.freeze([]), spanAlignments: Object.freeze([]), formalResults: Object.freeze([]),
            modelCalls: Object.freeze({ business: 1, policy: 1, reference: detection.status === 'DETECTED' ? 1 : 0, role: 0, intent: 0, utteranceExtractor: 0 }),
            timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms, referenceHintMs, referenceFastPathMs, referenceMs: referenceModel.ms, referenceRewriteMs, conceptFastPathMs: 0, roleMs: 0, spanAlignmentMs: 0, resolverFanoutMs: 0, totalMs: elapsed(totalStart) }),
        });
    }
    const conceptFastPathStarted = process.hrtime.bigint();
    const conceptFastPath = detectConceptQuestionFastPath(working.workingUtterance);
    const conceptFastPathMs = elapsed(conceptFastPathStarted);
    if (conceptFastPath.status === 'MATCHED_CONCEPT_ONLY') {
        return Object.freeze({
            businessMemo: business.value, policyMemo: policy.value, referenceDetection: detection, businessReferenceHint, referenceFastPath, referenceSource, referenceMemo: referenceModel.value, reference, workingUtterance: working.workingUtterance, referenceRewrite: working.rewrite,
            conceptFastPath, roleMemo: null, roles: Object.freeze([]), gate: 'STOP_CONCEPT_ONLY', formalTargets: Object.freeze([]), rejectedFormalTargets: Object.freeze([]), spanAlignments: Object.freeze([]), formalResults: Object.freeze([]),
            modelCalls: Object.freeze({ business: 1, policy: 1, reference: referenceSource === 'LLM' ? 1 : 0, role: 0, intent: 0, utteranceExtractor: 0 }),
            timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms, referenceHintMs, referenceFastPathMs, referenceMs: referenceModel.ms, referenceRewriteMs, conceptFastPathMs, roleMs: 0, spanAlignmentMs: 0, resolverFanoutMs: 0, totalMs: elapsed(totalStart) }),
        });
    }
    const role = await timed(() => roleRunner({ workingUtterance: working.workingUtterance, businessMemo: business.value, policyMemo: policy.value }, dependencies));
    const parsedRole = parseRoleMemo(role.value);
    const spanAlignmentStarted = process.hrtime.bigint();
    const gate = computeGroundingGate({ referenceStatus: reference.status, roles: parsedRole.roles, workingUtterance: working.workingUtterance });
    const spanAlignmentMs = elapsed(spanAlignmentStarted);
    const formalResults = [];
    if (gate.gate === 'RUN') {
        for (const target of gate.formalTargets) formalResults.push(await resolveFormalCandidate(target, resolver, dependencies));
    }
    const resolverFanoutMs = formalResults.reduce((sum, result) => sum + result.typeResults.reduce((subtotal, item) => subtotal + item.resolverMs, 0), 0);
    return Object.freeze({
        businessMemo: business.value, policyMemo: policy.value, referenceDetection: detection, businessReferenceHint, referenceFastPath, referenceSource, referenceMemo: referenceModel.value, reference, workingUtterance: working.workingUtterance, referenceRewrite: working.rewrite,
        conceptFastPath, roleMemo: role.value, roles: parsedRole.roles, gate: gate.gate, formalTargets: gate.formalTargets, rejectedFormalTargets: gate.rejectedFormalTargets || Object.freeze([]), spanAlignments: gate.spanAlignments || Object.freeze([]), formalResults: Object.freeze(formalResults),
        modelCalls: Object.freeze({ business: 1, policy: 1, reference: referenceSource === 'LLM' ? 1 : 0, role: 1, intent: 0, utteranceExtractor: 0 }),
        timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms, referenceHintMs, referenceFastPathMs, referenceMs: referenceModel.ms, referenceRewriteMs, conceptFastPathMs, roleMs: role.ms, spanAlignmentMs, resolverFanoutMs, totalMs: elapsed(totalStart) }),
    });
}

module.exports = { FANOUT_ENTITY_TYPES, runGroundingPipeline, computeGroundingGate, uniqueFormalTargets, deriveFormalResult, resolveFormalCandidate };
