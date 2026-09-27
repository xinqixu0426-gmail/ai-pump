'use strict';

const { deepFreeze } = require('../sources.cjs');
const { sources } = require('./sources.cjs');
const { roleCatalog } = require('./roles.cjs');
const { coilProfile } = require('./entities/coil.cjs');

const OntologyV2Version = 2;

const ontologyV2 = deepFreeze({
    version: OntologyV2Version,
    status: 'REFERENCE_TEMPLATE_CONTRACT_OWNER_REVIEWED',
    runtimeEnabled: false,
    storesBusinessValues: false,
    isBusinessSourceOfTruth: false,
    access: 'CONTRACT_ONLY_NO_RUNTIME',
    sources,
    roleCatalog,
    profiles: [coilProfile],
});

module.exports = { OntologyV2Version, ontologyV2 };
