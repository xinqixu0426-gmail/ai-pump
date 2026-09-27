'use strict';

const { OntologyV2Version, ontologyV2 } = require('../v2/contract.cjs');
const { OntologyV21ContractRevision } = require('./catalogs.cjs');
const { liftV2Contract } = require('./liftV2.cjs');

const ontologyV21 = liftV2Contract(ontologyV2);

module.exports = { OntologyV21Version: OntologyV2Version, OntologyV21ContractRevision, ontologyV21 };
