'use strict';
const {resolveEntityTypeIndependent}=require('./typeIndependentEntityResolver.cjs');
const ENTITY_TYPES=Object.freeze({orders:'order',customers:'customer',parts:'part',recipes:'recipe',coils:'coil'});
function createDetailTarget(resourceType,canonicalEntityRef,provenance){
    if(!ENTITY_TYPES[resourceType]||typeof canonicalEntityRef!=='string'||! /^[1-9][0-9]*$/.test(canonicalEntityRef)
        ||!Number.isSafeInteger(Number(canonicalEntityRef))||!['governed_entity_lookup','verified_current_page'].includes(provenance))throw Error('COLLECTION_TARGET_INVALID');
    return Object.freeze({resourceType,canonicalEntityRef,detailProjectionId:resourceType+'.detail.v1',provenance});
}
async function bindCollectionDetail(intent,options={}){
    const entityType=ENTITY_TYPES[intent.resourceType];
    if(intent.operation!=='detail'||!entityType||typeof intent.identity!=='string'||!intent.identity.length)throw Error('COLLECTION_TARGET_INVALID');
    const resolved=await resolveEntityTypeIndependent(intent.identity,options);
    if(resolved.status!=='RESOLVED'||resolved.complete!==true||resolved.resolvedEntityType!==entityType
        ||typeof resolved.canonicalIdentity!=='string'||! /^[1-9][0-9]*$/.test(resolved.canonicalIdentity)
        ||!Number.isSafeInteger(Number(resolved.canonicalIdentity)))throw Error('COLLECTION_TARGET_UNAVAILABLE');
    return createDetailTarget(intent.resourceType,resolved.canonicalIdentity,'governed_entity_lookup');
}
module.exports={bindCollectionDetail,createDetailTarget,ENTITY_TYPES};
