'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ontologyV21, OntologyV21Version, OntologyV21ContractRevision } = require('../../../api/ontology/v2_1/index.cjs');

const root = path.resolve(__dirname, '../../..');
const BUSINESS_MODEL_PATH = 'planning/business-understanding/company-business-model-v1.md';
const POLICY_PATH = 'api/services/ai-assistant/domain-policy.md';
const POLICY_SOURCE_VERSION = 1;

function readUtf8(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }
function stableText(value) { return JSON.stringify(value, null, 2); }
function loadContextSources() {
    const businessModel = readUtf8(BUSINESS_MODEL_PATH);
    const domainPolicy = readUtf8(POLICY_PATH).trim();
    const ontologyText = [
        `Active ontology contract: v${OntologyV21Version}.${OntologyV21ContractRevision}`,
        'Serialized complete api/ontology/v2_1 active declarative contract; definitions only, no entity rows or database values.',
        stableText(ontologyV21),
    ].join('\n\n');
    return Object.freeze({ businessModel, domainPolicy, ontologyText, policyVersion: POLICY_SOURCE_VERSION,
        policySource: POLICY_PATH, businessModelSource: BUSINESS_MODEL_PATH,
        ontologySources: Object.freeze(['api/ontology/v2_1/index.cjs', 'api/ontology/v2_1/contract.cjs', 'api/ontology/v2_1/catalogs.cjs', 'api/ontology/v2_1/entities/coil.cjs', 'api/ontology/v2_1/entities/part.cjs', 'api/ontology/v2_1/entities/template.cjs', 'api/ontology/v2_1/entities/recipe.cjs', 'api/ontology/v2/contract.cjs', 'api/ontology/v2/entities/coil.cjs', 'api/ontology/v2/roles.cjs', 'api/ontology/v2/sources.cjs']) });
}

module.exports = { BUSINESS_MODEL_PATH, POLICY_PATH, POLICY_SOURCE_VERSION, loadContextSources };
