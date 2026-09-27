'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ontologyV2 } = require('../api/ontology/v2/contract.cjs');
const { validateOntologyV2 } = require('../api/ontology/v2/validator.cjs');
const { ontologyV21 } = require('../api/ontology/v2_1/contract.cjs');
const { validateOntologyV21 } = require('../api/ontology/v2_1/validator.cjs');
const { partProfile, pumpShellExtension } = require('../api/ontology/v2_1/entities/part.cjs');
const { templateSupportingProfile } = require('../api/ontology/v2_1/entities/template.cjs');
const {
    recipeProfile,
    recipeRelations,
    recipeTechnicalKnowledgeType,
    recipeTargetSemanticGaps,
    stainlessFactRef,
} = require('../api/ontology/v2_1/entities/recipe.cjs');

const fact = factId => recipeProfile.facts.find(item => item.factId === factId);

test('Recipe has a resource-owned canonical ID and a non-canonical, non-unique name designation', () => {
    assert.deepEqual(recipeProfile.identity.canonicalId, {
        sourceRef: { sourceId: 'recipe.current_resource', path: 'recipes.id -> recipeRow.id', status: 'RESOLVED' },
        kind: 'DB_POSITIVE_INTEGER_PRIMARY_KEY',
        unique: true,
    });
    assert.equal(recipeProfile.identity.canonicalIdentityFactId, null);
    assert.equal(recipeProfile.identity.permitsDesignationAsCanonicalId, false);
    assert.equal(recipeProfile.identity.permitsNameOnlyCanonicalId, false);
    const designation = recipeProfile.designations.find(item => item.designationId === 'recipe.nameDesignation');
    assert.equal(designation.canonicalIdentity, false);
    assert.equal(designation.unique, false);
    assert.equal(designation.collisionPolicy, 'REPORT');
    assert.equal(designation.directIdentityEvidence, false);
    assert.equal(fact('recipe.deletedAt').sourceRef.sourceId, 'recipe.current_resource');
    assert.match(fact('recipe.deletedAt').sourceRef.path, /recipes\.deleted_at/);
});

test('Recipe owns only the formal nullable Template and Coil canonical-ID relations', () => {
    assert.deepEqual(recipeProfile.relationIds, ['recipe.uses_template', 'recipe.uses_coil']);
    assert.deepEqual(recipeRelations.map(item => [item.relationId, item.sourceEntityType, item.target.entityType, item.target.canonicalEndpointRequired, item.cardinality]), [
        ['recipe.uses_template', 'recipe', 'template', true, 'ZERO_OR_ONE'],
        ['recipe.uses_coil', 'recipe', 'coil', true, 'ZERO_OR_ONE'],
    ]);
    assert.match(recipeRelations[0].sourceRef.path, /recipes\.template_id/);
    assert.match(recipeRelations[1].sourceRef.path, /recipes\.coil_id/);
    assert.equal(recipeRelations.some(item => /bearing/.test(item.relationId)), false);
});

test('current safe Recipe Functional Facts use Recipe-owned sources and pieceCount is derived from persisted coilSheets', () => {
    assert.deepEqual(fact('recipe.coilSheets').businessRoles, ['BOM_INPUT', 'INTERNAL_CALCULATION']);
    assert.equal(fact('recipe.coilSheets').sourceRef.sourceId, 'recipe.dto_projection');
    const pieceCount = fact('recipe.pieceCount');
    assert.equal(pieceCount.valueKind, 'DERIVED');
    assert.equal(pieceCount.authority, 'DERIVED');
    assert.equal(pieceCount.derivation.operation, 'COPY');
    assert.deepEqual(pieceCount.derivation.inputs, [{ scope: 'LOCAL', factId: 'recipe.coilSheets' }]);
    assert.equal(pieceCount.derivation.materialization, 'COMPUTE_ON_READ');
    assert.deepEqual(recipeProfile.derivedFactIds, ['recipe.pieceCount']);

    [
        'recipe.rotorDiameter', 'recipe.stackOffset', 'recipe.oilSealDiameter',
        'recipe.impellerBoreDiameter', 'recipe.impellerSpan', 'recipe.threadLength',
        'recipe.threadDiameter', 'recipe.barrelLength', 'recipe.bearingSpan', 'recipe.impellerThickness',
    ].forEach(factId => {
        assert.ok(fact(factId).businessRoles.includes('FUNCTIONAL_TECHNICAL'), factId);
        assert.equal(fact(factId).directIdentityEvidence, false, factId);
    });
    assert.equal(fact('recipe.barrelLength').sourceRef.sourceId, 'recipe.dto_projection');
    assert.match(fact('recipe.barrelLength').sourceRef.path, /custom_barrel_length/);
    assert.equal(fact('recipe.bearingSpan').sourceRef.sourceId, 'recipe.technical_data_projection');
    assert.equal(fact('recipe.impellerThickness').sourceRef.sourceId, 'recipe.impeller_thickness_current_projection');
});

