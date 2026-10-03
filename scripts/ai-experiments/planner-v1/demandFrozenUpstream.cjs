'use strict';

const fs = require('fs');
const path = require('path');
const { runGroundingPipeline } = require('../business-policy-intent/groundingPipeline.cjs');
const { createGroundingFixture } = require('../business-policy-intent/groundingFixture.cjs');

const root = path.resolve(__dirname, '../../..');
const businessModel = fs.readFileSync(path.join(root, 'planning/business-understanding/company-business-model-v1.md'), 'utf8');
const domainPolicy = [
    fs.readFileSync(path.join(root, 'api/services/ai-assistant/domain-policy.md'), 'utf8'),
    fs.readFileSync(path.join(root, 'planning/business-understanding/domain-policy-recipe-configurable-cost-v1.md'), 'utf8'),
].join('\n\n');

async function realFrozenUpstream(testCase, env) {
    const fixture = createGroundingFixture();
    try {
        const result = await runGroundingPipeline({ userInput: testCase.user, recentOwnerWording: '', businessModel, domainPolicy }, {
            env,
            lookupEntities: async (_fetch, request) => fixture.lookupEntities(request),
            internalFetch: () => { throw new Error('PLANNER_REAL_UPSTREAM_FIXTURE_LOOKUP_DOES_NOT_FETCH'); },
        });
        return Object.freeze({ groundingResult: result.gate === 'RUN' ? 'RESOLVED' : result.gate, finalGroundedTargets: result.finalGroundedTargets, groundingAmbiguity: result.finalGroundedTargets.some(target => target.status === 'MULTIPLE') ? 'MULTIPLE formal candidates' : 'NONE', businessMemo: result.businessMemo, policyMemo: result.policyMemo, upstreamTimings: result.timings, upstreamModelCalls: result.modelCalls, source: 'REAL_FROZEN_UPSTREAM_CHAIN' });
    } finally { fixture.close(); }
}
module.exports = { realFrozenUpstream };
