'use strict';
const { resolveEntityTypeIndependent, validateLookupResponse } = require('./typeIndependentEntityResolver.cjs');
const { lookupEntities } = require('../../routes/ai/internalApiClient.cjs');

async function acquireCandidateSet(rawMention, options = {}) {
    let captured = null;
    let businessApiCalls = 0;
    const resolution = await resolveEntityTypeIndependent(rawMention, {
        timeoutMs: options.lookupTimeoutMs || 5000,
        internalFetch: options.internalFetch,
        lookupEntities: async (fetcher, input) => {
            businessApiCalls += 1;
            options.onBusinessApiCall?.();
            const value = validateLookupResponse(await (options.lookupEntities || lookupEntities)(fetcher, input), input.entityTypes.length);
            // Copy after validation, inside this request only. Never persist identities.
            captured = value.candidates.map(candidate => Object.freeze({ ...candidate }));
            return value;
        },
    });
    const eligible = ['RESOLVED', 'AMBIGUOUS'].includes(resolution.status) && resolution.complete && captured?.length > 0;
    return Object.freeze({ status: resolution.status, complete: resolution.complete,
        candidateCount: resolution.candidateCount, candidateTypeCount: resolution.candidateTypeCount,
        eligible: Boolean(eligible), businessApiCalls,
        candidates: Object.freeze(eligible ? captured : []), reasonCodes: resolution.reasonCodes });
}
module.exports = { acquireCandidateSet };
