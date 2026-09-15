const { catalogSourceHash, readCatalogSource } = require('./catalogSources.cjs');
const { resolveSavedCatalogPartIdentity } = require('./bomPartIdentity.cjs');
const { bearingCodeOf } = require('./catalogSpec.cjs');
const { physicalProfileMatches } = require('./catalogPhysicalIdentity.cjs');
const HYDRATED = Symbol('catalogHydrated');
const ORIGINAL = Symbol('catalogSnapshot');
const RESOURCES = Object.freeze({
    part: { table: 'parts', name: 'model', profile: 'part_id' },
    coil: { table: 'coils', name: 'scheme_name', profile: 'coil_id' },
    template: { table: 'pump_shell_templates', name: 'shell_model', profile: 'template_id' },
    recipe: { table: 'recipes', name: 'name', profile: 'recipe_id' },
    modelVariant: { table: 'pump_model_variants', name: 'model_name', profile: 'model_variant_id' },
});
const JSON_FIELDS = Object.freeze({ part: ['remark'], template: ['parts_json', 'shell_components_json', 'rotor_params_json', 'configuration_policy_json'],
    recipe: ['parts_json', 'extra_parts_json', 'packing_parts_json', 'configuration_policy_json'],
    modelVariant: ['custom_fields_json'], quotation: ['items_json'], order: ['items_json', 'purchase_list_json', 'todos_json'] });
