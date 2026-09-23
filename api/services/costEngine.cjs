const { selectWirePart } = require('./catalogSpec.cjs');
const {
    parseCableAccessoryFee,
    getGlobalCableAccessory,
    getCableAccessoryFeeFromPartsByModel,
    getCableAccessoryNameFromPartsByModel,
    getCableAccessoryFeeFromCatalog,
    getCableAccessoryNameFromCatalog,
    buildCompleteCablePart,
    collapseLegacyCableParts,
} = require('./cableAccessory.cjs');
const { inferPackagingSemantics } = require('./packagingSemantics.cjs');
const { normalizeBomRoles } = require('./bomRoles.cjs');
const { bindStableBomPartIdentities, resolveCatalogPartIdentity, shouldRequireCatalogIdentity } = require('./bomPartIdentity.cjs');

// 成本口径边界：
// - buildRecipeCostDraft：保存配方前生成锁定快照，写入 savedTotalCost / savedCostDetails / partsJson。
// - calculateRecipeCost：按当前零件库重算 partsJson 的参考价，不能当作历史保存成本或订单锁价。
// 新增正式成本口径时优先扩展这里，并同步更新 docs/api-reference.md。

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

const DEFAULT_LONG_SCREW_EXTRA_LENGTH = 0;
const LONG_SCREW_LENGTH_STEP_MM = 5;
const SCREW_LENGTH_PRICE_FACTOR = 0.00424;
const SCREW_LENGTH_PRICE_OFFSET = -0.198;
const DEFAULT_PACKAGING_MATERIAL = '牛皮纸箱';
const STAINLESS_SHELL_BUNDLE_BASE_LENGTH_MM = 150;
const STAINLESS_SHELL_BUNDLE_PRICE_STEP_MM = 10;
const STAINLESS_SHELL_BUNDLE_PRICE_STEP_AMOUNT = 1;

