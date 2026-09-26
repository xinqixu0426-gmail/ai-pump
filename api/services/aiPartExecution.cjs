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
        return { success: false, error: '缺少必要参数：型号或目录成本价' };
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

async function preparePartBatchCreate(args = {}, dependencies = {}) {
    const {
        internalFetch,
        postJson,
    } = dependencies;
    if (!Array.isArray(args.parts) || args.parts.length === 0) {
        throw new Error('缺少必要参数：parts 必须是非空数组');
    }
    const preview = await postJson(
        internalFetch,
        '/api/parts/batch-create-preview',
        { parts: args.parts },
        '批量新增零件预览失败'
    );
    if (!preview?.confirmationToken || !preview?.suggestedIdempotencyKey) {
        const error = new Error('正式批量新增预览没有返回完整确认凭证');
        error.code = 'part_batch_create_preview_invalid';
        throw error;
    }
    return {
        args,
        confirmationRows: [
            { label: '正式预览新增', value: `${preview.createdCount ?? args.parts.length} 个零件` },
            ...(Number(preview.skippedCount || 0) > 0
                ? [{ label: '已存在跳过', value: `${preview.skippedCount} 个` }]
                : []),
        ],
        executionContext: {
            kind: 'part_batch_create_preview',
            confirmationToken: preview.confirmationToken,
            idempotencyKey: preview.suggestedIdempotencyKey,
            skippedCount: preview.skippedCount || 0,
            skippedExisting: preview.skippedExisting || [],
            warnings: preview.warnings || [],
        },
    };
}

async function executePartBatchCreate(args = {}, dependencies = {}) {
    const { internalFetch, postJson, confirmationContext } = dependencies;
    const prepared = confirmationContext?.kind === 'part_batch_create_preview'
        ? { executionContext: confirmationContext }
        : await preparePartBatchCreate(args, { internalFetch, postJson });
    const preview = prepared.executionContext;
    const saved = await postJson(internalFetch, '/api/parts/batch-create', {
        confirmationToken: preview.confirmationToken,
        idempotencyKey: preview.idempotencyKey,
    }, '批量新增零件失败');
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

function partDeleteError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
}

function resolvePartDeleteTarget(parts = [], args = {}) {
    const partId = Number(args.partId);
    const model = String(args.model || '').trim();
    const supplier = String(args.supplier || '').trim();
    const normalizedModel = model.toLocaleLowerCase();
    const normalizedSupplier = supplier.toLocaleLowerCase();
    let matches = (Array.isArray(parts) ? parts : []).filter((part) => {
        const candidateId = Number(part.id ?? part.Id);
        if (Number.isInteger(partId) && partId > 0 && candidateId !== partId) return false;
        return String(part.model || '').trim().toLocaleLowerCase() === normalizedModel;
    });
    if (supplier) {
        matches = matches.filter(part => (
            String(part.supplier || '').trim().toLocaleLowerCase() === normalizedSupplier
        ));
    }
    if (matches.length === 0) {
        throw partDeleteError(
            'part_delete_target_not_found',
            Number.isInteger(partId) && partId > 0
                ? `找不到零件 #${partId}，或其型号/供应商与请求不一致`
                : `找不到零件: ${model}`,
            { partId: Number.isInteger(partId) && partId > 0 ? partId : null, model, supplier }
        );
    }
    if (matches.length > 1) {
        throw partDeleteError(
            'part_delete_target_ambiguous',
            `型号“${model}”匹配到多个正式零件，请提供 partId 或供应商后重试`,
            {
                candidates: matches.slice(0, 10).map(part => ({
                    partId: Number(part.id ?? part.Id),
                    model: part.model,
                    supplier: part.supplier,
                })),
            }
        );
    }
    return matches[0];
}

