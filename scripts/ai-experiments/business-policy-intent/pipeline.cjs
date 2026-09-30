'use strict';

const { runBusinessAgent } = require('./businessAgent.cjs');
const { runPolicyAgent } = require('./policyAgent.cjs');
const { runIntentAgent } = require('./intentAgent.cjs');

function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
async function runPipeline(input, dependencies = {}) {
    const businessRunner = dependencies.runBusinessAgent || runBusinessAgent;
    const policyRunner = dependencies.runPolicyAgent || runPolicyAgent;
    const intentRunner = dependencies.runIntentAgent || runIntentAgent;
    const contextStart = process.hrtime.bigint();
    const timed = async runner => {
        const start = process.hrtime.bigint();
        const value = await runner();
        return { value, ms: elapsed(start) };
    };
    const [business, policy] = await Promise.all([
        timed(() => businessRunner({ userInput: input.userInput, recentConversation: input.recentConversation, businessModel: input.businessModel }, dependencies)),
        timed(() => policyRunner({ userInput: input.userInput, recentConversation: input.recentConversation, domainPolicy: input.domainPolicy }, dependencies)),
    ]);
    const parallelContextMs = elapsed(contextStart);
    const intentStart = process.hrtime.bigint();
    const intentMemo = await intentRunner({ userInput: input.userInput, recentConversation: input.recentConversation, businessMemo: business.value, policyMemo: policy.value }, dependencies);
    const intentMs = elapsed(intentStart);
    return Object.freeze({ businessMemo: business.value, policyMemo: policy.value, intentMemo, timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms, parallelContextMs, intentMs, totalMs: parallelContextMs + intentMs }) });
}

module.exports = { runPipeline };
