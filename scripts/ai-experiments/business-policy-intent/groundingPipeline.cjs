'use strict';

const { runBusinessAgent } = require('./businessAgent.cjs');
const { runPolicyAgent } = require('./policyAgent.cjs');
const { runGroundingAgent } = require('./groundingAgent.cjs');
const { resolveAgentEntity } = require('../../../api/ontology/agentResolver.cjs');
const { extractLanguageTargets } = require('./groundingMemo.cjs');

function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
function timed(runner) {
    const start = process.hrtime.bigint();
    return Promise.resolve().then(runner).then(value => ({ value, ms: elapsed(start) }));
}

async function runGroundingPipeline(input, dependencies = {}) {
    const businessRunner = dependencies.runBusinessAgent || runBusinessAgent;
    const policyRunner = dependencies.runPolicyAgent || runPolicyAgent;
    const groundingRunner = dependencies.runGroundingAgent || runGroundingAgent;
    const resolver = dependencies.resolveAgentEntity || resolveAgentEntity;
    const totalStart = process.hrtime.bigint();
    const [business, policy] = await Promise.all([
        timed(() => businessRunner({ userInput: input.userInput, recentConversation: input.recentOwnerWording, businessModel: input.businessModel }, dependencies)),
        timed(() => policyRunner({ userInput: input.userInput, recentConversation: input.recentOwnerWording, domainPolicy: input.domainPolicy }, dependencies)),
    ]);
    const grounding = await timed(() => groundingRunner({
        userInput: input.userInput,
        recentOwnerWording: input.recentOwnerWording,
        businessMemo: business.value,
        policyMemo: policy.value,
    }, dependencies));
    const targets = extractLanguageTargets(grounding.value);
    const resolutions = [];
    for (const target of targets) {
        if (!target.entityType || !target.mention) continue;
        const started = process.hrtime.bigint();
        const result = await resolver({ entityType: target.entityType, mention: target.mention }, dependencies);
        resolutions.push(Object.freeze({ ...target, result, resolverMs: elapsed(started) }));
    }
    return Object.freeze({
        businessMemo: business.value,
        policyMemo: policy.value,
        groundingMemo: grounding.value,
        resolutions: Object.freeze(resolutions),
        timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms, groundingModelMs: grounding.ms,
            resolverMs: resolutions.reduce((sum, item) => sum + item.resolverMs, 0), totalMs: elapsed(totalStart) }),
    });
}

module.exports = { runGroundingPipeline };
