'use strict';
const express=require('express');
const {createCollectionReadService}=require('../services/collectionReadService.cjs');
function createCollectionReadRouter({db}){
    const router=express.Router(),service=createCollectionReadService({db});
    router.post('/read',(req,res)=>{
        try {res.json({success:true,data:service.read(req.body)});}
        catch(error){const known=/^COLLECTION_[A-Z_]+$/.test(error.code||'');
            res.status(known?400:500).json({success:false,code:known?error.code:'COLLECTION_READ_FAILED',error:'集合读取未完成',requestId:req.requestId||null});}
    });
    return router;
}
module.exports={createCollectionReadRouter};
