'use strict';
// 同一「定子规格-片数」在正式目录里可能有多套方案（例如 12-220 = 钢带/小眼 + 冷轧/国标眼，
// 两套都是各自定子组合下的默认）。按材质、槽眼或线圈 ID 收窄计算时，调用方（内置模型或外部
// MCP Agent）会拿到一个数字，却看不到"这不是唯一方案"，于是用户只被告知其中一套成本。
// 这里统一取出同规格片数的其它正式方案，供执行器附加歧义提示。
const OFFICIAL_SCHEME_STATUS = 'official';

function schemeStatusOf(row) {
    return String(row?.schemeStatus ?? row?.scheme_status ?? OFFICIAL_SCHEME_STATUS).trim() || OFFICIAL_SCHEME_STATUS;
}

function coilRowId(row) {
    const id = Number(row?.id ?? row?.Id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** 只保留正式方案；测试与停用方案不参与"唯一性"判断。 */
function officialCoilRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(row => schemeStatusOf(row) === OFFICIAL_SCHEME_STATUS);
}

function sameSpecSheetsRows(rows, spec, sheets) {
    const targetSpec = String(spec ?? '').trim();
    const targetSheets = Number(sheets);
    if (!targetSpec || !Number.isFinite(targetSheets) || targetSheets <= 0) return [];
    return officialCoilRows(rows).filter(row => (
        String(row?.spec ?? '').trim() === targetSpec && Number(row?.sheets) === targetSheets
    ));
}

function variantView(row) {
    return {
        id: coilRowId(row),
        spec: String(row?.spec ?? '').trim(),
        sheets: Number(row?.sheets ?? NaN),
        schemeCode: String(row?.schemeCode ?? row?.scheme_code ?? '').trim(),
        material: String(row?.material ?? '').trim(),
        slotType: String(row?.slotType ?? row?.slot_type ?? '').trim(),
        cost: Number(row?.cost ?? 0),
        isDefault: Boolean(row?.isDefault ?? row?.is_default),
    };
}

function variantLabel(variant) {
    const identity = [variant.material, variant.slotType].filter(Boolean).join('/') || '未标注材质槽眼';
    return `${variant.schemeCode || `ID ${variant.id}`}（${identity}）`;
}

/**
 * 取「同一 规格-片数」下的其它正式方案。
 * @returns {Promise<{variants: object[], notice: string}>} 没有其它方案时返回空数组与空提示。
 */
function createCoilVariantLookup(getJson) {
    return async function lookupOtherOfficialVariants(internalFetch, { spec, sheets, excludeIds = [] }) {
        const targetSpec = String(spec ?? '').trim();
        const targetSheets = Number(sheets);
        if (!targetSpec || !Number.isFinite(targetSheets) || targetSheets <= 0) {
            return { variants: [], notice: '' };
        }
        const query = new URLSearchParams({ spec: targetSpec, sheets: String(targetSheets) });
        const rows = await getJson(
            internalFetch,
            `/api/coils?${query.toString()}`,
            '线圈记录读取失败'
        );
        const excluded = new Set(
            (Array.isArray(excludeIds) ? excludeIds : [excludeIds])
                .map(Number)
                .filter(Number.isSafeInteger)
        );
        const variants = sameSpecSheetsRows(rows, targetSpec, targetSheets)
            .map(variantView)
            .filter(variant => variant.id && !excluded.has(variant.id));
        if (variants.length === 0) return { variants: [], notice: '' };
        const listed = variants
            .map(variant => `${variantLabel(variant)}${Number.isFinite(variant.cost) && variant.cost > 0 ? ` 成本 ${variant.cost}` : ''}`)
            .join('、');
        return {
            variants,
            notice: `同一 ${targetSpec}-${targetSheets} 在正式目录中还有其它方案：${listed}。`
                + '本次金额只对应调用方指定的那套方案，不是该规格片数的唯一成本；'
                + '回答时必须说明还存在这些方案，并在需要时让用户确认采用哪一套。',
        };
    };
}

module.exports = {
    OFFICIAL_SCHEME_STATUS,
    createCoilVariantLookup,
    officialCoilRows,
    sameSpecSheetsRows,
    variantLabel,
    variantView,
};
