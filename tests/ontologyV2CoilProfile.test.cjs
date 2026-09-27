'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ontology: ontologyV1 } = require('../api/ontology/contract.cjs');
const { ontologyV2 } = require('../api/ontology/v2/contract.cjs');
const { validateOntologyV2 } = require('../api/ontology/v2/validator.cjs');
const { coilSourceAudit } = require('../api/ontology/v2/entities/coilSourceAudit.cjs');

function cloneContract() { return structuredClone(ontologyV2); }
function coilProfile(contract = ontologyV2) { return contract.profiles.find(profile => profile.entityType === 'coil'); }
function coilFact(factId, contract = ontologyV2) { return coilProfile(contract).facts.find(item => item.factId === factId); }

function syntheticSource(sourceId, inputSourceIds = [], options = {}) {
    return {
        sourceId,
        authority: options.authority || 'CANONICAL_CURRENT',
        sourceKind: options.sourceKind || (inputSourceIds.length ? 'FORMAL_PROJECTION' : 'RAW_CURRENT_RESOURCE'),
        inputSourceIds,
        sourceOfTruth: 'Synthetic source for generic dependency-graph validation only',
        readBoundary: 'TEST_ONLY_NO_RUNTIME',
        storesValueInOntology: false,
    };
}

function futureProfile() {
    return {
        entityType: 'future_part',
        status: 'SYNTHETIC_TEST_ONLY',
        identity: {
            canonicalId: { sourceRef: { sourceId: 'future_part.current_resource', path: 'future_parts.id', status: 'RESOLVED' }, kind: 'DB_POSITIVE_INTEGER_PRIMARY_KEY', unique: true },
            canonicalIdentityFactId: null,
            permitsDesignationAsCanonicalId: false,
            permitsNameOnlyCanonicalId: false,
        },
        facts: [{
            factId: 'future_part.accountCode', label: '账户编码', dataType: 'STRING', unit: null,
            sourceRef: { sourceId: 'future_part.current_resource', path: 'future_parts.account_code', status: 'RESOLVED' },
            authority: 'CANONICAL_CURRENT', searchable: true, candidateSelectionEvidence: false,
            directIdentityEvidence: true, presentationGroup: 'OTHER', temporalSemantics: 'STABLE_DESIGN_VALUE',
            missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: false, businessRoles: ['DISPLAY', 'DESCRIPTIVE'],
        }],
        designations: [{
            designationId: 'future_part.accountCode', label: '唯一业务编码', components: ['future_part.accountCode'],
            expression: { operation: 'IDENTITY', nullPolicy: 'UNAVAILABLE_IF_ANY_COMPONENT_MISSING' },
            sourceRef: { sourceId: 'future_part.current_resource', path: 'future_parts.account_code', status: 'RESOLVED' },
            searchable: true, unique: true, collisionPolicy: 'REJECT', directIdentityEvidence: true, canonicalIdentity: false,
        }],
        selectionPolicy: { policyType: 'NONE', runtimeEnabled: false },
        eligibilityPolicy: { policyType: 'NONE', runtimeEnabled: false },
        costingPolicy: null,
        relationBridge: null,
    };
}

function addFutureEntity(contract) {
    contract.sources.push({
        sourceId: 'future_part.current_resource',
        authority: 'CANONICAL_CURRENT',
        sourceKind: 'RAW_CURRENT_RESOURCE',
        inputSourceIds: [],
        sourceOfTruth: 'Synthetic existing business resource for template validation only',
        readBoundary: 'TEST_ONLY_NO_RUNTIME',
        storesValueInOntology: false,
    });
    contract.profiles.push(futureProfile());
}

test('Ontology V2 Coil profile validates without runtime or stored business values', () => {
    assert.deepEqual(validateOntologyV2(ontologyV2), {
        version: 2, sourceCount: 7, profileCount: 1, factCount: 28, designationCount: 1, runtimeEnabled: false,
    });
    assert.equal(ontologyV2.runtimeEnabled, false);
    assert.equal(coilProfile().status, 'OWNER_REVIEWED_REFERENCE_PROFILE');
    assert.equal(coilProfile().selectionPolicy.runtimeEnabled, false);
    assert.equal(coilProfile().eligibilityPolicy.runtimeEnabled, false);
    assert.equal(coilProfile().costingPolicy.runtimeEnabled, false);
});

