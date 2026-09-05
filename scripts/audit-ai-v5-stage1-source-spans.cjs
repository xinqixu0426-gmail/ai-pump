'use strict';
// Audit only: frozen source recovery through an existing read-only fixture path.
// No model, HTTP, service initialization, or artifact writes. stdout is safe JSON.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'docs/ai-governance/data', name), 'utf8'));
const { freezeHashes, dbSnapshot } = require('./run-ai-v5e4r-two-stage-evaluation.cjs');
const { createV5InterpreterInputEnvelope } = require('../api/services/ai-v5/taskInterpreterInput.cjs');
const { createV5SourceSpanCatalog } = require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const key = s => `${s.start}:${s.end}`;
const contains = (a,b) => a.start <= b.start && a.end >= b.end && key(a) !== key(b);
const median = xs => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
function audit() {
    const baseline = read('v5-e4r-candidate-set-two-stage-valid-evaluation.json');
    const before = dbSnapshot(), hashes = freezeHashes();
    assert.deepEqual(hashes, baseline.preEvalHashes);
    assert.deepEqual(hashes, baseline.postEvalHashes);
    const frozen = read('v5-e4r-entity-first-architecture-audit.json').cases;
    const oldLookup = read('v5-e4r-type-independent-entity-resolution-b1b.json').paths;
    const evaluator = fs.readFileSync(path.join(__dirname,'run-ai-v5e4r-two-stage-evaluation.cjs'),'utf8');
    const definitions = vm.runInNewContext(`(${evaluator.match(/const definitions=(\{[\s\S]*?\n    \});/)[1]})`,{}, {timeout:100});
    const Database = require('better-sqlite3');
    const db = new Database(path.join(root,'pump.db'),{readonly:true,fileMustExist:true});
    const groups = [], cases = [], privateSentinels = [];
    try {
        for(const [group,def] of Object.entries(definitions)) {
            const records = baseline.paths.filter(p=>p.source_group_id===group);
            const sources = new Set();
            for(const row of db.prepare(def.query).iterate()) {
                const source = `${row.identity}${def.suffix}`;
                if(createV5InterpreterInputEnvelope({rawUserRequest:source,pageContext:null}).inputFingerprint===records[0].inputFingerprint) sources.add(row.identity);
            }
            assert.equal(sources.size,1,'FROZEN_SOURCE_NOT_UNIQUE_OR_UNAVAILABLE');
            const mention = [...sources][0], source = `${mention}${def.suffix}`;
            privateSentinels.push(source,mention);
            const catalog = createV5SourceSpanCatalog(source), spans = catalog.spans;
            assert.equal(catalog.status,'READY');
            assert.deepEqual(catalog,createV5SourceSpanCatalog(source));
            const expected = spans.find(s=>s.text===mention);
            assert.ok(expected,'EXPECTED_SPAN_MISSING');
            const segments = [...new Intl.Segmenter('zh-CN',{granularity:'word'}).segment(source)].map(s=>({start:s.index,end:s.index+s.segment.length,wordLike:s.isWordLike===true,text:s.segment}));
            const identifiers = [...source.matchAll(/(?:^|(?<=[^A-Za-z0-9_+.\/-]))[-_+.\/]*[A-Za-z0-9][A-Za-z0-9_+.\/-]*/g)].map(m=>({start:m.index,end:m.index+m[0].length}));
            const quoted = [...source.matchAll(/(["'“”‘’【】\[\]()（）])([^\r\n]{1,160}?)(["'“”‘’【】\[\]()（）])/gu)].map(m=>({start:m.index+m[1].length,end:m.index+m[1].length+m[2].length}));
            const combinations = new Set();
            for(let i=0;i<segments.length;i++) {
                if(!segments[i].wordLike)continue;
                let count=0;
                for(let j=i;j<segments.length;j++) {
                    const s=segments[j]; if(s.wordLike)count++;
                    if(count>6 || (/\s/u.test(s.text)&&!s.wordLike))break;
                    const range={start:segments[i].start,end:s.end};
                    if(s.wordLike&&!identifiers.some(id=>contains(id,range)))combinations.add(key(range));
                }
            }
            const category = s => [identifiers.some(t=>key(t)===key(s))?'IDENTIFIER':null,segments.some(t=>t.wordLike&&key(t)===key(s))?'WORD':null,combinations.has(key(s))?'COMBINED':null,quoted.some(t=>key(t)===key(s))?'QUOTED':null].filter(Boolean);
            const neighborhood = {
                strictSubspans:spans.filter(s=>contains(expected,s)).length,
                strictSuperspans:spans.filter(s=>contains(s,expected)).length,
                overlapsExcludingContainment:spans.filter(s=>key(s)!==key(expected)&&s.start<expected.end&&s.end>expected.start&&!contains(s,expected)&&!contains(expected,s)).length,
                sameStartExcludingSelf:spans.filter(s=>s.start===expected.start&&key(s)!==key(expected)).length,
                sameEndExcludingSelf:spans.filter(s=>s.end===expected.end&&key(s)!==key(expected)).length,
            };
            const simulations = {
                EXACT_DEDUPE:spans.filter((s,i)=>spans.findIndex(t=>key(t)===key(s))===i),
                IDENTIFIER_NESTED_SUPPRESSION:spans.filter(s=>!identifiers.some(t=>contains(t,s))||quoted.some(t=>key(t)===key(s))),
                GLOBAL_MAXIMAL_WITH_QUOTES:spans.filter(s=>!spans.some(t=>contains(t,s))||quoted.some(t=>key(t)===key(s))),
                MAXIMAL_IDENTIFIERS_AND_WORDS_WITH_QUOTES:spans.filter(s=>category(s).some(c=>['IDENTIFIER','WORD','QUOTED'].includes(c))&&!identifiers.some(t=>contains(t,s))),
            };
            const unique = source.split(mention).length-1===1;
            groups.push({source_group_id:group,sourceSpanCount:spans.length,identifierLikeCount:spans.filter(s=>category(s).includes('IDENTIFIER')).length,wordLikeCount:spans.filter(s=>category(s).includes('WORD')).length,combinedCount:spans.filter(s=>category(s).includes('COMBINED')).length,quotedCount:spans.filter(s=>category(s).includes('QUOTED')).length,expectedCategories:category(expected),expectedSpanRef:expected.spanRef,neighborhood});
            for(const record of records) {
                assert.ok(frozen.some(p=>p.case_id===record.case_id));
                const selected = spans.find(s=>s.spanRef===record.spanRef); assert.ok(selected);
                assert.equal(crypto.createHash('sha256').update(JSON.stringify([record.stage1Status,[record.spanRef]])).digest('hex'),record.stage1Signature,'FROZEN_SELECTION_SIGNATURE_MISMATCH');
                const match=key(expected)===key(selected); assert.equal(match,record.spanMatch);
                const relation=match?'EQUAL':contains(selected,expected)?'SELECTED_IS_SUPERSPAN_OF_EXPECTED':contains(expected,selected)?'SELECTED_IS_SUBSPAN_OF_EXPECTED':selected.start<expected.end&&selected.end>expected.start?'SELECTED_OVERLAPS_EXPECTED':selected.end===expected.start||selected.start===expected.end?'SELECTED_ADJACENT':'SELECTED_UNRELATED';
                const boundary=!match&&['SELECTED_IS_SUPERSPAN_OF_EXPECTED','SELECTED_IS_SUBSPAN_OF_EXPECTED','SELECTED_OVERLAPS_EXPECTED'].includes(relation);
                cases.push({case_id:record.case_id,source_group_id:group,input_fingerprint:record.inputFingerprint,source_span_count:spans.length,expected_span_ref:expected.spanRef,selected_span_ref:record.spanRef,expectedSpanAvailable:true,expectedSpanUnique:unique,selectedSpanValid:true,spanMatch:match,wrongSpanRelation:relation,boundaryError:boundary,semanticSelectionError:!match&&!boundary,selectedWholeRequest:selected.start===0&&selected.end===source.length,lookupStatus:record.lookupStatus,expectedLookupStatusFromPriorEvidence:oldLookup.find(p=>p.case_id===record.case_id).resolutionStatus,neighborhood,simulations:Object.fromEntries(Object.entries(simulations).map(([name,list])=>[name,{count:list.length,expectedSurvives:list.includes(expected),wrongSelectedRemoved:!match&&!list.includes(selected)}])),safeReasonCodes:match?['FROZEN_SOURCE_SELECTION_CORRECT']:['EXPECTED_SOURCE_AVAILABLE','WRONG_VALID_BOUNDARY','PRIOR_LOOKUP_NOT_FOUND']});
            }
        }
    } finally { db.close(); }
    assert.equal(cases.length,15); assert.equal(groups.length,5);
    const summary={paths:cases.length,successes:cases.filter(c=>c.spanMatch).length,boundaryErrors:cases.filter(c=>c.boundaryError).length,semanticErrors:cases.filter(c=>c.semanticSelectionError).length,medianSpanCount:median(cases.map(c=>c.source_span_count)),maxSpanCount:Math.max(...cases.map(c=>c.source_span_count)),medianSubspans:median(cases.map(c=>c.neighborhood.strictSubspans)),maxSubspans:Math.max(...cases.map(c=>c.neighborhood.strictSubspans)),medianSuperspans:median(cases.map(c=>c.neighborhood.strictSuperspans)),maxSuperspans:Math.max(...cases.map(c=>c.neighborhood.strictSuperspans)),simulations:Object.fromEntries(Object.keys(cases[0].simulations).map(name=>[name,{expectedSurvival:cases.filter(c=>c.simulations[name].expectedSurvives).length,wrongRemoved:cases.filter(c=>c.simulations[name].wrongSelectedRemoved).length,medianCount:median(cases.map(c=>c.simulations[name].count)),maxCount:Math.max(...cases.map(c=>c.simulations[name].count))}]))};
    assert.deepEqual(freezeHashes(),hashes);
    const after=dbSnapshot(); assert.deepEqual(before,after);
    const result={schemaVersion:1,audit:'P15R-E-B2-C',simulationOnly:true,frozenHashesMatch:true,groups,cases,summary,safety:{modelCalls:0,businessApiCalls:0,toolCalls:0,writes:0,before,after,databaseUnchanged:true}};
    const serialized=JSON.stringify(result);
    for(const privateValue of privateSentinels)assert.ok(!serialized.includes(privateValue),'PRIVACY_SENTINEL');
    const reportPath=path.join(root,'docs/ai-governance/reports/V5-E4R-E-B2-C-stage1-source-span-failure-audit.md');
    if(fs.existsSync(reportPath)) {
        const report=fs.readFileSync(reportPath,'utf8');
        for(const privateValue of privateSentinels)assert.ok(!report.includes(privateValue),'REPORT_PRIVACY_SENTINEL');
    }
    return result;
}
if(require.main===module)console.log(JSON.stringify(audit(),null,2));
module.exports={audit};
