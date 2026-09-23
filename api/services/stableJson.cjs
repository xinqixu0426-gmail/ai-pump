'use strict';

// Neutral serialization primitives shared by business and AI contract layers.
// Keeping them here prevents domain services from depending on Task V2 code.
const crypto = require('node:crypto');

function normalizeJson(value) {
    if (value === undefined) return null;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(normalizeJson);
    return Object.fromEntries(Object.keys(value).sort()
        .filter(key => value[key] !== undefined && typeof value[key] !== 'function')
        .map(key => [key, normalizeJson(value[key])]));
}

function canonicalJson(value) {
    return JSON.stringify(normalizeJson(value));
}

function stableHash(value) {
    return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

module.exports = { canonicalJson, normalizeJson, stableHash };