test('stainless and non-stainless conditions use the real formal cross-entity Extension path', () => {
    assert.deepEqual(stainlessFactRef, {
        scope: 'RELATED',
        relationPath: ['recipe.uses_template', 'template.uses_shell_part'],
        factId: 'part.isStainless',
        targetExtensionId: 'part.pump_shell',
    });
    ['applicableWhen', 'requiredWhen'].forEach(key => {
        assert.deepEqual(fact('recipe.barrelLength')[key], { kind: 'FACT_EQUALS', factRef: stainlessFactRef, value: true });
        assert.deepEqual(fact('recipe.bearingSpan')[key], { kind: 'FACT_EQUALS', factRef: stainlessFactRef, value: false });
    });
    assert.doesNotThrow(() => validateOntologyV21(ontologyV21));
});

test('Technical Knowledge is generic Recipe-owned metadata and confirmed memo fields are not promoted to functional Facts', () => {
    assert.deepEqual(recipeProfile.technicalKnowledge, { collectionId: 'recipe.technical_knowledge' });
    assert.equal(recipeTechnicalKnowledgeType.ownerEntityType, 'recipe');
    assert.equal(recipeTechnicalKnowledgeType.allowsArbitraryKeys, true);
    assert.equal(recipeTechnicalKnowledgeType.searchable, true);
    assert.equal(recipeTechnicalKnowledgeType.aiReadable, true);
    assert.equal(recipeTechnicalKnowledgeType.defaultClassification, 'TECHNICAL_KNOWLEDGE');
    assert.equal(recipeTechnicalKnowledgeType.runtimeEnabled, false);
    assert.deepEqual(recipeTechnicalKnowledgeType.entrySchema.requiredFields, ['key', 'label', 'value']);
    [
        'recipe.rotorLength', 'recipe.shaftDiameter', 'recipe.impellerModel', 'recipe.impellerDiameter',
        'recipe.impellerBladeCount', 'recipe.power', 'recipe.voltage', 'recipe.current', 'recipe.frequency',
        'recipe.testReportNo', 'recipe.testDate', 'recipe.testSummary', 'recipe.customFields',
    ].forEach(factId => assert.equal(Boolean(fact(factId)), false, factId));
});

test('explicit target semantic gaps prevent historical fallbacks from becoming Recipe authority', () => {
    assert.deepEqual(recipeTargetSemanticGaps, [
        'RECIPE_OPEN_OFFSET_STORAGE_MISSING',
        'STAINLESS_BEARING_SPAN_DERIVATION_BLOCKED_BY_OPEN_OFFSET_STORAGE',
        'RECIPE_UPPER_BEARING_PART_ID_STORAGE_MISSING',
        'RECIPE_LOWER_BEARING_PART_ID_STORAGE_MISSING',
        'IMPELLER_THICKNESS_DUPLICATE_STORAGE',
    ]);
    const definition = JSON.stringify(recipeProfile);
    [
        'recipe.openOffset', 'recipe.uses_upper_bearing', 'recipe.uses_lower_bearing', '6202',
        'defaultUpperBearing', 'defaultLowerBearing', 'defaultBearingSpan', 'rotor_params_json',
        'modelVariant', 'openFactor', 'costEngine', 'knowledge_entries',
    ].forEach(term => assert.equal(definition.includes(term), false, term));
    assert.equal(fact('recipe.bearingSpan').valueKind || 'DIRECT', 'DIRECT');
    assert.equal(recipeProfile.facts.some(item => item.derivation?.operation === 'SUBTRACT'), false);
});

test('Recipe profile is runtime-isolated and leaves prior V2.1 entity declarations unchanged', () => {
    assert.deepEqual(validateOntologyV2(ontologyV2), {
        version: 2, sourceCount: 7, profileCount: 1, factCount: 28, designationCount: 1, runtimeEnabled: false,
    });
    assert.equal(ontologyV21.profiles.find(item => item.entityType === 'part'), partProfile);
    assert.equal(ontologyV21.profiles.find(item => item.entityType === 'template'), templateSupportingProfile);
    assert.equal(ontologyV21.extensions.find(item => item.extensionId === 'part.pump_shell'), pumpShellExtension);
    assert.deepEqual(validateOntologyV21(ontologyV21), {
        version: 2,
        contractRevision: '2.1',
        sourceCount: 19,
        profileCount: 4,
        extensionCount: 1,
        relationCount: 3,
        policyCount: 0,
        technicalKnowledgeTypeCount: 1,
        factCount: 56,
        derivedFactCount: 1,
        relationProjectionFactCount: 0,
        runtimeEnabled: false,
    });

    const content = fs.readFileSync(path.join(__dirname, '..', 'api', 'ontology', 'v2_1', 'entities', 'recipe.cjs'), 'utf8');
    [/\/db(?:\.cjs)?['"]\)/, /services\//, /costEngine/, /recipeBomEngine/, /routes\//, /tools\.cjs/].forEach(pattern => {
        assert.doesNotMatch(content, pattern);
    });
});
