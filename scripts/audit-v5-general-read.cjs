'use strict';
// Static audit only: no route/service/executor/DB imports or network calls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const registry = require('../api/capabilities/registry.cjs');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const mounts = Function('return ' + read('tests/apiContractGovernance.test.cjs').match(/const mountPrefixes = (\{[\s\S]*?\n    \});/)[1])();
const prior = JSON.parse(read('docs/ai-governance/data/p17a-write-boundary-inventory.json'));
const excludedPost = new Set(['/api/auth/login','/api/auth/logout','/mcp','/api/ai/chat','/api/ai/confirm-tool','/api/settings/runtime/test-ai']);
const readPosts = new Set(prior.excludedOrDispatchRoutes.filter(r => r.method === 'POST' && !excludedPost.has(r.path)).map(r => r.path));
const files = [...Object.keys(mounts).map(f=>'api/routes/'+f), ...fs.readdirSync(path.join(root,'api/routes/ai')).filter(f=>f.endsWith('.cjs')).map(f=>'api/routes/ai/'+f)];
const routes=[];
for (const file of files) {
    const source=read(file), declarations=[...source.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)];
    declarations.forEach((m,i)=>{
        const endpoint=(file.includes('/ai/')?'':mounts[path.basename(file)])+(m[2]==='/'?'':m[2]);
        const body=source.slice(m.index,declarations[i+1]?.index||source.length);
        if(m[1]!=='get'&&!readPosts.has(endpoint)) return;
        const technical=/^\/api\/(ai|health|auth)(\/|$)|^\/mcp$/.test(endpoint);
        routes.push({method:m[1].toUpperCase(),path:endpoint,scope:technical?'TECHNICAL_OR_DISPATCH':'BUSINESS_READ_CAPABLE',
            source:file,line:source.slice(0,m.index).split('\n').length,
            queryFields:[...new Set([...body.matchAll(/req\.query(?:\?\.)?\.([A-Za-z]\w*)/g)].map(q=>q[1]))],
            serviceImports:[...new Set([...source.matchAll(/require\(['"]([^'"]*services[^'"]+)['"]\)/g)].map(q=>q[1]))],
            handlerCalls:[...new Set([...body.matchAll(/\b((?:get|list|build|search|inspect|calculate|preview|plan|decorate)[A-Z]\w*)\(/g)].map(q=>q[1]))],
            safety:m[1]==='post'?'QUERY_OR_PREVIEW_NOT_EXECUTION; may issue ephemeral confirmation or invoke provider':technical?'NOT_AN_OWNER_BUSINESS_READ':'READ_PATH; do not infer V5 admission from HTTP verb',
            API_EXISTS:true, V5_ROUTABLE:'ONLY_IF_TOOL_AND_SEMANTIC_AND_ENTITY_GATES_PASS', ANSWERABLE:'NO_EXCEPT_FOUR_CERTIFIED_FACT_PROJECTIONS', OWNER_USABLE:'NOT_CERTIFIED_AS_GENERAL_ENDPOINT'});
    });
}
const v5source=read('api/services/ai-v5/capabilityRegistry.cjs');
const v5=[...v5source.matchAll(/definition\('([^']+)', '([^']+)', '([^']+)', 'READ', '[^']+', \[([^\]]*)\], \[([^\]]*)\]\)/g)].map(m=>({id:m[1],domain:m[2],tools:[...m[5].matchAll(/'([^']+)'/g)].map(x=>x[1])}));
const toolRows=registry.listAiCapabilities().filter(t=>t.access==='read').map(t=>{
    const schema=AI_TOOLS.find(x=>x.function.name===t.toolName)?.function.parameters; assert.ok(schema);
    const source='api/routes/ai/executors/'+t.executorKey+'Executors.cjs';
    const text=read(source), marker="case '"+t.toolName+"':", start=text.indexOf(marker); assert.ok(start>=0,t.toolName);
    const end=text.indexOf('\n        case ',start+marker.length), body=text.slice(start,end<0?text.length:end);
    return {tool:t.toolName,domain:t.domain,formalCapabilities:t.formalCapabilityIds,source,line:text.slice(0,start).split('\n').length,
        required:schema.required||[],fields:Object.keys(schema.properties||{}),
        apiLiteralReferences:[...new Set([...body.matchAll(/['"`]((?:\/api\/)[^'"`\n]+)/g)].map(m=>m[1]))],
        API_EXISTS:t.formalCapabilityIds.length?'FORMAL_REGISTERED':'EXECUTOR_PATH_INDEXED; registry mapping incomplete',TOOL_EXISTS:true,
        V5_ROUTABLE:v5.filter(c=>c.tools.includes(t.toolName)).map(c=>c.id),
        executionRegistered:['search_parts','search_coils','preview_recipe_cost'].includes(t.toolName),
        ANSWERABLE:['search_parts','search_coils','preview_recipe_cost'].includes(t.toolName)?'CERTIFIED_NARROW_FACT_ONLY':'NO',
        OWNER_USABLE:['search_parts','search_coils','preview_recipe_cost'].includes(t.toolName)?'CERTIFIED_SINGLE_IDENTITY_FACT_ONLY':'NOT_PROVEN; see UAT matrix',
        paginationFields:Object.keys(schema.properties||{}).filter(k=>/limit|offset|cursor|beforeId|page/i.test(k))};
});
const dataset={stage:'P16-K',mode:'STATIC_AUDIT_NOT_REAL_UAT',routes,tools:toolRows,
    counts:{businessReadCapableApis:routes.filter(r=>r.scope==='BUSINESS_READ_CAPABLE').length,
        technicalOrDispatchReadRoutes:routes.filter(r=>r.scope!=='BUSINESS_READ_CAPABLE').length,
        registeredQueryPreviewCapabilities:registry.listBusinessCapabilities().filter(c=>c.access!=='write').length,
        readTools:toolRows.length,readToolDomains:[...new Set(toolRows.map(t=>t.domain))].sort(),
        businessRouteFamilies:[...new Set(routes.filter(r=>r.scope==='BUSINESS_READ_CAPABLE').map(r=>path.basename(r.source,'.cjs')))].sort()},
    note:'API count includes bounded queries, previews and diagnostics; not all are deterministic or safe for V5. Route/service pointers are code evidence, not live UAT. POST list inherited from source-checked P17-A and asserted against current routes.',
    safety:{v5Writes:0,allowWriteEnablingCalls:0,businessMutationCalls:0,productionCalls:0,p17Paused:true}};
assert.equal(new Set(routes.map(r=>r.method+' '+r.path)).size,routes.length);
for(const p of readPosts) assert.ok(routes.some(r=>r.path===p&&r.method==='POST'),p);
if(process.argv[2]==='--summary') console.log(JSON.stringify(dataset.counts));
else if(process.argv[2]==='--meta') console.log(JSON.stringify({...dataset,routes:[],tools:[]}));
else if(process.argv[2]==='--routes') console.log(JSON.stringify(routes.slice(Number(process.argv[3])*10,Number(process.argv[3])*10+10)));
else if(process.argv[2]==='--tools') console.log(JSON.stringify(toolRows.slice(Number(process.argv[3])*10,Number(process.argv[3])*10+10)));
else console.log(JSON.stringify(dataset));
