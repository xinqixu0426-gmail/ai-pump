'use strict';

const { deepFreeze } = require('../sources.cjs');
const { sources } = require('./sources.cjs');
const { coilProfile } = require('./entities/coil.cjs');

const OntologyV2Version = 2;

const ontologyV2 = deepFreeze({
    version: OntologyV2Version,
    status: 'DRAFT_AWAITING_OWNER_REVIEW',
    runtimeEnabled: false,
    storesBusinessValues: false,
    isBusinessSourceOfTruth: false,
    access: 'CONTRACT_ONLY_NO_RUNTIME',
    sources,
    profiles: [coilProfile],
});

module.exports = { OntologyV2Version, ontologyV2 };
