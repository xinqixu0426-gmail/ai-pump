'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ontology: ontologyV1 } = require('../api/ontology/contract.cjs');
const { ontologyV2 } = require('../api/ontology/v2/contract.cjs');
const { validateOntologyV2 } = require('../api/ontology/v2/validator.cjs');
const { coilSourceAudit } = require('../api/ontology/v2/entities/coilSourceAudit.cjs');

function cloneContract() {
    return structuredClone(ontologyV2);
}

function coilProfile(contract = ontologyV2) {
    return contract.profiles.find(profile => profile.entityType === 'coil');
}

function coilFact(factId, contract = ontologyV2) {
    return coilProfile(contract).facts.find(item => item.factId === factId);
}

test('Ontology V2 Coil profile validates without enabling runtime or storing business values', () => {
    const result = validateOntologyV2(ontologyV2);
    assert.deepEqual(result, {
        version: 2,
        sourceCount: 4,
        profileCount: 1,
        factCount: 28,
        designationCount: 1,
        runtimeEnabled: false,
    });
    assert.equal(ontologyV2.runtimeEnabled, false);
    assert.equal(ontologyV2.storesBusinessValues, false);
    assert.equal(coilProfile().selectionPolicy.runtimeEnabled, false);
});

test('12-120 is a collision-allowed searchable designation, never canonical identity', () => {
    const designation = coilProfile().designations.find(item => item.designationId === 'coil.commonDesignation');
    assert.deepEqual(designation.components, ['coil.spec', 'coil.sheets']);
    assert.deepEqual(designation.expression, {
        operation: 'JOIN',
        separator: '-',
        nullPolicy: 'UNAVAILABLE_IF_ANY_COMPONENT_MISSING',
    });
    assert.equal(['12', 120].join(designation.expression.separator), '12-120');
    assert.equal(designation.searchable, true);
    assert.equal(designation.unique, false);
    assert.equal(designation.collisionPolicy, 'ALLOWED');
    assert.equal(designation.directIdentityEvidence, false);
    assert.equal(designation.canonicalIdentity, false);
    assert.equal(coilProfile().identity.permitsDesignationAsCanonicalId, false);
});

test('canonical identity, searchable evidence and selection policy remain separate', () => {
    const profile = coilProfile();
    assert.equal(profile.identity.canonicalId.sourceRef.path, 'coils.id -> coilRow.id');
    assert.equal(profile.identity.canonicalId.unique, true);
    assert.equal(coilFact('coil.schemeCode').directIdentityEvidence, true);
    assert.equal(coilFact('coil.schemeCode').candidateSelectionEvidence, true);
    assert.equal(coilFact('coil.spec').directIdentityEvidence, false);
    assert.equal(coilFact('coil.spec').searchable, true);
    assert.equal(coilFact('coil.spec').candidateSelectionEvidence, true);
    assert.equal(coilFact('coil.mainWireData').searchable, true);
    assert.equal(coilFact('coil.mainWireData').candidateSelectionEvidence, false);
    assert.equal(profile.selectionPolicy.defaultMetadata.classification, 'SELECTION_POLICY');
    assert.equal(profile.selectionPolicy.defaultMetadata.identityEvidence, false);
    assert.equal(profile.selectionPolicy.defaultMetadata.technicalFact, false);
    assert.equal(profile.facts.some(item => item.sourceRef.path.includes('is_default')), false);
});

test('explicit conditions precede default and non-unique default states stay ambiguous', () => {
    const policy = coilProfile().selectionPolicy;
    assert.equal(policy.orderedRules[0], 'APPLY_ALL_EXPLICIT_CONDITIONS');
    assert.equal(policy.defaultMayOverrideExplicitConditions, false);
    assert.equal(policy.outcomes.uniqueAfterExplicitConditions, 'EXPLICIT_UNIQUE');
    assert.equal(policy.outcomes.oneDefaultAmongMultiple, 'DEFAULT_SELECTED');
    assert.equal(policy.outcomes.zeroDefaultsAmongMultiple, 'AMBIGUOUS');
    assert.equal(policy.outcomes.multipleDefaultsAmongMultiple, 'AMBIGUOUS');
});

test('fact dimensions are independent and unresolved cost is not presentation-safe', () => {
    const wireWeight = coilFact('coil.wireWeight');
    assert.equal(wireWeight.presentationGroup, 'PRIMARY');
    assert.equal(wireWeight.searchable, true);
    assert.equal(wireWeight.candidateSelectionEvidence, true);
    assert.equal(wireWeight.directIdentityEvidence, false);
    assert.equal(wireWeight.temporalSemantics, 'STABLE_DESIGN_VALUE');
    assert.equal(wireWeight.safeForDefaultSummary, true);

    const cost = coilFact('coil.cost');
    assert.equal(cost.authority, 'UNRESOLVED');
    assert.equal(cost.sourceRef.status, 'UNRESOLVED');
    assert.equal(cost.temporalSemantics, 'DYNAMIC_DERIVED_CURRENT_VALUE');
    assert.equal(cost.safeForDefaultSummary, false);
    assert.equal(Object.hasOwn(cost, 'formula'), false);
    assert.doesNotMatch(JSON.stringify(cost), /unitPrice.*sheets|wireWeight.*copperBase|calculate/i);
});

