'use strict';
const C=require('../relationReadContract.cjs');
function immutable(value){if(value&&typeof value==='object'){for(const v of Object.values(value))immutable(v);Object.freeze(value);}return value;}
const RESOURCES=Object.freeze({customer:'customers',order:'orders',part:'parts',recipe:'recipes'});
const CATALOG=Object.freeze(Object.entries(C.RELATIONS).map(([ref,c])=>Object.freeze({ref,root:c.root,result:c.result,semantics:c.semantics})));
const MAX_READ_STEPS=4;
function createPlan(query){
 const q=C.request(query),c=C.RELATIONS[q.relation];
 return immutable({version:1,investigationType:q.relation,query:q,maxReadSteps:MAX_READ_STEPS,
  stopCondition:'ALL_REQUIRED_VERIFIED_OR_FIRST_FAILURE',
  steps:[...(c.root?[{stepId:'root',tool:'read_collection',capability:'collection.read',dependsOn:[],
   expectedResource:RESOURCES[c.root],resultContract:'collection.detail.v1',binding:'GOVERNED_ROOT'}]:[]),
   {stepId:'relation',tool:'read_relation',capability:'relations.read',dependsOn:c.root?['root']:[],
    expectedResource:c.result,resultContract:'relation.result.v1',binding:c.root?'VERIFIED_ROOT_ID':'TYPED_COLLECTION_FILTER'}]});
}
function validatePlan(plan){
 let canonical;try{canonical=createPlan(plan.query);}catch{throw Error('INVESTIGATION_PLAN_INVALID');}
 if(JSON.stringify(plan)!==JSON.stringify(canonical)||plan.steps.length>MAX_READ_STEPS)throw Error('INVESTIGATION_PLAN_INVALID');
 return canonical;
}
module.exports={CATALOG,RESOURCES,MAX_READ_STEPS,createPlan,validatePlan};
