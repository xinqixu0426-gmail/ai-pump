const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const { resetBusinessConfirmationsForTests } = require('../api/services/businessConfirmation.cjs');
const { createRecipeTechnicalMigrationDryRunService } = require('../api/services/recipeTechnicalMigrationDryRun.cjs');
const { createRecipeTechnicalMigrationBackfillService } = require('../api/services/recipeTechnicalMigrationBackfill.cjs');
const { createRecipeTechnicalMigrationOwnerPromotionService, DECISION, PROMOTION_VERSION } = require('../api/services/recipeTechnicalMigrationOwnerPromotion.cjs');
const { FUNCTIONAL_FIELDS, createRecipeTechnicalProfileService } = require('../api/services/recipeTechnicalProfile.cjs');
const NOW = '2026-09-28T00:00:00.000Z'; const ACTOR = 'test:owner-promotion';
function fixture(t, dependencies = {}, options = {}) {
    resetBusinessConfirmationsForTests(); const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db, { now: NOW }); t.after(() => db.close());
    const shell = Number(db.prepare(`INSERT INTO parts (model,category,remark,created_at,updated_at) VALUES ('shell','泵壳','{"isStainless":false}',?,?)`).run(NOW, NOW).lastInsertRowid);
    const upperBearingCode = options.upperBearingCode || '6202';
    const upperLegacyBearing = options.upperLegacyBearing || '202';
    db.prepare(`INSERT INTO parts (model,category,created_at,updated_at) VALUES (?, '轴承', ?, ?),('轴承-6303','轴承',?,?)`).run(`轴承-${upperBearingCode}`, NOW, NOW, NOW, NOW);
    const template = Number(db.prepare(`INSERT INTO pump_shell_templates (shell_model,created_at,updated_at) VALUES ('t',?,?)`).run(NOW, NOW).lastInsertRowid);
    db.prepare(`INSERT INTO catalog_template_shell_bindings (template_id,shell_part_id,created_at,updated_at) VALUES (?,?,?,?)`).run(template,shell,NOW,NOW);
    const data = JSON.stringify({ rotorDiameter:52,stackOffset:1,oilSealDiameter:20,impellerBoreDiameter:12,impellerSpan:24,impellerDepth:3,threadLength:14,threadDiameter:8,upperBearing:upperLegacyBearing,lowerBearing:'6303',bearingSpan:80,rotorLength:150 });
    const recipeId = Number(db.prepare(`INSERT INTO recipes (name,template_id,coil_sheets,impeller_thickness,technical_data_json,created_at,updated_at) VALUES ('r',?,160,3,?,?,?)`).run(template,data,NOW,NOW).lastInsertRowid);
    const dry = createRecipeTechnicalMigrationDryRunService({ db }); const canonical = createRecipeTechnicalProfileService({ db });
    const backfill = createRecipeTechnicalMigrationBackfillService({ db,dryRunService:dry,canonicalProfileService:canonical,now:()=>new Date(NOW) });
    const bplan = backfill.preview(recipeId,{actorKey:ACTOR,subject:ACTOR}); backfill.apply(recipeId,{confirmationToken:bplan.confirmationToken,idempotencyKey:'promotion-backfill-001'},{actorKey:ACTOR,subject:ACTOR,idempotencyKey:'promotion-backfill-001'});
    db.prepare(`UPDATE recipes SET technical_data_json = ? WHERE id = ?`).run(JSON.stringify({ ...JSON.parse(data), rotorDiameter:99 }),recipeId);
    assert.equal(dry.assess(recipeId).classification,'NEEDS_OWNER_REVIEW');
    const service = createRecipeTechnicalMigrationOwnerPromotionService({db,dryRunService:dry,canonicalProfileService:canonical,now:()=>new Date(NOW),...dependencies});
    return {db,recipeId,dry,canonical,service};
}
function plan(service,id){return service.preview(id,{decision:DECISION},{actorKey:ACTOR,subject:ACTOR});}
function apply(service,id,token,key='promotion-key-001'){return service.apply(id,{confirmationToken:token,idempotencyKey:key},{actorKey:ACTOR,subject:ACTOR,idempotencyKey:key});}
function counts(db){return Object.fromEntries(['recipe_functional_technical_profiles','recipe_technical_knowledge','audit_log','business_change_events','api_operations'].map(table=>[table,Number(db.prepare(`SELECT count(*) count FROM ${table}`).get().count)]));}
function canonicalInput(dto, overrides = {}) {
    const functional = Object.fromEntries(FUNCTIONAL_FIELDS.map(field => [field, dto.functional[field]]));
    return {
        functional: { ...functional, ...(overrides.functional || {}) },
        technicalKnowledge: { items: overrides.items || dto.technicalKnowledge.items.map(item => { const copy = { ...item }; delete copy.source; return copy; }) },
        expectedUpdatedAt: dto.updatedAt,
    };
}
function canonicalUpdate(current, dto, overrides, key) {
    return current.canonical.update(current.recipeId, canonicalInput(dto, overrides), {
        actorKey: ACTOR, subject: ACTOR, idempotencyKey: key, operationId: `op:${key}`,
    });
}
function profileBusinessValues(row) {
    return Object.fromEntries([
        ['rotorDiameter', 'rotor_diameter'], ['stackOffset', 'stack_offset'], ['oilSealDiameter', 'oil_seal_diameter'],
        ['impellerBoreDiameter', 'impeller_bore_diameter'], ['impellerSpan', 'impeller_span'], ['impellerThickness', 'impeller_thickness'],
        ['threadLength', 'thread_length'], ['threadDiameter', 'thread_diameter'], ['barrelLength', 'barrel_length'],
        ['openOffset', 'open_offset'], ['bearingSpanExplicit', 'bearing_span_explicit'],
        ['upperBearingPartId', 'upper_bearing_part_id'], ['lowerBearingPartId', 'lower_bearing_part_id'],
    ].map(([field, column]) => [field, row[column] ?? null]));
}

