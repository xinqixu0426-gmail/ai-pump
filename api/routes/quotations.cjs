const express = require('express');
const {
    db,
    dbGetAllParts,
    dbGetAllQuotations,
    dbGetAllCoils,
    loadPartsData,
    calculateRecipeCost,
    getSetting,
    quotationRow,
    orderRow,
    safeInsert,
    safeUpdate,
    softDelete,
} = require('../db.cjs');
const { buildBalancedOrderPlans } = require('../services/orderPlanning.cjs');
const { QUOTATION_STATUSES, assertQuotationTransition } = require('../services/orderWorkflow.cjs');
const { calculateRecipeCostPreview } = require('../services/dynamicCostPreview.cjs');
const { assertRecipeBomPrices } = require('../services/costEngine.cjs');
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

function parseOptionalNonNegativeNumber(value, field) {
    if (value === undefined || value === null || value === '') return '';
    return parseNonNegativeNumber(value, field);
}

function normalizeAccessoryType(value) {
    return value === 'xinjie' ? 'xinjie' : 'standard';
}

function normalizeSurfaceTreatmentMode(value) {
    const allowed = new Set(['none', 'painting', 'electrophoresis', 'electrophoresis_powder_coating', 'powder_coating', 'custom']);
    return allowed.has(value) ? value : 'none';
}

function normalizeQuotationItemOverrides(overrides, index) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return {};
    return {
        hasFloat: Boolean(overrides.hasFloat),
        floatWire: String(overrides.floatWire || ''),
        floatAccessoryType: normalizeAccessoryType(overrides.floatAccessoryType),
        hasCable: Boolean(overrides.hasCable),
        cableLength: parseOptionalNonNegativeNumber(overrides.cableLength, `items[${index}].overrides.cableLength`),
        cableWire: String(overrides.cableWire || ''),
        cableAccessoryType: normalizeAccessoryType(overrides.cableAccessoryType),
        coilSpec: String(overrides.coilSpec || ''),
        coilSheets: parseOptionalNonNegativeNumber(overrides.coilSheets, `items[${index}].overrides.coilSheets`),
        coilMaterial: String(overrides.coilMaterial || '钢带'),
        coilSlotType: String(overrides.coilSlotType || '小眼'),
        customBarrelLength: parseOptionalNonNegativeNumber(overrides.customBarrelLength, `items[${index}].overrides.customBarrelLength`),
        boxType: String(overrides.boxType || ''),
        packingPartsJson: JSON.stringify(parseJsonArray(overrides.packingPartsJson)),
        surfaceTreatmentMode: normalizeSurfaceTreatmentMode(overrides.surfaceTreatmentMode),
        surfaceTreatmentCost: normalizeSurfaceTreatmentMode(overrides.surfaceTreatmentMode) === 'none'
            ? 0
            : parseNonNegativeNumber(overrides.surfaceTreatmentCost, `items[${index}].overrides.surfaceTreatmentCost`, { defaultValue: 0 }),
    };
}

function normalizeQuotationItems(items) {
    if (!Array.isArray(items)) return [];
    const { partsCache, partsByModel } = loadPartsData();
    const partsCatalog = Object.values(partsByModel).flat();
    return items
        .filter(item => item && (item.baseRecipeId || item.baseRecipeName))
        .map((item, index) => {
            const qty = parsePositiveNumber(item.qty, `items[${index}].qty`, { defaultValue: 1 });
            const recipeId = parsePositiveId(item.baseRecipeId);
            if (!recipeId) throw new Error(`items[${index}].baseRecipeId 必须是有效配方ID`);
            const recipe = db.prepare('SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL').get(recipeId);
            if (!recipe) throw new Error(`报价明细配方不存在：${recipeId}`);
            const overrides = normalizeQuotationItemOverrides(item.overrides, index);
            const preview = calculateRecipeCostPreview(recipe, overrides, {
                partsCache,
                partsByModel,
                partsCatalog,
                calculateRecipeCost,
                getCoils: dbGetAllCoils,
                getSetting,
            });
            assertRecipeBomPrices(preview.parts);
            const unitCost = parseNonNegativeNumber(preview.unitCost, `items[${index}].unitCost`);
            const margin = parsePositiveNumber(item.margin, `items[${index}].margin`, { defaultValue: 1.1 });
            const unitPrice = item.unitPrice == null
                ? roundMoney(unitCost * margin)
                : roundMoney(parseNonNegativeNumber(item.unitPrice, `items[${index}].unitPrice`));
            return {
                id: String(item.id || `quotation-item-${Date.now()}-${index}`),
                baseRecipeId: recipeId,
                baseRecipeName: String(item.baseRecipeName || recipe.name || '未命名产品'),
                spec: String(item.spec || recipe.spec || ''),
                qty,
                unitCost: roundMoney(unitCost),
                margin: unitCost > 0 ? roundMoney(unitPrice / unitCost) : margin,
                unitPrice,
                totalPrice: roundMoney(unitPrice * qty),
                overrides,
                snapshotVersion: 1,
                snapshotAt: preview.costSnapshot.generatedAt,
                bomSnapshot: preview.parts,
                costSnapshot: preview.costSnapshot,
            };
        });
}

