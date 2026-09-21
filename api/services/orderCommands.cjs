const { hydrateCatalogRow, hydrateCatalogRows } = require('./catalogLiveReferences.cjs');
const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { ACTIVE_ORDERS_SQL } = require('./activeOrderReadiness.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
    requestHash,
} = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const { adjustCoilStock } = require('./coilInventory.cjs');
const {
    buildCurrentBalancedPurchasePlans,
} = require('./orderPurchasePlanning.cjs');
const { buildBalancedOrderPlans } = require('./orderPlanning.cjs');
const {
    ORDER_STATUSES,
    assertOrderTransition,
    deriveProcurementStatus,
    normalizePurchaseItem,
    orderCoreEditEligibility,
} = require('./orderWorkflow.cjs');
const {
    assertPreviewHash,
    normalizePreviewHash,
    stablePreviewValue,
} = require('./previewIntegrity.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const {
    parseJsonArray,
    parseNonNegativeNumber,
    parsePositiveId,
    parsePositiveNumber,
} = require('./validation.cjs');
const { buildConfiguredRecipeSnapshot } = require('./configuredRecipeSnapshot.cjs');
const { normalizeNewOrderBomSnapshot } = require('./orderBomSnapshot.cjs');
const {
    buildOrderRevisionChanges,
    normalizeRevisionReason,
    orderBusinessSnapshot,
} = require('./orderRevisions.cjs');

const CREATE_CAPABILITY_ID = requireBusinessCapability('orders.create').capabilityId;
const STATUS_CAPABILITY_ID = requireBusinessCapability('orders.change_status').capabilityId;
const UPDATE_CAPABILITY_ID = requireBusinessCapability('orders.update_draft').capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability('orders.delete').capabilityId;
const CLOSE_INVENTORY_DISPOSITIONS = new Set([
    'order_outbound_deducted',
    'manual_outbound_confirmed',
    'reservation_released',
]);

function orderCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function roundMoney(value) {
    return Math.round(value * 100) / 100;
}

function normalizeOrderItems(dependencies, items, options = {}) {
    if (!Array.isArray(items)) return { items: [], warnings: [] };
    const { db } = dependencies;
    const warnings = [];
    const existingItems = new Map((options.existingItems || []).map((item, index) => [
        String(item.id || `${item.recipeId || 0}:${index}`),
        item,
    ]));
    const normalizedItems = items
        .filter(Boolean)
        .map((item, index) => {
            const recipeId = parsePositiveId(item.recipeId);
            if (!recipeId) throw orderCommandError(
                'order_recipe_required',
                `items[${index}].recipeId 必须引用有效配方`,
                422
            );
            let recipe = db.prepare(`
                SELECT *
                FROM recipes
                WHERE id = ? AND deleted_at IS NULL
            `).get(recipeId);
            if (!recipe) throw orderCommandError(
                'order_recipe_not_found',
                `配方 #${recipeId} 不存在或已停用`,
                422
            );
            recipe = hydrateCatalogRow(db, 'recipe', recipe);
            const hasConfigurationOverrides = Object.prototype.hasOwnProperty.call(item, 'configurationOverrides')
                || Object.prototype.hasOwnProperty.call(item, 'overrides');
            const existingItem = existingItems.get(String(item.id || ''));
            const samePersistedSnapshot = Boolean(
                existingItem
                && Number(existingItem.recipeId) === recipeId
                && (!hasConfigurationOverrides || requestHash(
                    existingItem.configurationOverrides || existingItem.overrides || {}
                ) === requestHash(item.configurationOverrides ?? item.overrides ?? {}))
            );
            const configured = hasConfigurationOverrides && !samePersistedSnapshot
                ? buildConfiguredRecipeSnapshot(
                    dependencies,
                    recipeId,
                    item.configurationOverrides ?? item.overrides,
                    {
                        recipe,
                        overridesField: `items[${index}].configurationOverrides`,
                    }
                )
                : null;
            const parts = normalizeNewOrderBomSnapshot(
                dependencies,
                samePersistedSnapshot
                    ? parseJsonArray(existingItem.partsJson)
                    : configured?.bomSnapshot || parseJsonArray(recipe.parts_json)
            );
            const unitCost = samePersistedSnapshot
                ? Number(existingItem.unitCost)
                : configured?.unitCost ?? Number(recipe.saved_total_cost);
            if (!Number.isFinite(unitCost) || unitCost <= 0 || parts.length === 0) {
                throw orderCommandError(
                    'order_recipe_snapshot_incomplete',
                    `配方“${recipe.name || recipeId}”缺少完整保存成本或 BOM，请先重新保存配方`,
                    422
                );
            }
            const profitMargin = parsePositiveNumber(
                item.profitMargin,
                `items[${index}].profitMargin`,
                { defaultValue: 1.1 }
            );
            const unitPrice = item.unitPrice === undefined
                ? roundMoney(unitCost * profitMargin)
                : parseNonNegativeNumber(item.unitPrice, `items[${index}].unitPrice`);
            const pricingMode = item.pricingMode === 'manual' ? 'manual' : 'margin';
            const itemWarnings = samePersistedSnapshot
                ? (existingItem.configurationWarnings || [])
                : (configured?.warnings || []);
            if (itemWarnings.length) {
                warnings.push(...itemWarnings.map(warning => ({
                    ...warning,
                    itemIndex: index,
                    recipeId,
                    recipeName: String(recipe.name || recipeId),
                })));
            }
            return {
                id: String(item.id || `order-item-${recipeId}-${index}`),
                recipeId,
                recipeName: String(recipe.name || '未命名产品'),
                externalModel: String((Number(existingItem?.recipeId) === recipeId && existingItem?.externalModel) || recipe.external_model || recipe.name || ''),
                spec: String(recipe.spec || ''),
                qty: parsePositiveNumber(
                    item.qty,
                    `items[${index}].qty`,
                    { defaultValue: 1 }
                ),
                unitCost: roundMoney(unitCost),
                unitPrice: roundMoney(unitPrice),
                profitMargin: roundMoney(unitPrice / unitCost),
                pricingMode,
                partsJson: JSON.stringify(parts),
                ...(samePersistedSnapshot ? {
                    configurationOverrides: existingItem.configurationOverrides,
                    configurationSnapshot: existingItem.configurationSnapshot,
                    costSnapshot: existingItem.costSnapshot,
                    configurationWarnings: itemWarnings,
                    snapshotVersion: existingItem.snapshotVersion,
                    snapshotSource: existingItem.snapshotSource,
                } : configured ? {
                    configurationOverrides: configured.configurationOverrides,
                    configurationSnapshot: configured.configurationSnapshot,
                    costSnapshot: configured.costSnapshot,
                    configurationWarnings: configured.warnings,
                    snapshotVersion: 2,
                    snapshotSource: 'direct_order',
                } : {}),
            };
        });
    return { items: normalizedItems, warnings };
}

