const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const { resetBusinessConfirmationsForTests } = require('../api/services/businessConfirmation.cjs');
const { createRecipeTechnicalMigrationDryRunService } = require('../api/services/recipeTechnicalMigrationDryRun.cjs');
const { createRecipeTechnicalMigrationBackfillService } = require('../api/services/recipeTechnicalMigrationBackfill.cjs');
const { createRecipeTechnicalMigrationOwnerPromotionService, DECISION, PROMOTION_VERSION } = require('../api/services/recipeTechnicalMigrationOwnerPromotion.cjs');
const { createRecipeTechnicalProfileService } = require('../api/services/recipeTechnicalProfile.cjs');
const NOW = '2026-09-28T00:00:00.000Z'; const ACTOR = 'test:owner-promotion';
function fixture(t, dependencies = {}) {
    resetBusinessConfirmationsForTests(); const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db, { now: NOW }); t.after(() => db.close());
    const shell = Number(db.prepare(`INSERT INTO parts (model,category,remark,created_at,updated_at) VALUES ('shell','泵壳','{"isStainless":false}',?,?)`).run(NOW, NOW).lastInsertRowid);
    db.prepare(`INSERT INTO parts (model,category,created_at,updated_at) VALUES ('轴承-6202','轴承',?,?),('轴承-6303','轴承',?,?)`).run(NOW, NOW, NOW, NOW);
    const template = Number(db.prepare(`INSERT INTO pump_shell_templates (shell_model,created_at,updated_at) VALUES ('t',?,?)`).run(NOW, NOW).lastInsertRowid);
    db.prepare(`INSERT INTO catalog_template_shell_bindings (template_id,shell_part_id,created_at,updated_at) VALUES (?,?,?,?)`).run(template,shell,NOW,NOW);
    const data = JSON.stringify({ rotorDiameter:52,stackOffset:1,oilSealDiameter:20,impellerBoreDiameter:12,impellerSpan:24,impellerDepth:3,threadLength:14,threadDiameter:8,upperBearing:'202',lowerBearing:'6303',bearingSpan:80,rotorLength:150 });
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

test('promotes only source-drifted migrated aggregate without copying legacy values or rewriting knowledge',t=>{
 const {db,recipeId,dry,service}=fixture(t); const beforeProfile=db.prepare(`SELECT * FROM recipe_functional_technical_profiles WHERE recipe_id=?`).get(recipeId); const beforeKnowledge=db.prepare(`SELECT * FROM recipe_technical_knowledge WHERE recipe_id=?`).get(recipeId); const p=plan(service,recipeId); assert.equal(p.decision,DECISION); assert.equal(p.promotionVersion,PROMOTION_VERSION); const result=apply(service,recipeId,p.confirmationToken); const after=db.prepare(`SELECT * FROM recipe_functional_technical_profiles WHERE recipe_id=?`).get(recipeId); const knowledge=db.prepare(`SELECT * FROM recipe_technical_knowledge WHERE recipe_id=?`).get(recipeId);
 assert.equal(after.rotor_diameter,beforeProfile.rotor_diameter); assert.equal(after.migration_state,'ALREADY_CANONICAL'); assert.equal(after.migration_version,null); assert.equal(after.migration_fingerprint,null); assert.deepEqual(knowledge,beforeKnowledge); assert.equal(result.auditIds.length,1); assert.equal(result.technicalProfile.functional.rotorDiameter,52); assert.equal(dry.assess(recipeId).classification,'ALREADY_CANONICAL'); assert.equal(dry.reviewQueue({limit:100,offset:0}).items.some(x=>x.recipeId===recipeId),false); assert.equal(JSON.parse(after.provenance_json).ownerPromotion.promotionVersion,PROMOTION_VERSION); });

test('stale canonical change, bearing lifecycle change and post-write failures roll back promotion',t=>{
 const stale=fixture(t); const p=plan(stale.service,stale.recipeId); stale.db.prepare(`UPDATE recipe_technical_knowledge SET updated_at='2026-09-29T00:00:00.000Z' WHERE recipe_id=?`).run(stale.recipeId); assert.throws(()=>apply(stale.service,stale.recipeId,p.confirmationToken,'promotion-stale-001'),e=>e.code==='technical_profile_migration_owner_promotion_stale');
 const bearing=fixture(t); const bp=plan(bearing.service,bearing.recipeId); const id=bearing.db.prepare(`SELECT upper_bearing_part_id id FROM recipe_functional_technical_profiles WHERE recipe_id=?`).get(bearing.recipeId).id; bearing.db.prepare(`UPDATE parts SET deleted_at=? WHERE id=?`).run(NOW,id); assert.throws(()=>apply(bearing.service,bearing.recipeId,bp.confirmationToken,'promotion-bearing-001'),e=>e.code==='technical_profile_migration_owner_promotion_stale'||e.code==='technical_profile_migration_owner_promotion_not_eligible');
 const bad=fixture(t,{writeAuditLog:()=>{throw new Error('audit fail')}}); const failPlan=plan(bad.service,bad.recipeId); const before=counts(bad.db); assert.throws(()=>apply(bad.service,bad.recipeId,failPlan.confirmationToken,'promotion-audit-001')); assert.deepEqual(counts(bad.db),before); const profile=bad.db.prepare(`SELECT migration_state,migration_fingerprint FROM recipe_functional_technical_profiles WHERE recipe_id=?`).get(bad.recipeId); assert.ok(['AUTO_MIGRATED','MIGRATED_WITH_COMPATIBILITY_PROVENANCE'].includes(profile.migration_state)); assert.ok(profile.migration_fingerprint);
});
