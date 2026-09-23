#!/usr/bin/env python3
"""Validate the DESIGN package only, not the factory application's implementation.
Usage: python audit/verify_plan.py
Requires Python 3.10+ and jsonschema. It does not use the network or a production DB.
"""
from __future__ import annotations
import copy, hashlib, json, re, sqlite3, sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Any
from jsonschema import Draft202012Validator, FormatChecker
ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT/'contracts/contracts.schema.json').read_text(encoding='utf-8'))
DEFS=SCHEMA['$defs']
RESULTS: list[dict[str,Any]]=[]
def get(p):return json.loads((ROOT/p).read_text(encoding='utf-8'))
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def digest(x):return hashlib.sha256(canonical(x).encode('utf-8')).hexdigest()
def require(ok:bool,msg:str):
    if not ok:raise AssertionError(msg)
def schema_check(name,x):
    sch={'$schema':SCHEMA['$schema'],'$defs':DEFS,'$ref':'#/$defs/'+name}
    Draft202012Validator(sch,format_checker=FormatChecker()).validate(x)
def check(name:str,fn:Callable[[],Any],kind='DESIGN'):
    try:fn();RESULTS.append({'check':name,'scope':kind,'status':'PASS'})
    except Exception as e:RESULTS.append({'check':name,'scope':kind,'status':'FAIL','error':str(e)[:1400]})
def rejected(fn:Callable[[],Any]):
    try:fn()
    except (AssertionError,ValueError,TypeError,KeyError,IndexError,sqlite3.IntegrityError):return
    # jsonschema exceptions are not ValueError on all versions
    except Exception as e:
        if type(e).__name__=='ValidationError':return
        raise
    raise AssertionError('negative example was incorrectly accepted')
def mutate(x,fn):
    v=copy.deepcopy(x);fn(v);return v

def pointer(x,p):
    require(p=='' or p.startswith('/'),'invalid JSON Pointer')
    for seg in p.split('/')[1:]:
        key=seg.replace('~1','/').replace('~0','~')
        x=x[int(key)] if isinstance(x,list) else x[key]
    return x

