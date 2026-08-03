function sameNumber(left, right) {
    return Math.abs(Number(left || 0) - Number(right || 0)) < 1e-9;
}

function buildCopperPriceUpdates(coils, copperPricePerTon) {
    const pricePerTon = Number(copperPricePerTon);
    if (!Number.isFinite(pricePerTon) || pricePerTon < 0) {
        throw new Error('铜价必须是大于等于 0 的数字');
    }
    const copperPricePerKg = (pricePerTon / 1000).toFixed(2);
    const updates = (coils || []).flatMap((coil) => {
        const cost = (
            Number(coil.unit_price || 0) * Number(coil.sheets || 0)
            + Number(coil.wire_weight || 0) * Number(copperPricePerKg)
            + Number(coil.coil_fee || 0)
            + Number(coil.rotor_fee || 0)
        ).toFixed(5);
        if (sameNumber(coil.copper_base, copperPricePerKg) && sameNumber(coil.cost, cost)) {
            return [];
        }
        return [{
            id: coil.id,
            values: { copper_base: copperPricePerKg, cost },
        }];
    });
    return {
        copperPricePerTon: pricePerTon,
        copperPricePerKg,
        scannedCount: (coils || []).length,
        updates,
    };
}

function updateAllCoilsCopperPrice(
    db,
    safeUpdate,
    copperPricePerTon,
    logger,
    options = {}
) {
    const coils = db.prepare('SELECT * FROM coils').all();
    const draft = buildCopperPriceUpdates(coils, copperPricePerTon);
    const auditIds = [];
    const applyUpdates = (updates) => {
        updates.forEach((item) => {
            const write = safeUpdate(
                'coils',
                item.id,
                item.values,
                options.auditContext || {}
            );
            if (write?.auditId) auditIds.push(write.auditId);
        });
    };
    if (draft.updates.length > 0 && options.transaction === false) {
        applyUpdates(draft.updates);
    } else if (draft.updates.length > 0) {
        db.transaction(applyUpdates)(draft.updates);
    }
    const result = {
        copperPricePerTon: draft.copperPricePerTon,
        copperPricePerKg: draft.copperPricePerKg,
        updatedCount: draft.updates.length,
        updatedCoilIds: draft.updates.map(item => item.id),
        skippedCount: draft.scannedCount - draft.updates.length,
        unchanged: draft.updates.length === 0,
        auditIds,
    };
    logger?.info(
        result.unchanged
            ? `铜价基数未变化，跳过 ${result.skippedCount} 条线圈写入`
            : `已更新 ${result.updatedCount} 条线圈，跳过 ${result.skippedCount} 条未变化记录`
    );
    return result;
}

module.exports = {
    buildCopperPriceUpdates,
    updateAllCoilsCopperPrice,
};
