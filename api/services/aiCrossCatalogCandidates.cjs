'use strict';
// C（生产会话 58）：「V750 的成本是多少」——配方目录里本来就没有 V750 这个成品型号，
// 旧行为是空手反问用户。这里在"型号在某个目录里查不到"时补一次有界跨目录正式探测，把其它
// 目录里真实存在的候选交给模型，让它带着候选清单澄清或直接答对应对象，而不是让用户从零说明。
//
// 规则（不是只针对配方）：**任何**型号样式标识符在**任一**正式目录里查不到时，都要把其余目录查一遍。
// 触发面覆盖两条真实形态：① 按名称解析失败（AI_RESOURCE_NOT_FOUND）；② 查询成功但零行
// （例如 get_all_recipes(keyword) / search_templates(model) 返回空）。生产实例：问 V800 的成本，
// 模型只查了配方与模板就说"查不到"，而 泵壳-V800-平刀 一直作为零件存在。
//
// 只在查询本身是型号简称（V550/V800/12-120 这类）时探测：描述性短语查不到就是查不到，
// 不应该被引到别的目录。候选只带身份字段，不带价格/库存，避免把目录金额混进本轮正式金额依据。
const MODEL_TOKEN_RE = /^(?:[a-z]{1,4}[-_.]?\d{1,4}|\d{1,3}[-_]\d{1,4})$/iu;
const MAX_CANDIDATES = 6;

const ENTITY_LABELS = Object.freeze({
    recipe: '配方',
    template: '泵壳模板',
    part: '零件',
});

// 各正式目录的读取方式与候选映射；exclude 用来排除"刚刚查过的那个目录"。
const CATALOG_SOURCES = Object.freeze({
    template: {
        entityType: 'template',
        label: ENTITY_LABELS.template,
        path: () => '/api/templates',
        errorMessage: '泵壳模板列表读取失败',
        match: (row, needle) => (
            normalizeToken(row?.shellModel).includes(needle)
            || normalizeToken(row?.description).includes(needle)
        ),
        view: templateCandidate,
    },
    part: {
        entityType: 'part',
        label: ENTITY_LABELS.part,
        path: token => `/api/parts?keyword=${encodeURIComponent(token)}`,
        errorMessage: '零件列表读取失败',
        match: (row, needle) => normalizeToken(row?.model).includes(needle),
        view: partCandidate,
    },
    recipe: {
        entityType: 'recipe',
        label: ENTITY_LABELS.recipe,
        path: token => `/api/recipes?keyword=${encodeURIComponent(token)}`,
        errorMessage: '配方列表读取失败',
        match: (row, needle) => normalizeToken(row?.name).includes(needle),
        view: recipeCandidate,
    },
});

function isCatalogModelToken(value) {
    return MODEL_TOKEN_RE.test(String(value || '').trim());
}

