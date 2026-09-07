'use strict';
const {contextCommand}=require('./collectionContextCommand.cjs');
// Called only inside the authenticated Candidate gate and conversation lease.
// Only a private store entry promoted from verified read evidence authorizes bypass.
function continuationControl(source,ctx,stateStore){
    const started=performance.now();
    try{
        const active=stateStore.peekCertified(ctx);
        if(!active)return null;
        const intent=contextCommand(source,active);
        if(intent?.operation!=='continue')return null;
        return {...intent,durationMs:performance.now()-started};
    }catch{return null;}
}
function ordinalDetailControl(source,ctx,stateStore){
    const started=performance.now();
    try{
        const active=stateStore.peekCertified(ctx);
        if(!active||active.query?.operation!=='list'||active.query?.relationRequest?.relation==='order.lines')return null;
        const intent=contextCommand(source,active);
        if(intent?.operation!=='ordinal'||!Array.isArray(active.rowIds)
            ||!active.rowIds[intent.ordinal-1])return null;
        return {...intent,durationMs:performance.now()-started};
    }catch{return null;}
}
module.exports={continuationControl,ordinalDetailControl};
