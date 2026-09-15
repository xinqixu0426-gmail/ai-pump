const { requestHash, CommandExecutionError } = require('./commandExecution.cjs');
function physicalSpecification(type, row, naming) {
    const spec = { ...naming.spec }; delete spec.variant;
    // Capture all persisted engineering/configuration fields, excluding prices,
    // stock, timestamps, labels and naming metadata. No claim that naming alone proves identity.
    const excluded = new Set(['id', 'model', 'name', 'shell_model', 'scheme_name', 'model_name', 'spec', 'description', 'note', 'remark',
        'stock', 'price', 'pricing_mode', 'copper_base', 'coil_fee', 'rotor_fee', 'unit_price', 'kit_price', 'is_default', 'bundle_cost', 'assembly_wage', 'packing_wage', 'painting_wage', 'surface_treatment_cost', 'management_fee', 'cost', 'saved_total_cost', 'saved_cost_details', 'created_at', 'updated_at', 'deleted_at', 'naming_json']);
    if (type === 'coil') excluded.delete('spec');
    const fields = Object.fromEntries(Object.entries(row).filter(([key]) => !excluded.has(key)));
    if (type === 'part') {
        fields.engineering = {};
        let metadata;
        try { metadata = JSON.parse(row.remark || '{}'); } catch { metadata = null; }
        if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
            const omit = new Set(['cableAccessoryFee', 'cableAccessoryFees', 'cableAccessoryNames',
                'autoCreatedFrom', 'recipeName', 'modelVariantName', 'screwPricingModel', 'screwPricingSupplier']);
            fields.engineering = Object.fromEntries(Object.entries(metadata).filter(([key]) => !omit.has(key)));
        }
    }
    return { namingSpec: spec, fields: ['part', 'coil'].includes(type) ? fields : {} };
}
function assertCatalogPhysicalUpdate(db, type, current, updates) {
    if (!db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='catalog_identity_profiles'").get()) return;
    const key = { part: 'part_id', coil: 'coil_id', template: 'template_id', recipe: 'recipe_id', modelVariant: 'model_variant_id' }[type];
    const profile = db.prepare(`SELECT * FROM catalog_identity_profiles WHERE ${key} = ? AND naming_state = 'structured'`).get(current.id);
    if (!profile) return;
    const stored = JSON.parse(profile.spec_json);
    const name = { part: 'model', coil: 'scheme_name', template: 'shell_model', recipe: 'name', modelVariant: 'model_name' }[type];
    if (updates[name] !== undefined && updates[name] !== current[name]) throw new CommandExecutionError('CATALOG_RENAME_COMMAND_REQUIRED', '整理名称请使用按规格规范名称', 409);
    if (['part', 'coil'].includes(type) && stored.physical && requestHash(physicalSpecification(type, { ...current, ...updates }, stored.naming)) !== profile.spec_fingerprint) throw new CommandExecutionError('CATALOG_SPECIFICATION_REPLACEMENT_REQUIRED', '已规范物料的实物规格变化必须新建记录，不能原地改变引用身份', 409);
}
function physicalProfileMatches(profile, type, row) {
    const stored = JSON.parse(profile.spec_json);
    if (!stored.physical) return true;
    let naming = stored.naming;
    if (type === 'part' && row.naming_json) {
        const actual = JSON.parse(row.naming_json);
        const generated = require('./catalogNaming.cjs').generateCatalogName({ ruleId: actual.ruleId, spec: actual.spec });
        naming = { ...actual, spec: generated.normalizedSpec };
    }
    return requestHash(physicalSpecification(type, row, naming)) === profile.spec_fingerprint;
}
module.exports = { physicalProfileMatches, physicalSpecification, assertCatalogPhysicalUpdate };
