'use strict';
function numericMatches(claim, fact) {
    return typeof claim.numericValue === 'number' && Number.isFinite(claim.numericValue)
        && typeof fact.value === 'number' && Number.isFinite(fact.value) && claim.numericValue === fact.value;
}
module.exports = { numericMatches };
