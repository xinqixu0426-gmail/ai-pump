'use strict';

const { validateAiToolArgs } = require('../aiToolInputValidatorV2.cjs');

function bindReadArguments(entry, entity, authoritativeCandidate = null) {
    const unsupported = () => ({ status: 'ARGUMENT_BINDING_UNSUPPORTED', arguments: null });
    if (!entity || entity.entityType !== entry?.entityType || !entity.resolutionReceiptRef
        || entity.canonicalEntityId === null || entity.canonicalEntityId === undefined) return unsupported();
    let args;
    if (entry.argumentContract === 'CANONICAL_RECIPE_ID_NO_OVERRIDES') {
        const id = entity.canonicalEntityId;
        if (!(typeof id === 'number' || (typeof id === 'string' && /^[1-9][0-9]*$/.test(id)))) return unsupported();
        if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) return unsupported();
        args = { recipeId: Number(id) };
    } else if (entry.argumentContract === 'SOURCE_EXACT_PART_KEYWORD') {
        if (typeof entity.rawMention !== 'string' || !entity.rawMention.length
            || entity.rawMention.trim() !== entity.rawMention) return unsupported();
        args = { keyword: entity.rawMention };
    } else if (entry.argumentContract === 'AUTHORITATIVE_SCHEME_CODE') {
        const candidate = authoritativeCandidate;
        if (candidate?.entityType !== entity.entityType || candidate?.canonicalId !== String(entity.canonicalEntityId)
            || !['EXACT', 'APPROVED_ALIAS'].includes(candidate?.matchKind)
            || !Array.isArray(candidate.bindingRefs) || candidate.bindingRefs.length !== 1) return unsupported();
        const ref = candidate.bindingRefs[0];
        if (!ref || Object.keys(ref).sort().join(',') !== 'kind,value' || ref.kind !== 'schemeCode'
            || typeof ref.value !== 'string' || !ref.value.length || ref.value.trim() !== ref.value) return unsupported();
        args = { schemeCode: ref.value };
    } else return unsupported();
    try {
        const validated = validateAiToolArgs(entry.toolName, args);
        // Existing schema normalization cannot silently change our source-owned argument.
        if (JSON.stringify(validated) !== JSON.stringify(args)) return unsupported();
        return { status: 'VALIDATED', arguments: Object.freeze(validated) };
    } catch { return unsupported(); }
}

module.exports = { bindReadArguments };
