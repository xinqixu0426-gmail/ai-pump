const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
    requestHash,
} = require('./commandExecution.cjs');
const {
    assertPreviewHash,
    normalizePreviewHash,
} = require('./previewIntegrity.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const { buildBalancedOrderPlans } = require('./orderPlanning.cjs');
const {
    parseJsonArray,
    parseNonNegativeNumber,
    parsePositiveId,
    parsePositiveNumber,
} = require('./validation.cjs');

const CAPABILITY_ID = requireBusinessCapability(
    'workflow.quotation.convert_to_order'
).capabilityId;

function roundMoney(value) {
    return Math.round(value * 100) / 100;
}

function conversionError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function withoutGeneratedIds(value) {
    if (Array.isArray(value)) return value.map(withoutGeneratedIds);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => key !== 'id')
            .map(([key, nested]) => [key, withoutGeneratedIds(nested)])
    );
}

function quotationConversionPreviewHash(draft) {
    return requestHash({
        capabilityId: CAPABILITY_ID,
        quotationId: draft.quotationId,
        expectedUpdatedAt: draft.expectedUpdatedAt,
        customerName: draft.customerName,
        contractNo: draft.contractNo,
        remark: draft.remark,
        status: draft.status,
        items: withoutGeneratedIds(draft.items),
        purchaseList: withoutGeneratedIds(draft.purchaseList),
        todos: withoutGeneratedIds(draft.todos),
    });
}

function buildQuotationOrderDraft(dependencies, quotationIdValue, options = {}) {
    const {
        db,
        dbGetAllParts,
        dbGetAllCoils,
    } = dependencies;
    const quotationId = parsePositiveId(quotationIdValue);
    if (!quotationId) throw conversionError('quotation_id_invalid', '非法报价ID', 400);
    const quotation = options.quotation || db.prepare(
        'SELECT * FROM quotations WHERE id = ? AND deleted_at IS NULL'
    ).get(quotationId);
    if (!quotation) throw conversionError('quotation_not_found', '报价单不存在', 404);
    const customer = db.prepare(
        'SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL'
    ).get(quotation.customer_id);
    if (!customer) throw conversionError('quotation_customer_not_found', '报价客户不存在', 409);

    let orderItems;
    try {
        const quotationItems = parseJsonArray(quotation.items_json);
        orderItems = quotationItems.map((item, index) => {
            const recipeId = parsePositiveId(item.baseRecipeId);
            const recipe = recipeId
                ? db.prepare('SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL').get(recipeId)
                : null;
            const unitCost = item.unitCost == null
                ? parseNonNegativeNumber(recipe?.saved_total_cost, `quotationItems[${index}].unitCost`)
                : parseNonNegativeNumber(item.unitCost, `quotationItems[${index}].unitCost`);
            const margin = parsePositiveNumber(
                item.margin,
                `quotationItems[${index}].margin`,
                { defaultValue: 1.1 }
            );
            const unitPrice = item.unitPrice == null
                ? roundMoney(unitCost * margin)
                : parseNonNegativeNumber(item.unitPrice, `quotationItems[${index}].unitPrice`);
            const qty = parsePositiveNumber(
                item.qty,
                `quotationItems[${index}].qty`,
                { defaultValue: 1 }
            );
            const bomSnapshot = Array.isArray(item.bomSnapshot) && item.bomSnapshot.length > 0
                ? item.bomSnapshot
                : parseJsonArray(item.partsJson || recipe?.parts_json);
            if (bomSnapshot.length === 0) {
                throw new Error(`报价明细「${item.baseRecipeName || index + 1}」缺少 BOM 快照`);
            }
            return {
                id: String(item.id || `quotation-${quotationId}-${index}`),
                recipeId: recipe?.id || recipeId || undefined,
                recipeName: item.baseRecipeName || recipe?.name || '未命名产品',
                spec: item.spec || recipe?.spec || '',
                qty,
                unitCost: roundMoney(unitCost),
                unitPrice: roundMoney(unitPrice),
                profitMargin: unitCost > 0 ? roundMoney(unitPrice / unitCost) : margin,
                partsJson: JSON.stringify(bomSnapshot),
                quotationItemId: item.id,
                snapshotVersion: Number(item.snapshotVersion || 0),
                snapshotSource: item.snapshotVersion ? 'quotation' : 'legacy_recipe_fallback',
                costSnapshot: item.costSnapshot || null,
            };
        });
    } catch (error) {
        if (error instanceof CommandExecutionError) throw error;
        throw conversionError(
            'quotation_conversion_precondition_failed',
            error?.message || '报价明细不满足转订单条件',
            409
        );
    }

    if (orderItems.length === 0) {
        throw conversionError('quotation_items_required', '报价没有可转订单的明细', 409);
    }
    const activeOrders = db.prepare(`
        SELECT * FROM orders
        WHERE deleted_at IS NULL AND status NOT IN ('已关闭', '已取消')
        ORDER BY created_at, id
    `).all();
    const draftOrder = {
        id: -1,
        created_at: new Date().toISOString(),
        items: orderItems,
        purchase_list_json: '[]',
    };
    const plan = buildBalancedOrderPlans(
        [...activeOrders, draftOrder],
        dbGetAllParts(),
        { coilsCatalog: dbGetAllCoils() }
    ).get(-1);
    const draft = {
        capabilityId: CAPABILITY_ID,
        quotationId,
        expectedUpdatedAt: quotation.updated_at,
        suggestedIdempotencyKey: `quotation-convert:${quotationId}:${crypto.randomUUID()}`,
        customerName: customer.name || 'Unknown',
        contractNo: '',
        remark: `由报价 #${quotation.id} 转订单${quotation.remark ? `：${quotation.remark}` : ''}`,
        status: '待采购',
        items: orderItems,
        purchaseList: plan.purchaseList,
        todos: plan.todos,
    };
    return {
        ...draft,
        previewHash: quotationConversionPreviewHash(draft),
    };
}

