const crypto = require('node:crypto');
const { requestHash } = require('./commandExecution.cjs');
const { assertRecipeBomPrices } = require('./costEngine.cjs');
const { calculateRecipeCostPreview } = require('./dynamicCostPreview.cjs');
const { QUOTATION_STATUSES } = require('./orderWorkflow.cjs');
const {
    parseJsonArray,
    parseNonNegativeNumber,
    parsePositiveId,
    parsePositiveNumber,
} = require('./validation.cjs');

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
    const allowed = new Set([
        'none',
        'painting',
        'electrophoresis',
        'electrophoresis_powder_coating',
        'powder_coating',
        'custom',
    ]);
    return allowed.has(value) ? value : 'none';
}

function normalizeQuotationItemOverrides(overrides, index) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return {};
    if (Object.keys(overrides).length === 0) return {};
    const surfaceTreatmentMode = normalizeSurfaceTreatmentMode(
        overrides.surfaceTreatmentMode
    );
    return {
        hasFloat: Boolean(overrides.hasFloat),
        floatWire: String(overrides.floatWire || ''),
        floatAccessoryType: normalizeAccessoryType(overrides.floatAccessoryType),
        hasCable: Boolean(overrides.hasCable),
        cableLength: parseOptionalNonNegativeNumber(
            overrides.cableLength,
            `items[${index}].overrides.cableLength`
        ),
        cableWire: String(overrides.cableWire || ''),
        cableAccessoryType: normalizeAccessoryType(overrides.cableAccessoryType),
        coilSpec: String(overrides.coilSpec || ''),
        coilSheets: parseOptionalNonNegativeNumber(
            overrides.coilSheets,
            `items[${index}].overrides.coilSheets`
        ),
        coilMaterial: String(overrides.coilMaterial || '钢带'),
        coilSlotType: String(overrides.coilSlotType || '小眼'),
        customBarrelLength: parseOptionalNonNegativeNumber(
            overrides.customBarrelLength,
            `items[${index}].overrides.customBarrelLength`
        ),
        boxType: String(overrides.boxType || ''),
        packingPartsJson: JSON.stringify(parseJsonArray(overrides.packingPartsJson)),
        surfaceTreatmentMode,
        surfaceTreatmentCost: surfaceTreatmentMode === 'none'
            ? 0
            : parseNonNegativeNumber(
                overrides.surfaceTreatmentCost,
                `items[${index}].overrides.surfaceTreatmentCost`,
                { defaultValue: 0 }
            ),
    };
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
    const {
        calculateRecipeCost,
        db,
        dbGetAllCoils,
        getSetting,
        loadPartsData,
    } = dependencies;
    const { partsCache, partsByModel } = loadPartsData();
    const partsCatalog = Object.values(partsByModel).flat();
    return items
        .filter(item => item && (item.baseRecipeId || item.baseRecipeName))
        .map((item, index) => {
            const qty = parsePositiveNumber(
                item.qty,
                `items[${index}].qty`,
                { defaultValue: 1 }
            );
            const recipeId = parsePositiveId(item.baseRecipeId);
            if (!recipeId) {
                throw new Error(`items[${index}].baseRecipeId 必须是有效配方ID`);
            }
            const recipe = db.prepare(
                'SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL'
            ).get(recipeId);
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
            const unitCost = parseNonNegativeNumber(
                preview.unitCost,
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
                totalPrice: roundMoney(unitPrice * qty),
                overrides,
                snapshotVersion: 1,
                snapshotAt: preview.costSnapshot.generatedAt,
                bomSnapshot: preview.parts,
                costSnapshot: preview.costSnapshot,
            };
        });
}

function stableQuotationValue(value) {
    if (Array.isArray(value)) return value.map(stableQuotationValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !['id', 'snapshotAt', 'generatedAt'].includes(key))
            .map(([key, nested]) => [key, stableQuotationValue(nested)])
    );
}

function quotationSavePreviewHash(payload) {
    return requestHash({
        customerId: payload.customerId,
        status: payload.status,
        items: stableQuotationValue(parseJsonArray(payload.itemsJson)),
        totalCost: payload.totalCost,
        totalPrice: payload.totalPrice,
        remark: payload.remark,
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
    const payload = {
        customerId,
        status,
        itemsJson: JSON.stringify(items),
        totalCost: roundMoney(
            items.reduce((sum, item) => sum + item.unitCost * item.qty, 0)
        ),
        totalPrice: roundMoney(
            items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0)
        ),
        remark: String(body.remark || ''),
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
            },
        }],
        warnings: [],
    };
}

module.exports = {
    buildQuotationSavePayloadDraft,
    parseQuotationItemsInput,
    quotationSavePreviewHash,
};