test('promotes only source-drifted migrated aggregate without copying legacy values or rewriting knowledge',t=>{
 const {db,recipeId,dry,service}=fixture(t); const beforeProfile=db.prepare(`SELECT * FROM recipe_functional_technical_profiles WHERE recipe_id=?`).get(recipeId); const beforeKnowledge=db.prepare(`SELECT * FROM recipe_technical_knowledge WHERE recipe_id=?`).get(recipeId); const p=plan(service,recipeId); assert.equal(p.decision,DECISION); assert.equal(p.promotionVersion,PROMOTION_VERSION); const result=apply(service,recipeId,p.confirmationToken); const after=db.prepare(`SELECT * FROM recipe_functional_technical_profiles WHERE recipe_id=?`).get(recipeId); const knowledge=db.prepare(`SELECT * FROM recipe_technical_knowledge WHERE recipe_id=?`).get(recipeId);
 assert.deepEqual(profileBusinessValues(after),profileBusinessValues(beforeProfile)); assert.equal(after.migration_state,'ALREADY_CANONICAL'); assert.equal(after.migration_version,null); assert.equal(after.migration_fingerprint,null); assert.deepEqual(knowledge,beforeKnowledge); assert.equal(result.auditIds.length,1); assert.equal(db.prepare(`SELECT table_name FROM audit_log WHERE id=?`).get(result.auditIds[0]).table_name,'recipe_functional_technical_profiles'); assert.equal(db.prepare(`SELECT count(*) count FROM audit_log WHERE table_name='recipe_technical_knowledge' AND record_id=?`).get(recipeId).count,1); assert.equal(result.technicalProfile.functional.rotorDiameter,52); assert.equal(dry.assess(recipeId).classification,'ALREADY_CANONICAL'); assert.equal(dry.reviewQueue({limit:100,offset:0}).items.some(x=>x.recipeId===recipeId),false); assert.equal(JSON.parse(after.provenance_json).ownerPromotion.promotionVersion,PROMOTION_VERSION); assert.deepEqual(JSON.parse(after.provenance_json).functional,JSON.parse(beforeProfile.provenance_json).functional); const beforeEvidence=JSON.parse(beforeProfile.legacy_evidence_json); const afterEvidence=JSON.parse(after.legacy_evidence_json); for(const [key,value] of Object.entries(beforeEvidence)) assert.deepEqual(afterEvidence[key],value); db.prepare(`UPDATE recipes SET technical_data_json = ? WHERE id = ?`).run(JSON.stringify({rotorDiameter:123}),recipeId); assert.equal(dry.assess(recipeId).classification,'ALREADY_CANONICAL'); assert.equal(dry.reviewQueue({limit:100,offset:0}).items.some(x=>x.recipeId===recipeId),false); });