function normalizeOrderDraftInput(body = {}) {
    return {
        orderId: body.orderId ?? body.order_id,
        customerId: body.customerId ?? body.customer_id,
        customerName: body.customerName ?? body.customer_name,
        contractNo: body.contractNo ?? body.contract_no,
        remark: body.remark,
        status: body.status,
        items: body.items ?? parseJsonArray(body.itemsJson ?? body.items_json),
        purchaseList: body.purchaseList
            ?? parseJsonArray(body.purchaseListJson ?? body.purchase_list_json),
        todos: body.todos ?? parseJsonArray(body.todosJson ?? body.todos_json),
        editReason: body.editReason ?? body.edit_reason,
    };
}

function resolveOrderCustomer(db, input = {}) {
    const rawCustomerId = input.customerId;
    const customerId = rawCustomerId === undefined || rawCustomerId === null || rawCustomerId === ''
        ? null
        : parsePositiveId(rawCustomerId);
    if (rawCustomerId !== undefined && rawCustomerId !== null && rawCustomerId !== '' && !customerId) {
        throw orderCommandError('order_customer_id_invalid', '非法客户ID', 400);
    }
    const customerName = String(input.customerName || '').trim();
    const customer = customerId
        ? db.prepare('SELECT id, name FROM customers WHERE id = ? AND deleted_at IS NULL').get(customerId)
        : customerName
            ? db.prepare('SELECT id, name FROM customers WHERE name = ? AND deleted_at IS NULL').get(customerName)
            : null;
    if (!customer) {
        throw orderCommandError(
            'order_customer_not_found',
            customerId ? `客户 #${customerId} 不存在或已停用` : '请选择有效客户',
            422
        );
    }
    return {
        customerId: Number(customer.id),
        customerName: String(customer.name || '').trim(),
        resolvedByLegacyName: !customerId,
    };
}

function orderSavePreviewHash(capabilityId, payload) {
    const { itemsJson, ...stablePayload } = payload;
    return requestHash({
        capabilityId,
        payload: stablePreviewValue({
            ...stablePayload,
            // itemsJson 内含服务端生成时间；先恢复结构再过滤瞬时字段，
            // 避免同一业务输入在确认执行时产生伪 preview_changed。
            items: parseJsonArray(itemsJson),
        }),
    });
}

function orderCreatePreviewHash(payload) {
    return orderSavePreviewHash(CREATE_CAPABILITY_ID, { ...payload, status: '待确认' });
}

