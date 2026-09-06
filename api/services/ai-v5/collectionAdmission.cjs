'use strict';
const {RESOURCES}=require('../collectionReadContract.cjs');
const COLLECTION_READ_OPERATIONS=Object.freeze(['list','count','detail','continue','ordinal']);
function assertCollectionAdmission(risk,intent){
    if(risk?.contractValid!==true||risk.riskClass!=='READ_SAFE'||intent?.contractValid!==true
        ||!RESOURCES.includes(intent?.resourceType)||!COLLECTION_READ_OPERATIONS.includes(intent?.operation))throw Error('COLLECTION_ADMISSION_REJECTED');
    return true;
}
module.exports={COLLECTION_READ_OPERATIONS,assertCollectionAdmission};
