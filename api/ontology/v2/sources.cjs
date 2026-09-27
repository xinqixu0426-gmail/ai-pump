'use strict';

const { deepFreeze } = require('../sources.cjs');

const SourceAuthority = deepFreeze({
    CANONICAL_CURRENT: 'CANONICAL_CURRENT',
    DERIVED: 'DERIVED',
    ESTIMATED_DERIVED: 'ESTIMATED_DERIVED',
    SAVED_SNAPSHOT: 'SAVED_SNAPSHOT',
    TEMPORARY_NON_AUTHORITATIVE: 'TEMPORARY_NON_AUTHORITATIVE',
    UNRESOLVED: 'UNRESOLVED',
});

// These are metadata addresses only. They do not read business rows or calculate values.
const sources = deepFreeze([
    {
        sourceId: 'coil.current_resource',
        authority: SourceAuthority.CANONICAL_CURRENT,
        sourceOfTruth: 'SQLite:coils through existing Business API coilRow DTO projection',
        readBoundary: 'EXISTING_BUSINESS_API_ONLY',
        storesValueInOntology: false,
    },
    {
        sourceId: 'stator_variant.current_resource',
        authority: SourceAuthority.CANONICAL_CURRENT,
        sourceOfTruth: 'SQLite:stator_variants through existing coilRow DTO',
        readBoundary: 'EXISTING_BUSINESS_API_ONLY',
        storesValueInOntology: false,
    },
    {
        sourceId: 'coil.current_cost_projection',
        authority: SourceAuthority.DERIVED,
        sourceOfTruth: 'Existing coilCost.calculateCoilCost current formal result; coils.cost is its maintained materialized current representation for exact formal schemes',
        readBoundary: 'EXISTING_BUSINESS_COST_AND_BOM_SERVICES_ONLY',
        storesValueInOntology: false,
    },
    {
        sourceId: 'coil.estimated_cost_result',
        authority: SourceAuthority.ESTIMATED_DERIVED,
        sourceOfTruth: 'Future estimate derived from formal Coil facts; never a formal Coil entity',
        readBoundary: 'NO_RUNTIME_READER_APPROVED',
        storesValueInOntology: false,
    },
    {
        sourceId: 'coil.common_designation',
        authority: SourceAuthority.DERIVED,
        sourceOfTruth: 'Declarative composition of coil.spec and coil.sheets',
        readBoundary: 'FUTURE_GENERIC_ONTOLOGY_CONSUMER',
        storesValueInOntology: false,
    },
]);

module.exports = { SourceAuthority, sources };
