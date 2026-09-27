'use strict';

const { deepFreeze } = require('../../sources.cjs');

const fact = (factId, label, dataType, sourcePath, options = {}) => ({
    factId,
    label,
    dataType,
    unit: options.unit ?? null,
    sourceRef: {
        sourceId: options.sourceId || 'coil.current_resource',
        path: sourcePath,
        status: options.sourceStatus || 'RESOLVED',
    },
    authority: options.authority || 'CANONICAL_CURRENT',
    searchable: options.searchable === true,
    candidateSelectionEvidence: options.candidateSelectionEvidence === true,
    directIdentityEvidence: options.directIdentityEvidence === true,
    presentationGroup: options.presentationGroup || 'OTHER',
    temporalSemantics: options.temporalSemantics || 'MUTABLE_CURRENT_VALUE',
    missingSemantics: options.missingSemantics || 'UNKNOWN_NOT_FALSE',
    safeForDefaultSummary: options.safeForDefaultSummary === true,
    businessRoles: options.businessRoles || ['DESCRIPTIVE'],
});

const facts = [
    fact('coil.schemeCode', '方案编码', 'STRING', 'coils.scheme_code -> coilRow.schemeCode', {
        searchable: true, candidateSelectionEvidence: true, directIdentityEvidence: true,
        temporalSemantics: 'STABLE_DESIGN_VALUE', businessRoles: ['DIRECT_LOOKUP'],
    }),
    fact('coil.schemeName', '方案名称', 'STRING', 'coils.scheme_name -> coilRow.schemeName', {
        searchable: true, safeForDefaultSummary: true, businessRoles: ['DISPLAY', 'DESCRIPTIVE'],
    }),
    fact('coil.spec', '规格俗称', 'STRING', 'coils.spec -> coilRow.spec', {
        searchable: true, candidateSelectionEvidence: true, temporalSemantics: 'STABLE_DESIGN_VALUE', businessRoles: ['DESCRIPTIVE'],
    }),
    fact('coil.sheets', '片数', 'INTEGER', 'coils.sheets -> coilRow.sheets', {
        searchable: true, candidateSelectionEvidence: true, temporalSemantics: 'STABLE_DESIGN_VALUE', businessRoles: ['DESCRIPTIVE'],
    }),
    fact('coil.material', '材质', 'STRING', 'coils.material -> coilRow.material', {
        searchable: true, candidateSelectionEvidence: true, temporalSemantics: 'STABLE_DESIGN_VALUE', businessRoles: ['DESCRIPTIVE'],
    }),
    fact('coil.slotType', '槽眼', 'STRING', 'coilRow.slotType = stator_variants.slot_type || coils.slot_type || "小眼"', {
        sourceId: 'coil.dto_projection', searchable: true, candidateSelectionEvidence: true, temporalSemantics: 'STABLE_DESIGN_VALUE', businessRoles: ['DESCRIPTIVE'],
    }),
    fact('coil.ratedVoltageV', '额定电压', 'INTEGER', 'coils.rated_voltage_v -> coilRow.ratedVoltageV', {
        unit: 'V', searchable: true, candidateSelectionEvidence: true, temporalSemantics: 'STABLE_DESIGN_VALUE', missingSemantics: 'NOT_RECORDED', businessRoles: ['DESCRIPTIVE'],
    }),
    fact('coil.ratedFrequencyHz', '额定频率', 'INTEGER', 'coils.rated_frequency_hz -> coilRow.ratedFrequencyHz', {
        unit: 'Hz', searchable: true, candidateSelectionEvidence: true, temporalSemantics: 'STABLE_DESIGN_VALUE', missingSemantics: 'NOT_RECORDED', businessRoles: ['DESCRIPTIVE'],
    }),
    fact('coil.schemeStatus', '方案状态', 'STRING', 'coils.scheme_status -> coilRow.schemeStatus', {
        searchable: true, businessRoles: ['LIFECYCLE'], safeForDefaultSummary: false,
    }),
    fact('coil.market', '适用市场', 'STRING', 'coils.market -> coilRow.market', {
        searchable: true, temporalSemantics: 'STABLE_DESIGN_VALUE', missingSemantics: 'NOT_RECORDED', businessRoles: ['DESCRIPTIVE'], safeForDefaultSummary: false,
    }),
    fact('coil.schemeFamilyCode', '方案系列编码', 'STRING', 'coils.scheme_family_code -> coilRow.schemeFamilyCode', {
        temporalSemantics: 'STABLE_DESIGN_VALUE', businessRoles: ['INTERNAL_CALCULATION'],
    }),
    fact('coil.wireWeight', '线重', 'NUMBER', 'coils.wire_weight -> coilRow.wireWeight', {
        unit: 'kg', searchable: true, presentationGroup: 'PRIMARY', temporalSemantics: 'STABLE_DESIGN_VALUE', missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: true, businessRoles: ['COST_INPUT'],
    }),
    fact('coil.defaultCapacitor', '默认电容', 'STRING', 'coils.default_capacitor -> coilRow.defaultCapacitor', {
        unit: 'μF', searchable: true, presentationGroup: 'PRIMARY', temporalSemantics: 'STABLE_DESIGN_VALUE', missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: true, businessRoles: ['BOM_INPUT'],
    }),
    fact('coil.defaultCableCrossSection', '默认搭配电缆横截面积', 'STRING', 'coils.default_wire_gauge -> coilRow.defaultWireGauge', {
        unit: 'mm²', searchable: true, presentationGroup: 'PRIMARY', temporalSemantics: 'STABLE_DESIGN_VALUE', missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: true, businessRoles: ['BOM_INPUT'],
    }),
    fact('coil.cost', '当前总成本', 'NUMBER', 'coilCost.calculateCoilCost(...).data.totalCost; coils.cost is the maintained materialized current representation', {
        unit: 'CNY/set', sourceId: 'coil.current_cost_projection', authority: 'DERIVED', presentationGroup: 'PRIMARY', temporalSemantics: 'DYNAMIC_DERIVED_CURRENT_VALUE', missingSemantics: 'FORMAL_COST_RESULT_REQUIRED', safeForDefaultSummary: true, businessRoles: ['CURRENT_BUSINESS'],
    }),
    fact('coil.mainWireGauge', '主线漆包线线径', 'STRING', 'coils.main_wire_gauge -> coilRow.mainWireGauge', {
        searchable: true, presentationGroup: 'TECHNICAL', temporalSemantics: 'STABLE_DESIGN_VALUE', missingSemantics: 'NOT_RECORDED', businessRoles: ['TECHNICAL'],
    }),
    fact('coil.mainWireData', '主线绕组数据', 'STRING', 'coils.main_wire_data -> coilRow.mainWireData', {
        searchable: true, presentationGroup: 'TECHNICAL', temporalSemantics: 'STABLE_DESIGN_VALUE', missingSemantics: 'NOT_RECORDED', businessRoles: ['TECHNICAL'],
    }),
    fact('coil.auxWireGauge', '副线漆包线线径', 'STRING', 'coils.aux_wire_gauge -> coilRow.auxWireGauge', {
        searchable: true, presentationGroup: 'TECHNICAL', temporalSemantics: 'STABLE_DESIGN_VALUE', missingSemantics: 'NOT_RECORDED', businessRoles: ['TECHNICAL'],
    }),
    fact('coil.auxWireData', '副线绕组数据', 'STRING', 'coils.aux_wire_data -> coilRow.auxWireData', {
        searchable: true, presentationGroup: 'TECHNICAL', temporalSemantics: 'STABLE_DESIGN_VALUE', missingSemantics: 'NOT_RECORDED', businessRoles: ['TECHNICAL'],
    }),
    fact('coil.stock', '线圈转子库存', 'INTEGER', 'coils.stock -> coilRow.stock', {
        unit: 'set', temporalSemantics: 'MUTABLE_CURRENT_VALUE', missingSemantics: 'ZERO_BY_SCHEMA_DEFAULT', businessRoles: ['CURRENT_BUSINESS'],
    }),
    fact('coil.kitPrice', '供应商套件价', 'NUMBER', 'coils.kit_price -> coilRow.kitPrice', {
        unit: 'CNY/set', missingSemantics: 'ZERO_WHEN_NOT_KIT', businessRoles: ['COST_INPUT'],
    }),
    fact('coil.unitPrice', '定子单片价', 'NUMBER', 'coils.unit_price -> coilRow.unitPrice', {
        unit: 'CNY/sheet', businessRoles: ['COST_INPUT'],
    }),
    fact('coil.copperBase', '铜价基数', 'NUMBER', 'coils.copper_base -> coilRow.copperBase', {
        unit: 'CNY/kg', temporalSemantics: 'MUTABLE_CURRENT_VALUE', businessRoles: ['COST_INPUT'],
    }),
    fact('coil.coilFee', '线圈加工费', 'NUMBER', 'coils.coil_fee -> coilRow.coilFee', {
        unit: 'CNY/set', businessRoles: ['COST_INPUT'],
    }),
    fact('coil.rotorFee', '转子加工费', 'NUMBER', 'coils.rotor_fee -> coilRow.rotorFee', {
        unit: 'CNY/set', businessRoles: ['COST_INPUT'],
    }),
    fact('coil.diameterMm', '标准定子直径', 'INTEGER', 'coilRow.diameterMm = stator_variants.diameter_mm || (coils.spec === "12" ? 120 : Number(coils.spec) || 0)', {
        unit: 'mm', sourceId: 'coil.dto_projection', temporalSemantics: 'STABLE_DESIGN_VALUE', businessRoles: ['DERIVED_TECHNICAL'],
    }),
    fact('coil.createdAt', '创建时间', 'DATETIME', 'coils.created_at -> coilRow.createdAt', {
        temporalSemantics: 'STABLE_DESIGN_VALUE', businessRoles: ['PROVENANCE'],
    }),
    fact('coil.updatedAt', '更新时间', 'DATETIME', 'coils.updated_at -> coilRow.updatedAt', {
        temporalSemantics: 'MUTABLE_CURRENT_VALUE', businessRoles: ['PROVENANCE'],
    }),
];

