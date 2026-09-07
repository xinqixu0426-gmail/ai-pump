'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const Database = require('better-sqlite3'), express = require('express');
const { createEntitySpanCandidateService, MAX_IDENTITIES } = require('../api/services/entitySpanCandidates.cjs');
const { createEntitySpanCandidateRouter } = require('../api/routes/entitySpanCandidates.cjs');
const { createEntityLookupService } = require('../api/services/entityLookupService.cjs');
const { supplyCoilSpanCandidates } = require('../api/routes/ai/internalApiClient.cjs');
const { shouldRecheckManagementActions } = require('../api/services/managementActionLifecycle.cjs');
function fixture(rows) {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE coils(id INTEGER PRIMARY KEY, scheme_name TEXT, scheme_code TEXT, spec TEXT, sheets INTEGER)');
    rows.forEach(([name, code], i) => db.prepare('INSERT INTO coils VALUES(?,?,?,?,?)').run(i + 1, name, code, 'generic', 1));
    return { db, supply: createEntitySpanCandidateService({ db }).supply };
}
const input = sourceText => ({ version: 1, entityScope: 'coil', sourceText });
test('exact complete names/codes only, original UTF-16 offsets and no identity DTO', () => {
    const { db, supply } = fixture([['Generic complete 名称-a/b', 'SYN-001']]);
    try {
        const source = '😀 请查 Generic complete 名称-a/b 和 SYN-001', out = supply(input(source));
        assert.equal(out.complete, true); assert.equal(out.candidateCount, 2);
        assert.deepEqual(out.candidates.map(c => source.slice(c.start, c.end)), ['Generic complete 名称-a/b', 'SYN-001']);
        for (const c of out.candidates) assert.deepEqual(Object.keys(c).sort(), ['end', 'entityType', 'identityKind', 'start']);
        for (const text of ['Generic complete', 'SYN-00', 'absent identity', 'Genericcomplete 名称-a/b', 'generic complete 名称-a/b']) {
            assert.equal(supply(input(text)).candidateCount, 0);
        }
    } finally { db.close(); }
});
test('duplicate names dedupe spans only; existing governed lookup preserves ambiguity', () => {
    const { db, supply } = fixture([['Same exact name', 'CODE-A'], ['Same exact name', 'CODE-B']]);
    try {
        assert.equal(supply(input('Same exact name')).candidateCount, 1);
        const out = createEntityLookupService({ db }).lookupEntities({version:1,mention:'Same exact name',entityTypes:['coil'],matchPolicy:'EXACT'});
        assert.equal(out.complete, true); assert.equal(out.candidateCount, 2);
    } finally { db.close(); }
});
test('candidate overflow and repeated occurrences return no first-eight subset', () => {
    const { db, supply } = fixture([['ExactName', 'CODE']]);
    try {
        assert.equal(supply(input(Array(8).fill('ExactName').join(' '))).candidateCount, 8);
        const out = supply(input(Array(9).fill('ExactName').join(' ')));
        assert.equal(out.complete, false);assert.equal(out.status, 'SPAN_CANDIDATE_BUDGET_EXCEEDED');assert.deepEqual(out.candidates, []);
    } finally { db.close(); }
});
test('scan over budget fails closed even if first identity matches; 512 accepted', () => {
    for (const count of [512, 513]) {
        const { db, supply } = fixture(Array.from({length:count}, (_, i) => ['Name-'+i, null]));
        try {
            const out=supply(input('Name-0'));assert.equal(out.complete, count === MAX_IDENTITIES);
            if(count>512) {assert.equal(out.status,'IDENTITY_SCAN_BUDGET_EXCEEDED');assert.deepEqual(out.candidates,[]);}
        } finally { db.close(); }
    }
});
test('HTTP contract + metadata-only wrapper + no business mutation lifecycle',async()=>{
    const {db}=fixture([['PRIVATE-NAME','PRIVATE-CODE']]);
    const app=express();app.use(express.json());app.use('/api/entity-span-candidates',createEntitySpanCandidateRouter({db}));
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    try {
        const before=db.serialize(),trace=[];
        const f=(p,o)=>fetch('http://127.0.0.1:'+server.address().port+p,o);f.recordApiResult=x=>trace.push(x);
        const out=await supplyCoilSpanCandidates('PRIVATE-NAME',{internalFetch:f});assert.equal(out.candidateCount,1);
        assert.ok(!JSON.stringify(trace).includes('PRIVATE'));assert.deepEqual(db.serialize(),before);
        assert.equal(shouldRecheckManagementActions({method:'POST',path:'/api/entity-span-candidates',statusCode:200}),false);
        for(const bad of [{...input('x'),entityScope:'part'},{...input('x'),sourceText:1},{...input('x'),sourceText:''},{...input('x'),sourceText:'x'.repeat(4097)},{...input('x'),limit:999},{...input('x'),version:2}]) {
            const r=await f('/api/entity-span-candidates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(bad)});assert.equal(r.status,400);
        }
    } finally {await new Promise(r=>server.close(r));db.close();}
});
