const { inferPackagingSemantics } = require('./packagingSemantics.cjs');

const CONFIGURATION_DEPENDENCIES = Object.freeze({
    fixed: [],
    shell: [],
    barrelLength: ['customBarrelLength'],
    stainlessShellBundle: ['customBarrelLength'],
    longScrew: ['customBarrelLength'],
    capacitor: ['coilSpec', 'coilSheets', 'coilMaterial', 'coilSlotType'],
    coil: ['coilSpec', 'coilSheets', 'coilMaterial', 'coilSlotType'],
    float: ['hasFloat', 'floatWire', 'floatAccessoryType'],
    cable: ['hasCable', 'cableLength', 'cableWire', 'cableAccessoryType'],
    packing: ['packingPartsJson'],
    rotorProcess: ['hasStainlessShaftJoint', 'stainlessShaftJointCost'],
});

function inferLegacyBomCostRole(part = {}) {
    if (part.costRole && CONFIGURATION_DEPENDENCIES[part.costRole]) return part.costRole;
    const name = String(part.name || '');
    const model = String(part.model || '');
    if (part.dynamicRule === 'stainlessShellBundleByBarrelLength') return 'stainlessShellBundle';
    if (part.dynamicRule === 'longScrewByBarrelLength' || name.includes('长螺丝') || model.includes('长螺丝')) return 'longScrew';
    if (name.includes('cm)')) return 'barrelLength';
    if (name === '线圈转子') return 'coil';
    if (name === '电容') return 'capacitor';
    if (name.includes('浮球') || model.startsWith('浮球-')) return 'float';
    if (name.includes('电缆') || model.startsWith('电缆-') || model === '电缆配件费') return 'cable';
    if (part.processCode === 'stainless_friction_weld' || name.includes('不锈钢接轴')) return 'rotorProcess';
    const packaging = inferPackagingSemantics(part);
    if (part.packingRole || part.packagingMaterial || packaging.packingRole !== 'fixed'
        || name.includes('木箱') || name.includes('纸箱') || model.includes('木箱') || model.includes('纸箱')) {
        return 'packing';
    }
    if (part.source === 'pump_shell_template') return 'shell';
    return 'fixed';
}

function withBomRole(part, costRole) {
    const role = CONFIGURATION_DEPENDENCIES[costRole]
        ? costRole
        : inferLegacyBomCostRole(part);
    return {
        ...part,
        costRole: role,
        configurationDependencies: [...CONFIGURATION_DEPENDENCIES[role]],
    };
}

function normalizeBomRoles(parts = []) {
    return parts.map(part => withBomRole(part, part?.costRole));
}

module.exports = {
    CONFIGURATION_DEPENDENCIES,
    inferLegacyBomCostRole,
    normalizeBomRoles,
    withBomRole,
};
