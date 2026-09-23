'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');
const {
    readAiNativeRolloutConfig,
    resolveAiNativeRollout,
    startupAiNativeRolloutSummary,
} = require('../api/services/aiNativeRolloutPolicy.cjs');

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

test('N7.1 AI_NATIVE_MODE defaults to off and invalid values fail closed', () => {
    assert.deepEqual(readAiNativeRolloutConfig({}), {
        mode: 'off', modeValid: true, modeSource: 'default', writeEnabled: false, writeValid: true, writeSource: 'default',
    });
    const invalid = resolveAiNativeRollout({ env: { AI_NATIVE_MODE: 'rollout-now' } });
    assert.equal(invalid.config.mode, 'off');
    assert.equal(invalid.config.modeValid, false);
    assert.equal(invalid.nativeTaskDelegation, false);
    assert.equal(invalid.nativeWriteAllowed, false);
    assert.equal(startupAiNativeRolloutSummary({ AI_NATIVE_MODE: 'owner', AI_NATIVE_WRITE_ENABLED: 'false' }).authority, 'owner-scoped-native');
});

test('N7.1 off and shadow retain Legacy authority without Native delegation or writes', () => {
    for (const mode of ['off', 'shadow']) {
        const rollout = resolveAiNativeRollout({ env: { AI_NATIVE_MODE: mode, AI_NATIVE_WRITE_ENABLED: 'true' } });
        assert.equal(rollout.responsibility, 'LEGACY');
        assert.equal(rollout.nativeTaskDelegation, false);
        assert.equal(rollout.nativeWriteAllowed, false);
        assert.equal(rollout.shadow, mode === 'shadow');
    }
});

test('N7.1 Owner path requires the authenticated Owner credential, not shared admin, internal secret, header, or prompt', () => {
    const env = { ...fixture(), AI_NATIVE_MODE: 'owner', AI_NATIVE_WRITE_ENABLED: 'false' };
    const ownerToken = issueOwnerToken(env.PUMP_OWNER_ACCESS_PASSWORD, env);
    const sharedToken = jwt.sign({ role: 'admin' }, env.JWT_SECRET, { expiresIn: '1h' });
    const owner = resolveAiNativeRollout({ request: { cookies: { token: ownerToken }, headers: {} }, env });
    assert.equal(owner.nativeTaskDelegation, true);
    assert.equal(owner.nativeWriteAllowed, false);
    for (const request of [
        { cookies: { token: sharedToken }, headers: {} },
        { headers: { 'x-internal-secret': env.INTERNAL_SECRET } },
        { headers: { 'x-owner': 'true', 'x-ai-native-mode': 'owner' }, body: { allowWrite: true } },
        {},
    ]) {
        const result = resolveAiNativeRollout({ request, env });
        assert.equal(result.nativeTaskDelegation, false);
        assert.equal(result.responsibility, 'LEGACY');
        assert.equal(result.nativeWriteAllowed, false);
    }
});

test('N7.1 write flag is independent and only an Owner owner-mode snapshot may enable it', () => {
    const base = fixture();
    const ownerToken = issueOwnerToken(base.PUMP_OWNER_ACCESS_PASSWORD, base);
    const request = { cookies: { token: ownerToken }, headers: {} };
    const disabled = resolveAiNativeRollout({ request, env: { ...base, AI_NATIVE_MODE: 'owner', AI_NATIVE_WRITE_ENABLED: 'false' } });
    const enabled = resolveAiNativeRollout({ request, env: { ...base, AI_NATIVE_MODE: 'owner', AI_NATIVE_WRITE_ENABLED: 'true' } });
    assert.equal(disabled.nativeTaskDelegation, true);
    assert.equal(disabled.nativeWriteAllowed, false);
    assert.equal(enabled.nativeTaskDelegation, true);
    assert.equal(enabled.nativeWriteAllowed, true);
});
