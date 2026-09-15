const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { CANONICAL_TABLES_SQL } = require('../api/database/schema.cjs');
const { CATALOG_IDENTITY_SCHEMA_SQL } = require('../api/database/catalogSchema.cjs');
const { previewCatalogRename, executeCatalogRename } = require('../api/services/catalogRename.cjs');
const { hydrateCatalogRow } = require('../api/services/catalogLiveReferences.cjs');
const { resolveCatalogPartIdentity } = require('../api/services/bomPartIdentity.cjs');
const { auditCatalogReferences } = require('../api/services/catalogReferenceAudit.cjs');
function fixture(t) {
  const db = new Database(':memory:'); t.after(() => db.close());
  db.exec(CANONICAL_TABLES_SQL); db.exec(CATALOG_IDENTITY_SCHEMA_SQL); db.exec('ALTER TABLE parts ADD COLUMN naming_json TEXT');
  db.prepare("INSERT INTO parts(model,category,supplier,price,stock,updated_at) VALUES('203','轴承','甲',3,9,'2026-09-15T00:00:00.000Z')").run();
  db.prepare("INSERT INTO customers(name) VALUES('客户')").run();
  const bom = JSON.stringify([{ model:'203', supplier:'甲', qty:2, snapshotPrice:3 }]);
  db.prepare("INSERT INTO recipes(name,parts_json,updated_at) VALUES(?,?,'2026-09-15T00:00:00.000Z')").run('配方',bom);
  db.prepare('INSERT INTO pump_shell_templates(shell_model,parts_json) VALUES(?,?)').run('模板',bom);
  db.prepare("INSERT INTO orders(customer_name,items_json,purchase_list_json) VALUES('客户',?,?)").run(JSON.stringify([{recipeId:1,recipeName:'配方',partsJson:bom}]),bom);
  db.prepare('INSERT INTO quotations(customer_id,items_json) VALUES(1,?)').run(JSON.stringify([{recipeId:1,recipeName:'配方',partsJson:bom}]));
  const allowed = new Set(['parts','recipes','coils','pump_shell_templates','pump_model_variants','catalog_identity_profiles','catalog_reference_bindings','catalog_template_shell_bindings']);
  function write(action,table,id,values,context) {
    assert.ok(allowed.has(table)); assert.equal(context.requireAudit,true);
    const keys=Object.keys(values); assert.ok(keys.every(key => /^[a-z_]+$/.test(key)));
    const result=action==='INSERT' ? db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(values)) : db.prepare(`UPDATE ${table} SET ${keys.map(key=>`${key}=?`).join(',')} WHERE id=?`).run(...Object.values(values),id);
    const audit=db.prepare('INSERT INTO audit_log(action,table_name,record_id,operation_id,capability_id,request_id,user) VALUES(?,?,?,?,?,?,?)').run(action,table,id||Number(result.lastInsertRowid),context.operationId,context.capabilityId,context.requestId,context.user);
    return {...result,auditId:Number(audit.lastInsertRowid)};
  }
  const dependencies={db,safeInsert:(table,values,ctx)=>write('INSERT',table,null,values,ctx),safeUpdate:(table,id,values,ctx)=>write('UPDATE',table,id,values,ctx)};
  const preview=(overrides={})=>previewCatalogRename(db,{entityType:'part',entityId:1,naming:{ruleId:'bearing',spec:{code:'6203'}},samePhysicalItem:true,expectedUpdatedAt:db.prepare('SELECT updated_at FROM parts WHERE id=1').get().updated_at,...overrides},'tester');
  const apply=(p,deps=dependencies)=>executeCatalogRename(deps,{confirmationToken:p.confirmationToken,idempotencyKey:p.suggestedIdempotencyKey},{actorKey:'tester',idempotencyKey:p.suggestedIdempotencyKey,requestId:'rename-test'},'tester');
  return {db,dependencies,preview,apply};
}