test('generic validator accepts a future profile without default selection or relation bridge', () => {
    const contract = cloneContract();
    addFutureEntity(contract);
    const result = validateOntologyV2(contract);
    assert.equal(result.profileCount, 2);
    assert.equal(result.factCount, 29);
});

test('generic validator accepts a valid unique designation without imposing Coil collision semantics', () => {
    const contract = cloneContract();
    addFutureEntity(contract);
    assert.doesNotThrow(() => validateOntologyV2(contract));
});

test('generic validator fails closed for unsafe designation combinations', () => {
    const duplicateAllowed = cloneContract();
    const synthetic = futureProfile();
    synthetic.designations[0].collisionPolicy = 'ALLOWED';
    duplicateAllowed.sources.push({
        sourceId: 'future_part.current_resource', authority: 'CANONICAL_CURRENT', sourceKind: 'RAW_CURRENT_RESOURCE', inputSourceIds: [],
        sourceOfTruth: 'Synthetic existing business resource for template validation only', readBoundary: 'TEST_ONLY_NO_RUNTIME', storesValueInOntology: false,
    });
    duplicateAllowed.profiles.push(synthetic);
    assert.throws(() => validateOntologyV2(duplicateAllowed), error => error.code === 'ONTOLOGY_V2_DESIGNATION_IDENTITY_INVALID');

    const unsafeCanonical = cloneContract();
    const second = futureProfile();
    second.designations[0].canonicalIdentity = true;
    unsafeCanonical.sources.push({
        sourceId: 'future_part.current_resource', authority: 'CANONICAL_CURRENT', sourceKind: 'RAW_CURRENT_RESOURCE', inputSourceIds: [],
        sourceOfTruth: 'Synthetic existing business resource for template validation only', readBoundary: 'TEST_ONLY_NO_RUNTIME', storesValueInOntology: false,
    });
    unsafeCanonical.profiles.push(second);
    assert.throws(() => validateOntologyV2(unsafeCanonical), error => error.code === 'ONTOLOGY_V2_DESIGNATION_CANONICAL_IDENTITY_FORBIDDEN');
});

test('direct designation evidence remains distinct from the formal resource canonical identity', () => {
    const contract = cloneContract();
    addFutureEntity(contract);
    const profile = contract.profiles.find(item => item.entityType === 'future_part');
    assert.equal(profile.designations[0].unique, true);
    assert.equal(profile.designations[0].collisionPolicy, 'REJECT');
    assert.equal(profile.designations[0].directIdentityEvidence, true);
    assert.equal(profile.designations[0].canonicalIdentity, false);
    assert.equal(profile.identity.canonicalId.sourceRef.path, 'future_parts.id');
    assert.equal(profile.identity.canonicalIdentityFactId, null);
    assert.doesNotThrow(() => validateOntologyV2(contract));
});

test('12-120 remains a collision-allowed searchable common designation, never canonical identity', () => {
    const designation = coilProfile().designations[0];
    assert.deepEqual(designation.components, ['coil.spec', 'coil.sheets']);
    assert.equal(['12', 120].join(designation.expression.separator), '12-120');
    assert.equal(designation.searchable, true);
    assert.equal(designation.unique, false);
    assert.equal(designation.collisionPolicy, 'ALLOWED');
    assert.equal(designation.canonicalIdentity, false);
});

