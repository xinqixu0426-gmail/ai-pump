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
        auditedField('coils.id', null, '具体线圈方案的数据库资源身份', 'IDENTITY_METADATA'),
        auditedField('coils.stator_variant_id', null, '所关联定子组合的正式资源引用', 'PROVENANCE_TECHNICAL_METADATA', {
            evidence: [schemaEvidence, 'api/db.cjs: coilRow stator_variants lookup'],
        }),
        auditedField('coils.spec', 'coil.spec', '工厂规格俗称；不是唯一身份', 'FACT'),
        auditedField('coils.material', 'coil.material', '定子材质', 'FACT'),
        auditedField('coils.slot_type', 'coil.slotType', '槽眼类型', 'FACT'),
        auditedField('coils.sheets', 'coil.sheets', '定子片数', 'FACT'),
        auditedField('coils.scheme_code', 'coil.schemeCode', '不可变方案编码；可作直接查找证据但不替代 coil.id', 'IDENTITY_METADATA', {
            evidence: [schemaEvidence, commandEvidence, 'docs/database-schema.md: coils.scheme_code'],
        }),
        auditedField('coils.scheme_name', 'coil.schemeName', '具体方案显示名称', 'FACT'),
        auditedField('coils.scheme_status', 'coil.schemeStatus', '正式、测试或停用状态', 'FACT'),
        auditedField('coils.is_default', null, '多候选时的兜底选择标记', 'SELECTION_POLICY', {
            evidence: [schemaEvidence, commandEvidence, 'api/services/coilVariantAmbiguity.cjs'],
        }),
        auditedField('coils.rated_voltage_v', 'coil.ratedVoltageV', '方案额定电压', 'FACT'),
        auditedField('coils.rated_frequency_hz', 'coil.ratedFrequencyHz', '方案额定频率', 'FACT'),
        auditedField('coils.market', 'coil.market', '方案适用市场', 'FACT'),
        auditedField('coils.scheme_family_code', 'coil.schemeFamilyCode', '计算方案插值/外推所属系列', 'FACT', {
            evidence: [schemaEvidence, 'api/services/persistedCoilSelection.cjs', 'docs/coil-domain.md'],
        }),
        auditedField('coils.pricing_mode', 'coil.pricingMode', '计算计价或供应商套件价', 'FACT'),
        auditedField('coils.kit_price', 'coil.kitPrice', '供应商套件价模式的整套价格', 'FACT'),
        auditedField('coils.unit_price', 'coil.unitPrice', '计算计价模式使用的定子单片价', 'FACT'),
        auditedField('coils.wire_weight', 'coil.wireWeight', '具体方案线重', 'FACT'),
        auditedField('coils.copper_base', 'coil.copperBase', '保存的当前铜价基数', 'FACT', {
            evidence: [schemaEvidence, 'api/services/copperPriceUpdate.cjs'],
        }),
        auditedField('coils.coil_fee', 'coil.coilFee', '线圈加工费输入项', 'FACT'),
        auditedField('coils.rotor_fee', 'coil.rotorFee', '转子加工费输入项', 'FACT'),
        auditedField('coils.cost', 'coil.cost', '现有 DTO 的线圈整套成本字段', 'UNRESOLVED', {
            evidence: [schemaEvidence, dtoEvidence, 'api/services/coilCost.cjs', 'api/services/copperPriceUpdate.cjs', 'api/services/costEngine.cjs'],
            sourceStatus: 'UNRESOLVED',
            unresolvedIssue: '需 Owner/Supervisor 明确 coils.cost 与唯一正式成本权威 costEngine 的读取边界；V2 不计算、不默认展示。',
        }),
        auditedField('coils.default_wire_gauge', 'coil.defaultCableCrossSection', '默认搭配电缆横截面积（mm²）', 'FACT', {
            evidence: [schemaEvidence, commandEvidence, 'apps/web-next/components/coils-view.tsx: 默认搭配电缆横截面积', 'api/services/knowledge.cjs: pairedCableWireGauge'],
        }),
        auditedField('coils.default_capacitor', 'coil.defaultCapacitor', '具体方案默认搭配电容（μF）', 'FACT', {
            evidence: [schemaEvidence, commandEvidence, 'apps/web-next/components/coils-view.tsx: 默认电容', 'api/services/knowledge.cjs'],
        }),
        auditedField('coils.main_wire_gauge', 'coil.mainWireGauge', '主线漆包线线径', 'FACT'),
        auditedField('coils.main_wire_data', 'coil.mainWireData', '主线匝数、绕法等绕组数据', 'FACT'),
        auditedField('coils.aux_wire_gauge', 'coil.auxWireGauge', '副线漆包线线径', 'FACT'),
        auditedField('coils.aux_wire_data', 'coil.auxWireData', '副线匝数、绕法等绕组数据', 'FACT'),
        auditedField('coils.stock', 'coil.stock', '线圈转子成品库存套数', 'FACT', {
            evidence: ['api/database/migrations.cjs: coil stock column', dtoEvidence, 'docs/database-schema.md: coils.stock'],
        }),
        auditedField('coils.created_at', 'coil.createdAt', '资源创建时间', 'PROVENANCE_TECHNICAL_METADATA'),
        auditedField('coils.updated_at', 'coil.updatedAt', '资源最后更新时间', 'PROVENANCE_TECHNICAL_METADATA'),
    ],
});

module.exports = { coilSourceAudit };
