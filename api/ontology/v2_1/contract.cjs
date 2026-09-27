'use strict';

const { OntologyV2Version, ontologyV2 } = require('../v2/contract.cjs');
const { deepFreeze } = require('../sources.cjs');
const { OntologyV21ContractRevision } = require('./catalogs.cjs');
const { liftV2Contract } = require('./liftV2.cjs');
const { partSources, partProfile, pumpShellExtension } = require('./entities/part.cjs');
const { templateSources, templateSupportingProfile, templateUsesShellPartRelation } = require('./entities/template.cjs');

const liftedV2 = liftV2Contract(ontologyV2);

// This is declarative contract composition only. No profile is a runtime reader or registry.
const ontologyV21 = deepFreeze({
    ...liftedV2,
    sources: [...liftedV2.sources, ...partSources, ...templateSources],
    profiles: [...liftedV2.profiles, partProfile, templateSupportingProfile],
    extensions: [pumpShellExtension],
    relations: [templateUsesShellPartRelation],
});

module.exports = { OntologyV21Version: OntologyV2Version, OntologyV21ContractRevision, ontologyV21 };