test('Coil distinguishes existing local default marker from unresolved final-candidate AI fallback', () => {
    const profile = coilProfile();
    assert.equal(profile.selectionPolicy.policyType, 'EXPLICIT_THEN_DEFAULT');
    assert.equal(profile.selectionPolicy.defaultMayOverrideExplicitConditions, false);
    assert.equal(profile.selectionPolicy.defaultMetadata.classification, 'SELECTION_POLICY');
    assert.equal(profile.selectionPolicy.defaultMetadata.identityEvidence, false);
    assert.deepEqual(profile.selectionPolicy.defaultMetadata.existingMarkers, [{
        markerType: 'EXISTING_LOCAL_DEFAULT_MARKER',
        sourceRef: { sourceId: 'coil.current_resource', path: 'coils.is_default -> coilRow.isDefault', status: 'RESOLVED' },
        semanticScope: 'official coils sharing stator_variant_id + sheets',
    }]);
    assert.equal(profile.selectionPolicy.defaultMetadata.fallbackResolver.resolverType, 'FINAL_CANDIDATE_FALLBACK_DEFAULT');
    assert.equal(profile.selectionPolicy.defaultMetadata.fallbackResolver.sourceRef.sourceId, 'coil.ai_fallback_default');
    assert.equal(profile.selectionPolicy.defaultMetadata.fallbackResolver.sourceRef.status, 'UNRESOLVED');
    assert.equal(ontologyV2.sources.find(source => source.sourceId === 'coil.ai_fallback_default').authority, 'UNRESOLVED');
    assert.equal(profile.selectionPolicy.outcomes.multipleDefaultsAmongMultiple, 'AMBIGUOUS');
    assert.equal(profile.eligibilityPolicy.policyType, 'LIFECYCLE_STATUS');
    assert.deepEqual(profile.eligibilityPolicy.ordinaryEligibleValues, ['official']);
    assert.deepEqual(profile.eligibilityPolicy.explicitOptInValues, ['testing']);
    assert.deepEqual(profile.eligibilityPolicy.historicalOnlyValues, ['disabled']);
    assert.equal(profile.costingPolicy.policyType, 'VALUE_ROUTED_COSTING');
    assert.deepEqual(profile.costingPolicy.values.map(item => item.value), ['calculated', 'kit']);
    assert.equal(profile.facts.some(item => item.factId === 'coil.pricingMode'), false);
    assert.notEqual(profile.selectionPolicy.defaultMetadata.existingMarkers[0].sourceRef.path, coilFact('coil.defaultCapacitor').sourceRef.path);
});

test('only normal Owner discriminators participate in Coil selection', () => {
    const selection = coilProfile().selectionPolicy.explicitConditionFactIds;
    assert.deepEqual(selection, [
        'coil.schemeCode', 'coil.spec', 'coil.sheets', 'coil.material', 'coil.slotType', 'coil.ratedVoltageV', 'coil.ratedFrequencyHz',
    ]);
    ['coil.market', 'coil.schemeFamilyCode', 'coil.wireWeight', 'coil.defaultCapacitor', 'coil.defaultCableCrossSection', 'coil.kitPrice', 'coil.unitPrice', 'coil.copperBase', 'coil.coilFee', 'coil.rotorFee', 'coil.stock', 'coil.schemeStatus']
        .forEach(factId => assert.equal(coilFact(factId).candidateSelectionEvidence, false, factId));
});

test('scheme code is direct lookup only; scheme name remains human-readable display', () => {
    const code = coilFact('coil.schemeCode');
    const name = coilFact('coil.schemeName');
    assert.equal(code.searchable, true);
    assert.equal(code.directIdentityEvidence, true);
    assert.equal(code.safeForDefaultSummary, false);
    assert.equal(name.searchable, true);
    assert.equal(name.candidateSelectionEvidence, false);
    assert.ok(name.businessRoles.includes('DISPLAY'));
});

test('fact roles remain orthogonal to presentation and selection', () => {
    const wireWeight = coilFact('coil.wireWeight');
    const capacitor = coilFact('coil.defaultCapacitor');
    const cable = coilFact('coil.defaultCableCrossSection');
    const market = coilFact('coil.market');
    assert.deepEqual(wireWeight.businessRoles, ['COST_INPUT']);
    assert.equal(wireWeight.presentationGroup, 'PRIMARY');
    assert.equal(wireWeight.candidateSelectionEvidence, false);
    assert.deepEqual(capacitor.businessRoles, ['BOM_INPUT']);
    assert.equal(capacitor.presentationGroup, 'PRIMARY');
    assert.equal(capacitor.candidateSelectionEvidence, false);
    assert.deepEqual(cable.businessRoles, ['BOM_INPUT']);
    assert.equal(cable.candidateSelectionEvidence, false);
    assert.deepEqual(market.businessRoles, ['DESCRIPTIVE']);
    assert.equal(market.searchable, true);
    assert.equal(market.candidateSelectionEvidence, false);
    assert.equal(market.safeForDefaultSummary, false);
});

