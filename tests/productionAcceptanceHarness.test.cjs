'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildAcceptanceRequest,
    invokeAcceptanceRequest,
    parseSemanticEligibility,
} = require('../scripts/run-business-semantic-production-validation.cjs');
const {
    buildProtectedCommandIntent,
    detectProtectedCommandRoute,
} = require('../api/services/aiProtectedCommandRoute.cjs');

const ids = suffix => ({
    runId: 'bus-p4r-v-test',
    requestId: `bus-p4r-v-test-${suffix}`,
    conversationId: `bus-p4r-v-test-${suffix}`,
});

test('production acceptance normal read is always write-disabled', async () => {
    let observed;
    await invokeAcceptanceRequest({
        mode: 'off',
        ...ids('off'),
        question: '12-140的成本是多少',
        invoke: async (_question, options) => { observed = options; return { ok: true }; },
    });
    assert.equal(observed.allowWrite, false);
    assert.equal(observed.env.AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED, 'false');
    assert.equal(observed.env.DEEPSEEK_MODEL, 'deepseek-v4-flash');
});

test('owner-scoped Enforcement Canary read is write-disabled while per-request enforcement is enabled', async () => {
    let observed;
    await invokeAcceptanceRequest({
        mode: 'on',
        ...ids('on'),
        question: '12-200还有货吗',
        invoke: async (_question, options) => { observed = options; return { ok: true }; },
    });
    assert.equal(observed.allowWrite, false);
    assert.equal(observed.env.AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED, 'true');
    assert.match(observed.confirmationSubject, /^internal:bus-p4r-v-test$/);
});

test('protected-write validation asks naturally but remains confirmation-only', async () => {
    let observed;
    await invokeAcceptanceRequest({
        mode: 'protected-write',
        ...ids('protected'),
        question: '请把零件轴承-201的库存增加1个',
        invoke: async (_question, options) => { observed = options; return { requiresConfirmation: true }; },
    });
    assert.equal(observed.allowWrite, false);
    assert.equal(observed.env.AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED, 'false');
});

test('protected-write fixture uses the deterministic update-part confirmation route', () => {
    const messages = [{ role: 'user', content: '请把零件轴承-201的单价设置为1.1' }];
    const route = detectProtectedCommandRoute(messages);
    const intent = buildProtectedCommandIntent(messages, route);
    assert.equal(route.preferredCapability, 'update_part');
    assert.equal(intent.steps[0].capabilityName, 'update_part');
});

test('accidental allowWrite=true is rejected before production invocation', async () => {
    let calls = 0;
    await assert.rejects(() => invokeAcceptanceRequest({
        mode: 'on',
        ...ids('rejected'),
        question: '12-140的成本是多少',
        overrides: { allowWrite: true },
        invoke: async () => { calls += 1; },
    }), error => error.code === 'ACCEPTANCE_ALLOW_WRITE_FORBIDDEN');
    assert.equal(calls, 0);
});

test('allowWrite=true cannot be smuggled through a protected-write validation request', () => {
    assert.throws(() => buildAcceptanceRequest({
        mode: 'protected-write',
        ...ids('protected-rejected'),
        overrides: { allowWrite: true },
    }), { code: 'ACCEPTANCE_ALLOW_WRITE_FORBIDDEN' });
});

test('request builder also fails closed without a valid mode or validation identity', () => {
    assert.throws(() => buildAcceptanceRequest({ mode: 'invalid', ...ids('invalid') }), { code: 'ACCEPTANCE_MODE_INVALID' });
    assert.throws(() => buildAcceptanceRequest({ mode: 'off' }), { code: 'ACCEPTANCE_ID_REQUIRED' });
});

test('promotion runner parses the authoritative kind field for negative and supported eligibility', () => {
    assert.deepEqual(parseSemanticEligibility({
        kind: 'OUT_OF_SCOPE', eligible: false, authority: 'LEGACY',
    }), {
        version: 1, kind: 'OUT_OF_SCOPE', eligible: false, authority: 'LEGACY',
    });
    assert.deepEqual(parseSemanticEligibility({
        kind: 'COST_QUERY', eligible: true, authority: 'BUSINESS_SEMANTIC_V1',
    }), {
        version: 1, kind: 'COST_QUERY', eligible: true, authority: 'BUSINESS_SEMANTIC_V1',
    });
});

test('promotion runner rejects the obsolete questionKind-only shape', () => {
    assert.throws(() => parseSemanticEligibility({
        questionKind: 'OUT_OF_SCOPE', eligible: false, authority: 'LEGACY', reason: 'NO_SUPPORTED_BUSINESS_SIGNAL',
    }), { code: 'RUNNER_SEMANTIC_CONTRACT_MISMATCH' });
});

test('promotion runner strict validation requires the authoritative reason field', () => {
    assert.throws(() => parseSemanticEligibility({
        kind: 'OUT_OF_SCOPE', eligible: false, authority: 'LEGACY',
    }, { requireReason: true }), { code: 'RUNNER_SEMANTIC_CONTRACT_MISMATCH' });
    assert.equal(parseSemanticEligibility({
        kind: 'OUT_OF_SCOPE', eligible: false, authority: 'LEGACY', reason: 'NO_SUPPORTED_BUSINESS_SIGNAL',
    }, { requireReason: true }).reason, 'NO_SUPPORTED_BUSINESS_SIGNAL');
});
