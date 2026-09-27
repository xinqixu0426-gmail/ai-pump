'use strict';

const { deepFreeze } = require('../../sources.cjs');

const schemaEvidence = 'api/database/schema.cjs: coils table';
const dtoEvidence = 'api/db.cjs: coilRow';
const commandEvidence = 'api/services/coilCommands.cjs: create/update mapping';

function auditedField(sourceField, proposedFactId, businessMeaning, classification, options = {}) {
    return {
        sourceField,
        proposedFactId,
        businessMeaning,
        classification,
        evidence: options.evidence || [schemaEvidence, dtoEvidence],
        sourceStatus: options.sourceStatus || 'RESOLVED',
        unresolvedIssue: options.unresolvedIssue || null,
    };
}

const coilSourceAudit = deepFreeze({
    entityType: 'coil',
    discoveryStatus: 'AUDITED_DRAFT_NOT_ACCEPTED',
    discoveryIsAcceptance: false,
    fields: [
        auditedField('coils.id', null, '具体线圈方案的数据库资源身份', 'CANONICAL_IDENTITY'),
        auditedField('coils.stator_variant_id', null, '定子组合正式资源引用', 'PROVENANCE_TECHNICAL_METADATA', { evidence: [schemaEvidence, dtoEvidence] }),
        auditedField('coils.spec', 'coil.spec', '工厂规格俗称；与片数组成常用叫法', 'ACCEPTED_FACT'),
        auditedField('coils.material', 'coil.material', '定子材质', 'ACCEPTED_FACT'),
        auditedField('coils.slot_type', 'coil.slotType', '槽眼原始后备字段', 'PROJECTION_INPUT', { evidence: [schemaEvidence, dtoEvidence] }),
        auditedField('coils.sheets', 'coil.sheets', '定子片数', 'ACCEPTED_FACT'),
        auditedField('coils.scheme_code', 'coil.schemeCode', '稳定内部直接查找键，不是 Owner 常用名称或 canonical identity', 'IDENTITY_METADATA', { evidence: [schemaEvidence, commandEvidence, 'docs/database-schema.md: coils.scheme_code'] }),
        auditedField('coils.scheme_name', 'coil.schemeName', '人可读具体方案显示名', 'DISPLAY_FACT'),
        auditedField('coils.scheme_status', 'coil.schemeStatus', '方案生命周期和普通候选资格', 'LIFECYCLE_POLICY'),
        auditedField('coils.is_default', null, '多候选后的默认兜底标记', 'SELECTION_POLICY', { evidence: [schemaEvidence, commandEvidence, 'api/services/coilCost.cjs: exact candidate default resolution'] }),
        auditedField('coils.rated_voltage_v', 'coil.ratedVoltageV', '方案额定电压', 'ACCEPTED_FACT'),
        auditedField('coils.rated_frequency_hz', 'coil.ratedFrequencyHz', '方案额定频率', 'ACCEPTED_FACT'),
        auditedField('coils.market', 'coil.market', '描述性市场备注，不参与正常实体选择', 'DESCRIPTIVE_FACT'),
        auditedField('coils.scheme_family_code', 'coil.schemeFamilyCode', '插值/外推的内部系列边界，不是正常业务名称', 'INTERNAL_CALCULATION_METADATA', { evidence: [schemaEvidence, 'api/services/coilCost.cjs: interpolation/extrapolation family filtering'] }),
        auditedField('coils.pricing_mode', null, 'calculated/kit 的成本取得路径', 'COSTING_POLICY'),
        auditedField('coils.kit_price', 'coil.kitPrice', 'kit 模式的供应商整套价格输入', 'COST_INPUT'),
        auditedField('coils.unit_price', 'coil.unitPrice', 'calculated 模式的定子单片价输入', 'COST_INPUT'),
        auditedField('coils.wire_weight', 'coil.wireWeight', '方案线重；Owner 主信息和成本输入', 'PRIMARY_FACT'),
        auditedField('coils.copper_base', 'coil.copperBase', '维护中的铜价基数成本输入', 'COST_INPUT', { evidence: [schemaEvidence, 'api/services/copperPriceUpdate.cjs'] }),
        auditedField('coils.coil_fee', 'coil.coilFee', '线圈加工费成本输入', 'COST_INPUT'),
        auditedField('coils.rotor_fee', 'coil.rotorFee', '转子加工费成本输入', 'COST_INPUT'),
        auditedField('coils.cost', 'coil.cost', 'calculated/kit 当前成本的维护型物化字段；不在 Ontology 重算', 'CURRENT_COST_MATERIALIZATION', {
            evidence: [schemaEvidence, dtoEvidence, commandEvidence, 'api/services/copperPriceUpdate.cjs', 'api/services/coilCost.cjs: calculateCoilCost', 'api/services/recipeBomEngine.cjs: calculateCoilSnapshot'],
        }),
        auditedField('coils.default_wire_gauge', 'coil.defaultCableCrossSection', '默认搭配电缆横截面积（mm²），BOM 可继承的输入', 'PRIMARY_BOM_INPUT', { evidence: [schemaEvidence, commandEvidence, 'apps/web-next/components/coils-view.tsx: 默认搭配电缆横截面积', 'api/services/recipeBomEngine.cjs'] }),
        auditedField('coils.default_capacitor', 'coil.defaultCapacitor', '默认电容（μF），BOM 可继承的输入', 'PRIMARY_BOM_INPUT', { evidence: [schemaEvidence, commandEvidence, 'apps/web-next/components/coils-view.tsx: 默认电容', 'api/services/recipeBomEngine.cjs'] }),
        auditedField('coils.main_wire_gauge', 'coil.mainWireGauge', '主线漆包线线径', 'TECHNICAL_FACT'),
        auditedField('coils.main_wire_data', 'coil.mainWireData', '主线匝数、绕法等绕组数据', 'TECHNICAL_FACT'),
        auditedField('coils.aux_wire_gauge', 'coil.auxWireGauge', '副线漆包线线径', 'TECHNICAL_FACT'),
        auditedField('coils.aux_wire_data', 'coil.auxWireData', '副线匝数、绕法等绕组数据', 'TECHNICAL_FACT'),
        auditedField('coils.stock', 'coil.stock', '线圈转子成品库存套数', 'CURRENT_BUSINESS_FACT', { evidence: ['api/database/schema.cjs: COIL_STOCK_COLUMN_DEFINITION INTEGER', dtoEvidence, 'api/services/coilInventory.cjs'] }),
        auditedField('coils.created_at', 'coil.createdAt', '资源创建时间', 'PROVENANCE_TECHNICAL_METADATA'),
        auditedField('coils.updated_at', 'coil.updatedAt', '资源最后更新时间', 'PROVENANCE_TECHNICAL_METADATA'),
        auditedField('coilRow.statorVariantId', null, 'DTO 中的正式定子组合 ID 投影', 'TECHNICAL_METADATA', { evidence: [dtoEvidence] }),
        auditedField('coilRow.slotType', 'coil.slotType', '优先取 stator_variants.slot_type，缺失时回退 coils.slot_type', 'ACCEPTED_FACT', { evidence: [dtoEvidence] }),
        auditedField('coilRow.diameterMm', 'coil.diameterMm', '定子组合标准直径；无关联时按历史 spec 规则推导', 'DERIVED_FACT', { evidence: [dtoEvidence] }),
        auditedField('coilRow.commonName', null, '优先定子组合 common_name，否则 spec；与规格俗称重叠', 'REDUNDANT_PROJECTION', { evidence: [dtoEvidence] }),
        auditedField('coilRow.Id/CreatedAt/UpdatedAt', null, '历史兼容别名；正式 DTO 使用 id/createdAt/updatedAt', 'REDUNDANT_COMPATIBILITY_PROJECTION', { evidence: [dtoEvidence] }),
    ],
});

module.exports = { coilSourceAudit };
