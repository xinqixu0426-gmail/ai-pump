const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const {
    parseNonNegativeNumber,
    parsePositiveId,
} = require('./validation.cjs');

const CREATE_CAPABILITY_ID = requireBusinessCapability('customers.create').capabilityId;
const UPDATE_CAPABILITY_ID = requireBusinessCapability('customers.update').capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability('customers.delete').capabilityId;

function customerCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function normalizeCustomerName(value) {
    const name = String(value || '').trim();
    if (!name) {
        throw customerCommandError(
            'customer_name_required',
            '客户名称不能为空',
            400
        );
    }
    return name;
}

function getCustomerRecord(db, customerId) {
    const record = db.prepare(
        'SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL'
    ).get(customerId);
    if (!record) {
        throw customerCommandError('customer_not_found', '客户不存在', 404);
    }
    return record;
}

function assertCustomerNameAvailable(db, name, customerId = null) {
    const existing = customerId
        ? db.prepare(
            'SELECT id FROM customers WHERE name = ? AND id <> ?'
        ).get(name, customerId)
        : db.prepare('SELECT id FROM customers WHERE name = ?').get(name);
    if (existing) {
        throw customerCommandError(
            'customer_name_conflict',
            `客户名称“${name}”已存在`,
            409
        );
    }
}

