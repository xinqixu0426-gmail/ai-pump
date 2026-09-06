'use strict';
const {acquireCandidateSet}=require('./candidateSet.cjs');
const ENTITY_TYPES=Object.freeze({orders:'order',customers:'customer',parts:'part',recipes:'recipe',coils:'coil'});
function createDetailTarget(resourceType,canonicalEntityRef,provenance){
    if(!ENTITY_TYPES[resourceType]||typeof canonicalEntityRef!=='string'||! /^[1-9][0-9]*$/.test(canonicalEntityRef)
        ||!Number.isSafeInteger(Number(canonicalEntityRef))||!['governed_entity_lookup','verified_current_page'].includes(provenance))throw Error('COLLECTION_TARGET_INVALID');
    return Object.freeze({resourceType,canonicalEntityRef,detailProjectionId:resourceType+'.detail.v1',provenance});
}
async function bindCollectionDetail(intent,options={}){
    const entityType=ENTITY_TYPES[intent.resourceType];
    if(intent.operation!=='detail'||!entityType||typeof intent.identity!=='string'||!intent.identity.length)throw Error('COLLECTION_TARGET_INVALID');
    const governed=await acquireCandidateSet(intent.identity,{...options,lookupTimeoutMs:options.lookupTimeoutMs||options.timeoutMs});
    return finalizeCollectionDetailTarget(intent.resourceType,governed);
}
function finalizeCollectionDetailTarget(resourceType,governed){
    const expectedType=ENTITY_TYPES[resourceType];
    if(!expectedType)throw Error('COLLECTION_TARGET_INVALID');
    // The complete governed set is retained; only frozen semantic resource authority narrows it.
    if(!governed||governed.complete!==true||!['RESOLVED','AMBIGUOUS','NOT_FOUND'].includes(governed.status)
        ||!Array.isArray(governed.candidates)||governed.candidateCount!==governed.candidates.length)throw Error('COLLECTION_TARGET_UNAVAILABLE');
    const matches=governed.candidates.filter(c=>c.entityType===expectedType);
    if(matches.length===0)throw Error('COLLECTION_TARGET_NOT_FOUND');
    if(matches.length!==1)throw Error('COLLECTION_TARGET_AMBIGUOUS');
    const [selected]=matches;
    return createDetailTarget(resourceType,selected.canonicalId,'governed_entity_lookup');
}
module.exports={bindCollectionDetail,createDetailTarget,finalizeCollectionDetailTarget,ENTITY_TYPES};
