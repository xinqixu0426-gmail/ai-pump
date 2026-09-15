const { z } = require('zod');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const CAPABILITY_ID = requireBusinessCapability('catalog.references_resolve').capabilityId;

// Static SQL per resource type, bounded before transfer. No per-row database
// lookups, display-name matching, catalog-cache mutation or snapshot writeback.
const QUERIES = {
    part: `SELECT p.id, p.model AS currentName, p.deleted_at AS deletedAt,
        n.naming_state AS namingState, n.name_revision AS nameRevision, n.spec_revision AS specRevision
        FROM parts p LEFT JOIN catalog_identity_profiles n ON n.part_id = p.id
        WHERE p.id IN (SELECT value FROM json_each(?))`,
    coil: `SELECT p.id, p.scheme_name AS currentName, p.scheme_status AS schemeStatus,
        n.naming_state AS namingState, n.name_revision AS nameRevision, n.spec_revision AS specRevision
        FROM coils p LEFT JOIN catalog_identity_profiles n ON n.coil_id = p.id
        WHERE p.id IN (SELECT value FROM json_each(?))`,
    template: `SELECT p.id, p.shell_model AS currentName, NULL AS deletedAt,
        n.naming_state AS namingState, n.name_revision AS nameRevision, n.spec_revision AS specRevision
        FROM pump_shell_templates p LEFT JOIN catalog_identity_profiles n ON n.template_id = p.id
        WHERE p.id IN (SELECT value FROM json_each(?))`,
    recipe: `SELECT p.id, p.name AS currentName, p.deleted_at AS deletedAt,
        n.naming_state AS namingState, n.name_revision AS nameRevision, n.spec_revision AS specRevision
        FROM recipes p LEFT JOIN catalog_identity_profiles n ON n.recipe_id = p.id
        WHERE p.id IN (SELECT value FROM json_each(?))`,
    modelVariant: `SELECT p.id, p.model_name AS currentName, p.deleted_at AS deletedAt,
        n.naming_state AS namingState, n.name_revision AS nameRevision, n.spec_revision AS specRevision
        FROM pump_model_variants p LEFT JOIN catalog_identity_profiles n ON n.model_variant_id = p.id
        WHERE p.id IN (SELECT value FROM json_each(?))`,
};
const INPUT_SCHEMA = z.object({ references: z.array(z.object({
    entityType: z.enum(['part', 'coil', 'template', 'recipe', 'modelVariant']),
    entityId: z.number().int().positive().safe(),
    snapshotName: z.string().max(500).optional(),
    specRevision: z.number().int().positive().safe().optional(),
}).strict()).max(100) }).strict();

function resolveCatalogReferences(db, input) {
    const parsed = INPUT_SCHEMA.safeParse(input);
    if (!parsed.success) {
        const error = new Error('引用必须包含有效对象类型和 ID，单次最多 100 项');
        error.code = 'CATALOG_REFERENCES_INVALID';
        error.statusCode = 400;
        error.details = parsed.error.issues;
        throw error;
    }
    return db.transaction(() => {
        const references = parsed.data.references;
        const records = new Map();
        for (const [entityType, sql] of Object.entries(QUERIES)) {
            const ids = [...new Set(references.filter(ref => ref.entityType === entityType).map(ref => ref.entityId))];
            if (ids.length === 0) continue;
            for (const row of db.prepare(sql).all(JSON.stringify(ids))) records.set(`${entityType}:${row.id}`, row);
        }
        return { sourceOfTruth: CAPABILITY_ID, items: references.map(reference => {
            const row = records.get(`${reference.entityType}:${reference.entityId}`);
            let referenceStatus = 'resolved';
            if (!row) referenceStatus = 'missing';
            else if (row.deletedAt || (reference.entityType === 'coil' && row.schemeStatus !== 'official')) referenceStatus = 'inactive';
            else if (reference.specRevision != null) {
                if (row.namingState !== 'structured') referenceStatus = 'specification_unverified';
                else if (row.specRevision !== reference.specRevision) referenceStatus = 'specification_changed';
            }
            return { entityType: reference.entityType, entityId: reference.entityId,
                snapshotName: reference.snapshotName ?? null, currentName: row?.currentName ?? null,
                referenceStatus, nameRevision: row?.nameRevision ?? null, specRevision: row?.specRevision ?? null,
                namingState: row?.namingState ?? (row ? 'legacy' : null) };
        }) };
    }).deferred();
}

module.exports = { resolveCatalogReferences };
