'use strict';
function isFatalRecord(record) {
    return record.lookupStatus === 'ERROR' || ['ERROR','TIMEOUT'].includes(record.stage1Status)
        || ['ERROR','TIMEOUT'].includes(record.stage2Status);
}
function verifyHashes(actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('FROZEN_HASH_MISMATCH');
}
// Persist/cleanup may run first; a fatal must still reject the outer CLI main.
function enforceFatalExit(dataset) {
    if (dataset.fatalReason) throw new Error('FORMAL_EVALUATION_INFRASTRUCTURE_FATAL');
}
module.exports = { isFatalRecord, verifyHashes, enforceFatalExit };
