'use strict';
// P17-A STATIC inventory only. Never import routes, executors, services or db.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const registry = require('../api/capabilities/registry.cjs');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const business = registry.listBusinessCapabilities().filter(c => c.access === 'write');
const tools = registry.listAiCapabilities().filter(c => c.access === 'write');
const services = fs.readdirSync(path.join(root,'api/services')).filter(f => f.endsWith('.cjs'))
    .map(f => ({ file:'api/services/'+f, text:read('api/services/'+f) }));
const mounts = Function('return '+read('tests/apiContractGovernance.test.cjs').match(/const mountPrefixes = (\{[\s\S]*?\n    \});/)[1])();
const routeFiles = [...Object.keys(mounts).map(f=>'api/routes/'+f),
    ...fs.readdirSync(path.join(root,'api/routes/ai')).filter(f=>f.endsWith('.cjs')).map(f=>'api/routes/ai/'+f)];
const routes=[];
for(const file of routeFiles) {
    const source=read(file), matches=[...source.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)];
    matches.forEach((m,i)=>{
        const prefix=file.includes('/ai/')?'':mounts[path.basename(file)];
        routes.push({method:m[1].toUpperCase(),path:prefix+(m[2]==='/'?'':m[2]),file,
            line:source.slice(0,m.index).split('\n').length,body:source.slice(m.index,matches[i+1]?.index||source.length)});
    });
}
const low=new Set(['drawings.rotor.rename_history','drawings.rotor.link_history']);
const medium=new Set(['customers.create','customers.update','orders.requirements.save_draft',
    'orders.execution_records.create_draft','orders.execution_records.update_draft','drawings.rotor.save_parameters',
    'recipes.technical_files.upload','knowledge.documents.upload','files.upload','files.parse',
    'ai.conversations.create','ai.conversations.messages.append','ai.conversations.messages.update_metadata',
    'ai.evaluations.runs.start','ai.evaluations.results.record','ai.evaluations.runs.complete','ai.evaluations.cases.review',
    'ai.evaluations.system_cases.configure','ai.feedback.submit','ai.feedback.diagnose','ai.feedback.retest','ai.feedback.review',
    'quality.recipe_feedback.save','quality.recipe_feedback.resolve','quality.rule_candidates.refresh','workbench.execution_runs.record']);
// Strictly proven narrow predicates, NOT a blanket statement about all dependent state.
const strong=new Map([
    ['parts.batch_create','ABSENCE_OF_EXACT_MODEL_SUPPLIER_INSIDE_IMMEDIATE_TRANSACTION'],
    ['ai.factory_profile.update','PERSISTED_PROFILE_CONTENT_SHA256_INSIDE_TRANSACTION_WHEN_VERSION_PROVIDED'],
]);
const exactRollback=new Set(['customers.update','drawings.rotor.rename_history','drawings.rotor.link_history']);
const compensation=new Set(['inventory.coils.adjust_stock','quality.rule_candidates.review','quality.rule_events.restore']);
const indirect=new Set(['settings.update_runtime','market.sync_copper_price','market.sync_indicators',
    'drawings.rotor.generate_pdf','drawings.rotor.print_pdf','drawings.rotor.delete_history',
    'knowledge.sync_derived','knowledge.documents.delete','files.parse','files.delete',
    'recipes.technical_files.delete','ai.factory_profile.update','ai.feedback.diagnose','ai.feedback.retest',
    'workbench.execution_runs.record']);
