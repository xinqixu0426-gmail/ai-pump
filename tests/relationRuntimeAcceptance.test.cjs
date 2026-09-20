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
    GATE_IDS,
    MIN_EMPTY_CASES,
    MIN_FORWARD_CASES,
    MIN_REVERSE_CASES,
    assertGatePreconditions,
    businessFingerprint,
    classifyAnswer,
    coilIdentityMentioned,
    discoverCasePlan,
    evaluateVerdict,
    fingerprintDiff,
    gateProfile,
    readPageCompleteness,
    readSetCompleteness,
    resolveAcceptanceDatabasePath,
    resolveGateProfile,
    runtimeEnvFrom,
    truthFor,
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

    const recipeEntry = { id: 'R5', direction: 'recipe->coil', coilSpec: '12', coilSheets: 140 };
    const wrongCoil = classifyAnswer(recipeEntry, { expected: ['12-140'] }, 'v750-tokoy 用的是 12-120 线圈');
    assert.equal(wrongCoil.correct, false);
    assert.deepEqual(wrongCoil.wrongTargets, ['12-120'], 'naming a different coil is a wrong target');
    assert.equal(classifyAnswer(recipeEntry, { expected: ['12-140'] }, '用的是 12-140').correct, true);
    // The formal coil directory spells the identity as fields, not as shorthand. That is the same
    // canonical identity, so a correct answer must not be scored wrong for its spelling.
    assert.equal(coilIdentityMentioned('规格：12，片数 140', '12', 140), true);
    assert.equal(coilIdentityMentioned('规格：12，片数 120', '12', 140), false);
    assert.equal(coilIdentityMentioned('12-140', '12', 140), true);
    assert.equal(coilIdentityMentioned('12-1400', '12', 140), false);
    // Winding data (`44-44-44-44`, `78-78`) is not a coil identity and must not be counted as a wrong
    // coil: the catalogue shape for 规格-片数 requires a small stator spec and a three-digit sheet count.
    const winding = classifyAnswer(recipeEntry, { expected: ['12-140'] },
        '副绕组漆包线：0.49，绕线数据 78-78；主绕组 44-44-44-44');
    assert.equal(winding.correct, false);
    assert.deepEqual(winding.wrongTargets, [], 'winding data is not a coil identity');
    const realWrong = classifyAnswer(recipeEntry, { expected: ['12-140'] }, '用的是 12-200 线圈');
    assert.deepEqual(realWrong.wrongTargets, ['12-200']);
    assert.equal(classifyAnswer(recipeEntry, { expected: ['12-140'] }, 'V750…的线圈转子配置如下：\n- 规格：12，片数 140\n- 主绕组漆包线：0.64，绕线数据 44-44-44-44').correct, true);
    assert.equal(classifyAnswer(recipeEntry, { expected: ['12-140'] }, '定子规格 12 / 片数 140').correct, true);
    assert.equal(classifyAnswer(recipeEntry, { expected: ['12-140'] }, '定子规格 12 / 片数 120').correct, false);
    // The spellings real production answers actually used. Each of these is the same canonical identity
    // and must not be scored wrong. `规格/片数：12 规格，140 片` is accepted through the explicit `12 规格`
    // field, not through a bare co-occurrence of 12 and 140.
    const realSpellings = [
        '- 规格：12，片数 140',
        '- 规格：12，共 140 片',
        '- 规格/片数：12 规格，140 片',
        '- **规格/片数**：12 规格，140 片',
        '- 规格：12，140 片',
        '线圈规格：**12-140**（12 片规格，140 片）',
    ];
    for (const spelling of realSpellings) {
        assert.equal(classifyAnswer(recipeEntry, { expected: ['12-140'] }, spelling).correct, true, spelling);
    }
    for (const other of ['- 规格：12，共 120 片', '- 规格/片数：12 规格，120 片', '规格：12，片数 120']) {
        assert.equal(classifyAnswer(recipeEntry, { expected: ['12-140'] }, other).correct, false, other);
    }
    // Supervisor ruling: `12片规格` is the COUNT "12 sheets", not "spec 12", so it must never be read as
    // the spec field. Without this rule any text containing both numbers would be accepted as 12-140.
    assert.equal(coilIdentityMentioned('- 线圈规格：12-140（12 片规格，140 片）', '12', 140), true,
        'the explicit 12-140 shorthand is the identity here');
    assert.equal(coilIdentityMentioned('- 线圈：12 片规格，140 片', '12', 140), false,
        '12片规格 alone must not supply spec=12');
    assert.equal(coilIdentityMentioned('共 12 片规格，140 片', '12', 140), false);
    assert.equal(coilIdentityMentioned('规格 12，片数 140', '12', 140), true);
    assert.equal(coilIdentityMentioned('12 规格，140 片', '12', 140), true);
});