function normalizeToken(value) {
    return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

function recipeCandidate(recipe, needle) {
    const name = String(recipe?.name || '').trim();
    if (!name || !normalizeToken(name).includes(needle)) return null;
    return {
        entityType: 'recipe',
        entityLabel: ENTITY_LABELS.recipe,
        canonicalId: recipe?.id ?? recipe?.Id ?? null,
        label: name,
        model: name,
        matchField: 'name',
        nextTool: 'preview_recipe_cost',
    };
}

function templateCandidate(template, needle) {
    const shellModel = String(template?.shellModel || '').trim();
    const description = String(template?.description || '').trim();
    const label = description || shellModel;
    if (!label) return null;
    return {
        entityType: 'template',
        entityLabel: ENTITY_LABELS.template,
        canonicalId: template?.id ?? template?.Id ?? null,
        label,
        model: shellModel || label,
        matchField: normalizeToken(shellModel).includes(needle) ? 'shellModel' : 'description',
        nextTool: 'preview_pump_shell_cost',
    };
}

function partCandidate(part, needle) {
    const model = String(part?.model || '').trim();
    if (!model || !normalizeToken(model).includes(needle)) return null;
    return {
        entityType: 'part',
        entityLabel: ENTITY_LABELS.part,
        canonicalId: part?.id ?? part?.Id ?? null,
        label: model,
        model,
        matchField: 'model',
        category: String(part?.category || '').trim(),
        nextTool: 'search_parts',
    };
}

/**
 * 型号简称在某个正式目录查不到时，去其余目录里找同名候选（默认排除配方自己）。
 * 只读、有界；任一目录读取失败都只是少一类候选，不改变"该目录未查到"这个结论。
 */
async function crossCatalogCandidates(getJson, internalFetch, query, { exclude = ['recipe'] } = {}) {
    const token = String(query || '').trim();
    if (!isCatalogModelToken(token)) return [];
    const needle = normalizeToken(token);
    const excluded = new Set(Array.isArray(exclude) ? exclude : [exclude]);
    const sources = Object.values(CATALOG_SOURCES).filter(source => !excluded.has(source.entityType));
    const lists = await Promise.all(sources.map(source => (
        getJson(internalFetch, source.path(token), source.errorMessage).catch(() => [])
    )));
    const candidates = [];
    sources.forEach((source, index) => {
        for (const row of Array.isArray(lists[index]) ? lists[index] : []) {
            if (!source.match(row, needle)) continue;
            const candidate = source.view(row, needle);
            if (candidate) candidates.push(candidate);
        }
    });
    return candidates.slice(0, MAX_CANDIDATES);
}

function crossCatalogEnrichment(candidates, token, { subject = 'object' } = {}) {
    const listed = candidates.map(candidate => `${candidate.label}（${candidate.entityLabel}）`).join('、');
    const catalogs = [...new Set(candidates.map(candidate => candidate.entityLabel))].join('、');
    return {
        crossCatalogCandidates: candidates,
        crossCatalogHint: `“${token}”不在刚查的目录里，但它是正式${catalogs}目录中的型号：${listed}。`
            + `请带着这份候选清单澄清要查询的${subject}，或直接查询对应对象；不要让用户从零说明型号。`,
    };
}

/**
 * 给"未找到配方"的失败结果补上跨目录候选。error 文本保持原样：
 * 它同时被"已核实缺失"路径引用，不能因为多了一类候选就改写结论。
 */
async function withCrossCatalogCandidates({ getJson, internalFetch, failure }) {
    if (!failure || failure.code !== 'AI_RESOURCE_NOT_FOUND') return failure;
    const candidates = await crossCatalogCandidates(getJson, internalFetch, failure.query);
    if (candidates.length === 0) return failure;
    return { ...failure, ...crossCatalogEnrichment(candidates, String(failure.query || '').trim()) };
}

/**
 * 查询成功但零行时的跨目录补齐（`get_all_recipes(keyword)` / `search_templates(model)` /
 * `search_parts(keyword)` 这类）。命中条件：查询是型号样式标识符、结果为空、且该目录已确认查过。
 * 空结果本身仍是权威结论（该目录内没有），只是不再让用户以为"系统里什么都没有"。
 */
async function withEmptyCatalogProbe({ getJson, internalFetch, result, token, catalog, subject = 'object' }) {
    if (!result || result.success === false) return result;
    const queried = String(token || '').trim();
    if (!isCatalogModelToken(queried)) return result;
    const rows = Array.isArray(result.data) ? result.data : [];
    if (rows.length > 0) return result;
    const candidates = await crossCatalogCandidates(getJson, internalFetch, queried, {
        exclude: [catalog],
    });
    if (candidates.length === 0) return result;
    return { ...result, ...crossCatalogEnrichment(candidates, queried, { subject }) };
}

/** 展示用的一行候选清单（运行时在模型空手反问时做确定性补充）。 */
function crossCatalogCandidateLine(candidates = []) {
    return candidates
        .map(candidate => `${candidate.label}（${candidate.entityLabel}${candidate.canonicalId ? ` ID ${candidate.canonicalId}` : ''}）`)
        .join('、');
}

/**
 * C：模型没有用上跨目录候选、直接空手反问时，用正式候选清单做确定性补充。
 * 正文已经点到任一候选（说明模型确实处理了这批候选）就不再重复。
 * 覆盖两种来源：名称解析失败（success=false）与查询成功但零行（空结果补齐）。
 */
function appendCrossCatalogCandidates(answer, toolResults = []) {
    const text = String(answer || '');
    const missing = (Array.isArray(toolResults) ? toolResults : []).find(item => (
        Array.isArray(item?.result?.crossCatalogCandidates)
        && item.result.crossCatalogCandidates.length > 0
    ));
    if (!missing) return answer;
    const candidates = missing.result.crossCatalogCandidates;
    if (candidates.some(candidate => candidate.label && text.includes(candidate.label))) return answer;
    const line = `已核实：正式目录中的相近型号：${crossCatalogCandidateLine(candidates)}。`
        + '请确认要查询哪一项，我再按该对象给出正式结果。';
    return text ? `${text}\n\n${line}` : line;
}

module.exports = {
    CATALOG_SOURCES,
    ENTITY_LABELS,
    MAX_CANDIDATES,
    MODEL_TOKEN_RE,
    appendCrossCatalogCandidates,
    crossCatalogCandidateLine,
    crossCatalogCandidates,
    crossCatalogEnrichment,
    isCatalogModelToken,
    recipeCandidate,
    templateCandidate,
    partCandidate,
    withCrossCatalogCandidates,
    withEmptyCatalogProbe,
};