// Absence of a live row does not by itself verify retained links/files/tombstones.
for (const c of business) if (/\.delete$/.test(c.capabilityId)) indirect.add(c.capabilityId);
const entityPrefixes = {'inventory.parts.':'part','inventory.coils.':'coil','workflow.quotation.':'quotation+order',
    'customers.':'customer','parts.':'part','coils.':'coil','templates.':'template','model_variants.':'modelVariant',
    'settings.':'setting','market.':'marketIndicator','orders.requirements.':'orderRequirement',
    'orders.execution_records.':'orderExecutionRecord','orders.':'order','quotations.':'quotation',
    'purchasing.':'order+purchaseItem+inventory','recipes.technical_files.':'recipeTechnicalFile',
    'recipes.':'recipe','drawings.rotor.':'rotorDrawing','knowledge.documents.':'knowledgeDocument',
    'knowledge.':'derivedKnowledge','files.links.':'factoryFileLink','files.':'factoryFile',
    'ai.conversations.':'conversation+message','ai.evaluations.':'evaluationRun+case',
    'ai.feedback.':'feedback','ai.learning_rules.':'learningRule','ai.factory_profile.':'factoryProfile',
    'quality.recipe_feedback.':'recipeFeedback','quality.':'factoryRuleCandidate+event','workbench.':'workflowRun'};
