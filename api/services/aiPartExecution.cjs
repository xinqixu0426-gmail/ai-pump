async function executePartCreate(args = {}, dependencies = {}) {
    const {
        internalFetch,
        postJson,
    } = dependencies;
    const {
        model,
        category = '其他',
        subcategory = '',
        price,
        supplier = '-',
        stock = 0,
    } = args;
    if (!model || price === undefined) {
        return { success: false, error: '缺少必要参数：型号或单价' };
    }

    const saved = await postJson(
        internalFetch,
        '/api/parts',
        {
            model,
            category,
            subcategory,
            price,
            supplier,
            stock,
        },
        '零件新建失败'
    );
    return {
        success: true,
        message: '零件新建成功（已通过标准 API 写入）',
        part: {
            model: saved.model || model,
            category: saved.category || category,
            subcategory: saved.subcategory || subcategory,
            price: saved.price ?? price,
            supplier: saved.supplier || supplier,
            stock: saved.stock ?? stock,
        },
        id: saved.id || saved.Id,
    };
}

async function executePartBatchCreate(args = {}, dependencies = {}) {
    const {
        internalFetch,
        postJson,
    } = dependencies;
    if (!Array.isArray(args.parts) || args.parts.length === 0) {
        return { success: false, error: '缺少必要参数：parts 必须是非空数组' };
    }
    const preview = await postJson(
        internalFetch,
        '/api/parts/batch-create-preview',
        { parts: args.parts },
        '批量新增零件预览失败'
    );
    const saved = await postJson(
        internalFetch,
        '/api/parts/batch-create',
        {
            confirmationToken: preview.confirmationToken,
            idempotencyKey: preview.suggestedIdempotencyKey,
        },
        '批量新增零件失败'
    );
    return {
        success: true,
        message: `已通过标准 API 批量新增 ${saved.createdCount} 个零件`,
        createdCount: saved.createdCount,
        skippedCount: preview.skippedCount || 0,
        parts: saved.parts || [],
        skippedExisting: preview.skippedExisting || [],
        changes: saved.changes || [],
        warnings: [
            ...(preview.warnings || []),
            ...(saved.warnings || []),
        ],
        auditId: saved.auditId || null,
        auditIds: saved.auditIds || [],
        formalOperationId: saved.operationId || null,
    };
}

async function executePartDelete(args = {}, dependencies = {}) {
    const {
        internalFetch,
        getJson,
        deleteJson,
    } = dependencies;
    const { model } = args;
    const allParts = await getJson(internalFetch, '/api/parts', '零件列表读取失败');
    const target = allParts.find(part => (part.model || '') === model);
    if (!target) {
        return { success: false, error: `找不到零件: ${model}` };
    }

    await deleteJson(
        internalFetch,
        `/api/parts/${target.id ?? target.Id}`,
        '零件删除失败',
        { expectedUpdatedAt: target.updatedAt || target.UpdatedAt }
    );
    return {
        success: true,
        message: `零件"${model}"已删除`,
        model,
    };
}

function partUpdateInputError(args = {}) {
    const metadataKeys = ['price', 'supplier', 'category', 'subcategory'];
    const inventoryKeys = ['stock', 'stockDelta'];
    const metadataArgs = Object.fromEntries(
        metadataKeys
            .filter(key => args[key] !== undefined)
            .map(key => [key, args[key]])
    );
    const inventoryArgs = Object.fromEntries(
        inventoryKeys
            .filter(key => args[key] !== undefined)
            .map(key => [key, args[key]])
    );
    const hasMetadata = Object.keys(metadataArgs).length > 0;
    const hasInventory = Object.keys(inventoryArgs).length > 0;

    if (args.stock !== undefined && args.stockDelta !== undefined) {
        return {
            success: false,
            code: 'part_stock_input_conflict',
            error: '库存目标值 stock 与库存增量 stockDelta 不能同时提交，请只选择一种库存调整方式。',
        };
    }
    if (!hasMetadata || !hasInventory) return null;

    return {
        success: false,
        code: 'part_update_mixed_write_not_allowed',
        error: '一次 update_part 不能同时修改零件资料和库存，请拆成两个分别确认的操作。',
        suggestedOperations: [
            {
                toolName: 'update_part',
                args: {
                    model: args.model,
                    ...metadataArgs,
                },
                purpose: '修改零件资料',
            },
            {
                toolName: 'update_part',
                args: {
                    model: args.model,
                    ...inventoryArgs,
                },
                purpose: '调整零件库存',
            },
        ],
    };
}

