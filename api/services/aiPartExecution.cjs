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

function assertPartStockCommandReceipt(result = {}) {
    const auditIds = Array.isArray(result.auditIds)
        ? result.auditIds.filter(Boolean)
        : result.auditId
            ? [result.auditId]
            : [];
    if (
        !result.operationId
        || result.status !== 'completed'
        || auditIds.length === 0
    ) {
        const error = new Error('正式库存 API 未返回完整 operation/audit 回执，不能声明库存调整成功');
        error.code = 'part_stock_receipt_missing';
        throw error;
    }
    return auditIds;
}

function partStockInputError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
}

function normalizePartStockItems(args = {}) {
    const items = Array.isArray(args.items) ? args.items : [];
    if (items.length === 0 || items.length > 100) {
        throw partStockInputError(
            'part_stock_items_invalid',
            'items 必须包含 1 到 100 个零件库存调整项'
        );
    }

    const normalizedItems = items.map((item, index) => {
        const model = String(item?.model || '').trim();
        const changeQty = Number(item?.changeQty);
        if (!model) {
            throw partStockInputError(
                'part_stock_model_required',
                `items[${index}].model 不能为空`
            );
        }
        if (!Number.isInteger(changeQty) || changeQty === 0) {
            throw partStockInputError(
                'part_stock_change_qty_invalid',
                `items[${index}].changeQty 必须是非零整数`
            );
        }
        return { model, changeQty };
    });
    if (new Set(normalizedItems.map(item => item.model)).size !== normalizedItems.length) {
        throw partStockInputError(
            'part_stock_model_duplicate',
            '同一零件型号不能在一次库存调整中重复出现'
        );
    }
    return normalizedItems;
}

function normalizedModelText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase('zh-CN')
        .replace(/[\s._+#/()（）\-－]/gu, '');
}

function modelBigrams(value) {
    const normalized = normalizedModelText(value);
    if (normalized.length < 2) return new Set(normalized ? [normalized] : []);
    return new Set([...normalized.slice(0, -1)].map((_, index) => normalized.slice(index, index + 2)));
}

function modelSimilarity(left, right) {
    const normalizedLeft = normalizedModelText(left);
    const normalizedRight = normalizedModelText(right);
    if (!normalizedLeft || !normalizedRight) return 0;
    if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
        return Math.min(normalizedLeft.length, normalizedRight.length)
            / Math.max(normalizedLeft.length, normalizedRight.length);
    }
    const leftBigrams = modelBigrams(normalizedLeft);
    const rightBigrams = modelBigrams(normalizedRight);
    const overlap = [...leftBigrams].filter(value => rightBigrams.has(value)).length;
    return (2 * overlap) / (leftBigrams.size + rightBigrams.size || 1);
}

function similarPartCandidates(allParts = [], requestedModel = '') {
    return allParts
        .map(part => ({
            part,
            score: modelSimilarity(requestedModel, part.model),
        }))
        .filter(item => item.score >= 0.45)
        .sort((left, right) => right.score - left.score
            || String(left.part.model || '').localeCompare(String(right.part.model || ''), 'zh-CN'))
        .slice(0, 5)
        .map(({ part }) => ({
            id: part.id ?? part.Id,
            model: part.model,
            category: part.category || '',
            subcategory: part.subcategory || '',
            supplier: part.supplier || '',
            stock: Number(part.stock || 0),
        }));
}