const aliases=[
    {method:'POST',path:'/api/coils/:id/stock-adjustment',capabilityId:'inventory.coils.adjust_stock',reason:'COMPATIBILITY_PATH_SKIPS_BUSINESS_PREVIEW_TOKEN'},
    {method:'POST',path:'/api/orders/:id/purchase-items/toggle',capabilityId:'purchasing.order.item_progress',reason:'COMPATIBILITY_INPUT_AND_RESPONSE_ADAPTER'},
];
const operations=business.map(c=>{
    const endpoint=c.inputSchema.match(/^(GET|POST|PATCH|PUT|DELETE) ([^\s(]+)/);
    const route=endpoint?routes.find(r=>r.method===endpoint[1]&&r.path===endpoint[2]):null;
    assert.ok(route||c.inputSchema.startsWith('INTERNAL '),'Unmapped formal mutation '+c.capabilityId);
    const refs=services.filter(s=>s.text.includes("'"+c.capabilityId+"'")&&/executePersistentCommand|beginPersistentExternalCommand/.test(s.text));
    assert.ok(refs.length,'Missing implementing command '+c.capabilityId);
    const service=refs[0];
    const args=[...new Set([...service.text.matchAll(/\binput(?:\?\.)?\.([A-Za-z][\w]*)/g)].map(m=>m[1]))].sort();
    const functions=[...new Set([...service.text.matchAll(/(?:async )?function ((?:execute|normalize|validate|build)[\w]*)\(/g)].map(m=>m[1]))];
    const risk=low.has(c.capabilityId)?'LOW':medium.has(c.capabilityId)?'MEDIUM':'HIGH';
    const entityType=Object.entries(entityPrefixes).find(([prefix])=>c.capabilityId.startsWith(prefix))?.[1];
    assert.ok(entityType,'Missing entity inventory type');
    return {capabilityId:c.capabilityId,domain:c.domain,entityType,operation:c.capabilityId.split('.').at(-1),
        entityAuthority:c.sourceOfTruth,method:endpoint?.[1]||'INTERNAL',path:endpoint?.[2]||c.inputSchema,
        riskClass:risk,registeredRisk:c.riskLevel,
        requiredArgumentsContract:c.inputSchema,
        pathRequiredFields:[...(endpoint?.[2]||'').matchAll(/:([A-Za-z]\w*)/g)].map(m=>m[1]),
        bodyContractSource:service.file,bodyValidatorFunctions:functions,
        serviceReferencedInputFields:args,fieldListSemantics:'SOURCE_REFERENCES_NOT_ALL_REQUIRED; consult validator branches; NOT an executable schema',
        authentication:c.inputSchema.startsWith('INTERNAL ')?'INTERNAL_SCHEDULER':c.capabilityId.startsWith('ai.')?'ENDPOINT_AUTH_AND_SUBJECT_SCOPE_SEE_ROUTE':'JWT_OR_INTERNAL_SECRET',
        confirmationDeclared:c.requiresConfirmation,previewPath:c.previewPath||null,
        confirmationEnforcement:route && /executeConfirmed|confirmationToken|consumeBusinessConfirmation/.test(route.body)
            ? 'ROUTE_TO_CONFIRMATION_PROTOCOL; see service token checks'
            : 'NO_ROUTE_TOKEN_GUARD_PROVEN; registry flag alone does not enforce HTTP approval',
        routeCommandFunctions:route?[...new Set([...route.body.matchAll(/\b((?:execute|build|validate)[A-Z]\w*)\(/g)].map(m=>m[1]))]:[],
        transactionDeclared:c.transactionality,auditDeclared:c.audit,
        idempotencyStatus:'IDEMPOTENCY_SUPPORTED',idempotencyScope:'actor+capability+key+canonical_request_hash; 90-day expiry; key must be stable',
        preconditionDeclared:c.concurrencyControl,
        reliablePrecondition:strong.has(c.capabilityId),
        preconditionAssessment:strong.get(c.capabilityId)||(/expected|snapshot|confirmation/i.test(c.concurrencyControl)?'EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF':'NO_PROPOSAL_STALE_STATE_GUARD'),
        postWriteVerification:indirect.has(c.capabilityId)?'INDIRECT_OR_INCOMPLETE':'AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED',
        readBoundaryCandidates:route?routes.filter(r=>r.file===route.file&&r.method==='GET').map(r=>r.path):[],
        readBoundarySource:route?.file||service.file,
        recovery:exactRollback.has(c.capabilityId)?'EXACT_BUSINESS_FIELDS_WITH_FRESH_APPROVAL_NOT_HISTORY_ERASURE':compensation.has(c.capabilityId)?'COMPENSATION_ONLY_REQUIRES_NEW_APPROVAL':'NO_PROVEN_COMPLETE_SAFE_RECOVERY',
        initialV5ExecutionEligible:false,
        reasonCodes:[risk==='HIGH'?'HIGH_CONSEQUENCE_DEFERRED':'COHORT_REQUIRES_CERTIFICATION',
            strong.has(c.capabilityId)?'NARROW_PRECONDITION_PROVEN':'STRONG_PRECONDITION_GAP',
            'OWNER_PROPOSAL_APPROVAL_NOT_IMPLEMENTED','NO_MUTATION_EXECUTED'],
        source:service.file,sourceLine:service.text.slice(0,service.text.indexOf("'"+c.capabilityId+"'")).split('\n').length,
        routeSource:route?route.file+':'+route.line:null};
});
const toolInventory=tools.map(c=>{
    const definition=AI_TOOLS.find(t=>t.function.name===c.toolName);assert.ok(definition);
    const schema=definition.function.parameters;
    return {toolName:c.toolName,formalCapabilities:c.formalCapabilityIds,executorKey:c.executorKey,
        requiredArguments:schema.required||[],argumentTypes:Object.fromEntries(Object.entries(schema.properties||{}).map(([k,v])=>[k,{type:v.type,required:(schema.required||[]).includes(k)}])),
        schemaReference:'api/routes/ai/tools.cjs:AI_TOOLS.'+c.toolName,
        riskClass:c.formalCapabilityIds.some(id=>operations.find(o=>o.capabilityId===id)?.riskClass==='HIGH')?'HIGH':'MEDIUM',
        confirmationRequired:c.requiresConfirmation,executableInV5:false};
});
const mutationRoutes=operations.filter(o=>o.method!=='INTERNAL').map(o=>o.method+' '+o.path);
for(const a of aliases)assert.ok(routes.some(r=>r.method===a.method&&r.path===a.path));
const excludedRoutes=routes.filter(r=>r.method!=='GET'&&!mutationRoutes.includes(r.method+' '+r.path)&&!aliases.some(a=>a.method===r.method&&a.path===r.path))
    .map(r=>({method:r.method,path:r.path,source:r.file+':'+r.line,
        class:/\/api\/ai\/(chat|confirm-tool)$|^\/mcp$/.test(r.path)?'DISPATCH_OR_SESSION_NOT_ADDITIONAL_BUSINESS_OPERATION':'QUERY_PREVIEW_AUTH_OR_CONNECTIVITY_NOT_BUSINESS_MUTATION'}));
const counts={formalWriteOperations:operations.length,mutationHttpApis:mutationRoutes.length+aliases.length,
    internalFormalOperations:operations.filter(o=>o.method==='INTERNAL').length,aiWriteTools:toolInventory.length,
    domains:[...new Set(operations.map(o=>o.domain))].sort(),
    risk:Object.fromEntries(['LOW','MEDIUM','HIGH'].map(k=>[k,operations.filter(o=>o.riskClass===k).length])),
    reliablePreconditions:operations.filter(o=>o.reliablePrecondition).length,
    partialOrMissingPreconditions:operations.filter(o=>!o.reliablePrecondition).length,
    idempotencySupported:operations.length,needsApiIdempotencyLayer:0,
    resourceRereadAvailable:operations.filter(o=>!indirect.has(o.capabilityId)).length,
    incompleteVerification:operations.filter(o=>indirect.has(o.capabilityId)).length,
    exactBusinessFieldRollback:exactRollback.size,compensationOnly:compensation.size,
    noProvenRecovery:operations.length-exactRollback.size-compensation.size};
assert.equal(new Set(operations.map(o=>o.capabilityId)).size,operations.length);
assert.equal(counts.risk.LOW+counts.risk.MEDIUM+counts.risk.HIGH,operations.length);
const sourceFiles=[...new Set(['api/capabilities/registry.cjs','api/routes/ai/tools.cjs','api/services/commandExecution.cjs',
    'api/services/commandRequest.cjs','api/services/resourceVersion.cjs','api/services/businessConfirmation.cjs',
    'api/services/aiToolConfirmation.cjs',...operations.map(o=>o.source),...routeFiles])];
const dataset={stage:'P17-A',mode:'STATIC_ONLY',basis:'current worktree; dirty files excluded from commit',counts,
    operations,aiWriteTools:toolInventory,compatibilityAliases:aliases,excludedOrDispatchRoutes:excludedRoutes,
    sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,crypto.createHash('sha256').update(read(f)).digest('hex')])),
    safety:{v5Writes:0,allowWriteEnablingCalls:0,businessMutationCalls:0,productionWriteTests:0,executableV5WriteTools:0},
    p17BReady:false};