async function executePartUpdate(args = {}, dependencies = {}) {
    const {
        internalFetch,
        getJson,
        postJson,
        patchJson,
    } = dependencies;
    const {
        model,
        price,
        stock,
        stockDelta,
        supplier,
        category,
        subcategory,
    } = args;
    if (!model) {
        return { success: false, error: '缺少必要参数：零件型号' };
    }
    const inputError = partUpdateInputError(args);
    if (inputError) return inputError;

    const allParts = await getJson(internalFetch, '/api/parts', '零件列表读取失败');
    const target = allParts.find(part => (part.model || '') === model);
    if (!target) {
        return { success: false, error: `未找到型号为"${model}"的零件` };
    }

    const updates = {};
    const changes = [];
    if (price !== undefined) {
        updates.price = price;
        changes.push(`单价: ${target.price} → ${price}`);
    }
    const currentStock = Number(target.stock || 0);
    const requestedStockDelta = stock !== undefined
        ? Math.max(0, Number(stock)) - currentStock
        : stockDelta !== undefined
            ? Number(stockDelta)
            : 0;
    if (stock !== undefined || stockDelta !== undefined) {
        const nextStock = Math.max(0, currentStock + requestedStockDelta);
        changes.push(`库存: ${currentStock} → ${nextStock} (${nextStock - currentStock > 0 ? '+' : ''}${nextStock - currentStock})`);
    }
    if (supplier !== undefined) {
        updates.supplier = supplier;
        changes.push(`供应商: ${target.supplier} → ${supplier}`);
    }
    if (category !== undefined) {
        updates.category = category;
        changes.push(`类别: ${target.category} → ${category}`);
    }
    if (subcategory !== undefined) {
        updates.subcategory = subcategory;
        changes.push(`二级分类: ${target.subcategory || '-'} → ${subcategory}`);
    }

    if (changes.length === 0) {
        return { success: false, error: '没有指定任何要修改的字段' };
    }

    const targetId = target.id ?? target.Id;
    let saved = target;
    if (Object.keys(updates).length > 0) {
        saved = await patchJson(
            internalFetch,
            `/api/parts/${targetId}`,
            {
                ...updates,
                expectedUpdatedAt: target.updatedAt || target.UpdatedAt,
            },
            '零件修改失败'
        );
    }
    if (requestedStockDelta !== 0) {
        const preview = await postJson(
            internalFetch,
            '/api/parts/batch-stock-preview',
            {
                operations: [{
                    partId: targetId,
                    delta: requestedStockDelta,
                }],
                note: 'AI 零件库存调整',
            },
            '零件库存调整预览失败'
        );
        const stockResult = await postJson(
            internalFetch,
            '/api/parts/batch-stock',
            {
                confirmationToken: preview.confirmationToken,
                idempotencyKey: preview.suggestedIdempotencyKey,
            },
            '零件库存调整失败'
        );
        saved = stockResult.parts?.[0] || saved;
    }

    return {
        success: true,
        message: '零件修改成功（已通过标准 API 写入）',
        part: {
            id: saved.id || saved.Id || targetId,
            model: saved.model || model,
            category: saved.category,
            subcategory: saved.subcategory || '',
            price: saved.price,
            supplier: saved.supplier,
            stock: saved.stock,
        },
        changes,
    };
}

async function executePartPriceBatch(args = {}, dependencies = {}) {
    const {
        internalFetch,
        getJson,
        postJson,
        patchJson,
    } = dependencies;
    const {
        category,
        percentChange,
        absoluteChange,
    } = args;
    if (percentChange === undefined && absoluteChange === undefined) {
        return { success: false, error: '需要指定percentChange或absoluteChange' };
    }

    const allParts = await getJson(internalFetch, '/api/parts', '零件列表读取失败');
    const targets = allParts.filter(part => (
        (part.category || '') === category
        || (part.category || '').includes(category)
    ));
    if (targets.length === 0) {
        return { success: false, error: `没有找到类别包含"${category}"的零件` };
    }

    const updates = [];
    const details = [];
    for (const part of targets) {
        const oldPrice = Number(part.price || 0);
        let newPrice;
        if (percentChange !== undefined) {
            newPrice = Math.round(oldPrice * (1 + percentChange / 100) * 100) / 100;
        } else {
            newPrice = Math.round((oldPrice + absoluteChange) * 100) / 100;
        }
        if (newPrice < 0) newPrice = 0;
        updates.push({ partId: part.id ?? part.Id, price: newPrice });
        details.push({ model: part.model, oldPrice, newPrice });
    }

    const preview = await postJson(
        internalFetch,
        '/api/parts/prices-preview',
        { updates },
        '批量调价预览失败'
    );
    const result = await patchJson(
        internalFetch,
        '/api/parts/prices',
        {
            updates: preview.updates,
            previewHash: preview.previewHash,
            idempotencyKey: preview.suggestedIdempotencyKey,
        },
        '批量调价失败'
    );

    return {
        success: true,
        message: `已批量更新${result.updatedCount ?? targets.length}个"${category}"类零件的价格`,
        category,
        count: result.updatedCount ?? targets.length,
        changeType: percentChange !== undefined
            ? `${percentChange > 0 ? '+' : ''}${percentChange}%`
            : `${absoluteChange > 0 ? '+' : ''}${absoluteChange}元`,
        details,
    };
}

module.exports = {
    executePartBatchCreate,
    executePartCreate,
    executePartDelete,
    executePartPriceBatch,
    executePartUpdate,
    partUpdateInputError,
};
