'use strict';
// Migrate existing deterministic fixture plans to the closed R3 model wire contract.
module.exports=p=>({version:1,routeRef:p.operation==='NONE'?'NOT_APPLICABLE':p.resourceType+'.'+p.operation,
    filterClass:p.status&&p.customerSpan?'ORDER_STATUS_CUSTOMER':p.status?'ORDER_STATUS':p.customerSpan?'ORDER_CUSTOMER':'NONE',
    status:p.status,customerSpanRef:p.customerSpan,detailSpanRef:p.identitySpan,topN:p.pageSize,confidence:'high'});
