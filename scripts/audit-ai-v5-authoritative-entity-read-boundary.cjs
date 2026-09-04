'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATASET = path.join(
    ROOT,
    'docs/ai-governance/data/v5-e4r-authoritative-entity-read-boundary-audit.json'
);

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
const ontology = read('api/services/ai-v5/businessOntology.cjs');
const internalClient = read('api/routes/ai/internalApiClient.cjs');
const apiEntry = read('api.cjs');

assert(dataset.schemaVersion === 1, 'unexpected audit schema version');
assert(dataset.entities.length === 19, 'ontology inventory must contain 19 entity types');
assert(new Set(dataset.entities.map(item => item.entityType)).size === 19, 'entity types must be unique');
assert(dataset.currentAuthoritativeResolverTypes.length === 6, 'authoritative resolver inventory must contain six types');
assert(dataset.structuralNonLookupTypes.length === 3, 'structural non-lookup inventory must contain three types');
assert(dataset.unsupportedTypes.length === 10, 'unsupported inventory must contain ten types');
assert(dataset.recommendation.architecture === 'ADD_DEDICATED_READ_ONLY_ENTITY_LOOKUP_API', 'read architecture decision changed');
assert(dataset.recommendation.apiShape === 'BATCH', 'dedicated API must remain batch-shaped');
assert(dataset.recommendation.frozenPathCoverage === '15/15', 'frozen path coverage changed');
assert(dataset.recommendation.frozenSourceGroupCoverage === '5/5', 'frozen source-group coverage changed');
assert(dataset.safety.realModelCalls === 0, 'model calls are forbidden in the audit');
assert(dataset.safety.realBusinessApiCalls === 0, 'Business API calls are forbidden in the audit');
assert(dataset.safety.v5ToolCalls === 0, 'Tool calls are forbidden in the audit');
assert(dataset.safety.v5Writes === 0, 'writes are forbidden in the audit');

for (const entityType of dataset.currentAuthoritativeResolverTypes) {
    assert(
        ontology.includes(`entity('${entityType}'`) && ontology.includes("'V3_FORMAL_RESULT'"),
        `missing ontology authority evidence for ${entityType}`
    );
}

for (const mount of [
    "app.use('/api/parts'",
    "app.use('/api/recipes'",
    "app.use('/api/templates'",
    "app.use('/api/orders'",
    "app.use('/api/coils'",
    "app.use('/api/customers'",
]) {
    assert(apiEntry.includes(mount), `missing Business API route mount: ${mount}`);
}

assert(internalClient.includes("headers['x-internal-secret']"), 'internal authentication propagation missing');
assert(internalClient.includes("function getJson"), 'internal read transport missing');
assert(!internalClient.includes('entityLookup'), 'dedicated entity lookup must not exist during audit');

const forbiddenArtifactKeys = [
    'rawPrompt',
    'rawMention',
    'sourceSpanText',
    'candidateValue',
    'businessValue',
];
const serialized = JSON.stringify(dataset);
for (const key of forbiddenArtifactKeys) {
    assert(!serialized.includes(`\"${key}\"`), `unsafe audit artifact key present: ${key}`);
}

console.log('AUTHORITATIVE_ENTITY_READ_BOUNDARY_AUDIT_PASS entities=19 authoritative=6 structural=3 unsupported=10 recommendation=ADD_DEDICATED_READ_ONLY_ENTITY_LOOKUP_API');
