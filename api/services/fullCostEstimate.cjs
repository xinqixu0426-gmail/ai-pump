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

function buildFullEstimateResult({ recipeCost, statorCost, dynamicCost }) {
    const recipeTotal = Number(recipeCost?.totalCost || 0);
    const statorTotal = Number(statorCost?.cost || 0);
    const dynamicTotal = Number(dynamicCost?.totalCost || 0);
    const totalCost = recipeTotal + statorTotal + dynamicTotal;
    return {
        recipeCost: recipeCost || null,
        statorCost: statorCost || null,
        dynamicCost: dynamicCost || null,
        totalCost: totalCost.toFixed(2),
        breakdown: {
            recipeCost: recipeCost?.totalCost || '0',
            statorCost: statorCost?.cost || '0',
            dynamicCost: dynamicCost?.totalCost || '0',
        },
    };
}

module.exports = {
    DEFAULT_COIL_MATERIAL,
    parseStatorInput,
    resolveWireFromCoils,
    resolveWire,
    calculateFullEstimateCoilCost,
    buildFullEstimateResult,
};