function parseQuotationItemsInput(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) throw new Error('报价明细必须是数组');
        return parsed;
    } catch (error) {
        throw new Error(error.message === '报价明细必须是数组' ? error.message : '报价明细必须是有效 JSON 数组');
    }
}

function buildQuotationSavePayloadDraft(body) {
    const customerId = parsePositiveId(body?.customerId);
    if (!customerId) throw new Error('请选择客户');
    const items = normalizeQuotationItems(body?.items);
    if (items.length === 0) throw new Error('至少添加一个报价明细');
    const status = String(body?.status || '报价中');
    if (!QUOTATION_STATUSES.has(status)) throw new Error('报价状态无效');
    const totalCost = roundMoney(items.reduce((sum, item) => sum + item.unitCost * item.qty, 0));
    const totalPrice = roundMoney(items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0));
    return {
        customerId,
        status,
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
        const bomSnapshot = Array.isArray(item.bomSnapshot) && item.bomSnapshot.length > 0
            ? item.bomSnapshot
            : parseJsonArray(item.partsJson || recipe?.parts_json);
        if (bomSnapshot.length === 0) throw new Error(`报价明细「${item.baseRecipeName || index + 1}」缺少 BOM 快照`);
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

    if (orderItems.length === 0) throw new Error('报价没有可转订单的明细');
    const activeOrders = db.prepare(`
        SELECT * FROM orders
        WHERE deleted_at IS NULL AND status NOT IN ('已关闭', '已取消')
        ORDER BY created_at, id
    `).all();
    const draftOrder = { id: -1, created_at: new Date().toISOString(), items: orderItems, purchase_list_json: '[]' };
    const plan = buildBalancedOrderPlans([...activeOrders, draftOrder], dbGetAllParts()).get(-1);
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

function convertQuotationToOrder(quotationId) {
    const convert = db.transaction((id) => {
        const quotation = db.prepare('SELECT * FROM quotations WHERE id = ? AND deleted_at IS NULL').get(id);
        if (!quotation) throw new Error('报价单不存在');
        if (quotation.converted_order_id || quotation.status === '已转订单') {
            const error = new Error('该报价已经转为订单，不能重复转单');
            error.statusCode = 409;
            throw error;
        }
        if (quotation.status !== '已接受') {
            const error = new Error('只有已接受的报价可以转为订单');
            error.statusCode = 409;
            throw error;
        }

        const draft = buildOrderDraftFromQuotation(id);
        const now = new Date().toISOString();
        const info = safeInsert('orders', {
            customer_name: draft.customerName,
            contract_no: draft.contractNo || '',
            remark: draft.remark || '',
            status: '待采购',
            items_json: JSON.stringify(draft.items),
            purchase_list_json: JSON.stringify(draft.purchaseList),
            todos_json: JSON.stringify(draft.todos),
            created_at: now,
            updated_at: now,
        });
        const orderId = Number(info.lastInsertRowid);
        safeUpdate('quotations', id, {
            status: '已转订单',
            converted_order_id: orderId,
            converted_at: now,
        });
        return {
            order: orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)),
            quotation: quotationRow(db.prepare('SELECT * FROM quotations WHERE id = ?').get(id)),
        };
    });
    return convert(quotationId);
}

