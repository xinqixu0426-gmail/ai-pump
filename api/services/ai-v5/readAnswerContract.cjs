'use strict';
const V5_READ_ANSWER_COMPOSER_VERSION = 1, V5_READ_ANSWER_PROMPT_VERSION = 1;
const SEMANTICS = Object.freeze({
    'price.current': Object.freeze({ prefix: '当前目录单价', suffix: 'CNY/目录数量单位' }),
    'inventory.quantity': Object.freeze({ prefix: '当前库存', suffix: '目录数量单位' }),
    'coil.inventory': Object.freeze({ prefix: '当前库存', suffix: '套' }),
    'recipe.cost.preview': Object.freeze({ prefix: '当前成本预览', suffix: 'CNY/配方单位' }),
});
const LIMITATION = '目前已验证的信息仅包括上述事实。';
const exactKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o)
    && JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort());
function parseAnswer(content) {
    let d; try { d = JSON.parse(content); } catch { throw Error('ANSWER_INVALID_JSON'); }
    if (!exactKeys(d, ['version', 'answerStatus', 'answerText', 'claims']) || d.version !== 1 || d.answerStatus !== 'ANSWERED'
        || typeof d.answerText !== 'string' || !d.answerText.length || d.answerText.length > 4000
        || !Array.isArray(d.claims) || !d.claims.length || d.claims.length > 5) throw Error('ANSWER_INVALID_CONTRACT');
    const ids = new Set();
    for (const c of d.claims) {
        if (!exactKeys(c, ['claimId', 'claimType', 'factKey', 'evidenceRefs', 'entityRef', 'numericValue'])
            || typeof c.claimId !== 'string' || !/^c[1-5]$/u.test(c.claimId) || ids.has(c.claimId)
            || !['FACT', 'LIMITATION'].includes(c.claimType) || !Array.isArray(c.evidenceRefs)
            || c.evidenceRefs.some(r => typeof r !== 'string') || new Set(c.evidenceRefs).size !== c.evidenceRefs.length
            || (c.claimType === 'FACT' && (!c.evidenceRefs.length || typeof c.factKey !== 'string' || typeof c.entityRef !== 'string' || typeof c.numericValue !== 'number'))
            || (c.claimType === 'LIMITATION' && (c.factKey !== null || c.numericValue !== null || c.entityRef !== null || c.evidenceRefs.length))) throw Error('ANSWER_INVALID_CONTRACT');
        ids.add(c.claimId);
    }
    return d;
}
function renderFact(label, factKey, value) {
    const s = SEMANTICS[factKey];
    return s ? `${label}：${s.prefix}为${String(value)} ${s.suffix}。` : null;
}
module.exports = { V5_READ_ANSWER_COMPOSER_VERSION, V5_READ_ANSWER_PROMPT_VERSION, SEMANTICS, LIMITATION, parseAnswer, renderFact };
