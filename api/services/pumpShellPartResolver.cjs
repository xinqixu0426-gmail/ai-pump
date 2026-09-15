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

function matchingPumpShellParts(parts, shellModel) {
    const target = describePumpShellModel(shellModel);
    if (!target.exact) return [];
    const shellParts = (Array.isArray(parts) ? parts : [])
        .filter(part => String(part?.category || '').trim() === '泵壳' && !part.deletedAt && !part.deleted_at);
    const exact = shellParts.filter(part => (
        normalizePumpShellModel(part?.model) === target.exact
    ));
    if (exact.length) return exact;

    const compatible = shellParts.filter(part => {
        const candidate = describePumpShellModel(part?.model);
        return candidate.base === target.base
            && candidate.hasDimensionSuffix !== target.hasDimensionSuffix;
    });
    return compatible;
}

function findPumpShellPart(parts, shellModel) {
    const matches = matchingPumpShellParts(parts, shellModel);
    return matches.length === 1 ? matches[0] : null;
}

function resolvePumpShellPart(parts, shellModel) {
    const matches = matchingPumpShellParts(parts, shellModel);
    if (matches.length > 1) {
        throw Object.assign(new Error(`泵壳“${shellModel}”匹配到多个零件，请核对模板关联，不能自动带入参数`), {
            code: 'PUMP_SHELL_PART_AMBIGUOUS', statusCode: 409,
            details: { candidates: matches.map(part => ({ partId: part.id, model: part.model, supplier: part.supplier || '' })) },
        });
    }
    return matches[0] || null;
}

module.exports = {
    describePumpShellModel,
    findPumpShellPart,
    normalizePumpShellModel,
    resolvePumpShellPart,
};
