const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { ACTIVE_ORDERS_SQL } = require('./activeOrderReadiness.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
    requestHash,
} = require('./commandExecution.cjs');
const {
    buildCurrentBalancedPurchasePlans,
} = require('./orderPurchasePlanning.cjs');
const { buildBalancedOrderPlans } = require('./orderPlanning.cjs');
const {
    ORDER_STATUSES,
    assertOrderTransition,
    deriveProcurementStatus,
    normalizePurchaseItem,
} = require('./orderWorkflow.cjs');
const {
    assertPreviewHash,
    normalizePreviewHash,
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

const CREATE_CAPABILITY_ID = requireBusinessCapability('orders.create').capabilityId;
const STATUS_CAPABILITY_ID = requireBusinessCapability('orders.change_status').capabilityId;
const UPDATE_CAPABILITY_ID = requireBusinessCapability('orders.update_draft').capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability('orders.delete').capabilityId;
const CLOSE_INVENTORY_DISPOSITIONS = new Set(['manual_outbound_confirmed', 'reservation_released']);

function orderCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function roundMoney(value) {
    return Math.round(value * 100) / 100;
}

function normalizeOrderItems(db, items) {
    if (!Array.isArray(items)) return [];
    return items
        .filter(Boolean)
        .map((item, index) => {
            const recipeId = parsePositiveId(item.recipeId);
            if (!recipeId) throw orderCommandError(
                'order_recipe_required',
                `items[${index}].recipeId 必须引用有效配方`,
                422
            );
            const recipe = db.prepare(`
                SELECT id, name, spec, parts_json, saved_total_cost
                FROM recipes
                WHERE id = ? AND deleted_at IS NULL
            `).get(recipeId);
            if (!recipe) throw orderCommandError(
                'order_recipe_not_found',
                `配方 #${recipeId} 不存在或已停用`,
                422
            );
            const parts = parseJsonArray(recipe.parts_json);
            const unitCost = Number(recipe.saved_total_cost);
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
            return {
                id: String(item.id || `order-item-${recipeId}-${index}`),
                recipeId,
                recipeName: String(recipe.name || '未命名产品'),
                spec: String(recipe.spec || ''),
                qty: parsePositiveNumber(
                    item.qty,
                    `items[${index}].qty`,
                    { defaultValue: 1 }
                ),
                unitCost: roundMoney(unitCost),
                unitPrice: roundMoney(unitPrice),
                profitMargin: roundMoney(unitPrice / unitCost),
                partsJson: JSON.stringify(parts),
            };
        });
}

function normalizeOrderDraftInput(body = {}) {
    return {
        customerId: body.customerId ?? body.customer_id,
        customerName: body.customerName ?? body.customer_name,
        contractNo: body.contractNo ?? body.contract_no,
        remark: body.remark,
        status: body.status,
        items: body.items ?? parseJsonArray(body.itemsJson ?? body.items_json),
        purchaseList: body.purchaseList
            ?? parseJsonArray(body.purchaseListJson ?? body.purchase_list_json),
        todos: body.todos ?? parseJsonArray(body.todosJson ?? body.todos_json),
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

function orderCreatePreviewHash(payload) {
    return requestHash({
        capabilityId: CREATE_CAPABILITY_ID,
        payload: {
            ...payload,
            // 兼容草稿也用于编辑：直接建单始终从“待确认”开始。
            status: '待确认',
        },
    });
}

function buildOrderSavePayloadDraft(dependencies, body = {}) {
    const {
        db,
        dbGetAllCoils,
        dbGetAllParts,
    } = dependencies;
    const input = normalizeOrderDraftInput(body);
    const customer = resolveOrderCustomer(db, input);
    let items;
    try {
        items = normalizeOrderItems(db, input.items);
    } catch (error) {
        if (error instanceof CommandExecutionError) throw error;
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
    const activeOrders = db.prepare(ACTIVE_ORDERS_SQL).all();
    const draftOrder = {
        id: -1,
        created_at: new Date().toISOString(),
        items,
        purchase_list_json: '[]',
    };
    const plan = buildBalancedOrderPlans(
        [...activeOrders, draftOrder],
        dbGetAllParts(),
        { coilsCatalog: dbGetAllCoils() }
    ).get(-1);
    const status = input.status || '待确认';
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
    };
    return {
        ...payload,
        capabilityId: CREATE_CAPABILITY_ID,
        preview: true,
        requiresConfirmation: true,
        suggestedIdempotencyKey: `order-create:${crypto.randomUUID()}`,
        previewHash: orderCreatePreviewHash(payload),
        changes: [{
            resourceType: 'order',
            field: 'created',
            from: null,
            to: {
                customerId: customer.customerId,
                customerName: customer.customerName,
                status: '待确认',
                itemCount: items.length,
            },
        }],
        warnings: [
            ...(customer.resolvedByLegacyName ? [{
                code: 'customer_name_compatibility_resolved',
                message: '兼容请求已按客户名称解析为稳定 customerId；新增调用请直接提交 customerId',
            }] : []),
            ...((providedPurchaseList.length > 0 || providedTodos.length > 0) ? [{
                code: 'client_plan_ignored',
                message: '客户端采购清单和待办已忽略，正式结果由服务端按订单 BOM 和实时库存重新生成',
            }] : []),
        ],
    };
}

function executeOrderCreate(dependencies, input = {}, commandContext = {}) {
    const {
        db,
        dbGetAllCoils,
        dbGetAllParts,
        orderRow,
        safeInsert,
    } = dependencies;
    const draft = buildOrderSavePayloadDraft(
        { db, dbGetAllCoils, dbGetAllParts },
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
    return record;
}

function executeOrderUpdate(dependencies, orderIdValue, input = {}, commandContext = {}) {
    const {
        db,
        dbGetAllCoils,
        dbGetAllParts,
        orderRow,
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
        { db, dbGetAllCoils, dbGetAllParts },
        input
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
            },
        },
        warnings: [...(commandContext.warnings || []), ...compatibilityWarnings],
        execute: ({ auditContext }) => {
            const record = getOrderRecord(db, orderId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `订单 #${orderId}`);
            if (record.status !== '待确认') {
                throw orderCommandError(
                    'order_update_status_conflict',
                    '订单确认后不能修改核心明细，只能通过采购和状态动作继续处理',
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
                    field: 'draft',
                    fromUpdatedAt: record.updated_at,
                    toUpdatedAt: db.prepare(
                        'SELECT updated_at FROM orders WHERE id = ?'
                    ).get(orderId)?.updated_at,
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
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
    const inventoryDisposition = String(input.inventoryDisposition || '').trim();
    const inventoryDispositionNote = String(input.inventoryDispositionNote || '').trim();
    if (status === '已关闭' && !CLOSE_INVENTORY_DISPOSITIONS.has(inventoryDisposition)) {
        throw orderCommandError(
            'order_close_inventory_disposition_required',
            '关闭订单前必须明确选择“已人工领用出库”或“释放库存预留”',
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
        orderRow,
        safeUpdate,
    } = dependencies;
    const orderId = parsePositiveId(orderIdValue);
    if (!orderId) throw orderCommandError('order_id_invalid', '非法订单ID', 400);
    const statusInput = normalizeStatusInput(input);
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
        input: {
            orderId,
            ...statusInput,
            expectedUpdatedAt,
        },
        warnings: [...(commandContext.warnings || []), ...compatibilityWarnings],
        execute: ({ auditContext }) => {
            const record = getOrderRecord(db, orderId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `订单 #${orderId}`);
            const auditIds = [];
            const changes = [];
            let requiredAuditCount = 0;
            let targetPurchaseList;

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
                data: { order: statusResult.order },
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
}

module.exports = {
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    STATUS_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    applyOrderStatusChange,
    buildOrderSavePayloadDraft,
    executeOrderCreate,
    executeOrderDelete,
    executeOrderStatus,
    executeOrderUpdate,
    normalizeOrderItems,
    orderCreatePreviewHash,
    resolveOrderCustomer,
};
