const test = require('node:test');
const assert = require('node:assert/strict');
const {
    consumeBusinessConfirmation,
    issueBusinessConfirmation,
    resetBusinessConfirmationsForTests,
} = require('../api/services/businessConfirmation.cjs');

test.beforeEach(() => {
    resetBusinessConfirmationsForTests();
});

function issue(overrides = {}) {
    return issueBusinessConfirmation({
        capabilityId: 'drawings.rotor.generate_pdf',
        input: {
            drawingName: 'V750',
            fcParams: { piece_count: 160 },
        },
        subject: 'user:session-a',
        operationId: 'operation-draw-1',
        now: 1_000,
        ...overrides,
    });
}

test('业务确认：token 绑定正式能力、服务端输入和 operationId', () => {
    const confirmation = issue();
    const consumed = consumeBusinessConfirmation({
        confirmationToken: confirmation.confirmationToken,
        capabilityId: 'drawings.rotor.generate_pdf',
        subject: 'user:session-a',
        idempotencyKey: 'rotor-draw:operation-1',
        now: 2_000,
    });

    assert.equal(consumed.operationId, 'operation-draw-1');
    assert.equal(consumed.inputHash, confirmation.inputHash);
    assert.deepEqual(consumed.input, {
        drawingName: 'V750',
        fcParams: { piece_count: 160 },
    });
});

test('业务确认：换主体、换能力和过期 token 均拒绝', () => {
    const subjectBound = issue();
    assert.throws(
        () => consumeBusinessConfirmation({
            confirmationToken: subjectBound.confirmationToken,
            capabilityId: 'drawings.rotor.generate_pdf',
            subject: 'user:session-b',
            idempotencyKey: 'rotor-draw:operation-2',
            now: 2_000,
        }),
        error => error.code === 'confirmation_subject_mismatch'
    );
    assert.throws(
        () => consumeBusinessConfirmation({
            confirmationToken: subjectBound.confirmationToken,
            capabilityId: 'drawings.rotor.print_pdf',
            subject: 'user:session-a',
            idempotencyKey: 'rotor-draw:operation-2',
            now: 2_000,
        }),
        error => error.code === 'confirmation_payload_mismatch'
    );

    const expiring = issue({ now: 10_000, ttlMs: 30_000 });
    assert.throws(
        () => consumeBusinessConfirmation({
            confirmationToken: expiring.confirmationToken,
            capabilityId: 'drawings.rotor.generate_pdf',
            subject: 'user:session-a',
            idempotencyKey: 'rotor-draw:operation-3',
            now: 40_001,
        }),
        error => error.code === 'confirmation_token_expired'
    );
});

test('业务确认：首次执行绑定幂等键，不能换 key 重复触发副作用', () => {
    const confirmation = issue();
    consumeBusinessConfirmation({
        confirmationToken: confirmation.confirmationToken,
        capabilityId: 'drawings.rotor.generate_pdf',
        subject: 'user:session-a',
        idempotencyKey: 'rotor-draw:operation-4',
        now: 2_000,
    });
    assert.throws(
        () => consumeBusinessConfirmation({
            confirmationToken: confirmation.confirmationToken,
            capabilityId: 'drawings.rotor.generate_pdf',
            subject: 'user:session-a',
            idempotencyKey: 'rotor-draw:operation-other',
            now: 2_100,
        }),
        error => error.code === 'confirmation_already_bound'
    );

    const retry = consumeBusinessConfirmation({
        confirmationToken: confirmation.confirmationToken,
        capabilityId: 'drawings.rotor.generate_pdf',
        subject: 'user:session-a',
        idempotencyKey: 'rotor-draw:operation-4',
        now: 2_200,
    });
    assert.equal(retry.idempotencyKey, 'rotor-draw:operation-4');
});
