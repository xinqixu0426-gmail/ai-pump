const {
    DEFAULT_COIL_MATERIAL,
    parseStatorInput,
    resolveWireFromCoils,
    calculateFullEstimateCoilCost,
} = require('./coilCost.cjs');

function resolveWire(dbWire, explicitWire) {
    if (explicitWire) return explicitWire;
    if (dbWire) return dbWire;
    return '0.55';
}

module.exports = {
    DEFAULT_COIL_MATERIAL,
    parseStatorInput,
    resolveWireFromCoils,
    resolveWire,
    calculateFullEstimateCoilCost,
};
