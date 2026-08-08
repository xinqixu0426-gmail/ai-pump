const express = require('express');
const {
    db,
    dbGetAllCustomers,
    dbGetAllOrders,
    dbGetAllQuotations,
    customerRow,
    safeInsert,
    safeUpdate,
} = require('../db.cjs');
const { parsePositiveId } = require('../services/validation.cjs');
const {
    CREATE_CAPABILITY_ID: CUSTOMER_CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID: CUSTOMER_DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID: CUSTOMER_UPDATE_CAPABILITY_ID,
    executeCustomerCreate,
    executeCustomerDelete,
    executeCustomerUpdate,
} = require('../services/customerCommands.cjs');
const {
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');
const {
    createCustomerQueries,
} = require('../services/customerQueries.cjs');
const router = express.Router();
const customerQueries = createCustomerQueries({
    listCustomers: dbGetAllCustomers,
    listOrders: dbGetAllOrders,
    listQuotations: dbGetAllQuotations,
});

function customerDependencies() {
    return {
        customerRow,
        db,
        safeInsert,
        safeUpdate,
    };
}

function legacyCustomerCommandResponse(result) {
    return {
        ...result,
        operationStatus: result.status,
        ...result.customer,
    };
}

router.get('/', (req, res) => {
    try {
        res.json({
            success: true,
            data: customerQueries.getAllCustomers({
                id: req.query.id,
                name: req.query.name,
                limit: req.query.limit,
            }),
        });
    } catch (err) {
        res.status(err.statusCode || 500).json({
            success: false,
            code: err.code || 'CUSTOMER_QUERY_FAILED',
            error: err.message,
            requestId: req.requestId || null,
        });
    }
});

router.get('/:id/context', (req, res) => {
    try {
        res.json({
            success: true,
            data: customerQueries.getCustomerContext(req.params.id, req.query),
        });
    } catch (err) {
        res.status(err.statusCode || 500).json({
            success: false,
            error: err.message,
        });
    }
});

router.post('/', (req, res) => {
    try {
        const result = executeCustomerCreate(
            customerDependencies(),
            req.body || {},
            commandContextFromRequest(req, CUSTOMER_CREATE_CAPABILITY_ID)
        );
        res.json({ success: true, data: legacyCustomerCommandResponse(result) });
    } catch (err) { sendCommandError(res, err); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法客户ID' });
        const result = executeCustomerUpdate(
            customerDependencies(),
            id,
            req.body || {},
            commandContextFromRequest(req, CUSTOMER_UPDATE_CAPABILITY_ID)
        );
        res.json({ success: true, data: legacyCustomerCommandResponse(result) });
    } catch (err) { sendCommandError(res, err); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法客户ID' });
        const result = executeCustomerDelete(
            customerDependencies(),
            id,
            {
                expectedUpdatedAt: req.body?.expectedUpdatedAt
                    ?? req.query?.expectedUpdatedAt
                    ?? req.headers['if-unmodified-since'],
            },
            commandContextFromRequest(req, CUSTOMER_DELETE_CAPABILITY_ID)
        );
        res.json({ success: true, data: result });
    } catch (err) { sendCommandError(res, err); }
});

module.exports = router;
