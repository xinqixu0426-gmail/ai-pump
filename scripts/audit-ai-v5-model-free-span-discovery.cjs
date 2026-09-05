'use strict';
// Offline audit only. Existing read-only fixture recovery; never lookup new spans.
// No HTTP, model, resolver invocation, production initialization or file writes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = n => JSON.parse(fs.readFileSync(path.join(root, 'docs/ai-governance/data', n + '.json'), 'utf8'));
const {freezeHashes, dbSnapshot} = require('./run-ai-v5e4r-top2-evaluation.cjs');
const {createV5InterpreterInputEnvelope} = require('../api/services/ai-v5/taskInterpreterInput.cjs');
const {createV5SourceSpanCatalog} = require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const median = xs => [...xs].sort((a,b) => a-b)[Math.floor(xs.length/2)];
function audit() {
    const baseline = read('v5-e4r-top2-source-span-evaluation');
    const prior = read('v5-e4r-stage1-source-span-failure-audit');
    const lookup = read('v5-e4r-type-independent-entity-resolution-b1b');
    const union = read('v5-e4r-ambiguity-regression-audit');
    const before = dbSnapshot(), hashes = freezeHashes();
    assert.deepEqual(hashes, baseline.preEvalHashes);
    assert.deepEqual(hashes, baseline.postEvalHashes);
    const sourceCode = fs.readFileSync(path.join(__dirname, 'run-ai-v5e4r-top2-evaluation.cjs'), 'utf8');
    const definitions = vm.runInNewContext(`(${sourceCode.match(/const definitions=(\{[\s\S]*?\n    \});/)[1]})`, {}, {timeout:100});
    const db = new (require('better-sqlite3'))(path.join(root,'pump.db'), {readonly:true,fileMustExist:true});
    const groups = [], cases = [], sentinels = [];
    try {
        for (const [group, def] of Object.entries(definitions)) {
            const records = baseline.paths.filter(p => p.source_group_id === group);
            const sources = new Set();
            for (const row of db.prepare(def.query).iterate()) {
                const source = `${row.identity}${def.suffix}`;
                if (createV5InterpreterInputEnvelope({rawUserRequest:source,pageContext:null}).inputFingerprint === records[0].inputFingerprint) sources.add(row.identity);
            }
            assert.equal(sources.size,1,'FROZEN_FIXTURE_UNAVAILABLE');
            const mention = [...sources][0], source = `${mention}${def.suffix}`;
            sentinels.push(mention,source);
            const catalog = createV5SourceSpanCatalog(source);
            assert.equal(catalog.status,'READY');
            assert.deepEqual(catalog, createV5SourceSpanCatalog(source));
            const spans = catalog.spans, expected = spans.find(s => s.text === mention);
            const inventory = prior.groups.find(g => g.source_group_id === group);
            assert.equal(spans.length,inventory.sourceSpanCount);
            assert.equal(expected.spanRef,inventory.expectedSpanRef);
            const eligible = spans.filter(s => s.text.length > 0 && [...s.text].length <= 160 && source.slice(s.start,s.end) === s.text && !(s.start === 0 && s.end === source.length && spans.length > 1));
            assert.ok(eligible.includes(expected));
            assert.ok(eligible.length <= 40,'PROPOSED_BATCH_BOUND_EXCEEDED');
            groups.push({...inventory,uniqueSourceBoundaries:new Set(spans.map(s => `${s.start}:${s.end}`)).size,uniqueSourceTexts:new Set(spans.map(s => s.text)).size,eligibleSpanCount:eligible.length,expectedSurvives:true,expectedLengthCategory:[...expected.text].length <= 160 ? 'WITHIN_EXISTING_API_BOUND':'OVER_LIMIT',excludedWholeRequestRefs:spans.filter(s=>!eligible.includes(s)).map(s=>s.spanRef),typedAttempts:eligible.length*6});
            for (const record of records) {
                const old = lookup.paths.find(p => p.case_id === record.case_id);
                const knownUnion = union.cases.find(p => p.case_id === record.case_id);
                assert.ok(old.complete && knownUnion.expectedClassSurvives);
                const evidence = new Map([[expected.spanRef,{status:old.resolutionStatus,source:'B1B_EXPECTED_SPAN',candidateCount:old.candidateCount}]]);
                record.spanRefs.forEach((ref,i) => {
                    if (evidence.has(ref)) assert.equal(evidence.get(ref).status,record.lookupStatuses[i]);
                    else if (record.lookupStatuses[i] === 'NOT_FOUND') evidence.set(ref,{status:'NOT_FOUND',candidateCount:0,source:'B2D_SELECTED_SPAN'});
                    else assert.fail('UNMAPPED_POSITIVE_EVIDENCE');
                });
                const spanEvidence = eligible.map(s => ({spanRef:s.spanRef,...(evidence.get(s.spanRef)||{status:'UNKNOWN',source:'NO_FROZEN_LOOKUP_EVIDENCE'})}));
                cases.push({case_id:record.case_id,source_group_id:group,expectedSpanRef:expected.spanRef,eligibleSpanCount:eligible.length,expectedSpanSurvives:true,spanEvidence,unknownSpanCount:spanEvidence.filter(s=>s.status==='UNKNOWN').length,expectedAuthoritativeCandidateCovered:true,knownSubsetCandidateCount:old.candidateCount,knownSubsetCandidateTypes:knownUnion.candidateTypes,knownSubsetLocalClasses:knownUnion.localTaskClasses,expectedClass:knownUnion.expectedClass,expectedClassSurvivesKnownSubset:true,expectedClassSurvivesUntruncatedUnion:true,knownSubsetFinalUniqueSimulation:knownUnion.finalUniqueEntityAfterExpectedClassFilter,fullCandidateUnionCount:'UNKNOWN',fullLocalClassCount:'UNKNOWN',fullFinalUniqueEntity:'UNKNOWN',safeReasonCodes:['SIMULATION_ONLY','MISSING_LOOKUP_EVIDENCE_NOT_NEGATIVE','UNIQUE_SUBSET_DOES_NOT_PROVE_UNIQUE_SUPERSET']});
            }
        }
    } finally {db.close();}
    assert.equal(cases.length,15); assert.equal(groups.length,5);
    const after = dbSnapshot(); assert.deepEqual(after,before); assert.deepEqual(freezeHashes(),hashes);
    const result = {schemaVersion:1,audit:'P15R-E-B2-E',simulationOnly:true,groups,cases,summary:{paths:15,groups:5,inputFingerprints:new Set(baseline.paths.map(p=>p.inputFingerprint)).size,globalSpanMedian:median(groups.map(g=>g.sourceSpanCount)),globalSpanMax:Math.max(...groups.map(g=>g.sourceSpanCount)),eligibleMedian:median(groups.map(g=>g.eligibleSpanCount)),eligibleMax:Math.max(...groups.map(g=>g.eligibleSpanCount)),typedAttemptsMedian:median(groups.map(g=>g.typedAttempts)),typedAttemptsMax:Math.max(...groups.map(g=>g.typedAttempts)),eligiblePathSpanPairs:cases.reduce((n,c)=>n+c.eligibleSpanCount,0),unknownPathSpanPairs:cases.reduce((n,c)=>n+c.unknownSpanCount,0),expectedSpanSurvival:'15/15',expectedCandidateEvidenceCoverage:'15/15',expectedClassSurvivalUntruncatedUnion:'15/15',knownSubsetCandidateMedian:median(cases.map(c=>c.knownSubsetCandidateCount)),knownSubsetCandidateMax:Math.max(...cases.map(c=>c.knownSubsetCandidateCount)),knownSubsetLocalClassMedian:median(cases.map(c=>c.knownSubsetLocalClasses.length)),knownSubsetLocalClassMax:Math.max(...cases.map(c=>c.knownSubsetLocalClasses.length)),knownSubsetFinalUnique:'15/15',fullUnionFinalUnique:'UNKNOWN',sameTypePrimaryAmbiguity:'UNKNOWN'},proposedBounds:{mentions:40,entityTypes:6,candidatesPerType:10,candidatesPerMention:30,totalCandidates:120,mentionCodePoints:160,worstTypedAttempts:240,onOverflow:'INCOMPLETE_FAIL_CLOSED'},decision:{topKEscalation:'REJECTED',removeStage1:'INCONCLUSIVE',recommendedArchitecture:'BLOCKED',P15R_E_B2_F_READY:false},safety:{modelCalls:0,businessApiCalls:0,toolCalls:0,writes:0,before,after,databaseUnchanged:true,frozenHashesUnchanged:true}};
    const serialized = JSON.stringify(result);
    for (const value of sentinels) assert.ok(!serialized.includes(value),'DATASET_PRIVACY_SENTINEL');
    const reportPath = path.join(root,'docs/ai-governance/reports/V5-E4R-E-B2-E-model-free-span-discovery-audit.md');
    if (fs.existsSync(reportPath)) for (const value of sentinels) assert.ok(!fs.readFileSync(reportPath,'utf8').includes(value),'REPORT_PRIVACY_SENTINEL');
    return result;
}
if (require.main === module) console.log(JSON.stringify(audit(),null,2));
module.exports = {audit};
