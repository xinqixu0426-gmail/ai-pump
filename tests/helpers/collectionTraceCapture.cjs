'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
module.exports=function capture(){
    const context=new AsyncLocalStorage(),spans=[];
    const tracer={startActiveSpan(name,options,fn){
        const parent=context.getStore(),span={id:String(spans.length+1),parentId:parent?.id||null,rootId:parent?.rootId||String(spans.length+1),name,attributes:{...options.attributes},
            setAttributes(v){Object.assign(this.attributes,v);},setStatus(){},updateName(n){this.name=n;},end(){this.ended=true;}};
        spans.push(span);return context.run(span,()=>fn(span));
    }};
    return {spans,phoenixModule:{register:()=>({getTracer:()=>tracer,forceFlush:async()=>{},shutdown:async()=>{}})}};
};
