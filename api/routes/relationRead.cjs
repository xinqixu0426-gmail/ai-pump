'use strict';
const express=require('express');
function createRelationReadRouter({db}){
 const router=express.Router(),service=require('../services/relationReadService.cjs').createRelationReadService({db});
 router.post('/read',(req,res)=>{
  try{res.json({success:true,data:service.read(req.body)});}
  catch(e){const known=/^RELATION_[A-Z_]+$/.test(e.code||'');res.status(known?e.statusCode:500).json({success:false,code:known?e.code:'RELATION_READ_FAILED',error:'关联读取未完成',requestId:req.requestId||null});}
 });return router;
}
module.exports={createRelationReadRouter};
