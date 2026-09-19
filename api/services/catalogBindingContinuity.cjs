const { catalogSourceHash, readCatalogSource, readSnapshotPointer } = require('./catalogSources.cjs');
const { validBindingTarget, loadCatalogLiveContext } = require('./catalogLiveReferences.cjs');

const SOURCE_TYPES = Object.freeze({ parts: 'part', coils: 'coil', pump_shell_templates: 'template',
    recipes: 'recipe', pump_model_variants: 'modelVariant', quotations: 'quotation', orders: 'order',
    rotor_drawings: 'drawing', factory_file_links: 'fileLink' });

// Only an unchanged reference object may retain its verified identity. Checking
// its parent also rejects array reordering, supplier/ID changes and replacements
// that happen to use the same display name.
function retainCatalogBindings(dependencies, sourceType, before, options) {
    const { db, safeInsert, safeUpdate } = dependencies;
    if (!before || !db.prepare("SELECT name FROM sqlite_schema WHERE name='catalog_reference_bindings'").get()) return { auditIds: [], bindingIds: [] };
    const after = readCatalogSource(db, sourceType, before.id);
    const previousHash = catalogSourceHash(before);
    const nextHash = catalogSourceHash(after);
    if (!after || after.deleted_at || previousHash === nextHash) return { auditIds: [], bindingIds: [] };
    const bindings = db.prepare('SELECT * FROM catalog_reference_bindings WHERE source_type=? AND source_id=? AND source_hash=? AND deleted_at IS NULL').all(sourceType, before.id, previousHash);
    if (!bindings.length) return { auditIds: [], bindingIds: [] };
    const context = loadCatalogLiveContext(db);
    const audits = [];
    const bindingIds = [];
    for (const binding of bindings) {
        if (!validBindingTarget(context, sourceType, before, binding.source_path, previousHash)) continue;
        const parentPath = binding.source_path.slice(0, binding.source_path.lastIndexOf('/'));
        const previous = parentPath ? readSnapshotPointer(before, parentPath) : { found: true, value: before };
        const next = parentPath ? readSnapshotPointer(after, parentPath) : { found: true, value: after };
        if (!previous.found || !next.found || JSON.stringify(previous.value) !== JSON.stringify(next.value)) continue;
        const now = new Date().toISOString();
        const auditOptions = { ...options, requireAudit: true };
        const retired = safeUpdate('catalog_reference_bindings', binding.id, { deleted_at: now }, auditOptions);
        const created = safeInsert('catalog_reference_bindings', { source_type: sourceType, source_id: before.id,
            source_path: binding.source_path, source_hash: nextHash, source_version: `sha256:${nextHash}`,
            target_profile_id: binding.target_profile_id, target_spec_revision: binding.target_spec_revision,
            created_at: now, updated_at: now }, auditOptions);
        if (!retired.auditId || !created.auditId) throw new Error('引用续接缺少强审计');
        audits.push(retired.auditId, created.auditId);
        bindingIds.push(Number(created.lastInsertRowid));
    }
    return { auditIds: audits, bindingIds };
}

module.exports = { SOURCE_TYPES, retainCatalogBindings };