function buildOrderSavePayloadDraft(dependencies, body = {}) {
    const {
        db,
        dbGetAllCoils,
        dbGetAllParts,
    } = dependencies;
    const input = normalizeOrderDraftInput(body);
    const rawOrderId = input.orderId;
    const orderId = rawOrderId === undefined || rawOrderId === null || rawOrderId === ''
        ? null
        : parsePositiveId(rawOrderId);
    if (rawOrderId !== undefined && rawOrderId !== null && rawOrderId !== '' && !orderId) {
        throw orderCommandError('order_id_invalid', '非法订单ID', 400);
    }
    const currentRecord = orderId ? getOrderRecord(db, orderId) : null;
    const currentSnapshot = currentRecord ? orderBusinessSnapshot(currentRecord) : null;
    const editReason = currentRecord ? normalizeRevisionReason(input.editReason) : '';
    if (currentRecord) {
        const eligibility = orderCoreEditEligibility(
            currentRecord.status,
            parseJsonArray(currentRecord.purchase_list_json)
        );
        if (!eligibility.allowed) {
            throw orderCommandError(
                'order_update_status_conflict',
                `${eligibility.reason}，请使用后续订单变更单处理`,
                409
            );
        }
    }
    const customer = resolveOrderCustomer(db, input);
    let items;
    let configurationWarnings = [];
    try {
        const normalized = normalizeOrderItems(dependencies, input.items, {
            existingItems: currentSnapshot?.items || [],
        });
        items = normalized.items;
        configurationWarnings = normalized.warnings;
    } catch (error) {
        if (error instanceof CommandExecutionError) throw error;
        if (error?.statusCode || error?.code) {
            throw orderCommandError(
                error.code || 'order_configuration_invalid',
                error.message || '订单配置参数无效',
                error.statusCode || 400
            );
        }
        throw orderCommandError(
            'order_draft_invalid',
            error?.message || '订单草稿参数无效',
            400
        );
    }
    if (items.length === 0) throw orderCommandError(
        'order_items_required',
        '至少添加一个订单产品',
        400
    );

    const providedPurchaseList = parseJsonArray(input.purchaseList);
    const providedTodos = parseJsonArray(input.todos);
    const activeOrders = db.prepare(ACTIVE_ORDERS_SQL).all()
        .filter(record => Number(record.id) !== orderId);
    const draftOrderId = orderId || -1;
    const draftOrder = {
        id: draftOrderId,
        created_at: currentRecord?.created_at || new Date().toISOString(),
        items,
        purchase_list_json: '[]',
    };
    const plan = buildBalancedOrderPlans(
        [...hydrateCatalogRows(db, 'order', activeOrders), draftOrder],
        dbGetAllParts(),
        { coilsCatalog: dbGetAllCoils() }
    ).get(draftOrderId);
    const status = currentRecord?.status || input.status || '待确认';
    if (!ORDER_STATUSES.has(status)) {
        throw orderCommandError('order_status_invalid', '非法订单状态', 400);
    }

    const payload = {
        customerId: customer.customerId,
        customerName: customer.customerName,
        contractNo: String(input.contractNo || '').trim(),
        remark: String(input.remark || ''),
        status,
        itemsJson: JSON.stringify(items),
        purchaseListJson: JSON.stringify(plan.purchaseList || []),
        todosJson: JSON.stringify(plan.todos || []),
        ...(currentRecord ? { orderId, editReason } : {}),
    };
    const capabilityId = currentRecord ? UPDATE_CAPABILITY_ID : CREATE_CAPABILITY_ID;
    const afterSnapshot = currentRecord ? orderBusinessSnapshot({
        ...currentRecord,
        customer_id: payload.customerId,
        customer_name: payload.customerName,
        contract_no: payload.contractNo,
        remark: payload.remark,
        items_json: payload.itemsJson,
        purchase_list_json: payload.purchaseListJson,
        todos_json: payload.todosJson,
    }) : null;
    const changes = currentRecord
        ? buildOrderRevisionChanges(currentSnapshot, afterSnapshot)
        : [{
            resourceType: 'order',
            field: 'created',
            from: null,
            to: {
                customerId: customer.customerId,
                customerName: customer.customerName,
                status: '待确认',
                itemCount: items.length,
            },
        }];
    const lowPriceWarnings = items
        .filter(item => Number(item.unitPrice) < Number(item.unitCost))
        .map((item, index) => ({
            code: 'order_unit_price_below_cost',
            message: `产品“${item.recipeName}”销售单价低于单位成本，请确认本次让价`,
            itemIndex: index,
            recipeId: item.recipeId,
        }));
    return {
        ...payload,
        capabilityId,
        preview: true,
        requiresConfirmation: true,
        suggestedIdempotencyKey: currentRecord
            ? `order-update:${orderId}:${crypto.randomUUID()}`
            : `order-create:${crypto.randomUUID()}`,
        previewHash: currentRecord
            ? orderSavePreviewHash(UPDATE_CAPABILITY_ID, payload)
            : orderCreatePreviewHash(payload),
        changes,
        warnings: [
            ...(customer.resolvedByLegacyName ? [{
                code: 'customer_name_compatibility_resolved',
                message: '兼容请求已按客户名称解析为稳定 customerId；新增调用请直接提交 customerId',
            }] : []),
            ...((providedPurchaseList.length > 0 || providedTodos.length > 0) ? [{
                code: 'client_plan_ignored',
                message: '客户端采购清单和待办已忽略，正式结果由服务端按订单 BOM 和实时库存重新生成',
            }] : []),
            ...configurationWarnings,
            ...lowPriceWarnings,
        ],
    };
}