test('stale canonical change, bearing lifecycle change and post-write failures roll back promotion',t=>{
 const stale=fixture(t); const p=plan(stale.service,stale.recipeId); stale.db.prepare(`UPDATE recipe_technical_knowledge SET updated_at='2026-09-29T00:00:00.000Z' WHERE recipe_id=?`).run(stale.recipeId); assert.throws(()=>apply(stale.service,stale.recipeId,p.confirmationToken,'promotion-stale-001'),e=>e.code==='technical_profile_migration_owner_promotion_stale');
 const bearing=fixture(t); const bp=plan(bearing.service,bearing.recipeId); const id=bearing.db.prepare(`SELECT upper_bearing_part_id id FROM recipe_functional_technical_profiles WHERE recipe_id=?`).get(bearing.recipeId).id; bearing.db.prepare(`UPDATE parts SET deleted_at=? WHERE id=?`).run(NOW,id); assert.throws(()=>apply(bearing.service,bearing.recipeId,bp.confirmationToken,'promotion-bearing-001'),e=>e.code==='technical_profile_migration_owner_promotion_stale');
 const bad=fixture(t,{writeAuditLog:()=>{throw new Error('audit fail')}}); const failPlan=plan(bad.service,bad.recipeId); const before=counts(bad.db); assert.throws(()=>apply(bad.service,bad.recipeId,failPlan.confirmationToken,'promotion-audit-001')); assert.deepEqual(counts(bad.db),before); const profile=bad.db.prepare(`SELECT migration_state,migration_fingerprint FROM recipe_functional_technical_profiles WHERE recipe_id=?`).get(bad.recipeId); assert.ok(['AUTO_MIGRATED','MIGRATED_WITH_COMPATIBILITY_PROVENANCE'].includes(profile.migration_state)); assert.ok(profile.migration_fingerprint);
});

test('allows source drift plus an incomplete unresolved bearing geometry and preserves the exact bearing identity', t => {
    const current = fixture(t, {}, { upperBearingCode: '9999', upperLegacyBearing: '9999' });
    const before = current.db.prepare(`SELECT * FROM recipe_functional_technical_profiles WHERE recipe_id=?`).get(current.recipeId);
    const assessment = current.dry.assess(current.recipeId);
    assert.equal(assessment.classification, 'NEEDS_OWNER_REVIEW');
    assert.ok(assessment.reasons.some(reason => reason.code === 'MIGRATION_SOURCE_CHANGED' && reason.severity === 'REVIEW'));
    assert.ok(assessment.reasons.some(reason => reason.code === 'UPPER_BEARING_GEOMETRY_UNRESOLVED' && reason.severity === 'INCOMPLETE'));
    const preview = plan(current.service, current.recipeId);
    apply(current.service, current.recipeId, preview.confirmationToken, 'promotion-geometry-001');
    const after = current.db.prepare(`SELECT * FROM recipe_functional_technical_profiles WHERE recipe_id=?`).get(current.recipeId);
    assert.equal(after.upper_bearing_part_id, before.upper_bearing_part_id);
    assert.equal(after.completeness_state, 'INCOMPLETE');
    assert.equal(after.migration_state, 'ALREADY_CANONICAL');
    assert.equal(after.migration_version, null); assert.equal(after.migration_fingerprint, null);
    const post = current.dry.assess(current.recipeId);
    assert.equal(post.classification, 'ALREADY_CANONICAL');
    assert.ok(post.reasons.some(reason => reason.code === 'CANONICAL_OWNER_AUTHORITY'));
});

