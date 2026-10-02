'use strict';

const { runBusinessAgent } = require('./businessAgent.cjs');
const { runPolicyAgent } = require('./policyAgent.cjs');
const { detectReferenceSurface } = require('./referenceDetection.cjs');
const { runReferenceResolver, parseReferenceMemo } = require('./referenceResolver.cjs');
const { runRoleClassifier, parseRoleMemo } = require('./roleClassifier.cjs');
const { resolveAgentEntity } = require('../../../api/ontology/agentResolver.cjs');

const FANOUT_ENTITY_TYPES = Object.freeze(['recipe', 'coil', 'template', 'part']);

function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
function timed(runner) {
    const start = process.hrtime.bigint();
    return Promise.resolve().then(runner).then(value => ({ value, ms: elapsed(start) }));
}

function uniqueFormalTargets(roles) {
    const seen = new Set();
    return Object.freeze((roles || []).filter(item => item.role === 'FORMAL_ENTITY_CANDIDATE' && item.expression)
        .filter(item => {
            if (seen.has(item.expression)) return false;
            seen.add(item.expression);
            return true;
        }).map(item => Object.freeze({ mention: item.expression })));
}

function computeGroundingGate({ referenceStatus, roles }) {
    if (referenceStatus === 'UNRESOLVED') return Object.freeze({ gate: 'STOP_UNRESOLVED_REFERENCE', formalTargets: Object.freeze([]) });
    const formalTargets = uniqueFormalTargets(roles);
    if (formalTargets.length) return Object.freeze({ gate: 'RUN', formalTargets });
    const roleValues = (roles || []).map(item => item.role);
    if (roleValues.length && roleValues.every(value => value === 'CONCEPT_ONLY')) return Object.freeze({ gate: 'STOP_CONCEPT_ONLY', formalTargets });
    return Object.freeze({ gate: 'STOP_NO_FORMAL_TARGET', formalTargets });
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
    const referencePromise = detection.status === 'DETECTED'
        ? timed(() => referenceRunner({ userInput: input.userInput, recentOwnerWording: input.recentOwnerWording || '', referenceSurface: detection.surface }, dependencies))
        : Promise.resolve({ value: null, ms: 0 });
    const [business, policy, referenceModel] = await Promise.all([
        timed(() => businessRunner({ userInput: input.userInput, recentConversation: input.recentOwnerWording, businessModel: input.businessModel }, dependencies)),
        timed(() => policyRunner({ userInput: input.userInput, recentConversation: input.recentOwnerWording, domainPolicy: input.domainPolicy }, dependencies)),
        referencePromise,
    ]);
    const reference = parseReferenceMemo(referenceModel.value, detection);
    if (reference.status === 'UNRESOLVED') {
        return Object.freeze({
            businessMemo: business.value, policyMemo: policy.value, referenceDetection: detection, referenceMemo: referenceModel.value, reference,
            roleMemo: null, roles: Object.freeze([]), gate: 'STOP_UNRESOLVED_REFERENCE', formalTargets: Object.freeze([]), formalResults: Object.freeze([]),
            modelCalls: Object.freeze({ business: 1, policy: 1, reference: 1, role: 0, intent: 0, utteranceExtractor: 0 }),
            timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms, referenceMs: referenceModel.ms, roleMs: 0, resolverFanoutMs: 0, totalMs: elapsed(totalStart) }),
        });
    }
    const role = await timed(() => roleRunner({ userInput: input.userInput, businessMemo: business.value, policyMemo: policy.value, reference }, dependencies));
    const parsedRole = parseRoleMemo(role.value);
    const gate = computeGroundingGate({ referenceStatus: reference.status, roles: parsedRole.roles });
    const formalResults = [];
    if (gate.gate === 'RUN') {
        for (const target of gate.formalTargets) formalResults.push(await resolveFormalCandidate(target, resolver, dependencies));
    }
    const resolverFanoutMs = formalResults.reduce((sum, result) => sum + result.typeResults.reduce((subtotal, item) => subtotal + item.resolverMs, 0), 0);
    return Object.freeze({
        businessMemo: business.value, policyMemo: policy.value, referenceDetection: detection, referenceMemo: referenceModel.value, reference,
        roleMemo: role.value, roles: parsedRole.roles, gate: gate.gate, formalTargets: gate.formalTargets, formalResults: Object.freeze(formalResults),
        modelCalls: Object.freeze({ business: 1, policy: 1, reference: detection.status === 'DETECTED' ? 1 : 0, role: 1, intent: 0, utteranceExtractor: 0 }),
        timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms, referenceMs: referenceModel.ms, roleMs: role.ms, resolverFanoutMs, totalMs: elapsed(totalStart) }),
    });
}

module.exports = { FANOUT_ENTITY_TYPES, runGroundingPipeline, computeGroundingGate, uniqueFormalTargets, deriveFormalResult, resolveFormalCandidate };