router.get('/', (req, res) => {
    try {
        expireOverdueQuotations();
        res.json({ success: true, data: dbGetAllQuotations() });
    }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/', (req, res) => {
    try {
        const payload = buildQuotationSavePayloadDraft({
            ...req.body,
            items: req.body.items ?? parseQuotationItemsInput(req.body.itemsJson),
        });
        if (payload.status !== '草稿' && payload.status !== '报价中') {
            throw new Error('新报价只能保存为草稿或报价中');
        }
        const now = new Date().toISOString();
        const info = safeInsert('quotations', {
            customer_id: payload.customerId,
            status: payload.status,
            items_json: payload.itemsJson,
            total_cost: payload.totalCost,
            total_price: payload.totalPrice,
            remark: payload.remark,
            created_at: now,
            updated_at: now,
        });
        const record = quotationRow(db.prepare('SELECT * FROM quotations WHERE id = ?').get(info.lastInsertRowid));
        res.json({ success: true, data: record });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
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

router.post('/:id/convert', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价ID' });
        res.status(201).json({ success: true, data: convertQuotationToOrder(id) });
    } catch (err) {
        res.status(err.statusCode || (err.message === '报价单不存在' ? 404 : 400)).json({ success: false, error: err.message });
    }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价ID' });
        const current = db.prepare('SELECT * FROM quotations WHERE id = ? AND deleted_at IS NULL').get(id);
        if (!current) return res.status(404).json({ success: false, error: '报价单不存在' });
        if (current.converted_order_id || current.status === '已转订单') {
            return res.status(409).json({ success: false, error: '已转订单的报价不能再修改' });
        }
        const hasItems = req.body.items !== undefined || req.body.itemsJson !== undefined;
        if (hasItems) {
            if (current.status !== '草稿' && current.status !== '报价中') {
                return res.status(409).json({ success: false, error: '只有草稿或报价中的报价可以修改核心明细' });
            }
            const payload = buildQuotationSavePayloadDraft({
                customerId: req.body.customerId ?? current.customer_id,
                status: current.status,
                items: req.body.items ?? parseQuotationItemsInput(req.body.itemsJson),
                remark: req.body.remark ?? current.remark,
            });
            safeUpdate('quotations', id, {
                customer_id: payload.customerId,
                status: payload.status,
                items_json: payload.itemsJson,
                total_cost: payload.totalCost,
                total_price: payload.totalPrice,
                remark: payload.remark,
            });
        } else {
            const updates = {};
            if (req.body.status !== undefined) {
                const status = String(req.body.status);
                assertQuotationTransition(current.status, status);
                updates.status = status;
            }
            if (req.body.remark !== undefined) updates.remark = String(req.body.remark || '');
            safeUpdate('quotations', id, updates);
        }
        res.json({ success: true, data: quotationRow(db.prepare('SELECT * FROM quotations WHERE id = ?').get(id)) });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

router.post('/:id/status', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价ID' });
        const current = db.prepare('SELECT * FROM quotations WHERE id = ? AND deleted_at IS NULL').get(id);
        if (!current) return res.status(404).json({ success: false, error: '报价单不存在' });
        const status = String(req.body?.status || '');
        assertQuotationTransition(current.status, status);
        safeUpdate('quotations', id, { status });
        res.json({ success: true, data: quotationRow(db.prepare('SELECT * FROM quotations WHERE id = ?').get(id)) });
    } catch (err) {
        res.status(err.statusCode || 400).json({ success: false, error: err.message });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价ID' });
        const current = db.prepare('SELECT * FROM quotations WHERE id = ? AND deleted_at IS NULL').get(id);
        if (!current) return res.status(404).json({ success: false, error: '报价单不存在' });
        if (current.status !== '草稿' && current.status !== '已拒绝' && current.status !== '已过时') {
            return res.status(409).json({ success: false, error: '只有草稿、已拒绝或已过时报价可以删除' });
        }
        softDelete('quotations', id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
