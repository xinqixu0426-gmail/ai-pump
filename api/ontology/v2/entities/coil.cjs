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
    presentationGroup: options.presentationGroup || 'TECHNICAL',
    temporalSemantics: options.temporalSemantics || 'MUTABLE_CURRENT_VALUE',
    missingSemantics: options.missingSemantics || 'UNKNOWN_NOT_FALSE',
    safeForDefaultSummary: options.safeForDefaultSummary === true,
});

const facts = [
    fact('coil.schemeCode', '方案编码', 'STRING', 'coils.scheme_code -> coilRow.schemeCode', {
        searchable: true, candidateSelectionEvidence: true, directIdentityEvidence: true, presentationGroup: 'OTHER',
        temporalSemantics: 'STABLE_DESIGN_VALUE', safeForDefaultSummary: true,
    }),
    fact('coil.schemeName', '方案名称', 'STRING', 'coils.scheme_name -> coilRow.schemeName', {
        searchable: true, presentationGroup: 'OTHER', safeForDefaultSummary: true,
    }),
    fact('coil.spec', '规格俗称', 'STRING', 'coils.spec -> coilRow.spec', {
        searchable: true, candidateSelectionEvidence: true, presentationGroup: 'SELECTION',
        temporalSemantics: 'STABLE_DESIGN_VALUE', safeForDefaultSummary: true,
    }),
    fact('coil.sheets', '片数', 'INTEGER', 'coils.sheets -> coilRow.sheets', {
        searchable: true, candidateSelectionEvidence: true, presentationGroup: 'SELECTION',
        temporalSemantics: 'STABLE_DESIGN_VALUE', safeForDefaultSummary: true,
    }),
    fact('coil.material', '材质', 'STRING', 'coils.material -> coilRow.material', {
        searchable: true, candidateSelectionEvidence: true, presentationGroup: 'SELECTION',
        temporalSemantics: 'STABLE_DESIGN_VALUE', safeForDefaultSummary: true,
    }),
    fact('coil.slotType', '槽眼', 'STRING', 'coils.slot_type -> coilRow.slotType', {
        searchable: true, candidateSelectionEvidence: true, presentationGroup: 'SELECTION',
        temporalSemantics: 'STABLE_DESIGN_VALUE', safeForDefaultSummary: true,
    }),
    fact('coil.schemeStatus', '方案状态', 'STRING', 'coils.scheme_status -> coilRow.schemeStatus', {
        searchable: true, candidateSelectionEvidence: true, presentationGroup: 'SELECTION',
        safeForDefaultSummary: true,
    }),
    fact('coil.ratedVoltageV', '额定电压', 'INTEGER', 'coils.rated_voltage_v -> coilRow.ratedVoltageV', {
        unit: 'V', searchable: true, candidateSelectionEvidence: true,
        presentationGroup: 'SELECTION', temporalSemantics: 'STABLE_DESIGN_VALUE',
        missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: true,
    }),
    fact('coil.ratedFrequencyHz', '额定频率', 'INTEGER', 'coils.rated_frequency_hz -> coilRow.ratedFrequencyHz', {
        unit: 'Hz', searchable: true, candidateSelectionEvidence: true,
        presentationGroup: 'SELECTION', temporalSemantics: 'STABLE_DESIGN_VALUE',
        missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: true,
    }),
    fact('coil.market', '适用市场', 'STRING', 'coils.market -> coilRow.market', {
        searchable: true, candidateSelectionEvidence: true, presentationGroup: 'SELECTION',
        temporalSemantics: 'STABLE_DESIGN_VALUE', missingSemantics: 'NOT_RECORDED',
        safeForDefaultSummary: true,
    }),
    fact('coil.schemeFamilyCode', '方案系列编码', 'STRING', 'coils.scheme_family_code -> coilRow.schemeFamilyCode', {
        searchable: true, candidateSelectionEvidence: true, presentationGroup: 'SELECTION',
        temporalSemantics: 'STABLE_DESIGN_VALUE', safeForDefaultSummary: false,
    }),
    fact('coil.pricingMode', '计价方式', 'STRING', 'coils.pricing_mode -> coilRow.pricingMode', {
        candidateSelectionEvidence: true, presentationGroup: 'SELECTION',
        temporalSemantics: 'STABLE_DESIGN_VALUE', safeForDefaultSummary: true,
    }),
    fact('coil.wireWeight', '线重', 'NUMBER', 'coils.wire_weight -> coilRow.wireWeight', {
        unit: 'kg', searchable: true, candidateSelectionEvidence: true,
        presentationGroup: 'PRIMARY', temporalSemantics: 'STABLE_DESIGN_VALUE',
        missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: true,
    }),
    fact('coil.defaultCapacitor', '默认电容', 'STRING', 'coils.default_capacitor -> coilRow.defaultCapacitor', {
        unit: 'μF', searchable: true, candidateSelectionEvidence: true,
        presentationGroup: 'PRIMARY', temporalSemantics: 'STABLE_DESIGN_VALUE',
        missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: true,
    }),
    fact('coil.defaultCableCrossSection', '默认搭配电缆横截面积', 'STRING', 'coils.default_wire_gauge -> coilRow.defaultWireGauge', {
        unit: 'mm²', searchable: true, candidateSelectionEvidence: true,
        presentationGroup: 'PRIMARY', temporalSemantics: 'STABLE_DESIGN_VALUE',
        missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: true,
    }),
    fact('coil.cost', '当前总成本', 'NUMBER', 'coils.cost -> coilRow.cost', {
        unit: 'CNY/set', sourceId: 'coil.cost_mapping_unresolved', sourceStatus: 'UNRESOLVED',
        authority: 'UNRESOLVED', presentationGroup: 'PRIMARY',
        temporalSemantics: 'DYNAMIC_DERIVED_CURRENT_VALUE', missingSemantics: 'SOURCE_MAPPING_UNRESOLVED',
        safeForDefaultSummary: false,
    }),
    fact('coil.mainWireGauge', '主线漆包线线径', 'STRING', 'coils.main_wire_gauge -> coilRow.mainWireGauge', {
        searchable: true, presentationGroup: 'TECHNICAL', temporalSemantics: 'STABLE_DESIGN_VALUE',
        missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: false,
    }),
    fact('coil.mainWireData', '主线绕组数据', 'STRING', 'coils.main_wire_data -> coilRow.mainWireData', {
        searchable: true, presentationGroup: 'TECHNICAL', temporalSemantics: 'STABLE_DESIGN_VALUE',
        missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: false,
    }),
    fact('coil.auxWireGauge', '副线漆包线线径', 'STRING', 'coils.aux_wire_gauge -> coilRow.auxWireGauge', {
        searchable: true, presentationGroup: 'TECHNICAL', temporalSemantics: 'STABLE_DESIGN_VALUE',
        missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: false,
    }),
    fact('coil.auxWireData', '副线绕组数据', 'STRING', 'coils.aux_wire_data -> coilRow.auxWireData', {
        searchable: true, presentationGroup: 'TECHNICAL', temporalSemantics: 'STABLE_DESIGN_VALUE',
        missingSemantics: 'NOT_RECORDED', safeForDefaultSummary: false,
    }),
    fact('coil.stock', '线圈转子库存', 'NUMBER', 'coils.stock -> coilRow.stock', {
        unit: 'set', presentationGroup: 'OTHER', temporalSemantics: 'MUTABLE_CURRENT_VALUE',
        missingSemantics: 'ZERO_BY_SCHEMA_DEFAULT', safeForDefaultSummary: false,
    }),
    fact('coil.kitPrice', '供应商套件价', 'NUMBER', 'coils.kit_price -> coilRow.kitPrice', {
        unit: 'CNY/set', presentationGroup: 'TECHNICAL', missingSemantics: 'ZERO_WHEN_NOT_KIT',
        safeForDefaultSummary: false,
    }),
    fact('coil.unitPrice', '定子单片价', 'NUMBER', 'coils.unit_price -> coilRow.unitPrice', {
        unit: 'CNY/sheet', presentationGroup: 'TECHNICAL', safeForDefaultSummary: false,
    }),
    fact('coil.copperBase', '铜价基数', 'NUMBER', 'coils.copper_base -> coilRow.copperBase', {
        unit: 'CNY/kg', presentationGroup: 'TECHNICAL', temporalSemantics: 'MUTABLE_CURRENT_VALUE',
        safeForDefaultSummary: false,
    }),
    fact('coil.coilFee', '线圈加工费', 'NUMBER', 'coils.coil_fee -> coilRow.coilFee', {
        unit: 'CNY/set', presentationGroup: 'TECHNICAL', safeForDefaultSummary: false,
    }),
    fact('coil.rotorFee', '转子加工费', 'NUMBER', 'coils.rotor_fee -> coilRow.rotorFee', {
        unit: 'CNY/set', presentationGroup: 'TECHNICAL', safeForDefaultSummary: false,
    }),
    fact('coil.createdAt', '创建时间', 'DATETIME', 'coils.created_at -> coilRow.createdAt', {
        presentationGroup: 'OTHER', temporalSemantics: 'STABLE_DESIGN_VALUE', safeForDefaultSummary: false,
    }),
    fact('coil.updatedAt', '更新时间', 'DATETIME', 'coils.updated_at -> coilRow.updatedAt', {
        presentationGroup: 'OTHER', temporalSemantics: 'MUTABLE_CURRENT_VALUE', safeForDefaultSummary: false,
    }),
];