test('technical, cost-input and stock facts retain their intended independent roles', () => {
    ['coil.mainWireGauge', 'coil.mainWireData', 'coil.auxWireGauge', 'coil.auxWireData'].forEach(factId => {
        const item = coilFact(factId);
        assert.equal(item.presentationGroup, 'TECHNICAL');
        assert.deepEqual(item.businessRoles, ['TECHNICAL']);
        assert.equal(item.candidateSelectionEvidence, false);
    });
    ['coil.unitPrice', 'coil.kitPrice', 'coil.copperBase', 'coil.coilFee', 'coil.rotorFee'].forEach(factId => {
        const item = coilFact(factId);
        assert.ok(item.businessRoles.includes('COST_INPUT'));
        assert.equal(item.candidateSelectionEvidence, false);
        assert.equal(item.safeForDefaultSummary, false);
    });
    const stock = coilFact('coil.stock');
    assert.equal(stock.dataType, 'INTEGER');
    assert.equal(stock.unit, 'set');
    assert.deepEqual(stock.businessRoles, ['CURRENT_BUSINESS']);
    assert.equal(stock.candidateSelectionEvidence, false);
});

test('slot type provenance reflects the current DTO projection rather than a false one-column source', () => {
    assert.equal(
        coilFact('coil.slotType').sourceRef.path,
        'coilRow.slotType = stator_variants.slot_type || coils.slot_type || "小眼"'
    );
    assert.equal(coilFact('coil.slotType').sourceRef.sourceId, 'coil.dto_projection');
    assert.equal(coilFact('coil.diameterMm').sourceRef.sourceId, 'coil.dto_projection');
    assert.equal(ontologyV2.sources.find(source => source.sourceId === 'coil.dto_projection').sourceKind, 'FORMAL_PROJECTION');
    assert.equal(
        coilFact('coil.diameterMm').sourceRef.path,
        'coilRow.diameterMm = stator_variants.diameter_mm || (coils.spec === "12" ? 120 : Number(coils.spec) || 0)'
    );
});

test('DTO source audit includes derived, redundant and technical projection surfaces', () => {
    const byField = new Map(coilSourceAudit.fields.map(item => [item.sourceField, item]));
    assert.equal(byField.get('coilRow.slotType').classification, 'ACCEPTED_FACT');
    assert.equal(byField.get('coilRow.diameterMm').classification, 'DERIVED_FACT');
    assert.equal(byField.get('coilRow.commonName').classification, 'REDUNDANT_PROJECTION');
    assert.equal(byField.get('coilRow.statorVariantId').classification, 'TECHNICAL_METADATA');
    assert.equal(byField.get('ontology.aiFallbackDefault').sourceStatus, 'UNRESOLVED');
    assert.equal(coilSourceAudit.discoveryIsAcceptance, false);
});

test('generic source dependency graph accepts valid chains, fan-in, fan-out, and unresolved boundaries', () => {
    const contract = cloneContract();
    contract.sources.push(
        syntheticSource('graph.raw_a'),
        syntheticSource('graph.raw_b'),
        syntheticSource('graph.projection', ['graph.raw_a', 'graph.raw_b']),
        syntheticSource('graph.derived_a', ['graph.projection']),
        syntheticSource('graph.derived_b', ['graph.projection']),
        syntheticSource('graph.unresolved', ['graph.derived_a'], {
            authority: 'UNRESOLVED', sourceKind: 'UNRESOLVED_SEMANTIC_GAP',
        })
    );
    assert.doesNotThrow(() => validateOntologyV2(contract));
});

test('generic source dependency graph rejects direct and indirect cycles', () => {
    const direct = cloneContract();
    direct.sources.find(source => source.sourceId === 'coil.current_resource').inputSourceIds = ['coil.current_resource'];
    assert.throws(() => validateOntologyV2(direct), error => error.code === 'ONTOLOGY_V2_SOURCE_CYCLE');

    const twoNode = cloneContract();
    twoNode.sources.push(syntheticSource('graph.a', ['graph.b']), syntheticSource('graph.b', ['graph.a']));
    assert.throws(() => validateOntologyV2(twoNode), error => error.code === 'ONTOLOGY_V2_SOURCE_CYCLE');

    const threeNode = cloneContract();
    threeNode.sources.push(
        syntheticSource('graph.a', ['graph.b']),
        syntheticSource('graph.b', ['graph.c']),
        syntheticSource('graph.c', ['graph.a'])
    );
    assert.throws(() => validateOntologyV2(threeNode), error => error.code === 'ONTOLOGY_V2_SOURCE_CYCLE');
});