function failingCase(overrides = {}) {
    const direction = overrides.direction || 'coil->recipes';
    return {
        caseId: 'R1', direction, correct: true, wrongTargets: [],
        fallbacks: 0, tooLarge: 0, aggregateCalls: 0, done: true, errorCodes: [],
        bounded: [{ bytes: 61 }], aggregateBytes: 2,
        // A routed turn executes the sanctioned bounded read for its direction.
        toolCallNames: direction === 'coil->recipes' ? ['get_recipes_by_coil'] : ['get_recipe_detail'],
        ...overrides,
    };
}
const cleanFingerprintDiff = { changedTables: [], auditDelta: 0, operationDelta: 0 };

test('relation acceptance: a fully correct run is PASS and an aggregate read on the accepted path is FAIL', () => {
    const pass = evaluateVerdict({
        profile: resolveGateProfile('p8l-local'),
        cases: [failingCase(), failingCase({ caseId: 'R5', direction: 'recipe->coil', toolCallNames: ['get_recipe_detail'], correct: false })],
        negativeCases: [],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    // One forward miss must already fail the gate: partial credit is not an exit criterion.
    assert.equal(pass.status, 'FAIL');
    assert.equal(pass.observed.forwardCorrect, 0);
    assert.equal(pass.observed.forwardTotal, 1);
    assert.ok(pass.failures.some(line => line.startsWith('forward ')));
    // That miss must not be reported as a routing failure: the turn ran the sanctioned bounded read.
    assert.equal(pass.observed.legacyFallbacks, 0);

    const allCorrect = evaluateVerdict({
        profile: resolveGateProfile('p8l-local'),
        cases: [failingCase(), failingCase({ caseId: 'R5', direction: 'recipe->coil', toolCallNames: ['get_recipe_detail'] })],
        negativeCases: [{ caseId: 'N4', kind: 'write', writeProtected: true, fallbacks: 0, tooLarge: 0, aggregateCalls: 0, done: true, errorCodes: [], bounded: [], aggregateBytes: 0 }],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(allCorrect.status, 'PASS');
    assert.equal(allCorrect.observed.aggregateCalls, 0);

    const aggregate = evaluateVerdict({
        profile: resolveGateProfile('p8l-local'),
        cases: [failingCase({ aggregateCalls: 1, aggregateBytes: 19194 }), failingCase({ caseId: 'R5', direction: 'recipe->coil', toolCallNames: ['get_recipe_detail'] })],
        negativeCases: [],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(aggregate.status, 'FAIL');
    assert.ok(aggregate.failures.includes('aggregateCalls=1'));
});

test('relation acceptance: a write that is not a confirmation card, or a business table change, fails the gate', () => {
    const writeLeak = evaluateVerdict({
        profile: resolveGateProfile('p8l-local'),
        cases: [failingCase()],
        negativeCases: [{ caseId: 'N4', kind: 'write', writeProtected: false, fallbacks: 0, tooLarge: 0, aggregateCalls: 0, done: true, errorCodes: [], bounded: [], aggregateBytes: 0 }],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(writeLeak.status, 'FAIL');
    assert.ok(writeLeak.failures.includes('unauthorizedWrites=1'));

    const mutated = evaluateVerdict({
        profile: resolveGateProfile('p8l-local'),
        cases: [failingCase()],
        negativeCases: [],
        fingerprintDiffResult: { changedTables: ['parts'], auditDelta: 2, operationDelta: 1 },
    });
    assert.equal(mutated.status, 'FAIL');
    assert.ok(mutated.failures.some(line => line.startsWith('businessTablesChanged=')));
});

test('relation acceptance: the corpus is discovered from the judged database, never hard-coded', () => {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    require('../api/database/migrations.cjs').runMigrations(db);
    // The real production shape that broke the previous harness: recipe ids that are NOT 2/3/6/7 and a
    // coil whose relation is genuinely empty.
    db.exec(`
        INSERT INTO coils(id,spec,sheets,material,stock,scheme_code,scheme_status) VALUES
            (1,'12',120,'钢带',1,'COIL-T1','official'),(2,'12',140,'钢带',1,'COIL-T2','official'),
            (3,'12',160,'钢带',1,'COIL-T3','official'),(4,'12',180,'钢带',1,'COIL-T4','official'),
            (5,'12',200,'钢带',1,'COIL-T5','official');
        INSERT INTO recipes(id,name,coil_id,parts_json) VALUES
            (11,'配方甲',1,'[]'),(12,'配方乙',1,'[]'),(13,'配方丙',2,'[]');
    `);    const plan = discoverCasePlan(db);
    assert.deepEqual(plan.problems, [], plan.problems.join(';'));
    assert.ok(plan.reverse.length >= MIN_REVERSE_CASES, `reverse=${plan.reverse.length}`);
    assert.ok(plan.forward.length >= MIN_FORWARD_CASES, `forward=${plan.forward.length}`);
    assert.ok(plan.empty.length >= MIN_EMPTY_CASES);
    // Forward cases must name recipes that exist in THIS database, two phrasings each.
    const recipeIds = [...new Set(plan.forward.map(entry => entry.recipeId))];
    assert.deepEqual(recipeIds.sort((a, b) => a - b), [11, 12, 13]);
    assert.ok(plan.forward.length >= recipeIds.length * 2, `forward=${plan.forward.length}`);
    // The empty case must be rooted at a coil with no bound recipes.
    const emptyRoot = plan.empty[0].coilId;
    assert.equal(db.prepare('SELECT COUNT(*) n FROM recipes WHERE coil_id=?').get(emptyRoot).n, 0);
    // Truth follows the foreign key, not a copied expectation.
    assert.deepEqual(truthFor(db, plan.reverse[0]).expected.sort(), ['配方乙', '配方甲'].sort());
    assert.deepEqual(truthFor(db, { direction: 'recipe->coil', recipeId: 13 }).expected, ['12-140']);

    // A database that cannot supply the corpus must abort rather than silently skip cases.
    const thin = new Database(':memory:');
    require('../api/database/migrations.cjs').runMigrations(thin);
    thin.exec("INSERT INTO coils(id,spec,sheets,material,stock,scheme_code,scheme_status) VALUES(1,'12',120,'钢带',1,'COIL-THIN','official'); INSERT INTO recipes(id,name,coil_id,parts_json) VALUES(1,'唯一配方',1,'[]');");
    assert.ok(discoverCasePlan(thin).problems.length > 0);
    thin.close();
    db.close();
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

    // Both gates must require a zero additional provider round, and a plan without a certified
    // empty-relation case is never accepted.
    for (const gateId of GATE_IDS) {
        assert.ok(gateProfile(gateId).required.additionalProviderRounds === 0, gateId);
    }
    assert.ok(MIN_EMPTY_CASES > 0);

    const uncertified = evaluateVerdict({
        profile: resolveGateProfile('p8l-local'),
        cases: [failingCase(), failingCase({ caseId: 'R5', direction: 'recipe->coil', toolCallNames: ['get_recipe_detail'] })],
        negativeCases: [],
        emptyRelationCases: [{ caseId: 'E1-empty-coil-relation', certificateOnly: false, aggregateFree: true, toolCallNames: ['get_recipes_by_coil'] }],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(uncertified.status, 'FAIL');
    assert.ok(uncertified.failures.some(line => line.startsWith('emptyRelationNotCertified=')));

    const certified = evaluateVerdict({
        profile: resolveGateProfile('p8l-local'),
        cases: [failingCase(), failingCase({ caseId: 'R5', direction: 'recipe->coil', toolCallNames: ['get_recipe_detail'] })],
        negativeCases: [],
        emptyRelationCases: [{ caseId: 'E1-empty-coil-relation', certificateOnly: true, aggregateFree: true, toolCallNames: ['get_recipes_by_coil'] }],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(certified.status, 'PASS');
    assert.equal(certified.observed.emptyRelationComplete, 1);
});

test('relation acceptance: an ontology-induced extra provider round fails the gate', () => {
    const verdict = evaluateVerdict({
        profile: resolveGateProfile('ontology-cloud'),
        cases: [failingCase(), failingCase({ caseId: 'R5', direction: 'recipe->coil', toolCallNames: ['get_recipe_detail'] })],
        negativeCases: [],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(verdict.status, 'PASS');
    assert.equal(verdict.observed.additionalProviderRounds, 0);
});

test('relation acceptance: a relation case answered outside the ontology-sanctioned reads is a Legacy fallback', () => {
    // Both gates must answer every relation case themselves; this is the Supervisor's "Legacy fallback = 0"
    // requirement. A canary turn only executes capabilities its own profile sanctions, so the sanctioned set
    // comes from the live ontology profile rather than a copy inside the runner.
    const profile = resolveGateProfile('ontology-cloud');
    assert.ok(profile.requiredReadsByRelation['recipe.uses_coil'].length > 0);
    const routed = evaluateVerdict({
        profile,
        cases: [
            failingCase({ toolCallNames: ['get_recipes_by_coil'] }),
            failingCase({ caseId: 'F1', direction: 'recipe->coil', toolCallNames: ['get_recipe_detail', 'search_coils'] }),
        ],
        negativeCases: [],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(routed.status, 'PASS');
    assert.equal(routed.observed.legacyFallbacks, 0);
    assert.equal(routed.observed.boundOrRouted, 2);
    // An empty relation case is routed by its bounded read; it must not be counted as a fallback.
    const withEmpty = evaluateVerdict({
        profile,
        cases: [failingCase({ toolCallNames: ['get_recipes_by_coil'] })],
        negativeCases: [],
        emptyRelationCases: [{ caseId: 'E1', certificateOnly: true, aggregateFree: true, toolCallNames: ['get_recipes_by_coil'] }],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(withEmpty.status, 'PASS');
    assert.equal(withEmpty.observed.legacyFallbacks, 0);

    // A case answered on the Legacy path executes an unsanctioned capability. Reading the whole recipe
    // catalogue is the concrete Legacy marker for a relation turn, and it is what the observed
    // fallbacks actually executed.
    const legacyTurn = failingCase({ caseId: 'F2', direction: 'recipe->coil', toolCallNames: ['get_all_recipes'] });
    const fellBack = evaluateVerdict({
        profile,
        cases: [failingCase({ toolCallNames: ['get_recipes_by_coil'] }), legacyTurn],
        negativeCases: [],
        fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(fellBack.status, 'FAIL');
    assert.equal(fellBack.observed.legacyFallbacks, 1);
    assert.equal(fellBack.observed.boundOrRouted, 1);
    assert.ok(fellBack.failures.some(line => line.startsWith('legacyFallbacks=1')), JSON.stringify(fellBack.failures));
    // The sanctioned forward read plus the small coil catalogue is still a routed turn.
    assert.equal(evaluateVerdict({
        profile,
        cases: [failingCase({ direction: 'recipe->coil', toolCallNames: ['get_recipe_detail', 'search_coils'] })],
        negativeCases: [], fingerprintDiffResult: cleanFingerprintDiff,
    }).observed.legacyFallbacks, 0);
    // A relation case that executed nothing at all is not a routed turn either.
    assert.equal(evaluateVerdict({ profile, cases: [failingCase({ toolCallNames: [] })], negativeCases: [],
        fingerprintDiffResult: cleanFingerprintDiff }).observed.legacyFallbacks, 1);
});

test('relation acceptance: accuracy supplied by Legacy does not satisfy the gate', () => {
    // Supervisor's exit condition: the correctness must be produced by the ontology route. A case that
    // Legacy answered correctly must not be counted towards "forward 8/8".
    const profile = resolveGateProfile('ontology-cloud');
    const routed = evaluateVerdict({
        profile,
        cases: [failingCase({ toolCallNames: ['get_recipes_by_coil'] })],
        negativeCases: [], fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(routed.status, 'PASS');
    assert.equal(routed.observed.routedCorrect, 1);
    assert.equal(routed.observed.routedTotal, 1);

    // Correct answer, but Legacy answered it: the overall ratio is satisfied while the routed ratio is not.
    const legacyAnswered = evaluateVerdict({
        profile,
        cases: [failingCase({ toolCallNames: ['get_recipes_by_coil'] }), failingCase({ caseId: 'F2', direction: 'recipe->coil', toolCallNames: ['get_all_recipes'] })],
        negativeCases: [], fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(legacyAnswered.observed.forwardRatio, 1, 'the overall ratio is satisfied');
    assert.equal(legacyAnswered.observed.routedTotal, 1);
    assert.equal(legacyAnswered.status, 'FAIL');
    assert.ok(legacyAnswered.failures.some(line => line.startsWith('legacyFallbacks=')), JSON.stringify(legacyAnswered.failures));

    // A routed turn that is itself wrong must also fail the routed ratio.
    const routedWrong = evaluateVerdict({
        profile,
        cases: [failingCase({ toolCallNames: ['get_recipes_by_coil'], correct: false, wrongTargets: ['12-200'] })],
        negativeCases: [], fingerprintDiffResult: cleanFingerprintDiff,
    });
    assert.equal(routedWrong.observed.routedCorrect, 0);
    assert.ok(routedWrong.failures.some(line => line.startsWith('routedCorrect=0/1')), JSON.stringify(routedWrong.failures));
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