test('generic validator accepts a valid synthetic fact without validator changes', () => {
    const contract = cloneContract();
    coilProfile(contract).facts.push({
        factId: 'coil.syntheticReviewFact',
        label: '合成审核字段',
        dataType: 'STRING',
        unit: null,
        sourceRef: {
            sourceId: 'coil.current_resource',
            path: 'coils.synthetic_review_field -> futureDto.syntheticReviewFact',
            status: 'RESOLVED',
        },
        authority: 'CANONICAL_CURRENT',
        searchable: false,
        candidateSelectionEvidence: false,
        directIdentityEvidence: false,
        presentationGroup: 'OTHER',
        temporalSemantics: 'MUTABLE_CURRENT_VALUE',
        missingSemantics: 'NOT_RECORDED',
        safeForDefaultSummary: false,
    });
    const result = validateOntologyV2(contract);
    assert.equal(result.factCount, ontologyV2.profiles[0].facts.length + 1);
});

test('generic validator fails closed for unknown source and invalid fact/source metadata', () => {
    const unknownSource = cloneContract();
    coilFact('coil.spec', unknownSource).sourceRef.sourceId = 'unknown.source';
    assert.throws(
        () => validateOntologyV2(unknownSource),
        error => error.code === 'ONTOLOGY_V2_SOURCE_UNKNOWN'
    );

    const invalidFact = cloneContract();
    coilFact('coil.spec', invalidFact).searchable = 'yes';
    assert.throws(
        () => validateOntologyV2(invalidFact),
        error => error.code === 'ONTOLOGY_V2_FACT_METADATA_INVALID'
    );

    const invalidSource = cloneContract();
    invalidSource.sources[0].storesValueInOntology = true;
    assert.throws(
        () => validateOntologyV2(invalidSource),
        error => error.code === 'ONTOLOGY_V2_SOURCE_STORES_VALUE'
    );

    const mismatchedStatus = cloneContract();
    coilFact('coil.spec', mismatchedStatus).sourceRef.status = 'UNRESOLVED';
    assert.throws(
        () => validateOntologyV2(mismatchedStatus),
        error => error.code === 'ONTOLOGY_V2_SOURCE_STATUS_INVALID'
    );
});

test('Coil Source Audit covers all current formal fields and keeps discovery separate from acceptance', () => {
    const expectedFields = [
        'id', 'stator_variant_id', 'spec', 'material', 'slot_type', 'sheets',
        'scheme_code', 'scheme_name', 'scheme_status', 'is_default',
        'rated_voltage_v', 'rated_frequency_hz', 'market', 'scheme_family_code',
        'pricing_mode', 'kit_price', 'unit_price', 'wire_weight', 'copper_base',
        'coil_fee', 'rotor_fee', 'cost', 'default_wire_gauge', 'default_capacitor',
        'main_wire_gauge', 'main_wire_data', 'aux_wire_gauge', 'aux_wire_data',
        'stock', 'created_at', 'updated_at',
    ].map(field => `coils.${field}`);
    assert.equal(coilSourceAudit.discoveryIsAcceptance, false);
    assert.deepEqual(
        coilSourceAudit.fields.map(item => item.sourceField),
        expectedFields
    );
    assert.deepEqual(
        coilSourceAudit.fields.filter(item => item.sourceStatus === 'UNRESOLVED').map(item => item.sourceField),
        ['coils.cost']
    );
    assert.equal(
        coilSourceAudit.fields.find(item => item.sourceField === 'coils.default_wire_gauge').businessMeaning,
        '默认搭配电缆横截面积（mm²）'
    );
});

test('V2 only bridges the existing V1 coil relations and does not replace V1', () => {
    const bridge = coilProfile().relationBridge;
    assert.deepEqual(bridge.relationIds, ['recipe.uses_coil', 'coil.used_by_recipe']);
    assert.equal(bridge.implementation, 'REFERENCE_EXISTING_V1_ONLY');
    assert.equal(bridge.promotesRelationToIdentityEvidence, false);
    assert.ok(ontologyV1.relations.some(item => item.relationId === 'recipe.uses_coil'));
    assert.ok(ontologyV1.relations.some(item => item.relationId === 'coil.used_by_recipe'));
    assert.equal(ontologyV1.version, 1);
});
