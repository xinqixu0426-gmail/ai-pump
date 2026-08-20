const crypto = require('node:crypto');
const { requestHash } = require('./commandExecution.cjs');
const { buildConfiguredRecipeSnapshot } = require('./configuredRecipeSnapshot.cjs');
const { QUOTATION_STATUSES } = require('./orderWorkflow.cjs');
const {
    normalizeQuotationInquiryInput,
} = require('./quotationAttachmentSummaries.cjs');
const {
    parseJsonArray,
    parseNonNegativeNumber,
    parsePositiveId,
    parsePositiveNumber,
} = require('./validation.cjs');
const { stablePreviewValue } = require('./previewIntegrity.cjs');

function roundMoney(value) {
    return Math.round(value * 100) / 100;
}

function parseOptionalPositiveNumber(value, field) {
    if (value === undefined || value === null || value === '') return null;
    return parsePositiveNumber(value, field);
}

function parseQuotationItemsInput(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) throw new Error('报价明细必须是数组');
        return parsed;
    } catch (error) {
        throw new Error(
            error.message === '报价明细必须是数组'
                ? error.message
                : '报价明细必须是有效 JSON 数组'
        );
    }
}

function normalizeQuotationItems(dependencies, items) {
    if (!Array.isArray(items)) return [];
    const { db } = dependencies;
    return items
        .filter(item => item && (item.baseRecipeId || item.baseRecipeName))
        .map((item, index) => {
            const qty = parseOptionalPositiveNumber(
                item.qty,
                `items[${index}].qty`
            );
            const recipeId = parsePositiveId(item.baseRecipeId);
            if (!recipeId) {
                throw new Error(`items[${index}].baseRecipeId 必须是有效配方ID`);
            }
            const recipe = db.prepare(
                'SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL'
            ).get(recipeId);
            if (!recipe) throw new Error(`报价明细配方不存在：${recipeId}`);
            const configured = buildConfiguredRecipeSnapshot(dependencies, recipeId, item.overrides, {
                recipe,
                overridesField: `items[${index}].overrides`,
            });
            const overrides = configured.configurationOverrides;
            const unitCost = parseNonNegativeNumber(
                configured.unitCost,
                `items[${index}].unitCost`
            );
            const margin = parsePositiveNumber(
                item.margin,
                `items[${index}].margin`,
                { defaultValue: 1.1 }
            );
            const unitPrice = item.unitPrice == null
                ? roundMoney(unitCost * margin)
                : roundMoney(parseNonNegativeNumber(
                    item.unitPrice,
                    `items[${index}].unitPrice`
                ));
            return {
                id: String(item.id || `quotation-item-${Date.now()}-${index}`),
                baseRecipeId: recipeId,
                baseRecipeName: String(
                    item.baseRecipeName || recipe.name || '未命名产品'
                ),
                spec: String(item.spec || recipe.spec || ''),
                qty,
                unitCost: roundMoney(unitCost),
                margin: unitCost > 0 ? roundMoney(unitPrice / unitCost) : margin,
                unitPrice,
                totalPrice: qty == null ? null : roundMoney(unitPrice * qty),
                overrides,
                snapshotVersion: 1,
                snapshotAt: configured.costSnapshot.generatedAt,
                bomSnapshot: configured.bomSnapshot,
                costSnapshot: configured.costSnapshot,
                configurationSnapshot: configured.configurationSnapshot,
                warnings: configured.warnings,
            };
        });
}

function quotationSavePreviewHash(payload) {
    return requestHash({
        customerId: payload.customerId,
        status: payload.status,
        items: stablePreviewValue(parseJsonArray(payload.itemsJson)),
        totalCost: payload.totalCost,
        totalPrice: payload.totalPrice,
        remark: payload.remark,
        attachmentFileIds: payload.attachmentFileIds,
        attachmentSummary: payload.attachmentSummary,
        attachmentSourceFileIds: payload.attachmentSourceFileIds,
    });
}

function buildQuotationSavePayloadDraft(dependencies, body = {}) {
    const customerId = parsePositiveId(body.customerId);
    if (!customerId) throw new Error('请选择客户');
    const customer = dependencies.db.prepare(
        'SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL'
    ).get(customerId);
    if (!customer) throw new Error('客户不存在');
    const items = normalizeQuotationItems(
        dependencies,
        body.items ?? parseQuotationItemsInput(body.itemsJson)
    );
    if (items.length === 0) throw new Error('至少添加一个报价明细');
    const status = String(body.status || '报价中');
    if (!QUOTATION_STATUSES.has(status)) throw new Error('报价状态无效');
    const inquiry = normalizeQuotationInquiryInput(body, {
        dbAccessors: dependencies,
    });
    const quantitiesConfirmed = items.every(item => item.qty != null);
    const payload = {
        customerId,
        status,
        itemsJson: JSON.stringify(items),
        totalCost: quantitiesConfirmed
            ? roundMoney(items.reduce((sum, item) => sum + item.unitCost * item.qty, 0))
            : null,
        totalPrice: quantitiesConfirmed
            ? roundMoney(items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0))
            : null,
        remark: String(body.remark || ''),
        attachmentFileIds: inquiry.attachmentFileIds,
        attachmentSummary: inquiry.attachmentSummary,
        attachmentSourceFileIds: inquiry.attachmentSourceFileIds,
        quantitiesConfirmed,
    };
    return {
        ...payload,
        preview: true,
        previewHash: quotationSavePreviewHash(payload),
        suggestedIdempotencyKey: `quotation-save:${crypto.randomUUID()}`,
        changes: [{
            resourceType: 'quotation',
            resourceId: null,
            field: 'savePayload',
            from: null,
            to: {
                customerId,
                status,
                itemCount: items.length,
                totalCost: payload.totalCost,
                totalPrice: payload.totalPrice,
                quantitiesConfirmed,
                attachmentCount: inquiry.attachmentFileIds.length,
                attachmentSummarySourceCount: inquiry.attachmentSourceFileIds.length,
                hasAttachmentSummary: Boolean(inquiry.attachmentSummary),
            },
        }],
        warnings: quantitiesConfirmed ? [] : [{
            code: 'quotation_quantity_pending',
            message: '客户数量尚未确认，报价仅保存单位成本和出厂单价，不生成总金额',
        }],
    };
}

module.exports = {
    buildQuotationSavePayloadDraft,
    parseQuotationItemsInput,
    quotationSavePreviewHash,
};