test('current and estimated-derived cost provenance are distinct and ontology contains no arithmetic', () => {
    const cost = coilFact('coil.cost');
    assert.equal(cost.authority, 'DERIVED');
    assert.equal(cost.sourceRef.sourceId, 'coil.current_cost_projection');
    assert.equal(cost.safeForDefaultSummary, true);
    assert.ok(ontologyV2.sources.some(item => item.authority === 'ESTIMATED_DERIVED'));
    assert.doesNotMatch(JSON.stringify(ontologyV2), /unitPrice\s*\*|wireWeight\s*\*|calculateStoredCoilCost/);

    const contract = cloneContract();
    coilProfile(contract).facts.push({
        factId: 'coil.syntheticEstimate', label: '合成估算', dataType: 'NUMBER', unit: 'CNY/set',
        sourceRef: { sourceId: 'coil.estimated_cost_result', path: 'future estimate receipt', status: 'RESOLVED' },
        authority: 'ESTIMATED_DERIVED', searchable: false, candidateSelectionEvidence: false,
        directIdentityEvidence: false, presentationGroup: 'OTHER', temporalSemantics: 'DYNAMIC_DERIVED_CURRENT_VALUE',
        missingSemantics: 'ESTIMATE_UNAVAILABLE', safeForDefaultSummary: false, businessRoles: ['ESTIMATE'],
    });
    assert.doesNotThrow(() => validateOntologyV2(contract));
});

test('declared Role Catalog prevents typos and permits a new role without validator source changes', () => {
    const unknownRole = cloneContract();
    coilFact('coil.spec', unknownRole).businessRoles = ['COST_INPT'];
    assert.throws(() => validateOntologyV2(unknownRole), error => error.code === 'ONTOLOGY_V2_FACT_ROLE_UNKNOWN');

    const extendedCatalog = cloneContract();
    extendedCatalog.roleCatalog.push({ roleId: 'SYNTHETIC_ROLE', label: '合成角色', description: '只用于验证声明式角色扩展。' });
    coilProfile(extendedCatalog).facts.push({
        factId: 'coil.syntheticRoleFact', label: '合成角色字段', dataType: 'STRING', unit: null,
        sourceRef: { sourceId: 'coil.current_resource', path: 'coils.synthetic_role_field', status: 'RESOLVED' },
        authority: 'CANONICAL_CURRENT', searchable: false, candidateSelectionEvidence: false,
        directIdentityEvidence: false, presentationGroup: 'OTHER', temporalSemantics: 'MUTABLE_CURRENT_VALUE',
        missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: false, businessRoles: ['SYNTHETIC_ROLE'],
    });
    assert.equal(validateOntologyV2(extendedCatalog).factCount, 29);
});

test('generic validator accepts ordinary facts and generic source declarations without source changes', () => {
    const contract = cloneContract();
    coilProfile(contract).facts.push({
        factId: 'coil.syntheticReviewFact', label: '合成审核字段', dataType: 'STRING', unit: null,
        sourceRef: { sourceId: 'coil.current_resource', path: 'coils.synthetic_review_field', status: 'RESOLVED' },
        authority: 'CANONICAL_CURRENT', searchable: false, candidateSelectionEvidence: false,
        directIdentityEvidence: false, presentationGroup: 'OTHER', temporalSemantics: 'MUTABLE_CURRENT_VALUE',
        missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: false, businessRoles: ['DESCRIPTIVE'],
    });
    assert.equal(validateOntologyV2(contract).factCount, 29);

    const invalidSource = cloneContract();
    coilFact('coil.spec', invalidSource).sourceRef.sourceId = 'unknown.source';
    assert.throws(() => validateOntologyV2(invalidSource), error => error.code === 'ONTOLOGY_V2_SOURCE_UNKNOWN');

    const sourceExtended = cloneContract();
    addFutureEntity(sourceExtended);
    assert.doesNotThrow(() => validateOntologyV2(sourceExtended));
});

test('V2 only bridges existing V1 Coil relations; V1 remains unchanged', () => {
    assert.deepEqual(coilProfile().relationBridge.relationIds, ['recipe.uses_coil', 'coil.used_by_recipe']);
    assert.ok(ontologyV1.relations.some(item => item.relationId === 'recipe.uses_coil'));
    assert.ok(ontologyV1.relations.some(item => item.relationId === 'coil.used_by_recipe'));
    assert.equal(ontologyV1.version, 1);
});
