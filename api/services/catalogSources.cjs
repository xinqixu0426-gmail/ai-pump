const crypto = require('node:crypto');

const SOURCE_QUERIES = Object.freeze({
    part: 'SELECT id, model, category, subcategory, supplier, price, stock, remark, updated_at, deleted_at FROM parts WHERE id = ?',
    coil: 'SELECT * FROM coils WHERE id = ?',
    stator: 'SELECT * FROM stator_variants WHERE id = ?',
    template: 'SELECT * FROM pump_shell_templates WHERE id = ?',
    recipe: 'SELECT * FROM recipes WHERE id = ?',
    modelVariant: 'SELECT * FROM pump_model_variants WHERE id = ?',
    quotation: 'SELECT * FROM quotations WHERE id = ?',
    order: 'SELECT * FROM orders WHERE id = ?',
    orderRevision: 'SELECT * FROM order_revisions WHERE id = ?',
    drawing: 'SELECT id, drawing_name, linked_pump_model, params_json, status, updated_at FROM rotor_drawings WHERE id = ?',
    fileLink: 'SELECT * FROM factory_file_links WHERE id = ?',
});

function catalogSourceHash(value) {
    return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function readCatalogSource(db, type, id) {
    if (!Object.hasOwn(SOURCE_QUERIES, type)) throw new Error('不支持的目录引用来源');
    return db.prepare(SOURCE_QUERIES[type]).get(id) || null;
}

function readSnapshotPointer(row, pointer) {
    let value = row;
    for (const token of pointer.slice(1).split('/')) {
        if (typeof value === 'string') {
            try { value = JSON.parse(value); } catch { return { found: false }; }
        }
        const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return { found: false };
        value = value[key];
    }
    return { found: true, value };
}

module.exports = { catalogSourceHash, readCatalogSource, readSnapshotPointer };
