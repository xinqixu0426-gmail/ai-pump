// Canonical Recipe technical storage deliberately uses fixed SQL keyed by
// recipe_id. These one-to-one tables do not have an `id` column and must not
// be routed through the generic id-keyed safeInsert/safeUpdate helpers.

const PROFILE_COLUMNS = Object.freeze([
    'recipe_id', 'rotor_diameter', 'stack_offset', 'oil_seal_diameter',
    'impeller_bore_diameter', 'impeller_span', 'impeller_thickness',
    'thread_length', 'thread_diameter', 'barrel_length', 'open_offset',
    'bearing_span_explicit', 'upper_bearing_part_id', 'lower_bearing_part_id',
    'schema_version', 'completeness_state', 'migration_state',
    'migration_version', 'migration_fingerprint', 'provenance_json',
    'legacy_evidence_json', 'created_at', 'updated_at',
]);

const KNOWLEDGE_COLUMNS = Object.freeze([
    'recipe_id', 'schema_version', 'items_json', 'created_at', 'updated_at',
]);

const PROFILE_SELECT_SQL = `
    SELECT ${PROFILE_COLUMNS.join(', ')}
    FROM recipe_functional_technical_profiles WHERE recipe_id = ?
`;
const KNOWLEDGE_SELECT_SQL = `
    SELECT ${KNOWLEDGE_COLUMNS.join(', ')}
    FROM recipe_technical_knowledge WHERE recipe_id = ?
`;

const PROFILE_INSERT_SQL = `
    INSERT INTO recipe_functional_technical_profiles (${PROFILE_COLUMNS.join(', ')})
    VALUES (${PROFILE_COLUMNS.map(column => `@${column}`).join(', ')})
`;
const PROFILE_UPDATE_COLUMNS = PROFILE_COLUMNS.filter(column => !['recipe_id', 'created_at'].includes(column));
const PROFILE_UPDATE_SQL = `
    UPDATE recipe_functional_technical_profiles
    SET ${PROFILE_UPDATE_COLUMNS.map(column => `${column} = @${column}`).join(', ')}
    WHERE recipe_id = @recipe_id
`;
const KNOWLEDGE_INSERT_SQL = `
    INSERT INTO recipe_technical_knowledge (${KNOWLEDGE_COLUMNS.join(', ')})
    VALUES (${KNOWLEDGE_COLUMNS.map(column => `@${column}`).join(', ')})
`;
const KNOWLEDGE_UPDATE_COLUMNS = KNOWLEDGE_COLUMNS.filter(column => !['recipe_id', 'created_at'].includes(column));
const KNOWLEDGE_UPDATE_SQL = `
    UPDATE recipe_technical_knowledge
    SET ${KNOWLEDGE_UPDATE_COLUMNS.map(column => `${column} = @${column}`).join(', ')}
    WHERE recipe_id = @recipe_id
`;

function getFunctionalProfile(db, recipeId) {
    return db.prepare(PROFILE_SELECT_SQL).get(recipeId) || null;
}

function getTechnicalKnowledge(db, recipeId) {
    return db.prepare(KNOWLEDGE_SELECT_SQL).get(recipeId) || null;
}

function rowEquals(left, right, columns) {
    return columns.every(column => (left?.[column] ?? null) === (right?.[column] ?? null));
}

function persistFunctionalProfile(db, desired) {
    const before = getFunctionalProfile(db, desired.recipe_id);
    if (before && rowEquals(before, desired, PROFILE_COLUMNS.filter(column => column !== 'updated_at'))) {
        return { before, after: before, changed: false, action: null };
    }
    if (before) db.prepare(PROFILE_UPDATE_SQL).run(desired);
    else db.prepare(PROFILE_INSERT_SQL).run(desired);
    const after = getFunctionalProfile(db, desired.recipe_id);
    return { before, after, changed: true, action: before ? 'UPDATE' : 'INSERT' };
}

function persistTechnicalKnowledge(db, desired) {
    const before = getTechnicalKnowledge(db, desired.recipe_id);
    if (before && rowEquals(before, desired, KNOWLEDGE_COLUMNS.filter(column => column !== 'updated_at'))) {
        return { before, after: before, changed: false, action: null };
    }
    if (before) db.prepare(KNOWLEDGE_UPDATE_SQL).run(desired);
    else db.prepare(KNOWLEDGE_INSERT_SQL).run(desired);
    const after = getTechnicalKnowledge(db, desired.recipe_id);
    return { before, after, changed: true, action: before ? 'UPDATE' : 'INSERT' };
}

function writeRecipeTechnicalAudit(db, action, tableName, recipeId, before, after, context = {}, now = new Date()) {
    const info = db.prepare(`
        INSERT INTO audit_log (
            action, table_name, record_id, old_value, new_value, user,
            request_id, operation_id, capability_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        action,
        tableName,
        recipeId,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        String(context.user || 'system'),
        context.requestId || null,
        context.operationId || null,
        context.capabilityId || null,
        new Date(now).toISOString()
    );
    return Number(info.lastInsertRowid);
}

module.exports = {
    KNOWLEDGE_COLUMNS,
    PROFILE_COLUMNS,
    getFunctionalProfile,
    getTechnicalKnowledge,
    persistFunctionalProfile,
    persistTechnicalKnowledge,
    writeRecipeTechnicalAudit,
};
