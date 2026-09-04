'use strict';

const V5_POLICY_VERSION = 1;

const V5_RISK_DEFINITIONS = Object.freeze({
    L0: Object.freeze({ code: 'L0', name: 'L0_CONVERSATION', readWriteClass: 'NONE' }),
    L1: Object.freeze({ code: 'L1', name: 'L1_BUSINESS_READ', readWriteClass: 'READ' }),
    L2: Object.freeze({ code: 'L2', name: 'L2_BUSINESS_ANALYSIS', readWriteClass: 'READ' }),
    L3: Object.freeze({ code: 'L3', name: 'L3_CHANGE_PROPOSAL', readWriteClass: 'WRITE' }),
    L4: Object.freeze({ code: 'L4', name: 'L4_APPROVED_WRITE', readWriteClass: 'WRITE' }),
    L5: Object.freeze({ code: 'L5', name: 'L5_CRITICAL_IRREVERSIBLE', readWriteClass: 'WRITE' }),
});

const V5_APPROVAL_STATES = Object.freeze(['NOT_REQUIRED', 'REQUIRED', 'PENDING', 'APPROVED', 'REJECTED']);

function getRiskDefinition(riskClass) {
    return V5_RISK_DEFINITIONS[String(riskClass || '')] || null;
}

function validateRiskConsistency(riskClass, readWriteClass) {
    const definition = getRiskDefinition(riskClass);
    return Boolean(definition && definition.readWriteClass === readWriteClass);
}

module.exports = {
    V5_APPROVAL_STATES,
    V5_POLICY_VERSION,
    V5_RISK_DEFINITIONS,
    getRiskDefinition,
    validateRiskConsistency,
};