async function resolvePartStockTargets(args = {}, dependencies = {}) {
    const { internalFetch, getJson } = dependencies;
    const normalizedItems = normalizePartStockItems(args);
    const allParts = await getJson(internalFetch, '/api/parts', '零件列表读取失败');
    const resolvedItems = normalizedItems.map(item => {
        const matches = allParts.filter(part => String(part.model || '').trim() === item.model);
        if (matches.length === 0) {
            const candidates = similarPartCandidates(allParts, item.model);
            throw partStockInputError(
                'part_stock_target_not_found',
                candidates.length > 0
                    ? `未找到精确型号"${item.model}"；相似候选：${candidates.map(candidate => candidate.model).join('、')}。请选择明确型号后重新发起`
                    : `未找到型号为"${item.model}"的零件，请核对数据库中的完整型号`,
                { model: item.model, candidates }
            );
        }
        if (matches.length > 1) {
            throw partStockInputError(
                'part_stock_target_ambiguous',
                `型号"${item.model}"匹配到多个零件，已停止整批库存调整`,
                {
                    model: item.model,
                    candidates: matches.slice(0, 10).map(part => ({
                        id: part.id ?? part.Id,
                        model: part.model,
                    })),
                }
            );
        }
        return {
            partId: matches[0].id ?? matches[0].Id,
            model: String(matches[0].model || '').trim(),
            changeQty: item.changeQty,
        };
    });
    if (new Set(resolvedItems.map(item => item.partId)).size !== resolvedItems.length) {
        throw partStockInputError(
            'part_stock_target_duplicate',
            '多个输入型号指向同一个零件，已停止整批库存调整'
        );
    }
    return resolvedItems;
}

async function verifyPartStockReadback({
    internalFetch,
    getJson,
    preview,
    result,
    expectedCount,
}) {
    const previewOperations = Array.isArray(preview?.operations) ? preview.operations : [];
    const resultChanges = Array.isArray(result?.changes) ? result.changes : [];
    if (
        previewOperations.length !== expectedCount
        || resultChanges.length !== expectedCount
        || Number(result.updatedCount ?? expectedCount) !== expectedCount
    ) {
        throw partStockInputError(
            'part_stock_result_mismatch',
            '正式库存 API 返回的变更数量与确认内容不一致，不能声明成功'
        );
    }

    const expectedById = new Map(previewOperations.map(operation => [
        Number(operation.partId),
        {
            model: String(operation.model || ''),
            delta: Number(operation.delta),
            nextStock: Number(operation.nextStock),
        },
    ]));
    for (const change of resultChanges) {
        const expected = expectedById.get(Number(change.resourceId));
        if (
            !expected
            || Number(change.delta) !== expected.delta
            || Number(change.to) !== expected.nextStock
            || Number(change.from) + Number(change.delta) !== Number(change.to)
        ) {
            throw partStockInputError(
                'part_stock_result_mismatch',
                '正式库存 API 返回的型号、增量或结果库存与确认内容不一致，不能声明成功'
            );
        }
    }

    const currentParts = await getJson(internalFetch, '/api/parts', '零件库存回读失败');
    const readback = previewOperations.map(operation => {
        const part = currentParts.find(candidate => (
            Number(candidate.id ?? candidate.Id) === Number(operation.partId)
        ));
        if (!part || Number(part.stock) !== Number(operation.nextStock)) {
            throw partStockInputError(
                'part_stock_readback_mismatch',
                `零件"${operation.model || operation.partId}"库存回读与正式命令结果不一致，不能声明成功`
            );
        }
        return {
            id: part.id ?? part.Id,
            model: part.model,
            stock: Number(part.stock),
        };
    });
    return readback;
}