test('rejects any second REVIEW or BLOCKED reason alongside source drift', t => {
    for (const reason of [
        { code: 'CANONICAL_COMPLETENESS_REVIEW_REQUIRED', severity: 'REVIEW' },
        { code: 'STAINLESS_POLICY_UNRESOLVED', severity: 'BLOCKED' },
    ]) {
        const current = fixture(t);
        const dryRunService = { ...current.dry, assess(id) { const assessment = current.dry.assess(id); return { ...assessment, reasons: [...assessment.reasons, reason] }; } };
        const service = createRecipeTechnicalMigrationOwnerPromotionService({ db: current.db, dryRunService, canonicalProfileService: current.canonical, now: () => new Date(NOW) });
        assert.throws(() => plan(service, current.recipeId), error => error.code === 'technical_profile_migration_owner_promotion_not_eligible');
        assert.equal(current.db.prepare(`SELECT count(*) count FROM api_operations`).get().count, 1);
    }
});

test('real canonical PUT interop retains owner values and field provenance through promotion', t => {
    const current = fixture(t); const dto = current.canonical.get(current.recipeId);
    const updated = canonicalUpdate(current, dto, { functional: { rotorDiameter: 53 } }, 'promotion-canonical-put-001');
    assert.equal(updated.technicalProfile.functional.rotorDiameter, 53);
    const before = current.db.prepare(`SELECT provenance_json FROM recipe_functional_technical_profiles WHERE recipe_id=?`).get(current.recipeId);
    assert.equal(JSON.parse(before.provenance_json).rotorDiameter.sourceKind, 'OWNER_CANONICAL_WRITE');
    const preview = plan(current.service, current.recipeId); apply(current.service, current.recipeId, preview.confirmationToken, 'promotion-canonical-put-002');
    const after = current.canonical.get(current.recipeId);
    assert.equal(after.functional.rotorDiameter, 53);
    assert.equal(after.provenance.rotorDiameter.sourceKind, 'OWNER_CANONICAL_WRITE');
    assert.equal(after.migration.state, 'ALREADY_CANONICAL');
});

test('canonical functional, knowledge, and policy changes after preview each fail stale', t => {
    const functional = fixture(t); const functionalPreview = plan(functional.service, functional.recipeId);
    canonicalUpdate(functional, functional.canonical.get(functional.recipeId), { functional: { rotorDiameter: 53 } }, 'promotion-stale-functional-001');
    assert.throws(() => apply(functional.service, functional.recipeId, functionalPreview.confirmationToken, 'promotion-stale-functional-apply'), error => error.code === 'technical_profile_migration_owner_promotion_stale');
    const knowledge = fixture(t); const knowledgePreview = plan(knowledge.service, knowledge.recipeId);
    canonicalUpdate(knowledge, knowledge.canonical.get(knowledge.recipeId), { items: [{ key: 'rotorLength', label: 'rotorLength', value: 151 }] }, 'promotion-stale-knowledge-001');
    assert.throws(() => apply(knowledge.service, knowledge.recipeId, knowledgePreview.confirmationToken, 'promotion-stale-knowledge-apply'), error => error.code === 'technical_profile_migration_owner_promotion_stale');
    const policy = fixture(t); const policyPreview = plan(policy.service, policy.recipeId);
    const shell = policy.db.prepare(`SELECT shell_part_id id FROM catalog_template_shell_bindings LIMIT 1`).get().id;
    policy.db.prepare(`UPDATE parts SET remark='{"isStainless":true}' WHERE id=?`).run(shell);
    assert.throws(() => apply(policy.service, policy.recipeId, policyPreview.confirmationToken, 'promotion-stale-policy-apply'), error => error.code === 'technical_profile_migration_owner_promotion_stale');
});

