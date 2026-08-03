const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    executePersistentCommand,
    CommandExecutionError,
    requestHash,
} = require('./commandExecution.cjs');
const { adjustCoilStock, parseStockChange } = require('./coilInventory.cjs');
const {
    consumeBusinessConfirmation,
    issueBusinessConfirmation,
} = require('./businessConfirmation.cjs');
const { parsePositiveId, parseFiniteNumber } = require('./validation.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');

const PART_STOCK_CAPABILITY_ID = requireBusinessCapability(
    'inventory.parts.batch_adjust_stock'
).capabilityId;
const COIL_STOCK_CAPABILITY_ID = requireBusinessCapability(
    'inventory.coils.adjust_stock'
).capabilityId;

function parseCommandInput(parser, value, code, fallbackMessage) {
    try {
        return parser(value);
    } catch (error) {
        throw new CommandExecutionError(code, error?.message || fallbackMessage, 400);
    }
}

function normalizePartStockOperations(input = {}) {
    const operations = Array.isArray(input.operations) ? input.operations : [];
    if (operations.length === 0) {
        throw new CommandExecutionError('operations_required', 'operations 数组不能为空', 400);
    }
    if (operations.length > 100) {
        throw new CommandExecutionError('operations_limit_exceeded', '单次最多调整 100 个零件', 400);
    }
    const normalized = operations.map((item, index) => {
        const partId = parsePositiveId(item?.partId);
        if (!partId) throw new CommandExecutionError('part_id_invalid', `operations[${index}].partId 必须是正整数`, 400);
        const delta = parseCommandInput(
            value => parseFiniteNumber(value, `operations[${index}].delta`),
            item?.delta,
            'stock_delta_invalid',
            `operations[${index}].delta 必须是有效数字`
        );
        if (delta === 0) throw new CommandExecutionError('stock_delta_invalid', `operations[${index}].delta 不能为 0`, 400);
        return {
            partId,
            delta,
            expectedUpdatedAt: normalizeExpectedUpdatedAt(
                item?.expectedUpdatedAt,
                `operations[${index}].expectedUpdatedAt`
            ),
        };
    });
    if (new Set(normalized.map(item => item.partId)).size !== normalized.length) {
        throw new CommandExecutionError('duplicate_resource', '同一零件不能在一次操作中重复调整', 400);
    }
    return normalized;
}

function normalizeCoilStockAdjustments(input = {}) {
    const adjustments = Array.isArray(input.adjustments) ? input.adjustments : [];
    if (adjustments.length === 0) {
        throw new CommandExecutionError('adjustments_required', 'adjustments 必须是非空数组', 400);
    }
    if (adjustments.length > 50) {
        throw new CommandExecutionError('adjustments_limit_exceeded', '单次最多调整 50 个线圈方案', 400);
    }
    const normalized = adjustments.map((item, index) => {
        const coilId = parsePositiveId(item?.coilId);
        if (!coilId) throw new CommandExecutionError('coil_id_invalid', `第 ${index + 1} 项 coilId 非法`, 400);
        return {
            coilId,
            changeQty: parseCommandInput(
                parseStockChange,
                item?.changeQty,
                'stock_change_invalid',
                '线圈库存变动数量必须是非零整数'
            ),
            expectedUpdatedAt: normalizeExpectedUpdatedAt(
                item?.expectedUpdatedAt,
                `adjustments[${index}].expectedUpdatedAt`
            ),
        };
    });
    if (new Set(normalized.map(item => item.coilId)).size !== normalized.length) {
        throw new CommandExecutionError('duplicate_resource', '同一线圈方案不能在一次操作中重复调整', 400);
    }
    return normalized;
}

function requireExplicitIdempotency(commandContext, label) {
    if ((commandContext.warnings || []).some(
        warning => warning.code === 'idempotency_key_missing_compatibility'
    )) {
        throw new CommandExecutionError(
            'idempotency_key_required',
            `${label}确认后必须提供 Idempotency-Key 或 idempotencyKey`,
            400
        );
    }
}

