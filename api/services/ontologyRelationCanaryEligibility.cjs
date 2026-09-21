'use strict';

const crypto = require('node:crypto');
const {
    isAuthenticatedOwner,
    verifyAuthentication,
} = require('./ownerAuthentication.cjs');

function equalSecret(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
    const leftHash = crypto.createHash('sha256').update(left).digest();
    const rightHash = crypto.createHash('sha256').update(right).digest();
    return crypto.timingSafeEqual(leftHash, rightHash);
}

function isTrustedInternalAiRequest(req = {}, env = process.env) {
    return equalSecret(req.headers?.['x-internal-secret'], env.INTERNAL_SECRET);
}

function isOwnerOntologyRelationCanaryRequest(req = {}, env = process.env) {
    const token = req.cookies?.token;
    if (typeof token !== 'string' || !token) return false;
    return isAuthenticatedOwner(verifyAuthentication(token, env), env);
}

// Shared admission boundary for read-only AI canaries. A browser-controlled field or
// header is never sufficient: the request must be backed by the existing Owner JWT or
// the existing internal service secret.
function isOwnerScopedAiCanaryRequestEligible(req = {}, env = process.env) {
    return isTrustedInternalAiRequest(req, env)
        || isOwnerOntologyRelationCanaryRequest(req, env);
}

// Identity admission only. The runtime independently requires the environment canary flag.
function isOntologyRelationCanaryRequestEligible(req = {}, env = process.env) {
    return isOwnerScopedAiCanaryRequestEligible(req, env);
}

module.exports = {
    equalSecret,
    isOwnerScopedAiCanaryRequestEligible,
    isOntologyRelationCanaryRequestEligible,
    isOwnerOntologyRelationCanaryRequest,
    isTrustedInternalAiRequest,
};