test('promotion replay is idempotent and a different idempotency request conflicts without rewrites', t => {
    const current = fixture(t); const preview = plan(current.service, current.recipeId);
    const original = current.db.prepare(`SELECT technical_data_json value FROM recipes WHERE id=?`).get(current.recipeId).value;
    current.db.prepare(`UPDATE recipes SET technical_data_json=? WHERE id=?`).run(JSON.stringify({ ...JSON.parse(original), rotorDiameter: 100 }), current.recipeId);
    const differentPreview = plan(current.service, current.recipeId);
    current.db.prepare(`UPDATE recipes SET technical_data_json=? WHERE id=?`).run(original, current.recipeId);
    const first = apply(current.service, current.recipeId, preview.confirmationToken, 'promotion-replay-001');
    const before = counts(current.db); const updatedAt = current.db.prepare(`SELECT updated_at FROM recipe_functional_technical_profiles WHERE recipe_id=?`).get(current.recipeId).updated_at;
    const replay = apply(current.service, current.recipeId, preview.confirmationToken, 'promotion-replay-001');
    assert.equal(replay.idempotentReplay, true); assert.deepEqual(counts(current.db), before);
    assert.equal(current.db.prepare(`SELECT updated_at FROM recipe_functional_technical_profiles WHERE recipe_id=?`).get(current.recipeId).updated_at, updatedAt);
    assert.throws(() => apply(current.service, current.recipeId, preview.confirmationToken, 'promotion-replay-002'), error => error.code === 'confirmation_already_bound');
    assert.throws(() => apply(current.service, current.recipeId, differentPreview.confirmationToken, 'promotion-replay-001'), error => error.code === 'idempotency_key_conflict');
    assert.equal(first.idempotentReplay, false);
});

test('unsupported migrated states and incomplete pair remain ineligible for owner promotion', t => {
    const mutations = [
        `UPDATE recipe_functional_technical_profiles SET migration_fingerprint=NULL`,
        `UPDATE recipe_functional_technical_profiles SET migration_version='unsupported-v0'`,
        `UPDATE recipe_functional_technical_profiles SET migration_state='NEEDS_OWNER_REVIEW'`,
        `UPDATE recipe_functional_technical_profiles SET migration_state='BLOCKED_UNRESOLVED'`,
        `UPDATE recipe_functional_technical_profiles SET migration_state='ALREADY_CANONICAL'`,
        `DELETE FROM recipe_technical_knowledge`,
    ];
    for (const mutation of mutations) { const current = fixture(t); current.db.exec(mutation); assert.throws(() => plan(current.service, current.recipeId), error => error.code === 'technical_profile_migration_owner_promotion_not_eligible'); }
});

test('business-event, readback, and post-dry-run verification failures roll back profile promotion atomically', t => {
    const eventFail = fixture(t); const eventPreview = plan(eventFail.service, eventFail.recipeId); const eventBefore = counts(eventFail.db);
    eventFail.db.exec(`CREATE TRIGGER fail_owner_promotion_event BEFORE INSERT ON business_change_events BEGIN SELECT RAISE(ABORT, 'forced event failure'); END;`);
    assert.throws(() => apply(eventFail.service, eventFail.recipeId, eventPreview.confirmationToken, 'promotion-event-fail-001'));
    assert.deepEqual(counts(eventFail.db), eventBefore);
    const readback = fixture(t); const readbackService = createRecipeTechnicalMigrationOwnerPromotionService({ db: readback.db, dryRunService: readback.dry, canonicalProfileService: { ...readback.canonical, get(id) { const dto = readback.canonical.get(id); return dto.migration.state === 'ALREADY_CANONICAL' ? { ...dto, functional: { ...dto.functional, rotorDiameter: 999 } } : dto; } }, now: () => new Date(NOW) });
    const readbackPreview = plan(readbackService, readback.recipeId); const readbackBefore = counts(readback.db);
    assert.throws(() => apply(readbackService, readback.recipeId, readbackPreview.confirmationToken, 'promotion-readback-fail-001'), error => error.code === 'technical_profile_migration_owner_promotion_readback_failed'); assert.deepEqual(counts(readback.db), readbackBefore);
    const post = fixture(t); let assessments = 0; const postDry = { ...post.dry, assess(id) { assessments += 1; const value = post.dry.assess(id); return assessments >= 3 && value.classification === 'ALREADY_CANONICAL' ? { ...value, classification: 'NEEDS_OWNER_REVIEW' } : value; } }; const postService = createRecipeTechnicalMigrationOwnerPromotionService({ db: post.db, dryRunService: postDry, canonicalProfileService: post.canonical, now: () => new Date(NOW) });
    const postPreview = plan(postService, post.recipeId); const postBefore = counts(post.db); assert.throws(() => apply(postService, post.recipeId, postPreview.confirmationToken, 'promotion-post-fail-001'), error => error.code === 'technical_profile_migration_owner_promotion_post_verify_failed'); assert.deepEqual(counts(post.db), postBefore);
});
