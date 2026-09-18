const express = require('express');
const {
    db,
    dbGetAllParts,
    dbGetAllQuotations,
    dbGetAllCustomers,
    dbGetAllCoils,
    loadPartsData,
    calculateRecipeCost,
    getSetting,
    quotationRow,
    orderRow,
    safeInsert,
    safeUpdate,
} = require('../db.cjs');
const { parsePositiveId } = require('../services/validation.cjs');
const {
    CAPABILITY_ID: QUOTATION_CONVERSION_CAPABILITY_ID,
    buildQuotationOrderDraft,
    executeQuotationConversion,
} = require('../services/quotationConversion.cjs');
const {
    CREATE_CAPABILITY_ID: QUOTATION_CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID: QUOTATION_DELETE_CAPABILITY_ID,
    STATUS_CAPABILITY_ID: QUOTATION_STATUS_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID: QUOTATION_UPDATE_CAPABILITY_ID,
    executeQuotationCreate,
    executeQuotationDelete,
    executeQuotationStatus,
    executeQuotationUpdate,
} = require('../services/quotationCommands.cjs');
const {
    buildQuotationSavePayloadDraft,
} = require('../services/quotationDraft.cjs');
const {
    getQuotationAttachmentSummary,
} = require('../services/quotationAttachmentSummaries.cjs');
const {
    generateQuotationInquirySummary,
} = require('../services/quotationInquiryAi.cjs');
const {
    createQuotationQueries,
} = require('../services/quotationQueries.cjs');
const {
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');
const router = express.Router();
const quotationQueries = createQuotationQueries({
    listQuotations: dbGetAllQuotations,
    listCustomers: dbGetAllCustomers,
});

function quotationDependencies() {
    return {
        calculateRecipeCost,
        db,
        dbGetAllCoils,
        getSetting,
        loadPartsData,
        quotationRow,
        safeInsert,
        safeUpdate,
    };
}

function legacyQuotationCommandResponse(result) {
    return {
        ...result,
        operationStatus: result.status,
        ...result.quotation,
    };
}

router.get('/', (req, res) => {
    try {
        res.json({
            success: true,
            data: quotationQueries.list({
                status: req.query.status,
                customerName: req.query.customerName,
                limit: req.query.limit,
            }),
        });
    }
    catch (err) {
        res.status(err.statusCode || 500).json({
            success: false,
            code: err.code || 'QUOTATION_QUERY_FAILED',
            error: err.message,
            requestId: req.requestId || null,
        });
    }
});

router.get('/:id', (req, res) => {
    try {
        res.json({
            success: true,
            data: quotationQueries.get(req.params.id),
        });
    } catch (err) {
        res.status(err.statusCode || 500).json({
            success: false,
            code: err.code || 'QUOTATION_DETAIL_QUERY_FAILED',
            error: err.message,
            requestId: req.requestId || null,
        });
    }
});

router.post('/', (req, res) => {
    try {
        const result = executeQuotationCreate(
            quotationDependencies(),
            req.body || {},
            commandContextFromRequest(req, QUOTATION_CREATE_CAPABILITY_ID)
        );
        res.json({ success: true, data: legacyQuotationCommandResponse(result) });
    } catch (err) { sendCommandError(res, err); }
});

router.post('/save-payload-draft', (req, res) => {
    try {
        res.json({
            success: true,
            data: buildQuotationSavePayloadDraft(
                quotationDependencies(),
                req.body || {}
            ),
        });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

router.post('/inquiry-summary-draft', async (req, res) => {
    try {
        res.json({
            success: true,
            data: await generateQuotationInquirySummary(req.body || {}, {
                dbAccessors: { db },
            }),
        });
    } catch (err) {
        res.status(err.statusCode || 502).json({
            success: false,
            code: err.code || 'KIMI_INQUIRY_SUMMARY_FAILED',
            error: err.message,
            requestId: req.requestId || null,
        });
    }
});

router.get('/:id/inquiry-summary', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价ID' });
        res.json({
            success: true,
            data: getQuotationAttachmentSummary(id, {
                dbAccessors: { db },
            }),
        });
    } catch (err) {
        res.status(err.statusCode || 500).json({
            success: false,
            code: err.code || 'QUOTATION_INQUIRY_SUMMARY_FAILED',
            error: err.message,
            requestId: req.requestId || null,
        });
    }
});

router.post('/:id/order-draft', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价ID' });
        res.json({
            success: true,
            data: buildQuotationOrderDraft(
                { db, dbGetAllParts, dbGetAllCoils },
                id,
                { itemQuantities: req.body?.itemQuantities }
            ),
        });
    } catch (err) {
        res.status(err.statusCode || 400).json({
            success: false,
            code: err.code || 'quotation_order_draft_failed',
            error: err.message,
            requestId: req.requestId || null,
        });
    }
});

router.post('/:id/convert', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价ID' });
        const result = executeQuotationConversion(
            {
                db,
                dbGetAllParts,
                dbGetAllCoils,
                orderRow,
                quotationRow,
                safeInsert,
                safeUpdate,
            },
            {
                quotationId: id,
                expectedUpdatedAt: req.body?.expectedUpdatedAt,
                previewHash: req.body?.previewHash,
            },
            commandContextFromRequest(req, QUOTATION_CONVERSION_CAPABILITY_ID)
        );
        res.status(201).json({ success: true, data: result });
    } catch (err) {
        sendCommandError(res, err);
    }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价ID' });
        const result = executeQuotationUpdate(
            quotationDependencies(),
            id,
            req.body || {},
            commandContextFromRequest(req, QUOTATION_UPDATE_CAPABILITY_ID)
        );
        res.json({ success: true, data: legacyQuotationCommandResponse(result) });
    } catch (err) { sendCommandError(res, err); }
});

router.post('/:id/status', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价ID' });
        const result = executeQuotationStatus(
            quotationDependencies(),
            id,
            req.body || {},
            commandContextFromRequest(req, QUOTATION_STATUS_CAPABILITY_ID)
        );
        res.json({ success: true, data: legacyQuotationCommandResponse(result) });
    } catch (err) {
        sendCommandError(res, err);
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价ID' });
        const result = executeQuotationDelete(
            quotationDependencies(),
            id,
            {
                expectedUpdatedAt: req.body?.expectedUpdatedAt
                    ?? req.query?.expectedUpdatedAt
                    ?? req.headers['if-unmodified-since'],
            },
            commandContextFromRequest(req, QUOTATION_DELETE_CAPABILITY_ID)
        );
        res.json({ success: true, data: result });
    } catch (err) { sendCommandError(res, err); }
});

module.exports = router;
