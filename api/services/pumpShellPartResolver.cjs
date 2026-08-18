function normalizePumpShellModel(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function describePumpShellModel(value) {
    const exact = normalizePumpShellModel(value);
    const base = exact.replace(/-\d+(?:\.\d+)?(?:mm|cm)?$/i, '');
    return {
        exact,
        base,
        hasDimensionSuffix: base !== exact,
    };
}

function findPumpShellPart(parts, shellModel) {
    const target = describePumpShellModel(shellModel);
    if (!target.exact) return null;
    const shellParts = (Array.isArray(parts) ? parts : [])
        .filter(part => String(part?.category || '').trim() === '泵壳');
    const exact = shellParts.find(part => (
        normalizePumpShellModel(part?.model) === target.exact
    ));
    if (exact) return exact;

    const compatible = shellParts.filter(part => {
        const candidate = describePumpShellModel(part?.model);
        return candidate.base === target.base
            && candidate.hasDimensionSuffix !== target.hasDimensionSuffix;
    });
    const distinctModels = new Set(
        compatible.map(part => normalizePumpShellModel(part?.model))
    );
    return distinctModels.size === 1 ? compatible[0] : null;
}

module.exports = {
    describePumpShellModel,
    findPumpShellPart,
    normalizePumpShellModel,
};