function executeQuotationConversion(dependencies, input = {}, commandContext = {}) {
    const {
        db,
        dbGetAllParts,
        dbGetAllCoils,
        orderRow,
        quotationRow,
        safeInsert,
        safeUpdate,
    } = dependencies;
    const quotationId = parsePositiveId(input.quotationId);
    if (!quotationId) throw conversionError('quotation_id_invalid', '非法报价ID', 400);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const expectedPreviewHash = normalizePreviewHash(input.previewHash);
    const compatibilityWarnings = [];
    if (!expectedUpdatedAt) {
        compatibilityWarnings.push({
            code: 'expected_updated_at_missing_compatibility',
            message: `报价 #${quotationId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
            resourceId: quotationId,
        });
    }
    if (!expectedPreviewHash) {
        compatibilityWarnings.push({
            code: 'preview_hash_missing_compatibility',
            message: `报价 #${quotationId} 未提供 previewHash，执行内容与确认预览未绑定`,
            resourceId: quotationId,
        });
    }

    return executePersistentCommand({
        db,
        ...commandContext,
        input: { quotationId, expectedUpdatedAt, previewHash: expectedPreviewHash },
        warnings: [...(commandContext.warnings || []), ...compatibilityWarnings],
        execute: ({ auditContext }) => {
            const quotation = db.prepare(
                'SELECT * FROM quotations WHERE id = ? AND deleted_at IS NULL'
            ).get(quotationId);
            if (!quotation) throw conversionError('quotation_not_found', '报价单不存在', 404);
            assertExpectedUpdatedAt(quotation, expectedUpdatedAt, `报价 #${quotationId}`);
            if (quotation.converted_order_id || quotation.status === '已转订单') {
                throw conversionError(
                    'quotation_already_converted',
                    '该报价已经转为订单，不能重复转单',
                    409
                );
            }
            if (quotation.status !== '已接受') {
                throw conversionError(
                    'quotation_status_conflict',
                    '只有已接受的报价可以转为订单',
                    409
                );
            }

            const draft = buildQuotationOrderDraft(
                { db, dbGetAllParts, dbGetAllCoils },
                quotationId,
                { quotation }
            );
            assertPreviewHash(
                expectedPreviewHash,
                draft.previewHash,
                '报价转订单预览所依据的采购计划或库存已经变化，请重新预览并确认'
            );
            const now = new Date().toISOString();
            const orderWrite = safeInsert('orders', {
                customer_name: draft.customerName,
                contract_no: draft.contractNo || '',
                remark: draft.remark || '',
                status: '待采购',
                items_json: JSON.stringify(draft.items),
                purchase_list_json: JSON.stringify(draft.purchaseList),
                todos_json: JSON.stringify(draft.todos),
                created_at: now,
                updated_at: now,
            }, auditContext);
            const orderId = Number(orderWrite.lastInsertRowid);
            const quotationWrite = safeUpdate('quotations', quotationId, {
                status: '已转订单',
                converted_order_id: orderId,
                converted_at: now,
            }, auditContext);
            return {
                data: {
                    order: orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)),
                    quotation: quotationRow(
                        db.prepare('SELECT * FROM quotations WHERE id = ?').get(quotationId)
                    ),
                },
                resource: {
                    type: 'quotation_to_order',
                    ids: [quotationId, orderId],
                },
                changes: [
                    {
                        resourceType: 'order',
                        resourceId: orderId,
                        field: 'created',
                        from: null,
                        to: orderId,
                    },
                    {
                        resourceType: 'quotation',
                        resourceId: quotationId,
                        field: 'status',
                        from: quotation.status,
                        to: '已转订单',
                        convertedOrderId: orderId,
                    },
                ],
                auditIds: [orderWrite.auditId, quotationWrite.auditId],
                requiredAuditCount: 2,
            };
        },
    });
}

module.exports = {
    CAPABILITY_ID,
    buildQuotationOrderDraft,
    executeQuotationConversion,
    quotationConversionPreviewHash,
};