function executeOrderCreate(dependencies, input = {}, commandContext = {}) {
    const {
        db,
        orderRow,
        safeInsert,
    } = dependencies;
    const draft = buildOrderSavePayloadDraft(
        dependencies,
        {
            ...input,
            status: '待确认',
        }
    );
    const expectedPreviewHash = normalizePreviewHash(input.previewHash);
    const compatibilityWarnings = [];
    if (!expectedPreviewHash) {
        compatibilityWarnings.push({
            code: 'preview_hash_missing_compatibility',
            message: '建单请求未提供 previewHash，执行内容与确认预览未绑定',
        });
    }

    return executePersistentCommand({
        db,
        ...commandContext,
        businessChange: standardBusinessChange({ domain: 'order', eventType: 'created' }),
        input: {
            payload: {
                customerId: draft.customerId,
                customerName: draft.customerName,
                contractNo: draft.contractNo,
                remark: draft.remark,
                status: '待确认',
                itemsJson: draft.itemsJson,
                purchaseListJson: draft.purchaseListJson,
                todosJson: draft.todosJson,
            },
            previewHash: expectedPreviewHash,
        },
        warnings: [...(commandContext.warnings || []), ...compatibilityWarnings],
        execute: ({ auditContext }) => {
            assertPreviewHash(
                expectedPreviewHash,
                draft.previewHash,
                '建单预览内容已经变化，请重新预览并确认'
            );
            const now = new Date().toISOString();
            const write = safeInsert('orders', {
                customer_id: draft.customerId,
                customer_name: draft.customerName,
                contract_no: draft.contractNo,
                remark: draft.remark,
                status: '待确认',
                items_json: draft.itemsJson,
                purchase_list_json: draft.purchaseListJson,
                todos_json: draft.todosJson,
                created_at: now,
                updated_at: now,
            }, auditContext);
            const orderId = Number(write.lastInsertRowid);
            return {
                data: {
                    order: orderRow(
                        db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
                    ),
                },
                resource: {
                    type: 'order',
                    ids: [orderId],
                },
                changes: [{
                    resourceType: 'order',
                    resourceId: orderId,
                    field: 'created',
                    from: null,
                    to: orderId,
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

function getOrderRecord(db, orderId) {
    const record = db.prepare(
        'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL'
    ).get(orderId);
    if (!record) throw orderCommandError('order_not_found', '订单不存在', 404);
    return hydrateCatalogRow(db, 'order', record);
}

function executeOrderUpdate(dependencies, orderIdValue, input = {}, commandContext = {}) {
    const {
        db,
        orderRow,
        safeInsert,
        safeUpdate,
    } = dependencies;
    const orderId = parsePositiveId(orderIdValue);
    if (!orderId) throw orderCommandError('order_id_invalid', '非法订单ID', 400);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const expectedPreviewHash = normalizePreviewHash(input.previewHash);
    const draft = buildOrderSavePayloadDraft(
        dependencies,
        { ...input, orderId }
    );
    const compatibilityWarnings = [];
    if (!expectedUpdatedAt) {
        compatibilityWarnings.push({
            code: 'expected_updated_at_missing_compatibility',
            message: `订单 #${orderId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
            resourceId: orderId,
        });
    }
    if (!expectedPreviewHash) {
        compatibilityWarnings.push({
            code: 'preview_hash_missing_compatibility',
            message: `订单 #${orderId} 未提供 previewHash，保存内容与确认预览未绑定`,
            resourceId: orderId,
        });
    }

    return executePersistentCommand({
        db,
        ...commandContext,
        businessChange: standardBusinessChange({
            domain: 'order',
            eventType: 'updated',
            reason: outcome => outcome.data?.revision?.reason || '',
            detailRef: outcome => outcome.data?.revision ? {
                type: 'order_revision',
                id: outcome.data.revision.id,
                orderId: outcome.data.order?.id,
                revisionNo: outcome.data.revision.revisionNo,
            } : {},
        }),
        input: {
            orderId,
            expectedUpdatedAt,
            previewHash: expectedPreviewHash,
            payload: {
                customerId: draft.customerId,
                customerName: draft.customerName,
                contractNo: draft.contractNo,
                remark: draft.remark,
                itemsJson: draft.itemsJson,
                purchaseListJson: draft.purchaseListJson,
                todosJson: draft.todosJson,
                editReason: draft.editReason,
            },
        },
        warnings: [...(commandContext.warnings || []), ...compatibilityWarnings],
        execute: ({ auditContext, operationId }) => {
            const record = getOrderRecord(db, orderId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `订单 #${orderId}`);
            const eligibility = orderCoreEditEligibility(
                record.status,
                parseJsonArray(record.purchase_list_json)
            );
            if (!eligibility.allowed) {
                throw orderCommandError(
                    'order_update_status_conflict',
                    `${eligibility.reason}，请使用后续订单变更单处理`,
                    409
                );
            }
            assertPreviewHash(
                expectedPreviewHash,
                draft.previewHash,
                '订单保存草稿已经变化，请重新预览并确认'
            );
            const write = safeUpdate('orders', orderId, {
                customer_id: draft.customerId,
                customer_name: draft.customerName,
                contract_no: draft.contractNo,
                remark: draft.remark,
                items_json: draft.itemsJson,
                purchase_list_json: draft.purchaseListJson,
                todos_json: draft.todosJson,
            }, auditContext);
            const updatedRecord = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
            const revisionNo = Number(db.prepare(`
                SELECT COALESCE(MAX(revision_no), 0) + 1 AS next_revision_no
                FROM order_revisions
                WHERE order_id = ?
            `).get(orderId).next_revision_no);
            const revisionWrite = safeInsert('order_revisions', {
                order_id: orderId,
                revision_no: revisionNo,
                reason: draft.editReason,
                before_snapshot_json: JSON.stringify(orderBusinessSnapshot(record)),
                after_snapshot_json: JSON.stringify(orderBusinessSnapshot(updatedRecord)),
                change_summary_json: JSON.stringify(draft.changes || []),
                operation_id: operationId,
                actor: commandContext.actorKey || 'system',
                created_at: new Date().toISOString(),
            }, auditContext);
            return {
                data: {
                    order: orderRow(updatedRecord),
                    revision: {
                        id: Number(revisionWrite.lastInsertRowid),
                        revisionNo,
                        reason: draft.editReason,
                    },
                },
                resource: {
                    type: 'order',
                    ids: [orderId],
                },
                changes: draft.changes || [],
                auditIds: [write.auditId, revisionWrite.auditId].filter(Boolean),
                requiredAuditCount: 2,
            };
        },
    });
}

function executeOrderDelete(dependencies, orderIdValue, input = {}, commandContext = {}) {
    const {
        db,
        safeUpdate,
    } = dependencies;
    const orderId = parsePositiveId(orderIdValue);
    if (!orderId) throw orderCommandError('order_id_invalid', '非法订单ID', 400);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const compatibilityWarnings = [];
    if (!expectedUpdatedAt) {
        compatibilityWarnings.push({
            code: 'expected_updated_at_missing_compatibility',
            message: `订单 #${orderId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
            resourceId: orderId,
        });
    }

    return executePersistentCommand({
        db,
        ...commandContext,
        businessChange: standardBusinessChange({ domain: 'order', eventType: 'deleted' }),
        input: { orderId, expectedUpdatedAt },
        warnings: [...(commandContext.warnings || []), ...compatibilityWarnings],
        execute: ({ auditContext }) => {
            const record = getOrderRecord(db, orderId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `订单 #${orderId}`);
            if (!['待确认', '已取消'].includes(record.status)) {
                throw orderCommandError(
                    'order_delete_status_conflict',
                    '只有待确认或已取消订单可以删除',
                    409
                );
            }
            const deletedAt = new Date().toISOString();
            const write = safeUpdate(
                'orders',
                orderId,
                { deleted_at: deletedAt },
                auditContext
            );
            return {
                data: {
                    deleted: 1,
                    orderId,
                    deletedAt,
                },
                resource: {
                    type: 'order',
                    ids: [orderId],
                },
                changes: [{
                    resourceType: 'order',
                    resourceId: orderId,
                    field: 'deletedAt',
                    from: null,
                    to: deletedAt,
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

function normalizeStatusInput(input = {}) {
    const status = String(input.status || '').trim();
    if (!ORDER_STATUSES.has(status)) {
        throw orderCommandError('order_status_invalid', '非法订单状态', 400);
    }
    const requestedInventoryDisposition = String(input.inventoryDisposition || '').trim();
    const inventoryDisposition = requestedInventoryDisposition === 'manual_outbound_confirmed'
        ? 'order_outbound_deducted'
        : requestedInventoryDisposition;
    const inventoryDispositionNote = String(input.inventoryDispositionNote || '').trim();
    if (status === '已关闭' && !CLOSE_INVENTORY_DISPOSITIONS.has(inventoryDisposition)) {
        throw orderCommandError(
            'order_close_inventory_disposition_required',
            '关闭订单前必须明确选择“按订单领用扣库”或“释放库存预留”',
            422
        );
    }
    if (status === '已关闭' && inventoryDisposition === 'reservation_released' && !inventoryDispositionNote) {
        throw orderCommandError(
            'order_close_release_note_required',
            '释放库存预留时必须填写原因',
            422
        );
    }
    return {
        status,
        reason: String(input.reason || '').trim(),
        inventoryDisposition,
        inventoryDispositionNote,
    };
}

function buildOrderCloseDeductions(dependencies, record, statusInput) {
    if (
        statusInput.status !== '已关闭'
        || statusInput.inventoryDisposition !== 'order_outbound_deducted'
    ) return [];

    const { db } = dependencies;
    const merged = new Map();
    for (const item of parseJsonArray(record.purchase_list_json).map(normalizePurchaseItem)) {
        const inventoryType = item.inventoryType === 'coil' || parsePositiveId(item.coilId)
            ? 'coil'
            : item.inventoryType === 'none' ? 'none' : 'part';
        if (inventoryType === 'none') continue;
        const resourceId = inventoryType === 'coil'
            ? parsePositiveId(item.coilId)
            : parsePositiveId(item.partId);
        if (!resourceId) {
            throw orderCommandError(
                'order_close_inventory_identity_missing',
                `订单物料“${item.model || item.name || '未命名物料'}”缺少正式库存身份，无法自动领用出库`,
                422
            );
        }
        const totalQty = Number(item.totalQty || 0);
        const stockQtyPerUnit = Math.max(1, Number(item.stockQtyPerUnit || 1));
        const deductQty = totalQty * stockQtyPerUnit;
        if (!Number.isFinite(deductQty) || deductQty <= 0) continue;
        const key = `${inventoryType}:${resourceId}`;
        const previous = merged.get(key);
        if (previous) {
            previous.deductQty += deductQty;
        } else {
            merged.set(key, {
                inventoryType,
                resourceId,
                partId: inventoryType === 'part' ? resourceId : null,
                coilId: inventoryType === 'coil' ? resourceId : null,
                model: String(item.model || item.name || ''),
                name: String(item.name || item.model || ''),
                deductQty,
            });
        }
    }

    return [...merged.values()].map(item => {
        const row = item.inventoryType === 'coil'
            ? db.prepare('SELECT id, stock FROM coils WHERE id = ?').get(item.resourceId)
            : db.prepare('SELECT id, model, stock FROM parts WHERE id = ? AND deleted_at IS NULL').get(item.resourceId);
        if (!row) {
            throw orderCommandError(
                'order_close_inventory_resource_changed',
                `订单物料“${item.model || item.name}”对应库存记录不存在或已停用`,
                409
            );
        }
        if (item.inventoryType === 'coil' && !Number.isInteger(item.deductQty)) {
            throw orderCommandError(
                'order_close_coil_quantity_invalid',
                `线圈“${item.model || item.name}”的领用数量必须是整数套`,
                422
            );
        }
        const currentStock = Number(row.stock || 0);
        if (currentStock < item.deductQty) {
            throw orderCommandError(
                'order_close_stock_insufficient',
                `物料“${item.model || item.name}”库存不足：需要领用 ${item.deductQty}，当前库存 ${currentStock}`,
                409
            );
        }
        return {
            ...item,
            currentStock,
            stockAfter: currentStock - item.deductQty,
        };
    });
}

function orderStatusPreviewHash(orderId, expectedUpdatedAt, statusInput, deductions) {
    return requestHash({
        capabilityId: STATUS_CAPABILITY_ID,
        orderId,
        expectedUpdatedAt,
        statusInput,
        deductions,
    });
}

function buildOrderStatusDraft(dependencies, orderIdValue, input = {}) {
    const orderId = parsePositiveId(orderIdValue);
    if (!orderId) throw orderCommandError('order_id_invalid', '非法订单ID', 400);
    const record = getOrderRecord(dependencies.db, orderId);
    const statusInput = normalizeStatusInput(input);
    try {
        assertOrderTransition(record.status, statusInput.status, { reason: statusInput.reason });
    } catch (error) {
        throw orderCommandError('order_status_transition_conflict', error.message, 409);
    }
    if (record.status === '已关闭') {
        throw orderCommandError('order_already_closed', '订单已经关闭，不能重复执行库存领用', 409);
    }
    const deductions = buildOrderCloseDeductions(dependencies, record, statusInput);
    const previewHash = orderStatusPreviewHash(
        orderId,
        record.updated_at,
        statusInput,
        deductions
    );
    return {
        preview: true,
        capabilityId: STATUS_CAPABILITY_ID,
        orderId,
        expectedUpdatedAt: record.updated_at,
        suggestedIdempotencyKey: `order-status:${orderId}:${crypto.randomUUID()}`,
        requiresConfirmation: true,
        previewHash,
        status: statusInput.status,
        inventoryDisposition: statusInput.inventoryDisposition || null,
        deductions,
        changes: [
            ...deductions.map(item => ({
                resourceType: item.inventoryType,
                resourceId: item.resourceId,
                field: 'stock',
                from: item.currentStock,
                to: item.stockAfter,
                delta: -item.deductQty,
            })),
            {
                resourceType: 'order',
                resourceId: orderId,
                field: 'status',
                from: record.status,
                to: statusInput.status,
            },
        ],
        warnings: [],
    };
}

function applyOrderStatusChange(dependencies, orderId, input = {}, options = {}) {
    const {
        db,
        orderRow,
        safeUpdate,
    } = dependencies;
    const record = options.record || getOrderRecord(db, orderId);
    const statusInput = normalizeStatusInput(input);
    try {
        assertOrderTransition(record.status, statusInput.status, {
            reason: statusInput.reason,
        });
    } catch (error) {
        throw orderCommandError(
            error.message === '非法订单状态'
                ? 'order_status_invalid'
                : 'order_status_transition_conflict',
            error.message,
            error.message === '非法订单状态' ? 400 : 409
        );
    }
    const now = new Date().toISOString();
    const purchaseList = (
        Array.isArray(options.purchaseList)
            ? options.purchaseList
            : parseJsonArray(record.purchase_list_json)
    ).map(normalizePurchaseItem);
    const nextStatus = statusInput.status === '待采购'
        ? deriveProcurementStatus('待采购', purchaseList)
        : statusInput.status;
    const write = safeUpdate('orders', orderId, {
        status: nextStatus,
        status_reason: statusInput.reason,
        status_changed_at: now,
        closed_at: nextStatus === '已关闭' ? now : record.closed_at,
        cancelled_at: nextStatus === '已取消' ? now : record.cancelled_at,
        inventory_disposition: nextStatus === '已关闭'
            ? statusInput.inventoryDisposition
            : record.inventory_disposition,
        inventory_disposition_at: nextStatus === '已关闭'
            ? now
            : record.inventory_disposition_at,
        inventory_disposition_note: nextStatus === '已关闭'
            ? statusInput.inventoryDispositionNote
            : record.inventory_disposition_note,
        purchase_list_json: JSON.stringify(purchaseList),
    }, options.auditContext);
    return {
        order: orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)),
        write,
        previousStatus: record.status,
        nextStatus,
        purchaseList,
    };
}

function executeOrderStatus(dependencies, orderIdValue, input = {}, commandContext = {}) {
    const {
        db,
        dbGetAllCoils,
        dbGetAllParts,
        invalidatePartsCache,
        orderRow,
        safeInsert,
        safeUpdate,
    } = dependencies;
    const orderId = parsePositiveId(orderIdValue);
    if (!orderId) throw orderCommandError('order_id_invalid', '非法订单ID', 400);
    const statusInput = normalizeStatusInput(input);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const expectedPreviewHash = normalizePreviewHash(input.previewHash);
    const compatibilityWarnings = [];
    if (!expectedUpdatedAt) {
        compatibilityWarnings.push({
            code: 'expected_updated_at_missing_compatibility',
            message: `订单 #${orderId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
            resourceId: orderId,
        });
    }
    if (!expectedPreviewHash) {
        compatibilityWarnings.push({
            code: 'preview_hash_missing_compatibility',
            message: `订单 #${orderId} 未提供 previewHash，状态动作与确认预览未绑定`,
            resourceId: orderId,
        });
    }

    const result = executePersistentCommand({
        db,
        ...commandContext,
        businessChange: standardBusinessChange({
            domain: 'order',
            eventType: 'status_changed',
            reason: outcome => outcome.data?.order?.statusReason || '',
        }),
        input: {
            orderId,
            ...statusInput,
            expectedUpdatedAt,
            previewHash: expectedPreviewHash,
        },
        warnings: [...(commandContext.warnings || []), ...compatibilityWarnings],
        execute: ({ auditContext }) => {
            const record = getOrderRecord(db, orderId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `订单 #${orderId}`);
            if (record.status === '已关闭') {
                throw orderCommandError('order_already_closed', '订单已经关闭，不能重复执行库存领用', 409);
            }
            const auditIds = [];
            const changes = [];
            let requiredAuditCount = 0;
            let targetPurchaseList;
            const deductions = buildOrderCloseDeductions(dependencies, record, statusInput);
            const currentPreviewHash = orderStatusPreviewHash(
                orderId,
                record.updated_at,
                statusInput,
                deductions
            );
            assertPreviewHash(
                expectedPreviewHash,
                currentPreviewHash,
                '订单状态或库存已经变化，请重新预览并确认'
            );

            if (statusInput.status === '待采购') {
                const { records, plans } = buildCurrentBalancedPurchasePlans({
                    db,
                    dbAccessors: { db, dbGetAllCoils, dbGetAllParts },
                    parts: dbGetAllParts(),
                    coils: dbGetAllCoils(),
                });
                targetPurchaseList = plans.get(orderId)?.purchaseList || [];
                for (const activeRecord of records) {
                    if (Number(activeRecord.id) === orderId) continue;
                    const plan = plans.get(Number(activeRecord.id));
                    if (!plan) continue;
                    const nextJson = JSON.stringify(plan.purchaseList || []);
                    if (nextJson === String(activeRecord.purchase_list_json || '[]')) continue;
                    const write = safeUpdate(
                        'orders',
                        Number(activeRecord.id),
                        { purchase_list_json: nextJson },
                        auditContext
                    );
                    requiredAuditCount += 1;
                    if (write.auditId) auditIds.push(write.auditId);
                    changes.push({
                        resourceType: 'order',
                        resourceId: Number(activeRecord.id),
                        field: 'purchaseList',
                        reason: 'inventory_balance_recalculated',
                    });
                }
            }

            for (const deduction of deductions) {
                if (deduction.inventoryType === 'coil') {
                    const adjustment = adjustCoilStock(
                        { db, safeInsert, safeUpdate },
                        {
                            coilId: deduction.coilId,
                            changeQty: -deduction.deductQty,
                            movementType: 'order_outbound',
                            referenceType: 'order',
                            referenceId: String(orderId),
                            note: `订单领用出库：${deduction.model || deduction.name}`,
                            auditContext,
                        }
                    );
                    requiredAuditCount += 2;
                    auditIds.push(...(adjustment.auditIds || []));
                } else {
                    const write = safeUpdate(
                        'parts',
                        deduction.partId,
                        { stock: deduction.stockAfter },
                        auditContext
                    );
                    requiredAuditCount += 1;
                    if (write?.auditId) auditIds.push(write.auditId);
                }
                changes.push({
                    resourceType: deduction.inventoryType,
                    resourceId: deduction.resourceId,
                    field: 'stock',
                    from: deduction.currentStock,
                    to: deduction.stockAfter,
                    delta: -deduction.deductQty,
                    reason: 'order_outbound',
                });
            }

            const statusResult = applyOrderStatusChange(
                { db, orderRow, safeUpdate },
                orderId,
                statusInput,
                {
                    record,
                    auditContext,
                    ...(targetPurchaseList ? { purchaseList: targetPurchaseList } : {}),
                }
            );
            requiredAuditCount += 1;
            if (statusResult.write.auditId) auditIds.push(statusResult.write.auditId);
            changes.push({
                resourceType: 'order',
                resourceId: orderId,
                field: 'status',
                from: statusResult.previousStatus,
                to: statusResult.nextStatus,
                reason: statusInput.reason || null,
                inventoryDisposition: statusInput.inventoryDisposition || null,
            });

            return {
                data: { order: statusResult.order, deductions },
                resource: {
                    type: 'order',
                    ids: [orderId],
                },
                changes,
                auditIds,
                requiredAuditCount,
            };
        },
    });
    if (result.deductions?.some(item => item.inventoryType === 'part')) {
        invalidatePartsCache?.();
    }
    return result;
}

module.exports = {
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    STATUS_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    applyOrderStatusChange,
    buildOrderStatusDraft,
    buildOrderSavePayloadDraft,
    executeOrderCreate,
    executeOrderDelete,
    executeOrderStatus,
    executeOrderUpdate,
    normalizeOrderItems,
    orderCreatePreviewHash,
    orderSavePreviewHash,
    resolveOrderCustomer,
};
