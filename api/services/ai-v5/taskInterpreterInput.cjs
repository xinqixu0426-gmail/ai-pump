'use strict';

const crypto = require('node:crypto');
const { normalizeAiPageContext } = require('../aiPageContext.cjs');

const V5_INTERPRETER_INPUT_ENVELOPE_VERSION = 1;
const INPUT_KEYS = Object.freeze(['rawUserRequest', 'pageContext']);
const ENVELOPE_KEYS = Object.freeze(['version', 'rawUserRequest', 'safePreRoutingContext', 'inputFingerprint']);

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

function stableFingerprint(rawUserRequest, safePreRoutingContext) {
    return crypto.createHash('sha256').update(JSON.stringify({
        rawUserRequest,
        safePreRoutingContext,
    })).digest('hex');
}

function safePageContext(pageContext) {
    if (pageContext === undefined || pageContext === null) return null;
    const normalized = normalizeAiPageContext(pageContext);
    if (!normalized) throw new TypeError('V5_INTERPRETER_PAGE_CONTEXT_INVALID');
    return Object.freeze({ surfaceType: normalized.resourceType, view: normalized.view });
}

function createV5InterpreterInputEnvelope(input) {
    if (!plainObject(input) || !exactKeys(input, INPUT_KEYS)) {
        throw new TypeError('V5_INTERPRETER_INPUT_SCHEMA_INVALID');
    }
    if (typeof input.rawUserRequest !== 'string' || input.rawUserRequest.length === 0) {
        throw new TypeError('V5_INTERPRETER_SOURCE_REQUEST_INVALID');
    }
    const context = safePageContext(input.pageContext);
    return Object.freeze({
        version: V5_INTERPRETER_INPUT_ENVELOPE_VERSION,
        rawUserRequest: input.rawUserRequest,
        safePreRoutingContext: context,
        inputFingerprint: stableFingerprint(input.rawUserRequest, context),
    });
}

function validateV5InterpreterInputEnvelope(value) {
    if (!plainObject(value) || !exactKeys(value, ENVELOPE_KEYS)) return false;
    if (value.version !== V5_INTERPRETER_INPUT_ENVELOPE_VERSION) return false;
    if (typeof value.rawUserRequest !== 'string' || value.rawUserRequest.length === 0) return false;
    if (value.safePreRoutingContext !== null) {
        if (!plainObject(value.safePreRoutingContext)
            || !exactKeys(value.safePreRoutingContext, ['surfaceType', 'view'])
            || value.safePreRoutingContext.surfaceType !== 'order'
            || typeof value.safePreRoutingContext.view !== 'string') return false;
    }
    return value.inputFingerprint === stableFingerprint(value.rawUserRequest, value.safePreRoutingContext);
}

function serializeSafePreRoutingContext(envelope) {
    if (!validateV5InterpreterInputEnvelope(envelope)) throw new TypeError('V5_INTERPRETER_ENVELOPE_INVALID');
    return envelope.safePreRoutingContext === null
        ? 'NOT_AVAILABLE'
        : JSON.stringify(envelope.safePreRoutingContext);
}

module.exports = {
    V5_INTERPRETER_INPUT_ENVELOPE_VERSION,
    createV5InterpreterInputEnvelope,
    serializeSafePreRoutingContext,
    validateV5InterpreterInputEnvelope,
};