async function preparePartDelete(args = {}, dependencies = {}) {
    const {
        internalFetch,
        getJson,
        postJson,
    } = dependencies;
    const allParts = await getJson(internalFetch, '/api/parts', '零件列表读取失败');
    const target = resolvePartDeleteTarget(allParts, args);
    const partId = Number(target.id ?? target.Id);
    const expectedUpdatedAt = target.updatedAt ?? target.UpdatedAt;
    if (!expectedUpdatedAt) {
        throw partDeleteError(
            'part_delete_version_missing',
            '正式零件缺少版本字段，不能生成删除确认',
            { partId }
        );
    }
    const preview = await postJson(
        internalFetch,
        `/api/parts/${partId}/delete-preview`,
        { expectedUpdatedAt },
        '零件删除预览失败'
    );
    if (
        preview?.preview !== true
        || preview?.capabilityId !== 'parts.delete'
        || Number(preview?.target?.id) !== partId
        || preview?.normalizedInput?.expectedUpdatedAt !== expectedUpdatedAt
        || !preview?.previewHash
        || !Array.isArray(preview?.changes)
        || !Array.isArray(preview?.warnings)
    ) {
        throw partDeleteError(
            'part_delete_preview_incomplete',
            '正式零件删除预览不完整，不能生成删除确认',
            { partId }
        );
    }
    if (preview.warnings.length > 0) {
        throw partDeleteError(
            'part_delete_preview_warning',
            '正式零件删除预览包含警告，不能生成删除确认',
            { partId, warnings: preview.warnings }
        );
    }
    return {
        args: {
            ...args,
            partId,
            model: preview.target.model,
            supplier: preview.target.supplier,
        },
        confirmationRows: [
            { label: '正式零件', value: `${preview.target.model}（#${partId}）` },
            { label: '供应商', value: preview.target.supplier || '-' },
            { label: '类别', value: preview.target.category || '-' },
            { label: '当前价格', value: preview.target.price, suffix: ' 元' },
            { label: '当前库存', value: preview.target.stock },
            { label: '版本', value: preview.normalizedInput.expectedUpdatedAt },
            { label: '删除方式', value: '软删除；历史 operation/audit 保留' },
            { label: '配方快照/库存流水', value: '不变' },
        ],
        executionContext: {
            kind: 'part_delete_target',
            partId,
            model: preview.target.model,
            supplier: preview.target.supplier,
            expectedUpdatedAt: preview.normalizedInput.expectedUpdatedAt,
            preview,
        },
    };
}