function compatibilityWarnings(customerId, expectedUpdatedAt) {
    return customerId && !expectedUpdatedAt ? [{
        code: 'expected_updated_at_missing_compatibility',
        message: `客户 #${customerId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
    }] : [];
}

function executeCustomerCreate(dependencies, input = {}, commandContext = {}) {
    const normalized = {
        name: normalizeCustomerName(input.name),
        contactInfo: String(input.contactInfo || '').trim(),
        defaultMargin: parseNonNegativeNumber(
            input.defaultMargin,
            'defaultMargin',
            { defaultValue: 0 }
        ),
        remark: String(input.remark || '').trim(),
    };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: CREATE_CAPABILITY_ID,
        input: normalized,
        execute: ({ auditContext }) => {
            assertCustomerNameAvailable(dependencies.db, normalized.name);
            const now = new Date().toISOString();
            const write = dependencies.safeInsert('customers', {
                name: normalized.name,
                contact_info: normalized.contactInfo,
                default_margin: normalized.defaultMargin,
                remark: normalized.remark,
                created_at: now,
                updated_at: now,
            }, auditContext);
            const customerId = Number(write.lastInsertRowid);
            const customer = dependencies.customerRow(
                dependencies.db.prepare(
                    'SELECT * FROM customers WHERE id = ?'
                ).get(customerId)
            );
            return {
                data: { customer },
                resource: { type: 'customer', ids: [customerId] },
                changes: [{
                    resourceType: 'customer',
                    resourceId: customerId,
                    field: 'created',
                    from: null,
                    to: {
                        name: customer.name,
                        defaultMargin: customer.defaultMargin,
                    },
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

function executeCustomerUpdate(
    dependencies,
    customerIdValue,
    input = {},
    commandContext = {}
) {
    const customerId = parsePositiveId(customerIdValue);
    if (!customerId) {
        throw customerCommandError('customer_id_invalid', '非法客户ID', 400);
    }
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const normalized = {
        ...(input.name === undefined
            ? {}
            : { name: normalizeCustomerName(input.name) }),
        ...(input.contactInfo === undefined
            ? {}
            : { contactInfo: String(input.contactInfo || '').trim() }),
        ...(input.defaultMargin === undefined
            ? {}
            : {
                defaultMargin: parseNonNegativeNumber(
                    input.defaultMargin,
                    'defaultMargin'
                ),
            }),
        ...(input.remark === undefined
            ? {}
            : { remark: String(input.remark || '').trim() }),
    };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: UPDATE_CAPABILITY_ID,
        input: { customerId, expectedUpdatedAt, changes: normalized },
        warnings: [
            ...(commandContext.warnings || []),
            ...compatibilityWarnings(customerId, expectedUpdatedAt),
        ],
        execute: ({ auditContext }) => {
            const record = getCustomerRecord(dependencies.db, customerId);
            assertExpectedUpdatedAt(
                record,
                expectedUpdatedAt,
                `客户 #${customerId}`
            );
            if (normalized.name !== undefined) {
                assertCustomerNameAvailable(
                    dependencies.db,
                    normalized.name,
                    customerId
                );
            }
            const updates = {
                ...(normalized.name === undefined
                    ? {}
                    : { name: normalized.name }),
                ...(normalized.contactInfo === undefined
                    ? {}
                    : { contact_info: normalized.contactInfo }),
                ...(normalized.defaultMargin === undefined
                    ? {}
                    : { default_margin: normalized.defaultMargin }),
                ...(normalized.remark === undefined
                    ? {}
                    : { remark: normalized.remark }),
            };
            if (Object.keys(updates).length === 0) {
                return {
                    data: { customer: dependencies.customerRow(record) },
                    resource: { type: 'customer', ids: [customerId] },
                    changes: [],
                    auditIds: [],
                    requiredAuditCount: 0,
                    warnings: [{
                        code: 'customer_update_noop',
                        message: '没有可保存的客户字段，未执行写入',
                    }],
                };
            }
            const write = dependencies.safeUpdate(
                'customers',
                customerId,
                updates,
                auditContext
            );
            const customer = dependencies.customerRow(
                dependencies.db.prepare(
                    'SELECT * FROM customers WHERE id = ?'
                ).get(customerId)
            );
            return {
                data: { customer },
                resource: { type: 'customer', ids: [customerId] },
                changes: [{
                    resourceType: 'customer',
                    resourceId: customerId,
                    field: 'fields',
                    from: null,
                    to: Object.keys(updates),
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

function executeCustomerDelete(
    dependencies,
    customerIdValue,
    input = {},
    commandContext = {}
) {
    const customerId = parsePositiveId(customerIdValue);
    if (!customerId) {
        throw customerCommandError('customer_id_invalid', '非法客户ID', 400);
    }
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: DELETE_CAPABILITY_ID,
        input: { customerId, expectedUpdatedAt },
        warnings: [
            ...(commandContext.warnings || []),
            ...compatibilityWarnings(customerId, expectedUpdatedAt),
        ],
        execute: ({ auditContext }) => {
            const record = getCustomerRecord(dependencies.db, customerId);
            assertExpectedUpdatedAt(
                record,
                expectedUpdatedAt,
                `客户 #${customerId}`
            );
            const quotationCount = Number(dependencies.db.prepare(
                `SELECT COUNT(*) AS count
                 FROM quotations
                 WHERE customer_id = ? AND deleted_at IS NULL`
            ).get(customerId)?.count || 0);
            const activeOrderCount = Number(dependencies.db.prepare(`
                SELECT COUNT(*) AS count
                FROM orders
                WHERE deleted_at IS NULL
                  AND status NOT IN ('已关闭', '已取消')
                  AND (customer_id = ? OR (customer_id IS NULL AND customer_name = ?))
            `).get(customerId, record.name)?.count || 0);
            if (activeOrderCount > 0) {
                throw customerCommandError(
                    'customer_active_orders_conflict',
                    `该客户仍有 ${activeOrderCount} 张活动订单，不能删除`,
                    409
                );
            }
            const orderCount = Number(dependencies.db.prepare(`
                SELECT COUNT(*) AS count
                FROM orders
                WHERE deleted_at IS NULL
                  AND (customer_id = ? OR (customer_id IS NULL AND customer_name = ?))
            `).get(customerId, record.name)?.count || 0);
            const deletedAt = new Date().toISOString();
            const write = dependencies.safeUpdate(
                'customers',
                customerId,
                { deleted_at: deletedAt },
                auditContext
            );
            return {
                data: { deleted: 1, customerId, deletedAt },
                resource: { type: 'customer', ids: [customerId] },
                changes: [{
                    resourceType: 'customer',
                    resourceId: customerId,
                    field: 'deletedAt',
                    from: null,
                    to: deletedAt,
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
                warnings: [
                    ...(quotationCount > 0 ? [{
                        code: 'customer_quotation_history_retained',
                        message: `该客户仍有 ${quotationCount} 张有效报价，历史报价继续保留客户 ID`,
                    }] : []),
                    ...(orderCount > 0 ? [{
                        code: 'customer_order_history_retained',
                        message: `该客户仍有 ${orderCount} 张历史订单，订单继续保留客户 ID 和建单时名称快照`,
                    }] : []),
                ],
            };
        },
    });
}

module.exports = {
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    executeCustomerCreate,
    executeCustomerDelete,
    executeCustomerUpdate,
};
