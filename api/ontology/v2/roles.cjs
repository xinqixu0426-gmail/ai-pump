'use strict';

const { deepFreeze } = require('../sources.cjs');

// The catalog governs role spelling without making validator code entity-specific.
const roleCatalog = deepFreeze([
    { roleId: 'DESCRIPTIVE', label: '描述性', description: '人可读的业务描述或备注。' },
    { roleId: 'DISPLAY', label: '展示', description: '适合人类显示或检索的名称性信息。' },
    { roleId: 'DIRECT_LOOKUP', label: '直接查找', description: '稳定的精确查找证据，不等同 canonical identity。' },
    { roleId: 'LIFECYCLE', label: '生命周期', description: '表达资源状态及其资格边界。' },
    { roleId: 'INTERNAL_CALCULATION', label: '内部计算', description: '仅服务内部计算或估算边界。' },
    { roleId: 'COST_INPUT', label: '成本输入', description: '用于既有正式成本路径的输入或解释。' },
    { roleId: 'BOM_INPUT', label: 'BOM 输入', description: '可由既有 BOM 逻辑继承的配置输入。' },
    { roleId: 'CURRENT_BUSINESS', label: '当前业务', description: '当前经营或业务状态事实。' },
    { roleId: 'TECHNICAL', label: '技术', description: '按需展示的技术设计资料。' },
    { roleId: 'DERIVED_TECHNICAL', label: '派生技术', description: '由正式当前投影或规则得到的技术资料。' },
    { roleId: 'PROVENANCE', label: '来源追溯', description: '记录资源创建、更新时间等追溯信息。' },
    { roleId: 'ESTIMATE', label: '估算', description: '明确标记为非正式实体的估算结果。' },
]);

module.exports = { roleCatalog };
