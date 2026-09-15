const { auditCatalogReferences } = require('./catalogReferenceAudit.cjs');
const { requestHash, CommandExecutionError } = require('./commandExecution.cjs');
const { findPumpShellPart } = require('./pumpShellPartResolver.cjs');

function inspectPartRename(db, current, updates) {
    if (updates.model === undefined || updates.model === current.model) return null;
    const report = auditCatalogReferences(db);
    const references = report.references.filter(reference => reference.targetType === 'part'
        && (Number(reference.targetId) === Number(current.id)
            || reference.candidateIds.includes(Number(current.id))
            || (reference.model === current.model && (!reference.supplier || reference.supplier === current.supplier))));
    if (current.category === '泵壳') {
        for (const template of db.prepare('SELECT * FROM pump_shell_templates').all()) {
            if (findPumpShellPart([current], template.shell_model)
                && !references.some(ref => ref.sourceType === 'template' && ref.sourceId === template.id && ref.path === '/shell_model')) {
                references.push({ sourceType: 'template', sourceId: template.id, path: '/shell_model', status: 'legacy_shell_dependency' });
            }
        }
    }
    const bindingTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('catalog_identity_profiles', 'catalog_reference_bindings')").all();
    if (bindingTables.length === 2) {
        const bindings = db.prepare(`SELECT b.source_type, b.source_id, b.source_path
            FROM catalog_reference_bindings b JOIN catalog_identity_profiles p ON p.id = b.target_profile_id
            WHERE p.part_id = ? AND b.deleted_at IS NULL`).all(current.id);
        for (const binding of bindings) {
            if (!references.some(ref => ref.sourceType === binding.source_type && ref.sourceId === binding.source_id && ref.path === binding.source_path)) {
                references.push({ sourceType: binding.source_type, sourceId: binding.source_id, path: binding.source_path, status: 'bound_reference' });
            }
        }
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_template_shell_bindings'").get()) {
        for (const binding of db.prepare('SELECT template_id FROM catalog_template_shell_bindings WHERE shell_part_id = ?').all(current.id)) {
            if (!references.some(ref => ref.sourceType === 'template' && ref.sourceId === binding.template_id && ref.path === '/shell_model')) {
                references.push({ sourceType: 'template', sourceId: binding.template_id, path: '/shell_model', status: 'bound_shell_reference' });
            }
        }
    }
    const impact = {
        partId: Number(current.id), previousName: current.model, proposedName: updates.model,
        complete: report.complete,
        referenceCount: references.length,
        references: references.map(({ sourceType, sourceId, path, status }) => ({ sourceType, sourceId, path, status })),
        // Only a concurrency token, never proof of complete physical specifications.
        sourceHash: requestHash({ sources: report.sourceHashes, errors: report.errors }),
    };
    if (!report.complete) throw new CommandExecutionError('PART_RENAME_AUDIT_INCOMPLETE', '引用检查不完整，暂不能修改型号；其他资料可单独保存', 409);
    const duplicate = db.prepare(`SELECT id FROM parts WHERE id != ? AND deleted_at IS NULL
        AND lower(trim(model)) = lower(trim(?)) AND lower(trim(supplier)) = lower(trim(?)) LIMIT 1`)
        .get(current.id, updates.model, updates.supplier ?? current.supplier);
    if (duplicate) throw new CommandExecutionError('PART_RENAME_NAME_CONFLICT', '该型号和供应商已有零件，请使用现有记录或补充真实规格区别', 409);
    if (references.length) {
        const error = new CommandExecutionError('PART_RENAME_REFERENCES_REQUIRE_MIGRATION',
            `该零件有 ${references.length} 处引用，需完成引用迁移后再改名；其他资料可单独保存`, 409);
        error.details = impact;
        throw error;
    }
    return impact;
}

function verifyPartRename(db, current, updates, expectedImpact) {
    const impact = inspectPartRename(db, current, updates);
    if (expectedImpact && impact?.sourceHash !== expectedImpact.sourceHash) {
        throw new CommandExecutionError('PART_RENAME_SOURCE_CHANGED', '引用数据在预览后发生变化，请重新预览', 409);
    }
    return impact;
}

module.exports = { inspectPartRename, verifyPartRename };