async function preparePartStockAdjustment(args = {}, dependencies = {}) {
    const { internalFetch, getJson, postJson } = dependencies;
    const resolvedItems = await resolvePartStockTargets(args, { internalFetch, getJson });
    const operations = resolvedItems.map(item => ({
        partId: item.partId,
        delta: item.changeQty,
    }));
    const preview = await postJson(
        internalFetch,
        '/api/parts/batch-stock-preview',
        { operations },
        '零件库存调整预览失败'
    );
    if (
        !preview?.confirmationToken
        || !preview?.suggestedIdempotencyKey
        || !Array.isArray(preview.operations)
        || preview.operations.length !== resolvedItems.length
    ) {
        throw partStockInputError(
            'part_stock_preview_invalid',
            '正式库存 API 未返回完整预览凭证，不能生成确认卡'
        );
    }

    const canonicalItems = resolvedItems.map(item => ({
        model: item.model,
        changeQty: item.changeQty,
    }));
    return {
        args: {
            ...args,
            items: canonicalItems,
        },
        confirmationRows: preview.operations.map(operation => {
            const delta = Number(operation.delta);
            return {
                label: String(operation.model || `零件 #${operation.partId}`),
                value: `当前 ${operation.currentStock} → 预计 ${operation.nextStock}（${delta > 0 ? '+' : ''}${delta} 件）`,
            };
        }),
        executionContext: {
            kind: 'part_stock_preview',
            confirmationToken: preview.confirmationToken,
            idempotencyKey: preview.suggestedIdempotencyKey,
            operations: preview.operations,
            warnings: preview.warnings || [],
        },
    };
}

async function executePartStockAdjustment(args = {}, dependencies = {}) {
    const {
        internalFetch,
        getJson,
        postJson,
        confirmationContext,
    } = dependencies;
    const normalizedItems = normalizePartStockItems(args);
    let preview = null;
    if (
        confirmationContext?.kind === 'part_stock_preview'
        && confirmationContext.confirmationToken
        && confirmationContext.idempotencyKey
    ) {
        preview = {
            confirmationToken: confirmationContext.confirmationToken,
            suggestedIdempotencyKey: confirmationContext.idempotencyKey,
            operations: Array.isArray(confirmationContext.operations)
                ? confirmationContext.operations
                : [],
            warnings: Array.isArray(confirmationContext.warnings)
                ? confirmationContext.warnings
                : [],
        };
    } else {
        const resolvedItems = await resolvePartStockTargets(args, { internalFetch, getJson });
        preview = await postJson(
            internalFetch,
            '/api/parts/batch-stock-preview',
            {
                operations: resolvedItems.map(item => ({
                    partId: item.partId,
                    delta: item.changeQty,
                })),
            },
            '零件库存调整预览失败'
        );
    }
    const result = await postJson(
        internalFetch,
        '/api/parts/batch-stock',
        {
            confirmationToken: preview.confirmationToken,
            idempotencyKey: preview.suggestedIdempotencyKey,
        },
        '零件库存调整失败'
    );
    const auditIds = assertPartStockCommandReceipt(result);
    const readback = await verifyPartStockReadback({
        internalFetch,
        getJson,
        preview,
        result,
        expectedCount: normalizedItems.length,
    });

    return {
        success: true,
        message: `已通过正式库存 API 调整 ${result.updatedCount ?? normalizedItems.length} 个零件`,
        count: result.updatedCount ?? normalizedItems.length,
        parts: result.parts || [],
        changes: result.changes || preview.operations || [],
        warnings: [
            ...(preview.warnings || []),
            ...(result.warnings || []),
        ],
        operationId: result.operationId,
        formalOperationId: result.operationId,
        auditId: auditIds[0],
        auditIds,
        status: result.status,
        readback,
    };
}

async function executePartUpdate(args = {}, dependencies = {}) {
    const {
        internalFetch,
        getJson,
        patchJson,
    } = dependencies;
    const {
        model,
        price,
        supplier,
        category,
        subcategory,
    } = args;
    if (!model) {
        return { success: false, error: '缺少必要参数：零件型号' };
    }
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
    const saved = await patchJson(
        internalFetch,
        `/api/parts/${targetId}`,
        {
            ...updates,
            expectedUpdatedAt: target.updatedAt || target.UpdatedAt,
        },
        '零件修改失败'
    );

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
    executePartStockAdjustment,
    executePartUpdate,
    assertPartStockCommandReceipt,
    preparePartStockAdjustment,
    resolvePartStockTargets,
    similarPartCandidates,
    verifyPartStockReadback,
};