test('缺少机筒长度的配方可规范名称，首次对外型号保存后连续改名仍保留', t => {
  const { db, preview, apply } = fixture(t);
  const naming = { ruleId: 'recipe', spec: { series: 'V750', statorCode: '12', sheets: 140, configuration: '普通' } };
  const input = () => ({ entityType: 'recipe', entityId: 1, naming, expectedUpdatedAt: db.prepare('SELECT updated_at FROM recipes WHERE id=1').get().updated_at });
  const original = db.prepare('SELECT * FROM recipes WHERE id=1').get();
  apply(preview(input()));
  let row = hydrateCatalogRow(db, 'recipe', db.prepare('SELECT * FROM recipes WHERE id=1').get());
  assert.equal(row.name, '水泵-V750-12-140片-普通'); assert.equal(row.external_model, '配方');
  assert.equal(row.parts_json, original.parts_json);
  apply(preview(input()));
  row = hydrateCatalogRow(db, 'recipe', db.prepare('SELECT * FROM recipes WHERE id=1').get());
  assert.equal(row.external_model, '配方');
  assert.equal(db.prepare('SELECT external_model FROM catalog_identity_profiles WHERE recipe_id=1').get().external_model, '配方');
});
test('正式规格改名在完整引用链读取现名，原快照和锁定金额不变，幂等不重复提交',t=>{
  const {db,preview,apply}=fixture(t); const before=db.prepare('SELECT * FROM orders').get(); const p=preview();
  assert.equal(p.currentName,'轴承-203'); assert.equal(db.prepare('SELECT count(*) n FROM audit_log').get().n,0);
  const receipt=apply(p); assert.equal(receipt.status,'completed'); assert.ok(receipt.bindingIds.length>=4);
  for(const [type,table,field] of [['recipe','recipes','parts_json'],['template','pump_shell_templates','parts_json'],['order','orders','purchase_list_json']]) {
    const raw=db.prepare(`SELECT * FROM ${table} WHERE id=1`).get(); const current=hydrateCatalogRow(db,type,raw);
    const item=JSON.parse(current[field])[0]; assert.equal(item.model,'轴承-203'); assert.equal(item.partId,1); assert.equal(item.snapshotName,'203'); assert.equal(item.snapshotPrice,3);
    assert.equal(JSON.parse(raw[field])[0].model,'203');
  }
  const order=hydrateCatalogRow(db,'order',before); assert.equal(JSON.parse(JSON.parse(order.items_json)[0].partsJson)[0].model,'轴承-203');
  const quotation=hydrateCatalogRow(db,'quotation',db.prepare('SELECT * FROM quotations').get()); assert.equal(JSON.parse(JSON.parse(quotation.items_json)[0].partsJson)[0].model,'轴承-203');
  assert.deepEqual(db.prepare('SELECT * FROM orders').get(),before); assert.deepEqual(db.prepare('SELECT price,stock FROM parts WHERE id=1').get(),{price:3,stock:9});
  assert.equal(apply(p).idempotentReplay,true); assert.equal(db.prepare('SELECT count(*) n FROM api_operations').get().n,1);
  assert.ok(auditCatalogReferences(db).references.some(ref=>ref.status==='resolved_binding'));
  assert.throws(()=>resolveCatalogPartIdentity(db.prepare('SELECT * FROM parts').all(),{partId:1,model:'203',supplier:'甲'}));
});
test('新规格替换和同供应商撞名不能原地规范名称',t=>{
  const {db,preview,apply}=fixture(t); apply(preview());
  assert.throws(()=>preview({naming:{ruleId:'bearing',spec:{code:'204'}}}),{code:'CATALOG_SPECIFICATION_REPLACEMENT_REQUIRED'});
  db.prepare("INSERT INTO parts(model,category,supplier) VALUES('轴承-203-甲档','轴承','甲')").run();
  assert.throws(()=>preview({naming:{ruleId:'bearing',spec:{code:'203',variant:'甲档'}}}),{code:'CATALOG_RENAME_CONFLICT'});
  assert.equal(db.prepare('SELECT count(*) n FROM api_operations').get().n,1);
});
test('预览后的来源变化和目录变化都拒绝，不能留下档案和绑定',async t=>{
  for(const sql of ["UPDATE recipes SET parts_json='[]' WHERE id=1",'UPDATE parts SET price=4 WHERE id=1']) await t.test(sql,t=>{
    const {db,preview,apply}=fixture(t); const p=preview(); db.exec(sql); assert.throws(()=>apply(p));
    for(const table of ['catalog_identity_profiles','catalog_reference_bindings','api_operations','audit_log']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  });
});
test('任何强审计或名称保存失败使整个规范名称事务回滚',async t=>{
  for(const mode of ['throw','missingAudit']) await t.test(mode,t=>{
    const {db,dependencies,preview,apply}=fixture(t); const p=preview();
    const faulty={...dependencies,safeUpdate(table,id,values,ctx){if(mode==='throw')throw Error('注入保存失败');const result=dependencies.safeUpdate(table,id,values,ctx);return {...result,auditId:null};}};
    assert.throws(()=>apply(p,faulty)); assert.equal(db.prepare('SELECT model FROM parts WHERE id=1').get().model,'203');
    for(const table of ['catalog_identity_profiles','catalog_reference_bindings','api_operations','audit_log','business_change_events']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
    assert.equal(apply(p).status,'completed');
  });
});
test('强制确认同一实物、严格参数、当前版本和会话隔离',t=>{
  const {db,preview}=fixture(t);
  for(const input of [{samePhysicalItem:false},{entityId:'1'},{expectedUpdatedAt:''},{unexpected:true}])assert.throws(()=>preview(input),{code:'CATALOG_RENAME_INVALID'});
  assert.throws(()=>preview({expectedUpdatedAt:'2020-01-01T00:00:00.000Z'}),{code:'resource_version_conflict'});
  const p=preview(); assert.throws(()=>executeCatalogRename({db},{confirmationToken:p.confirmationToken,idempotencyKey:p.suggestedIdempotencyKey},{actorKey:'other',idempotencyKey:p.suggestedIdempotencyKey},'other'),{code:'confirmation_subject_mismatch'});
});

test('套件模板规范名称后仍按独立泵壳 ID 解析，泵壳再改名不丢关联',t=>{
  const {db,dependencies}=fixture(t);
  const shellId=Number(db.prepare("INSERT INTO parts(model,category,supplier,updated_at) VALUES('V750','泵壳','甲','2026-09-15T00:00:00.000Z')").run().lastInsertRowid);
  const templateId=Number(db.prepare("INSERT INTO pump_shell_templates(shell_model,cost_mode,updated_at) VALUES('V750','bundle','2026-09-15T00:00:00.000Z')").run().lastInsertRowid);
  function rename(entityType,entityId,naming) {
    const p=previewCatalogRename(db,{entityType,entityId,naming,samePhysicalItem:true,expectedUpdatedAt:'2026-09-15T00:00:00.000Z'},'shell-tester');
    return executeCatalogRename(dependencies,{confirmationToken:p.confirmationToken,idempotencyKey:p.suggestedIdempotencyKey},{actorKey:'shell-tester',idempotencyKey:p.suggestedIdempotencyKey},'shell-tester');
  }
  rename('template',templateId,{ruleId:'template',spec:{series:'V750',configuration:'整套'}});
  const {resolvePumpShellPart}=require('../api/services/pumpShellPartResolver.cjs');
  let template=hydrateCatalogRow(db,'template',db.prepare('SELECT * FROM pump_shell_templates WHERE id=?').get(templateId));
  assert.equal(template.shell_model,'模板-V750-整套'); assert.equal(template.shell_part_id,shellId);
  rename('part',shellId,{ruleId:'shell',spec:{series:'V750',specification:'整套'}});
  template=hydrateCatalogRow(db,'template',db.prepare('SELECT * FROM pump_shell_templates WHERE id=?').get(templateId));
  assert.equal(resolvePumpShellPart(db.prepare('SELECT * FROM parts').all(),template.shell_model,template.shell_part_id).model,'泵壳-V750-整套');
  const { buildRecipeBomDraft } = require('../api/services/recipeBomEngine.cjs');
  const draft = buildRecipeBomDraft({}, { partsCatalog: db.prepare('SELECT * FROM parts').all(),
    template: { shellModel: template.shell_model, shellPartId: template.shell_part_id, costMode: 'bundle', partsJson: '[]', bundleCost: 20 } });
  const shell = draft.parts.find(part => part.name === '泵壳套件');
  assert.equal(shell.partId, shellId); assert.equal(shell.model, '泵壳-V750-整套');
  assert.equal(shell.supplier, '甲'); assert.equal(shell.snapshotPrice, 20);
});

test('已规范物料可正常调价和写备注，工程规格及供应商不能原地替换',t=>{
  const {db,preview,apply}=fixture(t); apply(preview());
  const {assertCatalogPhysicalUpdate}=require('../api/services/catalogPhysicalIdentity.cjs');
  const current=db.prepare('SELECT * FROM parts WHERE id=1').get();
  assert.doesNotThrow(()=>assertCatalogPhysicalUpdate(db,'part',current,{price:4,stock:8,remark:'说明'}));
  assert.doesNotThrow(()=>assertCatalogPhysicalUpdate(db,'part',current,{remark:JSON.stringify({recipeName:'当前配方标签',screwPricingModel:'当前定价来源',cableAccessoryFee:3.4})}));
  const {physicalProfileMatches}=require('../api/services/catalogPhysicalIdentity.cjs');
  const profile=db.prepare('SELECT * FROM catalog_identity_profiles WHERE part_id=1').get();
  const naming=JSON.parse(current.naming_json); naming.spec.code='204';
  assert.equal(physicalProfileMatches(profile,'part',{...current,naming_json:JSON.stringify(naming)}),false);
  assert.throws(()=>assertCatalogPhysicalUpdate(db,'part',current,{supplier:'乙'}),{code:'CATALOG_SPECIFICATION_REPLACEMENT_REQUIRED'});
  assert.throws(()=>assertCatalogPhysicalUpdate(db,'part',current,{remark:JSON.stringify({isStainless:true})}),{code:'CATALOG_SPECIFICATION_REPLACEMENT_REQUIRED'});
});

test('轴承六开头简称在默认配件盘点和读取中一致，原始工程值不写回',t=>{
  const {db,preview,apply}=fixture(t);
  const id=Number(db.prepare('INSERT INTO parts(model,category,remark) VALUES(?,?,?)').run('外壳','泵壳',JSON.stringify({defaultLowerBearing:'6203'})).lastInsertRowid);
  const report=auditCatalogReferences(db); assert.equal(report.references.find(ref=>ref.sourceId===id && ref.path==='/remark/defaultLowerBearing').status,'resolved_legacy');
  apply(preview()); const raw=db.prepare('SELECT * FROM parts WHERE id=?').get(id);
  assert.equal(JSON.parse(hydrateCatalogRow(db,'part',raw).remark).defaultLowerBearing,'轴承-203'); assert.equal(JSON.parse(raw.remark).defaultLowerBearing,'6203');
});

test('先改零件再改配方或模板，未变引用原子续接，原 JSON 和供应商仍保留',t=>{
 const {db,dependencies,preview,apply}=fixture(t);apply(preview());
 const recipe=db.prepare('SELECT * FROM recipes WHERE id=1').get();
 const p=previewCatalogRename(db,{entityType:'recipe',entityId:1,naming:{ruleId:'recipe',spec:{series:'V750',statorCode:'12',sheets:140,barrelLengthMm:120,configuration:'标准'}},samePhysicalItem:true,expectedUpdatedAt:recipe.updated_at || '2026-09-15T00:00:00.000Z'},'chain');
 const receipt=executeCatalogRename(dependencies,{confirmationToken:p.confirmationToken,idempotencyKey:p.suggestedIdempotencyKey},{actorKey:'chain',idempotencyKey:p.suggestedIdempotencyKey},'chain');
 const raw=db.prepare('SELECT * FROM recipes WHERE id=1').get();
 assert.equal(raw.parts_json,recipe.parts_json);assert.equal(JSON.parse(hydrateCatalogRow(db,'recipe',raw).parts_json)[0].model,'轴承-203');
 assert.ok(receipt.bindingIds.length>0);
});
