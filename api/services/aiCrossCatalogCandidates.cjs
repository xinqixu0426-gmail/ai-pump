'use strict';
// C（生产会话 58）：「V750 的成本是多少」——配方目录里本来就没有 V750 这个成品型号，
// 旧行为是空手反问用户。这里在"未找到配方"时补一次有界跨目录正式探测，把泵壳模板/零件
// 目录里真实存在的候选交给模型，让它带着候选清单澄清，而不是让用户从零说明。
//
// 只在查询本身是型号简称（V550/V750/12-120 这类）时探测：描述性短语查不到就是查不到，
// 不应该被引到别的目录。候选只带身份字段，不带价格/库存，避免把目录金额混进本轮正式金额依据。
const MODEL_TOKEN_RE = /^(?:[a-z]{1,4}[-_.]?\d{1,4}|\d{1,3}[-_]\d{1,4})$/iu;
const MAX_CANDIDATES = 6;

const ENTITY_LABELS = Object.freeze({
    template: '泵壳模板',
    part: '零件',
});

function isCatalogModelToken(value) {
    return MODEL_TOKEN_RE.test(String(value || '').trim());
}

function normalizeToken(value) {
    return String(value || '').trim().toLocaleLowerCase('zh-CN');
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
 * 型号简称在配方目录查不到时，去正式泵壳模板与零件目录里找同名候选。
 * 只读、有界；任一目录读取失败都只是少一类候选，不改变"配方未找到"这个结论。
 */
async function crossCatalogCandidates(getJson, internalFetch, query) {
    const token = String(query || '').trim();
    if (!isCatalogModelToken(token)) return [];
    const needle = normalizeToken(token);
    const [templates, parts] = await Promise.all([
        getJson(internalFetch, '/api/templates', '泵壳模板列表读取失败').catch(() => []),
        getJson(internalFetch, `/api/parts?keyword=${encodeURIComponent(token)}`, '零件列表读取失败').catch(() => []),
    ]);
    const candidates = [];
    for (const template of Array.isArray(templates) ? templates : []) {
        const shellModel = normalizeToken(template?.shellModel);
        const description = normalizeToken(template?.description);
        if (!shellModel.includes(needle) && !description.includes(needle)) continue;
        const candidate = templateCandidate(template, needle);
        if (candidate) candidates.push(candidate);
    }
    for (const part of Array.isArray(parts) ? parts : []) {
        const candidate = partCandidate(part, needle);
        if (candidate) candidates.push(candidate);
    }
    return candidates.slice(0, MAX_CANDIDATES);
}

/**
 * 给"未找到配方"的失败结果补上跨目录候选。error 文本保持原样：
 * 它同时被"已核实缺失"路径引用，不能因为多了一类候选就改写结论。
 */
async function withCrossCatalogCandidates({ getJson, internalFetch, failure }) {
    if (!failure || failure.code !== 'AI_RESOURCE_NOT_FOUND') return failure;
    const candidates = await crossCatalogCandidates(getJson, internalFetch, failure.query);
    if (candidates.length === 0) return failure;
    const listed = candidates.map(candidate => `${candidate.label}（${candidate.entityLabel}）`).join('、');
    return {
        ...failure,
        crossCatalogCandidates: candidates,
        crossCatalogHint: `“${failure.query}”不是配方名称，但它是正式${[...new Set(candidates.map(candidate => candidate.entityLabel))].join('、')}目录中的型号：${listed}。请带着这份候选清单澄清要查询的对象，或直接查询对应对象；不要让用户从零说明型号。`,
    };
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
 */
function appendCrossCatalogCandidates(answer, toolResults = []) {
    const text = String(answer || '');
    const missing = (Array.isArray(toolResults) ? toolResults : []).find(item => (
        item?.result?.success === false
        && Array.isArray(item.result.crossCatalogCandidates)
        && item.result.crossCatalogCandidates.length > 0
    ));
    if (!missing) return answer;
    const candidates = missing.result.crossCatalogCandidates;
    if (candidates.some(candidate => candidate.label && text.includes(candidate.label))) return answer;
    const query = String(missing.result.query || '').trim();
    const line = `已核实：“${query}”不是配方名称；正式目录中的相近型号：${crossCatalogCandidateLine(candidates)}。请确认要查询哪一项，我再按该对象给出正式结果。`;
    return text ? `${text}\n\n${line}` : line;
}

module.exports = {
    ENTITY_LABELS,
    MAX_CANDIDATES,
    MODEL_TOKEN_RE,
    appendCrossCatalogCandidates,
    crossCatalogCandidateLine,
    crossCatalogCandidates,
    isCatalogModelToken,
    withCrossCatalogCandidates,
};
