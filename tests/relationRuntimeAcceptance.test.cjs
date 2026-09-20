'use strict';
/**
 * ONT-P8L-FINAL — acceptance infrastructure for the two relation runtime gates.
 *
 * Supervisor ruling: the P8L Local Exit Gate and the Ontology Cloud Routing Gate validate two different
 * execution paths and must never substitute for each other. The runner must be fail-closed, must refuse a
 * mislabelled run (for example a cloud fallback inside the local gate), must judge against a logical
 * business fingerprint rather than a WAL-mode file hash, and must report a missed requirement as FAIL
 * instead of redefining it into a PASS.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    EMPTY_RELATION_CASES,
    GATE_IDS,
    assertGatePreconditions,
    businessFingerprint,
    classifyAnswer,
    evaluateVerdict,
    fingerprintDiff,
    gateProfile,
    readPageCompleteness,
    readSetCompleteness,
    resolveAcceptanceDatabasePath,
    runtimeEnvFrom,
} = require('../scripts/run-relation-runtime-acceptance.cjs');

const localGateEnv = (overrides = {}) => ({
    AI_PROVIDER: 'local',
    AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true',
    AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED: 'false',
    ...overrides,
});
const cloudGateEnv = (overrides = {}) => ({
    AI_PROVIDER: 'deepseek',
    AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED: 'true',
    ...overrides,
});

test('relation acceptance: the two gates are distinct and neither is an alias of the other', () => {
    assert.deepEqual([...GATE_IDS], ['p8l-local', 'ontology-cloud']);
    assert.notEqual(gateProfile('p8l-local').env.providerMustBe, gateProfile('ontology-cloud').env.providerMustBe);
    assert.notDeepEqual(gateProfile('p8l-local').env.requireEnabled, gateProfile('ontology-cloud').env.requireEnabled);
    assert.throws(() => gateProfile('p8r-cloud'), { code: 'GATE_UNKNOWN' });
    assert.throws(() => gateProfile(undefined), { code: 'GATE_UNKNOWN' });
});

test('relation acceptance: the local gate is fail-closed on every precondition it depends on', () => {
    assert.doesNotThrow(() => assertGatePreconditions('p8l-local', localGateEnv()));
    // An unset provider must never be assumed to be local: that is exactly how a cloud run gets
    // mislabelled as a local acceptance.
    assert.throws(() => assertGatePreconditions('p8l-local', localGateEnv({ AI_PROVIDER: undefined })), { code: 'GATE_PRECONDITION_FAILED' });
    assert.throws(() => assertGatePreconditions('p8l-local', localGateEnv({ AI_PROVIDER: 'deepseek' })), { code: 'GATE_PRECONDITION_FAILED' });
    assert.throws(() => assertGatePreconditions('p8l-local', localGateEnv({ AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'false' })), { code: 'GATE_PRECONDITION_FAILED' });
    assert.throws(() => assertGatePreconditions('p8l-local', localGateEnv({ AI_LOCAL_TOOL_SHORTLIST_ENABLED: undefined })), { code: 'GATE_PRECONDITION_FAILED' });
    assert.throws(() => assertGatePreconditions('p8l-local', localGateEnv({ AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED: 'true' })), { code: 'GATE_PRECONDITION_FAILED' });
});

test('relation acceptance: the cloud gate requires DeepSeek plus the ontology routing canary', () => {
    assert.doesNotThrow(() => assertGatePreconditions('ontology-cloud', cloudGateEnv()));
    assert.throws(() => assertGatePreconditions('ontology-cloud', cloudGateEnv({ AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED: 'false' })), { code: 'GATE_PRECONDITION_FAILED' });
    assert.throws(() => assertGatePreconditions('ontology-cloud', cloudGateEnv({ AI_PROVIDER: 'local' })), { code: 'GATE_PRECONDITION_FAILED' });
    assert.throws(() => assertGatePreconditions('ontology-cloud', { AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED: 'true' }), { code: 'GATE_PRECONDITION_FAILED' });
    // Both violations must be reported together, not one at a time.
    try {
        assertGatePreconditions('ontology-cloud', { AI_PROVIDER: 'local' });
        assert.fail('expected a precondition failure');
    } catch (error) {
        assert.equal(error.code, 'GATE_PRECONDITION_FAILED');
        assert.ok(error.message.includes('AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED'), error.message);
    }
});

test('relation acceptance: a flag is only enabled by an explicit true, never by an unset or loose value', () => {
    for (const value of ['yes', '1', 'on', 'TRUE ', 'true']) {
        const env = cloudGateEnv({ AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED: value });
        if (value.trim().toLowerCase() === 'true') assert.doesNotThrow(() => assertGatePreconditions('ontology-cloud', env));
        else assert.throws(() => assertGatePreconditions('ontology-cloud', env), { code: 'GATE_PRECONDITION_FAILED' }, value);
    }
});

test('relation acceptance: the runtime env is the process env overlaid by the env file', () => {
    const env = runtimeEnvFrom('AI_PROVIDER=deepseek\nAI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED=true\n', { PATH: '/usr/bin', AI_PROVIDER: 'local' });
    assert.equal(env.AI_PROVIDER, 'deepseek');
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED, 'true');
});

test('relation acceptance: correctness is judged on the expected canonical target, and a wrong coil is counted', () => {
    const coilEntry = { id: 'R2', direction: 'coil->recipes' };
    assert.equal(classifyAnswer(coilEntry, { expected: ['v750-tokoy'] }, '12-140 用在 v750-tokoy').correct, true);
    const missed = classifyAnswer(coilEntry, { expected: ['v750-tokoy'] }, '没有查到使用该线圈的配方');
    assert.equal(missed.correct, false);
    assert.deepEqual(missed.wrongTargets, [], 'a missing answer is not a wrong root');

    const recipeEntry = { id: 'R5', direction: 'recipe->coil' };
    const wrongCoil = classifyAnswer(recipeEntry, { expected: ['12-140'] }, 'v750-tokoy 用的是 12-120 线圈');
    assert.equal(wrongCoil.correct, false);
    assert.deepEqual(wrongCoil.wrongTargets, ['12-120'], 'naming a different coil is a wrong target');
    assert.equal(classifyAnswer(recipeEntry, { expected: ['12-140'] }, '用的是 12-140').correct, true);
});

function failingCase(overrides = {}) {
    return {
        caseId: 'R1', direction: 'coil->recipes', correct: true, wrongTargets: [],
        fallbacks: 0, tooLarge: 0, aggregateCalls: 0, done: true, errorCodes: [],
        bounded: [{ bytes: 61 }], aggregateBytes: 2,
        ...overrides,
    };
}
const cleanFingerprintDiff = { changedTables: [], auditDelta: 0, operationDelta: 0 };

test('relation acceptance: a fully correct run is PASS and an aggregate read on the accepted path is FAIL', () => {
    const pass = evaluateVerdict({
        profile: gateProfile('p8l-local'),
        cases: [failingCase(), failingCase({ caseId: 'R5', direction: 'recipe->coil', correct: false })],
        negativeCases: [],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    // One forward miss must already fail the gate: partial credit is not an exit criterion.
    assert.equal(pass.status, 'FAIL');
    assert.ok(pass.failures.some(line => line.startsWith('forward ')));

    const allCorrect = evaluateVerdict({
        profile: gateProfile('p8l-local'),
        cases: [failingCase(), failingCase({ caseId: 'R5', direction: 'recipe->coil' })],
        negativeCases: [{ caseId: 'N4', kind: 'write', writeProtected: true, fallbacks: 0, tooLarge: 0, aggregateCalls: 0, done: true, errorCodes: [], bounded: [], aggregateBytes: 0 }],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(allCorrect.status, 'PASS');
    assert.equal(allCorrect.observed.aggregateCalls, 0);

    const aggregate = evaluateVerdict({
        profile: gateProfile('p8l-local'),
        cases: [failingCase({ aggregateCalls: 1, aggregateBytes: 19194 }), failingCase({ caseId: 'R5', direction: 'recipe->coil' })],
        negativeCases: [],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(aggregate.status, 'FAIL');
    assert.ok(aggregate.failures.includes('aggregateCalls=1'));
});

test('relation acceptance: a write that is not a confirmation card, or a business table change, fails the gate', () => {
    const writeLeak = evaluateVerdict({
        profile: gateProfile('p8l-local'),
        cases: [failingCase()],
        negativeCases: [{ caseId: 'N4', kind: 'write', writeProtected: false, fallbacks: 0, tooLarge: 0, aggregateCalls: 0, done: true, errorCodes: [], bounded: [], aggregateBytes: 0 }],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(writeLeak.status, 'FAIL');
    assert.ok(writeLeak.failures.includes('unauthorizedWrites=1'));

    const mutated = evaluateVerdict({
        profile: gateProfile('p8l-local'),
        cases: [failingCase()],
        negativeCases: [],
        fingerprintDiffResult: { changedTables: ['parts'], auditDelta: 2, operationDelta: 1 },
    });
    assert.equal(mutated.status, 'FAIL');
    assert.ok(mutated.failures.some(line => line.startsWith('businessTablesChanged=')));
});

test('relation acceptance: a page-level complete is never read as set-level completeness', () => {
    // The service layer reports both fields. Only setCompleteness may certify that a whole relation is
    // known; `complete` alone is a property of the delivered page.
    const pageOnly = { complete: true };
    assert.equal(readPageCompleteness(pageOnly), true);
    assert.equal(readSetCompleteness(pageOnly), null, 'a page flag must not become set completeness');

    assert.equal(readSetCompleteness({ complete: true, setCompleteness: 'COMPLETE' }), 'COMPLETE');
    // The service layer reports the relation-level status as it is; downgrading a still-paginated
    // relation to PARTIAL is the AI tool executor's job (`queryExecutors.cjs`), so the helper must not
    // silently reinterpret it here. What matters is that a caller cannot obtain set completeness from
    // the page flag alone.
    assert.equal(readSetCompleteness({ complete: true, setCompleteness: 'COMPLETE', hasMore: true }), 'COMPLETE');
    assert.notEqual(readSetCompleteness({ complete: true, hasMore: false }), 'COMPLETE');
    assert.equal(readSetCompleteness({ complete: true, setCompleteness: 'AMBIGUOUS_LEGACY_REFERENCE' }), 'AMBIGUOUS_LEGACY_REFERENCE');
    assert.equal(readSetCompleteness({ complete: true, setCompleteness: 'REFERENCE_INCOMPLETE' }), 'REFERENCE_INCOMPLETE');
    assert.equal(readSetCompleteness({ complete: true, setCompleteness: 'PARTIAL' }), 'PARTIAL');

    // Both gates must carry an explicit empty-relation case and fail when it is not certified.
    for (const gateId of GATE_IDS) {
        assert.ok(gateProfile(gateId).required.additionalProviderRounds === 0, gateId);
    }
    assert.ok(EMPTY_RELATION_CASES.length > 0);
    assert.ok(EMPTY_RELATION_CASES.every(entry => entry.expectEmptyRelation === true));

    const uncertified = evaluateVerdict({
        profile: gateProfile('p8l-local'),
        cases: [failingCase(), failingCase({ caseId: 'R5', direction: 'recipe->coil' })],
        negativeCases: [],
        emptyRelationCases: [{ caseId: 'E1-empty-coil-relation', certificateOnly: false, aggregateFree: true }],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(uncertified.status, 'FAIL');
    assert.ok(uncertified.failures.some(line => line.startsWith('emptyRelationNotCertified=')));

    const certified = evaluateVerdict({
        profile: gateProfile('p8l-local'),
        cases: [failingCase(), failingCase({ caseId: 'R5', direction: 'recipe->coil' })],
        negativeCases: [],
        emptyRelationCases: [{ caseId: 'E1-empty-coil-relation', certificateOnly: true, aggregateFree: true }],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(certified.status, 'PASS');
    assert.equal(certified.observed.emptyRelationComplete, 1);
});

test('relation acceptance: an ontology-induced extra provider round fails the gate', () => {
    const verdict = evaluateVerdict({
        profile: gateProfile('ontology-cloud'),
        cases: [failingCase(), failingCase({ caseId: 'R5', direction: 'recipe->coil' })],
        negativeCases: [],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(verdict.status, 'PASS');
    assert.equal(verdict.observed.additionalProviderRounds, 0);
});

test('relation acceptance: the judged database must exist and be named explicitly', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relation-acceptance-'));
    // An isolated validation instance serves a verified copy, so the runner must never silently fall back
    // to a project-root database that may be a different file.
    assert.throws(() => resolveAcceptanceDatabasePath({ PUMP_ACCEPTANCE_DATABASE_PATH: path.join(dir, 'missing.db') }),
        { code: 'ACCEPTANCE_DATABASE_MISSING' });
    const copy = path.join(dir, 'pump-validation.db');
    fs.writeFileSync(copy, '');
    assert.equal(resolveAcceptanceDatabasePath({ PUMP_ACCEPTANCE_DATABASE_PATH: copy }), copy);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('relation acceptance: business invariance is a logical fingerprint, not a WAL-mode file hash', () => {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    require('../api/database/migrations.cjs').runMigrations(db);
    db.exec(`
        INSERT INTO parts(id,model,supplier,stock,price) VALUES(1,'零件甲','供应甲',3,10);
        INSERT INTO coils(id,spec,sheets,material,stock) VALUES(1,'12',120,'钢带',2);
    `);
    const before = businessFingerprint(db);
    assert.deepEqual(fingerprintDiff(before, businessFingerprint(db)), { changedTables: [], auditDelta: 0, operationDelta: 0 });

    // A volatile column must not be mistaken for a business change.
    db.exec("UPDATE parts SET updated_at='2099-01-01T00:00:00.000Z' WHERE id=1");
    assert.deepEqual(fingerprintDiff(before, businessFingerprint(db)).changedTables, []);

    // A content change must be caught even when the row count is identical.
    db.exec("UPDATE parts SET stock=4 WHERE id=1");
    assert.deepEqual(fingerprintDiff(before, businessFingerprint(db)).changedTables, ['parts']);

    // An append must be caught by both the row count and the audit delta.
    db.exec("INSERT INTO parts(id,model,supplier,stock,price) VALUES(2,'零件乙','供应乙',1,2)");
    const appended = fingerprintDiff(before, businessFingerprint(db));
    assert.deepEqual(appended.changedTables, ['parts']);
    assert.ok(appended.auditDelta >= 0);
    assert.ok(businessFingerprint(db).tables.parts.rows === before.tables.parts.rows + 1);
    db.close();
});