const clean=s=>String(s).replace(/\|/g,' / ').replace(/\n/g,' ');
const table=['## Appendix A — Canonical operation matrix','',
    'Counts are canonical operations, not Tool aliases. Reread availability is not an implemented post-write verifier. Full argument validators and route locations are indexed in the JSON companion.',
    '', '| Capability | API / trigger | Risk | Precondition | Verification | Recovery | Source |',
    '|---|---|---|---|---|---|---|',...operations.map(o=>'| '+[o.capabilityId,o.method+' '+o.path,o.riskClass,o.preconditionAssessment,o.postWriteVerification,o.recovery,o.source+':'+o.sourceLine].map(clean).join(' | ')+' |'),
    '', '## Appendix B — AI write Tool projection','', '| Tool | Formal capabilities | Required schema fields | Executor | Risk |','|---|---|---|---|---|',
    ...toolInventory.map(t=>'| '+[t.toolName,t.formalCapabilities.join(', '),t.requiredArguments.join(', ')||'(none declared; semantic validator still applies)',t.executorKey,t.riskClass].map(clean).join(' | ')+' |')].join('\n');
const section=process.argv[2];
if(section==='--summary') console.log(JSON.stringify(counts));
else if(section==='--page') console.log(JSON.stringify(operations.slice(Number(process.argv[3])*10,Number(process.argv[3])*10+10)));
else if(section==='--meta') console.log(JSON.stringify({...dataset,operations:[]}));
else if(section==='--appendix') console.log(JSON.stringify(table));
else console.log(JSON.stringify({dataset,appendix:table}));
