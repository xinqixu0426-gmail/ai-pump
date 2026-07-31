const { buildOrderReadinessContext } = require('./activeOrderReadiness.cjs');
const { getOrderExecutionRecords } = require('./orderExecutionRecords.cjs');
const { buildOrderReadinessPlan } = require('./orderReadinessPlan.cjs');
const { getOrderRequirementSummary } = require('./orderRequirements.cjs');
const { parseJsonArray } = require('./validation.cjs');

function loadDbAccessors() {
    return require('../db.cjs');
}

function positiveId(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        const error = new Error('订单ID无效');
        error.statusCode = 400;
        throw error;
    }
    return parsed;
}

function requireOrder(orderId, accessors) {
    const record = accessors.db.prepare(`
        SELECT *
        FROM orders
        WHERE id = ? AND deleted_at IS NULL
    `).get(orderId);
    if (!record) {
        const error = new Error('订单不存在');
        error.statusCode = 404;
        throw error;
    }
    return record;
}

function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function sourceFile(file, relationRole) {
    return {
        id: Number(file.id),
        originalName: file.originalName || '',
        detectedType: file.detectedType || '',
        mimeType: file.mimeType || '',
        fileSize: Number(file.fileSize || 0),
        parserStatus: file.parserStatus || '',
        relationRole,
        linkedAt: file.linkedAt || null,
        downloadPath: file.downloadPath || `/api/files/${Number(file.id)}/download`,
    };
}

function resolveSourceFiles(ids, availableFiles, relationRole) {
    const availableById = new Map((availableFiles || []).map(file => [Number(file.id), file]));
    return (ids || []).map(id => {
        const fileId = Number(id);
        const file = availableById.get(fileId);
        return file
            ? sourceFile(file, relationRole)
            : {
                id: fileId,
                originalName: '',
                detectedType: '',
                mimeType: '',
                fileSize: 0,
                parserStatus: 'missing',
                relationRole,
                linkedAt: null,
                downloadPath: '',
            };
    });
}

function buildLiveOrder(record, accessors) {
    const order = accessors.orderRow(record);
    const items = parseJsonArray(record.items_json);
    const purchaseList = parseJsonArray(record.purchase_list_json);
    const todos = parseJsonArray(record.todos_json);
    const totals = items.reduce((result, item) => {
        const qty = Number(item.qty || 0);
        result.totalUnits += qty;
        result.totalCost += Number(item.unitCost || 0) * qty;
        result.totalPrice += Number(item.unitPrice || 0) * qty;
        return result;
    }, { totalUnits: 0, totalCost: 0, totalPrice: 0 });

    return {
        id: Number(order.id),
        customerName: order.customerName || '',
        contractNo: order.contractNo || '',
        status: order.status || '',
        remark: order.remark || '',
        items,
        purchaseList,
        todos,
        totals: {
            totalUnits: totals.totalUnits,
            totalCost: roundMoney(totals.totalCost),
            totalPrice: roundMoney(totals.totalPrice),
            totalProfit: roundMoney(totals.totalPrice - totals.totalCost),
        },
        purchaseCompletedAt: order.purchaseCompletedAt || null,
        statusChangedAt: order.statusChangedAt || null,
        createdAt: order.createdAt || null,
        updatedAt: order.updatedAt || null,
    };
}

function buildConfirmedRequirement(requirement) {
    if (!requirement.confirmedText) return null;
    return {
        text: requirement.confirmedText,
        confirmedAt: requirement.confirmedAt,
        hasPendingDraft: requirement.hasPendingChanges === true,
        sourceFiles: resolveSourceFiles(
            requirement.confirmedSourceFileIds,
            requirement.availableFiles,
            'customer_requirement'
        ),
    };
}

function buildConfirmedExecutionRecords(archive) {
    return archive.records
        .filter(record => record.hasConfirmedVersion)
        .map(record => ({
            id: record.id,
            phase: record.confirmedPhase,
            phaseLabel: record.confirmedPhaseLabel,
            recordType: record.confirmedRecordType,
            recordTypeLabel: record.confirmedRecordTypeLabel,
            title: record.confirmedTitle,
            text: record.confirmedText,
            occurredAt: record.confirmedOccurredAt,
            confirmedAt: record.confirmedAt,
            hasPendingDraft: record.hasPendingChanges === true,
            sourceFiles: resolveSourceFiles(
                record.confirmedSourceFileIds,
                archive.availableFiles,
                'execution_evidence'
            ),
        }));
}

function buildOrderKnowledgePackage(orderIdValue, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const orderId = positiveId(orderIdValue);
    const record = requireOrder(orderId, accessors);
    const liveOrder = buildLiveOrder(record, accessors);
    const readinessContext = (options.buildReadinessContext || buildOrderReadinessContext)(
        record,
        { dbAccessors: accessors }
    );
    const requirement = (options.getRequirement || getOrderRequirementSummary)(
        orderId,
        { dbAccessors: accessors }
    );
    const executionArchive = (options.getExecutionRecords || getOrderExecutionRecords)(
        orderId,
        { dbAccessors: accessors }
    );
    const customerRequirement = buildConfirmedRequirement(requirement);
    const executionRecords = buildConfirmedExecutionRecords(executionArchive);
    const sourceFiles = [
        ...(customerRequirement?.sourceFiles || []),
        ...executionRecords.flatMap(item => item.sourceFiles),
    ].filter((file, index, files) => (
        files.findIndex(candidate => (
            candidate.id === file.id && candidate.relationRole === file.relationRole
        )) === index
    ));
    const fetchedAt = new Date().toISOString();

    return {
        order: liveOrder,
        readiness: readinessContext.readiness,
        actionPlan: buildOrderReadinessPlan(readinessContext.readiness),
        confirmedKnowledge: {
            customerRequirement,
            executionRecords,
        },
        sourceFiles,
        coverage: {
            hasConfirmedCustomerRequirement: Boolean(customerRequirement),
            confirmedExecutionRecordCount: executionRecords.length,
            sourceFileCount: sourceFiles.length,
            pendingDraftCount: Number(requirement.hasPendingChanges === true)
                + executionArchive.records.filter(item => item.hasPendingChanges).length,
        },
        provenance: {
            liveBusiness: {
                kind: 'live_business',
                label: '实时业务数据',
                fetchedAt,
                fields: ['order', 'readiness', 'actionPlan'],
            },
            confirmedKnowledge: {
                kind: 'human_confirmed',
                label: '人工确认事实',
                fetchedAt,
                fields: ['confirmedKnowledge', 'sourceFiles'],
                draftsExcluded: true,
            },
        },
    };
}

module.exports = {
    buildOrderKnowledgePackage,
};
