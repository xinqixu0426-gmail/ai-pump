const { bearingCodeOf } = require('./catalogSpec.cjs');
const { CommandExecutionError } = require('./commandExecution.cjs');

function normalizePartCatalogReferences(db, remark) {
    let meta;
    try { meta = JSON.parse(remark || '{}'); } catch { return remark; }
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return remark;
    if (!['defaultUpperBearing', 'defaultLowerBearing', 'defaultUpperBearingPartId', 'defaultLowerBearingPartId'].some(key => meta[key] != null && meta[key] !== '')) return remark;
    for (const field of ['defaultUpperBearing', 'defaultLowerBearing']) {
        const idKey = `${field}PartId`;
        const id = meta[idKey];
        if (!meta[field] && id == null) continue;
        if (id != null && (!Number.isSafeInteger(id) || id <= 0)) throw new CommandExecutionError('DEFAULT_PART_ID_INVALID', '默认轴承ID必须为正整数', 400);
        const candidates = id != null ? db.prepare('SELECT * FROM parts WHERE id = ? AND category = ? AND deleted_at IS NULL').all(id, '轴承')
            : db.prepare('SELECT * FROM parts WHERE category = ? AND deleted_at IS NULL').all('轴承').filter(part => bearingCodeOf(part) === bearingCodeOf({ model: meta[field] }));
        if (candidates.length !== 1) throw new CommandExecutionError(candidates.length ? 'DEFAULT_PART_AMBIGUOUS' : 'DEFAULT_PART_NOT_FOUND', '默认轴承需要选择有效、具体的零件及供应商', candidates.length ? 409 : 422, { candidates: candidates.map(part => ({ partId: part.id, model: part.model, supplier: part.supplier })) });
        const part = candidates[0];
        if (meta[field] && bearingCodeOf({ model: meta[field] }) !== bearingCodeOf(part)) throw new CommandExecutionError('DEFAULT_PART_SPEC_MISMATCH', '默认轴承型号与ID不一致', 422);
        meta[idKey] = part.id;
        meta[field] = part.model;
    }
    return JSON.stringify(meta);
}

module.exports = { normalizePartCatalogReferences };
