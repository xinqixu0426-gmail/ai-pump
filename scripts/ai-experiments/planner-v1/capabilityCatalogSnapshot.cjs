'use strict';

const { listBusinessCapabilities } = require('../../../api/capabilities/registry.cjs');

const PLANNER_VISIBLE_IDS = Object.freeze([
    'templates.detail',
    'recipes.current_costs',
    'relations.read',
    'cost.recipe_difference',
    'coils.list',
    'recipes.scenario_compare_preview',
]);

const PLANNER_DESCRIPTIONS = Object.freeze({
    'templates.detail': '读取一个已正式定位模板的当前详情与固定件关系。',
    'recipes.current_costs': '读取已正式定位配方的当前权威成本基准。',
    'relations.read': '读取已正式定位实体的当前正式关系，例如配方当前线圈。',
    'cost.recipe_difference': '读取两个已正式定位配方的当前权威成本差异。',
    'coils.list': '读取已正式定位线圈方案的当前权威规格与成本相关正式记录。',
    'recipes.scenario_compare_preview': '在不保存的前提下，对已正式定位配方的配置场景进行权威成本预览。',
});

const PLANNER_CONTRACTS = Object.freeze({
    'templates.detail': Object.freeze({ inputSemantics: '一个已正式定位的 Template。', outputSemantics: '该 Template 当前详情及其正式固定件关系。', factKinds: Object.freeze(['template_fixed_parts']) }),
    'recipes.current_costs': Object.freeze({ inputSemantics: '一个已正式定位的 Recipe。', outputSemantics: '该 Recipe 当前权威成本基准。', factKinds: Object.freeze(['recipe_current_cost']) }),
    'relations.read': Object.freeze({ inputSemantics: '一个已正式定位的业务对象及其所需关系。', outputSemantics: '该对象当前正式关系，例如当前线圈。', factKinds: Object.freeze(['current_relation']) }),
    'cost.recipe_difference': Object.freeze({ inputSemantics: '两个已正式定位的 Recipe。', outputSemantics: '两个 Recipe 的当前权威成本差异及当前成本明细。', factKinds: Object.freeze(['recipe_cost_difference']) }),
    'coils.list': Object.freeze({ inputSemantics: '一个或多个已正式定位的 Coil Scheme。', outputSemantics: '当前权威线圈方案规格与成本相关正式记录。', factKinds: Object.freeze(['coil_current_cost']) }),
    'recipes.scenario_compare_preview': Object.freeze({ inputSemantics: '一个已正式定位的 Recipe 与 Owner 明确的场景配置变化。', outputSemantics: '不保存的当前重建成本、场景成本与已应用配置变化。', factKinds: Object.freeze(['scenario_cost_comparison']) }),
});

function plannerModeFor(capability) {
    return capability.operation === 'preview' ? 'PREVIEW' : 'READ';
}

function createPlannerCapabilityCatalogSnapshot() {
    const all = listBusinessCapabilities();
    const byId = new Map(all.map(capability => [capability.capabilityId, capability]));
    const visible = PLANNER_VISIBLE_IDS.map(capabilityId => {
        const capability = byId.get(capabilityId);
        if (!capability) throw new Error(`PLANNER_CAPABILITY_NOT_REGISTERED:${capabilityId}`);
        if (!['query', 'preview'].includes(capability.operation)) {
            throw new Error(`PLANNER_CAPABILITY_NOT_READ_ONLY:${capabilityId}`);
        }
        return Object.freeze({
            capabilityId,
            mode: plannerModeFor(capability),
            domain: capability.domain,
            description: PLANNER_DESCRIPTIONS[capabilityId],
            sourceRequirement: 'AUTHORITATIVE_BUSINESS_SOURCE',
            inputSemantics: PLANNER_CONTRACTS[capabilityId].inputSemantics,
            outputSemantics: PLANNER_CONTRACTS[capabilityId].outputSemantics,
            factKinds: PLANNER_CONTRACTS[capabilityId].factKinds,
        });
    });
    const operationCounts = all.reduce((counts, capability) => {
        counts[capability.operation] = (counts[capability.operation] || 0) + 1;
        return counts;
    }, {});
    const hiddenWrite = all.filter(capability => ['command', 'maintenance'].includes(capability.operation));
    return Object.freeze({
        source: 'api/capabilities/registry.cjs:listBusinessCapabilities',
        registryPath: 'api/capabilities/registry.cjs',
        totalCapabilities: all.length,
        operationCounts: Object.freeze(operationCounts),
        visibleCapabilities: Object.freeze(visible),
        visibleReadCapabilities: visible.filter(capability => capability.mode === 'READ').length,
        visibleAnalysisCapabilities: 0,
        visiblePreviewCapabilities: visible.filter(capability => capability.mode === 'PREVIEW').length,
        hiddenWriteCapabilities: hiddenWrite.length,
        plannerVisibleCapabilityCount: visible.length,
        plannerWriteCapabilitiesVisible: 0,
    });
}

module.exports = { PLANNER_VISIBLE_IDS, PLANNER_CONTRACTS, createPlannerCapabilityCatalogSnapshot };
