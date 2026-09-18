const { bindStableBomPartIdentities } = require('./bomPartIdentity.cjs');
const { normalizeBomRoles } = require('./bomRoles.cjs');

function loadOrderPartsCatalog(dependencies = {}) {
    if (typeof dependencies.loadPartsData === 'function') {
        const { partsByModel = {} } = dependencies.loadPartsData() || {};
        return Object.values(partsByModel).flat();
    }
    if (typeof dependencies.dbGetAllParts === 'function') {
        return dependencies.dbGetAllParts();
    }
    throw new Error('订单 BOM 身份校验缺少正式零件目录');
}

function normalizeNewOrderBomSnapshot(dependencies, parts = []) {
    return bindStableBomPartIdentities(
        normalizeBomRoles(parts),
        loadOrderPartsCatalog(dependencies)
    );
}

module.exports = {
    loadOrderPartsCatalog,
    normalizeNewOrderBomSnapshot,
};
