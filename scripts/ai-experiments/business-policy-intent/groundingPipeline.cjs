'use strict';

const { runBusinessAgent } = require('./businessAgent.cjs');
const { runPolicyAgent } = require('./policyAgent.cjs');
const { detectReferenceSurface } = require('./referenceDetection.cjs');
const { runReferenceResolver, parseReferenceMemo } = require('./referenceResolver.cjs');
const { runRoleClassifier, parseRoleMemo } = require('./roleClassifier.cjs');
const { resolveAgentEntity } = require('../../../api/ontology/agentResolver.cjs');

function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
function timed(runner) {
    const start = process.hrtime.bigint();
    return Promise.resolve().then(runner).then(value => ({ value, ms: elapsed(start) }));
}

function uniqueFormalTargets(roles) {
    const seen = new Set();
    return Object.freeze((roles || []).filter(item => item.role === 'FORMAL_ENTITY_CANDIDATE' && item.entityType && item.expression)
        .filter(item => {
            const key = `${item.entityType}\u0000${item.expression}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(item => Object.freeze({ mention: item.expression, entityType: item.entityType })));
}

function computeGroundingGate({ requestClass, referenceStatus, roles }) {
    const formalTargets = uniqueFormalTargets(roles);
    if (requestClass === 'CONCEPT_ONLY') return Object.freeze({ groundingNeed: 'NOT_REQUIRED', gate: 'STOP_NOT_REQUIRED', formalTargets: Object.freeze([]) });
    if (referenceStatus === 'UNRESOLVED') return Object.freeze({ groundingNeed: 'REQUIRED', gate: 'STOP_UNRESOLVED_REFERENCE', formalTargets: Object.freeze([]) });
    if (!formalTargets.length) return Object.freeze({ groundingNeed: 'REQUIRED', gate: 'STOP_NO_FORMAL_TARGET', formalTargets });
    return Object.freeze({ groundingNeed: 'REQUIRED', gate: 'RUN', formalTargets });
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
    const role = await timed(() => roleRunner({
        userInput: input.userInput,
        businessMemo: business.value,
        policyMemo: policy.value,
        reference,
    }, dependencies));
    const parsedRole = parseRoleMemo(role.value);
    const gate = computeGroundingGate({ requestClass: parsedRole.requestClass, referenceStatus: reference.status, roles: parsedRole.roles });
    const resolutions = [];
    if (gate.gate === 'RUN') {
        for (const target of gate.formalTargets) {
            const started = process.hrtime.bigint();
            const result = await resolver({ entityType: target.entityType, mention: target.mention }, dependencies);
            resolutions.push(Object.freeze({ ...target, result, resolverMs: elapsed(started) }));
        }
    }
    return Object.freeze({
        businessMemo: business.value,
        policyMemo: policy.value,
        referenceDetection: detection,
        referenceMemo: referenceModel.value,
        reference,
        roleMemo: role.value,
        requestClass: parsedRole.requestClass,
        roles: parsedRole.roles,
        groundingNeed: gate.groundingNeed,
        gate: gate.gate,
        formalTargets: gate.formalTargets,
        resolutions: Object.freeze(resolutions),
        modelCalls: Object.freeze({ business: 1, policy: 1, reference: detection.status === 'DETECTED' ? 1 : 0, role: 1, intent: 0, utteranceExtractor: 0 }),
        timings: Object.freeze({
            businessMs: business.ms,
            policyMs: policy.ms,
            referenceMs: referenceModel.ms,
            roleClassifierMs: role.ms,
            resolverMs: resolutions.reduce((sum, item) => sum + item.resolverMs, 0),
            totalMs: elapsed(totalStart),
        }),
    });
}

module.exports = { runGroundingPipeline, computeGroundingGate, uniqueFormalTargets };
