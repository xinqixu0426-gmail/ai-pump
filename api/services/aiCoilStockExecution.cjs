function parseCoilInventoryModel(value) {
    const match = String(value || '').trim().match(/^(\d+)\s*[-－×xX*]\s*(\d+)$/);
    if (!match) return null;
    return {
        commonName: match[1],
        sheets: Number(match[2]),
        model: `${match[1]}-${match[2]}`,
    };
}

async function executeCoilStockAdjustment(args = {}, dependencies = {}) {
    const {
        internalFetch,
        getJson,
        postJson,
    } = dependencies;
    const items = Array.isArray(args.items) ? args.items : [];
    if (items.length === 0) {
        return { success: false, error: '至少需要一个线圈库存调整项目' };
    }
    if (items.length > 50) {
        return { success: false, error: '单次最多调整 50 个线圈方案' };
    }

    const coils = await getJson(internalFetch, '/api/coils', '线圈方案读取失败');
    const resolved = [];
    for (const item of items) {
        const parsed = parseCoilInventoryModel(item.model);
        const changeQty = Number(item.changeQty);
        if (!parsed) {
            return { success: false, error: `线圈简写“${item.model || ''}”格式无效，应为“规格-片数”，例如 12-120` };
        }
        if (!Number.isInteger(changeQty) || changeQty === 0) {
            return { success: false, error: `${parsed.model} 的库存变动必须是非零整数套数` };
        }

        const candidates = coils.filter(coil => (
            coil.schemeStatus === 'official'
            && Number(coil.sheets) === parsed.sheets
            && [coil.commonName, coil.spec].some(value => String(value || '').trim() === parsed.commonName)
            && (!item.material || coil.material === item.material)
            && (!item.slotType || coil.slotType === item.slotType)
        ));
        if (candidates.length === 0) {
            return {
                success: false,
                error: `未找到正式线圈方案“${parsed.model}”${item.material ? `、材质“${item.material}”` : ''}${item.slotType ? `、槽眼“${item.slotType}”` : ''}`,
            };
        }
        if (candidates.length > 1) {
            const options = candidates
                .map(coil => `${coil.material || '未标材质'}/${coil.slotType || '未标槽眼'}`)
                .join('、');
            return {
                success: false,
                error: `线圈“${parsed.model}”存在多个正式方案（${options}），请明确材质和槽眼后再调整库存`,
            };
        }

        const coil = candidates[0];
        resolved.push({
            coilId: coil.id ?? coil.Id,
            model: parsed.model,
            material: coil.material,
            slotType: coil.slotType,
            changeQty,
            previousStock: Number(coil.stock || 0),
            expectedUpdatedAt: coil.updatedAt || coil.UpdatedAt || null,
        });
    }

    if (new Set(resolved.map(item => item.coilId)).size !== resolved.length) {
        return { success: false, error: '同一线圈方案不能在一次操作中重复调整' };
    }

    const preview = await postJson(
        internalFetch,
        '/api/coils/stock-adjustments-preview',
        {
            adjustments: resolved.map(item => ({
                coilId: item.coilId,
                changeQty: item.changeQty,
            })),
            note: args.note,
        },
        '线圈库存调整预览失败'
    );
    const result = await postJson(internalFetch, '/api/coils/stock-adjustments', {
        confirmationToken: preview.confirmationToken,
        idempotencyKey: preview.suggestedIdempotencyKey,
    }, '线圈库存调整失败');
    const savedById = new Map((result.adjustments || []).map(item => [
        item.coil?.id ?? item.coil?.Id,
        item,
    ]));
    return {
        success: true,
        intent: 'coil_stock_adjustment',
        message: `已调整 ${result.updatedCount ?? resolved.length} 个线圈方案的成品库存`,
        operationId: result.operationId,
        changes: result.changes || [],
        warnings: result.warnings || [],
        auditId: result.auditId ?? null,
        auditIds: result.auditIds || [],
        idempotentReplay: Boolean(result.idempotentReplay),
        items: resolved.map(item => {
            const saved = savedById.get(item.coilId);
            return {
                ...item,
                newStock: saved?.adjustment?.balanceAfter ?? item.previousStock + item.changeQty,
            };
        }),
    };
}

module.exports = {
    executeCoilStockAdjustment,
    parseCoilInventoryModel,
};