function buildPartStockPreview(dependencies, input = {}, subject) {
    const requested = normalizePartStockOperations(input);
    const operations = requested.map(item => {
        const current = dependencies.db.prepare(`
            SELECT id, model, stock, updated_at
            FROM parts
            WHERE id = ? AND deleted_at IS NULL
        `).get(item.partId);
        if (!current) {
            throw new CommandExecutionError(
                'part_not_found',
                `零件 #${item.partId} 不存在`,
                404
            );
        }
        const currentStock = Number(current.stock || 0);
        const requestedStock = currentStock + item.delta;
        return {
            partId: item.partId,
            model: current.model || '',
            delta: item.delta,
            currentStock,
            nextStock: Math.max(0, requestedStock),
            expectedUpdatedAt: current.updated_at,
            clampedToZero: requestedStock < 0,
        };
    });
    const confirmedInput = {
        operations: operations.map(item => ({
            partId: item.partId,
            delta: item.delta,
            expectedUpdatedAt: item.expectedUpdatedAt,
        })),
    };
    const previewHash = requestHash({ operations });
    const confirmation = issueBusinessConfirmation({
        capabilityId: PART_STOCK_CAPABILITY_ID,
        input: { ...confirmedInput, previewHash },
        subject,
    });
    return {
        capabilityId: PART_STOCK_CAPABILITY_ID,
        ...confirmation,
        suggestedIdempotencyKey: `part-stock:${confirmation.operationId}`,
        previewHash,
        operations,
        warnings: operations.filter(item => item.clampedToZero).map(item => ({
            code: 'stock_clamped_to_zero',
            message: `零件 #${item.partId} 库存不足，执行后将按兼容规则调整为 0`,
            resourceId: item.partId,
        })),
    };
}

function buildCoilStockPreview(dependencies, input = {}, subject) {
    const requested = normalizeCoilStockAdjustments(input);
    const note = String(input.note || '').trim();
    const adjustments = requested.map(item => {
        const current = dependencies.db.prepare(`
            SELECT id, spec, material, slot_type, sheets,
                   stock, updated_at
            FROM coils
            WHERE id = ?
        `).get(item.coilId);
        if (!current) {
            throw new CommandExecutionError(
                'coil_not_found',
                `线圈 #${item.coilId} 不存在`,
                404
            );
        }
        const currentStock = Number(current.stock || 0);
        const nextStock = currentStock + item.changeQty;
        if (nextStock < 0) {
            throw new CommandExecutionError(
                'stock_insufficient',
                `线圈 #${item.coilId} 库存不足，当前库存 ${currentStock} 套`,
                409
            );
        }
        return {
            coilId: item.coilId,
            model: `${current.spec || ''}-${current.sheets || ''}`,
            material: current.material || '',
            slotType: current.slot_type || '',
            changeQty: item.changeQty,
            currentStock,
            nextStock,
            expectedUpdatedAt: current.updated_at,
        };
    });
    const confirmedInput = {
        adjustments: adjustments.map(item => ({
            coilId: item.coilId,
            changeQty: item.changeQty,
            expectedUpdatedAt: item.expectedUpdatedAt,
        })),
        note,
    };
    const previewHash = requestHash({ adjustments, note });
    const confirmation = issueBusinessConfirmation({
        capabilityId: COIL_STOCK_CAPABILITY_ID,
        input: { ...confirmedInput, previewHash },
        subject,
    });
    return {
        capabilityId: COIL_STOCK_CAPABILITY_ID,
        ...confirmation,
        suggestedIdempotencyKey: `coil-stock:${confirmation.operationId}`,
        previewHash,
        adjustments,
        note,
        warnings: [],
    };
}

function executePartStockBatch(dependencies, input = {}, commandContext = {}) {
    const { db, safeUpdate, partRow } = dependencies;
    const normalized = normalizePartStockOperations(input);

    const compatibilityWarnings = normalized
        .filter(item => !item.expectedUpdatedAt)
        .map(item => ({
            code: 'expected_updated_at_missing_compatibility',
            message: `零件 #${item.partId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
            resourceId: item.partId,
        }));
    return executePersistentCommand({
        db,
        ...commandContext,
        input: { operations: normalized },
        warnings: [...(commandContext.warnings || []), ...compatibilityWarnings],
        execute: ({ auditContext }) => {
            const currentRows = normalized.map(item => {
                const current = db.prepare(
                    'SELECT id, stock, updated_at FROM parts WHERE id = ? AND deleted_at IS NULL'
                ).get(item.partId);
                if (!current) {
                    throw new CommandExecutionError('part_not_found', `零件 #${item.partId} 不存在`, 404);
                }
                assertExpectedUpdatedAt(current, item.expectedUpdatedAt, `零件 #${item.partId}`);
                return { item, current };
            });
            const auditIds = [];
            const changes = [];
            const warnings = [];
            const parts = [];
            for (const { item, current } of currentRows) {
                const requestedStock = Number(current.stock || 0) + item.delta;
                const nextStock = Math.max(0, requestedStock);
                if (requestedStock < 0) {
                    warnings.push({
                        code: 'stock_clamped_to_zero',
                        message: `零件 #${item.partId} 库存不足，按兼容规则调整为 0`,
                        resourceId: item.partId,
                    });
                }
                const write = safeUpdate('parts', item.partId, { stock: nextStock }, auditContext);
                auditIds.push(write.auditId);
                changes.push({
                    resourceType: 'part',
                    resourceId: item.partId,
                    field: 'stock',
                    from: Number(current.stock || 0),
                    to: nextStock,
                    delta: nextStock - Number(current.stock || 0),
                });
                parts.push(partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(item.partId)));
            }
            return {
                data: { updatedCount: parts.length, parts },
                resource: { type: 'part_inventory', ids: normalized.map(item => item.partId) },
                changes,
                warnings,
                auditIds,
                requiredAuditCount: normalized.length,
            };
        },
    });
}

