const { hasVerifiedExecution } = require('./aiExecutionEvidence.cjs');

function resultCount(result = {}) {
    if (Number.isFinite(Number(result.count))) return Number(result.count);
    if (Number.isFinite(Number(result.returnedCount))) return Number(result.returnedCount);
    if (Number.isFinite(Number(result.queryReceipt?.returnedCount))) {
        return Number(result.queryReceipt.returnedCount);
    }
    if (Array.isArray(result.data)) return result.data.length;
    if (Array.isArray(result.items)) return result.items.length;
    return null;
}

function isVerifiedEmptyObservation(result = {}) {
    return Boolean(
        result
        && result.success !== false
        && hasVerifiedExecution(result)
        && resultCount(result) === 0
    );
}

function isVerifiedPositiveObservation(result = {}) {
    if (!result || result.success === false || !hasVerifiedExecution(result)) return false;
    const count = resultCount(result);
    return count === null || count > 0;
}

function completedCapabilityNames(toolResults = [], options = {}) {
    const names = new Set();
    for (const item of toolResults || []) {
        if (isVerifiedPositiveObservation(item?.result)) names.add(item.name);
        if (options.acceptVerifiedEmpty && isVerifiedEmptyObservation(item?.result)) names.add(item.name);
    }
    return names;
}

module.exports = {
    completedCapabilityNames,
    isVerifiedEmptyObservation,
    isVerifiedPositiveObservation,
    resultCount,
};
