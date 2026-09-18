const { generateCatalogName, PART_CREATE_NAMING_RULES } = require('./catalogNaming.cjs');

function fail(code, message, statusCode = 400) {
    const error = new Error(message);
    Object.assign(error, { code, statusCode });
    throw error;
}

function normalizePartNaming(naming, category, model) {
    const generated = generateCatalogName(naming);
    if (!PART_CREATE_NAMING_RULES.has(generated.ruleId)) {
        fail('PART_NAMING_RULE_NOT_READY', '此分类暂未开放规格命名保存');
    }
    if (generated.category !== String(category).trim() && !(generated.ruleId === 'custom-part' && !['轴承', '电容', '螺丝', '油封', '泵壳', '泵壳搭配', '浮球', '电缆线', '皮垫', '配件', '包装', '线圈转子'].includes(String(category).trim()))) fail('PART_NAMING_CATEGORY_MISMATCH', '命名规则与零件分类不一致');
    if (model != null && String(model).trim() && String(model).trim() !== generated.name) {
        fail('PART_NAMING_MODEL_MISMATCH', '型号必须与系统根据规格生成的名称一致');
    }
    return {
        model: generated.name,
        naming: { ruleId: generated.ruleId, spec: generated.normalizedSpec },
        stored: { ruleId: generated.ruleId, ruleVersion: generated.ruleVersion, spec: generated.normalizedSpec },
    };
}

function readPartNaming(row) {
    if (!row?.naming_json) return null;
    return JSON.parse(row.naming_json);
}

function assertPartNamingUpdate(current, updates, naming) {
    const stored = readPartNaming(current);
    if (!stored) {
        if (naming !== undefined) fail('PART_NAMING_ADOPTION_REQUIRED', '已有零件需要先核实规格和引用后再转入规格命名', 409);
        return;
    }
    if (updates.supplier !== undefined && String(updates.supplier).trim() !== String(current.supplier).trim()) fail('PART_SUPPLIER_REPLACEMENT_REQUIRED', '不同供应商必须新建零件，不能改变已有物料的库存归属', 409);
    if (updates.model !== undefined && String(updates.model).trim() !== current.model || updates.category !== undefined && updates.category !== current.category) fail('PART_NAMING_CHANGE_REQUIRES_REVIEW', '改名请使用按规格规范名称；关键规格变化必须新建物料', 409);
    if (naming !== undefined) {
        const normalized = normalizePartNaming(naming, current.category);
        const old = generateCatalogName({ ruleId: stored.ruleId, spec: stored.spec });
        if (normalized.stored.ruleId !== stored.ruleId || JSON.stringify(normalized.stored.spec) !== JSON.stringify(old.normalizedSpec)) fail('PART_NAMING_CHANGE_REQUIRES_REVIEW', '不能通过普通编辑改变命名规格；请先核实实物规格和引用', 409);
    }
}

module.exports = { PART_CREATE_NAMING_RULES, normalizePartNaming, readPartNaming, assertPartNamingUpdate };
