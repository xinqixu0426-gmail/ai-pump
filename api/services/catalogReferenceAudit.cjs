const { catalogSourceHash: hash } = require('./catalogSources.cjs');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { bearingCodeOf } = require('./catalogSpec.cjs');
const { buildNamingCandidates } = require('./catalogNamingCandidates.cjs');
const { calculateRecipeCost } = require('./costEngine.cjs');

const CAPABILITY_ID = requireBusinessCapability('catalog.reference_audit').capabilityId;

// Explicit source boundaries: never scan credentials, arbitrary knowledge or file blobs.
const SOURCES = Object.freeze([
    { type: 'part', table: 'parts', sql: 'SELECT * FROM parts ORDER BY id LIMIT ?', json: ['remark'] },
    { type: 'coil', table: 'coils', sql: 'SELECT * FROM coils ORDER BY id LIMIT ?', json: [] },
    { type: 'stator', table: 'stator_variants', sql: 'SELECT * FROM stator_variants ORDER BY id LIMIT ?', json: [] },
    { type: 'template', table: 'pump_shell_templates', sql: 'SELECT * FROM pump_shell_templates ORDER BY id LIMIT ?', json: ['parts_json', 'shell_components_json', 'rotor_params_json', 'configuration_policy_json'] },
    { type: 'recipe', table: 'recipes', sql: 'SELECT * FROM recipes ORDER BY id LIMIT ?', json: ['parts_json', 'extra_parts_json', 'packing_parts_json', 'configuration_policy_json'] },
    { type: 'modelVariant', table: 'pump_model_variants', sql: 'SELECT * FROM pump_model_variants ORDER BY id LIMIT ?', json: ['custom_fields_json'] },
    { type: 'quotation', table: 'quotations', sql: 'SELECT * FROM quotations ORDER BY id LIMIT ?', json: ['items_json'] },
    { type: 'order', table: 'orders', sql: 'SELECT * FROM orders ORDER BY id LIMIT ?', json: ['items_json', 'purchase_list_json', 'todos_json'] },
    { type: 'orderRevision', table: 'order_revisions', sql: 'SELECT * FROM order_revisions ORDER BY id LIMIT ?', json: ['before_snapshot_json', 'after_snapshot_json'] },
    { type: 'drawing', table: 'rotor_drawings', sql: 'SELECT id, drawing_name, linked_pump_model, params_json, status, updated_at FROM rotor_drawings ORDER BY id LIMIT ?', json: ['params_json'] },
    { type: 'fileLink', table: 'factory_file_links', sql: 'SELECT * FROM factory_file_links ORDER BY id LIMIT ?', json: [] },
]);

const ID_KEYS = Object.freeze({
    partId: 'part', coilId: 'coil', recipeId: 'recipe', templateId: 'template',
    shellPartId: 'part', modelVariantId: 'modelVariant', statorVariantId: 'stator',
    part_id: 'part', coil_id: 'coil', recipe_id: 'recipe', template_id: 'template',
    model_variant_id: 'modelVariant', stator_variant_id: 'stator',
});
const NAME_KEYS = Object.freeze({ recipeName: 'recipe', shellModel: 'part', modelVariantName: 'modelVariant', screwPricingModel: 'part' });
const BEARING_KEYS = new Set(['defaultUpperBearing', 'defaultLowerBearing']);
const NESTED_JSON_KEYS = new Set([
    'partsJson', 'parts_json', 'itemsJson', 'items_json', 'purchaseListJson', 'purchase_list_json',
    'extraPartsJson', 'packingPartsJson', 'configurationPolicyJson', 'configuration_policy_json',
]);
const NON_INVENTORY_ROLES = new Set(['rotorProcess']);

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function pointer(key) { return String(key).replaceAll('~', '~0').replaceAll('/', '~1'); }
function positiveId(value) {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
    return Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
}
function inactive(row, type) { return Boolean(row.deleted_at) || (type === 'coil' && row.scheme_status !== 'official'); }