def utf16_slice(text,start,end):
    raw=text.encode('utf-16-le');require(0<=start<end<=len(raw)//2,'span out of range')
    return raw[2*start:2*end].decode('utf-16-le')
def check_span(span,source):
    require(span['messageRef'] in source,'untrusted text source')
    require(utf16_slice(source[span['messageRef']],span['start'],span['end'])==span['text'],'span text mismatch')
def all_spans(x):
    if isinstance(x,dict):
        if set(['messageRef','start','end','text'])<=set(x):yield x
        for v in x.values():yield from all_spans(v)
    elif isinstance(x,list):
        for v in x:yield from all_spans(v)
def unique_map(rows,key):
    out={r[key]:r for r in rows};require(len(out)==len(rows),f'duplicate {key}');return out

def acyclic(graph):
    visiting=set();done=set()
    def visit(v):
        require(v in graph,f'unknown dependency {v}')
        require(v not in visiting,'dependency cycle')
        if v in done:return
        visiting.add(v)
        for w in graph[v]:visit(w)
        visiting.remove(v);done.add(v)
    for v in graph:visit(v)

def proposal_check(p,source):
    schema_check('TaskProposalV1',p)
    subjects=unique_map(p['subjects'],'subjectKey');goals=unique_map(p['goals'],'goalKey');scenarios=unique_map(p['scenarios'],'scenarioKey')
    require('base' not in scenarios,'base is server-reserved')
    for x in scenarios.values():require(x['baseSubjectKey'] in subjects,'unknown base subject')
    for g in goals.values():
        require(set(g['subjectKeys'])<=set(subjects),'goal missing subject')
        require(set(g['scenarioKeys'])<=set(scenarios),'goal missing scenario')
    acyclic({k:g['dependsOn'] for k,g in goals.items()})
    for sp in all_spans(p):check_span(sp,source)

def scenario_check(r):
    schema_check('ScenarioCompareResponseV1',r)
    require(r['recipe']['entityType']=='recipe','comparison has wrong entity type')
    rows=unique_map(r['scenarios'],'scenarioKey')
    require('base' in rows and rows['base']['role']=='BASE','base missing')
    require(sum(x['role']=='BASE' for x in rows.values())==1,'multiple bases')
    require(rows['base']['requestedOverrides']==rows['base']['appliedOverrides']=={},'base overridden')
    requested={x['scenarioKey']:x['overrides'] for x in r['normalizedInput']['scenarios']}
    require(set(requested)==set(rows)-{'base'},'input/output scenario mismatch')
    require(r['sourceVersionCount']>=len(r['sourceVersions']),'source count below list')
    if r['sourceVersionsComplete']:require(r['sourceVersionCount']==len(r['sourceVersions']),'incomplete versions mislabeled')
    seen=[]
    for k,x in rows.items():
        cost=x['cost'];require(x['configurationHash']==digest(x['configuration']),'config hash mismatch')
        if cost['complete']:require(cost['currentTotalCost'] is not None and not cost['missingParts'],'incomplete cost as complete')
        else:require(cost['currentTotalCost'] is None,'incomplete cost must be null')
        expected=requested.get(k,{})
        require(x['requestedOverrides']==expected,'requested override was dropped')
        not_applied={e['field'] for e in x['notApplied']}
        for field,val in expected.items():
            if field not in not_applied:
                require(field in x['appliedOverrides'] and x['appliedOverrides'][field]==val,'false override applied')
                # Fixture schema uses direct camelCase snapshots; real adapter needs explicit mapping tests.
                require(x['configuration'].get(field)==val,'configuration contradicts applied override')
        require(set(x['appliedOverrides'])<=set(expected),'unrequested applied override')
        require(not (set(x['inheritedFields'])&set(expected)),'override labeled inherited')
    for c in r['comparisons']:
        require(c['baseScenarioKey']=='base' and c['candidateScenarioKey'] in requested,'wrong comparison references')
        seen.append(c['candidateScenarioKey']);a=rows['base'];b=rows[c['candidateScenarioKey']]
        comparable=a['cost']['complete'] and b['cost']['complete'] and not b['notApplied']
        if comparable:
            require(c['status']=='COMPARABLE' and c['delta'] is not None,'missing comparable result')
            # Synthetic arithmetic consistency only; NOT an implementation of the factory cost formula.
            require(abs(c['delta']-(b['cost']['currentTotalCost']-a['cost']['currentTotalCost']))<1e-8,'synthetic delta inconsistent')
        else:require(c['status']!='COMPARABLE' and c['delta'] is None,'false comparable')
        for driver in c['drivers']:
            for p in driver['sourcePointers']:pointer(r,p)
    require(set(seen)==set(requested) and len(seen)==len(requested),'comparison missing or repeated')

TASK=get('examples/task-envelope.valid.json');PROPOSAL=get('examples/task-proposal.valid.json')
RECEIPTS={x['receiptId']:x for x in [get('examples/comparison-receipt.valid.json'),get('examples/identity-receipt.valid.json')]}
TRUSTED_IDS=frozenset(RECEIPTS) # Fixture-only trust root, never inferred from origin or a client-provided Boolean.
TEXT_SOURCES={'request:user:1':TASK['userGoal']}
def fact_check(f,task=TASK,receipts=RECEIPTS,trusted=TRUSTED_IDS):
    schema_check('FactRecordV1',f)
    rid=f['receiptId'];require(rid in trusted and rid in receipts,'receipt origin not trusted')
    r=receipts[rid];require(r['taskId']==task['taskId'],'foreign task receipt')
    require(f['planRevision']==r['planRevision']<=task['planRevision'],'wrong plan revision')
    require(f['sourceHash']==r['sourceHash']==digest(r['result']),'receipt source hash mismatch')
    require(pointer(r['result'],f['resultPointer'])==f['value'],'fact pointer/value mismatch')
    require(f['readSetId']==r['readSetId'],'fact read set mismatch')
    if f['key']['entityId'] is None and f['key']['entityType']!='global':
        require(f['evidenceState']=='VERIFIED_NEGATIVE' and f['complete'] and f['key']['qualifiers']['queryScopeHash'],'unscoped absence')
    if f['evidenceState']=='VERIFIED_NEGATIVE':require(f['complete'],'negative incomplete')
    require(f['sourceUpdatedAt'] is None or f['sourceUpdatedAt']<=f['observedAt'],'source version from future')

def subject_check(b):
    if b['resolution']=='UNIQUE':require(b['candidateSetComplete'] and len(b['candidates'])==1 and b['selected']==b['candidates'][0],'false unique identity')
    elif b['resolution']=='SELECTED':require(b['candidateSetComplete'] and b['selected'] in b['candidates'] and b['selectionBasis'] in ['USER_CHOICE','FORMAL_DEFAULT'],'selected without justified basis')
    else:require(b['selected'] is None,'unresolved identity selected')

def task_check(t):
    schema_check('TaskEnvelopeV2',t)
    require(len(canonical(t).encode())<=t['constraints']['maxTaskStateBytes'],'task payload too large')
    for k,lim in [('modelCalls','maxModelCalls'),('toolCalls','maxToolCalls'),('apiCalls','maxApiCalls'),('activeMs','maxActiveMs')]:
        require(t['budgetUsage'][k]<=t['constraints'][lim],'budget exceeded')
    subjects=unique_map(t['subjects'],'subjectKey');goals=unique_map(t['goals'],'goalKey');scenarios=unique_map(t['scenarios'],'scenarioKey');facts=unique_map(t['facts'],'factId');unique_map(t['steps'],'stepId')
    acyclic({k:g['dependsOn'] for k,g in goals.items()})
    for x in subjects.values():subject_check(x)
    for x in scenarios.values():require(x['baseSubjectKey'] in subjects,'scenario subject missing')
    for f in facts.values():fact_check(f,t)
    for g in goals.values():
        require(set(g['subjectKeys'])<=set(subjects),'missing subject')
        require(set(g['scenarioKeys'])<=set(scenarios),'missing scenario')
        require(set(g['factIds'])<=set(facts),'missing fact')
        if g['state']=='VERIFIED':
            require(bool(g['requirements']) and not g['blockers'],'verified without requirements or with blocker')
            for req in g['requirements']:
                if req['subjectKey'] is not None:
                    require(req['subjectKey'] in subjects and subjects[req['subjectKey']]['resolution'] in ['UNIQUE','SELECTED'], 'required subject unresolved')
                selected=subjects[req['subjectKey']]['selected'] if req['subjectKey'] else None
                def matches(f):
                    k=f['key'];return (req['temporalScope'] not in ['CURRENT','SCENARIO'] or f['planRevision']==t['planRevision']) and k['predicate']==req['predicate'] and k['scenarioKey']==req['scenarioKey'] and k['temporalScope']==req['temporalScope'] and (req['basis'] is None or k['qualifiers']['basis']==req['basis']) and (req['unit'] is None or k['qualifiers']['unit']==req['unit']) and (req['currency'] is None or k['qualifiers']['currency']==req['currency']) and (not req['requireComplete'] or f['complete']) and ((k['entityType']=='global' and k['entityId'] is None) if selected is None else (k['entityType']==selected['entityType'] and k['entityId']==selected['entityId']))
                require(any(matches(facts[fid]) for fid in g['factIds']),'goal requirement unmet')
    for step in t['steps']:
        require(set(step['goalKeys'])<=set(goals),'step goal missing')
        if t['constraints']['businessWritePolicy']=='FORBIDDEN':require(step['access']!='COMMAND','readonly task contains command')
        require(step['argsHash']==digest(step['arguments']),'step argsHash mismatch')
        for a in step['argumentSources']:
            pointer(step['arguments'],a['fieldPath'])
            if a['kind']=='USER_SPAN':require(a['span'] is not None,'missing source span');check_span(a['span'],TEXT_SOURCES)
            else:require(a['span'] is None,'nonspan source with span')
            if a['kind']=='FORMAL_RECEIPT':
                require(a['sourceRef'] in TRUSTED_IDS,'untrusted argument source')
                require(pointer(RECEIPTS[a['sourceRef']]['result'],a['pointer'])==pointer(step['arguments'],a['fieldPath']),'argument source mismatch')
    if t['state']=='SUCCEEDED':require(all(g['state']=='VERIFIED' for g in t['goals']),'false task success')

def resume_check(x):
    schema_check('TaskResumeRequestV1',x)
    require(len({a['questionId'] for a in x['answers']})==len(x['answers']),'duplicate question answer')
    for a in x['answers']:require((a['choiceId'] is not None) != (a['answerText'] is not None),'answer must have exactly one value')

def manifests_check():
    m=get('plan-manifest.json');stages=unique_map(m['stages'],'id');acyclic({k:x['dependsOn'] for k,x in stages.items()})
    require(m['startOnly']=='N0.1' and not m['implementationVerified'] and not m['productionAuthorized'],'wrong authorization claims')
    tickets=[t for s in stages.values() for t in s['tickets']];require(len(tickets)==18==len(set(tickets)),'ticket count incorrect')
    docs=(ROOT/'05-分阶段实施.md').read_text();heads=re.findall(r'^### (N\d\.\d)\s',docs,re.M)
    require(sorted(tickets)==sorted(heads),'ticket sections mismatch')
    for t in tickets:require(any((ROOT/'prompts').glob(t+'*.md')),'missing ticket prompt')
    for sl in m['releaseSlices'].values():require(set(sl)<=set(stages),'unknown release stage')
    routes=[(x['method'],x['path']) for x in m['newHttpPaths']];require(len(routes)==len(set(routes)),'duplicate new route')
    require(all(x['classification']=='PROPOSED_NEW' for x in m['newHttpPaths']),'new route mislabeled current')

def states_check():
    sm=get('contracts/state-machine.json');g=sm['transitions'];types=DEFS['TaskEnvelopeV2']['properties']['state']['enum']
    require(set(g)==set(types),'schema/state enum mismatch')
    reachable={sm['initial']}
    while True:
        add={v for u in reachable for v in g[u]};new=reachable|add
        if new==reachable:break
        reachable=new
    require(reachable==set(g),'unreachable states')
    require(all(not g[t] for t in sm['terminal']),'terminal resumes in place')
    require(set(sm['terminal'])=={'SUCCEEDED','PARTIAL','UNSUPPORTED','FAILED','CANCELLED'},'terminal set drift')
    for u,vs in g.items():require(set(vs)<=set(g),'unknown state transition')

def public_check(x):
    schema_check('TaskPublicViewV1',x)
    def keys(v):
        if isinstance(v,dict):
            for k,w in v.items():yield k;yield from keys(w)
        elif isinstance(v,list):
            for w in v:yield from keys(w)
    require(not set(keys(x))&{'ownerKey','leaseToken','confirmationToken','allowWrite','rawReceipt','executionContext'},'private field in public view')

EXAMPLES={'task-proposal':'TaskProposalV1','scenario-request':'ScenarioCompareRequestV1','scenario-response':'ScenarioCompareResponseV1','fact':'FactRecordV1','task-envelope':'TaskEnvelopeV2','task-start':'TaskStartRequestV1','task-resume':'TaskResumeRequestV1','task-cancel':'TaskCancelRequestV1','answer-draft':'AnswerDraftV1','comparison-receipt':'ExecutionReceiptV1','identity-receipt':'ExecutionReceiptV1','compare-tool-input':'CompareRecipeScenariosToolInputV1','task-acknowledgement':'TaskAcknowledgementV1','task-public':'TaskPublicViewV1','task-events':'TaskEventsPageV1','foreground-context':'ForegroundTaskContextV1'}
check('schema: draft structure',lambda:Draft202012Validator.check_schema(SCHEMA),'SCHEMA')
for fn,definition in EXAMPLES.items():check('example: '+fn,lambda fn=fn,d=definition:schema_check(d,get('examples/'+fn+'.valid.json')),'SCHEMA')
check('examples: every json assigned a schema',lambda:require(set(x.name for x in (ROOT/'examples').glob('*.json'))=={x+'.valid.json' for x in EXAMPLES},'unvalidated example'),'SCHEMA')
check('semantics: proposal references and original text',lambda:proposal_check(PROPOSAL,TEXT_SOURCES))
check('semantics: scenario consistency',lambda:scenario_check(get('examples/scenario-response.valid.json')))
check('semantics: task facts/requirements/arguments',lambda:task_check(TASK))
check('semantics: resume answer exclusivity',lambda:resume_check(get('examples/task-resume.valid.json')))
check('semantics: public projection',lambda:public_check(get('examples/task-public.valid.json')))
check('manifest: 18 tickets and prerequisites',manifests_check)
check('states: enum, reachability and terminality',states_check)
emoji={'messageRef':'emoji','start':2,'end':6,'text':'V550'}
check('spans: UTF-16 emoji case',lambda:check_span(emoji,{'emoji':'😀V550'}))
check('spans: reject code-point indexing',lambda:rejected(lambda:check_span({**emoji,'start':1,'end':5},{'emoji':'😀V550'})))
# Strict schema mutations.
neg_schema=[('model cannot set allowWrite','TaskProposalV1',PROPOSAL,lambda x:x.update(allowWrite=True)),('model cannot set canonical id','TaskProposalV1',PROPOSAL,lambda x:x['subjects'][0].update(canonicalId=101)),('reject numeric cableWire','ScenarioCompareRequestV1',get('examples/scenario-request.valid.json'),lambda x:x['scenarios'][0]['overrides'].update(cableWire=0.55)),('reject copper override','ScenarioCompareRequestV1',get('examples/scenario-request.valid.json'),lambda x:x['scenarios'][0]['overrides'].update(copperPrice=95)),('reject string boolean','ScenarioCompareRequestV1',get('examples/scenario-request.valid.json'),lambda x:x['scenarios'][0]['overrides'].update(hasCable='true')),('reject negative length','ScenarioCompareRequestV1',get('examples/scenario-request.valid.json'),lambda x:x['scenarios'][0]['overrides'].update(cableLength=-1)),('reject non-chat conversation id','TaskStartRequestV1',get('examples/task-start.valid.json'),lambda x:x.update(conversationId='101')),('reject foreground detached API','TaskStartRequestV1',get('examples/task-start.valid.json'),lambda x:x.update(executionMode='FOREGROUND')),('reject owner in start input','TaskStartRequestV1',get('examples/task-start.valid.json'),lambda x:x.update(ownerKey='somebody')),('reject approved in resume','TaskResumeRequestV1',get('examples/task-resume.valid.json'),lambda x:x.update(approved=True)),('reject private public payload','TaskPublicViewV1',get('examples/task-public.valid.json'),lambda x:x.update(confirmationToken='secret')),('reject readSet in FactKey','FactRecordV1',get('examples/fact.valid.json'),lambda x:x['key']['qualifiers'].update(readSetId='another'))]
for label,definition,example,fn in neg_schema:check('mutation: '+label,lambda d=definition,x=example,f=fn:rejected(lambda:schema_check(d,mutate(x,f))),'SCHEMA_NEGATIVE')
for label,fn in [('missing goal reference',lambda x:x['goals'][0]['subjectKeys'].append('missing')),('duplicate goal',lambda x:x['goals'].append(copy.deepcopy(x['goals'][0]))),('cyclic goal',lambda x:x['goals'][0]['dependsOn'].append('compare')),('model claims base scenario',lambda x:x['scenarios'][0].update(scenarioKey='base')),('span changed',lambda x:x['subjects'][0]['sources'][0].update(text='V750'))]:
 check('mutation: '+label,lambda f=fn:rejected(lambda:proposal_check(mutate(PROPOSAL,f),TEXT_SOURCES)))
r=get('examples/scenario-response.valid.json')
for label,fn in [('delta changed',lambda x:x['comparisons'][0].update(delta=999)),('override dropped',lambda x:x['scenarios'][1].update(requestedOverrides={})),('applied value changed',lambda x:x['scenarios'][1]['appliedOverrides'].update(cableLength=6)),('incomplete total remains numeric',lambda x:x['scenarios'][1]['cost'].update(complete=False)),('cost falsely complete',lambda x:x['scenarios'][1]['cost'].update(missingParts=['未定价物料'])),('not applied called comparable',lambda x:x['scenarios'][1]['notApplied'].append({'field':'cableLength','reasonCode':'UNSUPPORTED'})),('false source count',lambda x:x.update(sourceVersionCount=2))]:
 check('mutation: '+label,lambda f=fn:rejected(lambda:scenario_check(mutate(r,f))))
for label,fn in [('task false success',lambda x:x['goals'][0].update(state='PARTIAL')),('old plan current facts reused',lambda x:x.update(planRevision=2)),('wrong scenario fact',lambda x:x['facts'][2]['key'].update(scenarioKey='base')),('wrong entity fact',lambda x:x['facts'][2]['key'].update(entityId='202')),('wrong temporal scope',lambda x:x['facts'][2]['key'].update(temporalScope='SAVED')),('wrong amount fact',lambda x:x['facts'][2].update(value=999)),('wrong value pointer',lambda x:x['facts'][2].update(resultPointer='/data/scenarios/0/cost/currentTotalCost')),('missing required fact',lambda x:x['goals'][0]['factIds'].pop()),('same predicate wrong unit',lambda x:x['facts'][2]['key']['qualifiers'].update(unit='CNY/set')),('readonly command',lambda x:x['steps'][0].update(access='COMMAND')),('wrong argsHash',lambda x:x['steps'][0].update(argsHash='0'*64)),('excess model budget',lambda x:x['budgetUsage'].update(modelCalls=8)),('false identity uniqueness',lambda x:x['subjects'][0].update(candidateSetComplete=False)),('selected while unresolved',lambda x:x['subjects'][0].update(resolution='UNRESOLVED'))]:
 check('mutation: '+label,lambda f=fn:rejected(lambda:task_check(mutate(TASK,f))))
newid='99999999-9999-4999-8999-999999999999'
for label,receipts,trusted in [('forged receipt origin', {**RECEIPTS,newid:{**RECEIPTS[next(iter(RECEIPTS))],'receiptId':newid}},TRUSTED_IDS)]:
 check('mutation: '+label,lambda rc=receipts,tr=trusted:rejected(lambda:fact_check({**get('examples/fact.valid.json'),'receiptId':newid},receipts=rc,trusted=tr)))
check('mutation: both resume values',lambda:rejected(lambda:resume_check(mutate(get('examples/task-resume.valid.json'),lambda x:x['answers'][0].update(answerText='yes')))))
check('mutation: no resume values',lambda:rejected(lambda:resume_check(mutate(get('examples/task-resume.valid.json'),lambda x:x['answers'][0].update(choiceId=None)))))
# Storage layout reconstruction of the task DTO.
def storage_projection():
    t=TASK
    sp={'version':2,**{k:t[k] for k in ['answerOwner','userGoal','subjects','goals','scenarios','questions','approvalOperationIds']},'businessWritePolicy':t['constraints']['businessWritePolicy']}
    limits={k:v for k,v in t['constraints'].items() if k!='businessWritePolicy'}
    schema_check('TaskSpecStorageV2',sp);schema_check('TaskBudgetStorageV2',{'limits':limits,'usage':t['budgetUsage']})
    require('facts' not in sp and 'steps' not in sp,'duplicate stores')
check('storage: spec/budget split',storage_projection)
# SQL validation uses in-memory mock conversation parents only.
DB=sqlite3.connect(':memory:');DB.execute('PRAGMA foreign_keys=ON')
DB.executescript('CREATE TABLE ai_conversations(id INTEGER PRIMARY KEY); CREATE TABLE ai_conversation_messages(id INTEGER PRIMARY KEY,conversation_id INTEGER,role TEXT); INSERT INTO ai_conversations VALUES(1); INSERT INTO ai_conversation_messages VALUES(1,1,\'user\');')
check('ddl: create four tables',lambda:DB.executescript((ROOT/'contracts/task-storage.sql').read_text()),'DDL_MOCK')
def insert_task(key='task1',state='NEW',spec='{}',parent=1):
    return DB.execute('INSERT INTO ai_tasks(task_key,owner_key,conversation_id,user_message_id,schema_version,revision,plan_revision,state,execution_mode,input_hash,spec_json,budget_json,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(key,'owner1',parent,1,2,1,1,state,'DETACHED','a'*64,spec,'{}','2026-09-21T05:00:00Z','2026-09-21T05:00:00Z','2026-10-21T05:00:00Z'))
check('ddl: valid task insert',lambda:insert_task(),'DDL_MOCK')
check('ddl: unknown task state rejected',lambda:rejected(lambda:insert_task('badstate','DONE')),'DDL_MOCK')
check('ddl: invalid json rejected',lambda:rejected(lambda:insert_task('badjson',spec='{')),'DDL_MOCK')
check('ddl: foreign conversation rejected',lambda:rejected(lambda:insert_task('badforeign',parent=404)),'DDL_MOCK')
check('ddl: duplicate task key rejected',lambda:rejected(lambda:insert_task()),'DDL_MOCK')
check('ddl: partial lease rejected',lambda:rejected(lambda:DB.execute("UPDATE ai_tasks SET lease_owner='worker' WHERE id=1")),'DDL_MOCK')
def insert_evidence(key,kind='RECEIPT',receipt=None):
    return DB.execute('INSERT INTO ai_task_evidence(evidence_key,task_id,plan_revision,record_kind,receipt_key,fact_key_hash,payload_json,source_hash,observed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(key,1,1,kind,receipt,'b'*64 if kind=='FACT' else None,'{}','a'*64,'now','now','now'))
check('ddl: valid receipt',lambda:insert_evidence('receipt1'),'DDL_MOCK')
check('ddl: valid linked fact',lambda:insert_evidence('fact1','FACT','receipt1'),'DDL_MOCK')
check('ddl: missing receipt FK rejected',lambda:rejected(lambda:insert_evidence('factbad','FACT','missing')),'DDL_MOCK')
check('ddl: fact without receipt rejected',lambda:rejected(lambda:insert_evidence('factbad2','FACT')),'DDL_MOCK')
check('ddl: first event',lambda:DB.execute("INSERT INTO ai_task_events(task_id,seq,event_type,payload_json,created_at,updated_at) VALUES(1,1,'TASK_STATE','{}','now','now')"),'DDL_MOCK')
check('ddl: duplicate event sequence rejected',lambda:rejected(lambda:DB.execute("INSERT INTO ai_task_events(task_id,seq,event_type,payload_json,created_at,updated_at) VALUES(1,1,'TASK_STATE','{}','now','now')")),'DDL_MOCK')
check('ddl: step goal links column exists',lambda:require('goal_keys_json' in {r[1] for r in DB.execute('PRAGMA table_info(ai_task_steps)')},'missing persisted goals'),'DDL_MOCK')
check('ddl: FK integrity',lambda:require(not DB.execute('PRAGMA foreign_key_check').fetchall(),'FK violations'),'DDL_MOCK')
# Documentary completeness checks, not application behavior checks.
for name in ['README.md','01-总体计划.md','02-字段合同.md','03-能力复用与接口.md','04-持久化与状态机.md','05-分阶段实施.md','06-测试发布回滚.md','07-方案自审.md']:
    check('document: '+name,lambda n=name:require((ROOT/n).is_file() and len((ROOT/n).read_text())>80,'missing document'),'PACKAGE')
check('corpus: 24 declared case classes',lambda:require(set(re.findall(r'\| (NV\d\d) \|',(ROOT/'06-测试发布回滚.md').read_text()))=={f'NV{i:02d}' for i in range(1,25)},'corpus identifiers mismatch'),'PACKAGE')
check('dictionary: every definition documented',lambda:require(all('### '+n+'\n' in (ROOT/'02-字段合同.md').read_text() for n in DEFS),'schema dictionary missing definitions'),'PACKAGE')
check('sources: baseline and SHA formatting',lambda:require(get('audit/source-index.json')['commit']==get('plan-manifest.json')['baseCommit'] and all(x['gitBlobSha'] is None or re.fullmatch('[a-f0-9]{40}',x['gitBlobSha']) for x in get('audit/source-index.json')['files']),'source index malformed'),'PACKAGE')
report={'schemaVersion':1,'scope':'DESIGN_PACKAGE_ONLY','generatedAt':datetime.now(timezone.utc).isoformat(),'baseCommit':get('plan-manifest.json')['baseCommit'],'status':'PASS' if all(x['status']=='PASS' for x in RESULTS) else 'REWORK','checks':len(RESULTS),'passed':sum(x['status']=='PASS' for x in RESULTS),'failed':sum(x['status']=='FAIL' for x in RESULTS),'schemaDefinitions':len(DEFS),'positiveExampleFiles':len(EXAMPLES),'sqliteVersion':sqlite3.sqlite_version,'applicationTestsExecuted':False,'realProviderExecuted':False,'productionChanged':False,'limitations':['DDL tested with mock parent tables, not the real migration runner or safeUpdate implementation.','Semantic validators are design checks, not the factory production validator.','The cost values are synthetic; no actual cost engine was run.','Sources were read via GitHub connector; no full checkout was available in this sandbox.'],'results':RESULTS}
(ROOT/'audit/plan-audit-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:report[k] for k in ['status','checks','passed','failed','schemaDefinitions','positiveExampleFiles']},ensure_ascii=False))
for row in RESULTS:
    if row['status']=='FAIL':print(row['check'],row.get('error'))
sys.exit(0 if report['status']=='PASS' else 1)
