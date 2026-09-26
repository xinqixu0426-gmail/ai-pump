'use strict';
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const Database = require('better-sqlite3');
const { AI_TASK_PERSISTENCE_SCHEMA_SQL } = require('../api/database/schema.cjs');
const { createAiTaskLifecycleV2 } = require('../api/services/aiTaskLifecycleV2.cjs');
const { consumeAiToolConfirmation, issueAiToolConfirmation, resetAiToolConfirmationsForTests } = require('../api/services/aiToolConfirmation.cjs');
const { stableHash } = require('../api/services/aiTaskContractV2.cjs');
const { AiTaskWriteBridgeError, executeAiTaskConfirmedWriteV2, prepareAiTaskWriteConfirmationV2, reconcileAiTaskCommandV2 } = require('../api/services/aiTaskWriteBridgeV2.cjs');
const { readTaskCommandOperationV2 } = require('../api/services/aiTaskOperationReadbackV2.cjs');
const { executeConfirmedAiTool } = require('../api/services/aiConfirmedToolExecution.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function accessors(db) { return { db, safeInsert(table, values) { const keys = Object.keys(values).filter(key => values[key] !== undefined); return db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => values[key])); }, safeUpdate(table, id, values) { const keys = Object.keys(values).filter(key => values[key] !== undefined); return db.prepare(`UPDATE ${table} SET ${keys.map(key => `${key}=?`).join(',')}, updated_at=? WHERE id=?`).run(...keys.map(key => values[key]), new Date().toISOString(), id); } }; }
function setup() {
 const db=new Database(':memory:'); db.pragma('foreign_keys=ON'); db.exec(`CREATE TABLE ai_conversations (id INTEGER PRIMARY KEY, owner_key TEXT NOT NULL, deleted_at TEXT); CREATE TABLE ai_conversation_messages (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL); CREATE TABLE api_operations (id INTEGER PRIMARY KEY, operation_id TEXT NOT NULL, capability_id TEXT NOT NULL, actor_key TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, request_id TEXT, status TEXT NOT NULL, response_json TEXT, created_at TEXT NOT NULL, completed_at TEXT, expires_at TEXT NOT NULL); ${AI_TASK_PERSISTENCE_SCHEMA_SQL}`);
 db.prepare('INSERT INTO ai_conversations VALUES(1,?,NULL)').run('owner'); db.prepare('INSERT INTO ai_conversation_messages VALUES(1,1,?,?)').run('user','调整零件库存');
 const id=crypto.randomUUID(), message='调整零件库存'; const spec={version:2,answerOwner:'TASK_V2',userGoal:message,businessWritePolicy:'CONFIRMATION_REQUIRED',subjects:[],goals:[{goalKey:'prepare',kind:'PREPARE_CHANGE',description:'准备库存调整',subjectKeys:[],scenarioKeys:[],dependsOn:[],state:'PENDING',factIds:[],blockers:[],requirements:[]},{goalKey:'apply',kind:'APPLY_CHANGE',description:'执行库存调整',subjectKeys:[],scenarioKeys:[],dependsOn:['prepare'],state:'PENDING',factIds:[],blockers:[],requirements:[]}],scenarios:[],questions:[],approvalOperationIds:[],recovery:{version:1,proposal:{version:1,goalSummary:message,subjects:[],scenarios:[],goals:[{goalKey:'prepare',kind:'PREPARE_CHANGE',description:'准备库存调整',subjectKeys:[],scenarioKeys:[],dependsOn:[],requestedBasis:'CURRENT',sources:[{messageRef:'msg:durable:1',start:0,end:message.length,text:message}],quantity:null,unitPrice:null}],unparsedSpans:[]},sourceMessageIds:{'msg:durable:1':1},pending:null,activeMsBase:0}};
 const budget={limits:{maxModelCalls:7,maxToolCalls:10,maxToolResultBytes:98304,maxTaskStateBytes:262144,deadlineAt:null,maxApiCalls:32,maxActiveMs:60000},usage:{modelCalls:0,toolCalls:0,apiCalls:0,activeMs:0}}; const now=new Date().toISOString(); db.prepare(`INSERT INTO ai_tasks(task_key,owner_key,conversation_id,user_message_id,schema_version,revision,plan_revision,state,execution_mode,input_hash,spec_json,budget_json,result_json,lease_owner,lease_token,lease_expires_at,cancel_requested_at,created_at,updated_at,expires_at) VALUES(?,?,1,1,2,1,1,'RUNNING','DETACHED',?,?,?,NULL,NULL,NULL,NULL,NULL,?,?,?)`).run(id,'owner',hash(message),JSON.stringify(spec),JSON.stringify(budget),now,now,new Date(Date.now()+86400000).toISOString());
 const lifecycle=createAiTaskLifecycleV2({dbAccessors:accessors(db)}); return {db,lifecycle,task:lifecycle.store.getTaskForOwner(id,'owner')};
}
/** NATIVE-W1：持久化的冻结提案（执行前必须已经存在）。 */
function proposalFacts({ operationId, model = 'P-1', changeQty = 2, idempotencyKey = 'formal-idempotency-1', partId = 11, currentStock = 100, nextStock = 102 }) {
 const args = { items: [{ model, changeQty }] };
 const argsHash = stableHash(args);
 return { version: 1, phase: 'PROPOSAL_READY', capabilityId: 'inventory.parts.batch_adjust_stock', toolName: 'adjust_part_stock',
  target: { partId, model }, delta: changeQty, currentStock, nextStock, expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
  argsHash, proposalHash: stableHash({ operationId, argsHash, partId, delta: changeQty }), idempotencyKey,
  previewFacts: [{ partId, model, currentStock, delta: changeQty, nextStock, expectedUpdatedAt: '2026-01-01T00:00:00.000Z', clampedToZero: false }],
  proposedAt: new Date().toISOString() };
}
/** 把任务推进到「已预检、等待 Owner 批准」的持久化状态。 */
function seedWaitingApproval(db, task, { operationId, writeV1, verifiedPrepare = true }) {
 const spec = structuredClone(task.spec); spec.approvalOperationIds.push(operationId); spec.writeV1 = writeV1;
 if (verifiedPrepare) spec.goals[0].state = 'VERIFIED';
 db.prepare("UPDATE ai_tasks SET state='WAITING_APPROVAL', spec_json=? WHERE task_key=?").run(JSON.stringify(spec), task.taskKey);
 return spec;
}
function preflight() { return async (_tool,args,context) => { const issued=issueAiToolConfirmation({toolName:'adjust_part_stock',args,subject:'subject-a',executionContext:{kind:'part_stock_preview',confirmationToken:'formal-preview',idempotencyKey:'formal-key',nativeTask:context.executionContext.nativeTask}}); return {success:true,requiresConfirmation:true,confirmation:{...issued,idempotencyKey:'formal-key',proposal:{kind:'part_stock_adjust',capabilityId:'inventory.parts.batch_adjust_stock',items:[{partId:11,model:'P-1',currentStock:100,delta:2,nextStock:102,expectedUpdatedAt:'2026-01-01T00:00:00.000Z',clampedToZero:false}]}}}; }; }
test.beforeEach(()=>resetAiToolConfirmationsForTests());
test('N6.1 task preflight binds server-native context, stores only operation association, and leaves APPLY_CHANGE pending',async()=>{const {lifecycle,task}=setup(); const result=await prepareAiTaskWriteConfirmationV2({task,lifecycle,confirmationSubject:'subject-a',request:{version:1,expectedRevision:1,goalKey:'prepare',toolName:'adjust_part_stock',args:{items:[{model:'P-1',changeQty:2}]}},execute:preflight()}); const stored=lifecycle.store.getTaskByKey(task.taskKey); assert.equal(stored.state,'WAITING_APPROVAL'); assert.equal(stored.spec.goals[0].state,'VERIFIED'); assert.equal(stored.spec.goals[1].state,'PENDING'); assert.deepEqual(stored.spec.approvalOperationIds,[result.confirmation.operationId]); assert.equal(JSON.stringify(stored.spec).includes('confirmationToken'),false); assert.equal(stored.spec.writeV1.phase,'PROPOSAL_READY'); assert.equal(stored.spec.writeV1.target.partId,11); assert.equal(stored.spec.writeV1.nextStock,102); assert.equal(result.proposal.summary.includes('调整后：102'),true); const consumed=consumeAiToolConfirmation({confirmationToken:result.confirmation.confirmationToken,subject:'subject-a'}); assert.deepEqual(consumed.executionContext.nativeTask,{taskId:task.taskKey,planRevision:1,goalKey:'prepare'});});
test('N6.1 rejects unapproved tools, forbidden policies, stale revisions, and never accepts model authority fields',async()=>{const {lifecycle,task}=setup(); await assert.rejects(()=>prepareAiTaskWriteConfirmationV2({task,lifecycle,confirmationSubject:'subject-a',request:{version:1,expectedRevision:1,goalKey:'prepare',toolName:'delete_part',args:{}},execute:preflight()}),error=>error instanceof AiTaskWriteBridgeError&&error.code==='NATIVE_WRITE_CAPABILITY_UNSUPPORTED'); await assert.rejects(()=>prepareAiTaskWriteConfirmationV2({task,lifecycle,confirmationSubject:'subject-a',request:{version:1,expectedRevision:1,goalKey:'prepare',toolName:'batch_update_prices',args:{category:'轴承',percentChange:5}},execute:preflight()}),error=>error.code==='NATIVE_WRITE_CAPABILITY_UNSUPPORTED'); await assert.rejects(()=>prepareAiTaskWriteConfirmationV2({task,lifecycle,confirmationSubject:'subject-a',request:{version:1,expectedRevision:2,goalKey:'prepare',toolName:'adjust_part_stock',args:{items:[]}},execute:preflight()}),error=>error.code==='TASK_REVISION_CONFLICT'); const forbidden={...task,spec:{...task.spec,businessWritePolicy:'FORBIDDEN'}}; await assert.rejects(()=>prepareAiTaskWriteConfirmationV2({task:forbidden,lifecycle,confirmationSubject:'subject-a',request:{version:1,expectedRevision:1,goalKey:'prepare',toolName:'adjust_part_stock',args:{items:[]}},execute:preflight()}),error=>error.code==='TASK_WRITE_POLICY_FORBIDDEN');});

test('N6.2 admits a server-bound command before dispatch, persists its operation association, then verifies APPLY_CHANGE only after trusted receipt', async () => {
    const { lifecycle, db, task } = setup();
    const operationId = crypto.randomUUID();
    const writeV1 = proposalFacts({ operationId });
    seedWaitingApproval(db, task, { operationId, writeV1 });
    const waiting = lifecycle.store.getTaskByKey(task.taskKey);
    const receipt = { operationId: 'formal-operation-1', capabilityId: 'inventory.parts.batch_adjust_stock', status: 'completed', auditId: 1, auditIds: [1], changes: [{ resourceId: 11 }], result: { readback: [{ id: 11, model: 'P-1', stock: 102 }] } };
    const result = await executeAiTaskConfirmedWriteV2({ task: waiting, lifecycle, confirmationSubject: 'subject-a', request: { version: 1, expectedRevision: 1, confirmationToken: 'server-token', toolName: 'adjust_part_stock', args: { items: [{ model: 'P-1', changeQty: 2 }] } }, executeConfirmed: async input => { const consumed = { operationId, toolName: 'adjust_part_stock', args: { items: [{ model: 'P-1', changeQty: 2 }] }, argsHash: writeV1.argsHash, executionContext: { idempotencyKey: writeV1.idempotencyKey, nativeTask: { taskId: task.taskKey, planRevision: 1, goalKey: 'apply' } } }; await input.onAdmission(consumed); await input.onCompleted(receipt, consumed); return receipt; } });
    assert.equal(result.task.state, 'SUCCEEDED');
    assert.deepEqual(result.task.spec.approvalOperationIds.sort(), [operationId, 'formal-operation-1'].sort());
    const step = lifecycle.store.listSteps(task.taskKey)[0]; assert.equal(step.access, 'COMMAND'); assert.equal(step.state, 'SUCCEEDED'); assert.equal(step.operationId, 'formal-operation-1'); assert.equal(step.idempotencyKey, writeV1.idempotencyKey);
    // NATIVE-W1：提案 → 批准 → 提交 → 验证 的事实全部持久化，且批准事实不含原始凭据。
    assert.equal(result.task.spec.writeV1.phase, 'VERIFIED');
    assert.equal(result.task.spec.writeV1.verification.verified, true);
    assert.equal(result.task.spec.writeV1.verification.stock, 102);
    assert.equal(result.task.spec.writeV1.approval.proposalHash, writeV1.proposalHash);
    assert.match(result.task.spec.writeV1.approval.ownerSubject, /^[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(result.task.spec).includes('subject-a'), false);
});

test('N6.2 dispatches a real confirmation only after durable admission, and a concurrent replay has no second business effect', async () => {
    const { lifecycle, db, task } = setup(); const operationId = crypto.randomUUID();
    const writeV1 = proposalFacts({ operationId, idempotencyKey: 'formal-idempotency-live' });
    seedWaitingApproval(db, task, { operationId, writeV1 });
    const issued = issueAiToolConfirmation({ toolName: 'adjust_part_stock', args: { items: [{ model: 'P-1', changeQty: 2 }] }, subject: 'subject-a', executionContext: { idempotencyKey: writeV1.idempotencyKey, nativeTask: { taskId: task.taskKey, planRevision: 1, goalKey: 'apply' } } });
    writeV1.argsHash = issued.argsHash;
    const spec = structuredClone(lifecycle.store.getTaskByKey(task.taskKey).spec); spec.approvalOperationIds.push(issued.operationId); spec.writeV1 = writeV1;
    db.prepare("UPDATE ai_tasks SET spec_json=? WHERE task_key=?").run(JSON.stringify(spec), task.taskKey);
    let businessExecutions = 0;
    const executeConfirmed = input => executeConfirmedAiTool({ ...input, execute: async () => {
        businessExecutions += 1; const step = lifecycle.store.listSteps(task.taskKey)[0];
        assert.equal(step.state, 'RUNNING'); assert.equal(step.operationId, issued.operationId);
        return { success: true, executionEvidence: { verified: true, kind: 'formal_api_command', receipts: [{ operationId, capabilityId: 'inventory.parts.batch_adjust_stock', status: 'completed', auditIds: [7] }] }, auditId: 7, auditIds: [7], readback: [{ id: 11, model: 'P-1', stock: 102 }] };
    } });
    const request = { version: 1, expectedRevision: 1, confirmationToken: issued.confirmationToken, toolName: 'adjust_part_stock', args: { items: [{ model: 'P-1', changeQty: 2 }] } };
    const result = await executeAiTaskConfirmedWriteV2({ task: lifecycle.store.getTaskByKey(task.taskKey), lifecycle, confirmationSubject: 'subject-a', request, executeConfirmed });
    assert.equal(result.task.state, 'SUCCEEDED'); assert.equal(businessExecutions, 1);
    const replay = await executeConfirmedAiTool({ confirmationToken: issued.confirmationToken, subject: 'subject-a', execute: async () => { businessExecutions += 1; } });
    assert.equal(replay.idempotentReplay, true); assert.equal(businessExecutions, 1);
});

test('N6.2 formal rejection fails without retry while uncertain command outcome becomes RECONCILING', async () => {
    for (const [statusCode, expectedState] of [[409, 'FAILED'], [502, 'RECONCILING']]) {
        const { lifecycle, db, task } = setup(); const operationId = crypto.randomUUID(); const writeV1 = proposalFacts({ operationId }); seedWaitingApproval(db, task, { operationId, writeV1 }); const waiting = lifecycle.store.getTaskByKey(task.taskKey);
        await assert.rejects(executeAiTaskConfirmedWriteV2({ task: waiting, lifecycle, confirmationSubject: 'subject-a', request: { version: 1, expectedRevision: 1, confirmationToken: 'server-token', toolName: 'adjust_part_stock', args: { items: [{ model: 'P-1', changeQty: 2 }] } }, executeConfirmed: async input => { const consumed = { operationId, toolName: 'adjust_part_stock', args: { items: [{ model: 'P-1', changeQty: 2 }] }, argsHash: writeV1.argsHash, executionContext: { idempotencyKey: writeV1.idempotencyKey, nativeTask: { taskId: task.taskKey, planRevision: 1, goalKey: 'apply' } } }; await input.onAdmission(consumed); const error = new Error('formal failure'); error.code = statusCode === 409 ? 'resource_version_conflict' : 'transport_failure'; error.statusCode = statusCode; throw error; } }), error => error.statusCode === statusCode);
        const stored = lifecycle.store.getTaskByKey(task.taskKey); assert.equal(stored.state, expectedState); const step = lifecycle.store.listSteps(task.taskKey)[0]; assert.equal(step.state, statusCode === 409 ? 'FAILED' : 'UNKNOWN_EFFECT');
        assert.equal(stored.spec.writeV1.phase, statusCode === 409 ? 'FAILED_SAFE' : 'RECONCILING');
    }
});

test('N6.2 reconciles a response-lost command only from a task-bound formal operation readback', async () => {
    const { lifecycle, db, task } = setup(); const operationId = crypto.randomUUID();
    const writeV1 = proposalFacts({ operationId }); seedWaitingApproval(db, task, { operationId, writeV1 });
    const waiting = lifecycle.store.getTaskByKey(task.taskKey);
    await assert.rejects(executeAiTaskConfirmedWriteV2({ task: waiting, lifecycle, confirmationSubject: 'subject-a', request: { version: 1, expectedRevision: 1, confirmationToken: 'server-token', toolName: 'adjust_part_stock', args: { items: [{ model: 'P-1', changeQty: 2 }] } }, executeConfirmed: async input => {
        const consumed = { operationId, toolName: 'adjust_part_stock', args: { items: [{ model: 'P-1', changeQty: 2 }] }, argsHash: writeV1.argsHash, executionContext: { idempotencyKey: writeV1.idempotencyKey, nativeTask: { taskId: task.taskKey, planRevision: 1, goalKey: 'apply' } } };
        await input.onAdmission(consumed); const error = new Error('response lost'); error.statusCode = 502; throw error;
    } }), error => error.statusCode === 502);
    let reconciling = lifecycle.store.getTaskByKey(task.taskKey); assert.equal(reconciling.state, 'RECONCILING');
    const verifyTarget = async () => ({ partId: 11, model: 'P-1', stock: 102 });
    const unresolved = await reconcileAiTaskCommandV2({ task: reconciling, lifecycle, verifyTarget, readOperation: input => readTaskCommandOperationV2({ db, ...input }) });
    assert.equal(unresolved.resolved, false); assert.equal(unresolved.status, 'MISSING');
    // NATIVE-W1 §14：MISSING 不自动重发，直接安全失败并要求重新确认。
    assert.equal(unresolved.task.state, 'FAILED');
    assert.equal(unresolved.task.spec.writeV1.failure.code, 'OPERATION_MISSING');
    assert.equal(unresolved.task.spec.writeV1.failure.reconfirmRequired, true);

    // 另一条路径：正式操作确实已提交 → 对账发现（不重发）→ 回读核验 → SUCCEEDED。
    const second = setup(); const opId = crypto.randomUUID();
    const writeV1b = proposalFacts({ operationId: opId }); seedWaitingApproval(second.db, second.task, { operationId: opId, writeV1: writeV1b });
    await assert.rejects(executeAiTaskConfirmedWriteV2({ task: second.lifecycle.store.getTaskByKey(second.task.taskKey), lifecycle: second.lifecycle, confirmationSubject: 'subject-a', request: { version: 1, expectedRevision: 1, confirmationToken: 'server-token', toolName: 'adjust_part_stock', args: { items: [{ model: 'P-1', changeQty: 2 }] } }, executeConfirmed: async input => {
        const consumed = { operationId: opId, toolName: 'adjust_part_stock', args: { items: [{ model: 'P-1', changeQty: 2 }] }, argsHash: writeV1b.argsHash, executionContext: { idempotencyKey: writeV1b.idempotencyKey, nativeTask: { taskId: second.task.taskKey, planRevision: 1, goalKey: 'apply' } } };
        await input.onAdmission(consumed); const error = new Error('response lost'); error.statusCode = 502; throw error;
    } }), error => error.statusCode === 502);
    let rec2 = second.lifecycle.store.getTaskByKey(second.task.taskKey);
    const step = second.lifecycle.store.listSteps(second.task.taskKey)[0];
    const formalOperationId = crypto.randomUUID();
    const receipt = { operationId: formalOperationId, capabilityId: 'inventory.parts.batch_adjust_stock', status: 'completed', auditId: 12, auditIds: [12], completedAt: new Date().toISOString() };
    second.db.prepare(`INSERT INTO api_operations(operation_id,capability_id,actor_key,idempotency_key,request_hash,request_id,status,response_json,created_at,completed_at,expires_at) VALUES(?,?,?,?,? ,NULL,'completed',?,?,?,?)`).run(formalOperationId, receipt.capabilityId, 'internal', step.idempotencyKey, 'hash', JSON.stringify(receipt), receipt.completedAt, receipt.completedAt, new Date(Date.now() + 60_000).toISOString());
    rec2 = second.lifecycle.store.getTaskByKey(second.task.taskKey);
    const resolved = await reconcileAiTaskCommandV2({ task: rec2, lifecycle: second.lifecycle, verifyTarget, readOperation: input => readTaskCommandOperationV2({ db: second.db, ...input }) });
    assert.equal(resolved.resolved, true); assert.equal(resolved.task.state, 'SUCCEEDED');
    assert.equal(second.lifecycle.store.listSteps(second.task.taskKey)[0].operationId, formalOperationId);
    assert.equal(resolved.task.spec.writeV1.phase, 'VERIFIED');
});

test('N6.2 does not turn a cancellation racing a submitted command into cancellation or a duplicate command', async () => {
    const { lifecycle, db, task } = setup(); const operationId = crypto.randomUUID();
    const writeV1 = proposalFacts({ operationId, idempotencyKey: 'formal-idempotency-cancel' }); seedWaitingApproval(db, task, { operationId, writeV1 });
    const waiting = lifecycle.store.getTaskByKey(task.taskKey); const receipt = { operationId: 'formal-cancel-race', capabilityId: 'inventory.parts.batch_adjust_stock', status: 'completed', auditId: 9, auditIds: [9], result: { readback: [{ id: 11, model: 'P-1', stock: 102 }] } };
    const result = await executeAiTaskConfirmedWriteV2({ task: waiting, lifecycle, confirmationSubject: 'subject-a', request: { version: 1, expectedRevision: 1, confirmationToken: 'server-token', toolName: 'adjust_part_stock', args: { items: [{ model: 'P-1', changeQty: 2 }] } }, executeConfirmed: async input => {
        const consumed = { operationId, toolName: 'adjust_part_stock', args: { items: [{ model: 'P-1', changeQty: 2 }] }, argsHash: writeV1.argsHash, executionContext: { idempotencyKey: writeV1.idempotencyKey, nativeTask: { taskId: task.taskKey, planRevision: 1, goalKey: 'apply' } } };
        await input.onAdmission(consumed); const admitted = lifecycle.store.getTaskByKey(task.taskKey); lifecycle.store.requestCancel(task.taskKey, admitted.revision); await input.onCompleted(receipt, consumed); return receipt;
    } });
    assert.equal(result.task.state, 'PARTIAL');
    assert.equal(lifecycle.store.listSteps(task.taskKey).length, 1);
    assert.equal(result.task.spec.writeV1.phase, 'VERIFIED');
});