const ID_FIELDS = { partId: 'part', coilId: 'coil', recipeId: 'recipe', templateId: 'template', shellPartId: 'part', modelVariantId: 'modelVariant' };
const NAME_FIELDS = { recipeName: 'recipe', modelVariantName: 'modelVariant' };
const escape = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
function loadCatalogLiveContext(db) {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
    const catalogs = new Map(Object.entries(RESOURCES).map(([type, descriptor]) => [type,
        tables.has(descriptor.table) ? db.prepare(`SELECT * FROM ${descriptor.table}`).all() : []]));
    const profiles = tables.has('catalog_identity_profiles') ? db.prepare('SELECT * FROM catalog_identity_profiles').all() : [];
    const bindings = tables.has('catalog_reference_bindings') ? db.prepare('SELECT * FROM catalog_reference_bindings WHERE deleted_at IS NULL').all() : [];
    const shells = tables.has('catalog_template_shell_bindings') ? db.prepare('SELECT * FROM catalog_template_shell_bindings').all() : [];
    return { catalogs, profiles, bindings, shells };
}
function validBindingTarget(context, sourceType, row, path, hash) {
    const candidates = context.bindings.filter(binding => binding.source_type === sourceType && binding.source_id === row.id
        && binding.source_path === path && binding.source_hash === hash && binding.source_version === `sha256:${hash}`);
    if (candidates.length !== 1) return null;
    const binding = candidates[0];
    const profile = context.profiles.find(item => item.id === binding.target_profile_id);
    if (!profile || profile.naming_state !== 'structured' || profile.spec_revision !== binding.target_spec_revision || !JSON.parse(profile.spec_json).physical) return null;
    const type = Object.keys(RESOURCES).find(key => profile[RESOURCES[key].profile] != null);
    const target = context.catalogs.get(type)?.find(row => row.id === profile[RESOURCES[type].profile]);
    if (!target || !physicalProfileMatches(profile, type, target)) return null;
    return { type, id: profile[RESOURCES[type].profile] };
}
function hydrateCatalogRow(db, type, source, suppliedContext) {
    if (!source || source[HYDRATED]) return source;
    const context = suppliedContext || loadCatalogLiveContext(db);
    // The hash always uses the persisted full source, never a partial SELECT or a hydrated DTO.
    const original = context.sourceRows?.get(`${type}:${source.id}`) || context.catalogs.get(type)?.find(row => row.id === source.id) || readCatalogSource(db, type, source.id) || source;
    const hash = catalogSourceHash(original);
    function target(type, id) {
        const row = context.catalogs.get(type)?.find(item => item.id === Number(id));
        const profile = context.profiles.find(item => item[RESOURCES[type].profile] === Number(id));
        if (row && profile?.naming_state === 'structured' && !physicalProfileMatches(profile, type, row)) throw Object.assign(new Error('引用物料的实物规格已经变化，需要重新核实身份'), { code: 'CATALOG_SPECIFICATION_CHANGED', statusCode: 422 });
        return row && !row.deleted_at && (type !== 'coil' || row.scheme_status === 'official') ? row : null;
    }
    function walk(value, path, depth = 0) {
        if (depth > 40) return value;
        if (Array.isArray(value)) return value.map((item, index) => walk(item, `${path}/${index}`, depth + 1));
        if (!value || typeof value !== 'object') return value;
        const copy = { ...value };
        for (const [key, item] of Object.entries(value)) {
            if (typeof item === 'string' && /Json$|_json$/.test(key)) {
                let parsed;
                try { parsed = JSON.parse(item); } catch { continue; }
                copy[key] = JSON.stringify(walk(parsed, `${path}/${escape(key)}`, depth + 1));
            } else if (item && typeof item === 'object') copy[key] = walk(item, `${path}/${escape(key)}`, depth + 1);
        }
        if (value.model && value.inventoryType !== 'none') {
            const coil = value.coilId != null || value.inventoryType === 'coil' || value.costRole === 'coil';
            const binding = validBindingTarget(context, type, original, `${path}/model`, hash);
            const entityType = coil ? 'coil' : 'part';
            const id = value[coil ? 'coilId' : 'partId'] ?? (binding?.type === entityType ? binding.id : null);
            if (id != null) {
                const record = target(entityType, id);
                if (record && (entityType !== 'part' || !value.supplier || value.supplier === record.supplier)) {
                    const currentName = record[RESOURCES[entityType].name];
                    copy[coil ? 'coilId' : 'partId'] = id;
                    if (currentName !== value.model) copy.snapshotName = value.snapshotName ?? value.model;
                    copy.model = currentName;
                    if (value.name === value.model) copy.name = currentName;
                }
            }
        }
        for (const [nameField, entityType] of Object.entries(NAME_FIELDS)) {
            const idField = Object.keys(ID_FIELDS).find(key => ID_FIELDS[key] === entityType);
            const bound = validBindingTarget(context, type, original, `${path}/${nameField}`, hash);
            const id = value[idField] ?? (bound?.type === entityType ? bound.id : null);
            const record = id != null ? target(entityType, id) : null;
            if (record) { copy[`snapshot${nameField[0].toUpperCase()}${nameField.slice(1)}`] = value[nameField]; copy[nameField] = record[RESOURCES[entityType].name]; copy[idField] = id; }
        }
        for (const field of ['defaultUpperBearing', 'defaultLowerBearing', 'screwPricingModel']) {
            const bound = validBindingTarget(context, type, original, `${path}/${field}`, hash);
            const savedId = value[field === 'screwPricingModel' ? 'screwPricingPartId' : `${field}PartId`];
            let record = savedId != null ? target('part', savedId) : bound?.type === 'part' ? target('part', bound.id) : null;
            if (record && /^default/.test(field) && record.category !== '轴承') record = null;
            if (savedId == null && !record && /^default(?:Upper|Lower)Bearing$/.test(field) && value[field]) {
                const candidates = context.catalogs.get('part').filter(part => part.category === '轴承' && !part.deleted_at && bearingCodeOf(part) === bearingCodeOf({ model: value[field] }));
                if (candidates.length === 1) record = candidates[0];
            }
            if (record) copy[field] = record.model;
        }
        return copy;
    }
    const row = { ...source };
    if (type === 'recipe') {
        const profile = context.profiles.find(item => item.recipe_id === source.id);
        row.external_model = profile?.external_model || original.name;
    }
    for (const key of JSON_FIELDS[type] || []) {
        if (source[key] == null || source[key] === '') continue;
        let parsed;
        try { parsed = JSON.parse(source[key]); } catch { continue; }
        row[key] = JSON.stringify(walk(parsed, `/${key}`));
    }
    if (type === 'template') {
        const binding = context.shells.find(item => item.template_id === row.id);
        if (binding) row.shell_part_id = binding.shell_part_id;
    }
    Object.defineProperty(row, HYDRATED, { value: true });
    Object.defineProperty(row, ORIGINAL, { value: original });
    return row;
}
function hydrateCatalogRows(db, type, rows) {
    const context = loadCatalogLiveContext(db);
    context.sourceRows = new Map(rows.map(row => [`${type}:${row.id}`, row[ORIGINAL] || row]));
    return rows.map(row => hydrateCatalogRow(db, type, row, context));
}
// A persisted purchase/BOM reference may retain an old display label. Its ID and
// supplier are checked against the current catalog; callers never expose this as a request switch.
function assertSavedPurchasePart(db, item) {
    const catalog = db.prepare('SELECT * FROM parts WHERE deleted_at IS NULL').all();
    return resolveSavedCatalogPartIdentity(catalog, item);
}
function catalogSnapshot(row) { return row[ORIGINAL] || row; }
module.exports = { catalogSnapshot, RESOURCES, loadCatalogLiveContext, validBindingTarget, hydrateCatalogRow, hydrateCatalogRows, assertSavedPurchasePart };
