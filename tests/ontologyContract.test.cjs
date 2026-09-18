'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ontology, OntologyVersion, IdentityContract } = require('../api/ontology/contract.cjs');
const { validateOntology } = require('../api/ontology/validator.cjs');
const { RelationAuthority, EntitySources, RelationSources } = require('../api/ontology/sources.cjs');
const { RELATIONS } = require('../api/services/relationReadContract.cjs');
const { ENTITY_DESCRIPTORS } = require('../api/services/aiCapabilityGraphV3.cjs');
const { ENTITY_IDENTITY_SPECS } = require('../api/services/aiStableEntityIdentityV4.cjs');
const root = path.resolve(__dirname, '..');

test('ONT-P1: deterministic V1 counts separate relationship families from inverse directions', () => {
    assert.equal(OntologyVersion, 1);
    assert.deepEqual(validateOntology(ontology), {
        version: 1, entityCount: 7, relationFamilyCount: 6, directionalRelationDefinitionCount: 12,
        authorityAFamilies: 4, authorityBFamilies: 2, inversePairs: 6, runtimeEnabled: false,
    });
    assert.deepEqual(ontology.entities.map(e => e.type), ['customer', 'order', 'recipe', 'part', 'coil', 'template', 'quotation']);
    assert.equal(ontology.relations.filter(r => r.authority === RelationAuthority.CANONICAL_DIRECT).length, 8);
    assert.equal(ontology.relations.filter(r => r.authority === RelationAuthority.DETERMINISTIC_DERIVED).length, 4);
    const before = JSON.stringify(ontology);
    assert.deepEqual(validateOntology(structuredClone(ontology)), validateOntology(ontology));
    assert.equal(JSON.stringify(ontology), before);
});

test('ONT-P1: contract and source catalogs are deeply immutable and contain no reader functions', () => {
    function inspect(value) {
        assert.notEqual(typeof value, 'function');
        if (value && typeof value === 'object') {
            assert.equal(Object.isFrozen(value), true);
            Object.values(value).forEach(inspect);
        }
    }
    [ontology, IdentityContract, EntitySources, RelationSources, RelationAuthority].forEach(inspect);
    assert.throws(() => { ontology.entities[0].canonicalIdSource = 'model.text'; }, TypeError);
    assert.throws(() => { ontology.relations.push({}); }, TypeError);
});

test('ONT-P1: formal schema supplies every primary identity and every A FK', () => {
    const db = new (require('better-sqlite3'))(':memory:');
    require('../api/database/migrations.cjs').runMigrations(db);
    try {
        const before = db.serialize();
        for (const entity of ontology.entities) {
            const source = EntitySources[entity.type];
            assert.equal(db.pragma(`table_info(${source.table})`).find(c => c.name === 'id').pk, 1);
            assert.equal(entity.canonicalIdSource, `${source.table}.id`);
        }
        for (const source of Object.values(RelationSources)) {
            source.evidence.forEach(file => assert.ok(fs.existsSync(path.join(root, file)), file));
            if (source.authority === RelationAuthority.CANONICAL_DIRECT) {
                const [table, column] = source.physicalSource.split('.');
                assert.ok(db.pragma(`foreign_key_list(${table})`).some(fk => fk.from === column
                    && fk.table === EntitySources[source.toType].table && fk.to === 'id'));
            } else {
                const table = source.physicalSource.split('.')[0];
                const column = source.physicalSource.split('.')[1].replace('[]', '');
                assert.ok(db.pragma(`table_info(${table})`).some(c => c.name === column));
                assert.equal(source.sourceKind, 'SAVED_CANONICAL_ID');
            }
        }
        validateOntology(ontology);
        assert.deepEqual(db.serialize(), before);
    } finally { db.close(); }
});