async function executePartDelete(args = {}, dependencies = {}) {
    const {
        internalFetch,
        getJson,
        postJson,
        deleteJson,
        confirmationContext,
    } = dependencies;
    const prepared = confirmationContext?.kind === 'part_delete_target'
        ? { executionContext: confirmationContext }
        : await preparePartDelete(args, { internalFetch, getJson, postJson });
    const context = prepared.executionContext;

    const saved = await deleteJson(
        internalFetch,
        `/api/parts/${context.partId}`,
        '零件删除失败',
        {
            expectedUpdatedAt: context.expectedUpdatedAt,
            previewHash: context.preview.previewHash,
        }
    );
    const auditIds = Array.isArray(saved.auditIds)
        ? saved.auditIds.filter(Boolean)
        : saved.auditId
            ? [saved.auditId]
            : [];
    if (
        !saved.operationId
        || saved.status !== 'completed'
        || auditIds.length === 0
        || Number(saved.partId) !== context.partId
        || !Array.isArray(saved.changes)
        || !saved.changes.some(change => (
            change.resourceType === 'part'
            && Number(change.resourceId) === context.partId
            && change.field === 'deletedAt'
        ))
    ) {
        throw partDeleteError(
            'part_delete_receipt_missing',
            '正式零件删除 API 未返回完整且匹配的 operation/audit 回执，不能声明删除成功',
            { partId: context.partId }
        );
    }
    const readback = await getJson(
        internalFetch,
        `/api/parts?keyword=${encodeURIComponent(context.model)}`,
        '零件删除后回读失败'
    );
    if ((Array.isArray(readback) ? readback : []).some(part => Number(part.id ?? part.Id) === context.partId)) {
        throw partDeleteError(
            'part_delete_readback_mismatch',
            '正式零件删除回执已返回，但目录回读仍能看到目标零件',
            { partId: context.partId }
        );
    }
    return {
        success: true,
        message: `零件"${context.model}"已删除`,
        partId: context.partId,
        model: context.model,
        supplier: context.supplier,
        operationId: saved.operationId,
        formalOperationId: saved.operationId,
        auditId: auditIds[0],
        auditIds,
        status: saved.status,
        changes: saved.changes,
        warnings: Array.isArray(saved.warnings) ? saved.warnings : [],
        readback: { visible: false },
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

function assertExactPartFieldChanges({
    expectedChanges = [],
    actualChanges = [],
    field,
    errorCode,
    errorMessage,
}) {
    if (expectedChanges.length === 0 || actualChanges.length !== expectedChanges.length) {
        throw partStockInputError(errorCode, errorMessage);
    }
    const expectedById = new Map();
    for (const change of expectedChanges) {
        const resourceId = Number(change.resourceId);
        if (!Number.isInteger(resourceId) || expectedById.has(resourceId)) {
            throw partStockInputError(errorCode, errorMessage);
        }
        expectedById.set(resourceId, change);
    }
    const seenIds = new Set();
    for (const change of actualChanges) {
        const resourceId = Number(change.resourceId);
        const expected = expectedById.get(resourceId);
        if (
            !expected
            || seenIds.has(resourceId)
            || change.field !== field
            || Number(change.from) !== Number(expected.from)
            || Number(change.to) !== Number(expected.to)
        ) {
            throw partStockInputError(errorCode, errorMessage);
        }
        seenIds.add(resourceId);
    }
    if (seenIds.size !== expectedById.size) {
        throw partStockInputError(errorCode, errorMessage);
    }
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

    assertExactPartFieldChanges({
        expectedChanges: previewOperations.map(operation => ({
            resourceId: operation.partId,
            field: 'stock',
            from: operation.currentStock,
            to: operation.nextStock,
        })),
        actualChanges: resultChanges,
        field: 'stock',
        errorCode: 'part_stock_result_mismatch',
        errorMessage: '正式库存 API 返回的零件、原库存或结果库存与确认内容不一致，不能声明成功',
    });

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
    // NATIVE-W1：把正式预览回执里的结构化事实原样带出来，供上层冻结提案
    // （零件身份 + 当前库存 + 调整量 + 调整后库存）。这里不新增业务计算，只做投影。
    const proposalItems = preview.operations.map(operation => ({
        partId: Number(operation.partId),
        model: String(operation.model || '').trim(),
        currentStock: Number(operation.currentStock),
        delta: Number(operation.delta),
        nextStock: Number(operation.nextStock),
        expectedUpdatedAt: operation.expectedUpdatedAt || null,
        clampedToZero: operation.clampedToZero === true,
    }));
    return {
        args: {
            ...args,
            items: canonicalItems,
        },
        proposal: {
            kind: 'part_stock_adjust',
            capabilityId: 'inventory.parts.batch_adjust_stock',
            items: proposalItems,
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
        changes.push(`目录成本价: ${target.price} → ${price}`);
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

function partPriceInputError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
}

function normalizedPartIdentityText(value) {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('zh-CN');
}

function resolvePartPriceTargets(args = {}, allParts = []) {
    const hasCategory = typeof args.category === 'string' && args.category.trim().length > 0;
    const hasTargets = Array.isArray(args.targets);
    if (hasCategory === hasTargets) {
        throw partPriceInputError(
            'part_price_selector_invalid',
            'category 与 targets 必须且只能提供一种'
        );
    }

    if (hasCategory) {
        const category = args.category.trim();
        const targets = allParts.filter(part => (
            (part.category || '') === category
            || (part.category || '').includes(category)
        ));
        if (targets.length === 0) {
            throw partPriceInputError(
                'part_price_category_not_found',
                `没有找到类别包含"${category}"的零件`,
                { category }
            );
        }
        return { mode: 'category', category, targets };
    }

    if (args.targets.length === 0 || args.targets.length > 8) {
        throw partPriceInputError(
            'part_price_targets_invalid',
            'targets 必须包含 1 到 8 个明确零件目标'
        );
    }
    const resolved = args.targets.map((selector, index) => {
        const partId = Number(selector?.partId);
        const hasPartId = Number.isInteger(partId) && partId > 0;
        const model = String(selector?.model || '').trim();
        const supplier = String(selector?.supplier || '').trim();
        const hasIdentity = Boolean(model && supplier);
        if (hasPartId === hasIdentity) {
            throw partPriceInputError(
                'part_price_target_selector_invalid',
                `targets[${index}] 必须且只能使用 partId，或同时提供 model 和 supplier`,
                { index }
            );
        }
        const matches = hasPartId
            ? allParts.filter(part => Number(part.id ?? part.Id) === partId)
            : allParts.filter(part => (
                normalizedPartIdentityText(part.model) === normalizedPartIdentityText(model)
                && normalizedPartIdentityText(part.supplier) === normalizedPartIdentityText(supplier)
            ));
        if (matches.length === 0) {
            throw partPriceInputError(
                'part_price_target_not_found',
                hasPartId
                    ? `未找到零件 #${partId}`
                    : `未找到型号"${model}"且供应商为"${supplier}"的零件`,
                { index, partId: hasPartId ? partId : undefined, model, supplier }
            );
        }
        if (matches.length > 1) {
            throw partPriceInputError(
                'part_price_target_ambiguous',
                `targets[${index}] 匹配到多个正式零件，已停止整批调价`,
                {
                    index,
                    candidates: matches.slice(0, 10).map(part => ({
                        partId: part.id ?? part.Id,
                        model: part.model,
                        supplier: part.supplier,
                    })),
                }
            );
        }
        const target = matches[0];
        if (
            target.price === undefined
            || target.price === null
            || target.price === ''
            || !Number.isFinite(Number(target.price))
        ) {
            throw partPriceInputError(
                'part_price_current_price_missing',
                `零件"${target.model}"缺少有效当前价格，不能生成调价确认`,
                { partId: target.id ?? target.Id, model: target.model }
            );
        }
        return target;
    });
    const resolvedIds = resolved.map(part => Number(part.id ?? part.Id));
    if (new Set(resolvedIds).size !== resolvedIds.length) {
        throw partPriceInputError(
            'part_price_target_duplicate',
            '多个目标解析到同一个零件，已停止整批调价'
        );
    }
    return { mode: 'targets', category: null, targets: resolved };
}

function assertPartPriceCommandReceipt(result = {}) {
    const auditIds = Array.isArray(result.auditIds)
        ? result.auditIds.filter(Boolean)
        : result.auditId
            ? [result.auditId]
            : [];
    if (!result.operationId || result.status !== 'completed' || auditIds.length === 0) {
        throw partPriceInputError(
            'part_price_receipt_missing',
            '正式调价 API 未返回完整 operation/audit 回执，不能声明调价成功'
        );
    }
    return auditIds;
}

function bindTargetPricePreview(selection, details, preview) {
    if (selection.mode !== 'targets') return details;
    const previewUpdates = Array.isArray(preview?.updates) ? preview.updates : [];
    const previewChanges = Array.isArray(preview?.changes) ? preview.changes : [];
    const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
    const errorMessage = '正式调价预览与明确目标或候选价格不一致，不能生成确认卡';
    if (
        warnings.length > 0
        || previewUpdates.length !== details.length
        || previewChanges.length !== details.length
    ) {
        throw partPriceInputError('part_price_preview_target_drift', errorMessage);
    }
    assertExactPartFieldChanges({
        expectedChanges: details.map(detail => ({
            resourceId: detail.partId,
            field: 'price',
            from: detail.oldPrice,
            to: detail.newPrice,
        })),
        actualChanges: previewChanges,
        field: 'price',
        errorCode: 'part_price_preview_target_drift',
        errorMessage,
    });
    const updatesById = new Map();
    for (const update of previewUpdates) {
        const partId = Number(update.partId);
        if (updatesById.has(partId)) {
            throw partPriceInputError('part_price_preview_target_drift', errorMessage);
        }
        updatesById.set(partId, update);
    }
    const identityById = new Map(details.map(detail => [Number(detail.partId), detail]));
    return previewChanges.map(change => {
        const partId = Number(change.resourceId);
        const identity = identityById.get(partId);
        const update = updatesById.get(partId);
        if (!identity || !update || Number(update.price) !== Number(change.to)) {
            throw partPriceInputError('part_price_preview_target_drift', errorMessage);
        }
        return {
            partId,
            model: identity.model,
            supplier: identity.supplier,
            oldPrice: Number(change.from),
            newPrice: Number(change.to),
        };
    });
}

async function verifyPartPriceReadback({ internalFetch, getJson, preview, result }) {
    const updates = Array.isArray(preview?.updates) ? preview.updates : [];
    const previewChanges = Array.isArray(preview?.changes) ? preview.changes : [];
    const changes = Array.isArray(result?.changes) ? result.changes : [];
    if (
        updates.length === 0
        || previewChanges.length !== updates.length
        || Number(result.updatedCount) !== updates.length
        || changes.length !== updates.length
    ) {
        throw partPriceInputError(
            'part_price_result_mismatch',
            '正式调价 API 返回的变更数量与确认内容不一致，不能声明成功'
        );
    }
    assertExactPartFieldChanges({
        expectedChanges: previewChanges,
        actualChanges: changes,
        field: 'price',
        errorCode: 'part_price_result_mismatch',
        errorMessage: '正式调价 API 返回的零件、原价格或结果价格与确认内容不一致，不能声明成功',
    });
    const currentParts = await getJson(internalFetch, '/api/parts', '零件价格回读失败');
    return updates.map(update => {
        const part = currentParts.find(candidate => (
            Number(candidate.id ?? candidate.Id) === Number(update.partId)
        ));
        if (!part || Number(part.price) !== Number(update.price)) {
            throw partPriceInputError(
                'part_price_readback_mismatch',
                `零件 #${update.partId} 价格回读与正式命令结果不一致，不能声明成功`
            );
        }
        return {
            partId: part.id ?? part.Id,
            model: part.model,
            supplier: part.supplier,
            price: Number(part.price),
        };
    });
}

async function preparePartPriceBatch(args = {}, dependencies = {}) {
    const {
        internalFetch,
        getJson,
        postJson,
    } = dependencies;
    const { percentChange, absoluteChange } = args;
    if ((percentChange === undefined) === (absoluteChange === undefined)) {
        throw partPriceInputError(
            'part_price_change_invalid',
            'percentChange 与 absoluteChange 必须且只能提供一种'
        );
    }

    const allParts = await getJson(internalFetch, '/api/parts', '零件列表读取失败');
    const selection = resolvePartPriceTargets(args, allParts);
    const { category, targets } = selection;

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
        details.push({
            partId: part.id ?? part.Id,
            model: part.model,
            supplier: part.supplier || '',
            oldPrice,
            newPrice,
        });
    }

    const preview = await postJson(
        internalFetch,
        '/api/parts/prices-preview',
        { updates },
        '批量调价预览失败'
    );
    if (
        !preview?.previewHash
        || !preview?.suggestedIdempotencyKey
        || !Array.isArray(preview.updates)
        || !Array.isArray(preview.changes)
    ) {
        const error = new Error('正式批量调价预览没有返回完整版本和幂等凭证');
        error.code = 'part_price_preview_invalid';
        throw error;
    }
    const confirmedDetails = bindTargetPricePreview(selection, details, preview);
    return {
        args: selection.mode === 'targets'
            ? {
                ...args,
                targets: targets.map(part => ({ partId: part.id ?? part.Id })),
            }
            : args,
        confirmationRows: [
            {
                label: selection.mode === 'category' ? '正式命中类别' : '正式命中目标',
                value: selection.mode === 'category'
                    ? `${category}（${targets.length} 个零件）`
                    : `${targets.length} 个明确零件`,
            },
            ...(selection.mode === 'targets' ? confirmedDetails : confirmedDetails.slice(0, 8)).map(item => ({
                label: `${item.model}${item.supplier ? `（${item.supplier}）` : ''}`,
                value: `${item.oldPrice} 元 → ${item.newPrice} 元`,
            })),
        ],
        executionContext: {
            kind: 'part_price_preview',
            updates: preview.updates,
            changes: preview.changes,
            warnings: Array.isArray(preview.warnings) ? preview.warnings : [],
            previewHash: preview.previewHash,
            idempotencyKey: preview.suggestedIdempotencyKey,
            category,
            selectorMode: selection.mode,
            details: confirmedDetails,
            targetCount: targets.length,
        },
    };
}

async function executePartPriceBatch(args = {}, dependencies = {}) {
    const { internalFetch, getJson, postJson, patchJson, confirmationContext } = dependencies;
    const prepared = confirmationContext?.kind === 'part_price_preview'
        ? { executionContext: confirmationContext }
        : await preparePartPriceBatch(args, { internalFetch, getJson, postJson });
    const preview = prepared.executionContext;
    const result = await patchJson(internalFetch, '/api/parts/prices', {
        updates: preview.updates,
        previewHash: preview.previewHash,
        idempotencyKey: preview.idempotencyKey,
    }, '批量调价失败');
    const auditIds = assertPartPriceCommandReceipt(result);
    const readback = await verifyPartPriceReadback({
        internalFetch,
        getJson,
        preview,
        result,
    });
    const { category, selectorMode, details, targetCount } = preview;
    const { percentChange, absoluteChange } = args;

    return {
        success: true,
        message: selectorMode === 'targets'
            ? `已更新 ${result.updatedCount ?? targetCount} 个明确零件的价格`
            : `已批量更新${result.updatedCount ?? targetCount}个"${category}"类零件的价格`,
        category,
        count: result.updatedCount ?? targetCount,
        changeType: percentChange !== undefined
            ? `${percentChange > 0 ? '+' : ''}${percentChange}%`
            : `${absoluteChange > 0 ? '+' : ''}${absoluteChange}元`,
        details,
        operationId: result.operationId,
        formalOperationId: result.operationId,
        auditId: auditIds[0],
        auditIds,
        status: result.status,
        changes: result.changes,
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
        readback,
    };
}

/**
 * NATIVE-W1：对账期（没有 executor 回执时的）独立回读核验。
 * 只做「读正式目录 + 比对冻结的 nextStock」，不写任何数据；不一致即抛错，绝不宣告成功。
 */
async function verifyPartStockTargetState({ internalFetch, getJson, target }) {
    const partId = Number(target?.partId);
    const expectedStock = Number(target?.nextStock);
    if (!Number.isInteger(partId) || partId < 1 || !Number.isInteger(expectedStock)) {
        throw partStockInputError('part_stock_readback_target_invalid', '冻结提案缺少可核验的零件身份或目标库存');
    }
    const parts = await getJson(internalFetch, '/api/parts', '零件库存回读失败');
    const part = (Array.isArray(parts) ? parts : []).find(candidate => (
        Number(candidate.id ?? candidate.Id) === partId
    ));
    if (!part) {
        throw partStockInputError('part_stock_readback_missing', `回读时找不到零件 #${partId}，不能声明执行成功`);
    }
    if (Number(part.stock) !== expectedStock) {
        throw partStockInputError(
            'part_stock_readback_mismatch',
            `零件"${part.model || partId}"库存回读为 ${Number(part.stock)}，与冻结的调整后库存 ${expectedStock} 不一致，不能声明成功`
        );
    }
    return Object.freeze({ partId, model: String(part.model || ''), stock: Number(part.stock) });
}

module.exports = {
    executePartBatchCreate,
    executePartCreate,
    executePartDelete,
    executePartPriceBatch,
    executePartStockAdjustment,
    executePartUpdate,
    assertPartPriceCommandReceipt,
    assertPartStockCommandReceipt,
    preparePartBatchCreate,
    preparePartDelete,
    preparePartPriceBatch,
    preparePartStockAdjustment,
    resolvePartPriceTargets,
    resolvePartDeleteTarget,
    resolvePartStockTargets,
    similarPartCandidates,
    verifyPartStockReadback,
    verifyPartStockTargetState,
};