function parseNonNegativeNumber(value, field, { required = false, defaultValue = 0 } = {}) {
    if ((value === undefined || value === null || value === '') && !required) return defaultValue;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${field} 必须是非负数字`);
    return number;
}

function createPartPriceGetter(partsByModel) {
    return (model, supplier = '') => {
        const candidates = partsByModel[model] || [];
        const normalizedSupplier = String(supplier || '').trim();
        const exact = candidates.find(part => String(part.supplier || '').trim() === normalizedSupplier);
        if (exact && normalizedSupplier) return Number(exact.price || 0);
        if (candidates.length === 0) return 0;
        return Number(candidates.reduce((min, part) => part.price < min.price ? part : min, candidates[0]).price || 0);
    };
}

function findPartByModelAndSupplierFromCatalog(partsCatalog, model, supplier = '') {
    const targetModel = String(model || '').trim();
    const targetSupplier = String(supplier || '').trim();
    const candidates = (partsCatalog || []).filter(part => String(part.model || '').trim() === targetModel);
    const exact = candidates.find(part => targetSupplier && String(part.supplier || '').trim() === targetSupplier);
    if (exact) return exact;
    if (candidates.length === 0) return null;
    return candidates.reduce((min, part) => Number(part.price || 0) < Number(min.price || 0) ? part : min, candidates[0]);
}

function getPartPriceFromCatalog(partsCatalog, model, supplier = '') {
    const screwPrice = longScrewPriceByModel(partsCatalog, model, supplier);
    if (screwPrice) return screwPrice.unitPrice;
    const part = findPartByModelAndSupplierFromCatalog(partsCatalog, model, supplier);
    return part ? Number(part.price || 0) : 0;
}

function wireModel(prefix, wire) {
    return `${prefix}-线径${wire || ''}`;
}

function configuredWireModel(prefix, wireOrModel, resolvedWire) {
    const value = String(wireOrModel || '').trim();
    if (value.includes(prefix)) return value;
    const wire = value || resolvedWire;
    return wire ? wireModel(prefix, wire) : '';
}

function createCablePricingError(code, message, statusCode = 400, details) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    if (details !== undefined) error.details = details;
    return error;
}

function normalizeCableAccessoryType(value) {
    const accessoryType = String(value || 'standard').trim();
    if (!['standard', 'xinjie'].includes(accessoryType)) {
        throw createCablePricingError(
            'CABLE_ACCESSORY_TYPE_INVALID',
            'cableAccessoryType 必须是 standard 或 xinjie'
        );
    }
    return accessoryType;
}

function cableAccessorySource({ partsCatalog, matchedPart, accessoryType, getSetting }) {
    const globalAccessory = getGlobalCableAccessory(getSetting, accessoryType);
    if (globalAccessory.configured && globalAccessory.fee != null) return 'system_settings';
    if (parseCableAccessoryFee(matchedPart?.notes, accessoryType) != null) return 'part_notes';
    if ((partsCatalog || []).some(part => String(part?.model || '') === '电缆配件费')) return 'legacy_part';
    return 'default_zero';
}

function calculateCompleteCableCost(input = {}, options = {}) {
    const suppliedWire = input.wire || input.cableWire;
    const selected = !input.model && suppliedWire ? selectWirePart(options.partsCatalog || partsCatalogFromPartsByModel(options.partsByModel || {}), '电缆线', suppliedWire, input.supplier) : null;
    const model = String(input.model || selected?.model || configuredWireModel('电缆', suppliedWire, '')).trim();
    if (!model || model === '电缆-线径') {
        throw createCablePricingError('CABLE_MODEL_REQUIRED', '启用电缆时必须提供有效 cableWire 或 model');
    }

    const cableLength = parseNonNegativeNumber(
        input.cableLength ?? input.length,
        'cableLength',
        { required: true }
    );
    if (cableLength <= 0) {
        throw createCablePricingError('CABLE_LENGTH_INVALID', '启用电缆时 cableLength 必须大于 0');
    }

    const accessoryType = normalizeCableAccessoryType(input.accessoryType ?? input.cableAccessoryType);
    const getSetting = options.getSetting || (() => undefined);
    const partsCatalog = Array.isArray(options.partsCatalog)
        ? options.partsCatalog
        : partsCatalogFromPartsByModel(options.partsByModel || {});
    const requestedSupplier = String(input.supplier || '').trim();
    const matchedPart = findPartByModelAndSupplierFromCatalog(partsCatalog, model, requestedSupplier);
    const supplier = requestedSupplier || String(matchedPart?.supplier || '').trim();

    const hasInputUnitPrice = input.cableUnitPrice !== undefined && input.cableUnitPrice !== null;
    const cableUnitPrice = hasInputUnitPrice
        ? parseNonNegativeNumber(input.cableUnitPrice, 'cableUnitPrice')
        : Number(matchedPart?.price || 0);
    const pricingComplete = Number.isFinite(cableUnitPrice) && cableUnitPrice > 0;
    if (!pricingComplete && options.allowMissingPrice !== true) {
        throw createCablePricingError(
            'CABLE_PRICE_MISSING',
            `电缆型号“${model}”缺少有效的每米价格`,
            422,
            { model, supplier }
        );
    }

    const accessoryFee = input.accessoryFee !== undefined
        ? parseNonNegativeNumber(input.accessoryFee, 'accessoryFee')
        : (Array.isArray(options.partsCatalog)
            ? getCableAccessoryFeeFromCatalog(partsCatalog, model, supplier, accessoryType, getSetting)
            : getCableAccessoryFeeFromPartsByModel(options.partsByModel || {}, model, supplier, accessoryType, getSetting));
    const accessoryName = input.accessoryName || (Array.isArray(options.partsCatalog)
        ? getCableAccessoryNameFromCatalog(partsCatalog, model, supplier, accessoryType, getSetting)
        : getCableAccessoryNameFromPartsByModel(options.partsByModel || {}, model, supplier, accessoryType, getSetting));
    const priceSource = hasInputUnitPrice
        ? 'input_unit_price'
        : requestedSupplier
            ? 'catalog_supplier'
            : (partsCatalog.filter(part => String(part?.model || '') === model).length > 1
                ? 'catalog_lowest_price'
                : 'catalog_model');

    return {
        ...buildCompleteCablePart({
            model,
            supplier,
            cableLength,
            cableUnitPrice,
            accessoryType,
            accessoryName,
            accessoryFee,
        }),
        cableAssembly: true,
        inventoryUnit: 'm',
        costSource: 'cable_formula',
        cablePriceSource: pricingComplete ? priceSource : 'missing',
        cableAccessorySource: input.accessoryFee !== undefined
            ? 'input_accessory_fee'
            : cableAccessorySource({ partsCatalog, matchedPart, accessoryType, getSetting }),
        formulaVersion: 'complete-cable-v1',
        pricingComplete,
    };
}

function inferPackingMaterial(model = '', material, supplier = '') {
    return inferPackagingSemantics({
        model,
        supplier,
        packagingMaterial: material || DEFAULT_PACKAGING_MATERIAL,
    }).packagingMaterial;
}

function lengthPricedPartSubtotal(part, customBarrelLength) {
    const price = Number(part?.snapshotPrice || 0);
    const savedQty = Number(part?.qty || 0);
    const nextQty = customBarrelLength && Number(customBarrelLength) > 0 ? Number(customBarrelLength) / 10 : savedQty;
    return price * nextQty;
}

function calculatePackingEstimate(body, partsByModel) {
    const getPrice = createPartPriceGetter(partsByModel);
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (parts.length === 0) throw new Error('parts 必须是非空数组');
    const details = parts.map(part => {
        if (!part?.model) throw new Error('每个包材必须包含 model');
        const qty = parseNonNegativeNumber(part.qty, 'qty', { defaultValue: 1 });
        const unitPrice = part.snapshotPrice !== undefined
            ? parseNonNegativeNumber(part.snapshotPrice, 'snapshotPrice')
            : getPrice(part.model, part.supplier);
        return {
            model: part.model,
            supplier: part.supplier || '',
            qty,
            unitPrice,
            subtotal: roundMoney(unitPrice * qty)
        };
    });
    return { details, totalCost: roundMoney(details.reduce((sum, part) => sum + part.subtotal, 0)) };
}

function calculateOverheadEstimate(body) {
    const assemblyWage = parseNonNegativeNumber(body.assemblyWage, 'assemblyWage');
    const packingWage = parseNonNegativeNumber(body.packingWage, 'packingWage');
    const surfaceTreatmentCost = parseNonNegativeNumber(body.surfaceTreatmentCost ?? body.paintingWage, 'surfaceTreatmentCost');
    const managementFee = parseNonNegativeNumber(body.managementFee, 'managementFee');
    const details = [
        { name: '安装工资', amount: assemblyWage },
        { name: '打包工资', amount: packingWage },
        { name: '表面处理', amount: surfaceTreatmentCost },
        { name: '管理费', amount: managementFee },
    ];
    return { details, totalCost: roundMoney(details.reduce((sum, item) => sum + item.amount, 0)) };
}

function formatLengthMm(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function roundLengthToStep(value, step = LONG_SCREW_LENGTH_STEP_MM) {
    const length = Number(value);
    const interval = Number(step);
    if (!Number.isFinite(length) || length <= 0) return 0;
    if (!Number.isFinite(interval) || interval <= 0) return length;
    return Math.ceil(length / interval) * interval;
}

function isLongScrewPart(part) {
    return part?.dynamicRule === 'longScrewByBarrelLength'
        || `${part?.name || ''}${part?.model || ''}`.includes('长螺丝');
}

function longScrewModelFromBarrel(part, barrelLength, extraLength = DEFAULT_LONG_SCREW_EXTRA_LENGTH) {
    const barrel = Number(barrelLength || 0);
    const extra = Number(extraLength || 0);
    if (!Number.isFinite(barrel) || barrel <= 0) return null;
    const requestedLength = barrel + extra;
    if (!Number.isFinite(requestedLength) || requestedLength <= 0) return null;

    const dimensions = String(part?.model || '').match(/^(.*?\d+(?:\.\d+)?\*)(\d+(?:\.\d+)?)(.*)$/);
    const prefix = dimensions ? dimensions[1] : '6*';
    return {
        model: `${prefix}${formatLengthMm(requestedLength)}${dimensions?.[3] || ''}`,
        requestedLength,
        screwLength: requestedLength,
    };
}

function applyLongScrewRule(part, barrelLength, extraLength = DEFAULT_LONG_SCREW_EXTRA_LENGTH) {
    if (!isLongScrewPart(part)) return part;
    const result = longScrewModelFromBarrel(part, barrelLength, extraLength);
    if (!result) return part;
    const source = { ...part };
    // A generated length is another physical item; never carry the selected
    // source/pricing part's ID into a different length specification.
    if (result.model !== part.model) delete source.partId;
    return {
        ...source,
        model: result.model,
        dynamicRule: 'longScrewByBarrelLength',
        barrelLength: Number(barrelLength || 0),
        longScrewExtraLength: Number(extraLength || 0),
        requestedScrewLength: result.requestedLength,
        screwLength: result.screwLength,
    };
}

function stainlessShellBundleExtraCost(barrelLength, {
    baseLength = STAINLESS_SHELL_BUNDLE_BASE_LENGTH_MM,
    stepMm = STAINLESS_SHELL_BUNDLE_PRICE_STEP_MM,
    stepAmount = STAINLESS_SHELL_BUNDLE_PRICE_STEP_AMOUNT,
} = {}) {
    const length = Number(barrelLength || 0);
    const base = Number(baseLength || 0);
    const step = Number(stepMm || 0);
    const amount = Number(stepAmount || 0);
    if (!Number.isFinite(length) || !Number.isFinite(base) || !Number.isFinite(step) || !Number.isFinite(amount)) return 0;
    if (length <= base || step <= 0 || amount <= 0) return 0;
    return roundMoney(Math.ceil((length - base) / step) * amount);
}

function applyStainlessShellBundleRule(part, barrelLength) {
    if (part?.dynamicRule !== 'stainlessShellBundleByBarrelLength') return part;
    const length = Number(barrelLength || part.barrelLength || 0);
    const basePrice = Number(part.baseSnapshotPrice ?? part.bundleBasePrice ?? part.snapshotPrice ?? 0);
    const baseLength = Number(part.bundleBaseLength || STAINLESS_SHELL_BUNDLE_BASE_LENGTH_MM);
    const stepMm = Number(part.bundleStepMm || STAINLESS_SHELL_BUNDLE_PRICE_STEP_MM);
    const stepAmount = Number(part.bundleStepAmount || STAINLESS_SHELL_BUNDLE_PRICE_STEP_AMOUNT);
    const extraCost = stainlessShellBundleExtraCost(length, { baseLength, stepMm, stepAmount });
    return {
        ...part,
        qty: Number(part.qty || 1),
        snapshotPrice: roundMoney(basePrice + extraCost),
        baseSnapshotPrice: basePrice,
        bundleBaseLength: baseLength,
        bundleStepMm: stepMm,
        bundleStepAmount: stepAmount,
        barrelLength: length || null,
        barrelExtraCost: extraCost,
        costSource: part.costSource || 'manual',
        source: part.source || 'pump_shell_template',
        formula: length
            ? `泵壳套件基准价 ${roundMoney(basePrice)} + 机筒长度加价 ${extraCost}（${baseLength}mm 起，每 ${stepMm}mm +${stepAmount}）`
            : `泵壳套件基准价 ${roundMoney(basePrice)}`,
    };
}

function parseScrewPricingMeta(notes) {
    if (!notes) return null;
    try {
        const pricing = JSON.parse(notes)?.screwPricing;
        if (!pricing?.enabled) return null;
        const diameter = Number(pricing.diameter);
        if (!Number.isFinite(diameter) || diameter <= 0) return null;
        return { enabled: true, diameter, modelPrefix: pricing.modelPrefix };
    } catch {
        return null;
    }
}

function screwDiameterFromModel(model) {
    const match = String(model || '').match(/(?:^|-)(\d+(?:\.\d+)?)\*/);
    const diameter = match ? Number(match[1]) : NaN;
    return Number.isFinite(diameter) && diameter > 0 ? diameter : null;
}

function screwLengthFromModel(model) {
    const match = String(model || '').match(/\*(\d+(?:\.\d+)?)(?:-|$)/);
    const length = match ? Number(match[1]) : NaN;
    return Number.isFinite(length) && length > 0 ? length : null;
}

function calculateScrewUnitPrice(length) {
    const screwLength = Number(length || 0);
    if (!Number.isFinite(screwLength) || screwLength <= 0) return 0;
    return roundMoney(Math.max(0, SCREW_LENGTH_PRICE_FACTOR * screwLength + SCREW_LENGTH_PRICE_OFFSET));
}

function findScrewPricingPart(partsCatalog, model, supplier = '', pricingPartId) {
    const diameter = screwDiameterFromModel(model);
    if (!diameter || !Array.isArray(partsCatalog)) return null;
    const candidates = partsCatalog
        .map(part => ({ part, pricing: parseScrewPricingMeta(part.notes || part.remark) }))
        .filter(item => item.pricing && !item.part.deletedAt && !item.part.deleted_at && item.part.category === '螺丝' && Number(item.pricing.diameter) === diameter);
    if (pricingPartId != null) {
        if (!Number.isSafeInteger(pricingPartId) || pricingPartId <= 0) throw Object.assign(new Error('长螺丝定价来源ID无效'), { code: 'SCREW_PRICING_ID_INVALID', statusCode: 422 });
        const selected = candidates.filter(item => Number(item.part.id || item.part.Id) === pricingPartId && (!supplier || item.part.supplier === supplier));
        if (selected.length !== 1) throw Object.assign(new Error('长螺丝定价来源不存在、停用或规格/供应商不符'), { code: 'SCREW_PRICING_ID_UNAVAILABLE', statusCode: 422 });
        return selected[0];
    }
    if (candidates.length === 0) return null;
    const normalizedSupplier = String(supplier || '').trim();
    const matching = normalizedSupplier ? candidates.filter(item => String(item.part.supplier || '').trim() === normalizedSupplier) : candidates;
    if (matching.length > 1) throw Object.assign(new Error('长螺丝定价来源有多个候选，需要明确供应商或基础零件'), { code: 'SCREW_PRICING_AMBIGUOUS', statusCode: 409 });
    return matching[0] || null;
}

function longScrewPriceByModel(partsCatalog, model, supplier = '', pricingPartId) {
    const length = screwLengthFromModel(model);
    if (!length) return null;
    const matched = findScrewPricingPart(partsCatalog, model, supplier, pricingPartId);
    if (!matched) return null;
    return {
        unitPrice: calculateScrewUnitPrice(length),
        pricingPartId: matched.part.id || matched.part.Id,
        pricingPartModel: matched.part.model,
        pricingSupplier: matched.part.supplier || '',
    };
}

function longScrewFormulaPriceByModel(model) {
    const length = screwLengthFromModel(model);
    if (!length) return null;
    return {
        unitPrice: calculateScrewUnitPrice(length),
        pricingPartModel: '',
        pricingSupplier: '',
    };
}

function getCableAccessoryFee(partsByModel, cableModel, supplier, accessoryType = 'standard', getSetting = () => undefined) {
    return getCableAccessoryFeeFromPartsByModel(partsByModel, cableModel, supplier, accessoryType, getSetting);
}

function isCableAccessoryPart(part) {
    const model = String(part?.model || '');
    const name = String(part?.name || '');
    return model === '电缆配件费' || name.includes('电缆接头配件');
}

function findCablePart(parts) {
    return parts.find(part => String(part?.model || '').startsWith('电缆-') || String(part?.name || '').includes('电缆线'));
}

function getFloatAccessoryDelta(accessoryType = 'standard', getSetting = () => undefined) {
    if (accessoryType !== 'xinjie') return 0;
    const delta = Number(getSetting('float_accessory_delta'));
    return Number.isFinite(delta) && delta >= 0 ? delta : 0;
}

function isFloatPart(part) {
    const model = String(part?.model || '');
    const name = String(part?.name || '');
    return model.startsWith('浮球-') || name === '浮球';
}

function partsCatalogFromPartsByModel(partsByModel) {
    return Object.entries(partsByModel || {}).flatMap(([model, suppliers]) => (
        (suppliers || []).map(part => ({ ...part, model: part.model || model }))
    ));
}

// PHASE 5-R2 — 正式目录价格语义（本整合候选的最终契约）。
//
// 依据（均为仓库内可核对的形式化事实，不是推测）：
//   1. schema：parts.price 为 `REAL DEFAULT 0` 且约束为 `CHECK(price IS NULL OR price >= 0)`。
//      零是列默认值，负数被数据库直接拒绝。
//   2. 正式零件 API：partCommands.cjs 的 create / update / batch_update_prices 全部使用
//      parseNonNegativeNumber，即 `price >= 0` 合法，`price < 0` 非法。
//   3. 正式列表过滤：partQueries.cjs 的 normalizeOptionalNumber(..., { min: 0 }) 说明
//      价格过滤的下界就是 0，零价格零件是普通可检索数据。
//   4. 文档口径：docs/api-reference.md 在“缺少价格”语境下使用 missingParts，而 0 是
//      目录里一个正常的存储值——它表示零成本项，不表示未定价。
//
// 因此零价不是“缺价”，而是合法的零成本价。真正不可用的是：
//   - 负数（数据破坏：会产出负总额）
//   - 非有限值 / 非数值（null、undefined、NaN、'abc' 等：会产出 NaN 总额）
// 这两类必须被显式识别，否则成本系统会静默给出错误总额。
//
// 注意：缺失（未定价）仍然由“目录里根本没有该型号”分支负责，语义不变。
function hasUsableCatalogPrice(value) {
    if (value === null || value === undefined || value === '') return false;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return false;
    return numeric >= 0;
}

function catalogPriceSourceLabel(value) {
    return value !== null && value !== undefined && value !== ''
        && Number.isFinite(Number(value)) && Number(value) < 0
        ? '正式目录价格无效'
        : '正式目录未定价';
}

function calculateRecipeCost(parts, _partsCache = {}, partsByModel = {}, options = {}) {
    const getSetting = options.getSetting || (() => undefined);
    let totalCost = 0;
    const details = [];
    const missingParts = [];
    const partsCatalog = options.partsCatalog || partsCatalogFromPartsByModel(partsByModel);
    const normalizedParts = collapseLegacyCableParts(parts || []);
    normalizedParts.forEach(part => {
        const identity = part.partId != null && shouldRequireCatalogIdentity(part)
            ? resolveCatalogPartIdentity(partsCatalog, part)
            : null;
        const p = identity ? { ...part, model: identity.model, supplier: identity.supplier || '' } : part;
        const suppliers = identity ? [identity] : partsByModel[p.model] || [];
        const match = identity || suppliers.find(s => (s.supplier || '').trim() === (p.supplier || '').trim());
        let price = 0, source = '';
        if ((p.source === 'pump_shell_template' || p.costSource === 'manual') && p.snapshotPrice !== undefined) {
            price = p.snapshotPrice;
            source = p.costSource === 'manual' ? '手动估算价' : '模板手动价';
        } else if (p.cableAssembly === true || String(p.name || '').startsWith('成品电缆')) {
            const completeCable = calculateCompleteCableCost({
                model: p.model,
                supplier: p.supplier,
                cableLength: p.cableLength ?? p.inventoryQty,
                cableAccessoryType: p.cableAccessoryType,
            }, {
                partsByModel: identity ? { ...partsByModel, [p.model]: [identity] } : partsByModel,
                getSetting,
                allowMissingPrice: true,
            });
            if (!completeCable.pricingComplete) {
                missingParts.push(p.model);
                source = '未找到';
            } else {
                price = completeCable.snapshotPrice;
                const priceSourceLabel = {
                    catalog_supplier: '精确供应商',
                    catalog_lowest_price: '型号回退(取最低价)',
                    catalog_model: '型号价格',
                }[completeCable.cablePriceSource] || completeCable.cablePriceSource;
                source = `${priceSourceLabel}+${completeCable.cableAccessoryName}`;
            }
        } else if (isCableAccessoryPart(p)) {
            const cablePart = findCablePart(parts);
            price = getCableAccessoryFee(partsByModel, cablePart?.model || '', cablePart?.supplier || '', p.cableAccessoryType, getSetting);
            source = '电缆线配件费';
        } else if (isFloatPart(p)) {
            if (match && p.supplier) {
                price = match.price;
                source = '精确匹配';
            } else if (suppliers.length > 0) {
                const fb = suppliers.reduce((min, c) => c.price < min.price ? c : min, suppliers[0]);
                price = fb.price;
                source = '型号回退(取最低价)';
            } else if (p.snapshotPrice !== undefined) {
                price = p.snapshotPrice;
                source = '快照价格';
            } else {
                missingParts.push(p.model);
                source = '未找到';
            }
            if (source !== '快照价格') price += getFloatAccessoryDelta(p.floatAccessoryType, getSetting);
            if (p.floatAccessoryType === 'xinjie') source += '+新界式';
        } else if (isLongScrewPart(p)) {
            const screwPricing = longScrewPriceByModel(partsCatalog, p.model, p.supplier, p.screwPricingPartId) || longScrewFormulaPriceByModel(p.model);
            if (screwPricing) {
                price = screwPricing.unitPrice;
                source = screwPricing.pricingPartModel ? `参数化螺丝(${screwPricing.pricingPartModel})` : '长螺丝公式价';
            } else if (p.snapshotPrice !== undefined) {
                price = p.snapshotPrice;
                source = '快照价格';
            } else {
                missingParts.push(p.model);
                source = '未找到';
            }
        } else if (match && p.supplier) {
            price = match.price;
            if (!hasUsableCatalogPrice(price)) {
                const declaredPrice = price;
                missingParts.push(p.model);
                price = 0;
                source = catalogPriceSourceLabel(declaredPrice);
            } else source = '精确匹配';
        } else if (suppliers.length > 0) {
            // PHASE 5-R2: pick the lowest USABLE catalogue price.  A row with a
            // missing/invalid price must not win the minimum and then hide the
            // shortage; the validity rule itself is defined by
            // hasUsableCatalogPrice (see its comment for the formal evidence).
            const usableSuppliers = suppliers.filter(candidate => hasUsableCatalogPrice(candidate.price));
            if (usableSuppliers.length > 0) {
                const fb = usableSuppliers.reduce(
                    (min, c) => Number(c.price) < Number(min.price) ? c : min,
                    usableSuppliers[0]
                );
                price = fb.price;
                source = '型号回退(取最低价)';
            } else {
                missingParts.push(p.model);
                price = 0;
                source = catalogPriceSourceLabel(suppliers[0]?.price);
            }
        } else if ((p.name === '线圈转子' || p.name === '电容') && p.snapshotPrice !== undefined) {
            price = p.snapshotPrice;
            source = '快照价格';
        } else {
            missingParts.push(p.model);
            source = '未找到';
        }
        const qty = Number(p.qty || 0);
        const subtotal = Number(price || 0) * qty;
        totalCost += subtotal;
        details.push({ name: p.name || p.model, model: p.model, supplier: p.supplier || '-', price: parseFloat(price).toFixed(2), qty: p.qty, subtotal: subtotal.toFixed(2), source });
    });
    return { totalCost: totalCost.toFixed(2), itemCount: normalizedParts.length, details, missingParts };
}

const SURFACE_TREATMENT_LABELS = {
    none: '无处理',
    painting: '喷漆',
    electrophoresis: '电泳',
    powder_coating: '整体喷塑',
    electrophoresis_powder_coating: '电泳+喷塑',
};

function normalizeRecipeParts(parts) {
    if (!Array.isArray(parts)) throw new Error('parts 必须是数组');
    return parts.map(part => ({
        ...part,
        model: String(part?.model || ''),
        name: String(part?.name || part?.model || ''),
        supplier: String(part?.supplier || ''),
        qty: parseNonNegativeNumber(part?.qty, 'qty', { defaultValue: 1 }),
        snapshotPrice: part?.snapshotPrice !== undefined ? parseNonNegativeNumber(part.snapshotPrice, 'snapshotPrice') : undefined,
    }));
}

function findUnpricedRecipeParts(parts) {
    if (!Array.isArray(parts)) return [];
    return parts.filter(part => {
        if (part?.pricingComplete === false) return true;
        const price = Number(part?.snapshotPrice);
        return !Number.isFinite(price) || price <= 0;
    });
}

function assertRecipeBomPrices(parts) {
    const unpricedParts = findUnpricedRecipeParts(parts);
    if (unpricedParts.length === 0) return;
    const labels = unpricedParts.slice(0, 8).map(part => {
        const name = String(part?.name || '').trim();
        const model = String(part?.model || '').trim();
        if (name && model && name !== model) return `${name}（${model}）`;
        return name || model || '未命名项目';
    });
    const remaining = unpricedParts.length - labels.length;
    const error = new Error(`配方 BOM 存在未定价项目：${labels.join('、')}${remaining > 0 ? `等 ${unpricedParts.length} 项` : ''}。请先在零件库补齐对应型号和目录成本价后再保存。`);
    error.statusCode = 400;
    error.code = 'RECIPE_BOM_UNPRICED';
    error.items = unpricedParts;
    throw error;
}

function applyScrewPricing(part, partsCatalog) {
    if (!isLongScrewPart(part)) return part;
    const pricing = longScrewPriceByModel(partsCatalog, part.model, part.supplier, part.screwPricingPartId) || longScrewFormulaPriceByModel(part.model);
    if (!pricing) return part;
    return {
        ...part,
        snapshotPrice: pricing.unitPrice,
        costSource: pricing.pricingPartModel ? 'screw_pricing' : 'screw_formula',
        screwPricingPartId: pricing.pricingPartId,
        screwPricingModel: pricing.pricingPartModel,
        screwPricingSupplier: pricing.pricingSupplier,
    };
}

function renderRecipeCostSnapshot(parts, input = {}) {
    const assemblyWage = parseNonNegativeNumber(input.assemblyWage, 'assemblyWage');
    const packingWage = parseNonNegativeNumber(input.packingWage, 'packingWage');
    const surfaceTreatmentMode = input.surfaceTreatmentMode || 'none';
    const surfaceTreatmentCost = surfaceTreatmentMode === 'none'
        ? 0
        : parseNonNegativeNumber(input.surfaceTreatmentCost, 'surfaceTreatmentCost');
    const managementFee = parseNonNegativeNumber(input.managementFee, 'managementFee');
    const coilMaterial = input.coilMaterial || '钢带';

    const partsCost = parts.reduce((sum, part) => sum + Number(part.snapshotPrice || 0) * Number(part.qty || 1), 0);
    const laborCost = assemblyWage + packingWage + surfaceTreatmentCost + managementFee;
    const savedTotalCost = roundMoney(partsCost + laborCost);

    const wageLines = [
        `安装工资: ¥${assemblyWage.toFixed(2)}`,
        `打包工资: ¥${packingWage.toFixed(2)}`,
    ];
    if (surfaceTreatmentMode !== 'none') {
        const label = SURFACE_TREATMENT_LABELS[surfaceTreatmentMode] || surfaceTreatmentMode;
        wageLines.push(`表面处理(${label}): ¥${surfaceTreatmentCost.toFixed(2)}`);
    }
    wageLines.push(`管理费用: ¥${managementFee.toFixed(2)}`);

    const savedCostDetails = parts
        .map(part => {
            const price = Number(part.snapshotPrice || 0);
            const qty = Number(part.qty || 1);
            const base = `${part.name || part.model}: ¥${price.toFixed(2)} × ${qty} = ¥${(price * qty).toFixed(2)}`;
            if (part.name === '线圈转子') {
                if (part.pricingMode === 'kit') {
                    return `${base}（材质: ${part.material || coilMaterial || '钢带'}，槽眼: ${part.slotType || '小眼'}，计价方式: 供应商套件价，套件价: ¥${Number(part.kitPrice ?? price).toFixed(2)}，来源: ${part.source || '-'}）`;
                }
                return `${base}（材质: ${part.material || coilMaterial || '钢带'}，槽眼: ${part.slotType || '小眼'}，定子单片成本: ¥${Number(part.unitPrice || 0).toFixed(2)}，来源: ${part.source || '-'}，公式: ${part.formula || '-'}）`;
            }
            if (part.dynamicRule === 'longScrewByBarrelLength') {
                const pricingText = part.costSource === 'screw_pricing' || part.costSource === 'screw_formula'
                    ? `，按长度计价${part.screwPricingModel ? `: ${part.screwPricingModel}` : ''}，公式≈0.00424×长度-0.198`
                    : '';
                return `${base}（机筒: ${part.barrelLength}mm，补偿: ${part.longScrewExtraLength}mm，长螺丝: ${part.screwLength}mm${pricingText}）`;
            }
            if (part.dynamicRule === 'stainlessShellBundleByBarrelLength') {
                return `${base}（基准: ${part.bundleBaseLength}mm，当前机筒: ${part.barrelLength || '-'}mm，每${part.bundleStepMm}mm加¥${Number(part.bundleStepAmount || 0).toFixed(2)}，加价¥${Number(part.barrelExtraCost || 0).toFixed(2)}）`;
            }
            return base;
        })
        .concat(wageLines)
        .join('\n');

    return {
        parts,
        partsCost: roundMoney(partsCost),
        laborCost: roundMoney(laborCost),
        savedTotalCost,
        savedCostDetails,
    };
}

function buildRecipeCostDraft(input, options = {}) {
    const barrelLength = input.customBarrelLength ?? input.barrelLength;
    const longScrewExtraLength = input.longScrewExtraLength ?? DEFAULT_LONG_SCREW_EXTRA_LENGTH;
    const enableLongScrewByBarrelLength = input.enableLongScrewByBarrelLength !== false;
    const partsCatalog = options.partsCatalog || input.partsCatalog || [];
    let parts = collapseLegacyCableParts(normalizeRecipeParts(input.parts || []))
        .map(part => enableLongScrewByBarrelLength ? applyLongScrewRule(part, barrelLength, longScrewExtraLength) : part)
        .map(part => applyStainlessShellBundleRule(part, barrelLength))
        .map(part => applyScrewPricing(part, partsCatalog));
    parts = normalizeBomRoles(parts);
    if (options.requireStablePartIdentity === true) {
        parts = bindStableBomPartIdentities(parts, partsCatalog);
    }
    return renderRecipeCostSnapshot(parts, input);
}

module.exports = {
    DEFAULT_LONG_SCREW_EXTRA_LENGTH,
    LONG_SCREW_LENGTH_STEP_MM,
    DEFAULT_PACKAGING_MATERIAL,
    STAINLESS_SHELL_BUNDLE_BASE_LENGTH_MM,
    STAINLESS_SHELL_BUNDLE_PRICE_STEP_MM,
    STAINLESS_SHELL_BUNDLE_PRICE_STEP_AMOUNT,
    roundMoney,
    parseNonNegativeNumber,
    createPartPriceGetter,
    findPartByModelAndSupplierFromCatalog,
    getPartPriceFromCatalog,
    wireModel,
    configuredWireModel,
    normalizeCableAccessoryType,
    calculateCompleteCableCost,
    inferPackingMaterial,
    lengthPricedPartSubtotal,
    calculatePackingEstimate,
    calculateOverheadEstimate,
    formatLengthMm,
    roundLengthToStep,
    isLongScrewPart,
    longScrewModelFromBarrel,
    applyLongScrewRule,
    stainlessShellBundleExtraCost,
    applyStainlessShellBundleRule,
    parseScrewPricingMeta,
    screwDiameterFromModel,
    screwLengthFromModel,
    calculateScrewUnitPrice,
    findScrewPricingPart,
    longScrewPriceByModel,
    parseCableAccessoryFee,
    getGlobalCableAccessory,
    getCableAccessoryFee,
    isCableAccessoryPart,
    findCablePart,
    getFloatAccessoryDelta,
    isFloatPart,
    partsCatalogFromPartsByModel,
    // PHASE 5-R3：正式目录价格可用性判定只有这一份实现，其他模块必须复用，
    // 不得各自复制一份规则。
    hasUsableCatalogPrice,
    catalogPriceSourceLabel,
    calculateRecipeCost,
    renderRecipeCostSnapshot,
    buildRecipeCostDraft,
    findUnpricedRecipeParts,
    assertRecipeBomPrices,
};