test('ONT-P1: seventh entity is quotation, with explicit unsupported resolver rather than fabricated support', () => {
    const quotation = ontology.entities.find(e => e.type === 'quotation');
    assert.equal(quotation.canonicalIdSource, 'quotations.id');
    assert.equal(quotation.resolverSupport, 'NOT_SUPPORTED');
    assert.equal(quotation.stableIdentitySupport, 'FORMAL_DB_ID_ONLY');
    assert.equal(quotation.businessKeySource, 'NOT_AVAILABLE');
    for (const entity of ontology.entities.filter(e => e.type !== 'quotation')) {
        assert.ok(Object.hasOwn(ENTITY_DESCRIPTORS, entity.type));
        assert.ok(Object.hasOwn(ENTITY_IDENTITY_SPECS, entity.type));
    }
    const { createQuotationQueries } = require('../api/services/quotationQueries.cjs');
    const query = createQuotationQueries({
        listQuotations: () => [{ id: 3, customerId: 4, status: '报价中' }],
        listCustomers: () => [{ id: 4, name: '客户甲' }],
    });
    assert.equal(query.get(3).id, 3);
    assert.equal(query.get(3).customerName, '客户甲');
    assert.throws(() => query.get(999), { code: 'QUOTATION_NOT_FOUND' });
});

test('ONT-P1: existing relationRead mappings cover all seven IDs without equating lines or facts to entities', () => {
    assert.deepEqual(ontology.relationReadMapping.map(m => m.existingRelationId).sort(), Object.keys(RELATIONS).sort());
    const byId = new Map(ontology.relations.map(r => [r.relationId, r]));
    for (const mapping of ontology.relationReadMapping) {
        const existing = RELATIONS[mapping.existingRelationId];
        if (mapping.disposition === 'EXCLUDED') assert.equal(mapping.ontologyRelationId, null);
        else {
            assert.equal(mapping.disposition, 'ADAPTER_REQUIRED');
            const relation = byId.get(mapping.ontologyRelationId);
            assert.equal(relation.fromType, existing.root);
            assert.equal(relation.toType, existing.result);
        }
    }
    assert.equal(ontology.relationReadMapping.filter(m => m.disposition === 'ADAPTER_REQUIRED').length, 4);
    assert.equal(ontology.relationReadMapping.filter(m => m.disposition === 'EXCLUDED').length, 3);
});

test('ONT-P1: inverse pairs preserve exact physical authority and distinguish cardinalities', () => {
    for (const relation of ontology.relations) {
        const inverse = ontology.relations.find(r => r.relationId === relation.inverseRelationId);
        assert.equal(inverse.inverseRelationId, relation.relationId);
        assert.equal(inverse.fromType, relation.toType);
        assert.equal(inverse.toType, relation.fromType);
        assert.equal(inverse.physicalSource, relation.physicalSource);
        assert.equal(inverse.authority, relation.authority);
    }
});

