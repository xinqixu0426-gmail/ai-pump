function parseCoilInventoryModel(value) {
    const match = String(value || '').trim().match(/^(\d+)\s*[-－×xX*]\s*(\d+)$/);
    if (!match) return null;
    return {
        commonName: match[1],
        sheets: Number(match[2]),
        model: `${match[1]}-${match[2]}`,
    };
}

async function prepareCoilStockAdjustment(args = {}, dependencies = {}) {
    const {
        internalFetch,
        getJson,
        postJson,
    } = dependencies;
    const items = Array.isArray(args.items) ? args.items : [];
    if (items.length === 0) {
        throw new Error('至少需要一个线圈库存调整项目');
    }
    if (items.length > 50) {
        throw new Error('单次最多调整 50 个线圈方案');
    }

    const coils = await getJson(internalFetch, '/api/coils', '线圈方案读取失败');
    const resolved = [];
    for (const item of items) {
        const parsed = parseCoilInventoryModel(item.model);
        const changeQty = Number(item.changeQty);
        if (!parsed) {
            throw new Error(`线圈简写“${item.model || ''}”格式无效，应为“规格-片数”，例如 12-120`);
        }
        if (!Number.isInteger(changeQty) || changeQty === 0) {
            throw new Error(`${parsed.model} 的库存变动必须是非零整数套数`);
        }

        const candidates = coils.filter(coil => (
            coil.schemeStatus === 'official'
            && Number(coil.sheets) === parsed.sheets
            && [coil.commonName, coil.spec].some(value => String(value || '').trim() === parsed.commonName)
            && (!item.material || coil.material === item.material)
            && (!item.slotType || coil.slotType === item.slotType)
            && (!item.schemeCode || coil.schemeCode === item.schemeCode)
        ));
        if (candidates.length === 0) {
            throw new Error(`未找到正式线圈方案“${parsed.model}”${item.material ? `、材质“${item.material}”` : ''}${item.slotType ? `、槽眼“${item.slotType}”` : ''}`);
        }
        if (candidates.length > 1) {
            const options = candidates
                .map(coil => `${coil.schemeCode || `#${coil.id ?? coil.Id}`} ${coil.material || '未标材质'}/${coil.slotType || '未标槽眼'} ${[coil.ratedVoltageV ? `${coil.ratedVoltageV}V` : '', coil.ratedFrequencyHz ? `${coil.ratedFrequencyHz}Hz` : '', coil.market].filter(Boolean).join('/')}`.trim())
                .join('、');
            throw new Error(`线圈“${parsed.model}”存在多个正式方案（${options}），请明确材质和槽眼；若仍有多套，再提供方案编码后调整库存`);
        }

        const coil = candidates[0];
        resolved.push({
            coilId: coil.id ?? coil.Id,
            model: parsed.model,
            material: coil.material,
            slotType: coil.slotType,
            ...(coil.schemeCode ? { schemeCode: coil.schemeCode } : {}),
            changeQty,
            previousStock: Number(coil.stock || 0),
            expectedUpdatedAt: coil.updatedAt || coil.UpdatedAt || null,
        });
    }

    if (new Set(resolved.map(item => item.coilId)).size !== resolved.length) {
        throw new Error('同一线圈方案不能在一次操作中重复调整');
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
    if (!preview?.confirmationToken || !preview?.suggestedIdempotencyKey) {
        throw new Error('正式线圈库存预览没有返回完整确认凭证');
    }
    return {
        args: {
            ...args,
            items: resolved.map(item => ({
                model: item.model,
                changeQty: item.changeQty,
                material: item.material,
                slotType: item.slotType,
                ...(item.schemeCode ? { schemeCode: item.schemeCode } : {}),
            })),
        },
        confirmationRows: resolved.map(item => ({
            label: `${item.model}（${item.material}/${item.slotType}）`,
            value: `当前 ${item.previousStock} → 预计 ${item.previousStock + item.changeQty}（${item.changeQty > 0 ? '+' : ''}${item.changeQty} 套）`,
        })),
        executionContext: {
            kind: 'coil_stock_preview',
            confirmationToken: preview.confirmationToken,
            idempotencyKey: preview.suggestedIdempotencyKey,
            resolved,
            warnings: preview.warnings || [],
        },
    };
}

async function executeCoilStockAdjustment(args = {}, dependencies = {}) {
    const { internalFetch, getJson, postJson, confirmationContext } = dependencies;
    const prepared = confirmationContext?.kind === 'coil_stock_preview'
        ? { executionContext: confirmationContext }
        : await prepareCoilStockAdjustment(args, { internalFetch, getJson, postJson });
    const preview = prepared.executionContext;
    const resolved = preview.resolved;
    const result = await postJson(internalFetch, '/api/coils/stock-adjustments', {
        confirmationToken: preview.confirmationToken,
        idempotencyKey: preview.idempotencyKey,
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
    prepareCoilStockAdjustment,
};
