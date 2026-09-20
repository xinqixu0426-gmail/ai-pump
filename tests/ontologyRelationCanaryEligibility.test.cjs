'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');
const {
    isOntologyRelationCanaryRequestEligible,
    isOwnerOntologyRelationCanaryRequest,
    isTrustedInternalAiRequest,
} = require('../api/services/ontologyRelationCanaryEligibility.cjs');

function fixture() {
    return {
        ACCESS_PASSWORD: 'synthetic-shared-password',
        JWT_SECRET: 'synthetic-jwt-test-secret',
        INTERNAL_SECRET: 'synthetic-internal-secret',
        PUMP_OWNER_ACCESS_PASSWORD: 'synthetic-owner-credential-only-for-unit-test',
        PUMP_OWNER_SUBJECT: 'synthetic_owner_subject_001',
        AI_V5_OWNER_SUBJECTS: '["synthetic_owner_subject_001"]',
    };
}

test('Ontology Canary 身份边界：正式 Owner token 可进入，共享 admin 与伪造 req.user 不可', () => {
    const env = fixture();
    const ownerToken = issueOwnerToken(env.PUMP_OWNER_ACCESS_PASSWORD, env);
    const sharedToken = jwt.sign({ role: 'admin' }, env.JWT_SECRET, { expiresIn: '1h' });
    assert.equal(isOwnerOntologyRelationCanaryRequest({ cookies: { token: ownerToken } }, env), true);
    assert.equal(isOntologyRelationCanaryRequestEligible({ cookies: { token: ownerToken } }, env), true);
    assert.equal(isOntologyRelationCanaryRequestEligible({ cookies: { token: sharedToken }, user: { role: 'admin' } }, env), false);
    assert.equal(isOntologyRelationCanaryRequestEligible({ user: { role: 'admin', owner: true } }, env), false);
    assert.equal(isOntologyRelationCanaryRequestEligible({ cookies: { token: 'forged' } }, env), false);
});

test('Ontology Canary 身份边界：仅现有精确 internal secret 可进入', () => {
    const env = fixture();
    const exact = { headers: { 'x-internal-secret': env.INTERNAL_SECRET } };
    assert.equal(isTrustedInternalAiRequest(exact, env), true);
    assert.equal(isOntologyRelationCanaryRequestEligible(exact, env), true);
    for (const request of [
        { headers: { 'x-internal-secret': 'wrong' } },
        { headers: { 'x-internal-secret': '' } },
        { headers: { 'x-owner': 'true' } },
        { query: { owner: 'true' } },
        {},
    ]) assert.equal(isOntologyRelationCanaryRequestEligible(request, env), false);
});

test('Ontology Canary 身份边界：配置缺失时 fail closed', () => {
    assert.equal(isTrustedInternalAiRequest({ headers: { 'x-internal-secret': 'anything' } }, {}), false);
    assert.equal(isOwnerOntologyRelationCanaryRequest({ cookies: { token: 'anything' } }, {}), false);
    assert.equal(isOntologyRelationCanaryRequestEligible({ user: { role: 'admin' } }, {}), false);
});