function executeCoilStockBatch(dependencies, input = {}, commandContext = {}) {
    const { db, safeUpdate, safeInsert, coilRow } = dependencies;
    const normalized = normalizeCoilStockAdjustments(input);

    const compatibilityWarnings = normalized
        .filter(item => !item.expectedUpdatedAt)
        .map(item => ({
            code: 'expected_updated_at_missing_compatibility',
            message: `线圈 #${item.coilId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
            resourceId: item.coilId,
        }));
    const note = String(input.note || '').trim();
    return executePersistentCommand({
        db,
        ...commandContext,
        input: { adjustments: normalized, note },
        warnings: [...(commandContext.warnings || []), ...compatibilityWarnings],
        execute: ({ auditContext, operationId }) => {
            const currentRows = normalized.map(item => {
                const current = db.prepare(
                    'SELECT id, stock, updated_at FROM coils WHERE id = ?'
                ).get(item.coilId);
                if (!current) {
                    throw new CommandExecutionError('coil_not_found', `线圈 #${item.coilId} 不存在`, 404);
                }
                assertExpectedUpdatedAt(current, item.expectedUpdatedAt, `线圈 #${item.coilId}`);
                if (Number(current.stock || 0) + item.changeQty < 0) {
                    throw new CommandExecutionError(
                        'stock_insufficient',
                        `线圈 #${item.coilId} 库存不足，当前库存 ${Number(current.stock || 0)} 套`,
                        409
                    );
                }
                return { item, current };
            });
            const results = currentRows.map(({ item }) => {
                const adjustment = adjustCoilStock(
                    { db, safeUpdate, safeInsert },
                    {
                        ...item,
                        movementType: item.changeQty > 0 ? 'manual_in' : 'manual_out',
                        referenceType: 'api_operation',
                        referenceId: operationId,
                        note,
                        auditContext,
                    }
                );
                return {
                    coil: coilRow(db.prepare('SELECT * FROM coils WHERE id = ?').get(item.coilId)),
                    adjustment,
                };
            });
            return {
                data: {
                    updatedCount: results.length,
                    adjustments: results,
                },
                resource: { type: 'coil_inventory', ids: normalized.map(item => item.coilId) },
                changes: results.map(result => ({
                    resourceType: 'coil',
                    resourceId: result.adjustment.coilId,
                    field: 'stock',
                    from: result.adjustment.balanceAfter - result.adjustment.changeQty,
                    to: result.adjustment.balanceAfter,
                    delta: result.adjustment.changeQty,
                    movementId: result.adjustment.movementId,
                })),
                auditIds: results.flatMap(result => result.adjustment.auditIds || []),
                requiredAuditCount: results.length * 2,
            };
        },
    });
}

function executeConfirmedPartStockBatch(
    dependencies,
    input,
    commandContext,
    subject
) {
    requireExplicitIdempotency(commandContext, '零件库存调整');
    const confirmation = consumeBusinessConfirmation({
        confirmationToken: input?.confirmationToken,
        capabilityId: PART_STOCK_CAPABILITY_ID,
        subject,
        idempotencyKey: commandContext.idempotencyKey,
    });
    return executePartStockBatch(
        dependencies,
        { operations: confirmation.input.operations },
        {
            ...commandContext,
            capabilityId: PART_STOCK_CAPABILITY_ID,
            operationId: confirmation.operationId,
        }
    );
}

function executeConfirmedCoilStockBatch(
    dependencies,
    input,
    commandContext,
    subject
) {
    requireExplicitIdempotency(commandContext, '线圈库存调整');
    const confirmation = consumeBusinessConfirmation({
        confirmationToken: input?.confirmationToken,
        capabilityId: COIL_STOCK_CAPABILITY_ID,
        subject,
        idempotencyKey: commandContext.idempotencyKey,
    });
    return executeCoilStockBatch(
        dependencies,
        {
            adjustments: confirmation.input.adjustments,
            note: confirmation.input.note,
        },
        {
            ...commandContext,
            capabilityId: COIL_STOCK_CAPABILITY_ID,
            operationId: confirmation.operationId,
        }
    );
}

module.exports = {
    COIL_STOCK_CAPABILITY_ID,
    PART_STOCK_CAPABILITY_ID,
    assertExpectedUpdatedAt,
    buildCoilStockPreview,
    buildPartStockPreview,
    executeConfirmedCoilStockBatch,
    executeConfirmedPartStockBatch,
    executeCoilStockBatch,
    executePartStockBatch,
    normalizeCoilStockAdjustments,
    normalizeExpectedUpdatedAt,
    normalizePartStockOperations,
    parseCommandInput,
};
