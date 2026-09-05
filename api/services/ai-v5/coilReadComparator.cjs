'use strict';
// Transient same-snapshot comparison: canonical identity, stable scheme reference, current inventory.
function compareCoilRead(result, referenceRows, canonicalId) {
    if (!Array.isArray(referenceRows) || referenceRows.length !== 1
        || String(referenceRows[0].id) !== String(canonicalId)
        || typeof referenceRows[0].schemeCode !== 'string'
        || typeof referenceRows[0].stock !== 'number' || !Number.isFinite(referenceRows[0].stock)) return 'NOT_COMPARABLE';
    if (result?.success !== true || result.count !== 1 || !Array.isArray(result.data) || result.data.length !== 1) return 'MISMATCH';
    const actual = result.data[0], expected = referenceRows[0];
    return String(actual.id) === String(expected.id) && actual.schemeCode === expected.schemeCode
        && actual.stock === expected.stock ? 'MATCH' : 'MISMATCH';
}
module.exports = { compareCoilRead };