function validateOptions(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('盘点参数必须是对象');
    for (const key of Object.keys(options)) {
        if (!['maxRowsPerTable', 'maxReferences'].includes(key)) throw new Error(`未知盘点参数：${key}`);
    }
    const maxRowsPerTable = options.maxRowsPerTable ?? 10000;
    const maxReferences = options.maxReferences ?? 100000;
    for (const [key, value, max] of [['maxRowsPerTable', maxRowsPerTable, 50000], ['maxReferences', maxReferences, 500000]]) {
        if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${key} 必须是 1-${max} 的整数`);
    }
    return { maxRowsPerTable, maxReferences };
}

function resolveReference(catalogs, reference) {
    const rows = catalogs.get(reference.targetType) || [];
    const wantedId = positiveId(reference.targetId);
    if (reference.targetId != null && !wantedId) return { status: 'invalid_id', candidateIds: [] };
    const names = row => reference.targetType === 'part' ? [row.model]
        : reference.targetType === 'recipe' ? [row.name]
            : reference.targetType === 'template' ? [row.shell_model]
                : reference.targetType === 'modelVariant' ? [row.model_name]
                    : reference.targetType === 'coil' ? [row.scheme_name, row.scheme_code, `${row.spec}-${row.sheets}`] : [];
    if (wantedId) {
        const row = rows.find(item => item.id === wantedId);
        if (!row) return { status: 'missing', candidateIds: [] };
        if (inactive(row, reference.targetType)) return { status: 'inactive', candidateIds: [wantedId] };
        if (reference.model && !names(row).includes(reference.model)) return { status: 'identity_mismatch', candidateIds: [wantedId] };
        return { status: 'resolved_id', candidateIds: [wantedId] };
    }
    if (!reference.model) return { status: 'unstructured', candidateIds: [] };
    let candidates = rows.filter(row => names(row).includes(reference.model) || reference.category === '轴承' && row.category === '轴承' && bearingCodeOf(row) === bearingCodeOf({ model: reference.model }));
    if (reference.supplier) candidates = candidates.filter(row => row.supplier === reference.supplier);
    if (reference.category) candidates = candidates.filter(row => row.category === reference.category);
    if (reference.targetType === 'coil') {
        if (reference.material) candidates = candidates.filter(row => row.material === reference.material);
        if (reference.slotType) candidates = candidates.filter(row => row.slot_type === reference.slotType);
    }
    const active = candidates.filter(row => !inactive(row, reference.targetType));
    return {
        status: active.length === 1 ? 'resolved_legacy' : active.length > 1 ? 'ambiguous' : candidates.length ? 'inactive' : 'missing',
        candidateIds: (active.length ? active : candidates).map(row => row.id),
    };
}

function auditCatalogReferences(db, options = {}) {
    const limits = validateOptions(options);
    const run = db.transaction(() => {
        const catalogs = new Map();
        const sources = [];
        const errors = [];
        const references = [];
        const sourceHashes = [];
        const counts = {};
        const incompleteCatalogs = new Set();
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
        for (const source of SOURCES) {
            if (!tables.has(source.table)) {
                errors.push({ code: 'SOURCE_TABLE_MISSING', table: source.table });
                incompleteCatalogs.add(source.type);
                continue;
            }
            const rows = db.prepare(source.sql).all(limits.maxRowsPerTable + 1);
            if (rows.length > limits.maxRowsPerTable) {
                errors.push({ code: 'SOURCE_ROW_LIMIT', table: source.table });
                incompleteCatalogs.add(source.type);
            }
            const bounded = rows.slice(0, limits.maxRowsPerTable);
            catalogs.set(source.type, bounded);
            sources.push({ ...source, rows: bounded });
            counts[source.table] = { scanned: bounded.length, active: bounded.filter(row => !inactive(row, source.type)).length };
        }
        let referenceLimitReported = false;
        const profiles = tables.has('catalog_identity_profiles') ? db.prepare('SELECT * FROM catalog_identity_profiles').all() : [];
        const bindings = tables.has('catalog_reference_bindings') ? db.prepare('SELECT * FROM catalog_reference_bindings WHERE deleted_at IS NULL').all() : [];
        const shellBindings = tables.has('catalog_template_shell_bindings') ? db.prepare('SELECT * FROM catalog_template_shell_bindings').all() : [];
        function resolvedBinding(source, row, path, sourceHash, reference) {
            const bound = bindings.find(item => item.source_type === source.type && item.source_id === row.id && item.source_path === path
                && item.source_hash === sourceHash && item.source_version === `sha256:${sourceHash}`);
            const profile = bound && profiles.find(item => item.id === bound.target_profile_id && item.spec_revision === bound.target_spec_revision);
            const key = { part: 'part_id', coil: 'coil_id', template: 'template_id', recipe: 'recipe_id', modelVariant: 'model_variant_id' }[reference.targetType];
            const id = profile && key && profile[key];
            if (!id || reference.targetId != null && positiveId(reference.targetId) !== id) return null;
            const target = catalogs.get(reference.targetType)?.find(item => item.id === id);
            if (!target || inactive(target, reference.targetType) || reference.supplier && reference.supplier !== target.supplier) return null;
            return { status: 'resolved_binding', candidateIds: [id] };
        }
        const add = (source, row, path, reference, sourceHash, status) => {
            if (references.length >= limits.maxReferences) {
                if (!referenceLimitReported) errors.push({ code: 'REFERENCE_LIMIT' });
                referenceLimitReported = true;
                return;
            }
            references.push({
                sourceType: source.type, sourceId: row.id, sourceDeleted: Boolean(row.deleted_at),
                path, sourceHash, ...reference,
                ...(status ? { status, candidateIds: [] }
                    : incompleteCatalogs.has(reference.targetType) ? { status: 'catalog_incomplete', candidateIds: [] }
                        : resolvedBinding(source, row, path, sourceHash, reference) || resolveReference(catalogs, reference)),
            });
        };
        const scan = (source, row, value, path, sourceHash, depth = 0) => {
            if (depth > 40) {
                errors.push({ code: 'JSON_DEPTH_LIMIT', sourceType: source.type, sourceId: row.id, path });
                return;
            }
            if (Array.isArray(value)) {
                value.forEach((item, index) => scan(source, row, item, `${path}/${index}`, sourceHash, depth + 1));
                return;
            }
            if (!value || typeof value !== 'object') return;
            const model = text(value.model);
            const isCoil = value.inventoryType === 'coil' || value.costRole === 'coil' || value.name === '线圈转子';
            if (model) {
                const nonInventory = value.inventoryType === 'none' || NON_INVENTORY_ROLES.has(value.costRole);
                add(source, row, `${path}/model`, {
                    targetType: isCoil ? 'coil' : 'part', targetId: (isCoil ? value.coilId : value.partId) ?? null,
                    model, supplier: text(value.supplier), material: text(value.material), slotType: text(value.slotType),
                    role: text(value.costRole),
                }, sourceHash, nonInventory ? 'non_inventory' : undefined);
            }
            for (const [key, child] of Object.entries(value)) {
                const childPath = `${path}/${pointer(key)}`;
                if ((key === 'packingPartIds' || (key === 'coilId' && Array.isArray(child))) && Array.isArray(child)) {
                    child.forEach((id, index) => add(source, row, `${childPath}/${index}`, {
                        targetType: key === 'coilId' ? 'coil' : 'part', targetId: id, model: '',
                    }, sourceHash));
                } else if (Object.hasOwn(ID_KEYS, key) && child != null && child !== '') {
                    if (model && key === (isCoil ? 'coilId' : 'partId')) continue;
                    add(source, row, childPath, { targetType: ID_KEYS[key], targetId: child, model: '' }, sourceHash);
                } else if (Object.hasOwn(NAME_KEYS, key) && text(child)) {
                    const targetType = NAME_KEYS[key];
                    const targetId = key === 'recipeName' ? value.recipeId : key === 'modelVariantName' ? value.modelVariantId
                        : key === 'screwPricingModel' ? value.screwPricingPartId : value.shellPartId;
                    add(source, row, childPath, { targetType, targetId: targetId ?? null, model: text(child),
                        supplier: key === 'screwPricingModel' ? text(value.screwPricingSupplier) : '',
                    }, sourceHash);
                } else if (BEARING_KEYS.has(key) && text(child)) {
                    add(source, row, childPath, { targetType: 'part', model: text(child), category: '轴承' }, sourceHash);
                } else if (key === 'subassemblyContents') {
                    // A supplier kit's descriptions are not separately purchased or stocked.
                    if (child != null) add(source, row, childPath, { targetType: 'description', model: '' }, sourceHash, 'non_inventory');
                } else if (typeof child === 'string' && NESTED_JSON_KEYS.has(key)) {
                    parseAndScan(source, row, child, childPath, sourceHash, depth + 1);
                } else if (child && typeof child === 'object') {
                    scan(source, row, child, childPath, sourceHash, depth + 1);
                }
            }
        };
        const parseAndScan = (source, row, raw, path, sourceHash, depth = 0) => {
            if (raw == null || raw === '') return;
            try {
                const parsed = JSON.parse(raw);
                if (parsed != null && typeof parsed !== 'object') {
                    if (path !== '/remark') errors.push({ code: 'INVALID_SOURCE_JSON_SHAPE', sourceType: source.type, sourceId: row.id, path });
                    return;
                }
                scan(source, row, parsed, path, sourceHash, depth);
            }
            catch (error) {
                if (!(error instanceof SyntaxError)) throw error;
                // Remarks may be ordinary prose, but structured fields must be valid JSON.
                if (path === '/remark' && !String(raw).trim().startsWith('{')) return;
                errors.push({ code: 'INVALID_SOURCE_JSON', sourceType: source.type, sourceId: row.id, path });
            }
        };
        for (const source of sources) {
            for (const row of source.rows) {
                const sourceHash = hash(row);
                sourceHashes.push({ sourceType: source.type, sourceId: row.id, sha256: sourceHash });
                for (const [key, targetType] of Object.entries(ID_KEYS)) {
                    if (row[key] != null && row[key] !== '') add(source, row, `/${key}`, { targetType, targetId: row[key], model: '' }, sourceHash);
                }
                if (source.type === 'template' && row.cost_mode === 'bundle') {
                    const shell = shellBindings.find(binding => binding.template_id === row.id);
                    add(source, row, '/shell_model', { targetType: 'part', targetId: shell?.shell_part_id ?? null, model: shell ? '' : text(row.shell_model), category: '泵壳' }, sourceHash);
                }
                if (source.type === 'drawing' && row.linked_pump_model) {
                    add(source, row, '/linked_pump_model', { targetType: 'recipe', model: row.linked_pump_model }, sourceHash, 'unstructured');
                }
                if (source.type === 'fileLink' && ['recipe', 'order', 'quotation'].includes(row.target_type)) {
                    add(source, row, '/target_id', { targetType: row.target_type, targetId: row.target_id, model: '' }, sourceHash);
                }
                for (const field of source.json) parseAndScan(source, row, row[field], `/${field}`, sourceHash);
            }
        }
        const summary = {};
        for (const reference of references) summary[reference.status] = (summary[reference.status] || 0) + 1;
        const businessBaseline = {
            parts: (catalogs.get('part') || []).map(row => ({ id: row.id, stock: row.stock, price: row.price, supplier: row.supplier, deletedAt: row.deleted_at })),
            coils: (catalogs.get('coil') || []).map(row => ({ id: row.id, stock: row.stock, cost: row.cost, schemeCode: row.scheme_code })),
            orders: (catalogs.get('order') || []).map(row => ({ id: row.id, status: row.status, itemsSha256: hash(row.items_json || ''), purchaseSha256: hash(row.purchase_list_json || ''), inventoryDisposition: row.inventory_disposition,
                itemsJson: row.items_json, purchaseListJson: row.purchase_list_json,
                purchaseCompletedAt: row.purchase_completed_at, purchaseReceiptId: row.purchase_receipt_id })),
            quotations: (catalogs.get('quotation') || []).map(row => ({ id: row.id, status: row.status, totalCost: row.total_cost, totalPrice: row.total_price, itemsSha256: hash(row.items_json || '') })),
        };
        const settings = tables.has('system_settings') ? db.prepare(`
            SELECT key, value, updated_at FROM system_settings
            WHERE key IN ('cable_accessories', 'float_accessory_delta', 'management_fee') ORDER BY key
        `).all() : [];
        if (!tables.has('system_settings')) errors.push({ code: 'SOURCE_TABLE_MISSING', table: 'system_settings' });
        const priceInputs = {
            // Cost inputs stay stable when additive naming/source metadata is introduced.
            parts: (catalogs.get('part') || []).filter(row => !row.deleted_at).map(row => Object.fromEntries(
                ['id', 'model', 'category', 'subcategory', 'supplier', 'price', 'stock', 'remark', 'updated_at', 'deleted_at']
                    .map(key => [key, row[key]])
            )),
            coils: catalogs.get('coil') || [], settings,
        };
        const pricesByModel = Object.create(null);
        for (const part of priceInputs.parts) {
            (pricesByModel[part.model] ||= []).push({ ...part, notes: part.remark });
        }
        const settingValues = new Map(settings.map(row => [row.key, row.value]));
        const costBaseline = {
            scenario: 'saved_bom_current_catalog_prices', inputs: priceInputs, inputsSha256: hash(priceInputs),
            inputsComplete: !incompleteCatalogs.has('part') && !incompleteCatalogs.has('coil') && tables.has('system_settings'),
            // This is the formal parts-cost scenario, not a newly rebuilt BOM or
            // live coil-price query. Capturing the distinction prevents false parity.
            recipes: (catalogs.get('recipe') || []).map(row => {
                if (incompleteCatalogs.has('part') || incompleteCatalogs.has('coil') || !tables.has('system_settings')) {
                    return { recipeId: row.id, status: 'incomplete_inputs' };
                }
                try {
                    const parts = JSON.parse(row.parts_json || '[]');
                    if (!Array.isArray(parts)) throw new Error('配方 BOM 不是数组');
                    const result = calculateRecipeCost(parts, {}, pricesByModel, { getSetting: key => settingValues.get(key) });
                    return { recipeId: row.id, status: result.missingParts.length ? 'missing_prices' : 'calculated',
                        savedTotalCost: row.saved_total_cost, result };
                } catch (error) {
                    return { recipeId: row.id, status: 'failed', error: error.message, code: error.code || 'COST_BASELINE_FAILED' };
                }
            }),
        };
        return {
            version: 1, capabilityId: CAPABILITY_ID, complete: errors.length === 0,
            allReferencesResolved: errors.length === 0 && references.every(ref => ['resolved_id', 'resolved_legacy', 'resolved_binding', 'non_inventory'].includes(ref.status)),
            schemaVersion: db.pragma('user_version', { simple: true }), limits, counts, summary,
            coverage: { sourceTables: SOURCES.map(source => source.table), mode: 'declared_fields_and_nested_json', migrationApproved: false },
            references, sourceHashes, businessBaseline, baselineSha256: hash(businessBaseline), errors,
            namingCandidates: buildNamingCandidates(catalogs, references),
            costBaseline,
            warnings: ['只读盘点不建立引用、不修改名称；resolved_legacy 仅表示当前精确候选唯一，不代表已迁移。'],
        };
    });
    return run.deferred();
}

module.exports = { CAPABILITY_ID, SOURCES, auditCatalogReferences, resolveReference };
