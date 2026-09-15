/** Read-only derived catalog. Never reuse or retain data from a transaction. */
function createPartsDataCache(db) {
    const localChanges = db.prepare('SELECT total_changes() AS revision');
    const records = db.prepare('SELECT * FROM parts WHERE deleted_at IS NULL');
    let cached = null;
    let cachedRevision = null;

    function read() {
        // total_changes covers local writes; data_version covers other connections;
        // schema_version also detects local DDL that does not change row counters.
        // Capture before reading rows so a concurrent commit cannot label old rows new.
        const revision = db.inTransaction ? null
            : `${localChanges.get().revision}:${db.pragma('data_version', { simple: true })}:${db.pragma('schema_version', { simple: true })}`;
        if (revision !== null && cached && revision === cachedRevision) return cached;
        const partsCache = Object.create(null);
        const partsByModel = Object.create(null);
        for (const record of records.all()) {
            const model = record.model;
            const price = record.price || 0;
            const supplier = record.supplier || '-';
            const notes = record.remark || '';
            const category = record.category || '其他';
            partsCache[model] = { price, supplier, category, notes };
            if (!partsByModel[model]) partsByModel[model] = [];
            partsByModel[model].push({ id: record.id, model, category, supplier, price, notes, ...(record.naming_json ? { naming: JSON.parse(record.naming_json) } : {}) });
        }
        const result = { partsCache, partsByModel };
        if (revision !== null) {
            cached = result;
            cachedRevision = revision;
        }
        return result;
    }

    return {
        read,
        invalidate() { cached = null; cachedRevision = null; },
    };
}

module.exports = { createPartsDataCache };
