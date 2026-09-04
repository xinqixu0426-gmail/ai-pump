'use strict';

const { listV5Capabilities } = require('./capabilityRegistry.cjs');
const { getV5EntityType, listV5EntityTypes } = require('./businessOntology.cjs');

const V5_TASK_INTERPRETER_VERSION = 1;
const V5_TASK_INTERPRETER_PROMPT_VERSION = 2;
const TOP_LEVEL_KEYS = Object.freeze([
    'version', 'domain', 'operation', 'entityCandidates', 'needsClarification', 'reasonCodes',
]);
const ENTITY_KEYS = Object.freeze(['entityType', 'candidateText']);
const V5_INTERPRETER_REASON_CODES = Object.freeze([
    'INTERPRETATION_COMPLETE',
    'NEEDS_CLARIFICATION',
    'ENTITY_REFERENCE_REQUIRED',
]);

class V5TaskInterpretationValidationError extends TypeError {
    constructor(reasonCode) {
        super(reasonCode);
        this.name = 'V5TaskInterpretationValidationError';
        this.code = 'V5_TASK_INTERPRETATION_INVALID';
        this.reasonCode = reasonCode;
    }
}

function fail(reasonCode) {
    throw new V5TaskInterpretationValidationError(reasonCode);
}

function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, allowed) {
    const keys = Object.keys(value).sort();
    const expected = [...allowed].sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function knownDomainOperation(domain, operation) {
    return listV5Capabilities().some(item => item.domain === domain && item.operation === operation);
}

function validateV5TaskInterpretation(value) {
    if (!plainObject(value) || !exactKeys(value, TOP_LEVEL_KEYS)) fail('INTERPRETATION_SCHEMA_INVALID');
    if (value.version !== V5_TASK_INTERPRETER_VERSION) fail('INTERPRETATION_VERSION_INVALID');
    if (typeof value.domain !== 'string'
        || !listV5Capabilities().some(item => item.domain === value.domain)) fail('INTERPRETATION_DOMAIN_INVALID');
    if (typeof value.operation !== 'string'
        || !listV5Capabilities().some(item => item.operation === value.operation)) fail('INTERPRETATION_OPERATION_INVALID');
    if (!knownDomainOperation(value.domain, value.operation)) fail('INTERPRETATION_DOMAIN_OPERATION_INVALID');
    if (typeof value.needsClarification !== 'boolean') fail('INTERPRETATION_CLARIFICATION_INVALID');
    if (!Array.isArray(value.reasonCodes)
        || value.reasonCodes.some(code => !V5_INTERPRETER_REASON_CODES.includes(code))) {
        fail('INTERPRETATION_REASON_CODE_INVALID');
    }
    if (!Array.isArray(value.entityCandidates) || value.entityCandidates.length > 8) {
        fail('INTERPRETATION_ENTITIES_INVALID');
    }
    const entityCandidates = value.entityCandidates.map(candidate => {
        if (!plainObject(candidate) || !exactKeys(candidate, ENTITY_KEYS)) fail('INTERPRETATION_ENTITY_SCHEMA_INVALID');
        if (typeof candidate.entityType !== 'string' || !getV5EntityType(candidate.entityType)) {
            fail('INTERPRETATION_ENTITY_TYPE_INVALID');
        }
        if (typeof candidate.candidateText !== 'string' || candidate.candidateText.length === 0) {
            fail('INTERPRETATION_ENTITY_TEXT_INVALID');
        }
        return Object.freeze({
            entityType: candidate.entityType,
            candidateText: candidate.candidateText,
        });
    });
    if (!value.needsClarification && entityCandidates.length === 0) fail('INTERPRETATION_ENTITY_REQUIRED');
    return Object.freeze({
        version: V5_TASK_INTERPRETER_VERSION,
        domain: value.domain,
        operation: value.operation,
        entityCandidates: Object.freeze(entityCandidates),
        needsClarification: value.needsClarification,
        reasonCodes: Object.freeze([...new Set(value.reasonCodes)]),
    });
}

function parseV5TaskInterpretation(content) {
    if (typeof content !== 'string' || content.length === 0) fail('INTERPRETATION_JSON_INVALID');
    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch {
        fail('INTERPRETATION_JSON_INVALID');
    }
    return validateV5TaskInterpretation(parsed);
}

function interpreterEnumContract() {
    return Object.freeze({
        routes: Object.freeze(listV5Capabilities().map(item => Object.freeze({
            domain: item.domain,
            operation: item.operation,
            entityTypes: Object.freeze([...item.requiredEntityTypes]),
        }))),
        entityTypes: Object.freeze(listV5EntityTypes().map(item => item.entityType).sort()),
    });
}

module.exports = {
    V5_INTERPRETER_REASON_CODES,
    V5_TASK_INTERPRETER_PROMPT_VERSION,
    V5_TASK_INTERPRETER_VERSION,
    V5TaskInterpretationValidationError,
    interpreterEnumContract,
    parseV5TaskInterpretation,
    validateV5TaskInterpretation,
};
