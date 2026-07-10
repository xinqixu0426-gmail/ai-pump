const express = require('express');
const { db, dbGetAllParts, dbGetAllQuotations, quotationRow, safeInsert, safeUpdate, softDelete } = require('../db.cjs');
const { buildOrderPlan } = require('../services/orderPlanning.cjs');
const { parsePositiveId, parseJsonArray, parseNonNegativeNumber, parsePositiveNumber } = require('../services/validation.cjs');
const router = express.Router();

function expireOverdueQuotations() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 1);
    const rows = db.prepare('SELECT id FROM quotations WHERE deleted_at IS NULL AND status = ? AND created_at <= ?').all('报价中', cutoff.toISOString());
    rows.forEach((row) => {
        safeUpdate('quotations', row.id, { status: '已过时' });
    });
}

function roundMoney(value) {
    return Math.round(value * 100) / 100;
}

function normalizeQuotationItems(items) {
    if (!Array.isArray(items)) return [];
    return items
        .filter(item => item && (item.baseRecipeId || item.baseRecipeName))
        .map((item, index) => {
            const qty = parsePositiveNumber(item.qty, `items[${index}].qty`, { defaultValue: 1 });
            const unitCost = parseNonNegativeNumber(item.unitCost, `items[${index}].unitCost`);
            const margin = parsePositiveNumber(item.margin, `items[${index}].margin`, { defaultValue: 1.1 });
            const unitPrice = item.unitPrice == null
                ? roundMoney(unitCost * margin)
                : roundMoney(parseNonNegativeNumber(item.unitPrice, `items[${index}].unitPrice`));
            return {
                id: String(item.id || `quotation-item-${Date.now()}-${index}`),
                baseRecipeId: parsePositiveId(item.baseRecipeId) || '',
                baseRecipeName: String(item.baseRecipeName || '未命名产品'),
                spec: String(item.spec || ''),
                qty,
                unitCost: roundMoney(unitCost),
                margin: unitCost > 0 ? roundMoney(unitPrice / unitCost) : margin,
                unitPrice,
                totalPrice: roundMoney(unitPrice * qty),
            };
        });
}

function buildQuotationSavePayloadDraft(body) {
    const customerId = parsePositiveId(body?.customerId);
    if (!customerId) throw new Error('请选择客户');
    const items = normalizeQuotationItems(body?.items);
    if (items.length === 0) throw new Error('至少添加一个报价明细');
    const totalCost = roundMoney(items.reduce((sum, item) => sum + item.unitCost * item.qty, 0));
    const totalPrice = roundMoney(items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0));
    return {
        customerId,
        status: body?.status || '报价中',
        itemsJson: JSON.stringify(items),
        totalCost,
        totalPrice,
        remark: String(body?.remark || ''),
    };
}

function buildOrderDraftFromQuotation(quotationId) {
    const quotation = db.prepare('SELECT * FROM quotations WHERE id = ? AND deleted_at IS NULL').get(quotationId);
    if (!quotation) throw new Error('报价单不存在');
    const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL').get(quotation.customer_id);
    if (!customer) throw new Error('报价客户不存在');

    const quotationItems = parseJsonArray(quotation.items_json);
    const orderItems = quotationItems.map((item, index) => {
        const recipeId = parsePositiveId(item.baseRecipeId);
        const recipe = recipeId
            ? db.prepare('SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL').get(recipeId)
            : null;
        const unitCost = item.unitCost == null
            ? parseNonNegativeNumber(recipe?.saved_total_cost, `quotationItems[${index}].unitCost`)
            : parseNonNegativeNumber(item.unitCost, `quotationItems[${index}].unitCost`);
        const margin = parsePositiveNumber(item.margin, `quotationItems[${index}].margin`, { defaultValue: 1.1 });
        const unitPrice = item.unitPrice == null
            ? roundMoney(unitCost * margin)
            : parseNonNegativeNumber(item.unitPrice, `quotationItems[${index}].unitPrice`);
        const qty = parsePositiveNumber(item.qty, `quotationItems[${index}].qty`, { defaultValue: 1 });
        return {
            id: String(item.id || `quotation-${quotationId}-${index}`),
            recipeId: recipe?.id || recipeId || undefined,
            recipeName: item.baseRecipeName || recipe?.name || '未命名产品',
            spec: item.spec || recipe?.spec || '',
            qty,
            unitCost: roundMoney(unitCost),
            unitPrice: roundMoney(unitPrice),
            profitMargin: unitCost > 0 ? roundMoney(unitPrice / unitCost) : margin,
            partsJson: recipe?.parts_json || '[]',
        };
    });

    if (orderItems.length === 0) throw new Error('报价没有可转订单的明细');
    const plan = buildOrderPlan(orderItems, dbGetAllParts());
    return {
        customerName: customer.name || 'Unknown',
        contractNo: '',
        remark: `由报价 #${quotation.id} 转订单${quotation.remark ? `：${quotation.remark}` : ''}`,
        status: '待采购',
        items: orderItems,
        purchaseList: plan.purchaseList,
        todos: plan.todos,
    };
}

router.get('/', (req, res) => {
    try {
        expireOverdueQuotations();
        res.json({ success: true, data: dbGetAllQuotations() });
    }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/', (req, res) => {
    const { customerId, status, itemsJson, totalCost, totalPrice, remark } = req.body;
    if (!customerId) return res.status(400).json({ success: false, error: 'Missing customerId' });
    const now = new Date().toISOString();
    try {
        const info = safeInsert('quotations', { customer_id: customerId, status: status || '报价中', items_json: itemsJson || '[]', total_cost: totalCost || 0, total_price: totalPrice || 0, remark: remark || '', created_at: now, updated_at: now });
        const record = quotationRow(db.prepare('SELECT * FROM quotations WHERE id = ?').get(info.lastInsertRowid));
        res.json({ success: true, data: record });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/save-payload-draft', (req, res) => {
    try {
        res.json({ success: true, data: buildQuotationSavePayloadDraft(req.body || {}) });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

router.post('/:id/order-draft', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价ID' });
        res.json({ success: true, data: buildOrderDraftFromQuotation(id) });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价ID' });
        safeUpdate('quotations', id, {
            customer_id: req.body.customerId,
            status: req.body.status,
            items_json: req.body.itemsJson,
            total_cost: req.body.totalCost,
            total_price: req.body.totalPrice,
            remark: req.body.remark
        });
        res.json({ success: true, data: quotationRow(db.prepare('SELECT * FROM quotations WHERE id = ?').get(id)) });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价ID' });
        softDelete('quotations', id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
