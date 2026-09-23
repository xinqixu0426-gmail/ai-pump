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
            // PHASE 5-R3：正式目录的 NULL 价格必须保持为 NULL 传到成本链路。
            //
            // 这里原来是 `record.price || 0`，它正是「NULL 被压成 0」的第一层。
            // 由于 0 是合法正式价格（schema `REAL DEFAULT 0` + 价格 >= 0 约束 +
            // 写入/过滤都用 non-negative），被压成 0 之后 costEngine 再也无法区分
            // “未定价”和“零成本”，于是把未定价零件算进完整成本。
            //
            // 只保留 null/undefined：0 本身原样保留，非数值价格交由 costEngine 的
            // 正式可用性判定（hasUsableCatalogPrice）处理。
            const rawPrice = record.price;
            const price = rawPrice === null || rawPrice === undefined ? null : rawPrice;
            const supplier = record.supplier || '-';
            const notes = record.remark || '';
            const category = record.category || '其他';
            // partsCache 是 box_type 推断等既有调用方的按型号单值索引，其价格
            // 下游一律用 `Number(x || 0)` 读取，保持原有的 0 语义不改变那部分行为；
            // 需要区分“未定价”的成本链路统一使用 partsByModel。
            partsCache[model] = { price: rawPrice || 0, supplier, category, notes };
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