const coilProfile = deepFreeze({
    entityType: 'coil',
    status: 'OWNER_REVIEWED_REFERENCE_PROFILE',
    identity: {
        canonicalId: {
            sourceRef: { sourceId: 'coil.current_resource', path: 'coils.id -> coilRow.id', status: 'RESOLVED' },
            kind: 'DB_POSITIVE_INTEGER_PRIMARY_KEY',
            unique: true,
        },
        canonicalIdentityFactId: null,
        permitsDesignationAsCanonicalId: false,
        permitsNameOnlyCanonicalId: false,
    },
    facts,
    designations: [{
        designationId: 'coil.commonDesignation',
        label: '常用叫法',
        components: ['coil.spec', 'coil.sheets'],
        expression: { operation: 'JOIN', separator: '-', nullPolicy: 'UNAVAILABLE_IF_ANY_COMPONENT_MISSING' },
        sourceRef: { sourceId: 'coil.common_designation', path: 'coil.spec + "-" + coil.sheets', status: 'RESOLVED' },
        searchable: true,
        unique: false,
        collisionPolicy: 'ALLOWED',
        directIdentityEvidence: false,
        canonicalIdentity: false,
    }],
    selectionPolicy: {
        policyType: 'EXPLICIT_THEN_DEFAULT',
        explicitConditionFactIds: ['coil.schemeCode', 'coil.spec', 'coil.sheets', 'coil.material', 'coil.slotType', 'coil.ratedVoltageV', 'coil.ratedFrequencyHz'],
        defaultMetadata: {
            classification: 'SELECTION_POLICY',
            identityEvidence: false,
            existingMarkers: [{
                markerType: 'EXISTING_LOCAL_DEFAULT_MARKER',
                sourceRef: { sourceId: 'coil.current_resource', path: 'coils.is_default -> coilRow.isDefault', status: 'RESOLVED' },
                semanticScope: 'official coils sharing stator_variant_id + sheets',
            }],
            fallbackResolver: {
                resolverType: 'FINAL_CANDIDATE_FALLBACK_DEFAULT',
                sourceRef: { sourceId: 'coil.ai_fallback_default', path: 'authoritative persisted resolver not yet proven', status: 'UNRESOLVED' },
                semanticScope: 'final eligible candidate set after explicit Owner conditions',
            },
        },
        orderedStages: ['ESTABLISH_ELIGIBLE_POOL', 'APPLY_EXPLICIT_CONDITIONS', 'UNIQUE_REMAINS', 'INSPECT_UNIQUE_DEFAULT', 'AMBIGUOUS'],
        outcomes: {
            uniqueAfterExplicitConditions: 'EXPLICIT_UNIQUE',
            oneDefaultAmongMultiple: 'DEFAULT_SELECTED',
            zeroDefaultsAmongMultiple: 'AMBIGUOUS',
            multipleDefaultsAmongMultiple: 'AMBIGUOUS',
        },
        defaultMayOverrideExplicitConditions: false,
        runtimeEnabled: false,
    },
    eligibilityPolicy: {
        policyType: 'LIFECYCLE_STATUS',
        factId: 'coil.schemeStatus',
        ordinaryEligibleValues: ['official'],
        explicitOptInValues: ['testing'],
        historicalOnlyValues: ['disabled'],
        runtimeEnabled: false,
    },
    costingPolicy: {
        policyType: 'VALUE_ROUTED_COSTING',
        sourceRef: { sourceId: 'coil.current_resource', path: 'coils.pricing_mode -> coilRow.pricingMode', status: 'RESOLVED' },
        values: [
            { value: 'calculated', semantics: 'DECOMPOSABLE_FORMAL_COST_INPUTS' },
            { value: 'kit', semantics: 'DIRECT_SUPPLIER_KIT_PRICE' },
        ],
        runtimeEnabled: false,
    },
    relationBridge: {
        ontologyVersion: 1,
        relationIds: ['recipe.uses_coil', 'coil.used_by_recipe'],
        implementation: 'REFERENCE_EXISTING_V1_ONLY',
        promotesRelationToIdentityEvidence: false,
    },
});

module.exports = { coilProfile };