const coilProfile = deepFreeze({
    entityType: 'coil',
    status: 'DRAFT_AWAITING_OWNER_REVIEW',
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
        policyId: 'generic.explicit_then_default',
        explicitConditionFactIds: facts.filter(item => item.candidateSelectionEvidence).map(item => item.factId),
        defaultMetadata: {
            sourceRef: { sourceId: 'coil.current_resource', path: 'coils.is_default -> coilRow.isDefault', status: 'RESOLVED' },
            classification: 'SELECTION_POLICY',
            identityEvidence: false,
            technicalFact: false,
        },
        orderedRules: [
            'APPLY_ALL_EXPLICIT_CONDITIONS',
            'SELECT_IF_ONE_REMAINS',
            'SELECT_IF_MULTIPLE_REMAIN_AND_EXACTLY_ONE_IS_DEFAULT',
            'AMBIGUOUS_IF_MULTIPLE_REMAIN_AND_DEFAULT_COUNT_IS_NOT_ONE',
        ],
        outcomes: {
            uniqueAfterExplicitConditions: 'EXPLICIT_UNIQUE',
            oneDefaultAmongMultiple: 'DEFAULT_SELECTED',
            zeroDefaultsAmongMultiple: 'AMBIGUOUS',
            multipleDefaultsAmongMultiple: 'AMBIGUOUS',
        },
        defaultMayOverrideExplicitConditions: false,
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
