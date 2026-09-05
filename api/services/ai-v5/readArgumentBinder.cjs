'use strict';

const { validateAiToolArgs } = require('../aiToolInputValidatorV2.cjs');

function bindReadArguments(entry, entity) {
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
    } else return unsupported();
    try {
        const validated = validateAiToolArgs(entry.toolName, args);
        // Existing schema normalization cannot silently change our source-owned argument.
        if (JSON.stringify(validated) !== JSON.stringify(args)) return unsupported();
        return { status: 'VALIDATED', arguments: Object.freeze(validated) };
    } catch { return unsupported(); }
}

module.exports = { bindReadArguments };
