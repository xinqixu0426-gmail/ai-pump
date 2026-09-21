const { resolveCatalogReferences } = require('./catalogReferences.cjs');
const { isPurchaseCoil } = require('./purchaseIdentity.cjs');

const validId = value => ['number', 'string'].includes(typeof value)
    && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

// Historical rows are display snapshots, never inputs to plan rebuilding or
// inventory writes. Only names and explicit display status are added/replaced.
function historicalPurchaseNameView(db, order) {
    if (!order || !['已关闭', '已取消'].includes(order.status)) return order;
    let rows;
    try { rows = JSON.parse(order.purchaseListJson || '[]'); } catch { /* report below */ }
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
        return { ...order, purchaseNameWarning: 'invalid_snapshot' };
    }
    if (rows.length > 10000) return { ...order, purchaseNameWarning: 'snapshot_limit_exceeded' };
    const selections = rows.map(row => {
        if (row.inventoryType === 'none') return { status: 'not_tracked' };
        const coil = isPurchaseCoil(row);
        if ((row.partId != null && coil) || (row.inventoryType === 'part' && coil)) return { status: 'invalid_reference' };
        const id = coil ? row.coilId : row.partId;
        if (id == null) return { status: 'unbound' };
        if (!validId(id)) return { status: 'invalid_reference' };
        return { entityType: coil ? 'coil' : 'part', entityId: Number(id) };
    });
    const unique = [...new Map(selections.filter(item => item.entityId)
        .map(item => [`${item.entityType}:${item.entityId}`, item])).values()];
    const names = new Map();
    for (let offset = 0; offset < unique.length; offset += 100) {
        const result = resolveCatalogReferences(db, { references: unique.slice(offset, offset + 100) });
        for (const item of result.items) names.set(`${item.entityType}:${item.entityId}`, item);
    }
    return { ...order, purchaseListJson: JSON.stringify(rows.map((row, index) => {
        const selection = selections[index];
        const target = names.get(`${selection.entityType}:${selection.entityId}`);
        const currentName = target?.currentName;
        return { ...row, snapshotName: row.model ?? null,
            ...(currentName ? { model: currentName, name: !row.name || row.name === row.model ? currentName : row.name } : {}),
            nameReferenceStatus: target?.referenceStatus || selection.status,
        };
    })) };
}

module.exports = { historicalPurchaseNameView };
