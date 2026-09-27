'use strict';

const { deepFreeze } = require('../sources.cjs');
const { OntologyV21ContractRevision, ProvenancePurpose, roleCatalogV21 } = require('./catalogs.cjs');
const { emptyV21Capabilities } = require('./schema.cjs');

// V2 did not distinguish the new V2.1 provenance-purpose dimension. CURRENT_RESOURCE is
// the documented neutral lift value: authority and sourceKind retain the actual V2 semantics.
function liftV2Source(source) {
    return deepFreeze({
        ...source,
        provenancePurpose: ProvenancePurpose.CURRENT_RESOURCE,
    });
}

function liftV2Profile(profile) {
    return deepFreeze({
        ...profile,
        relationIds: [...emptyV21Capabilities.relationIds],
        derivedFactIds: [...emptyV21Capabilities.derivedFactIds],
        policyIds: [...emptyV21Capabilities.policyIds],
        technicalKnowledge: emptyV21Capabilities.technicalKnowledge,
    });
}

function liftV2Contract(contract) {
    return deepFreeze({
        ...contract,
        contractRevision: OntologyV21ContractRevision,
        sources: contract.sources.map(liftV2Source),
        roleCatalog: roleCatalogV21,
        profiles: contract.profiles.map(liftV2Profile),
        extensions: [],
        relations: [],
        policies: [],
        technicalKnowledgeTypes: [],
    });
}

module.exports = { liftV2Source, liftV2Profile, liftV2Contract };
