'use strict';

const { validateV5TaskInterpretation } = require('./taskInterpretationContract.cjs');
const { getV5TaskClass } = require('./taskClassCatalog.cjs');
const { getSourceSpan } = require('./sourceSpanCatalog.cjs');

const V5_TASK_INTERPRETER_PROTOCOL_VERSION = 2;
const TOP_LEVEL_KEYS = Object.freeze(['protocolVersion', 'taskClassRef', 'entitySelections', 'needsClarification']);
const SELECTION_KEYS = Object.freeze(['slotRef', 'spanRef']);

class V5TaskInterpreterProtocolError extends TypeError {
    constructor(reasonCode) {
        super(reasonCode);
        this.name = 'V5TaskInterpreterProtocolError';
        this.code = 'V5_TASK_INTERPRETER_PROTOCOL_INVALID';
        this.reasonCode = reasonCode;
    }
}

function fail(reasonCode) {
    throw new V5TaskInterpreterProtocolError(reasonCode);
}

function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
    const keys = Object.keys(value).sort();
    const allowed = [...expected].sort();
    return keys.length === allowed.length && keys.every((key, index) => key === allowed[index]);
}

function validateProtocolV2(value, sourceSpanCatalog) {
    if (!plainObject(value) || !exactKeys(value, TOP_LEVEL_KEYS)) fail('PROTOCOL_V2_SCHEMA_INVALID');
    if (value.protocolVersion !== V5_TASK_INTERPRETER_PROTOCOL_VERSION) fail('PROTOCOL_V2_VERSION_INVALID');
    const taskClass = getV5TaskClass(value.taskClassRef);
    if (!taskClass) fail('INVALID_TASK_CLASS_REF');
    if (typeof value.needsClarification !== 'boolean' || !Array.isArray(value.entitySelections)) fail('PROTOCOL_V2_SCHEMA_INVALID');
    const seenSlots = new Set();
    const selections = value.entitySelections.map(selection => {
        if (!plainObject(selection) || !exactKeys(selection, SELECTION_KEYS)) fail('PROTOCOL_V2_SELECTION_SCHEMA_INVALID');
        const slot = taskClass.entitySlots.find(item => item.slotRef === selection.slotRef);
        if (!slot || seenSlots.has(selection.slotRef)) fail('INVALID_ENTITY_SLOT_REF');
        seenSlots.add(selection.slotRef);
        const span = getSourceSpan(sourceSpanCatalog, selection.spanRef);
        if (!span) fail('INVALID_SPAN_REF');
        return Object.freeze({ slot, spanRef: span.spanRef, span });
    });
    if (!value.needsClarification) {
        if (selections.length !== taskClass.entitySlots.length
            || taskClass.entitySlots.some(slot => !seenSlots.has(slot.slotRef))) fail('REQUIRED_ENTITY_SELECTION_MISSING');
    }
    return Object.freeze({
        protocolVersion: V5_TASK_INTERPRETER_PROTOCOL_VERSION,
        taskClass,
        taskClassRef: taskClass.classRef,
        selections: Object.freeze(selections),
        sourceSpanRefs: Object.freeze(selections.map(item => item.spanRef)),
        needsClarification: value.needsClarification,
    });
}

function parseProtocolV2(content, sourceSpanCatalog) {
    if (typeof content !== 'string' || content.length === 0) fail('PROTOCOL_V2_JSON_INVALID');
    let value;
    try { value = JSON.parse(content); } catch { fail('PROTOCOL_V2_JSON_INVALID'); }
    return validateProtocolV2(value, sourceSpanCatalog);
}

function projectProtocolV2ToContractV1(protocol) {
    const projected = {
        version: 1,
        domain: protocol.taskClass.domain,
        operation: protocol.taskClass.operation,
        entityCandidates: protocol.selections.map(item => ({
            entityType: item.slot.entityType,
            candidateText: item.span.text,
        })),
        needsClarification: protocol.needsClarification,
        reasonCodes: [protocol.needsClarification ? 'NEEDS_CLARIFICATION' : 'INTERPRETATION_COMPLETE'],
    };
    return validateV5TaskInterpretation(projected);
}

module.exports = {
    V5_TASK_INTERPRETER_PROTOCOL_VERSION,
    V5TaskInterpreterProtocolError,
    parseProtocolV2,
    projectProtocolV2ToContractV1,
    validateProtocolV2,
};
