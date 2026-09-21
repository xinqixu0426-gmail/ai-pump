'use strict';
const express=require('express');
function createRelationReadRouter({db}){
 const router=express.Router(),service=require('../services/relationReadService.cjs').createRelationReadService({db});
 router.post('/read',(req,res)=>{
  try{res.json({success:true,data:service.read(req.body)});}
  catch(e){const known=/^RELATION_[A-Z_]+$/.test(e.code||'');res.status(known?e.statusCode:500).json({success:false,code:known?e.code:'RELATION_READ_FAILED',error:'关联读取未完成',requestId:req.requestId||null});}
 });
 const ontologyResolver=require('../ontology/resolver.cjs').createOntologyRelationResolver({db});
 router.post('/resolve',(req,res)=>{
  const result=ontologyResolver.resolveRelation(req.body);
  if(result.success===true)return res.json({success:true,data:result});
  const status=result.status==='ROOT_NOT_FOUND'||result.status==='RELATION_UNAVAILABLE'?404
   :result.status==='AMBIGUOUS_LEGACY_REFERENCE'?409
   :result.status==='TECHNICAL_FAILURE'?500:422;
  return res.status(status).json({success:false,code:result.code,error:'Ontology 关联读取未完成',details:result,requestId:req.requestId||null});
 });return router;
}
module.exports={createRelationReadRouter};
