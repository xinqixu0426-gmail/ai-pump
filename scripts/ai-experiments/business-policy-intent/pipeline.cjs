'use strict';

const { runBusinessAgent } = require('./businessAgent.cjs');
const { runPolicyAgent } = require('./policyAgent.cjs');
const { runUtteranceExtractor } = require('./intentAgent.cjs');

function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
async function runPipeline(input, dependencies = {}) {
    const businessRunner = dependencies.runBusinessAgent || runBusinessAgent;
    const policyRunner = dependencies.runPolicyAgent || runPolicyAgent;
    const utteranceRunner = dependencies.runUtteranceExtractor || runUtteranceExtractor;
    const contextStart = process.hrtime.bigint();
    const timed = async runner => {
        const start = process.hrtime.bigint();
        const value = await runner();
        return { value, ms: elapsed(start) };
    };
    const [business, utterance, policy] = await Promise.all([
        timed(() => businessRunner({ userInput: input.userInput, recentConversation: input.recentConversation, businessModel: input.businessModel }, dependencies)),
        timed(() => utteranceRunner({ userInput: input.userInput }, dependencies)),
        timed(() => policyRunner({ userInput: input.userInput, recentConversation: input.recentConversation, domainPolicy: input.domainPolicy }, dependencies)),
    ]);
    const totalMs = elapsed(contextStart);
    return Object.freeze({ businessMemo: business.value, utteranceMemo: utterance.value, policyMemo: policy.value, timings: Object.freeze({ businessMs: business.ms, utteranceMs: utterance.ms, policyMs: policy.ms, totalMs }) });
}

module.exports = { runPipeline };