const invalid = [
    ['unknown version', c => { c.version = 2; }],
    ['duplicate entity', c => c.entities.push({ ...c.entities[0] })],
    ['missing entity', c => c.entities.pop()],
    ['empty canonical source', c => { c.entities[0].canonicalIdSource = ''; }],
    ['generated identity', c => { c.entities[0].canonicalIdSource = 'LLM'; }],
    ['invented source of truth', c => { c.entities[0].sourceOfTruth = 'ontology'; }],
    ['fabricated quotation resolver', c => { c.entities[6].resolverSupport = 'EXISTING_V3_FORMAL_RESULT'; }],
    ['name-only identity', c => { c.identityContract.permitsNameOnlyIdentity = true; }],
    ['fuzzy identity', c => { c.identityContract.permitsFuzzyIdentity = true; }],
    ['identity creation', c => { c.identityContract.createsIdentity = true; }],
    ['duplicate relation', c => c.relations.push({ ...c.relations[0] })],
    ['missing relation', c => c.relations.pop()],
    ['unknown endpoint', c => { c.relations[0].toType = 'supplier'; }],
    ['self edge', c => { c.relations[0].toType = c.relations[0].fromType; }],
    ['missing source', c => { c.relations[0].sourceId = ''; }],
    ['caller SQL source', c => { c.relations[0].physicalSource = 'SELECT * FROM recipes'; }],
    ['fuzzy source', c => { c.relations[0].sourceOfTruth = 'fuzzy candidate'; }],
    ['history source', c => { c.relations[0].sourceOfTruth = 'assistant history'; }],
    ['runtime execution', c => { c.relations[0].runtimeEnabled = true; }],
    ['contract execution', c => { c.runtimeEnabled = true; }],
    ['write field', c => { c.relations[0].writeBehavior = 'update'; }],
    ['write strategy', c => { c.relations[0].readStrategy = 'UPDATE'; }],
    ['stored business values', c => { c.entities[0].records = [{ id: 1 }]; }],
    ['stored stock', c => { c.relations[0].stock = 10; }],
    ['second truth source', c => { c.isBusinessSourceOfTruth = true; }],
    ['lost inverse', c => { c.relations[0].inverseRelationId = 'missing.inverse'; }],
    ['one-sided inverse', c => { c.relations[1].inverseRelationId = c.relations[1].relationId; }],
    ['wrong inverse source', c => { c.relations[1].sourceId = 'recipe_coil'; }],
    ['wrong inverse direction', c => { c.relations[1].direction = 'FORWARD'; }],
    ['invalid cardinality', c => { c.relations[0].cardinality = 'FIRST_MATCH'; }],
    ['incorrect cardinality', c => { c.relations[0].cardinality = 'MANY'; }],
    ['relation ID drift', c => { c.relations[0].relationId = 'recipe.has_template'; }],
    ['stale snapshot semantics', c => { c.relations[8].currentVsSnapshotSemantics = 'CURRENT_CONFIGURATION'; }],
    ['silent incompleteness', c => { c.relations[0].completenessSemantics = 'ALL_COMPLETE'; }],
    ['unknown mapping', c => { c.relationReadMapping[0].ontologyRelationId = 'made.up'; }],
    ['candidate runtime', c => { c.transitionalCandidates[0].runtimeEnabled = true; }],
    ['candidate authority', c => { c.transitionalCandidates[0].authoritative = true; }],
    ['duplicate candidate', c => { c.transitionalCandidates[1].candidateId = c.transitionalCandidates[0].candidateId; }],
    ['unverified C promotion', c => { c.transitionalCandidates[0].evidenceStatus = 'CURRENT_CODE_VERIFIED'; }],
];
for (const type of ['inventory', 'stock', 'price', 'cost', 'readiness', 'purchase', 'supplier', 'stator_variant', 'technical_file']) {
    invalid.push([`unsupported V1 entity ${type}`, c => { c.entities[6].type = type; }]);
}
for (const authority of ['LEGACY_EXACT', 'SEMANTIC', 'INFERRED']) {
    invalid.push([`non-A/B authority ${authority}`, c => { c.relations[0].authority = authority; }]);
}
for (const [name, mutate] of invalid) {
    test(`ONT-P1 rejects ${name}`, () => {
        const contract = structuredClone(ontology);
        mutate(contract);
        assert.throws(() => validateOntology(contract), error => error.code?.startsWith('ONTOLOGY_'));
    });
}

test('ONT-P1/P3: only the authorized observer imports ontology; no tool/public exposure', () => {
    function scan(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (file !== path.join(root, 'api', 'ontology')) scan(file);
            } else if (entry.name.endsWith('.cjs')) {
                const text = fs.readFileSync(file, 'utf8');
                if (file === path.join(root, 'api', 'services', 'aiAssistantRuntime.cjs')) {
                    assert.match(text, /require\('\.\.\/ontology\/runtimeShadow\.cjs'\)\.observeShadow/);
                    assert.doesNotMatch(text, /ontology\/(?:resolver|contract)\.cjs/);
                } else assert.doesNotMatch(text, /require\s*\(\s*['"][^'"]*(?:\/ontology\/|ontology\/contract)/, file);
            }
        }
    }
    scan(path.join(root, 'api'));
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'api.cjs'), 'utf8'), /require\s*\([^\n]*(?:ontology|relationRead)/);
    for (const file of ['contract.cjs', 'sources.cjs', 'validator.cjs']) {
        const text = fs.readFileSync(path.join(root, 'api', 'ontology', file), 'utf8');
        assert.doesNotMatch(text, /require\s*\(\s*['"](?:[^'"]*(?:services|routes|db|sqlite|express)|node:fs)/, file);
    }
    const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
    assert.ok(AI_TOOLS.every(tool => !/ontology|relation_read|relations\.read/i.test(tool.function.name)));
});
