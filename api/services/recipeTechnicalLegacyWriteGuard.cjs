// O4-F-G guarded legacy boundary.  Canonical child-row ownership prevents
// formal legacy Recipe updates from becoming a second technical authority.
const PROTECTED_TECHNICAL_FIELDS = Object.freeze([
    'technical_data_json',
    'custom_barrel_length',
    'impeller_thickness',
    'impeller_model',
    'impeller_diameter',
    'impeller_blade_count',
]);

function parseObject(raw) {
    try {
        const parsed = JSON.parse(raw || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed : null;
    } catch {
        return null;
    }
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sameLegacyValue(field, current, proposed) {
    if (field === 'technical_data_json') {
        if (current === proposed) return true;
        const currentObject = parseObject(current);
        const proposedObject = parseObject(proposed);
        // A malformed legacy object cannot be safely normalized/repaired by a
        // canonical-owned legacy writer.  Treat attempted replacement as change.
        if (!currentObject || !proposedObject) return false;
        return canonicalJson(currentObject) === canonicalJson(proposedObject);
    }
    if (current == null || proposed == null) return current == null && proposed == null;
    return current === proposed;
}

function canonicalOwnership(db, recipeId) {
    const rows = db.prepare(`
        SELECT
            EXISTS(SELECT 1 FROM recipe_functional_technical_profiles WHERE recipe_id = ?) AS functional_present,
            EXISTS(SELECT 1 FROM recipe_technical_knowledge WHERE recipe_id = ?) AS knowledge_present
    `).get(recipeId, recipeId);
    return {
        functionalPresent: Boolean(rows?.functional_present),
        technicalKnowledgePresent: Boolean(rows?.knowledge_present),
        canonicalOwned: Boolean(rows?.functional_present || rows?.knowledge_present),
    };
}

function inspectLegacyTechnicalMutation({ db, recipeId, currentRecipe, normalizedRecipePayload, freezeEnabled }) {
    if (!freezeEnabled) {
        return { canonicalOwned: false, changedProtectedFields: [], allowed: true, reason: 'FREEZE_DISABLED' };
    }
    const ownership = canonicalOwnership(db, recipeId);
    if (!ownership.canonicalOwned) {
        return { ...ownership, changedProtectedFields: [], allowed: true, reason: 'CANONICAL_STORAGE_ABSENT' };
    }
    const changedProtectedFields = PROTECTED_TECHNICAL_FIELDS.filter(field => !sameLegacyValue(
        field,
        currentRecipe?.[field],
        normalizedRecipePayload?.[field],
    ));
    return {
        ...ownership,
        changedProtectedFields,
        allowed: changedProtectedFields.length === 0,
        reason: changedProtectedFields.length === 0 ? 'NO_PROTECTED_CHANGE' : 'CANONICAL_AUTHORITY_FROZEN',
    };
}

module.exports = {
    PROTECTED_TECHNICAL_FIELDS,
    inspectLegacyTechnicalMutation,
    sameLegacyValue,
};
