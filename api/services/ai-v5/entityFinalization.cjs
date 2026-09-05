'use strict';
function finalizeEntity(candidateSet, selectedClass) {
    if (!candidateSet.eligible || !candidateSet.complete) return { status: 'INCOMPLETE_CANDIDATE_SET', candidate: null };
    const remaining = candidateSet.candidates.filter(candidate => selectedClass.entityTypes.includes(candidate.entityType));
    if (remaining.length === 0) return { status: 'CLASS_ENTITY_MISMATCH', candidate: null };
    if (remaining.length > 1) return { status: 'FINAL_ENTITY_AMBIGUOUS', candidate: null };
    return { status: 'FINAL_ENTITY_RESOLVED', candidate: remaining[0] };
}
module.exports = { finalizeEntity };
