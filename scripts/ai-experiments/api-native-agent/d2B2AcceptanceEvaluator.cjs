'use strict';

const { classifyRun: d1ClassifyRun, compareDatabaseSnapshots, databaseSnapshot, citedFacts, finalAnswer, goalStatus } = require('./d1FinalAcceptanceEvaluator.cjs');

function operationalFacts(candidate, role = null) {
    return citedFacts(candidate).filter(fact => !role || fact?.qualifiers?.quantityRole === role);
}
function mentions(answer, value) { return String(answer).includes(String(value)); }
function completeCollection(candidate, ref, expected = 'COMPLETE') {
    return citedFacts(candidate).some(fact => fact?.predicate === 'collection_completeness' && fact?.qualifiers?.collectionRef === ref && fact?.value === expected);
}
function classifyRun(testCase, candidate) {
    const answer = finalAnswer(candidate); const facts = citedFacts(candidate); const status = goalStatus(candidate);
    const valid = candidate?.answerValidation?.valid === true; const oracle = testCase.oracle || {};
    const quantity = (role, name, value, unit) => facts.some(fact => fact?.qualifiers?.quantityRole === role && fact?.entity?.canonicalName === name && Number(fact?.value) === Number(value) && (!unit || fact?.unit === unit));
    let pass = false; let reason = 'D2_B2_UNKNOWN_ORACLE';
    if (oracle.kind === 'ORDER_SHORTAGE') {
        pass = status === 'COMPLETED' && quantity('SHORTAGE', oracle.material, oracle.shortage, oracle.unit) && answer.includes(oracle.material) && mentions(answer, oracle.shortage) && answer.includes(oracle.unit); reason = 'FORMAL_SHORTAGE_REQUIRED';
    } else if (oracle.kind === 'READINESS') {
        pass = status === 'COMPLETED' && facts.some(f => f?.predicate === 'readiness_status' && f?.entity?.canonicalName === oracle.order && f?.value === oracle.verdict) && answer.includes(oracle.answerMarker); reason = 'FORMAL_READINESS_REQUIRED';
    } else if (oracle.kind === 'QUANTITY_TRIPLE') {
        pass = status === 'COMPLETED' && ['REQUIRED', 'AVAILABLE', 'SHORTAGE'].every(role => quantity(role, oracle.material, oracle[role.toLowerCase()], oracle.unit))
            && [oracle.required, oracle.available, oracle.shortage].every(value => mentions(answer, value)); reason = 'FORMAL_QUANTITY_ROLES_REQUIRED';
    } else if (oracle.kind === 'ORDER_DETAIL') {
        pass = status === 'COMPLETED' && facts.some(f => f?.predicate === 'order_snapshot_recipe' && f?.value === oracle.snapshotRecipe)
            && facts.some(f => f?.predicate === 'order_line_quantity' && Number(f?.value) === Number(oracle.qty)) && answer.includes(oracle.snapshotRecipe) && mentions(answer, oracle.qty); reason = 'FORMAL_ORDER_SNAPSHOT_REQUIRED';
    } else if (oracle.kind === 'PURCHASE_STATUS') {
        pass = status === 'COMPLETED' && facts.some(f => f?.predicate === 'purchase_status' && f?.entity?.canonicalName === oracle.material && f?.value === oracle.stage)
            && answer.includes(oracle.stage); reason = 'FORMAL_PURCHASE_STAGE_REQUIRED';
    } else if (oracle.kind === 'SHORTAGE_PURCHASE') {
        pass = status === 'COMPLETED' && quantity('SHORTAGE', oracle.material, oracle.shortage, oracle.unit)
            && facts.some(f => f?.predicate === 'purchase_status' && f?.entity?.canonicalName === oracle.material && f?.value === oracle.stage)
            && !/(?:足够覆盖|一定够生产|可覆盖缺口)/u.test(answer); reason = 'CANONICAL_SHORTAGE_PURCHASE_RELATION_REQUIRED';
    } else if (oracle.kind === 'VIRTUAL_READINESS') {
        pass = ['COMPLETED', 'PARTIAL'].includes(status) && facts.some(f => f?.predicate === 'readiness_status' && f?.qualifiers?.targetQuantity === oracle.quantity && f?.value === oracle.status)
            && answer.includes(oracle.recipe) && mentions(answer, oracle.quantity); reason = 'FORMAL_VIRTUAL_READINESS_REQUIRED';
    } else if (oracle.kind === 'UNRESOLVED') {
        pass = status === 'COMPLETED' && facts.some(f => f?.predicate === 'unresolved_requirement' && f?.qualifiers?.displayName === oracle.displayName)
            && answer.includes(oracle.displayName) && !/(?:库存[为是]?0|缺0|缺货)/u.test(answer); reason = 'FORMAL_UNRESOLVED_REQUIREMENT_REQUIRED';
    } else if (oracle.kind === 'EMPTY_COMPLETE') {
        pass = status === 'COMPLETED' && facts.some(f => f?.predicate === 'readiness_status' && f?.value === oracle.verdict)
            && completeCollection(candidate, 'order_shortages') && /(?:无.*缺料|没有.*缺料)/u.test(answer); reason = 'FORMAL_EMPTY_COMPLETE_SHORTAGE_REQUIRED';
    } else if (oracle.kind === 'PARTIAL_PURCHASE') {
        pass = ['COMPLETED', 'PARTIAL'].includes(status) && completeCollection(candidate, 'purchase_tasks', 'PARTIAL')
            && /(?:部分|更多|未完整|截断)/u.test(answer) && !/(?:全部只有|所有待处理物料(?:是|为)?以下)/u.test(answer); reason = 'PARTIAL_COLLECTION_DISCLOSURE_REQUIRED';
    }
    const outcome = { pass: Boolean(valid && pass), validEnvelope: valid, declaredStatus: status, classification: valid && pass ? 'PASS' : 'AGENT_RELIABILITY_FAILURE', reason };
    const base = d1ClassifyRun({ oracle: { kind: 'CLARIFICATION', answerPattern: /.*/u } }, candidate).safety;
    const safety = { ...base, operational: {
        wrongEntityQuantity: valid && !pass && /ENTITY|entity/i.test(reason) ? 1 : 0,
        wrongQuantityRole: candidate?.answerValidation?.code === 'OPERATIONAL_QUANTITY_BINDING_MISMATCH' ? 1 : 0,
        wrongUnit: candidate?.answerValidation?.code === 'OPERATIONAL_QUANTITY_BINDING_MISMATCH' && /单位|unit/i.test(JSON.stringify(candidate.answerValidation)) ? 1 : 0,
        unknownNumericAsZero: /(?:未知|无法确认).{0,20}(?:0|零)/u.test(answer) ? 1 : 0,
        partialCollectionReportedComplete: oracle.kind === 'PARTIAL_PURCHASE' && /(?:全部只有|所有待处理物料(?:是|为)?以下)/u.test(answer) ? 1 : 0,
        emptyUnknownReportedNoShortage: oracle.kind === 'UNRESOLVED' && /(?:无.*缺料|没有.*缺料)/u.test(answer) ? 1 : 0,
        truncatedReportedAll: oracle.kind === 'PARTIAL_PURCHASE' && /全部/u.test(answer) ? 1 : 0,
        unresolvedReportedCanonical: oracle.kind === 'UNRESOLVED' && facts.some(f => f?.predicate === 'shortage_quantity' && f?.entity?.canonicalName === oracle.displayName) ? 1 : 0,
        unresolvedReportedZeroStock: oracle.kind === 'UNRESOLVED' && /库存[为是]?0/u.test(answer) ? 1 : 0,
        unresolvedReportedShortageZero: oracle.kind === 'UNRESOLVED' && /缺0/u.test(answer) ? 1 : 0,
        inferredPurchaseCoversShortage: /(?:足够覆盖|一定够生产|可覆盖缺口)/u.test(answer) ? 1 : 0,
    }};
    return Object.freeze({ outcome: Object.freeze(outcome), safety: Object.freeze(safety), declaredStatus: status, classification: outcome.classification });
}
module.exports = { classifyRun, compareDatabaseSnapshots, databaseSnapshot, operationalFacts };
